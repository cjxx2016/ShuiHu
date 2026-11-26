// ============================================================================
// Renderer.cc — sokol_gfx 多分块资源与绘制实现
// ----------------------------------------------------------------------------
// 资源生命周期:
//   Init()            创建天空球/全屏三角形、着色器、管线、采样器;
//   AddChunk()        为主线程上传一个已烘焙分块的 GPU 资源;
//   EnsureTargets()   按窗口尺寸创建/重建离屏颜色与深度目标;
//   Shutdown()        逆序释放全部分块与全局资源。
// 渲染流程由调用方在 sokol_app 的 frame 回调中驱动。
// ============================================================================
#include "Renderer.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <utility>
#include <vector>

#include "Depend/sokol/sokol_gfx.h"

using mat44_t = sw::Mat4;
#include "shaders/seedworld.glsl.h"

namespace sw {
namespace {

void Fill4(float* dst, const Vec3& v, float w = 0.0f) {
    dst[0] = v.x;
    dst[1] = v.y;
    dst[2] = v.z;
    dst[3] = w;
}

void Fill4(float* dst, float x, float y, float z, float w) {
    dst[0] = x;
    dst[1] = y;
    dst[2] = z;
    dst[3] = w;
}

bool IsValid(sg_resource_state state) {
    return state == SG_RESOURCESTATE_VALID || state == SG_RESOURCESTATE_UNSEALED;
}

void SetError(std::string* error, const char* message) {
    if (error != nullptr && error->empty()) {
        *error = message;
    }
}

sg_buffer MakeVertexBuffer(const void* data, size_t size) {
    sg_buffer_desc desc = {};
    desc.usage.vertex_buffer = true;
    desc.data = sg_range{data, size};
    return sg_make_buffer(&desc);
}

sg_buffer MakeIndexBuffer(const void* data, size_t size) {
    sg_buffer_desc desc = {};
    desc.usage.index_buffer = true;
    desc.data = sg_range{data, size};
    return sg_make_buffer(&desc);
}

struct AttrSpec {
    int location;
    size_t offset;
    sg_vertex_format format;
};

sg_pipeline MakePipeline(const sg_shader& shader, int stride, const AttrSpec* attrs, int attrCount,
                         sg_pixel_format colorFormat, sg_pixel_format depthFormat, bool depthWrite,
                         sg_compare_func depthCompare, sg_cull_mode cull, bool blend,
                         sg_index_type indexType) {
    sg_pipeline_desc desc = {};
    desc.shader = shader;
    desc.layout.buffers[0].stride = stride;
    for (int i = 0; i < attrCount; ++i) {
        desc.layout.attrs[attrs[i].location].buffer_index = 0;
        desc.layout.attrs[attrs[i].location].offset = static_cast<int>(attrs[i].offset);
        desc.layout.attrs[attrs[i].location].format = attrs[i].format;
    }
    desc.primitive_type = SG_PRIMITIVETYPE_TRIANGLES;
    desc.index_type = indexType;
    desc.cull_mode = cull;
    desc.face_winding = SG_FACEWINDING_CCW;
    desc.depth.pixel_format = depthFormat;
    desc.depth.compare = depthCompare;
    desc.depth.write_enabled = depthWrite;
    desc.color_count = 1;
    desc.colors[0].pixel_format = colorFormat;
    if (blend) {
        desc.colors[0].blend.enabled = true;
        desc.colors[0].blend.src_factor_rgb = SG_BLENDFACTOR_SRC_ALPHA;
        desc.colors[0].blend.dst_factor_rgb = SG_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        desc.colors[0].blend.op_rgb = SG_BLENDOP_ADD;
        desc.colors[0].blend.src_factor_alpha = SG_BLENDFACTOR_ONE;
        desc.colors[0].blend.dst_factor_alpha = SG_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        desc.colors[0].blend.op_alpha = SG_BLENDOP_ADD;
    }
    return sg_make_pipeline(&desc);
}

// 生成以原点为中心的天空球 (内表面朝向相机); 半径 1200, 覆盖远景山脊。
void BuildSkySphere(std::vector<Vec3>& vertices, std::vector<uint32_t>& indices) {
    constexpr int kSegments = 64;
    constexpr int kRings = 32;
    constexpr float kRadius = 1200.0f;

    vertices.clear();
    indices.clear();
    vertices.reserve(static_cast<size_t>(kSegments + 1) * (kRings + 1));
    for (int iy = 0; iy <= kRings; ++iy) {
        const float theta = kPi * static_cast<float>(iy) / static_cast<float>(kRings);
        const float y = std::cos(theta) * kRadius;
        const float ringRadius = std::sin(theta) * kRadius;
        for (int ix = 0; ix <= kSegments; ++ix) {
            const float phi = 2.0f * kPi * static_cast<float>(ix) / static_cast<float>(kSegments);
            vertices.push_back(Vec3{ringRadius * std::cos(phi), y, ringRadius * std::sin(phi)});
        }
    }

    // 反向绕序: 从球体内部可见
    for (int iy = 0; iy < kRings; ++iy) {
        for (int ix = 0; ix < kSegments; ++ix) {
            const uint32_t a = static_cast<uint32_t>(iy * (kSegments + 1) + ix);
            const uint32_t b = a + 1;
            const uint32_t c = a + static_cast<uint32_t>(kSegments + 1);
            const uint32_t d = c + 1;
            if (iy != 0) {
                indices.insert(indices.end(), {a, d, b});
            }
            if (iy != kRings - 1) {
                indices.insert(indices.end(), {a, c, d});
            }
        }
    }
}

// 从列主序 view-projection 提取 6 个裁剪面。
void ExtractFrustumPlanes(const Mat4& matrix, float planes[6][4], bool zeroToOneDepth) {
    const float* m = matrix.m;
    const float r0[4] = {m[0], m[4], m[8], m[12]};
    const float r1[4] = {m[1], m[5], m[9], m[13]};
    const float r2[4] = {m[2], m[6], m[10], m[14]};
    const float r3[4] = {m[3], m[7], m[11], m[15]};

    auto setPlane = [&](int index, float a, float b, float c, float d) {
        planes[index][0] = a;
        planes[index][1] = b;
        planes[index][2] = c;
        planes[index][3] = d;
    };
    setPlane(0, r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]);  // left
    setPlane(1, r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]);  // right
    setPlane(2, r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]);  // bottom
    setPlane(3, r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]);  // top
    setPlane(4, r3[0] - r2[0], r3[1] - r2[1], r3[2] - r2[2], r3[3] - r2[3]);  // far
    if (zeroToOneDepth) {
        setPlane(5, r2[0], r2[1], r2[2], r2[3]);                              // near (D3D/Metal)
    } else {
        setPlane(5, r3[0] + r2[0], r3[1] + r2[1], r3[2] + r2[2], r3[3] + r2[3]); // near (GL)
    }
}

