// ============================================================================
// SeedWorld.cc — sokol 渲染基础用例 (game 系列第 1 例)
// ----------------------------------------------------------------------------
// 目标: 用 sokol_app + sokol_gfx + sokol_imgui 复现桌面参考场景
//       seedworld-tree-house.html 的"统一色块柔光"体素渲染, 并作为后续
//       真实项目的渲染基座。Windows 使用 D3D11 后端, 其他桌面平台使用
//       GL core; 着色器同时交叉编译到 HLSL5 / GLSL410 / Metal。
//   * 80x80 分块、WY=256 的无界体素世界: 平原/丘陵/山脊/河谷/村庄/庙宇;
//   * 分块流送: 后台烘焙 + 前方预取 + 主线程限量上传 + 视锥剔除 + origin rebase;
//   * 48 射线黄金螺旋天光可见度 + 角点 AO + 弯曲法线烘焙;
//   * 3D 洪水填充彩光溢色纹理 (sampler3D) 与树冠厚度 SSS;
//   * 六种光照模式、物体生态色流、棱角倒角、接缝描线、指数雾;
//   * 昼夜天光时间轴、环绕相机与预设、移轴景深后处理;
//   * 全部 GPU 资源与绘制均通过 sokol_gfx 完成, 界面为 sokol_imgui。
// 操作: 鼠标左键环绕 / 右键或中键平移 / 滚轮缩放; H 隐藏界面; ESC 退出。
// ============================================================================
#include "SeedWorld.h"

#include "Base/Sys/MSConsole.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

// 先引入项目头 (Renderer.h 只引入 sokol_gfx 的声明), 再在下方集中包含
// sokol 实现。这样 sokol_gfx.h 的 implementation 在本翻译单元只展开一次。
#include "Mesher.h"
#include "OrbitCamera.h"
#include "Renderer.h"
#include "Terrain.h"
#include "World.h"
#include "WorldPartition.h"

// ---- sokol (app + gfx) + Dear ImGui (源码方式, 由 xmake Link_imgui 注入) ----
#define SOKOL_IMPL
#if defined(_WIN32)
#define SOKOL_D3D11
#else
#define SOKOL_GLCORE
#endif
#define SOKOL_WIN32_FORCE_MAIN
#include "Depend/sokol/sokol_app.h"
#include "Depend/sokol/sokol_gfx.h"
#include "Depend/sokol/sokol_log.h"
#include "Depend/sokol/sokol_glue.h"

#include "Depend/imgui/imgui.h"
#define SOKOL_IMGUI_IMPL
#include "Depend/sokol/util/sokol_imgui.h"

namespace {

// ============================== 应用状态 ==============================
struct CameraPreset {
    const char* name;
    sw::Vec3 eye;
    sw::Vec3 target;
};

const CameraPreset kCameraPresets[] = {
    {"全景庭院", {50.0f, 41.0f, 66.0f}, {0.0f, 16.0f, 4.0f}},
    {"树冠阴凉", {12.0f, 24.0f, 30.0f}, {-15.0f, 18.0f, -3.0f}},
    {"仰视树冠", {4.0f, 15.0f, 19.0f}, {-14.0f, 21.0f, -4.0f}},
    {"小屋屋檐", {0.0f, 19.0f, 22.0f}, {12.0f, 17.0f, -4.0f}},
    {"溪畔倒影", {35.0f, 18.0f, 42.0f}, {6.0f, 15.0f, 8.0f}},
    {"雪山远眺", {150.0f, 90.0f, 170.0f}, {-40.0f, 45.0f, 0.0f}},
    {"河谷村庄", {366.0f, 102.0f, 198.0f}, {300.0f, 40.0f, 120.0f}},
    {"山脊庙宇", {-323.0f, 216.0f, -17.0f}, {-410.0f, 151.0f, -120.0f}},
};

struct SkyKey {
    float t;
    uint32_t top;
    uint32_t mid;
    uint32_t horizon;
    uint32_t ground;
    uint32_t sun;
    uint32_t fog;
    float sunIntensity;
    float glowBoost;
    float sunGlow;
    float ambMult;
    float fogDensity;
};

// 与参考场景一致的 7 段昼夜关键帧 (上午 10:34 附近为默认)
const SkyKey kSkyKeys[] = {
    {0.20f, 0x203566, 0x6280b8, 0xf0a684, 0x3b4d38, 0xffae70, 0xe39e86, 0.95f, 0.45f, 0.55f, 0.64f, 0.0018f},
    {0.28f, 0x295ca8, 0x74afe6, 0xfad3b4, 0x456140, 0xffd5a2, 0xe6d5cf, 1.28f, 0.28f, 0.42f, 0.60f, 0.0012f},
    {0.46f, 0x2978db, 0x74c6f7, 0xe6f3fc, 0x456347, 0xfff5e0, 0xd8ecfb, 1.52f, 0.14f, 0.24f, 0.58f, 0.0011f},
    {0.68f, 0x32589c, 0x8ea0c9, 0xfcc38e, 0x4d5a3c, 0xffb775, 0xe8b090, 1.38f, 0.36f, 0.56f, 0.63f, 0.0016f},
    {0.75f, 0x3b336b, 0xc25970, 0xffb36b, 0x423146, 0xff9a52, 0xe39e86, 1.25f, 0.68f, 0.75f, 0.66f, 0.0020f},
    {0.85f, 0x16193b, 0x3f336b, 0x9c4e75, 0x24223d, 0xa4baff, 0x2b2c52, 0.78f, 0.95f, 0.42f, 0.72f, 0.0022f},
    {0.94f, 0x050919, 0x0f1c3d, 0x1f3661, 0x1b2740, 0xaad0ff, 0x0c162b, 0.65f, 1.00f, 0.15f, 0.78f, 0.0022f},
};

struct AppState {
    std::shared_ptr<const sw::TerrainSource> terrain;  // 当前地形快照 (可被编辑替换)
    int terrainMinHeight = 0;
    int terrainMaxHeight = 0;
    sw::Renderer renderer;
    sw::OrbitCamera camera;
    sw::RenderSettings settings;

