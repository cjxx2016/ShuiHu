// ============================================================================
// WorldPartition.h — SeedWorld 的分块流送 (World Partition 思想)
// ----------------------------------------------------------------------------
// 以相机焦点所在分块为中心, 维护一个 (2r+1)x(2r+1) 的加载窗口:
//   * 活动窗口内的缺失分块以完整质量在后台烘焙;
//   * 活动窗口外再预取一圈 (prefetch) 低烘焙质量分块, 空闲时提前补齐;
//   * 预取块进入活动窗口后自动升级为完整质量, 旧网格保留到新网格上传;
//   * 主线程每帧限量上传完成的网格到 Renderer, 避免卡顿;
//   * 离开窗口 (半径 +2 滞回) 的分块自动销毁 GPU 资源;
//   * 每个分块独立拥有体素/水面/彩光体积, 互不共享, 便于后续 LOD/动画。
// 世界本身是无限的: 分块坐标可以为负, 地形/特征由全局解析函数与哈希决定。
// ============================================================================
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <vector>

#include "Common.h"
#include "Mesher.h"
#include "Renderer.h"
#include "Terrain.h"

namespace sw {

class WorldPartition {
public:
    WorldPartition(Renderer& renderer, std::shared_ptr<const TerrainSource> terrain);
    ~WorldPartition();

    void Start(int loadRadius, int workerCount);
    void Stop();

    // 每帧主线程调用; focusVelocity (m/s) 用于优先预取前进方向;
    // maxUploads 限制本帧创建的 GPU 分块数量。
    void Update(Vec3 focusWorld, Vec3 focusVelocity, int maxUploads);

    void SetLoadRadius(int radius);
    int LoadRadius() const { return radius_; }
    // 预取开关: 关闭后只加载活动窗口 (用于与参考基线逐像素对比)。
    void SetPrefetch(bool enabled);
    bool PrefetchEnabled() const { return prefetchEnabled_; }
    void SetLogging(bool enabled) { log_ = enabled; }

    // 同步构建/上传单个分块 (启动时先构建焦点块, 避免黑屏)。
    bool BuildNow(int chunkX, int chunkZ, std::string* error);

    // 切换地形源快照并清空当前 GPU 分块; 下一次 Update 用新源重建。
    // 用于设计地图热替换 / 动态地形编辑。
    void SetTerrainSource(std::shared_ptr<const TerrainSource> terrain);

    int LoadedCount() const;
    int PrefetchedCount() const;
    int PendingCount() const;
    int BuiltCount() const { return builtCount_.load(std::memory_order_relaxed); }
    double AverageBakeMilliseconds() const;

private:
    struct Job {
        int chunkX;
        int chunkZ;
        uint64_t version;
        std::shared_ptr<const TerrainSource> terrain;
        BakeQuality quality = BakeQuality::Full;
    };

    struct BuildResult {
        int chunkX = 0;
        int chunkZ = 0;
        int originX = 0;
        int originZ = 0;
        std::shared_ptr<BakeResult> bake;
        double bakeMilliseconds = 0.0;
        uint64_t version = 0;
        BakeQuality quality = BakeQuality::Full;
    };

    static uint64_t KeyOf(int chunkX, int chunkZ) {
        return (static_cast<uint64_t>(static_cast<uint32_t>(chunkX)) << 32)
            | static_cast<uint64_t>(static_cast<uint32_t>(chunkZ));
    }

    void WorkerLoop();
    bool BuildChunk(const Job& job, BuildResult& result) const;

    Renderer& renderer_;
    std::shared_ptr<const TerrainSource> terrain_;
    std::atomic<uint64_t> sourceVersion_{0};
    int radius_ = 2;
    int workerCount_ = 0;
    bool log_ = false;

    std::vector<std::thread> workers_;
    std::deque<Job> jobs_;
    mutable std::mutex jobMutex_;
    std::condition_variable jobCv_;
    std::atomic<bool> stop_{false};

    std::mutex resultMutex_;
    std::vector<BuildResult> results_;
    std::vector<BuildResult> uploadQueue_;

    // key -> 目标烘焙质量; 活动窗口为 Full, 预取外圈为 Prefetch。
    std::unordered_map<uint64_t, BakeQuality> requested_;
    // key -> 已上传网格质量; 预取块升级时保留旧块直到新块上传。
    std::unordered_map<uint64_t, BakeQuality> loaded_;
    bool prefetchEnabled_ = true;
    int focusChunkX_ = 0;   // 最近一次 Update 的焦点块 (供预取计数)
    int focusChunkZ_ = 0;
    std::atomic<int> builtCount_{0};
    mutable std::mutex statsMutex_;
    double bakeMillisecondsTotal_ = 0.0;
    int bakeCount_ = 0;
    bool started_ = false;
};

} // namespace sw