bool AabbOutsidePlane(const float plane[4], const Vec3& minP, const Vec3& maxP) {
    const float px = plane[0] >= 0.0f ? maxP.x : minP.x;
    const float py = plane[1] >= 0.0f ? maxP.y : minP.y;
    const float pz = plane[2] >= 0.0f ? maxP.z : minP.z;
    return plane[0] * px + plane[1] * py + plane[2] * pz + plane[3] < 0.0f;
}

} // namespace

bool Renderer::Init(std::string* error) {
    originTopLeft_ = sg_query_features().origin_top_left;
    const sg_backend backend = sg_query_backend();
    zeroToOneDepth_ = backend == SG_BACKEND_D3D11 || backend == SG_BACKEND_METAL_IOS
        || backend == SG_BACKEND_METAL_MACOS || backend == SG_BACKEND_METAL_SIMULATOR
        || backend == SG_BACKEND_WGPU || backend == SG_BACKEND_VULKAN;
    const sg_desc current = sg_query_desc();
    swapchainColorFormat_ = current.environment.defaults.color_format;
    if (swapchainColorFormat_ == SG_PIXELFORMAT_NONE) {
        swapchainColorFormat_ = SG_PIXELFORMAT_RGBA8;
    }
    swapchainDepthFormat_ = current.environment.defaults.depth_format;

    const sg_pixelformat_info sceneInfo = sg_query_pixelformat(SG_PIXELFORMAT_RGBA16F);
    if (!sceneInfo.render || !sceneInfo.filter) {
        sceneColorFormat_ = SG_PIXELFORMAT_RGBA8;
    }

    const float quad[6] = {
        -1.0f, -1.0f,
         3.0f, -1.0f,
        -1.0f,  3.0f,
    };
    quadVb_ = MakeVertexBuffer(quad, sizeof(quad));

    std::vector<Vec3> skyVertices;
    std::vector<uint32_t> skyIndices;
    BuildSkySphere(skyVertices, skyIndices);
    skyVb_ = MakeVertexBuffer(skyVertices.data(), skyVertices.size() * sizeof(Vec3));
    skyIb_ = MakeIndexBuffer(skyIndices.data(), skyIndices.size() * sizeof(uint32_t));
    skyIndexCount_ = static_cast<uint32_t>(skyIndices.size());

    if (!IsValid(sg_query_buffer_state(quadVb_)) || !IsValid(sg_query_buffer_state(skyVb_))
        || !IsValid(sg_query_buffer_state(skyIb_))) {
        SetError(error, "创建天空/全屏缓冲失败");
        return false;
    }

    sg_sampler_desc bleedSamplerDesc = {};
    bleedSamplerDesc.min_filter = SG_FILTER_LINEAR;
    bleedSamplerDesc.mag_filter = SG_FILTER_LINEAR;
    bleedSamplerDesc.wrap_u = SG_WRAP_CLAMP_TO_EDGE;
    bleedSamplerDesc.wrap_v = SG_WRAP_CLAMP_TO_EDGE;
    bleedSamplerDesc.wrap_w = SG_WRAP_CLAMP_TO_EDGE;
    bleedSampler_ = sg_make_sampler(&bleedSamplerDesc);

    sg_sampler_desc sceneSamplerDesc = {};
    sceneSamplerDesc.min_filter = SG_FILTER_LINEAR;
    sceneSamplerDesc.mag_filter = SG_FILTER_LINEAR;
    sceneSamplerDesc.wrap_u = SG_WRAP_CLAMP_TO_EDGE;
    sceneSamplerDesc.wrap_v = SG_WRAP_CLAMP_TO_EDGE;
    sceneSampler_ = sg_make_sampler(&sceneSamplerDesc);

    voxelShader_ = sg_make_shader(seedworld_voxel_shader_desc(sg_query_backend()));
    waterShader_ = sg_make_shader(seedworld_water_shader_desc(sg_query_backend()));
    skyShader_ = sg_make_shader(seedworld_sky_shader_desc(sg_query_backend()));
    postShader_ = sg_make_shader(seedworld_post_shader_desc(sg_query_backend()));

    if (!IsValid(sg_query_shader_state(voxelShader_)) || !IsValid(sg_query_shader_state(waterShader_))
        || !IsValid(sg_query_shader_state(skyShader_)) || !IsValid(sg_query_shader_state(postShader_))
        || !IsValid(sg_query_sampler_state(bleedSampler_))
        || !IsValid(sg_query_sampler_state(sceneSampler_))) {
        SetError(error, "创建着色器/采样器失败");
        return false;
    }

    if (!CreatePipelines(error)) {
        return false;
    }

    initialized_ = true;
    return true;
}