    float timeOfDay = 0.44f;
    float elapsed = 0.0f;
    bool hudVisible = true;
    bool autoOrbit = false;
    bool roam = false;
    bool roamInitialized = false;
    float roamSpeed = 10.0f;
    int startLoadRadius = 2;
    bool verbose = false;
    bool camTargetSet = false;
    bool camYawSet = false;
    bool camPitchSet = false;
    bool camDistSet = false;
    bool camTargetGround = false;   // 将 target.y 吸附到地形高度
    bool cameraLocked = false;      // 固定验证机位: 忽略鼠标环绕/平移/缩放
    int camPreset = -1;
    sw::Vec3 camTarget{};
    float camYaw = 0.0f;
    float camPitch = 0.0f;
    float camDist = 0.0f;
    bool benchMode = false;
    float benchSeconds = 0.0f;
    float benchElapsed = 0.0f;
    float benchStartX = 0.0f;
    float benchFpsAccum = 0.0f;
    int benchFrames = 0;
    int benchPeekLoaded = 0;
    int benchPeekVisible = 0;
    int benchPeekDraws = 0;
    long long benchPeekTriangles = 0;
    long long benchPeekVoxels = 0;
    long long benchPeekLoadedVoxels = 0;
    int benchSlowFrames = 0;        // > 33ms (预热 1s 后统计)
    int benchStallFrames = 0;       // > 50ms
    float benchMaxFrameMs = 0.0f;
    float benchMaxUpdateMs = 0.0f;
    float benchMaxDrawMs = 0.0f;
    float benchMinTargetY = 1.0e9f;
    float benchMaxTargetY = -1.0e9f;
    std::chrono::steady_clock::time_point benchLastFrame{};
    bool benchHaveLastFrame = false;
    bool editDemo = false;          // --edit-demo: 启动后自动演示一次动态地形编辑
    bool editApplied = false;
    float editAtSeconds = 6.0f;
    bool prefetchEnabled = true;    // 预取活动窗口外一圈地表
    bool autoRadius = true;         // 按相机视距/高度自动调整加载半径
    float autoRadiusShrink = 0.0f;  // 缩小半径的滞回计时
    bool noVsync = false;           // 基准测试时关闭垂直同步以测真实吞吐
    int windowWidth = 1280;
    int windowHeight = 820;
    sw::Vec3 lastFocus{};
    bool hasLastFocus = false;
    sw::Vec3 renderOrigin;
    std::unique_ptr<sw::WorldPartition> partition;

    bool mouseDown[3] = {false, false, false};
    float lastMouseX = 0.0f;
    float lastMouseY = 0.0f;

    bool moveForward = false;
    bool moveBack = false;
    bool moveLeft = false;
    bool moveRight = false;
    bool moveDown = false;
    bool moveUp = false;
    bool boost = false;
    float walkHeight = 2.0f;        // 键盘/漫游时目标离地高度

    float fps = 0.0f;
    float fpsAccum = 0.0f;
    int fpsFrames = 0;

    bool ready = false;
    bool targetsFailed = false;
};

AppState gApp;

// ============================== 天光颜色插值 ==============================
sw::SkyState ComputeSkyState(float t) {
    constexpr int kCount = static_cast<int>(sizeof(kSkyKeys) / sizeof(kSkyKeys[0]));
    const SkyKey* k0 = &kSkyKeys[0];
    const SkyKey* k1 = &kSkyKeys[kCount - 1];
    for (int i = 0; i < kCount - 1; ++i) {
        if (t >= kSkyKeys[i].t && t <= kSkyKeys[i + 1].t) {
            k0 = &kSkyKeys[i];
            k1 = &kSkyKeys[i + 1];
            break;
        }
    }
    const float f = (k1->t == k0->t) ? 0.0f : sw::Clamp((t - k0->t) / (k1->t - k0->t), 0.0f, 1.0f);
    auto mixColor = [&](uint32_t a, uint32_t b) {
        return sw::Lerp(sw::HexToLinear(a), sw::HexToLinear(b), f);
    };

    sw::SkyState sky;
    sky.topColor = mixColor(k0->top, k1->top);
    sky.midColor = mixColor(k0->mid, k1->mid);
    sky.horizonColor = mixColor(k0->horizon, k1->horizon);
    sky.groundBounce = mixColor(k0->ground, k1->ground);
    sky.sunColor = mixColor(k0->sun, k1->sun);
    sky.fogColor = mixColor(k0->fog, k1->fog);
    sky.sunIntensity = sw::Lerp(k0->sunIntensity, k1->sunIntensity, f);
    sky.glowBoost = sw::Lerp(k0->glowBoost, k1->glowBoost, f);
    sky.sunGlowStr = sw::Lerp(k0->sunGlow, k1->sunGlow, f);
    sky.skyAmbMult = sw::Lerp(k0->ambMult, k1->ambMult, f);
    sky.fogDensity = sw::Lerp(k0->fogDensity, k1->fogDensity, f);

    // 太阳方位随一天推进, 仰角在 0.16..0.84 区间内走半个正弦
    const float az = sw::Lerp(-1.25f, 1.35f, (t - 0.20f) / 0.72f);
    const float elev = std::max(0.18f, std::sin(sw::Clamp((t - 0.16f) / 0.68f, 0.08f, 0.92f) * sw::kPi) * 0.92f);
    sky.sunDir = sw::Normalize(sw::Vec3{
        std::cos(az), elev * 1.15f, std::sin(az) * 0.75f + 0.45f});
    return sky;
}

// ============================== ImGui 辅助 ==============================
ImVec4 ToImColor(uint32_t hex) {
    return ImVec4(static_cast<float>((hex >> 16) & 0xFF) / 255.0f,
                  static_cast<float>((hex >> 8) & 0xFF) / 255.0f,
                  static_cast<float>(hex & 0xFF) / 255.0f, 1.0f);
}

const char* FindFontFile() {
    static char path[1024] = "";
    const char* candidates[] = {
        "fonts/simhei.ttf",
        "../env/fonts/simhei.ttf",
        "../../env/fonts/simhei.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
    };
    for (const char* candidate : candidates) {
        FILE* fp = std::fopen(candidate, "rb");
        if (fp != nullptr) {
            std::fclose(fp);
            std::strncpy(path, candidate, sizeof(path) - 1);
            path[sizeof(path) - 1] = '\0';
            return path;
        }
    }
    return nullptr;
}

void ApplyDarkStyle() {
    ImGui::StyleColorsDark();
    ImGuiStyle& style = ImGui::GetStyle();
    style.WindowRounding = 12.0f;
    style.ChildRounding = 8.0f;
    style.FrameRounding = 7.0f;
    style.PopupRounding = 8.0f;
    style.GrabRounding = 6.0f;
    style.WindowBorderSize = 1.0f;
    style.FrameBorderSize = 0.0f;
    style.WindowPadding = ImVec2(12.0f, 10.0f);
    style.ItemSpacing = ImVec2(8.0f, 6.0f);

    ImVec4* colors = style.Colors;
    colors[ImGuiCol_WindowBg] = ImVec4(0.055f, 0.070f, 0.098f, 0.94f);
    colors[ImGuiCol_Border] = ImVec4(0.30f, 0.36f, 0.44f, 0.35f);
    colors[ImGuiCol_TitleBg] = ImVec4(0.08f, 0.10f, 0.14f, 0.98f);
    colors[ImGuiCol_TitleBgActive] = ImVec4(0.10f, 0.13f, 0.18f, 0.98f);
    colors[ImGuiCol_Button] = ImVec4(0.16f, 0.22f, 0.27f, 0.95f);
    colors[ImGuiCol_ButtonHovered] = ImVec4(0.22f, 0.34f, 0.36f, 0.98f);
    colors[ImGuiCol_ButtonActive] = ImVec4(0.28f, 0.62f, 0.52f, 1.0f);
    colors[ImGuiCol_CheckMark] = ImVec4(0.45f, 0.88f, 0.62f, 1.0f);
    colors[ImGuiCol_SliderGrab] = ImVec4(0.30f, 0.78f, 0.66f, 1.0f);
    colors[ImGuiCol_SliderGrabActive] = ImVec4(0.55f, 0.95f, 0.75f, 1.0f);
    colors[ImGuiCol_Header] = ImVec4(0.18f, 0.30f, 0.32f, 0.90f);
    colors[ImGuiCol_HeaderHovered] = ImVec4(0.24f, 0.42f, 0.40f, 0.95f);
}

// 在窗口中放置 "当前选中" 效果的小工具
bool ToggleButton(const char* label, bool active) {
    if (active) {
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.26f, 0.62f, 0.50f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.32f, 0.72f, 0.58f, 1.0f));
    }
    const bool clicked = ImGui::Button(label);
    if (active) {
        ImGui::PopStyleColor(2);
    }
    return clicked;
}

