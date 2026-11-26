// ============================================================================
// Common.h — SeedWorld 用例的数学与颜色基础设施
// ----------------------------------------------------------------------------
// 只提供本用例真正需要的最小工具集: 三维向量、4x4 矩阵、颜色空间转换。
// 这些类型与平台/渲染后端无关, 供世界生成、网格烘焙与渲染器共用。
// ============================================================================
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace sw {

constexpr float kPi = 3.14159265358979323846f;

inline float Clamp(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}

inline float Lerp(float a, float b, float t) {
    return a + (b - a) * t;
}

// 与 GLSL smoothstep 同语义
inline float SmoothStep(float edge0, float edge1, float x) {
    const float t = Clamp((x - edge0) / (edge1 - edge0), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

struct Vec3 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;

    Vec3() = default;
    constexpr Vec3(float x_, float y_, float z_) : x(x_), y(y_), z(z_) {}
};

inline Vec3 operator+(const Vec3& a, const Vec3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 operator-(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 operator*(const Vec3& a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline Vec3 operator*(float s, const Vec3& a) { return a * s; }
inline Vec3& operator+=(Vec3& a, const Vec3& b) { a.x += b.x; a.y += b.y; a.z += b.z; return a; }

inline float Dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

inline Vec3 Cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}

inline float Length(const Vec3& v) { return std::sqrt(Dot(v, v)); }

inline Vec3 Normalize(const Vec3& v) {
    const float len = Length(v);
    return len > 1e-6f ? v * (1.0f / len) : Vec3{0.0f, 1.0f, 0.0f};
}

inline Vec3 Lerp(const Vec3& a, const Vec3& b, float t) { return a + (b - a) * t; }

// sRGB (0..1) -> 线性空间; 与 three.js Color.setHex 的颜色管理口径一致。
inline float SrgbToLinear(float c) {
    return c <= 0.04045f ? c / 12.92f : std::pow((c + 0.055f) / 1.055f, 2.4f);
}

inline Vec3 SrgbToLinear(const Vec3& c) {
    return {SrgbToLinear(c.x), SrgbToLinear(c.y), SrgbToLinear(c.z)};
}

// 0xRRGGBB -> 线性 RGB
inline Vec3 HexToLinear(uint32_t hex) {
    const Vec3 srgb{
        static_cast<float>((hex >> 16) & 0xFF) / 255.0f,
        static_cast<float>((hex >> 8) & 0xFF) / 255.0f,
        static_cast<float>(hex & 0xFF) / 255.0f};
    return SrgbToLinear(srgb);
}

// 列主序 4x4 矩阵, 与 GLSL mat4 的内存布局一致。
struct Mat4 {
    float m[16] = {};
};

// zeroToOne=true 用于 D3D11/Metal/Vulkan/WGPU (NDC 深度 [0,1]),
// false 用于 GL/GLES (NDC 深度 [-1,1])。
inline Mat4 MakePerspective(float fovYRadians, float aspect, float nearZ, float farZ,
                            bool zeroToOne = false) {
    Mat4 out;
    const float f = 1.0f / std::tan(fovYRadians * 0.5f);
    out.m[0] = f / aspect;
    out.m[5] = f;
    out.m[11] = -1.0f;
    if (zeroToOne) {
        out.m[10] = farZ / (nearZ - farZ);
        out.m[14] = (farZ * nearZ) / (nearZ - farZ);
    } else {
        out.m[10] = (farZ + nearZ) / (nearZ - farZ);
        out.m[14] = (2.0f * farZ * nearZ) / (nearZ - farZ);
    }
    return out;
}

inline Mat4 MakeLookAt(const Vec3& eye, const Vec3& target, const Vec3& up) {
    const Vec3 f = Normalize(target - eye);
    const Vec3 s = Normalize(Cross(f, up));
    const Vec3 u = Cross(s, f);

    Mat4 out;
    out.m[0] = s.x;  out.m[1] = u.x;  out.m[2] = -f.x; out.m[3] = 0.0f;
    out.m[4] = s.y;  out.m[5] = u.y;  out.m[6] = -f.y; out.m[7] = 0.0f;
    out.m[8] = s.z;  out.m[9] = u.z;  out.m[10] = -f.z; out.m[11] = 0.0f;
    out.m[12] = -Dot(s, eye);
    out.m[13] = -Dot(u, eye);
    out.m[14] = Dot(f, eye);
    out.m[15] = 1.0f;
    return out;
}

// 列主序: out = a * b
inline Mat4 Multiply(const Mat4& a, const Mat4& b) {
    Mat4 out;
    for (int col = 0; col < 4; ++col) {
        for (int row = 0; row < 4; ++row) {
            float sum = 0.0f;
            for (int k = 0; k < 4; ++k) {
                sum += a.m[k * 4 + row] * b.m[col * 4 + k];
            }
            out.m[col * 4 + row] = sum;
        }
    }
    return out;
}

} // namespace sw