bool Renderer::CreatePipelines(std::string* error) {
    const AttrSpec voxelAttrs[] = {
        {0, offsetof(VoxelVertex, pos), SG_VERTEXFORMAT_FLOAT3},
        {1, offsetof(VoxelVertex, normal), SG_VERTEXFORMAT_FLOAT3},
        {2, offsetof(VoxelVertex, biomeColor), SG_VERTEXFORMAT_FLOAT3},
        {3, offsetof(VoxelVertex, uniformColor), SG_VERTEXFORMAT_FLOAT3},
        {4, offsetof(VoxelVertex, bentNormal), SG_VERTEXFORMAT_FLOAT3},
        {5, offsetof(VoxelVertex, flowMeta), SG_VERTEXFORMAT_FLOAT4},
        {6, offsetof(VoxelVertex, sky), SG_VERTEXFORMAT_FLOAT4},
        {7, offsetof(VoxelVertex, shade), SG_VERTEXFORMAT_FLOAT4},
        {8, offsetof(VoxelVertex, uv), SG_VERTEXFORMAT_FLOAT2},
    };
    voxelPipeline_ = MakePipeline(voxelShader_, sizeof(VoxelVertex), voxelAttrs,
                                  static_cast<int>(std::size(voxelAttrs)), sceneColorFormat_, depthFormat_,
                                  true, SG_COMPAREFUNC_LESS_EQUAL, SG_CULLMODE_BACK, false,
                                  SG_INDEXTYPE_UINT32);

    const AttrSpec waterAttrs[] = {
        {0, offsetof(WaterVertex, pos), SG_VERTEXFORMAT_FLOAT3},
        {1, offsetof(WaterVertex, color), SG_VERTEXFORMAT_FLOAT3},
        {2, offsetof(WaterVertex, depth), SG_VERTEXFORMAT_FLOAT2},
    };
    waterPipeline_ = MakePipeline(waterShader_, sizeof(WaterVertex), waterAttrs,
                                  static_cast<int>(std::size(waterAttrs)), sceneColorFormat_, depthFormat_,
                                  false, SG_COMPAREFUNC_LESS_EQUAL, SG_CULLMODE_NONE, true,
                                  SG_INDEXTYPE_UINT32);

    const AttrSpec quadAttrs[] = {
        {0, 0, SG_VERTEXFORMAT_FLOAT2},
    };
    const AttrSpec skyAttrs[] = {
        {0, 0, SG_VERTEXFORMAT_FLOAT3},
    };
    skyPipeline_ = MakePipeline(skyShader_, 3 * static_cast<int>(sizeof(float)), skyAttrs, 1,
                                sceneColorFormat_, depthFormat_, false, SG_COMPAREFUNC_ALWAYS,
                                SG_CULLMODE_BACK, false, SG_INDEXTYPE_UINT32);

    postPipeline_ = MakePipeline(postShader_, 2 * static_cast<int>(sizeof(float)), quadAttrs, 1,
                                 swapchainColorFormat_, swapchainDepthFormat_, false, SG_COMPAREFUNC_ALWAYS,
                                 SG_CULLMODE_NONE, false, SG_INDEXTYPE_NONE);

    if (!IsValid(sg_query_pipeline_state(voxelPipeline_))
        || !IsValid(sg_query_pipeline_state(waterPipeline_))
        || !IsValid(sg_query_pipeline_state(skyPipeline_))
        || !IsValid(sg_query_pipeline_state(postPipeline_))) {
        SetError(error, "创建渲染管线失败");
        return false;
    }
    return true;
}

