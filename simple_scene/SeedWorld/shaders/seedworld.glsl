// ============================================================================
// seedworld.glsl — SeedWorld 用例的全部着色器 (sokol-shdc 注解语法)
// ----------------------------------------------------------------------------
// 程序:
//   voxel — 体素表面: 五种光照模式 + 物体色流 + 弯曲法线 + 棱角倒角 +
//           3D 彩光溢色 + 树冠厚度 SSS + 接缝描线 + 指数雾;
//   water — 溪流水面: 波动、菲涅尔、Beer-Lambert 深度吸收、焦散、太阳高光;
//   sky   — 三带大气渐变 + 太阳辉光;
//   post  — 移轴景深 + ACES 色调映射 + sRGB 输出。
// 渲染目标为线性 RGBA16F, 色调映射只在 post 中执行一次。
// ============================================================================
#pragma sokol @ctype mat4 mat44_t

// ============================================================================
// 体素表面
// ============================================================================
#pragma sokol @vs voxel_vs
layout(binding=0) uniform voxel_vs_params {
    mat4 mvp;
    vec4 chunk_offset;
    vec4 flow_base;
    vec4 params;        // x = time, y = wind strength
};

layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec3 color_biome;
layout(location=3) in vec3 color_uniform;
layout(location=4) in vec3 bent_normal;
layout(location=5) in vec4 flow_meta;
layout(location=6) in vec4 sky_meta;
layout(location=7) in vec4 shade_meta;
layout(location=8) in vec2 uv;

out vec3 v_biome_color;
out vec3 v_uniform_color;
out vec3 v_normal;
out vec3 v_bent_normal;
out vec3 v_world_pos;
out vec3 v_flow_pos;
out vec3 v_local_pos;
out vec4 v_flow_meta;
out vec4 v_sky_meta;
out vec4 v_shade_meta;
out vec2 v_uv;

void main() {
    vec3 localPos = position;
    vec3 renderPos = localPos + chunk_offset.xyz;
    vec3 flowPos = renderPos + flow_base.xyz;

    // 分块共享的风动: 只作用于树叶/草/野花, 顶点位移保持一致,
    // 因此动画不会破坏分块缝合或烘焙 AO。
    const float matId = flow_meta.x;
    const float windAmount = (matId > 0.5 && matId < 1.5) ? 1.0
                           : (((matId < 0.5) || (matId > 6.5 && matId < 7.5)) ? 0.45 : 0.0);
    if (params.y > 0.001 && windAmount > 0.0) {
        float sway = sin(params.x * 1.7 + flowPos.x * 0.21 + flowPos.z * 0.17) * 0.05
                   + cos(params.x * 1.1 + flowPos.z * 0.27) * 0.03;
        renderPos.x += sway * windAmount;
        renderPos.z += sway * 0.6 * windAmount;
        localPos.x += sway * windAmount;
        localPos.z += sway * 0.6 * windAmount;
    }

    v_biome_color = color_biome;
    v_uniform_color = color_uniform;
    v_normal = normal;
    v_bent_normal = bent_normal;
    v_world_pos = renderPos;
    v_flow_pos = flowPos;
    v_local_pos = localPos;
    v_flow_meta = flow_meta;
    v_sky_meta = sky_meta;
    v_shade_meta = shade_meta;
    v_uv = uv;
    gl_Position = mvp * vec4(renderPos, 1.0);
}
#pragma sokol @end

#pragma sokol @fs voxel_fs
layout(binding=1) uniform voxel_fs_params {
    vec4 u_sky_top;
    vec4 u_sky_mid;
    vec4 u_sky_horizon;
    vec4 u_ground_bounce;
    vec4 u_sun_color;       // rgb + intensity
    vec4 u_sun_dir;         // xyz
    vec4 u_camera_pos;      // xyz + time
    vec4 u_params0;         // mode, flow_mode, flow_str, bent_normal
    vec4 u_params1;         // color_bleed, normal_bevel, sss, water_refr
    vec4 u_params2;         // seam_str, pbr_split, dir_ao, bloom_glow
    vec4 u_params3;         // sky_amb_mult, sun_glow_str, glow_boost, biome
    vec4 u_vol_min;         // xyz
    vec4 u_vol_size;        // xyz
    vec4 u_fog_color;       // rgb + fog_enabled
    vec4 u_fog_params;      // density, unused
};