bool ModeButton(const char* label, int mode) {
    return ToggleButton(label, gApp.settings.mode == mode);
}

bool FlowButton(const char* label, int flowMode) {
    return ToggleButton(label, gApp.settings.flowMode == flowMode);
}

void ApplyPreset(int preset) {
    sw::RenderSettings& s = gApp.settings;
    switch (preset) {
        case 0:  // 柔和纯色
            s = sw::RenderSettings{};
            s.mode = 3;
            s.biome = false;
            s.flowMode = 0;
            s.bentNormal = false;
            s.colorBleed = false;
            s.normalBevel = false;
            s.sss = false;
            s.waterRefr = false;
            s.dof = false;
            break;
        case 1:  // 博客原版风
            s = sw::RenderSettings{};
            s.mode = 5;
            s.flowMode = 0;
            s.bentNormal = false;
            s.colorBleed = false;
            s.normalBevel = false;
            s.sss = false;
            s.waterRefr = false;
            s.dof = false;
            break;
        case 2:  // 进阶风格化+
            s = sw::RenderSettings{};
            s.mode = 5;
            s.flowMode = 3;
            s.flowStr = 0.78f;
            s.dof = true;
            break;
        case 3:  // 五重塔管线
            s = sw::RenderSettings{};
            s.mode = 4;
            s.biome = false;
            s.flowMode = 0;
            s.waterRefr = false;
            s.dof = false;
            s.pbrSplit = true;
            s.seams = true;
            s.dirAO = true;
            s.fog = true;
            s.bloomGlow = true;
            break;
        default:
            break;
    }
}

// ============================== 地形工具 ==============================
// 在英雄区周围 [-600,600]^2 范围采样地形高度, 供 HUD/基准展示最低/最高点。
void SampleTerrainRange(const sw::TerrainSource& terrain, int* outMin, int* outMax) {
    int lo = sw::kWorldHeight;
    int hi = 0;
    constexpr int kRadius = 600;
    constexpr int kStep = 4;
    for (int z = -kRadius; z <= kRadius; z += kStep) {
        for (int x = -kRadius; x <= kRadius; x += kStep) {
            const int h = terrain.HeightAt(x, z);
            lo = std::min(lo, h);
            hi = std::max(hi, h);
        }
    }
    *outMin = lo;
    *outMax = hi;
}

// 动态地形编辑演示: 在英雄区西侧叠加一次隆起, 并通过 WorldPartition 热替换
// 地形源重建已加载分块。未来编辑器/脚本可复用同一路径。
void ApplyEditDemo() {
    if (gApp.editApplied || !gApp.partition || !gApp.terrain) {
        return;
    }
    std::vector<sw::HeightEdit> edits;
    edits.push_back(sw::HeightEdit{24, 56, 12.0f, 10.0f, 13.0f});
    gApp.terrain = std::make_shared<sw::EditedTerrain>(gApp.terrain, std::move(edits));
    gApp.partition->SetTerrainSource(gApp.terrain);
    gApp.editApplied = true;
    std::printf("[SeedWorld] 动态地形编辑: 英雄区前侧隆起 +13, 分块重建中\n");
}

// ============================== HUD ==============================
struct MaterialSwatch {
    const char* name;
    uint32_t hex;
};

