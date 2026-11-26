import * as THREE from 'three';

export interface SeedWorldUniforms {
  uTime: { value: number };
  uWindStr: { value: number };
  uMode: { value: number };        // 5 = Vivid SeedWorld Hue-Shift (default), 3 = Soft GI, 4 = Pagoda SkyGI
  uObjFlowStr: { value: number };  // 0.82 default smooth 3D object color flow
  uBentNormal: { value: number };  // 1.0 = curved bent-normal shading
  uNormalBevel: { value: number }; // 1.0 = GGX chamfer bevel catchlight
  uSSS: { value: number };         // 1.0 = canopy Beer-Lambert thickness SSS
  uColorBleed: { value: number };  // 1.0 = 3D flood-fill chromatic bounce & lantern spill
  uSeamStr: { value: number };     // subtle crisp voxel seam micro-outline
  uTopColor: { value: THREE.Color };
  uMidColor: { value: THREE.Color };
  uHorizonColor: { value: THREE.Color };
  uGroundBounce: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSunIntensity: { value: number };
  uSunGlowStr: { value: number };
  uGlowBoost: { value: number };
  uFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
  uBleedTex: { value: THREE.Data3DTexture };
  uVolMin: { value: THREE.Vector3 };
  uVolSize: { value: THREE.Vector3 };
}