layout(binding=0) uniform texture3D bleed_tex;
layout(binding=0) uniform sampler bleed_smp;

in vec3 v_biome_color;
in vec3 v_uniform_color;
in vec3 v_normal;
in vec3 v_bent_normal;
in vec3 v_world_pos;
in vec3 v_flow_pos;
in vec3 v_local_pos;
in vec4 v_flow_meta;
in vec4 v_sky_meta;
in vec4 v_shade_meta;
in vec2 v_uv;
out vec4 frag_color;

float flow_hash3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

float flow_noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = flow_hash3(i);
    float n100 = flow_hash3(i + vec3(1.0, 0.0, 0.0));
    float n010 = flow_hash3(i + vec3(0.0, 1.0, 0.0));
    float n110 = flow_hash3(i + vec3(1.0, 1.0, 0.0));
    float n001 = flow_hash3(i + vec3(0.0, 0.0, 1.0));
    float n101 = flow_hash3(i + vec3(1.0, 0.0, 1.0));
    float n011 = flow_hash3(i + vec3(0.0, 1.0, 1.0));
    float n111 = flow_hash3(i + vec3(1.0, 1.0, 1.0));
    return mix(
        mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
        mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
        u.z);
}

float flow_fbm3(vec3 p) {
    float n1 = flow_noise3(p * 0.072 + vec3(3.1, 1.7, 5.9));
    float n2 = flow_noise3(p * 0.155 - vec3(4.3, 2.8, 1.4));
    return clamp(0.5 + ((n1 * 0.68 + n2 * 0.32) - 0.5) * 2.25, 0.0, 1.0);
}

// Rodrigues 色相旋转; 在低通道饱和色 (如 #82c928) 上保持亮度。
vec3 hue_shift(vec3 col, float rad) {
    vec3 k = vec3(0.577350269);
    float cosA = cos(rad);
    float sinA = sin(rad);
    return max(vec3(0.0), col * cosA + cross(k, col) * sinA + k * dot(k, col) * (1.0 - cosA));
}