void DrawHud(sw::WorldPartition& partition) {
    ImGuiIO& io = ImGui::GetIO();
    const ImGuiWindowFlags panelFlags = ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_AlwaysAutoResize;

    if (!gApp.hudVisible) {
        ImGui::SetNextWindowPos(ImVec2(12.0f, 12.0f), ImGuiCond_Always);
        ImGui::Begin("##showhud", nullptr, panelFlags);
        if (ImGui::Button("显示界面 (H)")) {
            gApp.hudVisible = true;
        }
        ImGui::End();
        return;
    }

    // ---- 左上信息卡 ----
    ImGui::SetNextWindowPos(ImVec2(12.0f, 12.0f), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(330.0f, 0.0f), ImGuiCond_Always);
    ImGui::Begin("SeedWorld", nullptr, panelFlags);
    ImGui::TextColored(ImVec4(0.55f, 0.92f, 0.66f, 1.0f), "SeedWorld 统一色块柔光渲染");
    ImGui::TextDisabled("树林 x 田园小屋 x 48 射线天光遮蔽");
    ImGui::Spacing();
    const sw::RenderStats& rs = gApp.renderer.Stats();
    ImGui::Text("地形高度: 最低 %d / 最高 %d (世界上限 %d)", gApp.terrainMinHeight,
                gApp.terrainMaxHeight, sw::kWorldHeight);
    ImGui::Text("分块: 加载 %d (预取 %d)  可见 %d  待建 %d", rs.loadedChunks,
                partition.PrefetchedCount(), rs.visibleChunks, partition.PendingCount());
    ImGui::Text("体素: 已加载 %lld / 可见 %lld", rs.loadedVoxels, rs.visibleVoxels);
    ImGui::Text("可见三角: %lld  绘制: %d", rs.triangles, rs.drawCalls);
    ImGui::Text("FPS: %.0f  平均烘焙: %.0f ms", gApp.fps, partition.AverageBakeMilliseconds());
    {
        const int fcx = static_cast<int>(std::floor((gApp.camera.target.x + sw::WX * 0.5f) / sw::WX));
        const int fcz = static_cast<int>(std::floor((gApp.camera.target.z + sw::WZ * 0.5f) / sw::WZ));
        ImGui::Text("焦点块 (%d,%d)  世界 X %.0f", fcx, fcz, gApp.camera.target.x);
    }
    ImGui::Spacing();
    ImGui::TextWrapped("所有材质严格使用单一固定基色; 树冠、墙体、瓦片与木梁的层次来自"
                       "天光可见度、彩光溢色与生态色流, 而非贴图噪点。");
    ImGui::Spacing();
    ImGui::TextDisabled("材质色板");
    const MaterialSwatch swatches[] = {
        {"草", 0x59a645}, {"土", 0x7a5538}, {"石", 0x8f979e}, {"雪", 0xedf2f7},
        {"木", 0x6e472b}, {"叶", 0x82c928}, {"墙", 0xece2cf}, {"瓦", 0xb7543e},
        {"灯", 0xffd888},
    };
    for (int i = 0; i < static_cast<int>(sizeof(swatches) / sizeof(swatches[0])); ++i) {
        if (i > 0) {
            ImGui::SameLine();
        }
        ImGui::ColorButton(swatches[i].name, ToImColor(swatches[i].hex),
                           ImGuiColorEditFlags_NoTooltip | ImGuiColorEditFlags_NoDragDrop, ImVec2(22.0f, 22.0f));
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip("%s  #%06X", swatches[i].name, swatches[i].hex);
        }
    }
    ImGui::End();

    // ---- 右侧控制面板 ----
    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x - 348.0f, 12.0f), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(336.0f, std::max(240.0f, io.DisplaySize.y - 24.0f)), ImGuiCond_Always);
    ImGui::Begin("渲染控制", nullptr, ImGuiWindowFlags_NoCollapse);

    ImGui::TextDisabled("一键方案");
    if (ImGui::Button("柔和纯色", ImVec2(76.0f, 0.0f))) ApplyPreset(0);
    ImGui::SameLine();
    if (ImGui::Button("博客原版", ImVec2(76.0f, 0.0f))) ApplyPreset(1);
    ImGui::SameLine();
    if (ImGui::Button("风格化+", ImVec2(76.0f, 0.0f))) ApplyPreset(2);
    ImGui::SameLine();
    if (ImGui::Button("五重塔", ImVec2(76.0f, 0.0f))) ApplyPreset(3);

    ImGui::Separator();
    ImGui::TextDisabled("天光遮蔽算法");
    if (ModeButton("0 原貌", 0)) gApp.settings.mode = 0;
    ImGui::SameLine();
    if (ModeButton("1 直光+AO", 1)) gApp.settings.mode = 1;
    ImGui::SameLine();
    if (ModeButton("2 逐面48线", 2)) gApp.settings.mode = 2;
    if (ModeButton("3 柔和22.5m", 3)) gApp.settings.mode = 3;
    ImGui::SameLine();
    if (ModeButton("4 五重塔", 4)) gApp.settings.mode = 4;
    ImGui::SameLine();
    if (ModeButton("5 高饱和", 5)) gApp.settings.mode = 5;

    static const char* kModeDesc[] = {
        "关闭全部光照与特效, 展示原始单色块。",
        "平行太阳光 + 灰色环境光 + 一格角点 AO。",
        "原版 SeedWorld 逐面 48 射线 + 顶部遮蔽。",
        "四角平滑的 22.5m 连续天光, 草地树荫最柔和。",
        "五重塔 34 射线 10.5m 量化 SkyGI 口径。",
        "暖阳 -> 冷青暗部色相迁移, 高饱和博客风格。",
    };
    ImGui::TextWrapped("%s", kModeDesc[gApp.settings.mode]);
    ImGui::Checkbox("生态色 (Biome)", &gApp.settings.biome);

    ImGui::Separator();
    ImGui::TextDisabled("物体自动色流");
    if (FlowButton("关闭", 0)) gApp.settings.flowMode = 0;
    ImGui::SameLine();
    if (FlowButton("3D色域", 1)) gApp.settings.flowMode = 1;
    ImGui::SameLine();
    if (FlowButton("高度接地", 2)) gApp.settings.flowMode = 2;
    ImGui::SameLine();
    if (FlowButton("生态复合", 3)) gApp.settings.flowMode = 3;
    int flowPct = static_cast<int>(std::lround(gApp.settings.flowStr * 100.0f));
    if (ImGui::SliderInt("色流力度", &flowPct, 0, 150, "%d%%")) {
        gApp.settings.flowStr = static_cast<float>(flowPct) / 100.0f;
        if (flowPct > 0 && gApp.settings.flowMode == 0) {
            gApp.settings.flowMode = 3;
        }
    }

    ImGui::Separator();
    ImGui::TextDisabled("风格化模块");
    ImGui::Checkbox("弯曲法线", &gApp.settings.bentNormal);
    ImGui::SameLine();
    ImGui::Checkbox("彩光溢色", &gApp.settings.colorBleed);
    ImGui::SameLine();
    ImGui::Checkbox("棱角倒角", &gApp.settings.normalBevel);
    ImGui::Checkbox("树冠SSS", &gApp.settings.sss);
    ImGui::SameLine();
    ImGui::Checkbox("水面透视", &gApp.settings.waterRefr);
    ImGui::SameLine();
    ImGui::Checkbox("移轴景深", &gApp.settings.dof);
    ImGui::Checkbox("PBR分桶", &gApp.settings.pbrSplit);
    ImGui::SameLine();
    ImGui::Checkbox("暗边描线", &gApp.settings.seams);
    ImGui::SameLine();
    ImGui::Checkbox("六向AO", &gApp.settings.dirAO);
    ImGui::Checkbox("指数雾", &gApp.settings.fog);
    ImGui::SameLine();
    ImGui::Checkbox("暖光增强", &gApp.settings.bloomGlow);
    ImGui::Checkbox("风动", &gApp.settings.wind);
    ImGui::SameLine();
    ImGui::Checkbox("远景简化", &gApp.settings.farLod);

    ImGui::Separator();
    ImGui::TextDisabled("昼夜天光");
    ImGui::SliderFloat("时间轴", &gApp.timeOfDay, 0.20f, 0.92f, "");
    if (ImGui::Button("清晨", ImVec2(70.0f, 0.0f))) gApp.timeOfDay = 0.28f;
    ImGui::SameLine();
    if (ImGui::Button("上午", ImVec2(70.0f, 0.0f))) gApp.timeOfDay = 0.44f;
    ImGui::SameLine();
    if (ImGui::Button("日落", ImVec2(70.0f, 0.0f))) gApp.timeOfDay = 0.72f;
    ImGui::SameLine();
    if (ImGui::Button("暮色", ImVec2(70.0f, 0.0f))) gApp.timeOfDay = 0.84f;

    ImGui::Separator();
    ImGui::TextDisabled("相机");
    for (int i = 0; i < static_cast<int>(sizeof(kCameraPresets) / sizeof(kCameraPresets[0])); ++i) {
        if (i > 0 && (i % 3) != 0) {
            ImGui::SameLine();
        }
        if (ImGui::Button(kCameraPresets[i].name, ImVec2(96.0f, 0.0f))) {
            gApp.camera.AnimateTo(kCameraPresets[i].eye, kCameraPresets[i].target, 0.55f);
        }
    }
    {
        const sw::Vec3 eye = gApp.camera.Position();
        ImGui::Text("eye %.0f %.0f %.0f  dist %.0f", eye.x, eye.y, eye.z, gApp.camera.distance);
    }
    ImGui::TextDisabled("WASD 移动  Q/E 降升  Shift 加速");
    ImGui::Checkbox("锁定机位", &gApp.cameraLocked);
    ImGui::SameLine();
    ImGui::Checkbox("自动环绕", &gApp.autoOrbit);
    if (ImGui::Button("隐藏界面 (H)", ImVec2(128.0f, 0.0f))) {
        gApp.hudVisible = false;
    }

    ImGui::Separator();
    ImGui::TextDisabled("世界分区 / 流送");
    ImGui::Checkbox("自动半径 (按视距/高度)", &gApp.autoRadius);
    int loadRadius = partition.LoadRadius();
    if (ImGui::SliderInt("加载半径", &loadRadius, 0, 5)) {
        gApp.autoRadius = false;
        partition.SetLoadRadius(loadRadius);
    }
    bool prefetch = partition.PrefetchEnabled();
    if (ImGui::Checkbox("预取周围 (1 圈)", &prefetch)) {
        partition.SetPrefetch(prefetch);
    }
    ImGui::Text("已构建 %d 块, 平均 %.0f ms/块", partition.BuiltCount(),
                partition.AverageBakeMilliseconds());
    if (ImGui::Button(gApp.editApplied ? "动态编辑已应用" : "隆起演示山丘", ImVec2(150.0f, 0.0f))) {
        ApplyEditDemo();
    }
    ImGui::SameLine();
    ImGui::TextDisabled("(TerrainSource 热替换)");
    ImGui::Checkbox("自动漫游 (向 +X 流送)", &gApp.roam);
    ImGui::SliderFloat("漫游速度", &gApp.roamSpeed, 2.0f, 30.0f, "%.0f m/s");
    if (ImGui::Button("回到英雄区", ImVec2(128.0f, 0.0f))) {
        gApp.camera.SetFromEyeTarget(kCameraPresets[0].eye, kCameraPresets[0].target);
        gApp.renderOrigin = sw::Vec3{};
    }

    ImGui::End();
}

