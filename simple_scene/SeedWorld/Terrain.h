// ============================================================================
// Terrain.h — 可组合地形源 (程序化 / 设计补丁 / 动态编辑)
// ----------------------------------------------------------------------------
// 世界高度与地表材质不再写死在 World 内, 而是由 TerrainSource 提供:
//   * ProceduralTerrain: 原生程序化草甸 + 大尺度山脉/山脊;
//   * PatchedTerrain:    在任意 TerrainSource 上叠加"设计地图"补丁 (山体/台地),
//                        用于未来将手工关卡与自动生成混合;
//   * EditedTerrain:     在任意 TerrainSource 上叠加动态高度编辑 (隆起/下挖),
//                        可通过 WorldPartition 重建对应分块生效。
// 所有实现都是纯函数/不可变快照, 可安全地被多个 worker 分块共享。
// ============================================================================
#pragma once

#include <cstdint>
#include <memory>
#include <vector>

namespace sw {

constexpr int kWorldHeight = 256;   // 世界最大高度 (为雪山/深谷留足空间)
constexpr int kWaterLevel = 10;     // 水面高度

// 材质编号必须与烘焙/着色器中的约定保持一致 (0 = 空气)。
enum class Material : uint8_t {
    Empty = 0,
    Grass = 1,
    Dirt = 2,
    Stone = 3,
    Trunk = 4,
    Leaf = 5,
    Wall = 6,
    Roof = 7,
    Timber = 8,
    Glow = 9,
    FlowerWhite = 10,
    FlowerYellow = 11,
    Water = 12,      // 仅作为语义占位; 水面由独立网格绘制
    LeafAutumn = 13,
    LeafPine = 14,
    Snow = 15,
    Rock = 16,       // 高山深色岩层 (与 Stone 交替, 打破大面积灰色)
};

// 全局确定性平滑值噪声; 地形、生态色场共用。
double TerrainNoise(double x, double z);

class TerrainSource {
public:
    virtual ~TerrainSource() = default;

    // 返回该全局 XZ 列的地表体素高度 (已取整并夹紧到世界范围)。
    virtual int HeightAt(int gx, int gz) const = 0;

    // 返回该列地表的顶面材质; slope 为相邻列的最大高度差 (体素)。
    virtual Material SurfaceAt(int gx, int gz, int height, float slope) const = 0;
};

// 设计地图补丁: 在椭球范围内抬升 (或降低) 地形; inner 控制平顶范围。
struct TerrainPatch {
    int centerX = 0;
    int centerZ = 0;
    float radiusX = 1.0f;
    float radiusZ = 1.0f;
    float height = 0.0f;     // 中心附加高度; 负值表示下挖
    float inner = 0.35f;     // 0..1, 内侧平顶半径比例
};

// 设计平台: 将椭球范围平滑地拉平到绝对高度, 用于村庄/庙宇台地。
struct TerrainPad {
    int centerX = 0;
    int centerZ = 0;
    float radiusX = 1.0f;
    float radiusZ = 1.0f;
    float level = 0.0f;
    float inner = 0.45f;
};

// 动态高度编辑: 与补丁同形, 用于未来运行时地形雕刻。
struct HeightEdit {
    int centerX = 0;
    int centerZ = 0;
    float radiusX = 1.0f;
    float radiusZ = 1.0f;
    float delta = 0.0f;
};

class ProceduralTerrain final : public TerrainSource {
public:
    int HeightAt(int gx, int gz) const override;
    Material SurfaceAt(int gx, int gz, int height, float slope) const override;
};

class PatchedTerrain final : public TerrainSource {
public:
    PatchedTerrain(std::shared_ptr<const TerrainSource> base, std::vector<TerrainPatch> patches);

    int HeightAt(int gx, int gz) const override;
    Material SurfaceAt(int gx, int gz, int height, float slope) const override;

private:
    std::shared_ptr<const TerrainSource> base_;
    std::vector<TerrainPatch> patches_;
};

class LeveledTerrain final : public TerrainSource {
public:
    LeveledTerrain(std::shared_ptr<const TerrainSource> base, std::vector<TerrainPad> pads);

    int HeightAt(int gx, int gz) const override;
    Material SurfaceAt(int gx, int gz, int height, float slope) const override;

private:
    std::shared_ptr<const TerrainSource> base_;
    std::vector<TerrainPad> pads_;
};

class EditedTerrain final : public TerrainSource {
public:
    EditedTerrain(std::shared_ptr<const TerrainSource> base, std::vector<HeightEdit> edits);

    int HeightAt(int gx, int gz) const override;
    Material SurfaceAt(int gx, int gz, int height, float slope) const override;

private:
    std::shared_ptr<const TerrainSource> base_;
    std::vector<HeightEdit> edits_;
};

} // namespace sw
