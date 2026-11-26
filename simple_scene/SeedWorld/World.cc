// ============================================================================
// World.cc — SeedWorld 流送分块的世界构建
// ----------------------------------------------------------------------------
// 地形、溪流与生物群系色场都是全局解析函数; 分块只决定采样窗口。
// 英雄区特征 (大树/小屋/两棵伴生树苗/野花) 使用全局坐标放置, 任何分块
// 只要其外扩窗口与特征包围盒相交, 就会生成同一份体素, 因此射线查询在
// 分块边界完全一致。
// 非英雄分块由确定性哈希生成小树/树苗/石块/野花, 从而形成可无限延伸的
// SeedWorld 田园世界, 且同一分块坐标每次生成结果完全一致。
// ============================================================================
#include "World.h"

#include <algorithm>
#include <cmath>

namespace sw {
namespace {

int RoundIndex(double v) {
    return static_cast<int>(std::lround(v));
}

uint32_t Hash32(int x, int z, uint32_t salt) {
    uint32_t h = static_cast<uint32_t>(x) * 0x8DA6B343u;
    h ^= static_cast<uint32_t>(z) * 0xD8163841u;
    h ^= salt * 0xCB1AB31Fu;
    h ^= h >> 16;
    h *= 0x7FEB352Du;
    h ^= h >> 15;
    h *= 0x846CA68Bu;
    h ^= h >> 16;
    return h;
}

} // namespace

World::World(int originX, int originZ, const TerrainSource& terrain, int halo)
    : terrain_(terrain), originX_(originX), originZ_(originZ), halo_(halo) {
    vx_ = WX + 2 * halo_;
    vz_ = WZ + 2 * halo_;
}

Material World::At(int vx, int vy, int vz) const {
    if (!InBounds(vx, vy, vz)) {
        return Material::Empty;
    }
    return static_cast<Material>(grid_[static_cast<size_t>((vy * vz_ + vz) * vx_ + vx)]);
}

Material World::AtGlobal(int gx, int gy, int gz) const {
    return At(gx - originX_ + halo_, gy, gz - originZ_ + halo_);
}

void World::SetVoxelGlobal(int gx, int gy, int gz, Material mat) {
    const int vx = gx - originX_ + halo_;
    const int vz = gz - originZ_ + halo_;
    if (vx < 0 || vx >= vx_ || gy < 0 || gy >= WY || vz < 0 || vz >= vz_) {
        return;
    }
    grid_[static_cast<size_t>((gy * vz_ + vz) * vx_ + vx)] = static_cast<uint8_t>(mat);
}

void World::FillBoxGlobal(int x0, int y0, int z0, int x1, int y1, int z1, Material mat) {
    x0 = std::max(x0, originX_ - halo_);
    x1 = std::min(x1, originX_ + WX - 1 + halo_);
    z0 = std::max(z0, originZ_ - halo_);
    z1 = std::min(z1, originZ_ + WZ - 1 + halo_);
    y0 = std::max(y0, 0);
    y1 = std::min(y1, WY - 1);
    if (x0 > x1 || y0 > y1 || z0 > z1) {
        return;
    }
    for (int y = y0; y <= y1; ++y) {
        for (int z = z0; z <= z1; ++z) {
            const int vz = z - originZ_ + halo_;
            for (int x = x0; x <= x1; ++x) {
                const int vx = x - originX_ + halo_;
                grid_[static_cast<size_t>((y * vz_ + vz) * vx_ + vx)] = static_cast<uint8_t>(mat);
            }
        }
    }
}

bool World::IntersectsVolume(int gx0, int gx1, int gz0, int gz1) const {
    return gx1 >= originX_ - halo_ && gx0 <= originX_ + WX - 1 + halo_
        && gz1 >= originZ_ - halo_ && gz0 <= originZ_ + WZ - 1 + halo_;
}

int World::GroundHeightGlobal(int gx, int gz) const {
    return terrain_.HeightAt(gx, gz);
}

float World::SlopeGlobal(int gx, int gz) const {
    const int h = terrain_.HeightAt(gx, gz);
    const int hx = terrain_.HeightAt(gx + 1, gz);
    const int hz = terrain_.HeightAt(gx, gz + 1);
    return static_cast<float>(std::max(std::abs(hx - h), std::abs(hz - h)));
}

Vec3 World::Palette(Material mat) {
    return HexToLinear(PaletteHex(mat));
}

uint32_t World::PaletteHex(Material mat) {
    switch (mat) {
        case Material::Grass:        return 0x59a645;
        case Material::Dirt:         return 0x7a5538;
        case Material::Stone:        return 0x8f979e;
        case Material::Trunk:        return 0x6e472b;
        case Material::Leaf:         return 0x82c928;
        case Material::LeafAutumn:   return 0xd96426;
        case Material::LeafPine:     return 0x28844c;
        case Material::Wall:         return 0xece2cf;
        case Material::Roof:         return 0xb7543e;
        case Material::Timber:       return 0x8a5834;
        case Material::Glow:         return 0xffd888;
        case Material::FlowerWhite:  return 0xf7f2e8;
        case Material::FlowerYellow: return 0xf2c84b;
        case Material::Water:        return 0x3393b5;
        case Material::Snow:         return 0xedf2f7;
        case Material::Rock:         return 0x6f6a63;
        default:                     return 0x000000;
    }
}

float World::GroundProximity(int vx, int vy, int vz) const {
    const int ex = vx >> 1, ey = vy >> 1, ez = vz >> 1;
    return groundProx_[static_cast<size_t>((ey * (vz_ / 2) + ez) * (vx_ / 2) + ex)];
}

float World::WaterProximity(int vx, int vy, int vz) const {
    const int ex = vx >> 1, ey = vy >> 1, ez = vz >> 1;
    return waterProx_[static_cast<size_t>((ey * (vz_ / 2) + ez) * (vx_ / 2) + ex)];
}

void World::Build() {
    grid_.assign(static_cast<size_t>(vx_) * WY * vz_, static_cast<uint8_t>(Material::Empty));
    groundY_.assign(static_cast<size_t>(vx_) * vz_, 0);
    brookMask_.assign(static_cast<size_t>(vx_) * vz_, 0);
    biomeColor_.assign(static_cast<size_t>(vx_) * vz_, Vec3{});

    BuildTerrain();
    BuildHeroFeatures();
    BuildProceduralFeatures();
    BuildProximityVolumes();
    BuildBiomeColors();

    filledCore_ = 0;
    for (int z = halo_; z < halo_ + WZ; ++z) {
        for (int x = halo_; x < halo_ + WX; ++x) {
            for (int y = 0; y < WY; ++y) {
                if (grid_[static_cast<size_t>(y * vz_ + z) * vx_ + x] != 0) {
                    ++filledCore_;
                }
            }
        }
    }
}

void World::BuildTerrain() {
    // 第一遍: 采样全局高度 (外扩范围, 供坡度和邻居查询)。
    for (int vz = 0; vz < vz_; ++vz) {
        const int gz = originZ_ + vz - halo_;
        for (int vx = 0; vx < vx_; ++vx) {
            const int gx = originX_ + vx - halo_;
            const int height = terrain_.HeightAt(gx, gz);
            const size_t col = static_cast<size_t>(vz) * vx_ + vx;
            groundY_[col] = static_cast<int16_t>(height);
            if (height <= WATER_Y - 1) {
                brookMask_[col] = 1;
            }
        }
    }

    // 第二遍: 根据坡度和高度选择顶面材质, 再填充体素柱。
    for (int vz = 0; vz < vz_; ++vz) {
        const int gz = originZ_ + vz - halo_;
        for (int vx = 0; vx < vx_; ++vx) {
            const int gx = originX_ + vx - halo_;
            const int height = groundY_[static_cast<size_t>(vz) * vx_ + vx];
            const int hx = groundY_[static_cast<size_t>(vz) * vx_ + std::min(vx + 1, vx_ - 1)];
            const int hz = groundY_[static_cast<size_t>(std::min(vz + 1, vz_ - 1)) * vx_ + vx];
            const float slope = static_cast<float>(std::max(std::abs(hx - height), std::abs(hz - height)));
            const Material surface = terrain_.SurfaceAt(gx, gz, height, slope);
            const bool rocky = surface == Material::Snow || surface == Material::Stone
                || surface == Material::Rock || height > 66;

            for (int y = 0; y <= height; ++y) {
                Material mat = Material::Dirt;
                if (y == height) {
                    mat = surface;
                } else if (y < 5) {
                    mat = Material::Stone;
                } else if (rocky) {
                    mat = Material::Stone;
                }
                grid_[static_cast<size_t>((y * vz_ + vz) * vx_ + vx)] = static_cast<uint8_t>(mat);
            }
        }
    }
}

void World::BuildTree(int tx, int tz) {
    const int baseY = GroundHeightGlobal(tx, tz);
    const int trunkTop = baseY + 10;

    for (int dy = -1; dy <= 10; ++dy) {
        const float t = static_cast<float>(std::max(0, dy)) / 10.0f;
        const float rad = dy <= 1 ? 2.45f - static_cast<float>(dy) * 0.35f : 1.75f - t * 0.72f;
        const float cx = static_cast<float>(tx) + std::sin(t * 2.2f) * 1.1f;
        const float cz = static_cast<float>(tz) + std::cos(t * 1.8f) * 0.6f - 0.6f;
        const int rCeil = static_cast<int>(std::ceil(rad + 0.5f));

        for (int ox = -rCeil; ox <= rCeil; ++ox) {
            for (int oz = -rCeil; oz <= rCeil; ++oz) {
                const float dist = std::hypot(static_cast<float>(ox), static_cast<float>(oz));
                float flare = 0.0f;
                if (dy <= 2) {
                    flare = std::cos(std::atan2(static_cast<float>(oz), static_cast<float>(ox)) * 4.0f)
                        * (0.55f * (1.0f - static_cast<float>(std::max(0, dy)) / 2.5f));
                }
                if (dist <= rad + flare) {
                    SetVoxelGlobal(RoundIndex(cx + static_cast<float>(ox)), baseY + dy,
                                   RoundIndex(cz + static_cast<float>(oz)), Material::Trunk);
                }
            }
        }
    }

    auto placeFoliageBough = [&](float cx, float cy, float cz, float rx, float ry, float rz, float seedOffset) {
        const int bx = static_cast<int>(std::ceil(rx + 1.0f));
        const int by = static_cast<int>(std::ceil(ry + 1.0f));
        const int bz = static_cast<int>(std::ceil(rz + 1.0f));
        for (int y = -by; y <= by; ++y) {
            for (int z = -bz; z <= bz; ++z) {
                for (int x = -bx; x <= bx; ++x) {
                    const float nx = static_cast<float>(x) / rx;
                    const float ny = static_cast<float>(y) / ry;
                    const float nz = static_cast<float>(z) / rz;
                    const float d2 = nx * nx + ny * ny + nz * nz;
                    const float ang = std::atan2(static_cast<float>(z), static_cast<float>(x));
                    const float lobe = 0.08f * std::sin(ang * 3.0f + seedOffset)
                        + 0.06f * std::cos((static_cast<float>(y) + seedOffset) * 1.1f);
                    if (d2 > 1.0f + lobe) {
                        continue;
                    }
                    const int vx = RoundIndex(cx + static_cast<float>(x));
                    const int vy = RoundIndex(cy + static_cast<float>(y));
                    const int vz = RoundIndex(cz + static_cast<float>(z));
                    if (AtGlobal(vx, vy, vz) != Material::Trunk) {
                        SetVoxelGlobal(vx, vy, vz, Material::Leaf);
                    }
                }
            }
        }
    };

    auto drawBranch = [&](float x0, float y0, float z0, float x1, float y1, float z1) {
        constexpr int kSteps = 18;
        for (int i = 0; i <= kSteps; ++i) {
            const float u = static_cast<float>(i) / static_cast<float>(kSteps);
            const float bx = x0 + (x1 - x0) * u;
            const float by = y0 + (y1 - y0) * u - std::sin(u * kPi) * 0.6f;
            const float bz = z0 + (z1 - z0) * u;
            const int thick = u < 0.5f ? 1 : 0;
            for (int ox = 0; ox <= thick; ++ox) {
                for (int oz = 0; oz <= thick; ++oz) {
                    SetVoxelGlobal(RoundIndex(bx + static_cast<float>(ox)), RoundIndex(by),
                                   RoundIndex(bz + static_cast<float>(oz)), Material::Trunk);
                }
            }
        }
    };

    struct Bough {
        float ang;
        float dist;
        float dy;
        float rx;
        float ry;
        float rz;
    };
    constexpr Bough kBoughs[6] = {
        {0.20f, 7.4f, 2.5f, 7.0f, 4.5f, 6.5f},
        {1.25f, 6.8f, 4.2f, 6.5f, 4.8f, 6.2f},
        {2.35f, 7.8f, 1.4f, 7.2f, 4.3f, 6.8f},
        {3.35f, 6.5f, 3.6f, 6.4f, 4.6f, 6.2f},
        {4.45f, 7.5f, 2.0f, 6.9f, 4.4f, 6.6f},
        {5.45f, 6.4f, 4.8f, 6.0f, 4.2f, 5.8f},
    };

    for (int idx = 0; idx < 6; ++idx) {
        const Bough& b = kBoughs[idx];
        const float bx = static_cast<float>(tx) + std::cos(b.ang) * b.dist;
        const float bz = static_cast<float>(tz) + std::sin(b.ang) * b.dist;
        const float by = static_cast<float>(trunkTop) + b.dy;
        drawBranch(static_cast<float>(tx), static_cast<float>(trunkTop - 2), static_cast<float>(tz),
                   bx - std::cos(b.ang) * 1.5f, by - 1.5f, bz - std::sin(b.ang) * 1.5f);
        placeFoliageBough(bx, by, bz, b.rx, b.ry, b.rz, static_cast<float>(idx) * 1.7f);
    }

    placeFoliageBough(static_cast<float>(tx), static_cast<float>(trunkTop) + 7.2f, static_cast<float>(tz),
                      7.6f, 5.0f, 7.4f, 9.1f);
    placeFoliageBough(static_cast<float>(tx) + 5.2f, static_cast<float>(trunkTop) + 0.5f,
                      static_cast<float>(tz) + 6.5f, 5.4f, 3.6f, 5.2f, 4.4f);
    placeFoliageBough(static_cast<float>(tx) - 6.0f, static_cast<float>(trunkTop) + 0.2f,
                      static_cast<float>(tz) + 4.8f, 5.0f, 3.4f, 4.8f, 7.2f);
}

void World::BuildCottage(int cx, int cz) {
    constexpr int baseY = 12;
    constexpr int halfW = 8;
    constexpr int halfD = 7;
    constexpr int wallH = 8;

    FillBoxGlobal(cx - halfW - 1, baseY - 2, cz - halfD - 1, cx + halfW + 1, baseY + 1, cz + halfD + 1,
                  Material::Stone);
    FillBoxGlobal(cx - 3, baseY, cz + halfD + 2, cx + 3, baseY + 1, cz + halfD + 4, Material::Stone);
    FillBoxGlobal(cx - 2, baseY, cz + halfD + 5, cx + 2, baseY, cz + halfD + 5, Material::Stone);

    FillBoxGlobal(cx - halfW, baseY + 2, cz - halfD, cx + halfW, baseY + 1 + wallH, cz + halfD, Material::Wall);
    FillBoxGlobal(cx - halfW + 1, baseY + 2, cz - halfD + 1, cx + halfW - 1, baseY + 1 + wallH, cz + halfD - 1,
                  Material::Empty);

    for (int sx : {-halfW, halfW}) {
        for (int sz : {-halfD, halfD}) {
            FillBoxGlobal(cx + sx, baseY + 2, cz + sz, cx + sx, baseY + 1 + wallH, cz + sz, Material::Trunk);
        }
    }
    for (int x = cx - halfW; x <= cx + halfW; ++x) {
        SetVoxelGlobal(x, baseY + 5, cz + halfD, Material::Trunk);
        SetVoxelGlobal(x, baseY + 5, cz - halfD, Material::Trunk);
        SetVoxelGlobal(x, baseY + 1 + wallH, cz + halfD, Material::Trunk);
        SetVoxelGlobal(x, baseY + 1 + wallH, cz - halfD, Material::Trunk);
    }
    for (int z = cz - halfD; z <= cz + halfD; ++z) {
        SetVoxelGlobal(cx - halfW, baseY + 5, z, Material::Trunk);
        SetVoxelGlobal(cx + halfW, baseY + 5, z, Material::Trunk);
        SetVoxelGlobal(cx - halfW, baseY + 1 + wallH, z, Material::Trunk);
        SetVoxelGlobal(cx + halfW, baseY + 1 + wallH, z, Material::Trunk);
    }
    for (int sx : {-3, 3}) {
        FillBoxGlobal(cx + sx, baseY + 5, cz + halfD, cx + sx, baseY + 1 + wallH, cz + halfD, Material::Trunk);
        FillBoxGlobal(cx + sx, baseY + 5, cz - halfD, cx + sx, baseY + 1 + wallH, cz - halfD, Material::Trunk);
    }

    const int roofStartY = baseY + 1 + wallH;
    const int peakSpan = halfD + 2;
    for (int step = 0; step <= peakSpan; ++step) {
        const int y = roofStartY + step;
        const int zMin = cz - (peakSpan - step);
        const int zMax = cz + (peakSpan - step);

        if (step > 0 && step < peakSpan) {
            for (int z = cz - (halfD - step); z <= cz + (halfD - step); ++z) {
                SetVoxelGlobal(cx - halfW, y, z, Material::Wall);
                SetVoxelGlobal(cx + halfW, y, z, Material::Wall);
            }
            SetVoxelGlobal(cx - halfW, y, cz, Material::Trunk);
            SetVoxelGlobal(cx + halfW, y, cz, Material::Trunk);
        }

        for (int x = cx - halfW - 2; x <= cx + halfW + 2; ++x) {
            SetVoxelGlobal(x, y, zMin, Material::Roof);
            SetVoxelGlobal(x, y, zMin + 1, Material::Roof);
            SetVoxelGlobal(x, y, zMax, Material::Roof);
            SetVoxelGlobal(x, y, zMax - 1, Material::Roof);
            if (step == 0 && (x - cx) % 4 == 0) {
                SetVoxelGlobal(x, y - 1, zMin, Material::Trunk);
                SetVoxelGlobal(x, y - 1, zMax, Material::Trunk);
            }
        }
    }
    FillBoxGlobal(cx - halfW - 2, roofStartY + peakSpan, cz, cx + halfW + 2, roofStartY + peakSpan, cz,
                  Material::Roof);

    const int porchY = baseY + 6;
    FillBoxGlobal(cx - 3, baseY + 2, cz + halfD + 3, cx - 3, porchY - 1, cz + halfD + 3, Material::Trunk);
    FillBoxGlobal(cx + 3, baseY + 2, cz + halfD + 3, cx + 3, porchY - 1, cz + halfD + 3, Material::Trunk);
    for (int dz = 1; dz <= 4; ++dz) {
        const int py = porchY + (dz <= 2 ? 1 : 0);
        FillBoxGlobal(cx - 4, py, cz + halfD + dz, cx + 4, py, cz + halfD + dz, Material::Roof);
    }
    SetVoxelGlobal(cx + 2, porchY - 1, cz + halfD + 2, Material::Timber);
    SetVoxelGlobal(cx + 2, porchY - 2, cz + halfD + 2, Material::Glow);

    FillBoxGlobal(cx - 1, baseY + 2, cz + halfD, cx + 1, baseY + 5, cz + halfD, Material::Empty);
    FillBoxGlobal(cx - 1, baseY + 2, cz + halfD - 1, cx + 1, baseY + 4, cz + halfD - 1, Material::Timber);
    SetVoxelGlobal(cx, baseY + 5, cz + halfD, Material::Timber);

    for (int wx : {cx - 5, cx + 5}) {
        FillBoxGlobal(wx - 1, baseY + 3, cz + halfD, wx + 1, baseY + 4, cz + halfD, Material::Empty);
        FillBoxGlobal(wx, baseY + 3, cz + halfD - 1, wx, baseY + 4, cz + halfD - 1, Material::Glow);
        SetVoxelGlobal(wx - 1, baseY + 3, cz + halfD, Material::Timber);
        SetVoxelGlobal(wx - 1, baseY + 4, cz + halfD, Material::Timber);
        SetVoxelGlobal(wx + 1, baseY + 3, cz + halfD, Material::Timber);
        SetVoxelGlobal(wx + 1, baseY + 4, cz + halfD, Material::Timber);
        FillBoxGlobal(wx - 1, baseY + 2, cz + halfD + 1, wx + 1, baseY + 2, cz + halfD + 1, Material::Timber);
    }

    for (int wz : {cz - 3, cz + 3}) {
        FillBoxGlobal(cx - halfW, baseY + 3, wz - 1, cx - halfW, baseY + 4, wz + 1, Material::Empty);
        FillBoxGlobal(cx - halfW + 1, baseY + 3, wz, cx - halfW + 1, baseY + 4, wz, Material::Glow);
        SetVoxelGlobal(cx - halfW, baseY + 3, wz - 1, Material::Timber);
        SetVoxelGlobal(cx - halfW, baseY + 4, wz - 1, Material::Timber);
        SetVoxelGlobal(cx - halfW, baseY + 3, wz + 1, Material::Timber);
        SetVoxelGlobal(cx - halfW, baseY + 4, wz + 1, Material::Timber);
        FillBoxGlobal(cx - halfW - 1, baseY + 2, wz - 1, cx - halfW - 1, baseY + 2, wz + 1, Material::Timber);
    }

    FillBoxGlobal(cx - halfW - 2, baseY + 2, cz - 1, cx - halfW - 1, baseY + 3, cz + 1, Material::Timber);
    SetVoxelGlobal(cx - halfW - 1, baseY + 4, cz, Material::Timber);

    FillBoxGlobal(cx + halfW - 1, baseY + 1, cz - 3, cx + halfW + 1, roofStartY + peakSpan + 3, cz - 1,
                  Material::Stone);
    FillBoxGlobal(cx + halfW - 2, roofStartY + peakSpan + 3, cz - 4, cx + halfW + 2, roofStartY + peakSpan + 3, cz,
                  Material::Stone);
    SetVoxelGlobal(cx + halfW, roofStartY + peakSpan + 4, cz - 2, Material::Stone);

    for (int x = cx - halfW - 3; x <= cx - 5; ++x) {
        const int fy = GroundHeightGlobal(x, cz + halfD + 4);
        SetVoxelGlobal(x, fy + 1, cz + halfD + 4, (x % 3 == 0) ? Material::Trunk : Material::Timber);
    }
    for (int x = cx + 5; x <= cx + halfW + 2; ++x) {
        const int fy = GroundHeightGlobal(x, cz + halfD + 4);
        SetVoxelGlobal(x, fy + 1, cz + halfD + 4, (x % 3 == 0) ? Material::Trunk : Material::Timber);
    }

    constexpr int kPath[][2] = {
        {52, 48}, {50, 50}, {47, 51}, {44, 52},
        {40, 51}, {36, 49}, {33, 47}, {29, 45},
    };
    for (const auto& pt : kPath) {
        for (int ox = 0; ox <= 1; ++ox) {
            for (int oz = 0; oz <= 1; ++oz) {
                const int px = pt[0] + ox;
                const int pz = pt[1] + oz;
                const int h = GroundHeightGlobal(px, pz);
                if (h > WATER_Y - 1) {
                    SetVoxelGlobal(px, h, pz, Material::Stone);
                }
            }
        }
    }
}

void World::BuildSapling(int tx, int tz, Material leafMat) {
    const int baseY = GroundHeightGlobal(tx, tz);
    if (baseY > 120 || baseY <= WATER_Y - 1 || SlopeGlobal(tx, tz) > 2.6f) {
        return;
    }
    for (int y = 0; y <= 6; ++y) {
        SetVoxelGlobal(tx, baseY + y, tz, Material::Trunk);
    }
    for (int y = -3; y <= 4; ++y) {
        for (int z = -4; z <= 4; ++z) {
            for (int x = -4; x <= 4; ++x) {
                const float ellipsoid = static_cast<float>(x * x) / 17.0f
                    + static_cast<float>(y * y) / 13.0f
                    + static_cast<float>(z * z) / 17.0f;
                if (ellipsoid <= 1.0f && AtGlobal(tx + x, baseY + 7 + y, tz + z) == Material::Empty) {
                    SetVoxelGlobal(tx + x, baseY + 7 + y, tz + z, leafMat);
                }
            }
        }
    }
}

void World::BuildFlowers() {
    struct Spot {
        int x;
        int z;
        Material mat;
    };
    constexpr Spot kSpots[] = {
        {18, 52, Material::FlowerWhite}, {20, 55, Material::FlowerYellow},
        {35, 58, Material::FlowerWhite}, {38, 61, Material::FlowerYellow},
        {63, 48, Material::FlowerWhite}, {43, 39, Material::FlowerYellow},
        {16, 42, Material::FlowerYellow}, {66, 43, Material::FlowerWhite},
    };
    for (const Spot& s : kSpots) {
        const int h = GroundHeightGlobal(s.x, s.z);
        if (h > WATER_Y - 1 && h < 62 && SlopeGlobal(s.x, s.z) <= 1.6f) {
            SetVoxelGlobal(s.x, h + 1, s.z, s.mat);
        }
    }
}

void World::BuildProceduralTree(int gx, int gz, int trunkHeight, float radius, Material leafMat) {
    const int baseY = GroundHeightGlobal(gx, gz);
    if (baseY <= WATER_Y - 1 || baseY > 186 || SlopeGlobal(gx, gz) > 3.2f) {
        return;
    }
    // 高海拔换针叶, 并略微缩小树冠, 避免山脊被阔叶树覆盖。
    if (baseY > 100) {
        leafMat = Material::LeafPine;
    }
    if (baseY > 112) {
        trunkHeight = std::max(4, static_cast<int>(std::lround(trunkHeight * 0.8f)));
        radius *= 0.8f;
    }

    for (int y = 0; y <= trunkHeight; ++y) {
        SetVoxelGlobal(gx, baseY + y, gz, Material::Trunk);
    }
    SetVoxelGlobal(gx + 1, baseY, gz, Material::Trunk);
    SetVoxelGlobal(gx - 1, baseY, gz, Material::Trunk);
    SetVoxelGlobal(gx, baseY, gz + 1, Material::Trunk);
    SetVoxelGlobal(gx, baseY, gz - 1, Material::Trunk);

    const int cy = baseY + trunkHeight;
    const int rx = static_cast<int>(std::ceil(radius + 1.0f));
    const int ry = static_cast<int>(std::ceil(radius * 0.8f + 1.0f));
    const int rz = rx;
    const float lobeSeed = static_cast<float>(Hash32(gx, gz, 91u) % 1000u) * 0.006f;
    for (int y = -ry; y <= ry; ++y) {
        for (int z = -rz; z <= rz; ++z) {
            for (int x = -rx; x <= rx; ++x) {
                const float nx = static_cast<float>(x) / radius;
                const float ny = static_cast<float>(y) / (radius * 0.8f);
                const float nz = static_cast<float>(z) / radius;
                const float d2 = nx * nx + ny * ny + nz * nz;
                const float lobed = 1.0f + 0.08f * std::sin(std::atan2(static_cast<float>(z),
                                                                       static_cast<float>(x)) * 3.0f + lobeSeed);
                if (d2 <= lobed && AtGlobal(gx + x, cy + y, gz + z) != Material::Trunk) {
                    SetVoxelGlobal(gx + x, cy + y, gz + z, leafMat);
                }
            }
        }
    }
}

void World::BuildRock(int gx, int gz, float radius) {
    const int baseY = GroundHeightGlobal(gx, gz);
    if (baseY <= WATER_Y - 1 || baseY > 225) {
        return;
    }
    const int r = static_cast<int>(std::ceil(radius + 1.0f));
    for (int y = -1; y <= r; ++y) {
        for (int z = -r; z <= r; ++z) {
            for (int x = -r; x <= r; ++x) {
                const float nx = static_cast<float>(x) / radius;
                const float ny = static_cast<float>(y) / (radius * 0.7f);
                const float nz = static_cast<float>(z) / radius;
                if (nx * nx + ny * ny + nz * nz <= 1.0f) {
                    SetVoxelGlobal(gx + x, baseY + y, gz + z, Material::Stone);
                }
            }
        }
    }
}

void World::BuildVillageHouse(int cx, int cz, int padY, int halfW, int halfD, uint32_t seed) {
    const int wallH = 6;
    const int front = (seed & 1u) ? 1 : -1;

    // 石砌台基: 从局部地表填到 padY, 形成山地梯田式基础。
    for (int z = cz - halfD - 1; z <= cz + halfD + 1; ++z) {
        for (int x = cx - halfW - 1; x <= cx + halfW + 1; ++x) {
            const int g = GroundHeightGlobal(x, z);
            for (int y = std::min(g, padY - 1); y <= padY; ++y) {
                SetVoxelGlobal(x, y, z, Material::Stone);
            }
        }
    }
    FillBoxGlobal(cx - halfW, padY, cz - halfD, cx + halfW, padY, cz + halfD, Material::Stone);

    // 空心墙体 + 木构拐角
    for (int y = padY + 1; y <= padY + wallH; ++y) {
        for (int z = cz - halfD; z <= cz + halfD; ++z) {
            for (int x = cx - halfW; x <= cx + halfW; ++x) {
                const bool edge = x == cx - halfW || x == cx + halfW
                    || z == cz - halfD || z == cz + halfD;
                if (edge) {
                    SetVoxelGlobal(x, y, z, Material::Wall);
                }
            }
        }
    }
    for (int sx : {-halfW, halfW}) {
        for (int sz : {-halfD, halfD}) {
            FillBoxGlobal(cx + sx, padY + 1, cz + sz, cx + sx, padY + wallH, cz + sz, Material::Trunk);
        }
    }
    for (int x = cx - halfW; x <= cx + halfW; ++x) {
        SetVoxelGlobal(x, padY + wallH, cz - halfD, Material::Timber);
        SetVoxelGlobal(x, padY + wallH, cz + halfD, Material::Timber);
    }

    // 门 + 侧窗
    const int doorZ = cz + front * halfD;
    FillBoxGlobal(cx - 1, padY + 1, doorZ, cx + 1, padY + 3, doorZ, Material::Empty);
    SetVoxelGlobal(cx - 2, padY + 1, doorZ, Material::Timber);
    SetVoxelGlobal(cx + 2, padY + 1, doorZ, Material::Timber);
    SetVoxelGlobal(cx - 2, padY + 3, doorZ, Material::Timber);
    SetVoxelGlobal(cx + 2, padY + 3, doorZ, Material::Timber);
    for (int wx : {cx - halfW + 2, cx + halfW - 2}) {
        FillBoxGlobal(wx, padY + 2, doorZ, wx, padY + 3, doorZ, Material::Glow);
    }
    SetVoxelGlobal(cx + halfW + 1, padY + 1, doorZ + front, Material::Trunk);
    SetVoxelGlobal(cx + halfW + 1, padY + 2, doorZ + front, Material::Glow);

    // 双坡屋顶 + 山墙
    const int roofY = padY + wallH + 1;
    for (int step = 0; step <= halfD; ++step) {
        const int z0 = cz - (halfD - step);
        const int z1 = cz + (halfD - step);
        for (int x = cx - halfW - 1; x <= cx + halfW + 1; ++x) {
            SetVoxelGlobal(x, roofY + step, z0, Material::Roof);
            SetVoxelGlobal(x, roofY + step, z1, Material::Roof);
            if (step > 0 && step < halfD) {
                SetVoxelGlobal(x, roofY + step, z0 + 1, Material::Roof);
                SetVoxelGlobal(x, roofY + step, z1 - 1, Material::Roof);
            }
        }
        if (step > 0 && step < halfD) {
            for (int z = z0 + 1; z <= z1 - 1; ++z) {
                SetVoxelGlobal(cx - halfW, roofY + step, z, Material::Wall);
                SetVoxelGlobal(cx + halfW, roofY + step, z, Material::Wall);
            }
        }
    }
    FillBoxGlobal(cx - halfW - 1, roofY + halfD, cz, cx + halfW + 1, roofY + halfD, cz,
                  Material::Roof);

    // 烟囱
    if ((seed >> 4) & 1u) {
        FillBoxGlobal(cx + halfW - 1, padY + wallH, cz - halfD + 1,
                      cx + halfW - 1, roofY + halfD + 2, cz - halfD + 1, Material::Stone);
    }
}

void World::BuildTemple(const SettlementSite& site) {
    const int cx = site.centerX;
    const int cz = site.centerZ;
    const int padY = site.padY;

    // 石砌台地 + 南侧台阶
    for (int z = cz - 9; z <= cz + 9; ++z) {
        for (int x = cx - 9; x <= cx + 9; ++x) {
            const int g = GroundHeightGlobal(x, z);
            const int top = padY + (std::abs(x - cx) <= 7 && std::abs(z - cz) <= 7 ? 1 : 0);
            for (int y = std::min(g, top - 1); y <= top; ++y) {
                SetVoxelGlobal(x, y, z, Material::Stone);
            }
        }
    }
    for (int step = 0; step < 5; ++step) {
        const int z = cz + 10 + step;
        const int y = padY + 1 - step;
        for (int x = cx - 2; x <= cx + 2; ++x) {
            const int g = GroundHeightGlobal(x, z);
            for (int fy = std::min(g, y); fy <= y; ++fy) {
                SetVoxelGlobal(x, fy, z, Material::Stone);
            }
        }
    }

    // 一层殿身 (7x7)
    const int bodyY = padY + 2;
    const int wallH = 7;
    for (int y = bodyY; y <= bodyY + wallH; ++y) {
        for (int z = cz - 3; z <= cz + 3; ++z) {
            for (int x = cx - 3; x <= cx + 3; ++x) {
                const bool edge = std::abs(x - cx) == 3 || std::abs(z - cz) == 3;
                if (edge) {
                    SetVoxelGlobal(x, y, z, Material::Wall);
                }
            }
        }
    }
    for (int sx : {-3, 3}) {
        for (int sz : {-3, 3}) {
            FillBoxGlobal(cx + sx, bodyY, cz + sz, cx + sx, bodyY + wallH, cz + sz, Material::Trunk);
        }
    }
    FillBoxGlobal(cx - 1, bodyY, cz + 3, cx + 1, bodyY + 3, cz + 3, Material::Empty);
    SetVoxelGlobal(cx - 2, bodyY + 3, cz + 3, Material::Timber);
    SetVoxelGlobal(cx + 2, bodyY + 3, cz + 3, Material::Timber);
    for (int wx : {cx - 3, cx + 3}) {
        FillBoxGlobal(wx, bodyY + 3, cz - 1, wx, bodyY + 4, cz + 1, Material::Glow);
    }
    for (int wz : {cz - 3, cz + 3}) {
        FillBoxGlobal(cx - 1, bodyY + 3, wz, cx + 1, bodyY + 4, wz, Material::Glow);
    }

    // 一层重檐屋顶 (四坡)
    int roofBase = bodyY + wallH + 1;
    for (int step = 0; step <= 4; ++step) {
        const int half = 5 - step;
        for (int z = cz - half; z <= cz + half; ++z) {
            for (int x = cx - half; x <= cx + half; ++x) {
                SetVoxelGlobal(x, roofBase + step, z, Material::Roof);
            }
        }
        // 屋檐下垂挂木梁
        if (step <= 1) {
            for (int x = cx - half; x <= cx + half; x += 2) {
                SetVoxelGlobal(x, roofBase - 1, cz - half, Material::Trunk);
                SetVoxelGlobal(x, roofBase - 1, cz + half, Material::Trunk);
            }
        }
    }

    // 二层塔身 + 上层屋顶
    const int upperY = roofBase + 5;
    for (int y = upperY; y <= upperY + 4; ++y) {
        for (int z = cz - 2; z <= cz + 2; ++z) {
            for (int x = cx - 2; x <= cx + 2; ++x) {
                const bool edge = std::abs(x - cx) == 2 || std::abs(z - cz) == 2;
                if (edge) {
                    SetVoxelGlobal(x, y, z, Material::Wall);
                }
            }
        }
    }
    for (int sx : {-2, 2}) {
        for (int sz : {-2, 2}) {
            SetVoxelGlobal(cx + sx, upperY, cz + sz, Material::Trunk);
            SetVoxelGlobal(cx + sx, upperY + 4, cz + sz, Material::Trunk);
        }
    }
    FillBoxGlobal(cx - 1, upperY + 2, cz + 2, cx + 1, upperY + 3, cz + 2, Material::Glow);
    const int upperRoof = upperY + 5;
    for (int step = 0; step <= 3; ++step) {
        const int half = 4 - step;
        for (int z = cz - half; z <= cz + half; ++z) {
            for (int x = cx - half; x <= cx + half; ++x) {
                SetVoxelGlobal(x, upperRoof + step, z, Material::Roof);
            }
        }
    }
    // 塔刹
    FillBoxGlobal(cx, upperRoof + 3, cz, cx, upperRoof + 5, cz, Material::Trunk);
    SetVoxelGlobal(cx, upperRoof + 6, cz, Material::Glow);

    // 台角灯
    for (int sx : {-7, 7}) {
        for (int sz : {-7, 7}) {
            SetVoxelGlobal(cx + sx, padY + 1, cz + sz, Material::Trunk);
            SetVoxelGlobal(cx + sx, padY + 2, cz + sz, Material::Glow);
        }
    }
}

void World::BuildHeroFeatures() {
    if (IntersectsVolume(25 - 24, 25 + 24, 36 - 24, 36 + 24)) {
        BuildTree(25, 36);
    }
    if (IntersectsVolume(53 - 16, 53 + 16, 35 - 16, 35 + 16)) {
        BuildCottage(53, 35);
    }
    if (IntersectsVolume(13 - 10, 13 + 10, 18 - 10, 18 + 10)) {
        BuildSapling(13, 18, Material::LeafAutumn);
    }
    if (IntersectsVolume(67 - 10, 67 + 10, 17 - 10, 17 + 10)) {
        BuildSapling(67, 17, Material::LeafPine);
    }
    BuildFlowers();
}

void World::BuildProceduralFeatures() {
    const int tileX = originX_ / WX;
    const int tileZ = originZ_ / WZ;

    // 先选址并建造村庄/庙宇; 树木等随后避开站点半径。
    std::vector<SettlementSite> sites;
    CollectSettlements(terrain_, originX_ - halo_, originZ_ - halo_,
                       originX_ + vx_ - halo_ - 1, originZ_ + vz_ - halo_ - 1, sites);
    auto nearSite = [&](int gx, int gz) {
        for (const SettlementSite& site : sites) {
            const int dx = gx - site.centerX;
            const int dz = gz - site.centerZ;
            const int r = site.radius + 8;
            if (dx * dx + dz * dz <= r * r) {
                return true;
            }
        }
        return false;
    };

    for (const SettlementSite& site : sites) {
        if (!IntersectsVolume(site.centerX - site.radius - 16, site.centerX + site.radius + 16,
                              site.centerZ - site.radius - 16, site.centerZ + site.radius + 16)) {
            continue;
        }
        if (site.kind == SettlementKind::Temple) {
            BuildTemple(site);
            continue;
        }

        const uint32_t hs = Hash32(site.centerX, site.centerZ, site.seed | 1u);
        const int count = 3 + static_cast<int>(hs % 3u);
        const float phase = static_cast<float>(hs % 1000u) * 0.006283f;
        for (int i = 0; i < count; ++i) {
            const float angle = phase + static_cast<float>(i) * 2.0f * kPi / static_cast<float>(count);
            const int dist = 10 + static_cast<int>(Hash32(site.centerX + i * 7, site.centerZ - i * 5, 0x51u) % 10u);
            const int hx = site.centerX + static_cast<int>(std::lround(std::cos(angle) * static_cast<float>(dist)));
            const int hz = site.centerZ + static_cast<int>(std::lround(std::sin(angle) * static_cast<float>(dist)));
            const int halfW = 4 + static_cast<int>((hs >> (i * 2)) & 1u);
            const int halfD = 3 + static_cast<int>((hs >> (i * 2 + 1)) & 1u);
            BuildVillageHouse(hx, hz, site.padY, halfW, halfD, hs + static_cast<uint32_t>(i) * 101u);
        }
        // 村中心石台与灯柱
        FillBoxGlobal(site.centerX - 1, site.padY + 1, site.centerZ - 1,
                      site.centerX + 1, site.padY + 1, site.centerZ + 1, Material::Stone);
        SetVoxelGlobal(site.centerX, site.padY + 2, site.centerZ, Material::Trunk);
        SetVoxelGlobal(site.centerX, site.padY + 3, site.centerZ, Material::Glow);
    }

    for (int fz = tileZ - 1; fz <= tileZ + 1; ++fz) {
        for (int fx = tileX - 1; fx <= tileX + 1; ++fx) {
            if (fx == 0 && fz == 0) {
                continue;  // 英雄区由 BuildHeroFeatures 负责
            }
            const uint32_t seed = Hash32(fx, fz, 7u);
            const int centerHeight = GroundHeightGlobal(fx * WX + WX / 2, fz * WZ + WZ / 2);
            const int count = 3 + static_cast<int>(seed % 3u)
                + (centerHeight > 60 ? 2 : 0) + (centerHeight > 135 ? 1 : 0);
            for (int i = 0; i < count; ++i) {
                const uint32_t h = Hash32(fx * 31 + i, fz * 17 - i, 0xA53u);
                const int gx = fx * WX + 20 + static_cast<int>(h % 40u);
                const int gz = fz * WZ + 20 + static_cast<int>((h >> 8) % 40u);
                if (nearSite(gx, gz)) {
                    continue;
                }
                const uint32_t kind = (h >> 16) % 4u;
                if (kind == 0u) {
                    Material leaf = (h & 1u) ? Material::Leaf
                        : (((h >> 1) & 1u) ? Material::LeafAutumn : Material::LeafPine);
                    if (centerHeight > 80) {
                        leaf = Material::LeafPine;
                    }
                    BuildProceduralTree(gx, gz, 5 + static_cast<int>((h >> 20) % 4u),
                                        3.5f + static_cast<float>((h >> 24) % 3u) * 0.7f, leaf);
                } else if (kind == 1u) {
                    BuildSapling(gx, gz, (h & 1u) ? Material::LeafPine : Material::LeafAutumn);
                } else if (kind == 2u) {
                    BuildRock(gx, gz, 1.5f + static_cast<float>((h >> 12) % 3u) * 0.4f);
                } else {
                    const int hg = GroundHeightGlobal(gx, gz);
                    if (hg > WATER_Y - 1 && hg < 72 && SlopeGlobal(gx, gz) <= 1.6f) {
                        SetVoxelGlobal(gx, hg + 1, gz,
                                       (h & 1u) ? Material::FlowerWhite : Material::FlowerYellow);
                    }
                }
            }

            // 每块保证一小簇野花, 让远景草甸保持 SeedWorld 的色彩点缀。
            const uint32_t flowerSeed = Hash32(fx, fz, 0x51u);
            const int flowerX = fx * WX + 22 + static_cast<int>(flowerSeed % 36u);
            const int flowerZ = fz * WZ + 22 + static_cast<int>((flowerSeed >> 8) % 36u);
            if (nearSite(flowerX, flowerZ)) {
                continue;
            }
            const int flowerGround = GroundHeightGlobal(flowerX, flowerZ);
            if (flowerGround > WATER_Y - 1 && flowerGround < 72 && SlopeGlobal(flowerX, flowerZ) <= 1.6f) {
                SetVoxelGlobal(flowerX, flowerGround + 1, flowerZ,
                               (flowerSeed & 1u) ? Material::FlowerWhite : Material::FlowerYellow);
            }
        }
    }
}

void World::BuildProximityVolumes() {
    const int ex = vx_ / 2;
    const int ey = WY / 2;
    const int ez = vz_ / 2;
    const size_t total = static_cast<size_t>(ex) * ey * ez;

    groundProx_.assign(total, 0.0f);
    waterProx_.assign(total, 0.0f);

    for (int vz = 0; vz < vz_; ++vz) {
        for (int vy = 0; vy < WY; ++vy) {
            for (int vx = 0; vx < vx_; ++vx) {
                const size_t ei = static_cast<size_t>(((vy >> 1) * ez + (vz >> 1)) * ex + (vx >> 1));
                if (At(vx, vy, vz) == Material::Grass) {
                    groundProx_[ei] = 1.0f;
                }
                if (vy == WATER_Y && IsBrook(vx, vz)) {
                    waterProx_[ei] = 1.0f;
                }
            }
        }
    }

    std::vector<float> gpTmp(total, 0.0f);
    std::vector<float> wpTmp(total, 0.0f);
    const int strideY = ex * ez;

    for (int pass = 0; pass < 6; ++pass) {
        for (int y = 0; y < ey; ++y) {
            for (int z = 0; z < ez; ++z) {
                const int row = y * strideY + z * ex;
                for (int x = 0; x < ex; ++x) {
                    const int i = row + x;
                    float gm = groundProx_[i];
                    float wm = waterProx_[i];

                    if (x > 0) {
                        gm = std::max(gm, groundProx_[i - 1] * 0.78f);
                        wm = std::max(wm, waterProx_[i - 1] * 0.80f);
                    }
                    if (x < ex - 1) {
                        gm = std::max(gm, groundProx_[i + 1] * 0.78f);
                        wm = std::max(wm, waterProx_[i + 1] * 0.80f);
                    }
                    if (y > 0) {
                        gm = std::max(gm, groundProx_[i - strideY] * 0.74f);
                        wm = std::max(wm, waterProx_[i - strideY] * 0.76f);
                    }
                    if (y < ey - 1) {
                        gm = std::max(gm, groundProx_[i + strideY] * 0.74f);
                        wm = std::max(wm, waterProx_[i + strideY] * 0.76f);
                    }
                    if (z > 0) {
                        gm = std::max(gm, groundProx_[i - ex] * 0.78f);
                        wm = std::max(wm, waterProx_[i - ex] * 0.80f);
                    }
                    if (z < ez - 1) {
                        gm = std::max(gm, groundProx_[i + ex] * 0.78f);
                        wm = std::max(wm, waterProx_[i + ex] * 0.80f);
                    }

                    gpTmp[i] = gm;
                    wpTmp[i] = wm;
                }
            }
        }
        groundProx_.swap(gpTmp);
        waterProx_.swap(wpTmp);
    }
}

void World::BuildBiomeColors() {
    const Vec3 biomeCool = HexToLinear(0x27854b);
    const Vec3 biomeMid = HexToLinear(0x5ab534);
    const Vec3 biomeWarm = HexToLinear(0xa6da22);
    const Vec3 biomeDamp = HexToLinear(0x2d8d68);

    for (int vz = 0; vz < vz_; ++vz) {
        const double fz = static_cast<double>(originZ_ + vz - halo_);
        for (int vx = 0; vx < vx_; ++vx) {
            const double fx = static_cast<double>(originX_ + vx - halo_);
            const double n1 = TerrainNoise(fx * 0.036 + 11.3, fz * 0.036 + 4.7);
            const double n2 = TerrainNoise(fx * 0.021 - 3.1, fz * 0.025 + 8.9);
            const float t = Clamp(static_cast<float>(0.5 + (n1 - 0.5) * 1.6 + (n2 - 0.5) * 0.95),
                                  0.0f, 1.0f);

            Vec3 color = (t < 0.5f)
                ? Lerp(biomeCool, biomeMid, t * 2.0f)
                : Lerp(biomeMid, biomeWarm, (t - 0.5f) * 2.0f);

            if (fz > 44.0) {
                const double curveX = 46.0 + (79.0 - fz) * 0.56 + std::sin(fz * 0.13) * 3.5;
                const double dStream = std::abs(fx - curveX);
                const double dPond = std::hypot((fx - 52.0) * 0.85, (fz - 62.0) * 0.95);
                const double prox = std::max(std::max(0.0, 1.0 - dStream / 10.5),
                                             std::max(0.0, 1.0 - dPond / 16.5));
                if (prox > 0.0) {
                    color = Lerp(color, biomeDamp, static_cast<float>(std::pow(prox, 1.3) * 0.62));
                }
            }
            biomeColor_[static_cast<size_t>(vz) * vx_ + vx] = color;
        }
    }
}

} // namespace sw