// ============================== sokol 回调 ==============================
void Init() {
    sg_desc desc = {};
    desc.environment = sglue_environment();
    // 每个分块持有 4 个缓冲 + 1 张 3D 纹理; 半径 4 + 预取一圈约 121 块,
    // 并需为升级替换短暂保留新旧两份资源。
    desc.buffer_pool_size = 768;
    desc.image_pool_size = 320;
    desc.view_pool_size = 768;
    desc.uniform_buffer_size = 64 * 1024;
    desc.logger.func = slog_func;
    sg_setup(desc);

    simgui_desc_t imguiDesc = {};
    imguiDesc.logger.func = slog_func;
    imguiDesc.no_default_font = true;
    imguiDesc.max_vertices = 1 << 20;
    simgui_setup(&imguiDesc);

    ImGuiIO& io = ImGui::GetIO();
    const char* fontFile = FindFontFile();
    ImFont* font = nullptr;
    if (fontFile != nullptr) {
        font = io.Fonts->AddFontFromFileTTF(fontFile, 17.0f, nullptr, io.Fonts->GetGlyphRangesChineseFull());
    }
    if (font == nullptr) {
        io.Fonts->AddFontDefault();
    }
    ApplyDarkStyle();

    const auto t0 = std::chrono::steady_clock::now();

    // 地形源组合: 程序化平原/丘陵/山脊/河谷, 再叠加设计补丁。
    // 补丁只改变高度场, 网格/烘焙/着色仍走同一条完整管线。
    auto procedural = std::make_shared<sw::ProceduralTerrain>();
    std::vector<sw::TerrainPatch> patches;
    auto patched = std::make_shared<sw::PatchedTerrain>(std::move(procedural), std::move(patches));

    // 设计平台: 把村庄/庙宇用地平滑拉平到中心高度, 与程序化地形混合。
    std::vector<sw::TerrainPad> pads;
    pads.push_back(sw::TerrainPad{300, 120, 42.0f, 36.0f,
                                  static_cast<float>(patched->HeightAt(300, 120)), 0.55f});
    pads.push_back(sw::TerrainPad{-410, -120, 34.0f, 28.0f,
                                  static_cast<float>(patched->HeightAt(-410, -120)), 0.55f});
    gApp.terrain = std::make_shared<sw::LeveledTerrain>(std::move(patched), std::move(pads));
    SampleTerrainRange(*gApp.terrain, &gApp.terrainMinHeight, &gApp.terrainMaxHeight);
    if (gApp.camTargetSet && gApp.camTargetGround) {
        const int tx = static_cast<int>(std::lround(gApp.camTarget.x));
        const int tz = static_cast<int>(std::lround(gApp.camTarget.z));
        gApp.camTarget.y = static_cast<float>(gApp.terrain->HeightAt(tx, tz)) + 6.0f;
    }

    const auto t1 = std::chrono::steady_clock::now();
    std::printf("[SeedWorld] 地形源就绪 %.0f ms, 高度 %d..%d (世界上限 %d)\n",
                std::chrono::duration<double, std::milli>(t1 - t0).count(),
                gApp.terrainMinHeight, gApp.terrainMaxHeight, sw::kWorldHeight);

    std::string error;
    if (!gApp.renderer.Init(&error)) {
        std::printf("[SeedWorld] 渲染器初始化失败: %s\n", error.c_str());
        std::exit(EXIT_FAILURE);
    }

    gApp.partition = std::make_unique<sw::WorldPartition>(gApp.renderer, gApp.terrain);
    gApp.partition->SetPrefetch(gApp.prefetchEnabled);
    gApp.partition->SetLogging(gApp.verbose);
    const auto t2 = std::chrono::steady_clock::now();
    if (!gApp.partition->BuildNow(0, 0, &error)) {
        std::printf("[SeedWorld] 英雄分块构建失败: %s\n", error.c_str());
        std::exit(EXIT_FAILURE);
    }
    const auto t3 = std::chrono::steady_clock::now();
    std::printf("[SeedWorld] 英雄分块构建+上传 %.0f ms\n",
                std::chrono::duration<double, std::milli>(t3 - t2).count());
    gApp.partition->Start(gApp.startLoadRadius, 4);

    gApp.camera.SetFromEyeTarget(kCameraPresets[0].eye, kCameraPresets[0].target);
    if (gApp.camPreset >= 0) {
        const int count = static_cast<int>(sizeof(kCameraPresets) / sizeof(kCameraPresets[0]));
        const CameraPreset& preset = kCameraPresets[std::min(gApp.camPreset, count - 1)];
        gApp.camera.SetFromEyeTarget(preset.eye, preset.target);
    }
    if (gApp.camTargetSet) {
        gApp.camera.target = gApp.camTarget;
    }
    if (gApp.camYawSet) {
        gApp.camera.yaw = gApp.camYaw;
    }
    if (gApp.camPitchSet) {
        gApp.camera.pitch = gApp.camPitch;
    }
    if (gApp.camDistSet) {
        gApp.camera.distance = gApp.camDist;
    }
    {
        const sw::Vec3 eye = gApp.camera.Position();
        std::fprintf(stderr, "[SeedWorld] 相机 eye=(%.1f,%.1f,%.1f) target=(%.1f,%.1f,%.1f) "
                             "yaw=%.3f pitch=%.3f dist=%.1f\n",
                     eye.x, eye.y, eye.z, gApp.camera.target.x, gApp.camera.target.y,
                     gApp.camera.target.z, gApp.camera.yaw, gApp.camera.pitch,
                     gApp.camera.distance);
    }
    gApp.ready = true;
}

