// ============================================================================
// Settlement.h — 程序化村庄/庙宇选址
// ----------------------------------------------------------------------------
// 在固定网格上确定性选址: 平原/河谷低地生成村庄, 山脊台地生成庙宇。
// 选址只依赖 TerrainSource 与哈希, 因此相邻分块得到完全相同的站点;
// World 的建造器会按分块裁剪体素写入。
// ============================================================================
#pragma once

#include <cstdint>
#include <vector>

#include "Terrain.h"

namespace sw {

enum class SettlementKind : uint8_t {
    Village = 0,
    Temple = 1,
};

struct SettlementSite {
    int centerX = 0;
    int centerZ = 0;
    int padY = 0;
    int radius = 0;
    SettlementKind kind = SettlementKind::Village;
    uint32_t seed = 0;
};

// 收集与 [minX,maxX]x[minZ,maxZ] 区域相交的站点 (含少量固定地标)。
void CollectSettlements(const TerrainSource& terrain, int minX, int minZ, int maxX, int maxZ,
                        std::vector<SettlementSite>& out);

} // namespace sw
