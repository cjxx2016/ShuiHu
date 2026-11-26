// ============================================================================
// Settlement.cc — 程序化村庄/庙宇选址实现
// ============================================================================
#include "Settlement.h"

#include <algorithm>
#include <cmath>

namespace sw {
namespace {

constexpr int kSiteCell = 420;      // 选址网格 (m)
constexpr int kHeroClear = 220;     // 英雄区保护半径

uint32_t SiteHash(int x, int z, uint32_t salt) {
    uint32_t h = static_cast<uint32_t>(x) * 0x9E3779B1u
        + static_cast<uint32_t>(z) * 0x85EBCA77u + salt * 0xC2B2AE3Du;
    h ^= h >> 15;
    h *= 0x27D4EB2Fu;
    h ^= h >> 13;
    return h;
}

struct PadInfo {
    int minH = 0;
    int maxH = 0;
};

PadInfo SamplePad(const TerrainSource& terrain, int cx, int cz, int radius) {
    PadInfo info{1 << 30, -1};
    const int step = std::max(3, radius / 3);
    for (int dz = -radius; dz <= radius; dz += step) {
        for (int dx = -radius; dx <= radius; dx += step) {
            const int h = terrain.HeightAt(cx + dx, cz + dz);
            info.minH = std::min(info.minH, h);
            info.maxH = std::max(info.maxH, h);
        }
    }
    info.minH = std::min(info.minH, info.maxH);
    return info;
}

void AddAuthoredSite(const TerrainSource& terrain, int minX, int minZ, int maxX, int maxZ,
                     SettlementKind kind, int cx, int cz, std::vector<SettlementSite>& out) {
    const int radius = kind == SettlementKind::Temple ? 24 : 32;
    if (cx + radius < minX || cx - radius > maxX || cz + radius < minZ || cz - radius > maxZ) {
        return;
    }
    for (const SettlementSite& site : out) {
        const int dx = site.centerX - cx;
        const int dz = site.centerZ - cz;
        if (dx * dx + dz * dz < 90 * 90) {
            return;
        }
    }
    const PadInfo pad = SamplePad(terrain, cx, cz, radius);
    SettlementSite site;
    site.centerX = cx;
    site.centerZ = cz;
    site.padY = std::max(terrain.HeightAt(cx, cz) + 2, kind == SettlementKind::Village ? 13 : 60);
    site.radius = radius;
    site.kind = kind;
    site.seed = SiteHash(cx / 8, cz / 8, 0xA17E5u);
    out.push_back(site);
}

} // namespace

void CollectSettlements(const TerrainSource& terrain, int minX, int minZ, int maxX, int maxZ,
                        std::vector<SettlementSite>& out) {
    out.clear();

    // 固定地标: 英雄区西南的河谷村庄 + 西北山脊上的庙宇。
    AddAuthoredSite(terrain, minX, minZ, maxX, maxZ, SettlementKind::Village, 300, 120, out);
    AddAuthoredSite(terrain, minX, minZ, maxX, maxZ, SettlementKind::Temple, -410, -120, out);

    const int cellMinX = minX / kSiteCell - 1;
    const int cellMaxX = maxX / kSiteCell + 1;
    const int cellMinZ = minZ / kSiteCell - 1;
    const int cellMaxZ = maxZ / kSiteCell + 1;

    for (int cz = cellMinZ; cz <= cellMaxZ; ++cz) {
        for (int cx = cellMinX; cx <= cellMaxX; ++cx) {
            const uint32_t h = SiteHash(cx, cz, 0x5EED1234u);
            const int px = cx * kSiteCell + 70 + static_cast<int>(h % 280u);
            const int pz = cz * kSiteCell + 70 + static_cast<int>((h >> 9) % 280u);
            const int radius = 30;
            if (px + radius < minX || px - radius > maxX || pz + radius < minZ || pz - radius > maxZ) {
                continue;
            }
            const int heroDx = px - 40;
            const int heroDz = pz - 35;
            if (heroDx * heroDx + heroDz * heroDz < kHeroClear * kHeroClear) {
                continue;
            }

            bool duplicate = false;
            for (const SettlementSite& site : out) {
                const int dx = site.centerX - px;
                const int dz = site.centerZ - pz;
                if (dx * dx + dz * dz < 90 * 90) {
                    duplicate = true;
                    break;
                }
            }
            if (duplicate) {
                continue;
            }

            const PadInfo pad = SamplePad(terrain, px, pz, radius);
            const int relief = pad.maxH - pad.minH;
            const uint32_t roll = (h >> 17) % 100u;
            SettlementSite site;
            site.centerX = px;
            site.centerZ = pz;
            site.radius = radius;
            site.seed = h;

            if (pad.maxH >= 110 && pad.maxH <= 220 && relief <= 16 && roll < 62u) {
                site.kind = SettlementKind::Temple;
                site.padY = pad.maxH + 3;
            } else if (pad.maxH >= 14 && pad.maxH <= 145 && relief <= 9 && roll < 58u) {
                site.kind = SettlementKind::Village;
                site.padY = std::max(pad.maxH + 3, 13);
            } else {
                continue;
            }
            out.push_back(site);
        }
    }
}

} // namespace sw