void Frame() {
    const int width = sapp_width();
    const int height = sapp_height();

    const float dt = static_cast<float>(std::min(sapp_frame_duration(), 0.1));
    gApp.elapsed += dt;

    gApp.fpsAccum += dt;
    ++gApp.fpsFrames;
    if (gApp.fpsAccum >= 0.4f) {
        gApp.fps = static_cast<float>(gApp.fpsFrames) / gApp.fpsAccum;
        gApp.fpsAccum = 0.0f;
        gApp.fpsFrames = 0;
    }

    if (!gApp.ready) {
        return;
    }

    if (gApp.editDemo && !gApp.editApplied && gApp.elapsed >= gApp.editAtSeconds) {
        ApplyEditDemo();
    }

    if (gApp.roam) {
        if (!gApp.roamInitialized) {
            gApp.camera.target = sw::Vec3{0.0f, 16.0f, 4.0f};
            gApp.camera.yaw = -1.35f;
            gApp.camera.pitch = 0.30f;
            gApp.camera.distance = 70.0f;
            gApp.settings.fog = true;
            gApp.roamInitialized = true;
        }
        gApp.camera.target.x += gApp.roamSpeed * dt;
        gApp.camera.target.z = 4.0f + std::sin(gApp.elapsed * 0.08f) * 12.0f;
        const int gx = static_cast<int>(std::lround(gApp.camera.target.x));
        const int gz = static_cast<int>(std::lround(gApp.camera.target.z));
        const float ground = static_cast<float>(gApp.terrain->HeightAt(gx, gz));
        const float desiredY = ground + gApp.walkHeight;
        const float blend = 1.0f - std::exp(-dt * 14.0f);
        gApp.camera.target.y = sw::Lerp(gApp.camera.target.y, desiredY, blend);
        if (gApp.camera.target.y < ground + 0.5f) {
            gApp.camera.target.y = ground + 0.5f;
        }
    } else {
        gApp.roamInitialized = false;
        if (!gApp.cameraLocked) {
            const float forward = (gApp.moveForward ? 1.0f : 0.0f) - (gApp.moveBack ? 1.0f : 0.0f);
            const float strafe = (gApp.moveRight ? 1.0f : 0.0f) - (gApp.moveLeft ? 1.0f : 0.0f);
            const float vertical = (gApp.moveUp ? 1.0f : 0.0f) - (gApp.moveDown ? 1.0f : 0.0f);
            if (forward != 0.0f || strafe != 0.0f || vertical != 0.0f) {
                const sw::Vec3 fwd{-std::sin(gApp.camera.yaw), 0.0f, -std::cos(gApp.camera.yaw)};
                const sw::Vec3 right{std::cos(gApp.camera.yaw), 0.0f, -std::sin(gApp.camera.yaw)};
                sw::Vec3 dir = fwd * forward + right * strafe;
                const float dirLen = sw::Length(dir);
                if (dirLen > 1e-4f) {
                    dir = dir * (1.0f / dirLen);
                    const float moveSpeed = (gApp.boost ? 36.0f : 12.0f) * dt;
                    gApp.camera.target.x += dir.x * moveSpeed;
                    gApp.camera.target.z += dir.z * moveSpeed;
                }
                gApp.walkHeight = sw::Clamp(gApp.walkHeight + vertical * 12.0f * dt, 2.0f, 220.0f);
                const int gx = static_cast<int>(std::lround(gApp.camera.target.x));
                const int gz = static_cast<int>(std::lround(gApp.camera.target.z));
                const float ground = static_cast<float>(gApp.terrain->HeightAt(gx, gz));
                const float desiredY = ground + gApp.walkHeight;
                const float blend = 1.0f - std::exp(-dt * 14.0f);
                gApp.camera.target.y = sw::Lerp(gApp.camera.target.y, desiredY, blend);
                if (gApp.camera.target.y < ground + 0.5f) {
                    gApp.camera.target.y = ground + 0.5f;
                }
            }
        }
    }

    gApp.camera.Update(dt, gApp.autoOrbit && !gApp.roam && !gApp.cameraLocked);

    // 相机眼位不得钻进地形: 低于相机所在位置地表时抬高整个环绕目标。
    {
        const sw::Vec3 eye = gApp.camera.Position();
        const int egx = static_cast<int>(std::lround(eye.x));
        const int egz = static_cast<int>(std::lround(eye.z));
        const float eyeGround = static_cast<float>(gApp.terrain->HeightAt(egx, egz));
        if (eye.y < eyeGround + 2.0f) {
            gApp.camera.target.y += eyeGround + 2.0f - eye.y;
        }
    }

    // 相机越高/离目标越远, 看到的区域越大; 半径按视距自动分级, 缩小带滞回。
    if (gApp.autoRadius && gApp.partition) {
        const sw::Vec3 eye = gApp.camera.Position();
        const float range = gApp.camera.distance + std::max(0.0f, eye.y - 20.0f);
        int desired = 2 + static_cast<int>(std::max(0.0f, range - 80.0f) / 90.0f);
        desired = std::max(2, std::min(5, desired));
        const int current = gApp.partition->LoadRadius();
        if (desired > current) {
            gApp.partition->SetLoadRadius(desired);
            gApp.autoRadiusShrink = 0.0f;
        } else if (desired < current) {
            gApp.autoRadiusShrink += dt;
            if (gApp.autoRadiusShrink > 2.0f) {
                gApp.partition->SetLoadRadius(current - 1);
                gApp.autoRadiusShrink = 0.0f;
            }
        } else {
            gApp.autoRadiusShrink = 0.0f;
        }
    }

    const int focusChunkX = static_cast<int>(std::floor((gApp.camera.target.x + sw::WX * 0.5f) / sw::WX));
    const int focusChunkZ = static_cast<int>(std::floor((gApp.camera.target.z + sw::WZ * 0.5f) / sw::WZ));
    gApp.renderOrigin = sw::Vec3{static_cast<float>(focusChunkX * sw::WX), 0.0f,
                                 static_cast<float>(focusChunkZ * sw::WZ)};
    if (gApp.partition) {
        const sw::Vec3 focus = gApp.camera.target;
        sw::Vec3 velocity{};
        if (gApp.hasLastFocus && dt > 1e-5f) {
            velocity = (focus - gApp.lastFocus) * (1.0f / dt);
        }
        gApp.lastFocus = focus;
        gApp.hasLastFocus = true;
        const auto updateStart = std::chrono::steady_clock::now();
        gApp.partition->Update(focus, velocity, 1);
        if (gApp.benchMode && gApp.benchElapsed > 1.0f) {
            const float updateMs = std::chrono::duration<float, std::milli>(
                std::chrono::steady_clock::now() - updateStart).count();
            gApp.benchMaxUpdateMs = std::max(gApp.benchMaxUpdateMs, updateMs);
        }
    }

    // 相机越高, 远景雾化/简化越明显; 地面视角保持清晰。
    const float eyeAltitude = gApp.camera.Position().y;
    const float haze = sw::Clamp((eyeAltitude - 150.0f) / 500.0f, 0.0f, 0.45f);
    gApp.settings.fogAmount = haze;
    gApp.settings.farLodDistance = 320.0f - 70.0f * haze;

    const sw::SkyState sky = ComputeSkyState(gApp.timeOfDay);

    simgui_new_frame({width, height, sapp_frame_duration(), sapp_dpi_scale()});
    DrawHud(*gApp.partition);

    // sokol_imgui 新版拆分为: flush (pass 外整理绘制数据) + draw (pass 内提交)
    simgui_flush();

    std::string error;
    if (!gApp.renderer.EnsureTargets(width, height, &error)) {
        if (!gApp.targetsFailed) {
            std::printf("[SeedWorld] 离屏目标创建失败: %s\n", error.c_str());
            gApp.targetsFailed = true;
        }
        return;
    }
    gApp.renderer.BeginScene();
    const auto drawStart = std::chrono::steady_clock::now();
    gApp.renderer.DrawScene(gApp.camera, gApp.settings, sky, gApp.renderOrigin, gApp.elapsed,
                            width, height);
    if (gApp.benchMode && gApp.benchElapsed > 1.0f) {
        const float drawMs = std::chrono::duration<float, std::milli>(
            std::chrono::steady_clock::now() - drawStart).count();
        gApp.benchMaxDrawMs = std::max(gApp.benchMaxDrawMs, drawMs);
    }
    gApp.renderer.EndScene();

    sg_pass swapPass = {};
    swapPass.action = sw::Renderer::MakeSwapchainAction();
    swapPass.swapchain = sglue_swapchain();
    sg_begin_pass(&swapPass);
    gApp.renderer.DrawPost(gApp.settings.dof, width, height);
    simgui_draw();
    sg_end_pass();
    sg_commit();

    if (gApp.benchMode && gApp.ready) {
        if (gApp.benchElapsed == 0.0f) {
            gApp.benchStartX = gApp.camera.target.x;
        }
        gApp.benchElapsed += dt;
        gApp.benchFpsAccum += dt;
        ++gApp.benchFrames;
        // 用真实帧间隔统计卡顿, 并跳过前 1s 的管线/窗口预热。
        const auto frameNow = std::chrono::steady_clock::now();
        if (gApp.benchHaveLastFrame && gApp.benchElapsed > 1.0f) {
            const float frameMs = std::chrono::duration<float, std::milli>(
                frameNow - gApp.benchLastFrame).count();
            gApp.benchMaxFrameMs = std::max(gApp.benchMaxFrameMs, frameMs);
            if (frameMs > 33.3f) {
                ++gApp.benchSlowFrames;
            }
            if (frameMs > 50.0f) {
                ++gApp.benchStallFrames;
            }
        }
        gApp.benchLastFrame = frameNow;
        gApp.benchHaveLastFrame = true;
        const sw::RenderStats& stats = gApp.renderer.Stats();
        gApp.benchPeekLoaded = std::max(gApp.benchPeekLoaded, gApp.partition->LoadedCount());
        gApp.benchPeekVisible = std::max(gApp.benchPeekVisible, stats.visibleChunks);
        gApp.benchPeekDraws = std::max(gApp.benchPeekDraws, stats.drawCalls);
        gApp.benchPeekTriangles = std::max(gApp.benchPeekTriangles, stats.triangles);
        gApp.benchPeekVoxels = std::max(gApp.benchPeekVoxels, stats.visibleVoxels);
        gApp.benchPeekLoadedVoxels = std::max(gApp.benchPeekLoadedVoxels, stats.loadedVoxels);
        gApp.benchMinTargetY = std::min(gApp.benchMinTargetY, gApp.camera.target.y);
        gApp.benchMaxTargetY = std::max(gApp.benchMaxTargetY, gApp.camera.target.y);
        if (gApp.benchElapsed >= gApp.benchSeconds) {
            const double avgFps = gApp.benchFpsAccum > 0.0
                ? static_cast<double>(gApp.benchFrames) / gApp.benchFpsAccum : 0.0;
            std::fprintf(stderr,
                         "[BENCH] time=%.1fs distance=%.0fm loadedPeak=%d visiblePeak=%d "
                         "loadedVoxelsPeak=%lld visibleVoxelsPeak=%lld visibleTrisPeak=%lld "
                         "drawsPeak=%d avgFps=%.0f slow33=%d stall50=%d maxFrame=%.0fms "
                         "maxUpdate=%.0fms maxDraw=%.0fms targetY=%.0f..%.0f "
                         "chunksBuilt=%d avgBake=%.0fms worldHeight=%d terrainMin=%d terrainMax=%d\n",
                         gApp.benchElapsed, gApp.camera.target.x - gApp.benchStartX,
                         gApp.benchPeekLoaded, gApp.benchPeekVisible,
                         gApp.benchPeekLoadedVoxels, gApp.benchPeekVoxels,
                         gApp.benchPeekTriangles, gApp.benchPeekDraws, avgFps,
                         gApp.benchSlowFrames, gApp.benchStallFrames, gApp.benchMaxFrameMs,
                         gApp.benchMaxUpdateMs, gApp.benchMaxDrawMs,
                         gApp.benchMinTargetY, gApp.benchMaxTargetY,
                         gApp.partition->BuiltCount(), gApp.partition->AverageBakeMilliseconds(),
                         sw::kWorldHeight, gApp.terrainMinHeight, gApp.terrainMaxHeight);
            gApp.benchMode = false;
            sapp_request_quit();
        }
    }
}