void main() {
    float mode = u_params0.x;
    float flowMode = u_params0.y;
    float flowStr = u_params0.z;
    float bentToggle = u_params0.w;
    float colorBleed = u_params1.x;
    float normalBevel = u_params1.y;
    float sss = u_params1.z;
    float seamStr = u_params2.x;
    float pbrSplit = u_params2.y;
    float dirAO = u_params2.z;
    float bloomGlow = u_params2.w;
    float skyAmbMult = u_params3.x;
    float sunGlowStr = u_params3.y;
    float glowBoost = u_params3.z;
    float biome = u_params3.w;

    float matId = v_flow_meta.x;
    float matKind = v_shade_meta.w;   // 0=普通, 1=红瓦, 2=树叶, 3=自发光
    vec3 sunDir = normalize(u_sun_dir.xyz);
    vec3 sunColor = u_sun_color.rgb;
    float sunIntensity = u_sun_color.w;
    vec3 camPos = u_camera_pos.xyz;
    vec3 viewDir = normalize(camPos - v_world_pos);
    float viewDist = length(camPos - v_world_pos);

    vec3 base = mix(v_uniform_color, v_biome_color, biome);
    vec3 N = normalize(v_normal);

    float bentWeight = 0.62;
    if (abs(matKind - 2.0) < 0.3) {
        bentWeight = 0.82;
    }
    if (mode > 0.5 && bentToggle > 0.5) {
        N = normalize(mix(N, normalize(v_bent_normal), bentWeight));
    }

    // ---- 物体自动色流: 生态复合 (3D 色域 x 高度接地 x 湿润/苔藓锚定) ----
    if (mode > 0.5 && flowMode > 0.5 && flowStr > 0.01 && matId >= 0.5 && matId < 7.5) {
        float n3 = (abs(matId - 6.0) < 0.3)
            ? flow_fbm3(v_flow_pos * vec3(0.45, 3.20, 0.45))
            : flow_fbm3(v_flow_pos);
        float tFlow = (flowMode < 1.5) ? n3
                    : ((flowMode < 2.5) ? v_flow_meta.y
                                        : mix(n3, v_flow_meta.y, 0.48));
        float envWeight = (flowMode < 1.5) ? 0.0
                        : ((flowMode < 2.5) ? 1.0 : 0.90);
        float sPow = clamp(flowStr, 0.0, 1.5);

        if (matId < 1.5) {
            float hueRad = mix(0.68, -0.38, tFlow) * min(1.25, sPow);
            vec3 hCol = hue_shift(base, hueRad);
            float lumScale = mix(0.84, 1.15, tFlow);
            base = mix(base, hCol * lumScale, clamp(sPow * 0.92, 0.0, 1.0));
        } else if (matId < 2.5) {
            float hueRad = mix(0.22, -0.18, tFlow) * min(1.2, sPow);
            vec3 hCol = hue_shift(base, hueRad)
                * mix(vec3(0.76, 0.80, 0.88), vec3(1.24, 1.08, 0.84), tFlow);
            base = mix(base, hCol, clamp(sPow * 0.90, 0.0, 1.0));
        } else if (matId < 3.5) {
            vec3 coolW = base * vec3(0.84, 0.93, 1.06);
            vec3 warmW = base * vec3(1.06, 1.00, 0.87);
            base = mix(base, mix(coolW, warmW, tFlow), clamp(sPow * 0.88, 0.0, 1.0));
        } else if (matId < 4.5) {
            float hueRad = mix(0.38, -0.28, tFlow) * min(1.25, sPow);
            vec3 hCol = hue_shift(base, hueRad) * mix(0.82, 1.16, tFlow);
            base = mix(base, hCol, clamp(sPow * 0.92, 0.0, 1.0));
        } else if (matId < 5.5) {
            vec3 coolS = base * vec3(0.80, 0.92, 1.14);
            vec3 warmS = base * vec3(1.14, 1.04, 0.86);
            base = mix(base, mix(coolS, warmS, tFlow), clamp(sPow * 0.92, 0.0, 1.0));
        } else if (matId < 6.5) {
            vec3 coolD = base * vec3(0.68, 0.72, 0.80);
            vec3 warmD = base * vec3(1.26, 1.06, 0.82);
            base = mix(base, mix(coolD, warmD, tFlow), clamp(sPow * 0.96, 0.0, 1.0));
        } else {
            base = mix(base, base * mix(vec3(0.90, 0.94, 1.06), vec3(1.10, 1.04, 0.88), tFlow),
                       clamp(sPow * 0.70, 0.0, 1.0));
        }

        if (envWeight > 0.01) {
            float sClamp = clamp(flowStr, 0.0, 1.25) * envWeight;
            if (matId >= 1.5 && matId < 3.5 && v_flow_meta.z > 0.02) {
                float mossAmt = v_flow_meta.z * (matId < 2.5 ? 0.56 : 0.36) * sClamp;
                base = mix(base, base * vec3(0.58, 0.96, 0.44), clamp(mossAmt, 0.0, 0.85));
            } else if (matId >= 4.5 && matId < 5.5) {
                if (v_flow_meta.w > 0.02) {
                    base = mix(base, base * vec3(0.58, 0.96, 0.84),
                               clamp(v_flow_meta.w * 0.68 * sClamp, 0.0, 0.85));
                } else if (v_flow_meta.z > 0.02) {
                    base = mix(base, base * vec3(0.72, 0.95, 0.62),
                               clamp(v_flow_meta.z * 0.34 * sClamp, 0.0, 0.80));
                }
            }
        }
    }

    if (dirAO > 0.5 && matKind < 2.5 && mode > 0.5) {
        base *= v_shade_meta.z * v_shade_meta.y;
    }
    if (pbrSplit > 0.5 && abs(matKind - 2.0) < 0.3 && mode > 0.5) {
        base *= 1.08;
    }
    if (seamStr > 0.05 && mode > 0.5) {
        vec2 ed = min(v_uv, 1.0 - v_uv);
        float minE = min(ed.x, ed.y);
        float fade = 1.0 - smoothstep(42.0, 145.0, viewDist);
        float seam = (1.0 - smoothstep(0.0, 0.065, minE)) * 0.13 * fade * seamStr;
        float innerHi = smoothstep(0.065, 0.12, minE) * (1.0 - smoothstep(0.12, 0.22, minE)) * 0.03 * fade * seamStr;
        base = base * (1.0 - seam) + vec3(innerHi);
    }

    // ---- 棱角倒角: 在立方体边缘弯折法线, 形成 GGX 高光钩边 ----
    vec3 bevelTilt = vec3(0.0);
    float bevelEdgeMask = 0.0;
    if (normalBevel > 0.5 && mode > 0.5) {
        vec2 fuv = v_uv;
        vec2 bed = min(fuv, 1.0 - fuv);
        const float bw = 0.10;
        float sU = -1.0 + smoothstep(0.0, bw, fuv.x) + smoothstep(1.0 - bw, 1.0, fuv.x);
        float sV = -1.0 + smoothstep(0.0, bw, fuv.y) + smoothstep(1.0 - bw, 1.0, fuv.y);
        float bFade = 1.0 - smoothstep(28.0, 102.0, viewDist);
        bevelEdgeMask = (1.0 - smoothstep(0.0, bw, min(bed.x, bed.y))) * bFade;
        vec3 tangentU = abs(v_normal.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
        vec3 tangentV = abs(v_normal.y) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
        bevelTilt = (tangentU * sU + tangentV * sV) * (bFade * 0.46);
        N = normalize(N + bevelTilt);
    }

    vec3 color = vec3(0.0);
    float ao = v_shade_meta.x;

    if (matKind > 2.5) {
        // 自发光: 灯笼/窗光; 颜色溢出的暖色由彩光体积另行补足
        float em = (bloomGlow > 0.5 || pbrSplit > 0.5 || colorBleed > 0.5)
            ? 1.65 * (0.48 + glowBoost * 1.15)
            : (0.65 + glowBoost * 1.45);
        color = base * em;
    } else if (mode < 0.5) {
        // 模式 0: 纯色块原貌
        color = base * 0.92;
    } else {
        vec3 direct = vec3(0.0);
        vec3 indirect = vec3(0.0);
        float NdL = max(dot(N, sunDir), 0.0);

        if (mode < 1.5) {
            // 模式 1: 普通直光 + 固定灰环境光 + 角点 AO
            float ao1 = (dirAO < 0.5) ? mix(0.66, 1.0, ao) : 1.0;
            direct = base * sunColor * (NdL * sunIntensity * 0.85 * ao1);
            indirect = base * vec3(0.24, 0.25, 0.27) * ao1;
        } else if (mode < 2.5) {
            // 模式 2: 原版 SeedWorld 逐面 48 射线
            float ao2 = (dirAO < 0.5) ? (ao * 0.28 + 0.72) : 1.0;
            float seedShade = min(v_sky_meta.w, v_sky_meta.x);
            float ny = clamp(N.y, -1.0, 1.0);
            vec3 skyAmb = ny >= 0.0
                ? mix(u_sky_horizon.rgb, u_sky_top.rgb, smoothstep(0.0, 0.95, ny))
                : mix(u_sky_horizon.rgb, u_ground_bounce.rgb, smoothstep(0.0, -0.8, ny));
            direct = base * sunColor * (NdL * sunIntensity * 0.62 * seedShade * ao2);
            indirect = base * skyAmb * (0.48 * seedShade * ao2);
        } else if (mode < 3.5) {
            // 模式 3: 柔和连续 22.5m GI (四角平滑可见度)
            float skyVis = clamp(v_sky_meta.y, 0.14, 1.0);
            float ao3 = (dirAO < 0.5) ? mix(0.72, 1.0, ao) : 1.0;
            float ny = clamp(N.y, -1.0, 1.0);
            vec3 skyBand = ny >= 0.0
                ? mix(u_sky_horizon.rgb, mix(u_sky_mid.rgb, u_sky_top.rgb, smoothstep(0.15, 0.90, ny)),
                      smoothstep(0.0, 0.52, ny))
                : mix(u_sky_horizon.rgb, u_ground_bounce.rgb, smoothstep(0.0, -0.72, ny));
            float sunSide = dot(N, sunDir) * 0.5 + 0.5;
            vec3 skyIrr = skyBand + sunColor * (sunSide * 0.18);
            float directAtten = mix(0.16, 1.04, pow(max(skyVis, 0.0), 1.25)) * ((dirAO < 0.5) ? mix(0.78, 1.0, ao) : 1.0);
            float indirectAtten = mix(0.32, 1.08, pow(max(skyVis, 0.0), 0.82)) * ao3;
            direct = base * sunColor * (NdL * sunIntensity * 0.85 * directAtten);
            indirect = base * skyIrr * (0.54 * indirectAtten);
        } else if (mode < 4.5) {
            // 模式 4: 五重塔口径 34 射线 10.5m SkyGI
            float ny = clamp(N.y, -1.0, 1.0);
            vec3 skyBand = ny >= 0.0
                ? mix(u_sky_horizon.rgb, mix(u_sky_mid.rgb, u_sky_top.rgb, smoothstep(0.15, 0.90, ny)),
                      smoothstep(0.0, 0.55, ny))
                : mix(u_sky_horizon.rgb, u_ground_bounce.rgb, smoothstep(0.0, -0.75, ny));
            float sunScatter = max(dot(N, sunDir), 0.0);
            vec3 skyIrr = skyBand + sunColor * (sunScatter * sunGlowStr * 0.42);
            bool isFol = abs(matKind - 2.0) < 0.3;
            float visCurve = isFol
                ? mix(0.38, 1.14, pow(clamp(v_sky_meta.z, 0.0, 1.0), 0.78))
                : mix(0.26, 1.12, pow(clamp(v_sky_meta.z, 0.0, 1.0), 0.82));
            float aoMul = (dirAO < 0.5) ? mix(0.76, 1.0, ao) : 1.0;
            direct = base * sunColor * (NdL * sunIntensity * 0.85 * mix(0.68, 1.03, clamp(v_sky_meta.z, 0.0, 1.0)));
            indirect = base * skyIrr * (skyAmbMult * visCurve * aoMul);
        } else {
            // 模式 5: 高饱和 SeedWorld 博文风格 (暖阳光 -> 冷青暗部色相迁移)
            float shadeV = clamp(mix(v_sky_meta.x, v_sky_meta.y, 0.38), 0.14, 1.0);
            float aoV = (dirAO < 0.5) ? mix(0.42, 1.0, pow(max(ao, 0.0), 0.78)) : 1.0;
            vec3 skyCool = pow(clamp(u_sky_top.rgb * vec3(0.42, 0.96, 1.48), 0.0, 1.0), vec3(1.12));
            vec3 horVivid = mix(u_sky_horizon.rgb, u_sky_mid.rgb, 0.68);
            vec3 botTeal = mix(u_ground_bounce.rgb * 0.55, skyCool * 0.65, 0.62);
            float ny = clamp(N.y, -1.0, 1.0);
            vec3 skyAmb = ny >= 0.0
                ? mix(horVivid, skyCool, smoothstep(0.0, 0.9, ny))
                : mix(horVivid, botTeal, smoothstep(0.0, -0.75, ny));

            float ndlWrap = NdL > 0.001 ? pow(NdL, 0.72) * 1.15 : 0.0;
            float sunAmt = ndlWrap * pow(max(shadeV, 0.0), 1.15);
            float shadowAmt = 1.0 - smoothstep(0.0, 0.68, sunAmt);

            float luma = dot(base, vec3(0.30, 0.59, 0.11));
            vec3 warmSunTint = base * vec3(1.16, 1.05, 0.74);
            vec3 coolHueTarget = vec3(luma * 0.18, luma * 0.76, luma * 0.90)
                * mix(vec3(0.55), skyAmb * 1.85, 0.75);
            vec3 shadowTint = mix(base, coolHueTarget, 0.50 * shadowAmt);
            vec3 skyInfill = skyAmb * (0.028 + 0.072 * luma) * pow(max(shadeV, 0.0), 0.85) * (0.35 + 0.65 * aoV);

            vec3 warmSun = sunColor * vec3(1.08, 1.02, 0.86);
            direct = warmSunTint * warmSun * (sunAmt * sunIntensity * 0.92 * aoV);
            indirect = shadowTint * skyAmb * (0.62 * pow(max(shadeV, 0.0), 0.90) * aoV) + skyInfill;
        }

        // 倒角高光与微小遮蔽
        if (normalBevel > 0.5 && bevelEdgeMask > 0.01) {
            vec3 halfVec = normalize(sunDir + viewDir);
            float sunBevel = dot(bevelTilt, sunDir);
            float specChamfer = pow(max(dot(N, halfVec), 0.0), 38.0) * bevelEdgeMask;
            direct += base * sunColor * (max(0.0, sunBevel) * 0.65 * sunIntensity);
            direct += sunColor * (specChamfer * sunIntensity * 0.48);
            indirect *= (1.0 - max(0.0, -sunBevel) * 0.42);
        }

        // 3D 洪水填充彩光溢色与窗光溢出
        if (colorBleed > 0.5) {
            vec3 airStep = normalize(mix(normalize(v_normal), N, 0.35));
            vec3 uvw = clamp((v_local_pos + airStep * 1.15 - u_vol_min.xyz) / u_vol_size.xyz,
                             0.005, 0.995);
            vec4 bleed = texture(sampler3D(bleed_tex, bleed_smp), uvw);
            vec3 albedoBounce = bleed.rgb * 1.32;
            float sunFaceBias = mix(1.0, 0.34, smoothstep(0.15, 0.85, max(dot(N, sunDir), 0.0)));
            float lanternGlow = bleed.a * (0.50 + glowBoost * 1.85);
            vec3 lanternLight = vec3(1.0, 0.62, 0.24) * lanternGlow;
            indirect += base * albedoBounce * (0.64 * sunFaceBias)
                      + base * lanternLight * 0.95
                      + lanternLight * 0.045;
        }

        // 树冠厚度吸收 + 逆光 SSS + 掠射边缘透光
        if (sss > 0.5 && abs(matKind - 2.0) < 0.3) {
            float visF = (mode >= 3.5 && mode < 4.5) ? clamp(v_sky_meta.z, 0.0, 1.0)
                       : ((mode < 2.5) ? clamp(v_sky_meta.x, 0.0, 1.0) : clamp(v_sky_meta.y, 0.0, 1.0));
            float leafThick = clamp(v_flow_meta.w, 0.0, 1.0);
            float beer = exp(-1.75 * leafThick);
            float backScatter = pow(clamp(dot(viewDir, -sunDir) * 0.5 + 0.5, 0.0, 1.0), 2.1);
            float sssWrap = pow(clamp(dot(N, sunDir) * 0.45 + 0.55, 0.0, 1.0), 1.5);
            float rim = pow(max(1.0 - clamp(dot(viewDir, N), 0.0, 1.0), 0.0), 2.5);
            float edgeMask = pow(clamp(visF, 0.14, 1.0), 0.65);
            float sideBias = 1.0 - max(0.0, N.y) * 0.38;
            vec3 sssTint = base * vec3(1.14, 1.24, 0.42);
            vec3 rimSky = mix(mix(u_sky_horizon.rgb, u_sky_mid.rgb, 0.55), sunColor, 0.52);
            direct *= mix(0.84, 1.12, beer);
            indirect *= mix(0.76, 1.06, beer);
            direct += sssTint * sunColor
                * ((0.28 * backScatter + 0.14 * sssWrap) * (0.28 + 0.72 * beer)
                   * edgeMask * sideBias * sunIntensity * 0.52);
            indirect += base * rimSky * (rim * (0.25 + 0.42 * beer) * edgeMask);
        }

        color = direct + indirect;
    }

    if (u_fog_color.w > 0.5) {
        float density = u_fog_params.x;
        float fogFactor = 1.0 - exp(-density * density * viewDist * viewDist);
        color = mix(color, u_fog_color.rgb, clamp(fogFactor, 0.0, 1.0));
    }

    frag_color = vec4(color, 1.0);
}
#pragma sokol @end

#pragma sokol @program seedworld_voxel voxel_vs voxel_fs

// ============================================================================
// 溪流水面
// ============================================================================
#pragma sokol @vs water_vs
layout(binding=0) uniform water_vs_params {
    mat4 mvp;
    vec4 chunk_offset;
    vec4 flow_base;
    vec4 params;    // x = time
};

layout(location=0) in vec3 position;
layout(location=1) in vec3 color;
layout(location=2) in vec2 depth_shore;

out vec3 v_color;
out vec3 v_world_pos;
out vec3 v_flow_pos;
out float v_depth;
out float v_shore;

void main() {
    vec3 p = position + chunk_offset.xyz;
    float t = params.x;
    p.y += sin(p.x * 0.65 + t * 2.0) * 0.055 + cos(p.z * 0.75 - t * 1.6) * 0.045;
    v_color = color;
    v_world_pos = p;
    v_flow_pos = p + flow_base.xyz;
    v_depth = depth_shore.x;
    v_shore = depth_shore.y;
    gl_Position = mvp * vec4(p, 1.0);
}
#pragma sokol @end

#pragma sokol @fs water_fs
layout(binding=1) uniform water_fs_params {
    vec4 u_sky_mid;
    vec4 u_sky_horizon;
    vec4 u_sun_color;    // rgb + intensity
    vec4 u_sun_dir;
    vec4 u_camera;       // xyz + time
    vec4 u_water_params; // mode, water_refr, unused, unused
};

in vec3 v_color;
in vec3 v_world_pos;
in vec3 v_flow_pos;
in float v_depth;
in float v_shore;
out vec4 frag_color;

void main() {
    float mode = u_water_params.x;
    float waterRefr = u_water_params.y;
    float time = u_camera.w;
    vec3 sunDir = normalize(u_sun_dir.xyz);
    vec3 viewDir = normalize(u_camera.xyz - v_world_pos);

    vec3 color;
    float alpha;
    if (mode < 0.5) {
        color = v_color * 0.92;
        alpha = 0.78;
    } else if (waterRefr > 0.5) {
        vec3 waveNorm = normalize(vec3(
            cos(v_flow_pos.x * 1.45 + time * 2.0) * 0.085,
            1.0,
            sin(v_flow_pos.z * 1.65 - time * 1.6) * 0.085));
        float fresnel = pow(max(1.0 - clamp(dot(viewDir, waveNorm), 0.0, 1.0), 0.0), 2.5);
        vec3 skyRefl = mix(u_sky_mid.rgb, u_sky_horizon.rgb, clamp(fresnel * 1.15, 0.0, 1.0));
        float depth = clamp(v_depth, 0.5, 3.5);
        float beer = 1.0 - exp(-0.78 * depth);
        vec3 shallowTint = vec3(0.32, 0.84, 0.86);
        vec3 deepTint = vec3(0.03, 0.34, 0.52);
        vec3 waterBody = mix(shallowTint, deepTint, clamp((depth - 0.65) / 2.2, 0.0, 1.0));
        float cWave = sin(v_flow_pos.x * 1.9 + time * 2.1) * cos(v_flow_pos.z * 2.1 - time * 1.7);
        float cWave2 = sin((v_flow_pos.x + v_flow_pos.z) * 1.4 - time * 1.5);
        float caustic = smoothstep(0.28, 0.96, (cWave + cWave2) * 0.5 + 0.5) * exp(-0.42 * depth);
        vec3 halfVec = normalize(sunDir + viewDir);
        float sunGlint = pow(max(dot(waveNorm, halfVec), 0.0), 68.0) * 1.25;
        float shoreFoam = clamp(v_shore, 0.0, 1.0) * 0.18;
        color = waterBody * (0.38 + caustic * 0.42 + shoreFoam)
              + skyRefl * (0.32 + fresnel * 0.74)
              + u_sun_color.rgb * (sunGlint * u_sun_color.w * 0.60);
        alpha = clamp(mix(0.28, 0.72, beer) + fresnel * 0.28 + shoreFoam * 0.30, 0.22, 0.94);
    } else if (mode > 1.5) {
        float fresnel = pow(max(1.0 - clamp(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 0.0), 2.2);
        vec3 skyRefl = mix(u_sky_mid.rgb, u_sky_horizon.rgb, clamp(fresnel * 1.15, 0.0, 1.0));
        color = v_color * 0.72 + skyRefl * (0.28 + fresnel * 0.68);
        alpha = clamp(0.72 + fresnel * 0.22, 0.0, 0.94);
    } else {
        color = v_color;
        alpha = 0.78;
    }
    frag_color = vec4(color, alpha);
}
#pragma sokol @end

#pragma sokol @program seedworld_water water_vs water_fs

// ============================================================================
// 天空穹顶 (全屏三角, 由相机基向量重建视线方向)
// ============================================================================
#pragma sokol @vs sky_vs
layout(binding=0) uniform sky_vs_params {
    mat4 mvp;
    vec4 center;        // xyz = 相机渲染坐标 (天空球始终以相机为中心)
};
layout(location=0) in vec3 position;
out vec3 v_dir;
void main() {
    v_dir = position;
    gl_Position = mvp * vec4(position + center.xyz, 1.0);
}
#pragma sokol @end

#pragma sokol @fs sky_fs
layout(binding=1) uniform sky_fs_params {
    vec4 u_sky_top;
    vec4 u_sky_mid;
    vec4 u_sky_horizon;
    vec4 u_sun_color;
    vec4 u_sun_dir;
    vec4 u_params;       // x = sun_glow_str
};

in vec3 v_dir;
out vec4 frag_color;

void main() {
    // 天空穹顶为原点处的球体; 与参考场景一样使用交点方向而非视线方向,
    // 因此相机偏离球心时, 屏幕顶部会呈现更高的天空色带。
    vec3 dir = normalize(v_dir);
    float h = clamp(dir.y, -0.25, 1.0);
    vec3 sky = mix(u_sky_horizon.rgb, u_sky_mid.rgb, smoothstep(-0.05, 0.25, h));
    sky = mix(sky, u_sky_top.rgb, smoothstep(0.22, 0.85, h));

    float sunDot = max(dot(dir, normalize(u_sun_dir.xyz)), 0.0);
    sky += u_sun_color.rgb * (pow(sunDot, 12.0) * 0.28 + pow(sunDot, 64.0) * 0.45)
         * (0.45 + u_params.x);
    sky = min(sky, vec3(0.96));
    frag_color = vec4(sky, 1.0);
}
#pragma sokol @end

#pragma sokol @program seedworld_sky sky_vs sky_fs

// ============================================================================
// 后处理: 移轴景深 + ACES + sRGB
// ============================================================================
#pragma sokol @vs post_vs
layout(location=0) in vec2 position;
out vec2 v_uv;
void main() {
    v_uv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}
#pragma sokol @end

#pragma sokol @fs post_fs
layout(binding=0) uniform post_fs_params {
    vec4 u_params;   // x = texel_x, y = texel_y, z = dof_strength, w = origin_top_left
};

layout(binding=0) uniform texture2D scene_tex;
layout(binding=0) uniform sampler scene_smp;

in vec2 v_uv;
out vec4 frag_color;

// 与 three.js ACESFilmicToneMapping 同款拟合 (RRT + ODT)
vec3 rrt_and_odt_fit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

vec3 aces_tonemap(vec3 color) {
    const mat3 inputMat = mat3(
        vec3(0.59719, 0.07600, 0.02840),
        vec3(0.35458, 0.90834, 0.13383),
        vec3(0.04823, 0.01566, 0.83777));
    const mat3 outputMat = mat3(
        vec3( 1.60475, -0.10208, -0.00327),
        vec3(-0.53108,  1.10813, -0.07276),
        vec3(-0.07367, -0.00605,  1.07602));
    // three.js 为更明亮的观看环境额外除以 0.6; 曝光 1.04 与其默认一致。
    color = inputMat * (color * (1.04 / 0.6));
    color = rrt_and_odt_fit(color);
    color = outputMat * color;
    return clamp(color, 0.0, 1.0);
}

vec3 linear_to_srgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
    vec2 uv = v_uv;
    if (u_params.w > 0.5) {
        uv.y = 1.0 - uv.y;
    }
    vec2 texel = u_params.xy;
    float dof = u_params.z;

    float tilt = (uv.y - 0.50) + (uv.x - 0.50) * 0.12;
    float blurAmt = smoothstep(0.16, 0.46, abs(tilt)) * dof;

    vec3 color = texture(sampler2D(scene_tex, scene_smp), uv).rgb;
    if (blurAmt > 0.01) {
        float rad = blurAmt * 2.35;
        vec3 acc = color;
        float totalW = 1.0;
        float ang = 0.0;
        for (int i = 0; i < 12; ++i) {
            float fi = float(i);
            float rScale = sqrt((fi + 0.5) / 12.0) * rad;
            vec2 off = vec2(cos(ang), sin(ang)) * texel * rScale;
            acc += texture(sampler2D(scene_tex, scene_smp), clamp(uv + off, vec2(0.002), vec2(0.998))).rgb;
            totalW += 1.0;
            ang += 2.39996323;
        }
        color = acc / totalW;
        float vig = 1.0 - smoothstep(0.45, 0.95, length(uv - 0.5)) * 0.08 * blurAmt;
        color *= vig;
    }

    color = aces_tonemap(color);
    color = linear_to_srgb(color);
    frag_color = vec4(color, 1.0);
}
#pragma sokol @end

#pragma sokol @program seedworld_post post_vs post_fs
