// ============================================================================
// Mesher.h — 体素表面网格烘焙
// ----------------------------------------------------------------------------
// 每个可见体素面生成一个四边形, 顶点携带:
//   * 面法线 (硬边) 与 48 射线天光弯曲法线;
//   * 48 射线黄金螺旋的逐面天空可见度 (平滑 / 原始两套口径);
//   * 34 射线五重塔口径可见度 (供第 4 号渲染模式);
//   * 角点 AO、顶部遮蔽、材质类别、局部高度与环境邻近度;
//   * 生态色 (草地每角采样) 与严格单色基色两套颜色。
// 另外生成:
//   * 3D 洪水填充彩光溢色体积 (RGBA8, 半分辨率);
//   * 半透明溪流水面网格 (含深度与岸边信息)。
// ============================================================================
#pragma once

#include <cstdint>
#include <vector>

#include "Common.h"
#include "World.h"

namespace sw {

// 顶点属性布局必须与 Renderer 中的 sg_vertex_layout_state 及
// shaders/seedworld.glsl 的 layout(location=N) 一一对应。
struct VoxelVertex {
    Vec3 pos;               // location 0
    Vec3 normal;            // location 1
    Vec3 biomeColor;        // location 2
    Vec3 uniformColor;      // location 3
    Vec3 bentNormal;        // location 4
    float flowMeta[4];      // location 5: flowMatId, localElev, groundProx, waterProx
    float sky[4];           // location 6: faceSky, smoothSky, pagodaSky, topMask
    float shade[4];         // location 7: ao, pagodaAO, faceShade, matKind
    float uv[2];            // location 8
};
static_assert(sizeof(VoxelVertex) == 29 * sizeof(float), "VoxelVertex must stay tightly packed");

struct WaterVertex {
    Vec3 pos;
    Vec3 color;
    float depth;
    float shore;
};
static_assert(sizeof(WaterVertex) == 8 * sizeof(float), "WaterVertex must stay tightly packed");

// 烘焙质量: Full 用于活动加载窗口内的分块; Prefetch 用于预取外圈,
// 以更少的天光射线降低烘焙耗时。几何/材质/彩光体积完全一致, 仅光照采样更稀疏,
// 远处配合雾效保持整体视觉统一。
enum class BakeQuality : uint8_t {
    Full = 0,
    Prefetch = 1,
};

struct BakeResult {
    std::vector<VoxelVertex> vertices;
    std::vector<uint32_t> indices;
    std::vector<WaterVertex> waterVertices;
    std::vector<uint32_t> waterIndices;
    std::vector<uint8_t> bleedRGBA;   // (z * bleedHeight + y) * bleedWidth + x, RGBA8
    int bleedWidth = 0;
    int bleedHeight = 0;
    int bleedDepth = 0;
    int filledVoxels = 0;
    int triangles = 0;
};

BakeResult BakeWorld(const World& world, BakeQuality quality = BakeQuality::Full);

} // namespace sw