void Renderer::DestroyChunk(ChunkGpu& chunk) {
    if (sg_query_view_state(chunk.bleedView) != SG_RESOURCESTATE_INVALID) {
        sg_destroy_view(chunk.bleedView);
    }
    if (sg_query_image_state(chunk.bleedImage) != SG_RESOURCESTATE_INVALID) {
        sg_destroy_image(chunk.bleedImage);
    }
    if (sg_query_buffer_state(chunk.waterIb) != SG_RESOURCESTATE_INVALID) {
        sg_destroy_buffer(chunk.waterIb);
    }
    if (sg_query_buffer_state(chunk.waterVb) != SG_RESOURCESTATE_INVALID) {
        sg_destroy_buffer(chunk.waterVb);
    }
    if (sg_query_buffer_state(chunk.voxelIb) != SG_RESOURCESTATE_INVALID) {
        sg_destroy_buffer(chunk.voxelIb);
    }
    if (sg_query_buffer_state(chunk.voxelVb) != SG_RESOURCESTATE_INVALID) {
        sg_destroy_buffer(chunk.voxelVb);
    }
    chunk = ChunkGpu{};
}

bool Renderer::AddChunk(int chunkX, int chunkZ, int originX, int originZ, const BakeResult& bake,
                        std::string* error) {
    if (bake.vertices.empty() || bake.indices.empty() || bake.bleedRGBA.empty()) {
        SetError(error, "分块烘焙结果为空");
        return false;
    }

    // 先构建新资源, 成功后再替换同键旧分块; 预取块升级时不会出现空洞。
    ChunkGpu chunk;
    chunk.chunkX = chunkX;
    chunk.chunkZ = chunkZ;
    chunk.worldOffset = Vec3{static_cast<float>(originX), 0.0f, static_cast<float>(originZ)};
    chunk.triangles = bake.triangles;
    chunk.voxels = bake.filledVoxels;

    chunk.voxelVb = MakeVertexBuffer(bake.vertices.data(), bake.vertices.size() * sizeof(VoxelVertex));
    chunk.voxelIb = MakeIndexBuffer(bake.indices.data(), bake.indices.size() * sizeof(uint32_t));
    if (!bake.waterVertices.empty() && !bake.waterIndices.empty()) {
        chunk.waterVb = MakeVertexBuffer(bake.waterVertices.data(),
                                         bake.waterVertices.size() * sizeof(WaterVertex));
        chunk.waterIb = MakeIndexBuffer(bake.waterIndices.data(), bake.waterIndices.size() * sizeof(uint32_t));
    }
    chunk.voxelIndexCount = static_cast<uint32_t>(bake.indices.size());
    chunk.waterIndexCount = static_cast<uint32_t>(bake.waterIndices.size());

    sg_image_desc imageDesc = {};
    imageDesc.type = SG_IMAGETYPE_3D;
    imageDesc.width = bake.bleedWidth;
    imageDesc.height = bake.bleedHeight;
    imageDesc.num_slices = bake.bleedDepth;
    imageDesc.pixel_format = SG_PIXELFORMAT_RGBA8;
    imageDesc.data = sg_range{bake.bleedRGBA.data(), bake.bleedRGBA.size()};
    chunk.bleedImage = sg_make_image(&imageDesc);

    sg_view_desc viewDesc = {};
    viewDesc.texture.image = chunk.bleedImage;
    chunk.bleedView = sg_make_view(&viewDesc);

    const bool waterOk = bake.waterIndices.empty()
        || (IsValid(sg_query_buffer_state(chunk.waterVb))
            && IsValid(sg_query_buffer_state(chunk.waterIb)));
    if (!IsValid(sg_query_buffer_state(chunk.voxelVb))
        || !IsValid(sg_query_buffer_state(chunk.voxelIb)) || !waterOk
        || !IsValid(sg_query_image_state(chunk.bleedImage))
        || !IsValid(sg_query_view_state(chunk.bleedView))) {
        DestroyChunk(chunk);
        SetError(error, "创建分块 GPU 资源失败");
        return false;
    }

    RemoveChunk(chunkX, chunkZ);
    chunks_.push_back(std::move(chunk));
    return true;
}