void Cleanup() {
    if (gApp.partition) {
        gApp.partition->Stop();
        gApp.partition.reset();
    }
    if (gApp.ready) {
        gApp.renderer.Shutdown();
    }
    simgui_shutdown();
    sg_shutdown();
}

void Input(const sapp_event* event) {
    // WASD/QE/Shift 在 ImGui 之前处理: 常驻 HUD 窗口不应吞掉移动键。
    const bool keyEvent = event->type == SAPP_EVENTTYPE_KEY_DOWN
        || event->type == SAPP_EVENTTYPE_KEY_UP;
    if (keyEvent) {
        const bool down = event->type == SAPP_EVENTTYPE_KEY_DOWN;
        switch (event->key_code) {
            case SAPP_KEYCODE_W: gApp.moveForward = down; break;
            case SAPP_KEYCODE_S: gApp.moveBack = down; break;
            case SAPP_KEYCODE_A: gApp.moveLeft = down; break;
            case SAPP_KEYCODE_D: gApp.moveRight = down; break;
            case SAPP_KEYCODE_Q: gApp.moveDown = down; break;
            case SAPP_KEYCODE_E: gApp.moveUp = down; break;
            case SAPP_KEYCODE_LEFT_SHIFT:
            case SAPP_KEYCODE_RIGHT_SHIFT: gApp.boost = down; break;
            default: break;
        }
        if (down && event->key_code == SAPP_KEYCODE_H) {
            gApp.hudVisible = !gApp.hudVisible;
        } else if (down && event->key_code == SAPP_KEYCODE_ESCAPE) {
            sapp_request_quit();
        }
    } else if (event->type == SAPP_EVENTTYPE_UNFOCUSED) {
        gApp.moveForward = gApp.moveBack = gApp.moveLeft = gApp.moveRight = false;
        gApp.moveUp = gApp.moveDown = gApp.boost = false;
        gApp.mouseDown[0] = gApp.mouseDown[1] = gApp.mouseDown[2] = false;
    }

    if (simgui_handle_event(event)) {
        return;
    }
    if (keyEvent || event->type == SAPP_EVENTTYPE_UNFOCUSED) {
        return;
    }

    switch (event->type) {
        case SAPP_EVENTTYPE_MOUSE_DOWN:
            if (gApp.cameraLocked) {
                break;
            }
            if (event->mouse_button < 3) {
                gApp.mouseDown[event->mouse_button] = true;
                gApp.lastMouseX = event->mouse_x;
                gApp.lastMouseY = event->mouse_y;
            }
            break;
        case SAPP_EVENTTYPE_MOUSE_UP:
            if (event->mouse_button < 3) {
                gApp.mouseDown[event->mouse_button] = false;
            }
            break;
        case SAPP_EVENTTYPE_MOUSE_MOVE: {
            if (gApp.cameraLocked) {
                break;
            }
            const float dx = event->mouse_x - gApp.lastMouseX;
            const float dy = event->mouse_y - gApp.lastMouseY;
            if (gApp.mouseDown[0]) {
                gApp.camera.Orbit(dx, dy);
            } else if (gApp.mouseDown[1] || gApp.mouseDown[2]) {
                gApp.camera.Pan(dx, dy, sapp_height());
            }
            gApp.lastMouseX = event->mouse_x;
            gApp.lastMouseY = event->mouse_y;
            break;
        }
        case SAPP_EVENTTYPE_MOUSE_SCROLL:
            if (!gApp.cameraLocked) {
                gApp.camera.Zoom(event->scroll_y);
            }
            break;
        default:
            break;
    }
}

} // namespace

