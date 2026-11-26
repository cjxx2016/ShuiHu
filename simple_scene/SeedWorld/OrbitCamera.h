// ============================================================================
// OrbitCamera.h — 球面环绕相机
// ----------------------------------------------------------------------------
// 以 target 为中心, 用 yaw/pitch/distance 描述相机; 支持鼠标环绕、缩放、平移,
// 自动环绕以及相机预设之间的平滑过渡。投影采用与参考场景一致的 44° 视场,
// 右手坐标系, 近远裁剪面 0.4 / 500。
// ============================================================================
#pragma once

#include <algorithm>
#include <cmath>

#include "Common.h"

namespace sw {

struct OrbitCamera {
    Vec3 target{0.0f, 16.0f, 4.0f};
    float yaw = 0.678f;        // 绕 Y 轴
    float pitch = 0.306f;      // 仰角
    float distance = 82.9f;
    float fovYRadians = 44.0f * kPi / 180.0f;

    Vec3 Position() const {
        const float cp = std::cos(pitch);
        return target + Vec3{cp * std::sin(yaw), std::sin(pitch), cp * std::cos(yaw)} * distance;
    }

    Mat4 ViewProjection(float aspect, bool zeroToOneDepth) const {
        const Mat4 view = MakeLookAt(Position(), target, Vec3{0.0f, 1.0f, 0.0f});
        const Mat4 proj = MakePerspective(fovYRadians, aspect, 0.4f, 1600.0f, zeroToOneDepth);
        return Multiply(proj, view);
    }

    void SetFromEyeTarget(const Vec3& eye, const Vec3& newTarget) {
        target = newTarget;
        const Vec3 delta = eye - target;
        distance = std::max(Length(delta), 1e-3f);
        pitch = std::asin(Clamp(delta.y / distance, -1.0f, 1.0f));
        yaw = std::atan2(delta.x, delta.z);
        animActive_ = false;
    }

    void Orbit(float dxPixels, float dyPixels) {
        animActive_ = false;
        yaw -= dxPixels * 0.0055f;
        pitch = Clamp(pitch - dyPixels * 0.0055f, 0.04f, 1.52f);
    }

    void Zoom(float wheelSteps) {
        animActive_ = false;
        distance = Clamp(distance * std::exp(-wheelSteps * 0.12f), 12.0f, 135.0f);
    }

    void Pan(float dxPixels, float dyPixels, int viewportHeight) {
        animActive_ = false;
        const Vec3 forward = Normalize(target - Position());
        const Vec3 right = Normalize(Cross(forward, Vec3{0.0f, 1.0f, 0.0f}));
        const Vec3 up = Cross(right, forward);
        const float scale = distance * 0.0016f * (static_cast<float>(std::max(viewportHeight, 1)) / 720.0f);
        target += right * (-dxPixels * scale) + up * (dyPixels * scale);
    }

    void AnimateTo(const Vec3& eye, const Vec3& newTarget, float duration) {
        animStartEye_ = Position();
        animStartTarget_ = target;
        animEndEye_ = eye;
        animEndTarget_ = newTarget;
        animDuration_ = std::max(duration, 1e-3f);
        animElapsed_ = 0.0f;
        animActive_ = true;
    }

    void Update(float dt, bool autoOrbit) {
        if (animActive_) {
            animElapsed_ += dt;
            const float t = Clamp(animElapsed_ / animDuration_, 0.0f, 1.0f);
            const float s = t * t * (3.0f - 2.0f * t);
            SetFromEyeTargetInterpolated(Lerp(animStartEye_, animEndEye_, s),
                                         Lerp(animStartTarget_, animEndTarget_, s));
            if (t >= 1.0f) {
                animActive_ = false;
            }
            return;
        }
        if (autoOrbit) {
            // 与 OrbitControls(autoRotateSpeed=0.7) 近似的角速度
            yaw += dt * 0.0733f;
        }
    }

private:
    void SetFromEyeTargetInterpolated(const Vec3& eye, const Vec3& newTarget) {
        target = newTarget;
        const Vec3 delta = eye - target;
        const float dist = Length(delta);
        if (dist < 1e-3f) {
            return;
        }
        distance = dist;
        pitch = std::asin(Clamp(delta.y / dist, -1.0f, 1.0f));
        yaw = std::atan2(delta.x, delta.z);
    }

    bool animActive_ = false;
    float animElapsed_ = 0.0f;
    float animDuration_ = 1.0f;
    Vec3 animStartEye_{};
    Vec3 animStartTarget_{};
    Vec3 animEndEye_{};
    Vec3 animEndTarget_{};
};

} // namespace sw
