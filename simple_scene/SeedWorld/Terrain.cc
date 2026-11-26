// ============================================================================
// Terrain.cc — 巨型程序化地形与可组合补丁
// ----------------------------------------------------------------------------
// 英雄区 (距 (40,35) 100m 内) 保持参考草甸/大树/小屋/溪流高度;
// 之外由多尺度噪声生成平原、丘陵、长条山脊、河谷与不同大小的台地:
//   * 低频区域 + 范围带决定平原/丘陵/山脉的分布;
//   * 域扰动 ridged multifractal 形成有走向的山脊;
//   * 河网沿噪声等值线切出宽窄不同的河谷, 低处形成水面;
//   * 可变宽度的平坦区产生大小不一的平原/台地;
//   * 高度经软上限收敛到 248, 最高约 215, 最低河谷约 6。
// 英雄区周围 135-285m 为噪声调制的低地盆地, 让花园自然过渡到荒野。
// ============================================================================
#include "Terrain.h"

#include <algorithm>
#include <cmath>

namespace sw {
namespace {

// --- 英雄区精确噪声 (必须与参考场景逐列一致) ---
double Hash2(int x, int z) {
    const double s = std::sin(static_cast<double>(x) * 127.1 + static_cast<double>(z) * 311.7) * 43758.5453123;
    return s - std::floor(s);
}

double SmoothNoise(double x, double z) {
    const int ix = static_cast<int>(std::floor(x));
    const int iz = static_cast<int>(std::floor(z));
    const double fx = x - static_cast<double>(ix);
    const double fz = z - static_cast<double>(iz);
    const double ux = fx * fx * (3.0 - 2.0 * fx);
    const double uz = fz * fz * (3.0 - 2.0 * fz);

    const double a = Hash2(ix, iz);
    const double b = Hash2(ix + 1, iz);
    const double c = Hash2(ix, iz + 1);
    const double d = Hash2(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

double SmoothStep(double edge0, double edge1, double x) {
    const double t = std::max(0.0, std::min(1.0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3.0 - 2.0 * t);
}

int RoundIndex(double v) {
    return static_cast<int>(std::lround(v));
}

// --- 荒野快速噪声 (整数哈希, 供大范围地形使用) ---
uint32_t FastHash2(int x, int z) {
    uint32_t h = static_cast<uint32_t>(x) * 374761393u + static_cast<uint32_t>(z) * 668265263u;
    h = (h ^ (h >> 13)) * 1274126177u;
    h ^= h >> 16;
    return h;
}

double FastNoise(double x, double z) {
    const int ix = static_cast<int>(std::floor(x));
    const int iz = static_cast<int>(std::floor(z));
    const double fx = x - static_cast<double>(ix);
    const double fz = z - static_cast<double>(iz);
    const double ux = fx * fx * (3.0 - 2.0 * fx);
    const double uz = fz * fz * (3.0 - 2.0 * fz);

    constexpr double kInv = 1.0 / 4294967296.0;
    const double a = static_cast<double>(FastHash2(ix, iz)) * kInv;
    const double b = static_cast<double>(FastHash2(ix + 1, iz)) * kInv;
    const double c = static_cast<double>(FastHash2(ix, iz + 1)) * kInv;
    const double d = static_cast<double>(FastHash2(ix + 1, iz + 1)) * kInv;
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

double SegmentDistance(double px, double pz, double ax, double az, double bx, double bz) {
    const double vx = bx - ax;
    const double vz = bz - az;
    const double wx = px - ax;
    const double wz = pz - az;
    const double len2 = vx * vx + vz * vz;
    const double t = len2 > 1e-9 ? std::max(0.0, std::min(1.0, (wx * vx + wz * vz) / len2)) : 0.0;
    const double dx = px - (ax + vx * t);
    const double dz = pz - (az + vz * t);
    return std::sqrt(dx * dx + dz * dz);
}

double FastFbm(double x, double z, int octaves) {
    double sum = 0.0;
    double norm = 0.0;
    double amp = 1.0;
    for (int i = 0; i < octaves; ++i) {
        sum += FastNoise(x + static_cast<double>(i) * 13.7, z - static_cast<double>(i) * 7.3) * amp;
        norm += amp;
        amp *= 0.5;
        x *= 2.03;
        z *= 2.03;
    }
    return sum / norm;
}

// 英雄区原始的草甸高度函数 (必须与参考场景逐列一致)。
double MeadowHeight(double x, double z) {
    double h = 11.2
        + SmoothNoise(x * 0.055 + 2.1, z * 0.055 + 4.3) * 3.2
        + SmoothNoise(x * 0.12 - 1.4, z * 0.12 + 0.9) * 1.1;

    if (z > 48.0) {
        const double frontSlope = std::min(1.0, (z - 48.0) / 28.0);
        h -= frontSlope * 2.1;
    }

    const double dxT = x - 25.0;
    const double dzT = z - 36.0;
    h += std::exp(-(dxT * dxT + dzT * dzT) / 145.0) * 1.9;

    const double dxH = (x - 53.0) / 13.0;
    const double dzH = (z - 35.0) / 12.0;
    const double dH = std::sqrt(dxH * dxH + dzH * dzH);
    const double flatW = std::max(0.0, 1.0 - std::max(0.0, (dH - 0.85) / 0.45));
    h = h * (1.0 - flatW) + 12.2 * flatW;

    const double curveX = 46.0 + (79.0 - z) * 0.56 + std::sin(z * 0.13) * 3.5;
    const double distStream = std::abs(x - curveX);
    const double pondDist = std::hypot((x - 52.0) * 0.85, (z - 62.0) * 0.95);
    const double carve = std::max(
        std::max(0.0, 1.0 - distStream / 5.4),
        std::max(0.0, 1.0 - pondDist / 10.5));
    if (z > 48.0 && carve > 0.0) {
        h -= carve * 6.2;
    }
    return h;
}

// 荒野高度: 平原 / 丘陵 / 山脊 / 河谷 / 台地的组合。
double WildHeight(double x, double z) {
    const double dxH = x - 40.0;
    const double dzH = z - 35.0;
    const double heroDist = std::sqrt(dxH * dxH + dzH * dzH);
    const double basinRadius = 135.0 + 85.0 * FastNoise(x * 0.004 + 2.2, z * 0.004 - 6.1);
    const double basin = 1.0 - SmoothStep(basinRadius, basinRadius + 150.0, heroDist);

    // 区域分布: 大尺度山脉 + 局部山体 + 长条山脊带
    const double macro = FastFbm(x * 0.00110 + 3.7, z * 0.00110 - 8.2, 4);
    const double macro2 = FastFbm(x * 0.0031 - 12.1, z * 0.0031 + 5.6, 3);
    const double rangeN = FastFbm(x * 0.00068 + 8.3, z * 0.00068 - 3.9, 3);
    const double rangeBand = 1.0 - SmoothStep(0.05, 0.22, std::abs(rangeN - 0.5));
    // 英雄区西北的设计山脉包络: 与程序化山脊叠加, 避免出生点被随机地形淹没。
    const double designed = 1.0 - SmoothStep(150.0, 360.0,
        std::min(SegmentDistance(x, z, -760.0, -40.0, -380.0, -250.0),
                 SegmentDistance(x, z, -380.0, -250.0, -120.0, -620.0)));
    const double mountain = std::max(
        std::max(SmoothStep(0.43, 0.65, macro) * 0.55,
                 SmoothStep(0.62, 0.80, macro2) * 0.45),
        std::max(rangeBand * 0.92, designed * 0.92));
    const double hillRegion = SmoothStep(0.28, 0.52,
                                        FastFbm(x * 0.0021 - 5.4, z * 0.0021 + 2.8, 3));

    // 域扰动 + 各向异性 ridged multifractal: 形成有走向的山脊而非圆柱山
    const double wx = x + (FastNoise(x * 0.0018 + 11.3, z * 0.0018 - 4.7) - 0.5) * 260.0;
    const double wz = z + (FastNoise(x * 0.0018 - 7.1, z * 0.0018 + 9.2) - 0.5) * 260.0;
    double ridge = 0.0;
    double amp = 1.0;
    double norm = 0.0;
    double fx = wx * 0.00085;
    double fz = wz * 0.00055;
    for (int i = 0; i < 6; ++i) {
        const double n = FastNoise(fx + static_cast<double>(i) * 17.3,
                                   fz - static_cast<double>(i) * 9.1);
        const double crest = 1.0 - std::abs(2.0 * n - 1.0);
        ridge += crest * crest * amp;
        norm += amp;
        amp *= 0.60;
        fx *= 2.07;
        fz *= 2.07;
    }
    ridge /= norm;
    const double detail = FastFbm(x * 0.008 + 6.2, z * 0.008 - 3.4, 3) - 0.5;

    const double base = 14.0 + 14.0 * FastFbm(x * 0.0014 + 1.2, z * 0.0014 - 6.8, 3);
    const double hills = hillRegion
        * (FastFbm(x * 0.0055 + 9.1, z * 0.0055 - 2.2, 3) - 0.5) * 40.0;
    const double mountainHeight = mountain
        * (std::pow(std::max(ridge, 0.0), 2.0) * (180.0 + 230.0 * macro) + detail * 16.0);
    double h = base + hills + mountainHeight;

    // 大小可变的平坦区 / 台地
    const double flatN = FastFbm(x * 0.0016 + 17.7, z * 0.0016 - 11.2, 3);
    const double flatW = 0.05 + 0.16 * FastNoise(x * 0.0007 + 4.4, z * 0.0007 - 9.9);
    double flatMask = SmoothStep(0.5 - flatW, 0.5 - flatW * 0.45, flatN);
    flatMask *= (1.0 - mountain * 0.7);
    const double plateau = 14.0 + 105.0 * FastFbm(x * 0.0011 - 8.5, z * 0.0011 + 13.3, 3);
    h = h * (1.0 - flatMask * 0.82) + plateau * (flatMask * 0.82);
    h += designed * (22.0 + 150.0 * std::pow(std::max(ridge, 0.0), 0.85))
        * (0.75 + 0.5 * macro);

    // 细碎起伏与岩壁: 打破平滑坡面上的规则等高线台阶。
    const double micro = (FastFbm(x * 0.035 + 19.3, z * 0.035 - 7.7, 3) - 0.5) * 4.5;
    const double crag = (FastFbm(x * 0.011 - 3.3, z * 0.012 + 8.8, 4) - 0.5)
        * 36.0 * mountain;
    const double crag2 = (FastFbm(x * 0.028 + 7.7, z * 0.028 - 9.9, 2) - 0.5)
        * 22.0 * mountain;
    h += micro * (0.5 + 0.5 * (1.0 - mountain)) + crag + crag2;

    // 两级河网: 沿噪声等值线切出宽窄不同的河谷, 低处形成水面
    const double riverResist = SmoothStep(150.0, 60.0, h);
    if (riverResist > 0.02) {
        const double rv1 = FastNoise(x * 0.00082 + 21.0, z * 0.00082 - 5.0);
        const double w1 = 0.022 + 0.034 * FastNoise(x * 0.0020 - 4.0, z * 0.0020 + 8.0);
        const double d1 = std::abs(rv1 - 0.5);
        const double ch1 = 1.0 - SmoothStep(0.0, w1, d1);
        const double va1 = 1.0 - SmoothStep(w1, w1 * 3.0, d1);
        const double floor1 = 10.8 + 1.2 * FastNoise(x * 0.03 + 7.0, z * 0.03 - 1.0);
        h += (floor1 - h) * va1 * riverResist * 0.92;
        h -= ch1 * riverResist * 5.5;

        const double rv2 = FastNoise(x * 0.0021 - 9.0, z * 0.0021 + 15.0);
        const double w2 = 0.012 + 0.022 * FastNoise(x * 0.0035 + 1.0, z * 0.0035 - 3.0);
        const double d2 = std::abs(rv2 - 0.5);
        const double ch2 = 1.0 - SmoothStep(0.0, w2, d2);
        const double va2 = 1.0 - SmoothStep(w2, w2 * 2.6, d2);
        const double floor2 = 10.8 + 1.2 * FastNoise(x * 0.05 - 2.0, z * 0.05 + 4.0);
        h += (floor2 - h) * va2 * riverResist * 0.70;
        h -= ch2 * riverResist * 4.8;
    }

    // 英雄区外围的低地盆地 (半径受噪声调制, 避免完美圆形)
    const double basinHeight = 13.0 + 2.5 * FastNoise(x * 0.03 + 4.4, z * 0.03 - 2.2);
    h = h * (1.0 - basin * 0.75) + basinHeight * (basin * 0.75);
    return std::max(4.0, h);
}

// 软上限: 超过膝点后指数收敛到世界顶部, 避免山尖被硬夹紧削成平台。
int ClampHeight(double h) {
    h = std::max(6.0, h);
    constexpr double kKnee = 200.0;
    const double ceiling = static_cast<double>(kWorldHeight - 8);
    if (h > kKnee) {
        const double span = ceiling - kKnee;
        h = kKnee + span * (1.0 - std::exp(-(h - kKnee) / span));
    }
    return RoundIndex(h);
}

double PatchWeight(const TerrainPatch& patch, double x, double z) {
    const double dx = (x - static_cast<double>(patch.centerX)) / std::max(1.0f, patch.radiusX);
    const double dz = (z - static_cast<double>(patch.centerZ)) / std::max(1.0f, patch.radiusZ);
    const double d = std::sqrt(dx * dx + dz * dz);
    if (d >= 1.0) {
        return 0.0;
    }
    const double inner = std::max(0.0, std::min(0.95, static_cast<double>(patch.inner)));
    return 1.0 - SmoothStep(inner, 1.0, d);
}

} // namespace

double TerrainNoise(double x, double z) {
    return SmoothNoise(x, z);
}

int ProceduralTerrain::HeightAt(int gx, int gz) const {
    const double x = static_cast<double>(gx);
    const double z = static_cast<double>(gz);
    const double dx = x - 40.0;
    const double dz = z - 35.0;
    const double heroDist = std::sqrt(dx * dx + dz * dz);

    double h = MeadowHeight(x, z);
    if (heroDist > 100.0) {
        const double blend = SmoothStep(100.0, 210.0, heroDist);
        h = h * (1.0 - blend) + WildHeight(x, z) * blend;
    }
    return ClampHeight(h);
}

Material ProceduralTerrain::SurfaceAt(int gx, int gz, int height, float slope) const {
    if (height <= kWaterLevel - 1) {
        return Material::Stone;
    }
    if (height >= 190 && slope <= 3.2f) {
        return Material::Snow;
    }
    if (height >= 172 && slope <= 1.4f) {
        return Material::Snow;
    }
    if (height >= 90) {
        // 深色岩层与浅色石层交替, 削弱大面积灰色与规则台阶感。
        const double band = FastNoise(static_cast<double>(gx) * 0.045 + 5.1,
                                      static_cast<double>(gz) * 0.045 - 2.7);
        return band > 0.52 ? Material::Rock : Material::Stone;
    }
    if (slope > 2.2f) {
        return Material::Stone;
    }
    if (height >= 66 && slope > 1.2f) {
        return Material::Stone;
    }
    return Material::Grass;
}

PatchedTerrain::PatchedTerrain(std::shared_ptr<const TerrainSource> base,
                               std::vector<TerrainPatch> patches)
    : base_(std::move(base)), patches_(std::move(patches)) {}

int PatchedTerrain::HeightAt(int gx, int gz) const {
    if (!base_) {
        return 6;
    }
    double h = static_cast<double>(base_->HeightAt(gx, gz));
    for (const TerrainPatch& patch : patches_) {
        h += static_cast<double>(patch.height) * PatchWeight(patch,
                                                             static_cast<double>(gx),
                                                             static_cast<double>(gz));
    }
    return ClampHeight(h);
}

Material PatchedTerrain::SurfaceAt(int gx, int gz, int height, float slope) const {
    return base_ ? base_->SurfaceAt(gx, gz, height, slope) : Material::Stone;
}

namespace {

double TerrainPadWeight(const TerrainPad& pad, double x, double z) {
    const double dx = (x - static_cast<double>(pad.centerX)) / std::max(1.0f, pad.radiusX);
    const double dz = (z - static_cast<double>(pad.centerZ)) / std::max(1.0f, pad.radiusZ);
    const double d = std::sqrt(dx * dx + dz * dz);
    if (d >= 1.0) {
        return 0.0;
    }
    const double inner = std::max(0.0, std::min(0.95, static_cast<double>(pad.inner)));
    return 1.0 - SmoothStep(inner, 1.0, d);
}

} // namespace

LeveledTerrain::LeveledTerrain(std::shared_ptr<const TerrainSource> base,
                               std::vector<TerrainPad> pads)
    : base_(std::move(base)), pads_(std::move(pads)) {}

int LeveledTerrain::HeightAt(int gx, int gz) const {
    if (!base_) {
        return 6;
    }
    double h = static_cast<double>(base_->HeightAt(gx, gz));
    for (const TerrainPad& pad : pads_) {
        const double w = TerrainPadWeight(pad, static_cast<double>(gx), static_cast<double>(gz));
        if (w > 0.0) {
            h = h * (1.0 - w) + static_cast<double>(pad.level) * w;
        }
    }
    return ClampHeight(h);
}

Material LeveledTerrain::SurfaceAt(int gx, int gz, int height, float slope) const {
    return base_ ? base_->SurfaceAt(gx, gz, height, slope) : Material::Stone;
}

EditedTerrain::EditedTerrain(std::shared_ptr<const TerrainSource> base, std::vector<HeightEdit> edits)
    : base_(std::move(base)), edits_(std::move(edits)) {}

int EditedTerrain::HeightAt(int gx, int gz) const {
    if (!base_) {
        return 6;
    }
    double h = static_cast<double>(base_->HeightAt(gx, gz));
    for (const HeightEdit& edit : edits_) {
        const TerrainPatch patch{edit.centerX, edit.centerZ, edit.radiusX, edit.radiusZ, edit.delta, 0.35f};
        h += static_cast<double>(edit.delta) * PatchWeight(patch,
                                                           static_cast<double>(gx),
                                                           static_cast<double>(gz));
    }
    return ClampHeight(h);
}

Material EditedTerrain::SurfaceAt(int gx, int gz, int height, float slope) const {
    return base_ ? base_->SurfaceAt(gx, gz, height, slope) : Material::Stone;
}

} // namespace sw
