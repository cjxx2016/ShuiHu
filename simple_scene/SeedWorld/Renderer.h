// ============================================================================
// Renderer.h — sokol_gfx 多分块渲染器
// ----------------------------------------------------------------------------
// 每个世界分块拥有独立的顶点/索引缓冲、水面网格与 3D 彩光溢色纹理;
// 渲染时按相机视锥剔除, 逐块设置 "分块偏移" uniform 后绘制。
// 顶点位置是分块局部坐标 [-40,40], 着色器加 chunk_offset 得到渲染坐标;
// 彩光溢色与生态色流使用局部/全局两套坐标, 因此分块拼接与 origin rebase
// 都不会产生纹理跳变。
// 渲染阶段: sky -> 所有分块体素 -> 所有分块水面 -> post -> ImGui。
// ============================================================================
#pragma once

#include <string>
#include <vector>

#include "Common.h"
#include "Mesher.h"
#include "OrbitCamera.h"

#include "Depend/sokol/sokol_gfx.h"

namespace sw {

// 与 HUD 一一对应的渲染开关
struct RenderSettings {
    int mode = 5;                 // 0..5, 与参考场景的六种光照模式一致
    int flowMode = 3;             // 0=关, 1=3D色域, 2=高度接地, 3=生态复合
    float flowStr = 0.78f;
    bool biome = true;
    bool bentNormal = true;
    bool colorBleed = true;
    bool normalBevel = true;
    bool sss = true;
    bool waterRefr = true;
    bool dof = true;
    bool pbrSplit = false;
    bool seams = false;
    bool dirAO = false;
    bool bloomGlow = false;
    bool fog = false;
    bool wind = true;
    bool farLod = true;           // 远处分块关闭彩光/SSS/倒角等昂贵着色
    float farLodDistance = 300.0f; // 远端着色 LOD 距离 (m), 随相机高度微调
    float fogAmount = 0.0f;       // 高度雾补充 0..0.85 (0 = 关闭, 1 = 强制)
};

struct SkyState {
    Vec3 topColor{0.024f, 0.184f, 0.716f};
    Vec3 midColor{0.184f, 0.554f, 0.916f};
    Vec3 horizonColor{0.780f, 0.900f, 0.976f};
    Vec3 groundBounce{0.060f, 0.130f, 0.063f};
    Vec3 sunColor{1.0f, 0.936f, 0.780f};
    Vec3 sunDir{0.6f, 0.65f, 0.45f};
    Vec3 fogColor{0.710f, 0.840f, 0.960f};
    float sunIntensity = 1.52f;
    float glowBoost = 0.14f;
    float sunGlowStr = 0.24f;
    float skyAmbMult = 0.58f;
    float fogDensity = 0.0011f;
};

struct RenderStats {
    int loadedChunks = 0;
    int visibleChunks = 0;
    int drawCalls = 0;
    long long triangles = 0;
    long long loadedVoxels = 0;
    long long visibleVoxels = 0;
};

class Renderer {
public:
    bool Init(std::string* error);
    void Shutdown();

    // --- 分块生命周期 (主线程, 渲染 pass 外调用) ---
    bool AddChunk(int chunkX, int chunkZ, int originX, int originZ, const BakeResult& bake,
                  std::string* error);
    void RemoveChunk(int chunkX, int chunkZ);
    void ClearChunks();
    int ChunkCount() const { return static_cast<int>(chunks_.size()); }

    bool EnsureTargets(int width, int height, std::string* error);

    void BeginScene();
    void DrawScene(const OrbitCamera& camera, const RenderSettings& settings,
                   const SkyState& sky, Vec3 renderOrigin, float time, int viewportWidth,
                   int viewportHeight);
    void EndScene();

    void DrawPost(bool dof, int width, int height);

    static sg_pass_action MakeSwapchainAction();
    const RenderStats& Stats() const { return stats_; }

private:
    struct ChunkGpu {
        int chunkX = 0;
        int chunkZ = 0;
        Vec3 worldOffset;
        sg_buffer voxelVb{};
        sg_buffer voxelIb{};
        sg_buffer waterVb{};
        sg_buffer waterIb{};
        sg_image bleedImage{};
        sg_view bleedView{};
        uint32_t voxelIndexCount = 0;
        uint32_t waterIndexCount = 0;
        int triangles = 0;
        int voxels = 0;
    };

    bool CreatePipelines(std::string* error);
    void DestroyTargets();
    void DestroyChunk(ChunkGpu& chunk);

    sg_buffer quadVb_{};
    sg_buffer skyVb_{};
    sg_buffer skyIb_{};

    sg_sampler bleedSampler_{};
    sg_image colorImage_{};
    sg_view colorAttachment_{};
    sg_view colorTexture_{};
    sg_image depthImage_{};
    sg_view depthAttachment_{};
    sg_sampler sceneSampler_{};

    sg_shader voxelShader_{};
    sg_shader waterShader_{};
    sg_shader skyShader_{};
    sg_shader postShader_{};

    sg_pipeline voxelPipeline_{};
    sg_pipeline waterPipeline_{};
    sg_pipeline skyPipeline_{};
    sg_pipeline postPipeline_{};

    std::vector<ChunkGpu> chunks_;

    sg_pixel_format sceneColorFormat_ = SG_PIXELFORMAT_RGBA16F;
    sg_pixel_format swapchainColorFormat_ = SG_PIXELFORMAT_RGBA8;
    sg_pixel_format swapchainDepthFormat_ = SG_PIXELFORMAT_DEPTH;
    sg_pixel_format depthFormat_ = SG_PIXELFORMAT_DEPTH;
    bool originTopLeft_ = false;
    bool zeroToOneDepth_ = false;

    int targetWidth_ = 0;
    int targetHeight_ = 0;
    uint32_t skyIndexCount_ = 0;
    RenderStats stats_{};
    bool initialized_ = false;
};

} // namespace sw
