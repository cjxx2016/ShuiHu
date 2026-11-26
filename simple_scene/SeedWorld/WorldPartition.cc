// ============================================================================
// WorldPartition.cc — 后台分块构建与主线程限量上传
// ----------------------------------------------------------------------------
// 加载窗口分两层:
//   * 活动窗口 (半径 r): 完整烘焙质量, 保证近处画质;
//   * 预取外圈 (半径 r+1): 预取烘焙质量, 空闲/朝向前方时提前构建,
//     进入活动窗口后自动升级为完整质量, 旧网格保留到新网格上传完成。
// 任务带地形源版本; 旧源结果按版本丢弃。
// ============================================================================
#include "WorldPartition.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <utility>

namespace sw {
namespace {

constexpr int kPrefetchRing = 1;      // 预取外圈宽度 (分块)
constexpr int kFullQualityRadius = 4; // 内圈完整质量, 更外圈使用轻量 LOD
constexpr size_t kMaxQueued = 160;    // 后台队列上限

bool IsBetter(BakeQuality a, BakeQuality b) {
    return static_cast<int>(a) < static_cast<int>(b);
}

bool KeyInRange(uint64_t key, int focusX, int focusZ, int radius) {
    const int cx = static_cast<int>(static_cast<int32_t>(key >> 32));
    const int cz = static_cast<int>(static_cast<int32_t>(key & 0xFFFFFFFFu));
    return std::abs(cx - focusX) <= radius && std::abs(cz - focusZ) <= radius;
}

} // namespace

WorldPartition::WorldPartition(Renderer& renderer, std::shared_ptr<const TerrainSource> terrain)
    : renderer_(renderer),
      terrain_(terrain ? std::move(terrain) : std::make_shared<ProceduralTerrain>()) {}

WorldPartition::~WorldPartition() {
    Stop();
}

void WorldPartition::Start(int loadRadius, int workerCount) {
    if (started_) {
        return;
    }
    radius_ = std::max(0, loadRadius);
    workerCount_ = std::clamp(workerCount, 1, 4);
    stop_.store(false, std::memory_order_relaxed);
    for (int i = 0; i < workerCount_; ++i) {
        workers_.emplace_back([this] { WorkerLoop(); });
    }
    started_ = true;
}

void WorldPartition::Stop() {
    if (!started_) {
        return;
    }
    stop_.store(true, std::memory_order_relaxed);
    jobCv_.notify_all();
    for (std::thread& worker : workers_) {
        if (worker.joinable()) {
            worker.join();
        }
    }
    workers_.clear();
    {
        std::lock_guard<std::mutex> lock(jobMutex_);
        jobs_.clear();
    }
    {
        std::lock_guard<std::mutex> lock(resultMutex_);
        results_.clear();
    }
    uploadQueue_.clear();
    requested_.clear();
    loaded_.clear();
    started_ = false;
}

void WorldPartition::SetLoadRadius(int radius) {
    radius_ = std::max(0, radius);
}

void WorldPartition::SetPrefetch(bool enabled) {
    if (prefetchEnabled_ == enabled) {
        return;
    }
    prefetchEnabled_ = enabled;
    if (!enabled) {
        // 立即移除活动窗口外的预取块, 让开关与显存占用一致。
        std::vector<uint64_t> evict;
        for (const auto& item : loaded_) {
            if (!KeyInRange(item.first, focusChunkX_, focusChunkZ_, radius_)) {
                evict.push_back(item.first);
            }
        }
        for (uint64_t key : evict) {
            const int cx = static_cast<int>(static_cast<int32_t>(key >> 32));
            const int cz = static_cast<int>(static_cast<int32_t>(key & 0xFFFFFFFFu));
            renderer_.RemoveChunk(cx, cz);
            loaded_.erase(key);
        }
    }
}

void WorldPartition::SetTerrainSource(std::shared_ptr<const TerrainSource> terrain) {
    if (!terrain || terrain == terrain_) {
        return;
    }
    terrain_ = std::move(terrain);
    sourceVersion_.fetch_add(1, std::memory_order_relaxed);

    // 旧源的在飞任务与结果全部作废; 已加载分块用新源重建。
    {
        std::lock_guard<std::mutex> lock(jobMutex_);
        jobs_.clear();
    }
    {
        std::lock_guard<std::mutex> lock(resultMutex_);
        results_.clear();
    }
    uploadQueue_.clear();
    requested_.clear();
    loaded_.clear();
    renderer_.ClearChunks();
    if (log_) {
        std::fprintf(stderr, "[WP] terrain source v%llu, 清空分块等待重建\n",
                     static_cast<unsigned long long>(sourceVersion_.load(std::memory_order_relaxed)));
    }
}

int WorldPartition::LoadedCount() const {
    return static_cast<int>(loaded_.size());
}

int WorldPartition::PrefetchedCount() const {
    // 已加载但位于活动窗口之外的分块 (含移动方向的完整质量预取)。
    int count = 0;
    for (const auto& item : loaded_) {
        const int cx = static_cast<int>(static_cast<int32_t>(item.first >> 32));
        const int cz = static_cast<int>(static_cast<int32_t>(item.first & 0xFFFFFFFFu));
        if (std::abs(cx - focusChunkX_) > radius_ || std::abs(cz - focusChunkZ_) > radius_) {
            ++count;
        }
    }
    return count;
}

int WorldPartition::PendingCount() const {
    return static_cast<int>(requested_.size());
}

double WorldPartition::AverageBakeMilliseconds() const {
    std::lock_guard<std::mutex> lock(statsMutex_);
    return bakeCount_ > 0 ? bakeMillisecondsTotal_ / static_cast<double>(bakeCount_) : 0.0;
}

bool WorldPartition::BuildChunk(const Job& job, BuildResult& result) const {
    const int originX = job.chunkX * WX;
    const int originZ = job.chunkZ * WZ;
    result.chunkX = job.chunkX;
    result.chunkZ = job.chunkZ;
    result.originX = originX;
    result.originZ = originZ;
    result.version = job.version;
    result.quality = job.quality;
    if (!job.terrain) {
        return false;
    }

    const auto t0 = std::chrono::steady_clock::now();
    World world(originX, originZ, *job.terrain);
    world.Build();
    auto bake = std::make_shared<BakeResult>(BakeWorld(world, job.quality));
    const auto t1 = std::chrono::steady_clock::now();

    result.bakeMilliseconds = std::chrono::duration<double, std::milli>(t1 - t0).count();
    result.bake = std::move(bake);
    return !result.bake->vertices.empty() && !result.bake->indices.empty();
}

bool WorldPartition::BuildNow(int chunkX, int chunkZ, std::string* error) {
    const Job job{chunkX, chunkZ, sourceVersion_.load(std::memory_order_relaxed), terrain_,
                  BakeQuality::Full};
    BuildResult result;
    if (!BuildChunk(job, result)) {
        if (error) {
            *error = "分块烘焙失败或为空";
        }
        return false;
    }

    std::string uploadError;
    if (!renderer_.AddChunk(chunkX, chunkZ, result.originX, result.originZ, *result.bake,
                            &uploadError)) {
        if (error) {
            *error = uploadError;
        }
        return false;
    }

    requested_.erase(KeyOf(chunkX, chunkZ));
    loaded_[KeyOf(chunkX, chunkZ)] = BakeQuality::Full;
    {
        std::lock_guard<std::mutex> lock(statsMutex_);
        bakeMillisecondsTotal_ += result.bakeMilliseconds;
        ++bakeCount_;
    }
    builtCount_.fetch_add(1, std::memory_order_relaxed);
    if (log_) {
        std::fprintf(stderr, "[WP] built (%d,%d) tris=%d bake=%.0fms\n", chunkX, chunkZ,
                     result.bake->triangles, result.bakeMilliseconds);
    }
    return true;
}

void WorldPartition::WorkerLoop() {
    for (;;) {
        Job job{};
        {
            std::unique_lock<std::mutex> lock(jobMutex_);
            jobCv_.wait(lock, [this] {
                return stop_.load(std::memory_order_relaxed) || !jobs_.empty();
            });
            if (stop_.load(std::memory_order_relaxed) && jobs_.empty()) {
                return;
            }
            job = jobs_.front();
            jobs_.pop_front();
        }

        BuildResult result;
        if (!BuildChunk(job, result)) {
            std::fprintf(stderr, "[WP] chunk (%d,%d) 烘焙失败或为空\n", job.chunkX, job.chunkZ);
            result.chunkX = job.chunkX;
            result.chunkZ = job.chunkZ;
            result.version = job.version;
            result.quality = job.quality;
        }

        const double bakeMs = result.bakeMilliseconds;
        const bool valid = result.bake != nullptr && !result.bake->vertices.empty()
            && !result.bake->indices.empty();
        if (!valid) {
            result.bake.reset();
        }
        {
            std::lock_guard<std::mutex> lock(resultMutex_);
            results_.push_back(std::move(result));
        }
        if (valid) {
            std::lock_guard<std::mutex> lock(statsMutex_);
            bakeMillisecondsTotal_ += bakeMs;
            ++bakeCount_;
        }
        builtCount_.fetch_add(1, std::memory_order_relaxed);
    }
}

void WorldPartition::Update(Vec3 focusWorld, Vec3 focusVelocity, int maxUploads) {
    if (!started_) {
        return;
    }

    const uint64_t version = sourceVersion_.load(std::memory_order_relaxed);
    const std::shared_ptr<const TerrainSource> terrain = terrain_;
    // radius 0 作为纯英雄块基准模式, 不预取周围。
    const int prefetchRadius = (prefetchEnabled_ && radius_ >= 1) ? kPrefetchRing : 0;
    const int keepRadius = radius_ + prefetchRadius;

    const int focusX = static_cast<int>(std::floor((focusWorld.x + WX * 0.5f) / static_cast<float>(WX)));
    const int focusZ = static_cast<int>(std::floor((focusWorld.z + WZ * 0.5f) / static_cast<float>(WZ)));
    focusChunkX_ = focusX;
    focusChunkZ_ = focusZ;

    const float speedSq = focusVelocity.x * focusVelocity.x + focusVelocity.z * focusVelocity.z;
    const bool hasDirection = speedSq > 0.25f;
    float dirX = 0.0f;
    float dirZ = 0.0f;
    if (hasDirection) {
        const float inv = 1.0f / std::sqrt(speedSq);
        dirX = focusVelocity.x * inv;
        dirZ = focusVelocity.z * inv;
    }
    auto aheadScore = [&](int cx, int cz) {
        if (!hasDirection) {
            return 0.0f;
        }
        const float ox = static_cast<float>(cx - focusX);
        const float oz = static_cast<float>(cz - focusZ);
        const float len = std::sqrt(ox * ox + oz * oz);
        return len > 1e-4f ? (ox * dirX + oz * dirZ) / len : 0.0f;
    };
    auto eraseIfReached = [&](uint64_t key, BakeQuality quality) {
        const auto it = requested_.find(key);
        if (it != requested_.end() && static_cast<int>(quality) <= static_cast<int>(it->second)) {
            requested_.erase(it);
        }
    };

    // 1) 淘汰超出滞回窗口的分块; 移动时额外淘汰身后的预取块, 只保留前方缓冲。
    auto behind = [&](int cx, int cz) {
        if (!hasDirection) {
            return false;
        }
        if (KeyInRange(KeyOf(cx, cz), focusX, focusZ, radius_)) {
            return false;
        }
        return aheadScore(cx, cz) < -0.10f;
    };
    std::vector<uint64_t> evict;
    for (const auto& item : loaded_) {
        const int cx = static_cast<int>(static_cast<int32_t>(item.first >> 32));
        const int cz = static_cast<int>(static_cast<int32_t>(item.first & 0xFFFFFFFFu));
        if (!KeyInRange(item.first, focusX, focusZ, keepRadius + 1) || behind(cx, cz)) {
            evict.push_back(item.first);
        }
    }
    for (uint64_t key : evict) {
        const int cx = static_cast<int>(static_cast<int32_t>(key >> 32));
        const int cz = static_cast<int>(static_cast<int32_t>(key & 0xFFFFFFFFu));
        renderer_.RemoveChunk(cx, cz);
        loaded_.erase(key);
        if (log_) {
            std::fprintf(stderr, "[WP] -chunk (%d,%d) loaded=%d prefetch=%d\n", cx, cz,
                         static_cast<int>(loaded_.size()), PrefetchedCount());
        }
    }

    // 2) 收集后台完成的构建结果
    {
        std::lock_guard<std::mutex> lock(resultMutex_);
        for (BuildResult& result : results_) {
            uploadQueue_.push_back(std::move(result));
        }
        results_.clear();
    }

    // 3) 过滤过期/已满足的结果
    std::vector<BuildResult> ready;
    ready.reserve(uploadQueue_.size());
    for (BuildResult& result : uploadQueue_) {
        if (result.version != version) {
            continue; // 旧地形源的在飞结果; 不触碰新源已排队的请求
        }
        const uint64_t key = KeyOf(result.chunkX, result.chunkZ);
        if (result.bake == nullptr || !KeyInRange(key, focusX, focusZ, keepRadius)
            || behind(result.chunkX, result.chunkZ)) {
            eraseIfReached(key, result.quality);
            continue;
        }
        const auto lit = loaded_.find(key);
        if (lit != loaded_.end() && !IsBetter(result.quality, lit->second)) {
            eraseIfReached(key, result.quality);
            continue;
        }
        ready.push_back(std::move(result));
    }
    uploadQueue_.clear();

    // 新块优先于质量升级, 其次近处优先; 同键同帧只上传最佳质量。
    std::sort(ready.begin(), ready.end(), [&](const BuildResult& a, const BuildResult& b) {
        const uint64_t ka = KeyOf(a.chunkX, a.chunkZ);
        const uint64_t kb = KeyOf(b.chunkX, b.chunkZ);
        const bool aLoaded = loaded_.find(ka) != loaded_.end();
        const bool bLoaded = loaded_.find(kb) != loaded_.end();
        if (aLoaded != bLoaded) {
            return !aLoaded;
        }
        const int da = std::abs(a.chunkX - focusX) + std::abs(a.chunkZ - focusZ);
        const int db = std::abs(b.chunkX - focusX) + std::abs(b.chunkZ - focusZ);
        if (da != db) {
            return da < db;
        }
        return static_cast<int>(a.quality) < static_cast<int>(b.quality);
    });

    int uploaded = 0;
    for (BuildResult& result : ready) {
        if (uploaded >= maxUploads) {
            uploadQueue_.push_back(std::move(result));
            continue;
        }
        const uint64_t key = KeyOf(result.chunkX, result.chunkZ);
        const auto lit = loaded_.find(key);
        if (lit != loaded_.end() && !IsBetter(result.quality, lit->second)) {
            eraseIfReached(key, result.quality);
            continue;
        }
        std::string error;
        if (!renderer_.AddChunk(result.chunkX, result.chunkZ, result.originX, result.originZ,
                                *result.bake, &error)) {
            std::fprintf(stderr, "[WP] 上传分块 (%d,%d) 失败: %s\n", result.chunkX, result.chunkZ,
                         error.c_str());
            eraseIfReached(key, result.quality);
            continue;
        }
        loaded_[key] = result.quality;
        eraseIfReached(key, result.quality);
        ++uploaded;
        if (log_) {
            std::fprintf(stderr, "[WP] +chunk (%d,%d) q=%c tris=%d bake=%.0fms loaded=%d prefetch=%d\n",
                         result.chunkX, result.chunkZ,
                         result.quality == BakeQuality::Full ? 'F' : 'P', result.bake->triangles,
                         result.bakeMilliseconds, static_cast<int>(loaded_.size()),
                         PrefetchedCount());
        }
    }

    struct Missing {
        int chunkX;
        int chunkZ;
        int distance;
        float ahead;
        BakeQuality quality = BakeQuality::Full;
    };
    auto enqueue = [&](const Missing& item, BakeQuality quality, bool front, size_t& queued) {
        if (queued >= kMaxQueued) {
            return;
        }
        const uint64_t key = KeyOf(item.chunkX, item.chunkZ);
        const auto rit = requested_.find(key);
        if (rit != requested_.end()
            && static_cast<int>(rit->second) <= static_cast<int>(quality)) {
            return; // 已有同等或更高质量请求
        }
        const Job job{item.chunkX, item.chunkZ, version, terrain, quality};
        if (front) {
            jobs_.push_front(job);
        } else {
            jobs_.push_back(job);
        }
        requested_[key] = quality;
        ++queued;
    };

    // 4) 活动窗口: 缺失块 + 预取块升级, 近处优先, 按速度方向微调
    std::vector<Missing> required;
    for (int dz = -radius_; dz <= radius_; ++dz) {
        for (int dx = -radius_; dx <= radius_; ++dx) {
            const int cx = focusX + dx;
            const int cz = focusZ + dz;
            const uint64_t key = KeyOf(cx, cz);
            const int cheb = std::max(std::abs(dx), std::abs(dz));
            // 半径 5 的最外圈使用轻量 LOD; 半径 <=4 时全部完整质量。
            const BakeQuality want = cheb > kFullQualityRadius
                ? BakeQuality::Prefetch : BakeQuality::Full;
            const auto lit = loaded_.find(key);
            if (lit != loaded_.end() && !IsBetter(want, lit->second)) {
                continue;
            }
            const auto rit = requested_.find(key);
            if (rit != requested_.end() && !IsBetter(want, rit->second)) {
                continue;
            }
            required.push_back(Missing{cx, cz, std::abs(dx) + std::abs(dz), aheadScore(cx, cz), want});
        }
    }
    std::sort(required.begin(), required.end(), [](const Missing& a, const Missing& b) {
        if (a.distance != b.distance) {
            return a.distance < b.distance;
        }
        if (a.quality != b.quality) {
            return static_cast<int>(a.quality) < static_cast<int>(b.quality);
        }
        return a.ahead > b.ahead;
    });
    {
        std::lock_guard<std::mutex> lock(jobMutex_);
        size_t queued = jobs_.size();
        for (auto it = required.rbegin(); it != required.rend(); ++it) {
            enqueue(*it, it->quality, true, queued);
        }
        jobCv_.notify_all();
    }

    // 5) 预取外圈:
    //    * 移动时只预取速度前方的少量分块 (完整质量, 进入窗口无需再烘焙);
    //    * 空闲时补 8 块低质量外圈, 避免一次性把整圈都拉进显存。
    if (prefetchRadius > 0) {
        constexpr int kMovingPrefetch = 8;
        constexpr int kIdlePrefetch = 6;
        // 低质量预取配额同时统计已加载与在飞请求, 避免空闲时每帧重复排队。
        int lowPrefetched = 0;
        for (const auto& item : loaded_) {
            if (item.second == BakeQuality::Prefetch) {
                ++lowPrefetched;
            }
        }
        for (const auto& item : requested_) {
            if (item.second == BakeQuality::Prefetch) {
                ++lowPrefetched;
            }
        }

        const bool moving = hasDirection;
        const int budget = moving ? kMovingPrefetch : (kIdlePrefetch - lowPrefetched);
        if (budget > 0) {
            std::vector<Missing> prefetch;
            for (int dz = -keepRadius; dz <= keepRadius; ++dz) {
                for (int dx = -keepRadius; dx <= keepRadius; ++dx) {
                    const int cheb = std::max(std::abs(dx), std::abs(dz));
                    if (cheb <= radius_) {
                        continue;
                    }
                    const int cx = focusX + dx;
                    const int cz = focusZ + dz;
                    const uint64_t key = KeyOf(cx, cz);
                    if (loaded_.find(key) != loaded_.end()
                        || requested_.find(key) != requested_.end()) {
                        continue;
                    }
                    const float ahead = aheadScore(cx, cz);
                    if (moving && ahead < 0.35f) {
                        continue;
                    }
                    prefetch.push_back(Missing{cx, cz, cheb, ahead, BakeQuality::Prefetch});
                }
            }
            std::sort(prefetch.begin(), prefetch.end(), [&](const Missing& a, const Missing& b) {
                if (moving && a.ahead != b.ahead) {
                    return a.ahead > b.ahead;
                }
                if (a.distance != b.distance) {
                    return a.distance < b.distance;
                }
                return a.ahead > b.ahead;
            });
            if (static_cast<int>(prefetch.size()) > budget) {
                prefetch.resize(static_cast<size_t>(budget));
            }

            // 移动方向预取使用完整质量 (进入窗口无需重烘焙);
            // 空闲环视预取使用轻量 LOD, 进入活动窗口后升级。
            const BakeQuality quality = moving ? BakeQuality::Full : BakeQuality::Prefetch;
            std::lock_guard<std::mutex> lock(jobMutex_);
            size_t queued = jobs_.size();
            for (const Missing& item : prefetch) {
                enqueue(item, quality, false, queued);
            }
            jobCv_.notify_all();
        }
    }
}

} // namespace sw
