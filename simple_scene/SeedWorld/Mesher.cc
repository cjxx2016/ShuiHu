// ============================================================================
// Mesher.cc — SeedWorld 表面网格烘焙实现
// ----------------------------------------------------------------------------
// 烘焙分为三步:
//   1) 逐面计算黄金螺旋天光可见度、角点 AO、弯曲法线、材质/环境元数据;
//   2) 以切片为单位发射四边形 (统一处理 6 个面方向), 并按对角权重选择三角剖分;
//   3) 独立生成 3D 彩光溢色体积与溪流水面网格。
// 所有空间查询都只读 World, 不修改世界本身。
// ============================================================================
#include "Mesher.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>

namespace sw {
namespace {

constexpr int kMaxDim = (WX + 2 * kChunkHalo > WY)
    ? ((WX + 2 * kChunkHalo > WZ + 2 * kChunkHalo) ? WX + 2 * kChunkHalo : WZ + 2 * kChunkHalo)
    : ((WY > WZ + 2 * kChunkHalo) ? WY : WZ + 2 * kChunkHalo);  // 外扩/WY 最大边长
constexpr int kMaxSlice = kMaxDim * kMaxDim;

constexpr float kAoFactors[4] = {0.46f, 0.68f, 0.85f, 1.0f};

struct FaceDir {
    int axis;
    int sign;
    int uAxis;
    int vAxis;
    float nx;
    float ny;
    float nz;
    float shade;
};

// 与 seedworld-tree-house.html 中 DIRS 完全一致
constexpr FaceDir kDirs[6] = {
    {0, -1, 2, 1, -1.0f,  0.0f,  0.0f, 0.92f},  // -X
    {0,  1, 2, 1,  1.0f,  0.0f,  0.0f, 0.92f},  // +X
    {2,  1, 0, 1,  0.0f,  0.0f,  1.0f, 0.88f},  // +Z
    {2, -1, 0, 1,  0.0f,  0.0f, -1.0f, 0.88f},  // -Z
    {1,  1, 0, 2,  0.0f,  1.0f,  0.0f, 1.00f},  // +Y
    {1, -1, 0, 2,  0.0f, -1.0f,  0.0f, 0.72f},  // -Y
};

struct DirRays {
    int count = 0;
    int steps = 0;
    std::vector<float> rx, ry, rz, rw;   // count * steps
    std::vector<float> ux, uy, uz;       // count
    float stepWeight = 0.0f;
};

struct RaySet {
    std::array<DirRays, 6> dirs;
};

RaySet BuildRaySet(int n, const std::vector<float>& dists, bool useInvDist) {
    RaySet set;
    const float inc = kPi * (3.0f - std::sqrt(5.0f));

    std::vector<Vec3> sphere;
    sphere.reserve(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) {
        const float y = useInvDist
            ? (1.0f - (static_cast<float>(i) + 0.5f) * (2.0f / static_cast<float>(n)))
            : (static_cast<float>(i) * (2.0f / static_cast<float>(n)) - 1.0f + (1.0f / static_cast<float>(n)));
        const float r = std::sqrt(std::max(0.0f, 1.0f - y * y));
        const float phi = static_cast<float>(i) * inc;
        sphere.push_back(Vec3{std::cos(phi) * r, y, std::sin(phi) * r});
    }

    const float threshold = useInvDist ? 0.22f : 0.2f;
    const int steps = static_cast<int>(dists.size());

    for (int d = 0; d < 6; ++d) {
        const FaceDir& dir = kDirs[d];
        DirRays& out = set.dirs[d];

        std::vector<Vec3> pts;
        for (const Vec3& p : sphere) {
            if (p.x * dir.nx + p.y * dir.ny + p.z * dir.nz > threshold) {
                pts.push_back(p);
            }
        }

        out.count = static_cast<int>(pts.size());
        out.steps = steps;
        out.rx.resize(static_cast<size_t>(out.count) * steps);
        out.ry.resize(static_cast<size_t>(out.count) * steps);
        out.rz.resize(static_cast<size_t>(out.count) * steps);
        out.rw.resize(static_cast<size_t>(out.count) * steps);
        out.ux.resize(static_cast<size_t>(out.count));
        out.uy.resize(static_cast<size_t>(out.count));
        out.uz.resize(static_cast<size_t>(out.count));

        for (int r = 0; r < out.count; ++r) {
            const Vec3& p = pts[static_cast<size_t>(r)];
            out.ux[static_cast<size_t>(r)] = p.x;
            out.uy[static_cast<size_t>(r)] = p.y;
            out.uz[static_cast<size_t>(r)] = p.z;
            for (int s = 0; s < steps; ++s) {
                const size_t idx = static_cast<size_t>(r) * steps + s;
                const float dist = dists[static_cast<size_t>(s)];
                out.rx[idx] = p.x * dist;
                out.ry[idx] = p.y * dist;
                out.rz[idx] = p.z * dist;
                out.rw[idx] = useInvDist ? (1.0f / dist) : (1.0f / (1.0f + dist * 0.13f));
            }
        }
        out.stepWeight = useInvDist
            ? (1.0f / (static_cast<float>(out.count) * 0.44f))
            : (1.55f / static_cast<float>(out.count));
    }
    return set;
}

const RaySet& SmoothRays() {
    static const RaySet set = BuildRaySet(
        48, {1.3f, 2.3f, 3.5f, 4.9f, 6.5f, 8.4f, 10.6f, 13.0f, 15.8f, 19.0f, 22.5f}, false);
    return set;
}

const RaySet& PagodaRays() {
    static const RaySet set = BuildRaySet(
        34, {1.4f, 2.4f, 3.6f, 5.0f, 6.6f, 8.5f, 10.5f}, true);
    return set;
}

// 预取质量: 更少射线/步数, 远处配合雾效; 与完整口径共享同一套权重归一化。
const RaySet& PrefetchSmoothRays() {
    static const RaySet set = BuildRaySet(
        24, {1.5f, 3.0f, 5.0f, 7.8f, 11.5f, 16.0f, 22.5f}, false);
    return set;
}

const RaySet& PrefetchPagodaRays() {
    static const RaySet set = BuildRaySet(
        18, {1.6f, 3.4f, 6.0f, 9.6f, 14.5f}, true);
    return set;
}

struct SkySample {
    float smoothVis = 1.0f;
    float origVis = 1.0f;
    float pagodaVis = 1.0f;
    Vec3 bent{0.0f, 1.0f, 0.0f};
};

// 逐面天空可见度: 48 射线 (平滑/原始) + 34 射线 (五重塔/弯曲法线);
// 预取质量使用 24/18 射线近似。
SkySample ComputeSky(const World& world, const int p[3], int nx, int ny, int nz, bool topScale,
                     int topSolidY, BakeQuality quality) {
    const float ox = static_cast<float>(p[0]) + 0.5f + static_cast<float>(nx) * 0.55f;
    const float oy = static_cast<float>(p[1]) + 0.5f + static_cast<float>(ny) * 0.55f;
    const float oz = static_cast<float>(p[2]) + 0.5f + static_cast<float>(nz) * 0.55f;

    const int dirIndex = (nx != 0) ? (nx < 0 ? 0 : 1)
                                   : ((nz != 0) ? (nz > 0 ? 2 : 3) : (ny > 0 ? 4 : 5));

    SkySample out;

    // --- 平滑口径: 同时累计平滑可见度 (树叶半透 0.78) 与原始口径 (全遮蔽) ---
    {
        const RaySet& smoothSet = (quality == BakeQuality::Full) ? SmoothRays() : PrefetchSmoothRays();
        const DirRays& rays = smoothSet.dirs[static_cast<size_t>(dirIndex)];
        float occSmooth = 0.0f;
        float occOrig = 0.0f;
        for (int r = 0; r < rays.count; ++r) {
            const int base = r * rays.steps;
            for (int s = 0; s < rays.steps; ++s) {
                const int k = base + s;
                const int sx = static_cast<int>(ox + rays.rx[static_cast<size_t>(k)]);
                const int sy = static_cast<int>(oy + rays.ry[static_cast<size_t>(k)]);
                const int sz = static_cast<int>(oz + rays.rz[static_cast<size_t>(k)]);
                if (sx < 0 || sx >= world.VX() || sy < 0 || sy >= WY || sz < 0 || sz >= world.VZ()) {
                    break;
                }
                const Material hit = world.At(sx, sy, sz);
                if (hit == Material::Empty || hit == Material::Glow) {
                    continue;
                }
                const bool foliage = World::IsLeaf(hit);
                const float term = rays.stepWeight * rays.rw[static_cast<size_t>(k)];
                occSmooth += term * (foliage ? 0.78f : 1.0f);
                occOrig += term;
                break;
            }
        }
        out.smoothVis = Clamp(1.0f - occSmooth, 0.14f, 1.0f);
        out.origVis = Clamp(1.0f - occOrig, 0.14f, 1.0f);
    }

    // --- 五重塔口径 + 弯曲法线 ---
    {
        const RaySet& pagodaSet = (quality == BakeQuality::Full) ? PagodaRays() : PrefetchPagodaRays();
        const DirRays& rays = pagodaSet.dirs[static_cast<size_t>(dirIndex)];
        float occ = 0.0f;
        Vec3 bent{0.0f, 0.0f, 0.0f};
        for (int r = 0; r < rays.count; ++r) {
            const int base = r * rays.steps;
            float hitClear = 1.0f;
            for (int s = 0; s < rays.steps; ++s) {
                const int k = base + s;
                const int sx = static_cast<int>(ox + rays.rx[static_cast<size_t>(k)]);
                const int sy = static_cast<int>(oy + rays.ry[static_cast<size_t>(k)]);
                const int sz = static_cast<int>(oz + rays.rz[static_cast<size_t>(k)]);
                if (sx < 0 || sx >= world.VX() || sy < 0 || sy >= WY || sz < 0 || sz >= world.VZ()) {
                    break;
                }
                const Material hit = world.At(sx, sy, sz);
                if (hit == Material::Empty || hit == Material::Glow) {
                    continue;
                }
                const float weight = World::IsLeaf(hit) ? 0.55f : 1.0f;
                const float term = rays.stepWeight * rays.rw[static_cast<size_t>(k)];
                occ += term * weight;
                hitClear = std::max(0.05f, 1.0f - rays.rw[static_cast<size_t>(k)] * weight * 0.85f);
                break;
            }
            bent += Vec3{rays.ux[static_cast<size_t>(r)], rays.uy[static_cast<size_t>(r)],
                         rays.uz[static_cast<size_t>(r)]} * hitClear;
        }
        out.pagodaVis = Clamp(1.0f - occ, 0.14f, 1.0f);
        if (topScale && p[1] < topSolidY) {
            out.pagodaVis *= 0.88f;
        }
        const float len = Length(bent);
        out.bent = len > 1e-4f ? bent * (1.0f / len) : Vec3{static_cast<float>(nx), static_cast<float>(ny),
                                                             static_cast<float>(nz)};
    }
    return out;
}

// MagicaVoxel MATL _media 口径: 0 = 树冠外缘, 1 = 深处叶芯
float ComputeLocalElev(const World& world, int gx, int gy, int gz, Material mat) {
    if (mat == Material::Grass || mat == Material::Glow) {
        return 0.5f;
    }

    int cUp = 0;
    int cDn = 0;
    if (World::IsLeaf(mat)) {
        for (int dy = 1; dy <= 14; ++dy) {
            if (!World::IsLeaf(world.At(gx, gy + dy, gz))) {
                break;
            }
            ++cUp;
        }
        for (int dy = 1; dy <= 14; ++dy) {
            if (!World::IsLeaf(world.At(gx, gy - dy, gz))) {
                break;
            }
            ++cDn;
        }
    } else if (mat == Material::Dirt) {
        for (int dy = 1; dy <= 14; ++dy) {
            const Material m = world.At(gx, gy + dy, gz);
            if (m != Material::Dirt && m != Material::Grass) {
                break;
            }
            ++cUp;
        }
        for (int dy = 1; dy <= 14; ++dy) {
            if (world.At(gx, gy - dy, gz) == Material::Empty) {
                break;
            }
            ++cDn;
        }
    } else {
        for (int dy = 1; dy <= 14; ++dy) {
            if (world.At(gx, gy + dy, gz) == Material::Empty) {
                break;
            }
            ++cUp;
        }
        for (int dy = 1; dy <= 14; ++dy) {
            const Material m = world.At(gx, gy - dy, gz);
            if (m == Material::Empty || m == Material::Grass || m == Material::Dirt) {
                break;
            }
            ++cDn;
        }
    }
    return static_cast<float>(cDn) / static_cast<float>(std::max(1, cDn + cUp));
}

int CornerAO(const World& world, const int p[3], int axis, int sign, int uAxis, int vAxis, int du, int dv) {
    int b[3] = {p[0], p[1], p[2]};
    b[axis] += sign;

    int p1[3] = {b[0], b[1], b[2]};
    p1[uAxis] += du;
    int p2[3] = {b[0], b[1], b[2]};
    p2[vAxis] += dv;
    int pc[3] = {b[0], b[1], b[2]};
    pc[uAxis] += du;
    pc[vAxis] += dv;

    const bool s1 = world.IsSolid(p1[0], p1[1], p1[2]);
    const bool s2 = world.IsSolid(p2[0], p2[1], p2[2]);
    const bool c = world.IsSolid(pc[0], pc[1], pc[2]);
    if (s1 && s2) {
        return 0;
    }
    return 3 - (static_cast<int>(s1) + static_cast<int>(s2) + static_cast<int>(c));
}

float& Axis(Vec3& v, int axis) {
    return axis == 0 ? v.x : (axis == 1 ? v.y : v.z);
}

float Quantize12(float value) {
    return std::round(value * 11.0f) / 11.0f;
}

// 3D 洪水填充彩光溢色体积
void BuildBleedVolume(const World& world, BakeResult& out) {
    constexpr int BX = WX / 2;
    constexpr int BY = WY / 2;
    constexpr int BZ = WZ / 2;
    constexpr size_t kTotal = static_cast<size_t>(BX) * BY * BZ;

    std::vector<uint8_t> occCnt(kTotal, 0);
    std::vector<uint8_t> solidWall(kTotal, 0);
    std::vector<float> srcR(kTotal, 0.0f), srcG(kTotal, 0.0f), srcB(kTotal, 0.0f), srcE(kTotal, 0.0f);

    auto bounceColor = [](Material mat, Vec3& c) {
        switch (mat) {
            case Material::Grass:       c = {0.34f, 0.86f, 0.20f}; return true;
            case Material::Leaf:        c = {0.48f, 0.90f, 0.16f}; return true;
            case Material::LeafAutumn:  c = {1.05f, 0.42f, 0.12f}; return true;
            case Material::LeafPine:    c = {0.18f, 0.68f, 0.36f}; return true;
            case Material::Roof:        c = {0.95f, 0.34f, 0.18f}; return true;
            case Material::Wall:        c = {0.88f, 0.80f, 0.66f}; return true;
            case Material::Trunk:       c = {0.42f, 0.24f, 0.12f}; return true;
            case Material::Timber:      c = {0.48f, 0.28f, 0.14f}; return true;
            case Material::FlowerYellow:c = {0.95f, 0.78f, 0.22f}; return true;
            case Material::FlowerWhite: c = {0.82f, 0.80f, 0.74f}; return true;
            case Material::Stone:       c = {0.16f, 0.17f, 0.18f}; return true;
            case Material::Rock:        c = {0.12f, 0.11f, 0.10f}; return true;
            case Material::Dirt:        c = {0.18f, 0.13f, 0.10f}; return true;
            case Material::Snow:        c = {0.78f, 0.84f, 0.92f}; return true;
            default: return false;
        }
    };
    constexpr int kNeighbors[6][3] = {
        {1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1},
    };

    const int halo = world.Halo();
    for (int gz = halo; gz < halo + WZ; ++gz) {
        const int cz = gz - halo;
        for (int gy = 0; gy < WY; ++gy) {
            for (int gx = halo; gx < halo + WX; ++gx) {
                const int cx = gx - halo;
                const Material mat = world.At(gx, gy, gz);
                const size_t bi = static_cast<size_t>(((cz >> 1) * BY + (gy >> 1)) * BX + (cx >> 1));

                if (mat != Material::Empty) {
                    ++occCnt[bi];
                    if (mat == Material::Glow) {
                        srcE[bi] = std::max(srcE[bi], 1.25f);
                        for (const auto& nb : kNeighbors) {
                            const int nx = (cx >> 1) + nb[0];
                            const int ny = (gy >> 1) + nb[1];
                            const int nz = (cz >> 1) + nb[2];
                            if (nx >= 0 && nx < BX && ny >= 0 && ny < BY && nz >= 0 && nz < BZ) {
                                const size_t ni = static_cast<size_t>((nz * BY + ny) * BX + nx);
                                srcE[ni] = std::max(srcE[ni], 1.0f);
                            }
                        }
                    } else {
                        Vec3 c;
                        if (bounceColor(mat, c)) {
                            const bool airAbove = world.At(gx, gy + 1, gz) == Material::Empty;
                            const bool airEast = world.At(gx + 1, gy, gz) == Material::Empty;
                            const bool airSouth = world.At(gx, gy, gz + 1) == Material::Empty;
                            const bool exposed = airAbove || airEast || airSouth
                                || world.At(gx - 1, gy, gz) == Material::Empty
                                || world.At(gx, gy, gz - 1) == Material::Empty;
                            if (exposed) {
                                const float expW = airAbove ? 0.34f : ((airEast || airSouth) ? 0.24f : 0.12f);
                                for (const auto& nb : kNeighbors) {
                                    const int ax = gx + nb[0];
                                    const int ay = gy + nb[1];
                                    const int az = gz + nb[2];
                                    if (world.InBounds(ax, ay, az) && world.At(ax, ay, az) == Material::Empty) {
                                        const int acx = ax - halo;
                                        const int acz = az - halo;
                                        if (acx < 0 || acx >= WX || acz < 0 || acz >= WZ) {
                                            continue;
                                        }
                                        const size_t ai = static_cast<size_t>(((acz >> 1) * BY + (ay >> 1)) * BX + (acx >> 1));
                                        srcR[ai] += c.x * expW;
                                        srcG[ai] += c.y * expW;
                                        srcB[ai] += c.z * expW;
                                    }
                                }
                            }
                        }
                    }
                } else if (gy == WATER_Y && world.IsBrook(gx, gz)) {
                    srcR[bi] += 0.14f * 0.38f;
                    srcG[bi] += 0.60f * 0.38f;
                    srcB[bi] += 0.90f * 0.38f;
                }
            }
        }
    }

    for (size_t i = 0; i < kTotal; ++i) {
        solidWall[i] = occCnt[i] >= 6 ? 1 : 0;
        srcR[i] = std::min(1.4f, srcR[i]);
        srcG[i] = std::min(1.4f, srcG[i]);
        srcB[i] = std::min(1.4f, srcB[i]);
    }

    std::vector<float> dstR(kTotal, 0.0f), dstG(kTotal, 0.0f), dstB(kTotal, 0.0f), dstE(kTotal, 0.0f);
    constexpr int strideZ = BX * BY;

    for (int pass = 0; pass < 6; ++pass) {
        for (int z = 0; z < BZ; ++z) {
            for (int y = 0; y < BY; ++y) {
                const int row = (z * BY + y) * BX;
                for (int x = 0; x < BX; ++x) {
                    const size_t i = static_cast<size_t>(row + x);
                    if (solidWall[i]) {
                        dstR[i] = srcR[i];
                        dstG[i] = srcG[i];
                        dstB[i] = srcB[i];
                        dstE[i] = srcE[i];
                        continue;
                    }

                    float sr = srcR[i], sg = srcG[i], sb = srcB[i], se = srcE[i];
                    float cnt = 1.0f;
                    auto checkNb = [&](size_t ni) {
                        if (solidWall[ni]) {
                            return;
                        }
                        sr += srcR[ni];
                        sg += srcG[ni];
                        sb += srcB[ni];
                        se += srcE[ni];
                        cnt += 1.0f;
                    };
                    if (x > 0) checkNb(i - 1);
                    if (x < BX - 1) checkNb(i + 1);
                    if (y > 0) checkNb(i - BX);
                    if (y < BY - 1) checkNb(i + BX);
                    if (z > 0) checkNb(i - static_cast<size_t>(strideZ));
                    if (z < BZ - 1) checkNb(i + static_cast<size_t>(strideZ));

                    const float inv = 0.89f / cnt;
                    dstR[i] = std::max(srcR[i] * 0.55f, sr * inv);
                    dstG[i] = std::max(srcG[i] * 0.55f, sg * inv);
                    dstB[i] = std::max(srcB[i] * 0.55f, sb * inv);
                    dstE[i] = std::max(srcE[i] * 0.62f, se * (0.87f / cnt));
                }
            }
        }
        srcR.swap(dstR);
        srcG.swap(dstG);
        srcB.swap(dstB);
        srcE.swap(dstE);
    }

    out.bleedWidth = BX;
    out.bleedHeight = BY;
    out.bleedDepth = BZ;
    out.bleedRGBA.assign(kTotal * 4, 0);
    for (size_t i = 0; i < kTotal; ++i) {
        const size_t j = i * 4;
        out.bleedRGBA[j + 0] = static_cast<uint8_t>(std::min(255.0f, std::round((srcR[i] / 1.4f) * 255.0f)));
        out.bleedRGBA[j + 1] = static_cast<uint8_t>(std::min(255.0f, std::round((srcG[i] / 1.4f) * 255.0f)));
        out.bleedRGBA[j + 2] = static_cast<uint8_t>(std::min(255.0f, std::round((srcB[i] / 1.4f) * 255.0f)));
        out.bleedRGBA[j + 3] = static_cast<uint8_t>(std::min(255.0f, std::round(std::min(1.0f, srcE[i]) * 255.0f)));
    }
}

void BuildWaterMesh(const World& world, BakeResult& out) {
    const int halo = world.Halo();
    auto rawDepth = [&](int cx, int cz) {
        const int vx = cx + halo;
        const int vz = cz + halo;
        if (vx < 0 || vx >= world.VX() || vz < 0 || vz >= world.VZ()) {
            return 0.9f;
        }
        return world.IsBrook(vx, vz)
            ? std::max(0.65f, static_cast<float>(WATER_Y - world.GroundY(vx, vz)))
            : 0.25f;
    };

    auto cornerInfo = [&](int cx, int cz, int dx, int dz, float& depth, float& shore) {
        float sum = 0.0f;
        int edgeCnt = 0;
        for (int oz = -1; oz <= 0; ++oz) {
            for (int ox = -1; ox <= 0; ++ox) {
                const int gx = cx + dx + ox;
                const int gz = cz + dz + oz;
                sum += rawDepth(gx, gz);
                const int vx = gx + halo;
                const int vz = gz + halo;
                if (vx < 0 || vx >= world.VX() || vz < 0 || vz >= world.VZ()
                    || !world.IsBrook(vx, vz)) {
                    ++edgeCnt;
                }
            }
        }
        depth = sum / 4.0f;
        shore = edgeCnt > 0 ? 1.0f : 0.0f;
    };

    const Vec3 waterColor = World::Palette(Material::Water);
    constexpr int kCorners[4][2] = {{0, 0}, {1, 0}, {1, 1}, {0, 1}};

    for (int z = 0; z < WZ; ++z) {
        for (int x = 0; x < WX; ++x) {
            if (!world.IsBrook(x + halo, z + halo)) {
                continue;
            }
            const uint32_t base = static_cast<uint32_t>(out.waterVertices.size());
            const float x0 = static_cast<float>(x) - WX * 0.5f;
            const float z0 = static_cast<float>(z) - WZ * 0.5f;
            const float y0 = static_cast<float>(WATER_Y) + 0.14f;

            for (const auto& c : kCorners) {
                float depth = 0.0f;
                float shore = 0.0f;
                cornerInfo(x, z, c[0], c[1], depth, shore);
                out.waterVertices.push_back(WaterVertex{
                    Vec3{x0 + static_cast<float>(c[0]), y0, z0 + static_cast<float>(c[1])},
                    waterColor, depth, shore});
            }

            out.waterIndices.push_back(base + 0);
            out.waterIndices.push_back(base + 2);
            out.waterIndices.push_back(base + 1);
            out.waterIndices.push_back(base + 0);
            out.waterIndices.push_back(base + 3);
            out.waterIndices.push_back(base + 2);
        }
    }
}

} // namespace

BakeResult BakeWorld(const World& world, BakeQuality quality) {
    BakeResult out;
    out.filledVoxels = world.FilledVoxelCount();
    const int VX = world.VX();
    const int VZ = world.VZ();
    const int halo = world.Halo();

    // 顶面实体掩码 (外扩范围, 供每列顶部遮蔽使用); 同时记录含 Glow 的最高实体,
    // 用于跳过上空不可能产生面的切片 (典型草甸块可省掉约 2/3 的候选遍历)。
    std::vector<int16_t> topSolidY(static_cast<size_t>(VX) * VZ, -1);
    int maxSolidY = -1;
    for (int z = 0; z < VZ; ++z) {
        for (int x = 0; x < VX; ++x) {
            for (int y = WY - 1; y >= 0; --y) {
                const Material m = world.At(x, y, z);
                if (m == Material::Empty) {
                    continue;
                }
                maxSolidY = std::max(maxSolidY, y);
                if (m != Material::Glow) {
                    topSolidY[static_cast<size_t>(z) * VX + x] = static_cast<int16_t>(y);
                    break;
                }
            }
        }
    }

    std::vector<uint8_t> sliceMat(static_cast<size_t>(kMaxSlice), 0);
    std::vector<float> sliceVis(static_cast<size_t>(kMaxSlice), 1.0f);
    std::vector<float> sliceOrigVis(static_cast<size_t>(kMaxSlice), 1.0f);
    std::vector<float> slicePagodaVis(static_cast<size_t>(kMaxSlice), 1.0f);
    std::vector<float> sliceBentX(static_cast<size_t>(kMaxSlice), 0.0f);
    std::vector<float> sliceBentY(static_cast<size_t>(kMaxSlice), 0.0f);
    std::vector<float> sliceBentZ(static_cast<size_t>(kMaxSlice), 0.0f);
    std::vector<float> sliceElev(static_cast<size_t>(kMaxSlice), 0.5f);
    std::vector<float> sliceGndProx(static_cast<size_t>(kMaxSlice), 0.0f);
    std::vector<float> sliceWatProx(static_cast<size_t>(kMaxSlice), 0.0f);

    const int dims[3] = {VX, WY, VZ};
    const int coreDims[3] = {WX, WY, WZ};
    const int coreOff[3] = {halo, 0, halo};

    for (int d = 0; d < 6; ++d) {
        const FaceDir& dir = kDirs[d];
        const int nx = static_cast<int>(dir.nx);
        const int ny = static_cast<int>(dir.ny);
        const int nz = static_cast<int>(dir.nz);

        const int padDimU = dims[dir.uAxis];
        const int padDimV = dims[dir.vAxis];
        const int usedCount = padDimU * padDimV;
        const int coreDimA = coreDims[dir.axis];
        const int coreDimU = coreDims[dir.uAxis];
        const int coreDimV = coreDims[dir.vAxis];
        const int offA = coreOff[dir.axis];
        const int offU = coreOff[dir.uAxis];
        const int offV = coreOff[dir.vAxis];

        // 只需为“核心 + 1 格外圈”的 u/v 面烘焙角点插值数据;
        // 更远的外扩体素仍参与射线查询, 但不需逐面结果。
        const int uBegin = std::max(0, offU - 1);
        const int uEnd = std::min(padDimU - 1, offU + coreDimU);
        const int vBegin = std::max(0, offV - 1);
        int vEnd = std::min(padDimV - 1, offV + coreDimV);
        if (dir.vAxis == 1 && maxSolidY >= 0) {
            vEnd = std::min(vEnd, maxSolidY + 1); // 上空无实体, 无需遍历
        }

        for (int sliceCore = 0; sliceCore < coreDimA; ++sliceCore) {
            const int slice = offA + sliceCore;
            if (dir.axis == 1 && slice > maxSolidY) {
                continue; // 顶部以上没有面
            }

            // X/Z 立面: 地表以下全部为实体, 只在最低地表-1 以上可能产生可见面。
            int sliceVBegin = vBegin;
            if (dir.vAxis == 1) {
                int minGround = WY;
                for (int pu = uBegin; pu <= uEnd; ++pu) {
                    const int gx = (dir.axis == 0) ? slice : pu;
                    const int gz = (dir.uAxis == 2) ? pu : slice;
                    minGround = std::min(minGround, static_cast<int>(world.GroundY(gx, gz)));
                }
                sliceVBegin = std::max(sliceVBegin, minGround - 1);
            }

            std::fill_n(sliceMat.begin(), usedCount, 0);
            std::fill_n(sliceVis.begin(), usedCount, 1.0f);
            std::fill_n(sliceOrigVis.begin(), usedCount, 1.0f);
            std::fill_n(slicePagodaVis.begin(), usedCount, 1.0f);
            std::fill_n(sliceBentX.begin(), usedCount, dir.nx);
            std::fill_n(sliceBentY.begin(), usedCount, dir.ny);
            std::fill_n(sliceBentZ.begin(), usedCount, dir.nz);
            std::fill_n(sliceElev.begin(), usedCount, 0.5f);
            std::fill_n(sliceGndProx.begin(), usedCount, 0.0f);
            std::fill_n(sliceWatProx.begin(), usedCount, 0.0f);

            // Pass 1: 本切片 (核心 + 1 格外圈) 的可见面元数据
            for (int pv = sliceVBegin; pv <= vEnd; ++pv) {
                for (int pu = uBegin; pu <= uEnd; ++pu) {
                    int p[3] = {0, 0, 0};
                    p[dir.axis] = slice;
                    p[dir.uAxis] = pu;
                    p[dir.vAxis] = pv;

                    const Material mat = world.At(p[0], p[1], p[2]);
                    if (mat == Material::Empty) {
                        continue;
                    }

                    int n[3] = {p[0], p[1], p[2]};
                    n[dir.axis] += dir.sign;
                    if (world.IsSolid(n[0], n[1], n[2])) {
                        continue;
                    }

                    const size_t k = static_cast<size_t>(pv) * padDimU + pu;
                    sliceMat[k] = static_cast<uint8_t>(mat);
                    sliceElev[k] = ComputeLocalElev(world, p[0], p[1], p[2], mat);
                    sliceGndProx[k] = world.GroundProximity(p[0], p[1], p[2]);

                    if (World::IsLeaf(mat)) {
                        int leafDepth = 0;
                        for (int step = 1; step <= 5; ++step) {
                            if (!World::IsLeaf(world.At(p[0] - nx * step, p[1] - ny * step, p[2] - nz * step))) {
                                break;
                            }
                            ++leafDepth;
                        }
                        int airSides = 0;
                        if (world.At(p[0] + 1, p[1], p[2]) == Material::Empty) ++airSides;
                        if (world.At(p[0] - 1, p[1], p[2]) == Material::Empty) ++airSides;
                        if (world.At(p[0], p[1] + 1, p[2]) == Material::Empty) ++airSides;
                        if (world.At(p[0], p[1] - 1, p[2]) == Material::Empty) ++airSides;
                        if (world.At(p[0], p[1], p[2] + 1) == Material::Empty) ++airSides;
                        if (world.At(p[0], p[1], p[2] - 1) == Material::Empty) ++airSides;
                        sliceWatProx[k] = Clamp(
                            (static_cast<float>(leafDepth) - static_cast<float>(std::max(0, airSides - 1)) * 0.45f) / 4.2f,
                            0.0f, 1.0f);
                    } else {
                        sliceWatProx[k] = world.WaterProximity(p[0], p[1], p[2]);
                    }

                    if (mat == Material::Glow) {
                        sliceVis[k] = 1.0f;
                        sliceOrigVis[k] = 1.0f;
                        slicePagodaVis[k] = 1.0f;
                        sliceBentX[k] = dir.nx;
                        sliceBentY[k] = dir.ny;
                        sliceBentZ[k] = dir.nz;
                    } else {
                        const int topY = topSolidY[static_cast<size_t>(p[2]) * VX + p[0]];
                        const SkySample sample = ComputeSky(world, p, nx, ny, nz, true, topY, quality);
                        sliceVis[k] = sample.smoothVis;
                        sliceOrigVis[k] = sample.origVis;
                        slicePagodaVis[k] = sample.pagodaVis;
                        sliceBentX[k] = sample.bent.x;
                        sliceBentY[k] = sample.bent.y;
                        sliceBentZ[k] = sample.bent.z;
                    }
                }
            }

            // Pass 2: 只发射核心 80x80 区域的四边形
            for (int v = 0; v < coreDimV; ++v) {
                const int pv = offV + v;
                for (int u = 0; u < coreDimU; ++u) {
                    const int pu = offU + u;
                    const size_t k = static_cast<size_t>(pv) * padDimU + pu;
                    const Material mat = static_cast<Material>(sliceMat[k]);
                    if (mat == Material::Empty) {
                        continue;
                    }

                    int p[3] = {0, 0, 0};
                    p[dir.axis] = slice;
                    p[dir.uAxis] = pu;
                    p[dir.vAxis] = pv;

                    const bool isGlow = mat == Material::Glow;
                    const bool isLeafMat = World::IsLeaf(mat);
                    const float matKind = isGlow ? 3.0f : (isLeafMat ? 2.0f : (mat == Material::Roof ? 1.0f : 0.0f));
                    const int topY = topSolidY[static_cast<size_t>(p[2]) * VX + p[0]];
                    const float topBlocked = (p[1] < topY) ? 0.56f : 1.0f;
                    const float faceOrigVis = sliceOrigVis[k];

                    auto cornerAvg = [&](const std::vector<float>& arr, int du, int dv, bool quantize12) {
                        if (isGlow) {
                            return 1.0f;
                        }
                        float sum = arr[k];
                        int cnt = 1;
                        const int u2 = pu + du;
                        const int v2 = pv + dv;
                        if (u2 >= 0 && u2 < padDimU && sliceMat[static_cast<size_t>(pv) * padDimU + u2] != 0) {
                            sum += arr[static_cast<size_t>(pv) * padDimU + u2];
                            ++cnt;
                        }
                        if (v2 >= 0 && v2 < padDimV && sliceMat[static_cast<size_t>(v2) * padDimU + pu] != 0) {
                            sum += arr[static_cast<size_t>(v2) * padDimU + pu];
                            ++cnt;
                        }
                        if (u2 >= 0 && u2 < padDimU && v2 >= 0 && v2 < padDimV
                            && sliceMat[static_cast<size_t>(v2) * padDimU + u2] != 0) {
                            sum += arr[static_cast<size_t>(v2) * padDimU + u2];
                            ++cnt;
                        }
                        const float avg = sum / static_cast<float>(cnt);
                        return quantize12 ? Quantize12(avg) : avg;
                    };

                    auto cornerAvgSame = [&](const std::vector<float>& arr, int du, int dv) {
                        float sum = arr[k];
                        int cnt = 1;
                        const int u2 = pu + du;
                        const int v2 = pv + dv;
                        if (u2 >= 0 && u2 < padDimU
                            && sliceMat[static_cast<size_t>(pv) * padDimU + u2] == static_cast<uint8_t>(mat)) {
                            sum += arr[static_cast<size_t>(pv) * padDimU + u2];
                            ++cnt;
                        }
                        if (v2 >= 0 && v2 < padDimV
                            && sliceMat[static_cast<size_t>(v2) * padDimU + pu] == static_cast<uint8_t>(mat)) {
                            sum += arr[static_cast<size_t>(v2) * padDimU + pu];
                            ++cnt;
                        }
                        if (u2 >= 0 && u2 < padDimU && v2 >= 0 && v2 < padDimV
                            && sliceMat[static_cast<size_t>(v2) * padDimU + u2] == static_cast<uint8_t>(mat)) {
                            sum += arr[static_cast<size_t>(v2) * padDimU + u2];
                            ++cnt;
                        }
                        return sum / static_cast<float>(cnt);
                    };

                    const int aoInt00 = CornerAO(world, p, dir.axis, dir.sign, dir.uAxis, dir.vAxis, -1, -1);
                    const int aoInt10 = CornerAO(world, p, dir.axis, dir.sign, dir.uAxis, dir.vAxis, 1, -1);
                    const int aoInt11 = CornerAO(world, p, dir.axis, dir.sign, dir.uAxis, dir.vAxis, 1, 1);
                    const int aoInt01 = CornerAO(world, p, dir.axis, dir.sign, dir.uAxis, dir.vAxis, -1, 1);

                    const float ao00 = static_cast<float>(aoInt00) / 3.0f;
                    const float ao10 = static_cast<float>(aoInt10) / 3.0f;
                    const float ao11 = static_cast<float>(aoInt11) / 3.0f;
                    const float ao01 = static_cast<float>(aoInt01) / 3.0f;
                    const float pao00 = kAoFactors[aoInt00];
                    const float pao10 = kAoFactors[aoInt10];
                    const float pao11 = kAoFactors[aoInt11];
                    const float pao01 = kAoFactors[aoInt01];

                    const float sv00 = cornerAvg(sliceVis, -1, -1, false);
                    const float sv10 = cornerAvg(sliceVis, 1, -1, false);
                    const float sv11 = cornerAvg(sliceVis, 1, 1, false);
                    const float sv01 = cornerAvg(sliceVis, -1, 1, false);

                    const float pv00 = cornerAvg(slicePagodaVis, -1, -1, true);
                    const float pv10 = cornerAvg(slicePagodaVis, 1, -1, true);
                    const float pv11 = cornerAvg(slicePagodaVis, 1, 1, true);
                    const float pv01 = cornerAvg(slicePagodaVis, -1, 1, true);

                    auto cornerBent = [&](int du, int dv) {
                        if (isGlow) {
                            return Vec3{dir.nx, dir.ny, dir.nz};
                        }
                        const float bx = cornerAvg(sliceBentX, du, dv, false);
                        const float by = cornerAvg(sliceBentY, du, dv, false);
                        const float bz = cornerAvg(sliceBentZ, du, dv, false);
                        const float len = std::sqrt(bx * bx + by * by + bz * bz);
                        return len > 1e-6f ? Vec3{bx / len, by / len, bz / len} : Vec3{dir.nx, dir.ny, dir.nz};
                    };
                    const Vec3 bn00 = cornerBent(-1, -1);
                    const Vec3 bn10 = cornerBent(1, -1);
                    const Vec3 bn11 = cornerBent(1, 1);
                    const Vec3 bn01 = cornerBent(-1, 1);

                    const float el00 = cornerAvgSame(sliceElev, -1, -1);
                    const float el10 = cornerAvgSame(sliceElev, 1, -1);
                    const float el11 = cornerAvgSame(sliceElev, 1, 1);
                    const float el01 = cornerAvgSame(sliceElev, -1, 1);

                    const float gp00 = cornerAvg(sliceGndProx, -1, -1, false);
                    const float gp10 = cornerAvg(sliceGndProx, 1, -1, false);
                    const float gp11 = cornerAvg(sliceGndProx, 1, 1, false);
                    const float gp01 = cornerAvg(sliceGndProx, -1, 1, false);

                    const float wp00 = cornerAvg(sliceWatProx, -1, -1, false);
                    const float wp10 = cornerAvg(sliceWatProx, 1, -1, false);
                    const float wp11 = cornerAvg(sliceWatProx, 1, 1, false);
                    const float wp01 = cornerAvg(sliceWatProx, -1, 1, false);

                    const float flowMatId = isLeafMat ? 1.0f
                        : (mat == Material::Trunk || mat == Material::Timber) ? 2.0f
                        : (mat == Material::Wall) ? 3.0f
                        : (mat == Material::Roof) ? 4.0f
                        : (mat == Material::Stone) ? 5.0f
                        : (mat == Material::Dirt) ? 6.0f
                        : (mat == Material::FlowerWhite || mat == Material::FlowerYellow) ? 7.0f
                        : (mat == Material::Glow) ? 8.0f : 0.0f;

                    const Vec3 matColor = World::Palette(mat);
                    const Vec3 uniformColor = isLeafMat ? World::Palette(Material::Leaf) : matColor;
                    const Vec3 normal{dir.nx, dir.ny, dir.nz};

                    int cp[3] = {p[0] - coreOff[0], p[1] - coreOff[1], p[2] - coreOff[2]};
                    auto makeVert = [&](int du, int dv) {
                        Vec3 vp{static_cast<float>(cp[0]) - WX * 0.5f,
                                static_cast<float>(cp[1]),
                                static_cast<float>(cp[2]) - WZ * 0.5f};
                        Axis(vp, dir.axis) += dir.sign > 0 ? 1.0f : 0.0f;
                        Axis(vp, dir.uAxis) += static_cast<float>(du);
                        Axis(vp, dir.vAxis) += static_cast<float>(dv);
                        return vp;
                    };

                    const Vec3 c00 = makeVert(0, 0);
                    const Vec3 c10 = makeVert(1, 0);
                    const Vec3 c11 = makeVert(1, 1);
                    const Vec3 c01 = makeVert(0, 1);

                    const Vec3 e1 = c10 - c00;
                    const Vec3 e2 = c11 - c00;
                    const float frontFacing = Dot(Cross(e1, e2), normal) > 0.0f;

                    const uint32_t baseVert = static_cast<uint32_t>(out.vertices.size());
                    struct CornerData {
                        Vec3 p;
                        int du;
                        int dv;
                        float ao;
                        float pao;
                        float sv;
                        float pv;
                        Vec3 bn;
                        float el;
                        float gp;
                        float wp;
                    };
                    const CornerData corners[4] = {
                        {c00, 0, 0, ao00, pao00, sv00, pv00, bn00, el00, gp00, wp00},
                        {c10, 1, 0, ao10, pao10, sv10, pv10, bn10, el10, gp10, wp10},
                        {c11, 1, 1, ao11, pao11, sv11, pv11, bn11, el11, gp11, wp11},
                        {c01, 0, 1, ao01, pao01, sv01, pv01, bn01, el01, gp01, wp01},
                    };

                    for (const CornerData& q : corners) {
                        VoxelVertex vert{};
                        vert.pos = q.p;
                        vert.normal = normal;
                        vert.biomeColor = uniformColor;
                        if (mat == Material::Grass) {
                            const int vx = static_cast<int>(std::lround(Clamp(q.p.x + WX * 0.5f, 0.0f, WX - 1.0f)))
                                + coreOff[0];
                            const int vz = static_cast<int>(std::lround(Clamp(q.p.z + WZ * 0.5f, 0.0f, WZ - 1.0f)))
                                + coreOff[2];
                            vert.biomeColor = world.BiomeColor(vx, vz);
                        }
                        vert.uniformColor = uniformColor;
                        vert.bentNormal = q.bn;
                        vert.flowMeta[0] = flowMatId;
                        vert.flowMeta[1] = q.el;
                        vert.flowMeta[2] = q.gp;
                        vert.flowMeta[3] = q.wp;
                        vert.sky[0] = faceOrigVis;
                        vert.sky[1] = q.sv;
                        vert.sky[2] = q.pv;
                        vert.sky[3] = topBlocked;
                        vert.shade[0] = q.ao;
                        vert.shade[1] = q.pao;
                        vert.shade[2] = dir.shade;
                        vert.shade[3] = matKind;
                        vert.uv[0] = static_cast<float>(q.du);
                        vert.uv[1] = static_cast<float>(q.dv);
                        out.vertices.push_back(vert);
                    }

                    const float diagA = (ao00 + ao11) + (sv00 + sv11) * 2.0f;
                    const float diagB = (ao10 + ao01) + (sv10 + sv01) * 2.0f;
                    const bool flipDiag = diagA < diagB;

                    if (frontFacing) {
                        if (!flipDiag) {
                            out.indices.insert(out.indices.end(), {baseVert, baseVert + 1, baseVert + 2});
                            out.indices.insert(out.indices.end(), {baseVert, baseVert + 2, baseVert + 3});
                        } else {
                            out.indices.insert(out.indices.end(), {baseVert + 1, baseVert + 2, baseVert + 3});
                            out.indices.insert(out.indices.end(), {baseVert + 1, baseVert + 3, baseVert});
                        }
                    } else {
                        if (!flipDiag) {
                            out.indices.insert(out.indices.end(), {baseVert, baseVert + 2, baseVert + 1});
                            out.indices.insert(out.indices.end(), {baseVert, baseVert + 3, baseVert + 2});
                        } else {
                            out.indices.insert(out.indices.end(), {baseVert + 1, baseVert + 3, baseVert + 2});
                            out.indices.insert(out.indices.end(), {baseVert + 1, baseVert, baseVert + 3});
                        }
                    }
                }
            }
        }
    }

    out.triangles = static_cast<int>(out.indices.size() / 3);
    if (quality == BakeQuality::Full) {
        BuildBleedVolume(world, out);
    } else {
        // 预取 LOD: 3D 彩光体积退化为 1x1x1 常量, 省去洪泛填充与 512KB 纹理;
        // 远处由雾效主导, 升级为完整质量时恢复局部彩光。
        out.bleedWidth = 1;
        out.bleedHeight = 1;
        out.bleedDepth = 1;
        out.bleedRGBA = {96, 96, 96, 0};
    }
    BuildWaterMesh(world, out);
    return out;
}

} // namespace sw