void Renderer::RemoveChunk(int chunkX, int chunkZ) {
    for (size_t i = 0; i < chunks_.size(); ++i) {
        if (chunks_[i].chunkX == chunkX && chunks_[i].chunkZ == chunkZ) {
            DestroyChunk(chunks_[i]);
            chunks_.erase(chunks_.begin() + static_cast<std::ptrdiff_t>(i));
            return;
        }
    }
}

void Renderer::ClearChunks() {
    for (ChunkGpu& chunk : chunks_) {
        DestroyChunk(chunk);
    }
    chunks_.clear();
}

void Renderer::Shutdown() {
    if (!initialized_) {
        return;
    }
    ClearChunks();
    DestroyTargets();
    sg_destroy_pipeline(postPipeline_);
    sg_destroy_pipeline(skyPipeline_);
    sg_destroy_pipeline(waterPipeline_);
    sg_destroy_pipeline(voxelPipeline_);
    sg_destroy_shader(postShader_);
    sg_destroy_shader(skyShader_);
    sg_destroy_shader(waterShader_);
    sg_destroy_shader(voxelShader_);
    sg_destroy_sampler(sceneSampler_);
    sg_destroy_sampler(bleedSampler_);
    sg_destroy_buffer(skyIb_);
    sg_destroy_buffer(skyVb_);
    sg_destroy_buffer(quadVb_);
    initialized_ = false;
}

void Renderer::DestroyTargets() {
    if (sg_query_view_state(colorTexture_) != SG_RESOURCESTATE_INVALID) {
        sg_destroy_view(colorTexture_);
    }
    if (sg_query_view_state(colorAttachment_) != SG_RESOURCESTATE_INVALID) {
        sg_destroy_view(colorAttachment_);
    }
    if (sg_query_view_state(depthAttachment_) != SG_RESOURCESTATE_INVALID) {
        sg_destroy_view(depthAttachment_);
    }
    if (sg_query_image_state(colorImage_) != SG_RESOURCESTATE_INVALID) {
        sg_destroy_image(colorImage_);
    }
    if (sg_query_image_state(depthImage_) != SG_RESOURCESTATE_INVALID) {
        sg_destroy_image(depthImage_);
    }
    colorTexture_ = {};
    colorAttachment_ = {};
    depthAttachment_ = {};
    colorImage_ = {};
    depthImage_ = {};
    targetWidth_ = 0;
    targetHeight_ = 0;
}