// ============================== 入口 ==============================
void SeedWorld(int argc, char** argv) {
    // 可选命令行参数, 便于批量验证与集成测试:
    //   --mode N     天光遮蔽模式 0..5
    //   --preset N   一键方案 0..3
    //   --tod F      昼夜时间 0.20..0.92
    //   --radius N   固定分块加载半径 0..5 (会关闭自动半径)
    //   --no-prefetch 关闭活动窗口外一圈预取
    //   --roam       沿 +X 自动漫游
    //   --speed N    漫游速度 m/s (2..30)
    //   --bench N    漫游 N 秒并打印 BENCH 汇总
    //   --no-vsync   关闭垂直同步 (仅基准)
    //   --width/--height N  基准窗口尺寸
    //   --edit-demo  启动 6s 后演示一次动态地形编辑 (TerrainSource 热替换)
    //   --camera N   相机预设 (5=雪山远眺, 6=河谷村庄, 7=山脊庙宇)
    //   --lock-camera 锁定机位, 忽略鼠标对相机的扰动 (批量截图/基准)
    //   --verbose    打印分块加载/卸载日志
    //   --fog/--no-wind/--no-far-lod
    //   --target X Z / --target-ground / --yaw / --pitch / --dist  固定验证机位
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--mode") == 0 && i + 1 < argc) {
            const int mode = std::atoi(argv[i + 1]);
            gApp.settings.mode = std::max(0, std::min(5, mode));
            ++i;
        } else if (std::strcmp(argv[i], "--preset") == 0 && i + 1 < argc) {
            const int preset = std::atoi(argv[i + 1]);
            ApplyPreset(std::max(0, std::min(3, preset)));
            ++i;
        } else if (std::strcmp(argv[i], "--tod") == 0 && i + 1 < argc) {
            gApp.timeOfDay = std::max(0.20f, std::min(0.92f, static_cast<float>(std::atof(argv[i + 1]))));
            ++i;
        } else if (std::strcmp(argv[i], "--radius") == 0 && i + 1 < argc) {
            gApp.startLoadRadius = std::max(0, std::min(5, std::atoi(argv[i + 1])));
            gApp.autoRadius = false;
            ++i;
        } else if (std::strcmp(argv[i], "--roam") == 0) {
            gApp.roam = true;
        } else if (std::strcmp(argv[i], "--no-prefetch") == 0) {
            gApp.prefetchEnabled = false;
        } else if (std::strcmp(argv[i], "--no-vsync") == 0) {
            gApp.noVsync = true;
        } else if (std::strcmp(argv[i], "--width") == 0 && i + 1 < argc) {
            gApp.windowWidth = std::max(320, std::min(2560, std::atoi(argv[i + 1])));
            ++i;
        } else if (std::strcmp(argv[i], "--height") == 0 && i + 1 < argc) {
            gApp.windowHeight = std::max(200, std::min(1600, std::atoi(argv[i + 1])));
            ++i;
        } else if (std::strcmp(argv[i], "--speed") == 0 && i + 1 < argc) {
            gApp.roamSpeed = std::max(2.0f, std::min(30.0f, static_cast<float>(std::atof(argv[i + 1]))));
            ++i;
        } else if (std::strcmp(argv[i], "--no-wind") == 0) {
            gApp.settings.wind = false;
        } else if (std::strcmp(argv[i], "--no-far-lod") == 0) {
            gApp.settings.farLod = false;
        } else if (std::strcmp(argv[i], "--edit-demo") == 0) {
            gApp.editDemo = true;
        } else if (std::strcmp(argv[i], "--lock-camera") == 0) {
            gApp.cameraLocked = true;
        } else if (std::strcmp(argv[i], "--camera") == 0 && i + 1 < argc) {
            gApp.camPreset = std::max(0, std::atoi(argv[i + 1]));
            gApp.cameraLocked = true;
            ++i;
        } else if (std::strcmp(argv[i], "--edit-at") == 0 && i + 1 < argc) {
            gApp.editAtSeconds = std::max(1.0f, static_cast<float>(std::atof(argv[i + 1])));
            gApp.editDemo = true;
            ++i;
        } else if (std::strcmp(argv[i], "--verbose") == 0) {
            gApp.verbose = true;
        } else if (std::strcmp(argv[i], "--fog") == 0) {
            gApp.settings.fog = true;
        } else if (std::strcmp(argv[i], "--target") == 0 && i + 2 < argc) {
            gApp.camTarget = sw::Vec3{static_cast<float>(std::atof(argv[i + 1])), 16.0f,
                                      static_cast<float>(std::atof(argv[i + 2]))};
            gApp.camTargetSet = true;
            gApp.cameraLocked = true;
            i += 2;
        } else if (std::strcmp(argv[i], "--target-ground") == 0) {
            gApp.camTargetGround = true;
        } else if (std::strcmp(argv[i], "--yaw") == 0 && i + 1 < argc) {
            gApp.camYaw = static_cast<float>(std::atof(argv[i + 1]));
            gApp.camYawSet = true;
            gApp.cameraLocked = true;
            ++i;
        } else if (std::strcmp(argv[i], "--pitch") == 0 && i + 1 < argc) {
            gApp.camPitch = static_cast<float>(std::atof(argv[i + 1]));
            gApp.camPitchSet = true;
            gApp.cameraLocked = true;
            ++i;
        } else if (std::strcmp(argv[i], "--dist") == 0 && i + 1 < argc) {
            gApp.camDist = static_cast<float>(std::atof(argv[i + 1]));
            gApp.camDistSet = true;
            gApp.cameraLocked = true;
            ++i;
        } else if (std::strcmp(argv[i], "--bench") == 0 && i + 1 < argc) {
            gApp.benchMode = true;
            gApp.benchSeconds = std::max(1.0f, static_cast<float>(std::atof(argv[i + 1])));
            gApp.roam = true;
            gApp.cameraLocked = true;
            ++i;
        }
    }
}

sapp_desc sokol_main(int argc, char* argv[]) {
    MSConsole::EnableConsoleUTF8Code();
    SeedWorld(argc, argv);

    sapp_desc desc = {};
    desc.init_cb = Init;
    desc.frame_cb = Frame;
    desc.cleanup_cb = Cleanup;
    desc.event_cb = Input;
    desc.width = gApp.windowWidth;
    desc.height = gApp.windowHeight;
    desc.window_title = "SeedWorld 体素树屋 · sokol 渲染基础用例";
    desc.enable_clipboard = true;
    desc.swap_interval = gApp.noVsync ? 0 : 1;
    desc.logger.func = slog_func;
    desc.win32.console_attach = true;
    return desc;
}
