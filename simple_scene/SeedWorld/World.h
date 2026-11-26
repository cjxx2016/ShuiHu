// ============================================================================
// World.h — SeedWorld 体素世界的一个流送分块
// ----------------------------------------------------------------------------
// 世界按 80x80 的 XZ 分块生成, 每块额外向外生成 HALO 个体素用于:
//   * 48/34 射线天光可见度 (射线最远 22.5m, 避免分块边界出现假亮边);
//   * 面剔除与角点 AO 的邻居查询;
//   * 分块边界的彩光溢色/生态色连续性。
// 只有核心 80x80 区域会被网格化与渲染, 外圈 HALO 仅参与烘焙查询。
// 所有特征使用全局体素坐标放置, 因此相邻分块对同一特征得到完全一致的结果。
// ============================================================================
#pragma once

#include <cstdint>
#include <vector>

#include "Common.h"
#include "Settlement.h"
#include "Terrain.h"

namespace sw {

constexpr int WX = 80;                    // 分块核心尺寸 (X)
constexpr int WY = kWorldHeight;          // 世界高度 (256)
constexpr int WZ = 80;                    // 分块核心尺寸 (Z)
constexpr int WATER_Y = kWaterLevel;      // 水面高度
constexpr int kChunkHalo = 24;            // 天光射线外扩 (>= 22.5m 最大射线距离)

class World {
public:
    // originX/originZ 是核心块左上角在全局体素坐标中的位置 (必须是 WX/WZ 的整数倍)。
    World(int originX, int originZ, const TerrainSource& terrain, int halo = kChunkHalo);

    // 构建分块; 可在工作线程中独立调用。
    void Build();

    int OriginX() const { return originX_; }
    int OriginZ() const { return originZ_; }
    int Halo() const { return halo_; }
    int VX() const { return vx_; }
    int VZ() const { return vz_; }

    // --- 体素访问 (统一使用外扩后的局部坐标 0..VX-1 / 0..VZ-1) ---
    bool InBounds(int vx, int vy, int vz) const {
        return vx >= 0 && vx < vx_ && vy >= 0 && vy < WY && vz >= 0 && vz < vz_;
    }
    Material At(int vx, int vy, int vz) const;
    bool IsSolid(int vx, int vy, int vz) const { return At(vx, vy, vz) != Material::Empty; }

    int GroundY(int vx, int vz) const { return groundY_[static_cast<size_t>(vz) * vx_ + vx]; }
    bool IsBrook(int vx, int vz) const { return brookMask_[static_cast<size_t>(vz) * vx_ + vx] != 0; }

    // --- 材质约定 ---
    static bool IsLeaf(Material mat) {
        return mat == Material::Leaf || mat == Material::LeafAutumn || mat == Material::LeafPine;
    }
    static Vec3 Palette(Material mat);        // 线性空间基色
    static uint32_t PaletteHex(Material mat);

    // --- 环境邻近度 (外扩半分辨率) ---
    float GroundProximity(int vx, int vy, int vz) const;
    float WaterProximity(int vx, int vy, int vz) const;

    // --- 草地生态色场 (外扩) ---
    Vec3 BiomeColor(int vx, int vz) const { return biomeColor_[static_cast<size_t>(vz) * vx_ + vx]; }

    int FilledVoxelCount() const { return filledCore_; }
    int TotalVoxelCount() const { return vx_ * WY * vz_; }

private:
    void BuildTerrain();
    void BuildHeroFeatures();
    void BuildProceduralFeatures();
    void BuildProximityVolumes();
    void BuildBiomeColors();

    Material AtGlobal(int gx, int gy, int gz) const;
    void SetVoxelGlobal(int gx, int gy, int gz, Material mat);
    void FillBoxGlobal(int x0, int y0, int z0, int x1, int y1, int z1, Material mat);
    bool IntersectsVolume(int gx0, int gx1, int gz0, int gz1) const;
    int GroundHeightGlobal(int gx, int gz) const;
    float SlopeGlobal(int gx, int gz) const;

    void BuildTree(int gtx, int gtz);
    void BuildCottage(int gcx, int gcz);
    void BuildSapling(int gtx, int gtz, Material leafMat);
    void BuildFlowers();
    void BuildProceduralTree(int gx, int gz, int trunkHeight, float radius, Material leafMat);
    void BuildRock(int gx, int gz, float radius);
    void BuildVillageHouse(int gcx, int gcz, int padY, int halfW, int halfD, uint32_t seed);
    void BuildTemple(const SettlementSite& site);

    const TerrainSource& terrain_;
    int originX_ = 0;
    int originZ_ = 0;
    int halo_ = kChunkHalo;
    int vx_ = WX + 2 * kChunkHalo;
    int vz_ = WZ + 2 * kChunkHalo;

    std::vector<uint8_t> grid_;                  // 外扩体素, 按 (y * VZ + z) * VX + x 索引
    std::vector<int16_t> groundY_;               // 外扩每列地表高度
    std::vector<uint8_t> brookMask_;             // 外扩每列是否溪流/池塘
    std::vector<float> groundProx_;              // 外扩半分辨率草地邻近度
    std::vector<float> waterProx_;               // 外扩半分辨率水体邻近度
    std::vector<Vec3> biomeColor_;               // 外扩每列草地生态色 (线性)
    int filledCore_ = 0;
};

} // namespace sw