bool Renderer::EnsureTargets(int width, int height, std::string* error) {
    const int w = std::max(width, 1);
    const int h = std::max(height, 1);
    if (w == targetWidth_ && h == targetHeight_) {
        return true;
    }
    DestroyTargets();

    {
        sg_image_desc desc = {};
        desc.usage.color_attachment = true;
        desc.width = w;
        desc.height = h;
        desc.pixel_format = sceneColorFormat_;
        colorImage_ = sg_make_image(&desc);
        if (!IsValid(sg_query_image_state(colorImage_))) {
            SetError(error, "创建离屏颜色目标失败");
            DestroyTargets();
            return false;
        }

        sg_view_desc attachment = {};
        attachment.color_attachment.image = colorImage_;
        colorAttachment_ = sg_make_view(&attachment);

        sg_view_desc textureView = {};
        textureView.texture.image = colorImage_;
        colorTexture_ = sg_make_view(&textureView);
    }

    {
        sg_image_desc desc = {};
        desc.usage.depth_stencil_attachment = true;
        desc.width = w;
        desc.height = h;
        desc.pixel_format = depthFormat_;
        depthImage_ = sg_make_image(&desc);
        if (!IsValid(sg_query_image_state(depthImage_))) {
            SetError(error, "创建离屏深度目标失败");
            DestroyTargets();
            return false;
        }

        sg_view_desc attachment = {};
        attachment.depth_stencil_attachment.image = depthImage_;
        depthAttachment_ = sg_make_view(&attachment);
    }

    if (!IsValid(sg_query_view_state(colorAttachment_)) || !IsValid(sg_query_view_state(colorTexture_))
        || !IsValid(sg_query_view_state(depthAttachment_))) {
        SetError(error, "创建离屏目标视图失败");
        DestroyTargets();
        return false;
    }

    targetWidth_ = w;
    targetHeight_ = h;
    return true;
}

sg_pass_action Renderer::MakeSwapchainAction() {
    sg_pass_action action = {};
    action.colors[0].load_action = SG_LOADACTION_CLEAR;
    action.colors[0].clear_value = {0.0f, 0.0f, 0.0f, 1.0f};
    return action;
}

void Renderer::BeginScene() {
    sg_pass pass = {};
    pass.action.colors[0].load_action = SG_LOADACTION_CLEAR;
    pass.action.colors[0].clear_value = {0.0f, 0.0f, 0.0f, 1.0f};
    pass.attachments.colors[0] = colorAttachment_;
    pass.attachments.depth_stencil = depthAttachment_;
    sg_begin_pass(&pass);
}

void Renderer::EndScene() {
    sg_end_pass();
}