/** Creates a 1x1x1 dummy 3D bleed texture for areas/chunks without a baked bleed volume */
export function createFallbackBleedTexture(): THREE.Data3DTexture {
  const data = new Uint8Array([0, 0, 0, 0]);
  const tex = new THREE.Data3DTexture(data, 1, 1, 1);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createSeedWorldUniforms(): SeedWorldUniforms {
  return {
    uTime: { value: 0 },
    uWindStr: { value: 1.0 },
    uMode: { value: 5.0 },
    uObjFlowStr: { value: 0.82 },
    uBentNormal: { value: 1.0 },
    uNormalBevel: { value: 1.0 },
    uSSS: { value: 1.0 },
    uColorBleed: { value: 1.0 },
    uSeamStr: { value: 0.25 },
    uTopColor: { value: new THREE.Color(0x286fd4) },
    uMidColor: { value: new THREE.Color(0x74c0f4) },
    uHorizonColor: { value: new THREE.Color(0xdbeeff) },
    uGroundBounce: { value: new THREE.Color(0x4b6b42) },
    uSunDir: { value: new THREE.Vector3(0.58, 0.64, 0.5).normalize() },
    uSunColor: { value: new THREE.Color(0xfff1d6) },
    uSunIntensity: { value: 1.52 },
    uSunGlowStr: { value: 0.28 },
    uGlowBoost: { value: 0.42 },
    uFogColor: { value: new THREE.Color(0xd2e7f8) },
    uFogDensity: { value: 0.0034 },
    uBleedTex: { value: createFallbackBleedTexture() },
    uVolMin: { value: new THREE.Vector3(-64, 0, -64) },
    uVolSize: { value: new THREE.Vector3(128, 64, 128) },
  };
}

/**
 * Authentic SeedWorld "流光渲染" Voxel ShaderMaterial (WebGL2 / GLSL3).
 * Faithfully ports seedworld.glsl & seedworld-tree-house_base.html:
 * - Uniform block colors + smooth 3D Object Color Flow + moisture/moss grounding
 * - 3D Bent Normal curvature smoothing across voxel faces
 * - Warm-Sun -> Cool-Cyan Vivid Hue Travel (Mode 5) + Soft Continuous GI (Mode 3)
 * - MagicaVoxel GGX Edge Chamfer Catchlight & Micro-Seam definition
 * - 3D Flood-Fill Chromatic Albedo Bounce & Lantern/Window Light Spill
 * - Canopy Beer-Lambert Thickness Subsurface Scattering + Backlit Rim Glow
 * - Gentle synchronized Foliage Wind Sway + Exponential Atmospheric Horizon Fog
 */
export function createSeedWorldVoxelMaterial(
  shared: SeedWorldUniforms,
  localBleedTex?: THREE.Data3DTexture,
  localVolMin?: THREE.Vector3,
  localVolSize?: THREE.Vector3
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uTime: shared.uTime,
      uWindStr: shared.uWindStr,
      uMode: shared.uMode,
      uObjFlowStr: shared.uObjFlowStr,
      uBentNormal: shared.uBentNormal,
      uNormalBevel: shared.uNormalBevel,
      uSSS: shared.uSSS,
      uColorBleed: shared.uColorBleed,
      uSeamStr: shared.uSeamStr,
      uTopColor: shared.uTopColor,
      uMidColor: shared.uMidColor,
      uHorizonColor: shared.uHorizonColor,
      uGroundBounce: shared.uGroundBounce,
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uSunIntensity: shared.uSunIntensity,
      uSunGlowStr: shared.uSunGlowStr,
      uGlowBoost: shared.uGlowBoost,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uBleedTex: localBleedTex ? { value: localBleedTex } : shared.uBleedTex,
      uVolMin: localVolMin ? { value: localVolMin } : shared.uVolMin,
      uVolSize: localVolSize ? { value: localVolSize } : shared.uVolSize,
      uHasBleed: { value: localBleedTex ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      in vec3 color;
      in vec3 aBentNorm;
      in vec4 aFlowMeta;   // x=flowMatId, y=localElev, z=groundProx, w=waterProx or leafThick
      in vec4 aLightMeta;  // x=faceSky, y=smoothSky, z=ao, w=matKind

      uniform float uTime;
      uniform float uWindStr;

      out vec3 vColor;
      out vec3 vNormal;
      out vec3 vBentNorm;
      out vec3 vWorldPos;
      out vec4 vFlowMeta;
      out vec4 vLightMeta;
      out vec2 vUv;

      void main() {
        vec3 pos = position;
        vec4 worldPos4 = modelMatrix * vec4(pos, 1.0);
        vec3 wPos = worldPos4.xyz;

        // Synchronized wind sway on foliage & banners (matches seedworld.glsl)
        float matKind = aLightMeta.w;
        float flowId = aFlowMeta.x;
        float windAmt = (abs(matKind - 2.0) < 0.3) ? 1.0 : ((flowId > 6.5) ? 0.35 : 0.0);
        if (uWindStr > 0.01 && windAmt > 0.0) {
          float sway = sin(uTime * 1.65 + wPos.x * 0.22 + wPos.z * 0.18) * 0.065
                     + cos(uTime * 1.15 + wPos.z * 0.28 + wPos.y * 0.14) * 0.035;
          wPos.x += sway * windAmt * uWindStr;
          wPos.z += sway * 0.65 * windAmt * uWindStr;
        }

        vColor = color;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vBentNorm = normalize(mat3(modelMatrix) * aBentNorm);
        vWorldPos = wPos;
        vFlowMeta = aFlowMeta;
        vLightMeta = aLightMeta;
        vUv = uv;

        gl_Position = projectionMatrix * viewMatrix * vec4(wPos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;

      uniform float uMode;
      uniform float uObjFlowStr;
      uniform float uBentNormal;
      uniform float uNormalBevel;
      uniform float uSSS;
      uniform float uColorBleed;
      uniform float uSeamStr;
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uGroundBounce;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunIntensity;
      uniform float uSunGlowStr;
      uniform float uGlowBoost;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform sampler3D uBleedTex;
      uniform vec3 uVolMin;
      uniform vec3 uVolSize;
      uniform float uHasBleed;

      in vec3 vColor;
      in vec3 vNormal;
      in vec3 vBentNorm;
      in vec3 vWorldPos;
      in vec4 vFlowMeta;
      in vec4 vLightMeta;
      in vec2 vUv;

      out vec4 fragColor;

      float flowHash3(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.x + p.y) * p.z);
      }

      float flowNoise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        float n000 = flowHash3(i);
        float n100 = flowHash3(i + vec3(1.0, 0.0, 0.0));
        float n010 = flowHash3(i + vec3(0.0, 1.0, 0.0));
        float n110 = flowHash3(i + vec3(1.0, 1.0, 0.0));
        float n001 = flowHash3(i + vec3(0.0, 0.0, 1.0));
        float n101 = flowHash3(i + vec3(1.0, 0.0, 1.0));
        float n011 = flowHash3(i + vec3(0.0, 1.0, 1.0));
        float n111 = flowHash3(i + vec3(1.0, 1.0, 1.0));
        return mix(
          mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
          mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
          u.z
        );
      }

      float fbmFlow3D(vec3 p) {
        float n1 = flowNoise3(p * 0.068 + vec3(3.1, 1.7, 5.9));
        float n2 = flowNoise3(p * 0.145 - vec3(4.3, 2.8, 1.4));
        return clamp(0.5 + ((n1 * 0.68 + n2 * 0.32) - 0.5) * 2.2, 0.0, 1.0);
      }

      // Rodrigues Hue Rotation preserving luma across saturated colors (from seedworld.glsl)
      vec3 hueShift(vec3 col, float rad) {
        vec3 k = vec3(0.577350269);
        float cosA = cos(rad);
        float sinA = sin(rad);
        return max(vec3(0.0), col * cosA + cross(k, col) * sinA + k * dot(k, col) * (1.0 - cosA));
      }

      void main() {
        vec3 base = vColor;
        vec3 rawN = normalize(vNormal);
        vec3 N = rawN;
        vec3 sunDir = normalize(uSunDir);
        vec3 viewVec = cameraPosition - vWorldPos;
        float viewDist = length(viewVec);
        vec3 viewDir = viewVec / max(viewDist, 0.0001);

        float fMat = vFlowMeta.x;
        float localElev = vFlowMeta.y;
        float gndProx = vFlowMeta.z;
        float watProx = vFlowMeta.w;

        float faceSky = vLightMeta.x;
        float smoothSky = vLightMeta.y;
        float ao = vLightMeta.z;
        float matKind = vLightMeta.w; // 0=matte, 1=glazed/gold, 2=foliage, 3=emissive

        // 1. Bent Normal Curvature Smoothing
        if (uBentNormal > 0.5) {
          float bentW = (abs(matKind - 2.0) < 0.3) ? 0.80 : 0.58;
          N = normalize(mix(N, normalize(vBentNorm), bentW));
        }

        // 2. SeedWorld Automatic 3D Object Color Flow + Moisture/Moss Grounding
        if (uObjFlowStr > 0.01 && fMat >= 0.5 && fMat < 7.5) {
          float n3 = (abs(fMat - 6.0) < 0.3)
            ? fbmFlow3D(vWorldPos * vec3(0.42, 2.85, 0.42))
            : fbmFlow3D(vWorldPos);
          float tFlow = mix(n3, localElev, 0.46);
          float sPow = clamp(uObjFlowStr, 0.0, 1.4);

          if (fMat < 1.5) {
            // Foliage: sunlit golden chartreuse tips <-> lush cool emerald/teal interiors
            float hueRad = mix(0.58, -0.34, tFlow) * min(1.2, sPow);
            vec3 hCol = hueShift(base, hueRad) * mix(0.84, 1.15, tFlow);
            base = mix(base, hCol, clamp(sPow * 0.90, 0.0, 1.0));
          } else if (fMat < 2.5) {
            // Trunk & Timber: cool weathered walnut <-> warm honey cedar
            float hueRad = mix(0.20, -0.16, tFlow) * min(1.15, sPow);
            vec3 hCol = hueShift(base, hueRad) * mix(vec3(0.78, 0.82, 0.90), vec3(1.20, 1.07, 0.86), tFlow);
            base = mix(base, hCol, clamp(sPow * 0.88, 0.0, 1.0));
          } else if (fMat < 3.5) {
            // Plaster Walls: cool sky-chalk <-> warm sunlit ivory
            vec3 coolW = base * vec3(0.86, 0.94, 1.05);
            vec3 warmW = base * vec3(1.06, 1.00, 0.88);
            base = mix(base, mix(coolW, warmW, tFlow), clamp(sPow * 0.85, 0.0, 1.0));
          } else if (fMat < 4.5) {
            // Roof Tiles & Vermilion: deep lacquer shade <-> sun-warmed glaze
            float hueRad = mix(0.32, -0.24, tFlow) * min(1.15, sPow);
            vec3 hCol = hueShift(base, hueRad) * mix(0.84, 1.15, tFlow);
            base = mix(base, hCol, clamp(sPow * 0.88, 0.0, 1.0));
          } else if (fMat < 5.5) {
            // Stone, Slate & Roads: cool blue-slate <-> warm limestone ochre
            vec3 coolS = base * vec3(0.82, 0.92, 1.12);
            vec3 warmS = base * vec3(1.12, 1.03, 0.87);
            base = mix(base, mix(coolS, warmS, tFlow), clamp(sPow * 0.88, 0.0, 1.0));
          } else if (fMat < 6.5) {
            // Cliff Dirt Strata: geological peat <-> warm loam bands
            vec3 coolD = base * vec3(0.70, 0.74, 0.82);
            vec3 warmD = base * vec3(1.24, 1.06, 0.82);
            base = mix(base, mix(coolD, warmD, tFlow), clamp(sPow * 0.94, 0.0, 1.0));
          } else {
            // Banners, Gold, Snow
            base = mix(base, base * mix(vec3(0.92, 0.95, 1.05), vec3(1.08, 1.03, 0.90), tFlow), clamp(sPow * 0.65, 0.0, 1.0));
          }

          // Ground & Moisture Anchoring
          float sClamp = clamp(uObjFlowStr, 0.0, 1.2) * 0.88;
          if (fMat >= 1.5 && fMat < 3.5 && gndProx > 0.02) {
            float mossAmt = gndProx * (fMat < 2.5 ? 0.48 : 0.30) * sClamp;
            base = mix(base, base * vec3(0.60, 0.95, 0.46), clamp(mossAmt, 0.0, 0.78));
          } else if (fMat >= 4.5 && fMat < 5.5) {
            if (watProx > 0.02) {
              base = mix(base, base * vec3(0.58, 0.96, 0.86), clamp(watProx * 0.62 * sClamp, 0.0, 0.82));
            } else if (gndProx > 0.02) {
              base = mix(base, base * vec3(0.74, 0.94, 0.64), clamp(gndProx * 0.30 * sClamp, 0.0, 0.72));
            }
          }
        }

        // 3. Crisp Voxel Seam Micro-Outline (distance-faded so far mountains stay painterly)
        vec2 fuv = fract(vUv);
        vec2 ed = min(fuv, 1.0 - fuv);
        float minE = min(ed.x, ed.y);
        if (uSeamStr > 0.02 && matKind < 2.5) {
          float sFade = 1.0 - smoothstep(32.0, 120.0, viewDist);
          float seam = (1.0 - smoothstep(0.0, 0.065, minE)) * 0.14 * sFade * uSeamStr;
          float innerHi = smoothstep(0.065, 0.12, minE) * (1.0 - smoothstep(0.12, 0.22, minE)) * 0.035 * sFade * uSeamStr;
          base = base * (1.0 - seam) + vec3(innerHi);
        }

        // 4. MagicaVoxel GGX Edge Chamfer Bevel Tilt
        vec3 bevelTilt = vec3(0.0);
        float bevelEdgeMask = 0.0;
        if (uNormalBevel > 0.5 && matKind < 2.5) {
          float bw = 0.105;
          float sU = -1.0 + smoothstep(0.0, bw, fuv.x) + smoothstep(1.0 - bw, 1.0, fuv.x);
          float sV = -1.0 + smoothstep(0.0, bw, fuv.y) + smoothstep(1.0 - bw, 1.0, fuv.y);
          float bFade = 1.0 - smoothstep(26.0, 96.0, viewDist);
          bevelEdgeMask = (1.0 - smoothstep(0.0, bw, minE)) * bFade;
          vec3 tangentU = abs(rawN.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
          vec3 tangentV = abs(rawN.y) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
          bevelTilt = (tangentU * sU + tangentV * sV) * (bFade * 0.44);
          N = normalize(N + bevelTilt);
        }

        vec3 color = vec3(0.0);

        if (matKind > 2.5) {
          // Self-illuminated warm Song lanterns & glowing shoji windows
          float em = 1.48 * (0.62 + uGlowBoost * 0.95);
          color = base * em;
        } else {
          float NdL = max(dot(N, sunDir), 0.0);
          vec3 direct = vec3(0.0);
          vec3 indirect = vec3(0.0);

          if (uMode < 3.5) {
            // Soft Continuous SeedWorld SkyGI
            float skyVis = clamp(smoothSky, 0.16, 1.0);
            float ao3 = mix(0.68, 1.0, ao);
            float ny = clamp(N.y, -1.0, 1.0);
            vec3 skyBand = ny >= 0.0
              ? mix(uHorizonColor, mix(uMidColor, uTopColor, smoothstep(0.15, 0.90, ny)), smoothstep(0.0, 0.52, ny))
              : mix(uHorizonColor, uGroundBounce, smoothstep(0.0, -0.72, ny));
            float sunSide = dot(N, sunDir) * 0.5 + 0.5;
            vec3 skyIrr = skyBand + uSunColor * (sunSide * 0.18);
            float directAtten = mix(0.18, 1.04, pow(skyVis, 1.22)) * mix(0.76, 1.0, ao);
            float indirectAtten = mix(0.34, 1.08, pow(skyVis, 0.80)) * ao3;
            direct = base * uSunColor * (NdL * uSunIntensity * 0.88 * directAtten);
            indirect = base * skyIrr * (0.56 * indirectAtten);
          } else {
            // Mode 5: SeedWorld Vivid Blog Style — Warm-Sun -> Cool-Cyan Hue Travel + Deep Soft AO
            float shadeV = clamp(mix(faceSky, smoothSky, 0.42), 0.16, 1.0);
            float aoV = mix(0.46, 1.0, pow(max(ao, 0.0), 0.78));
            vec3 skyCool = pow(clamp(uTopColor * vec3(0.46, 0.96, 1.44), 0.0, 1.0), vec3(1.10));
            vec3 horVivid = mix(uHorizonColor, uMidColor, 0.65);
            vec3 botTeal = mix(uGroundBounce * 0.58, skyCool * 0.65, 0.56);
            float ny = clamp(N.y, -1.0, 1.0);
            vec3 skyAmb = ny >= 0.0
              ? mix(horVivid, skyCool, smoothstep(0.0, 0.90, ny))
              : mix(horVivid, botTeal, smoothstep(0.0, -0.75, ny));

            float ndlWrap = NdL > 0.001 ? pow(NdL, 0.74) * 1.14 : 0.0;
            float sunAmt = ndlWrap * pow(shadeV, 1.10);
            float shadowAmt = 1.0 - smoothstep(0.0, 0.68, sunAmt);

            float luma = dot(base, vec3(0.30, 0.59, 0.11));
            vec3 warmSunTint = base * vec3(1.15, 1.05, 0.78);
            vec3 coolHueTarget = vec3(luma * 0.22, luma * 0.76, luma * 0.92)
              * mix(vec3(0.58), skyAmb * 1.82, 0.74);
            vec3 shadowTint = mix(base, coolHueTarget, 0.46 * shadowAmt);
            vec3 skyInfill = skyAmb * (0.030 + 0.070 * luma) * pow(shadeV, 0.85) * (0.38 + 0.62 * aoV);

            vec3 warmSun = uSunColor * vec3(1.08, 1.02, 0.88);
            direct = warmSunTint * warmSun * (sunAmt * uSunIntensity * 0.94 * aoV);
            indirect = shadowTint * skyAmb * (0.64 * pow(shadeV, 0.88) * aoV) + skyInfill;
          }

          // Glazed tile / lacquer / gold specular gleam
          if (abs(matKind - 1.0) < 0.3) {
            vec3 halfV = normalize(sunDir + viewDir);
            float specGlaze = pow(max(dot(N, halfV), 0.0), 42.0) * smoothSky;
            direct += uSunColor * (specGlaze * uSunIntensity * 0.38);
          }

          // GGX Edge Chamfer Catchlight & Micro-Shadow Crease
          if (uNormalBevel > 0.5 && bevelEdgeMask > 0.01) {
            vec3 halfVec = normalize(sunDir + viewDir);
            float sunBevel = dot(bevelTilt, sunDir);
            float specChamfer = pow(max(dot(N, halfVec), 0.0), 36.0) * bevelEdgeMask;
            direct += base * uSunColor * (max(0.0, sunBevel) * 0.58 * uSunIntensity);
            direct += uSunColor * (specChamfer * uSunIntensity * 0.42);
            indirect *= (1.0 - max(0.0, -sunBevel) * 0.38);
          }

          // 3D Flood-Fill Chromatic Albedo Bounce & Lantern/Window Spill
          if (uColorBleed > 0.5 && uHasBleed > 0.5) {
            vec3 airStep = normalize(mix(rawN, N, 0.35));
            vec3 uvw = clamp((vWorldPos + airStep * 1.15 - uVolMin) / max(uVolSize, vec3(1.0)), 0.005, 0.995);
            vec4 bleed = texture(uBleedTex, uvw);
            vec3 albedoBounce = bleed.rgb * 1.35;
            float sunFaceBias = mix(1.0, 0.36, smoothstep(0.15, 0.85, max(dot(N, sunDir), 0.0)));
            float lanternGlow = bleed.a * (0.55 + uGlowBoost * 1.85);
            vec3 lanternLight = vec3(1.0, 0.62, 0.24) * lanternGlow;
            indirect += base * albedoBounce * (0.62 * sunFaceBias)
                      + base * lanternLight * 1.05
                      + lanternLight * 0.048;
          }

          // Canopy Beer-Lambert Thickness SSS + Rim Glow (from seedworld.glsl)
          if (uSSS > 0.5 && abs(matKind - 2.0) < 0.3) {
            float visF = clamp(smoothSky, 0.14, 1.0);
            float leafThick = clamp(watProx, 0.0, 1.0);
            float beer = exp(-1.7 * leafThick);
            float backScatter = pow(clamp(dot(viewDir, -sunDir) * 0.5 + 0.5, 0.0, 1.0), 2.1);
            float sssWrap = pow(clamp(dot(N, sunDir) * 0.45 + 0.55, 0.0, 1.0), 1.5);
            float rim = pow(max(1.0 - clamp(dot(viewDir, N), 0.0, 1.0), 0.0), 2.5);
            float edgeMask = pow(visF, 0.65);
            float sideBias = 1.0 - max(0.0, N.y) * 0.36;
            vec3 sssTint = base * vec3(1.14, 1.24, 0.42);
            vec3 rimSky = mix(mix(uHorizonColor, uMidColor, 0.55), uSunColor, 0.52);
            direct *= mix(0.84, 1.12, beer);
            indirect *= mix(0.78, 1.06, beer);
            direct += sssTint * uSunColor
              * ((0.28 * backScatter + 0.14 * sssWrap) * (0.28 + 0.72 * beer)
                 * edgeMask * sideBias * uSunIntensity * 0.52);
            indirect += base * rimSky * (rim * (0.24 + 0.40 * beer) * edgeMask);
          }

          color = direct + indirect;
        }

        // Exponential Atmospheric Distance Mist (seamless horizon blend)
        if (uFogDensity > 0.00001) {
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * viewDist * viewDist);
          color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));
        }

        // Pure GLSL3 ACES Filmic Tone Mapping + sRGB Output
        vec3 tm = clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
        vec3 srgb = mix(tm * 12.92, 1.055 * pow(max(tm, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), tm));
        fragColor = vec4(srgb, 1.0);
      }
    `,
  });
}

/**
 * Authentic SeedWorld Water ShaderMaterial (ported directly from seedworld.glsl water_vs / water_fs):
 * - Animated vertex wave ripples
 * - Beer-Lambert depth absorption (shallow turquoise <-> deep jade-teal)
 * - Dual-wave animated underwater sun caustics
 * - Fresnel sky reflection + Sun specular glint + Shore foam
 */
export function createSeedWorldWaterMaterial(shared: SeedWorldUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: shared.uTime,
      uMidColor: shared.uMidColor,
      uHorizonColor: shared.uHorizonColor,
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uSunIntensity: shared.uSunIntensity,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
    },
    vertexShader: /* glsl */ `
      in vec2 aDepthShore; // x = water depth, y = shoreline factor (0..1)
      uniform float uTime;

      out vec3 vWorldPos;
      out float vDepth;
      out float vShore;

      void main() {
        vec4 wPos4 = modelMatrix * vec4(position, 1.0);
        vec3 p = wPos4.xyz;
        p.y += sin(p.x * 0.62 + uTime * 2.0) * 0.055 + cos(p.z * 0.72 - uTime * 1.6) * 0.045;
        vWorldPos = p;
        vDepth = aDepthShore.x;
        vShore = aDepthShore.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunIntensity;
      uniform vec3 uFogColor;
      uniform float uFogDensity;

      in vec3 vWorldPos;
      in float vDepth;
      in float vShore;

      out vec4 fragColor;

      void main() {
        vec3 sunDir = normalize(uSunDir);
        vec3 viewVec = cameraPosition - vWorldPos;
        float viewDist = length(viewVec);
        vec3 viewDir = viewVec / max(viewDist, 0.0001);

        vec3 waveNorm = normalize(vec3(
          cos(vWorldPos.x * 1.35 + uTime * 2.0) * 0.09,
          1.0,
          sin(vWorldPos.z * 1.55 - uTime * 1.6) * 0.09
        ));
        float fresnel = pow(max(1.0 - clamp(dot(viewDir, waveNorm), 0.0, 1.0), 0.0), 2.5);
        vec3 skyRefl = mix(uMidColor, uHorizonColor, clamp(fresnel * 1.15, 0.0, 1.0));

        float depth = clamp(vDepth, 0.5, 4.0);
        float beer = 1.0 - exp(-0.76 * depth);
        vec3 shallowTint = vec3(0.30, 0.84, 0.86);
        vec3 deepTint = vec3(0.04, 0.34, 0.52);
        vec3 waterBody = mix(shallowTint, deepTint, clamp((depth - 0.6) / 2.4, 0.0, 1.0));

        float cWave = sin(vWorldPos.x * 1.65 + uTime * 2.1) * cos(vWorldPos.z * 1.85 - uTime * 1.7);
        float cWave2 = sin((vWorldPos.x + vWorldPos.z) * 1.25 - uTime * 1.5);
        float caustic = smoothstep(0.26, 0.95, (cWave + cWave2) * 0.5 + 0.5) * exp(-0.38 * depth);

        vec3 halfVec = normalize(sunDir + viewDir);
        float sunGlint = pow(max(dot(waveNorm, halfVec), 0.0), 64.0) * 1.35;
        float shoreFoam = clamp(vShore, 0.0, 1.0) * 0.24;

        vec3 color = waterBody * (0.42 + caustic * 0.44 + shoreFoam)
                   + skyRefl * (0.30 + fresnel * 0.72)
                   + uSunColor * (sunGlint * uSunIntensity * 0.62);
        float alpha = clamp(mix(0.34, 0.76, beer) + fresnel * 0.24 + shoreFoam * 0.28, 0.28, 0.94);

        if (uFogDensity > 0.00001) {
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * viewDist * viewDist);
          color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));
        }

        vec3 tm = clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
        vec3 srgb = mix(tm * 12.92, 1.055 * pow(max(tm, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), tm));
        fragColor = vec4(srgb, alpha);
      }
    `,
  });
}

/**
 * SeedWorld 3-Band Atmospheric Sky Dome with Solar Disc & Mie Scattering Halo (seedworld.glsl sky_fs).
 */
export function createSeedWorldSkyDome(shared: SeedWorldUniforms): THREE.Mesh {
  const geom = new THREE.SphereGeometry(420, 32, 20);
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTopColor: shared.uTopColor,
      uMidColor: shared.uMidColor,
      uHorizonColor: shared.uHorizonColor,
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uSunGlowStr: shared.uSunGlowStr,
    },
    vertexShader: /* glsl */ `
      out vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunGlowStr;
      in vec3 vDir;
      out vec4 fragColor;

      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.25, 1.0);
        vec3 sky = mix(uHorizonColor, uMidColor, smoothstep(-0.04, 0.24, h));
        sky = mix(sky, uTopColor, smoothstep(0.20, 0.85, h));

        float sunDot = max(dot(d, normalize(uSunDir)), 0.0);
        sky += uSunColor * (pow(sunDot, 10.0) * 0.28 + pow(sunDot, 72.0) * 0.55) * (0.45 + uSunGlowStr);
        sky = min(sky, vec3(0.98));

        vec3 tm = clamp((sky * (2.51 * sky + 0.03)) / (sky * (2.43 * sky + 0.59) + 0.14), 0.0, 1.0);
        vec3 srgb = mix(tm * 12.92, 1.055 * pow(max(tm, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), tm));
        fragColor = vec4(srgb, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geom, mat);
}