void Renderer::DrawScene(const OrbitCamera& camera, const RenderSettings& settings, const SkyState& sky,
                         Vec3 renderOrigin, float time, int viewportWidth, int viewportHeight) {
    const Vec3 eye = camera.Position() - renderOrigin;
    const Vec3 target = camera.target - renderOrigin;
    const float aspect = static_cast<float>(std::max(viewportWidth, 1)) / static_cast<float>(std::max(viewportHeight, 1));
    const Mat4 view = MakeLookAt(eye, target, Vec3{0.0f, 1.0f, 0.0f});
    const Mat4 proj = MakePerspective(camera.fovYRadians, aspect, 0.4f, 1600.0f, zeroToOneDepth_);
    const Mat4 viewProj = Multiply(proj, view);

    stats_ = RenderStats{};
    stats_.loadedChunks = static_cast<int>(chunks_.size());
    for (const ChunkGpu& chunk : chunks_) {
        stats_.loadedVoxels += chunk.voxels;
    }

    float planes[6][4];
    ExtractFrustumPlanes(viewProj, planes, zeroToOneDepth_);
    std::vector<ChunkGpu*> visible;
    visible.reserve(chunks_.size());
    for (ChunkGpu& chunk : chunks_) {
        const Vec3 center = chunk.worldOffset - renderOrigin;
        const Vec3 minP{center.x - WX * 0.5f, 0.0f, center.z - WZ * 0.5f};
        const Vec3 maxP{center.x + WX * 0.5f, static_cast<float>(WY), center.z + WZ * 0.5f};
        bool culled = false;
        for (int i = 0; i < 6; ++i) {
            if (AabbOutsidePlane(planes[i], minP, maxP)) {
                culled = true;
                break;
            }
        }
        if (!culled) {
            visible.push_back(&chunk);
        }
    }

    // 不透明体素由近到远绘制, 让 early-Z 尽早剔除被遮挡片元;
    // 水面后续反向遍历, 保证半透明从远到近混合。
    std::sort(visible.begin(), visible.end(), [&](const ChunkGpu* a, const ChunkGpu* b) {
        const Vec3 da = a->worldOffset - renderOrigin - eye;
        const Vec3 db = b->worldOffset - renderOrigin - eye;
        return Dot(da, da) < Dot(db, db);
    });
    stats_.visibleChunks = static_cast<int>(visible.size());

    // ---- 天空穹顶 (以相机为中心的球体; 保证无限漫游时天空方向稳定) ----
    {
        sky_vs_params_t vs = {};
        vs.mvp = viewProj;
        Fill4(vs.center, eye, 0.0f);

        sky_fs_params_t fs = {};
        Fill4(fs.u_sky_top, sky.topColor);
        Fill4(fs.u_sky_mid, sky.midColor);
        Fill4(fs.u_sky_horizon, sky.horizonColor);
        Fill4(fs.u_sun_color, sky.sunColor, sky.sunIntensity);
        Fill4(fs.u_sun_dir, sky.sunDir);
        Fill4(fs.u_params, sky.sunGlowStr, 0.0f, 0.0f, 0.0f);

        sg_bindings bindings = {};
        bindings.vertex_buffers[0] = skyVb_;
        bindings.index_buffer = skyIb_;

        sg_apply_pipeline(skyPipeline_);
        sg_apply_bindings(&bindings);
        const sg_range skyVsRange{&vs, sizeof(vs)};
        const sg_range skyFsRange{&fs, sizeof(fs)};
        sg_apply_uniforms(UB_sky_vs_params, &skyVsRange);
        sg_apply_uniforms(UB_sky_fs_params, &skyFsRange);
        sg_draw(0, static_cast<int>(skyIndexCount_), 1);
    }

    // ---- 体素分块 ----
    {
        voxel_fs_params_t fs = {};
        Fill4(fs.u_sky_top, sky.topColor);
        Fill4(fs.u_sky_mid, sky.midColor);
        Fill4(fs.u_sky_horizon, sky.horizonColor);
        Fill4(fs.u_ground_bounce, sky.groundBounce);
        Fill4(fs.u_sun_color, sky.sunColor, sky.sunIntensity);
        Fill4(fs.u_sun_dir, sky.sunDir);
        Fill4(fs.u_camera_pos, eye, time);
        Fill4(fs.u_params0, static_cast<float>(settings.mode), static_cast<float>(settings.flowMode),
              settings.flowStr, settings.bentNormal ? 1.0f : 0.0f);
        Fill4(fs.u_params1, settings.colorBleed ? 1.0f : 0.0f, settings.normalBevel ? 1.0f : 0.0f,
              settings.sss ? 1.0f : 0.0f, settings.waterRefr ? 1.0f : 0.0f);
        Fill4(fs.u_params2, settings.seams ? 1.0f : 0.0f, settings.pbrSplit ? 1.0f : 0.0f,
              settings.dirAO ? 1.0f : 0.0f, settings.bloomGlow ? 1.0f : 0.0f);
        Fill4(fs.u_params3, sky.skyAmbMult, sky.sunGlowStr, sky.glowBoost, settings.biome ? 1.0f : 0.0f);
        Fill4(fs.u_vol_min, -WX * 0.5f, 0.0f, -WZ * 0.5f, 0.0f);
        Fill4(fs.u_vol_size, static_cast<float>(WX), static_cast<float>(WY), static_cast<float>(WZ), 0.0f);
        Fill4(fs.u_fog_color, sky.fogColor,
              std::max(settings.fogAmount, settings.fog ? 1.0f : 0.0f));
        Fill4(fs.u_fog_params, sky.fogDensity, 0.0f, 0.0f, 0.0f);

        sg_apply_pipeline(voxelPipeline_);

        if (!visible.empty()) {
            for (ChunkGpu* chunk : visible) {
                voxel_vs_params_t vs = {};
                vs.mvp = viewProj;
                Fill4(vs.chunk_offset, chunk->worldOffset - renderOrigin, 0.0f);
                Fill4(vs.flow_base, renderOrigin, 0.0f);
                Fill4(vs.params, time, settings.wind ? 1.0f : 0.0f, 0.0f, 0.0f);

                // 远端着色 LOD: 仅保留基色/天光/色流/雾, 关闭彩光体积采样、
                // 树冠 SSS 与棱角倒角; 近处仍走完整路径。
                const Vec3 chunkCenter = chunk->worldOffset - renderOrigin;
                const bool far = settings.farLod
                    && Length(chunkCenter - eye) > settings.farLodDistance;
                voxel_fs_params_t chunkFs = fs;
                if (far) {
                    chunkFs.u_params1[0] = 0.0f;
                    chunkFs.u_params1[1] = 0.0f;
                    chunkFs.u_params1[2] = 0.0f;
                }

                sg_bindings bindings = {};
                bindings.vertex_buffers[0] = chunk->voxelVb;
                bindings.index_buffer = chunk->voxelIb;
                bindings.views[VIEW_bleed_tex] = chunk->bleedView;
                bindings.samplers[SMP_bleed_smp] = bleedSampler_;

                sg_apply_bindings(&bindings);
                const sg_range vsRange{&vs, sizeof(vs)};
                const sg_range fsRange{&chunkFs, sizeof(chunkFs)};
                sg_apply_uniforms(UB_voxel_vs_params, &vsRange);
                sg_apply_uniforms(UB_voxel_fs_params, &fsRange);
                sg_draw(0, static_cast<int>(chunk->voxelIndexCount), 1);
                ++stats_.drawCalls;
                stats_.triangles += chunk->triangles;
                stats_.visibleVoxels += chunk->voxels;
            }
        }
    }

    // ---- 水面 (所有分块的不透明体素绘制完成后再统一绘制) ----
    {
        water_fs_params_t fs = {};
        Fill4(fs.u_sky_mid, sky.midColor);
        Fill4(fs.u_sky_horizon, sky.horizonColor);
        Fill4(fs.u_sun_color, sky.sunColor, sky.sunIntensity);
        Fill4(fs.u_sun_dir, sky.sunDir);
        Fill4(fs.u_camera, eye, time);
        Fill4(fs.u_water_params, static_cast<float>(settings.mode), settings.waterRefr ? 1.0f : 0.0f, 0.0f, 0.0f);

        sg_apply_pipeline(waterPipeline_);

        for (auto it = visible.rbegin(); it != visible.rend(); ++it) {
            ChunkGpu* chunk = *it;
            if (chunk->waterIndexCount == 0) {
                continue;
            }
            water_vs_params_t vs = {};
            vs.mvp = viewProj;
            Fill4(vs.chunk_offset, chunk->worldOffset - renderOrigin, 0.0f);
            Fill4(vs.flow_base, renderOrigin, 0.0f);
            Fill4(vs.params, time, 0.0f, 0.0f, 0.0f);

            const Vec3 chunkCenter = chunk->worldOffset - renderOrigin;
            const bool far = settings.farLod
                && Length(chunkCenter - eye) > settings.farLodDistance;
            water_fs_params_t chunkFs = fs;
            if (far) {
                chunkFs.u_water_params[1] = 0.0f; // 远处关闭折射/焦散采样
            }

            sg_bindings bindings = {};
            bindings.vertex_buffers[0] = chunk->waterVb;
            bindings.index_buffer = chunk->waterIb;

            sg_apply_bindings(&bindings);
            const sg_range vsRange{&vs, sizeof(vs)};
            const sg_range fsRange{&chunkFs, sizeof(chunkFs)};
            sg_apply_uniforms(UB_water_vs_params, &vsRange);
            sg_apply_uniforms(UB_water_fs_params, &fsRange);
            sg_draw(0, static_cast<int>(chunk->waterIndexCount), 1);
            ++stats_.drawCalls;
        }
    }
}

void Renderer::DrawPost(bool dof, int width, int height) {
    post_fs_params_t params = {};
    Fill4(params.u_params, 1.0f / static_cast<float>(std::max(width, 1)),
          1.0f / static_cast<float>(std::max(height, 1)), dof ? 1.0f : 0.0f,
          originTopLeft_ ? 1.0f : 0.0f);

    sg_bindings bindings = {};
    bindings.vertex_buffers[0] = quadVb_;
    bindings.views[VIEW_scene_tex] = colorTexture_;
    bindings.samplers[SMP_scene_smp] = sceneSampler_;

    sg_apply_pipeline(postPipeline_);
    sg_apply_bindings(&bindings);
    const sg_range postRange{&params, sizeof(params)};
    sg_apply_uniforms(UB_post_fs_params, &postRange);
    sg_draw(0, 3, 1);
}

} // namespace sw
