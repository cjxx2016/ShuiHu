import * as THREE from 'three';
import {
  MAT_LINEAR_RGB,
  VOX_MAT_SPECS,
  VoxMat,
  isGlowMat,
  isLeafMat,
  isSolidVoxel,
} from './materials';
import { VoxelGrid } from './VoxelGrid';
import { smoothNoise } from '../../game/terrainMath';

interface FaceDir {
  axis: 0 | 1 | 2;
  sign: -1 | 1;
  uAxis: 0 | 1 | 2;
  vAxis: 0 | 1 | 2;
  nx: number;
  ny: number;
  nz: number;
}

const DIRS: FaceDir[] = [
  { axis: 0, sign: -1, uAxis: 2, vAxis: 1, nx: -1, ny: 0, nz: 0 },
  { axis: 0, sign: 1, uAxis: 2, vAxis: 1, nx: 1, ny: 0, nz: 0 },
  { axis: 2, sign: 1, uAxis: 0, vAxis: 1, nx: 0, ny: 0, nz: 1 },
  { axis: 2, sign: -1, uAxis: 0, vAxis: 1, nx: 0, ny: 0, nz: -1 },
  { axis: 1, sign: 1, uAxis: 0, vAxis: 2, nx: 0, ny: 1, nz: 0 },
  { axis: 1, sign: -1, uAxis: 0, vAxis: 2, nx: 0, ny: -1, nz: 0 },
];

const AO_FACTORS = [0.46, 0.68, 0.85, 1.0];

interface DirRayTable {
  count: number;
  steps: number;
  rx: Float32Array;
  ry: Float32Array;
  rz: Float32Array;
  rw: Float32Array;
  ux: Float32Array;
  uy: Float32Array;
  uz: Float32Array;
  stepWeight: number;
}

/**
 * Fast Golden-Spiral Hemisphere Ray Tables (matching SeedWorld's Mesher.cc algorithm).
 * Uses 22 Fibonacci sphere points (~10 rays per hemisphere face) × 6 progressive distances
 * so both real-time chunk streaming AND full architectural scenes bake in milliseconds
 * while producing smooth soft canopy shadows & curved 3D bent normals!
 */
const RAY_TABLES: DirRayTable[] = (() => {
  const N = 26;
  const DISTS = [1.4, 2.8, 4.8, 7.6, 11.4, 16.5];
  const inc = Math.PI * (3 - Math.sqrt(5));
  const sphere: Array<[number, number, number]> = [];
  for (let i = 0; i < N; i++) {
    const y = i * (2 / N) - 1 + 1 / N;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * inc;
    sphere.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
  }
  return DIRS.map((dir) => {
    const pts = sphere.filter((p) => p[0] * dir.nx + p[1] * dir.ny + p[2] * dir.nz > 0.22);
    const count = pts.length;
    const steps = DISTS.length;
    const rx = new Float32Array(count * steps);
    const ry = new Float32Array(count * steps);
    const rz = new Float32Array(count * steps);
    const rw = new Float32Array(count * steps);
    const ux = new Float32Array(count);
    const uy = new Float32Array(count);
    const uz = new Float32Array(count);
    for (let r = 0; r < count; r++) {
      const [dx, dy, dz] = pts[r];
      ux[r] = dx;
      uy[r] = dy;
      uz[r] = dz;
      for (let s = 0; s < steps; s++) {
        const k = r * steps + s;
        const d = DISTS[s];
        rx[k] = dx * d;
        ry[k] = dy * d;
        rz[k] = dz * d;
        rw[k] = 1.0 / (1.0 + d * 0.14);
      }
    }
    return {
      count,
      steps,
      rx,
      ry,
      rz,
      rw,
      ux,
      uy,
      uz,
      stepWeight: 1.52 / Math.max(1, count),
    };
  });
})();

const BIOME_COOL = new THREE.Color(0x27854b);
const BIOME_MID = new THREE.Color(0x5ab534);
const BIOME_WARM = new THREE.Color(0xa6da22);
const BIOME_DAMP = new THREE.Color(0x2d8d68);
const _tmpCol = new THREE.Color();

export interface MeshBakeOptions {
  /** Optional world-space sampler for seamless cross-chunk neighbor occlusion */
  worldSampler?: (wx: number, wy: number, wz: number) => VoxMat;
  /** Skip sky raytracing for fast outer LOD chunks (uses fast top-heightmap + 4-corner AO) */
  fastLod?: boolean;
  /** Build 3D flood-fill chromatic color bleed & lantern light volume */
  buildBleedVolume?: boolean;
  /** Extra padding along chunk border (0 = mesh entire grid; halo = inner region only) */
  halo?: number;
}

export interface BakedVoxelResult {
  geometry: THREE.BufferGeometry | null;
  waterGeometry: THREE.BufferGeometry | null;
  bleedTex: THREE.Data3DTexture | null;
  volMin: THREE.Vector3;
  volSize: THREE.Vector3;
  triangleCount: number;
}

/**
 * Bakes a VoxelGrid into SeedWorld-format BufferGeometries (solid voxels + stylized water)
 * with 4-corner AO, Golden-Spiral SkyGI, 3D Bent Normals, Continuous Biome Grass Flow,
 * Environmental Moss/Moisture Grounding, and optional 3D Flood-Fill Chromatic Bleed Volume.
 */
export function bakeSeedWorldMesh(
  grid: VoxelGrid,
  opts: MeshBakeOptions = {}
): BakedVoxelResult {
  const { sx, sy, sz, originX, originY, originZ, voxelScale } = grid;
  const halo = opts.halo ?? 0;
  const xStart = halo;
  const xEnd = sx - halo;
  const zStart = halo;
  const zEnd = sz - halo;
  const fastLod = opts.fastLod ?? false;
  const sampler = opts.worldSampler;

  const getVox = (lx: number, ly: number, lz: number): VoxMat => {
    if (lx >= 0 && lx < sx && ly >= 0 && ly < sy && lz >= 0 && lz < sz) {
      return grid.data[(ly * sz + lz) * sx + lx] as VoxMat;
    }
    if (sampler) {
      return sampler(lx + originX, ly + originY, lz + originZ);
    }
    return VoxMat.EMPTY;
  };

  // 1. Precompute column top-solid Y & water mask
  const topSolidY = new Int16Array(sx * sz).fill(-1);
  const waterSurfaceY = new Int16Array(sx * sz).fill(-1);
  const waterBedY = new Int16Array(sx * sz).fill(-1);
  const hasGrassCol = new Uint8Array(sx * sz);
  const hasWaterCol = new Uint8Array(sx * sz);

  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const ci = z * sx + x;
      let topS = -1;
      let topW = -1;
      let bedW = -1;
      for (let y = sy - 1; y >= 0; y--) {
        const m = grid.data[(y * sz + z) * sx + x] as VoxMat;
        if (m === VoxMat.EMPTY) continue;
        if (m === VoxMat.WATER) {
          if (topW < 0) topW = y;
          hasWaterCol[ci] = 1;
        } else {
          if (topS < 0 && !isGlowMat(m)) topS = y;
          if (topW >= 0 && bedW < 0) bedW = y;
          if (m === VoxMat.GRASS || m === VoxMat.MOSS) hasGrassCol[ci] = 1;
        }
      }
      topSolidY[ci] = topS;
      waterSurfaceY[ci] = topW;
      waterBedY[ci] = bedW;
    }
  }

  // 2. Fast half-res 3D Environmental Proximity (groundProx & waterProx)
  const EX = Math.max(1, sx >> 1);
  const EY = Math.max(1, sy >> 1);
  const EZ = Math.max(1, sz >> 1);
  const envTotal = EX * EY * EZ;
  let groundProx = new Float32Array(envTotal);
  let waterProx = new Float32Array(envTotal);

  for (let z = 0; z < sz; z += 2) {
    for (let y = 0; y < sy; y += 2) {
      const eyOff = (y >> 1) * EZ + (z >> 1);
      for (let x = 0; x < sx; x += 2) {
        const m = grid.data[(y * sz + z) * sx + x] as VoxMat;
        const ei = eyOff * EX + (x >> 1);
        if (m === VoxMat.GRASS || m === VoxMat.MOSS) groundProx[ei] = 1.0;
        else if (m === VoxMat.WATER) waterProx[ei] = 1.0;
      }
    }
  }

  let gpTmp = new Float32Array(envTotal);
  let wpTmp = new Float32Array(envTotal);
  const strideYEnv = EX * EZ;
  for (let pass = 0; pass < 4; pass++) {
    for (let y = 0; y < EY; y++) {
      for (let z = 0; z < EZ; z++) {
        const row = y * strideYEnv + z * EX;
        for (let x = 0; x < EX; x++) {
          const i = row + x;
          let gm = groundProx[i];
          let wm = waterProx[i];
          if (x > 0) {
            gm = Math.max(gm, groundProx[i - 1] * 0.76);
            wm = Math.max(wm, waterProx[i - 1] * 0.78);
          }
          if (x < EX - 1) {
            gm = Math.max(gm, groundProx[i + 1] * 0.76);
            wm = Math.max(wm, waterProx[i + 1] * 0.78);
          }
          if (y > 0) {
            gm = Math.max(gm, groundProx[i - strideYEnv] * 0.72);
            wm = Math.max(wm, waterProx[i - strideYEnv] * 0.74);
          }
          if (y < EY - 1) {
            gm = Math.max(gm, groundProx[i + strideYEnv] * 0.72);
            wm = Math.max(wm, waterProx[i + strideYEnv] * 0.74);
          }
          if (z > 0) {
            gm = Math.max(gm, groundProx[i - EX] * 0.76);
            wm = Math.max(wm, waterProx[i - EX] * 0.78);
          }
          if (z < EZ - 1) {
            gm = Math.max(gm, groundProx[i + EX] * 0.76);
            wm = Math.max(wm, waterProx[i + EX] * 0.78);
          }
          gpTmp[i] = gm;
          wpTmp[i] = wm;
        }
      }
    }
    [groundProx, gpTmp] = [gpTmp, groundProx];
    [waterProx, wpTmp] = [wpTmp, waterProx];
  }

  // 3. Emit exposed voxel faces with 4-corner AO + SkyGI + BentNorm + Biome Flow
  const pos: number[] = [];
  const norm: number[] = [];
  const bentNorm: number[] = [];
  const col: number[] = [];
  const flowMeta: number[] = [];
  const lightMeta: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];

  const cornerAO = (
    p0: number,
    p1: number,
    p2: number,
    axis: 0 | 1 | 2,
    sign: -1 | 1,
    uAxis: 0 | 1 | 2,
    vAxis: 0 | 1 | 2,
    du: number,
    dv: number
  ): number => {
    const b = [p0, p1, p2];
    b[axis] += sign;
    const s1p = [b[0], b[1], b[2]];
    s1p[uAxis] += du;
    const s2p = [b[0], b[1], b[2]];
    s2p[vAxis] += dv;
    const cp = [b[0], b[1], b[2]];
    cp[uAxis] += du;
    cp[vAxis] += dv;
    const s1 = isSolidVoxel(getVox(s1p[0], s1p[1], s1p[2])) ? 1 : 0;
    const s2 = isSolidVoxel(getVox(s2p[0], s2p[1], s2p[2])) ? 1 : 0;
    const c = isSolidVoxel(getVox(cp[0], cp[1], cp[2])) ? 1 : 0;
    if (s1 && s2) return AO_FACTORS[0];
    return AO_FACTORS[3 - (s1 + s2 + c)];
  };

  const computeLocalElev = (lx: number, ly: number, lz: number, m: VoxMat): number => {
    if (m === VoxMat.GRASS || isGlowMat(m)) return 0.5;
    let cUp = 0;
    let cDn = 0;
    const leaf = isLeafMat(m);
    for (let dy = 1; dy <= 10; dy++) {
      const nm = getVox(lx, ly + dy, lz);
      if (leaf ? !isLeafMat(nm) : !isSolidVoxel(nm)) break;
      cUp++;
    }
    for (let dy = 1; dy <= 10; dy++) {
      const nm = getVox(lx, ly - dy, lz);
      if (leaf ? !isLeafMat(nm) : !isSolidVoxel(nm) || nm === VoxMat.GRASS || nm === VoxMat.DIRT) break;
      cDn++;
    }
    return cDn / Math.max(1, cDn + cUp);
  };

  const computeLeafThickness = (lx: number, ly: number, lz: number): number => {
    let cnt = 0;
    for (let dy = 1; dy <= 5; dy++) {
      if (isLeafMat(getVox(lx, ly + dy, lz))) cnt++;
      if (isLeafMat(getVox(lx, ly - dy, lz))) cnt++;
    }
    return Math.min(1, cnt / 8);
  };

  const sampleGrassBiome = (wx: number, wz: number, wp: number): [number, number, number] => {
    const n1 = smoothNoise(wx * 0.032 + 11.3, wz * 0.032 + 4.7);
    const n2 = smoothNoise(wx * 0.018 - 3.1, wz * 0.022 + 8.9);
    const t = Math.max(0, Math.min(1, 0.5 + (n1 - 0.5) * 1.55 + (n2 - 0.5) * 0.9));
    if (t < 0.5) _tmpCol.copy(BIOME_COOL).lerp(BIOME_MID, t * 2);
    else _tmpCol.copy(BIOME_MID).lerp(BIOME_WARM, (t - 0.5) * 2);
    if (wp > 0.05) {
      _tmpCol.lerp(BIOME_DAMP, Math.min(0.65, wp * 0.65));
    }
    return [_tmpCol.r, _tmpCol.g, _tmpCol.b];
  };

  // Sweep all inner voxels
  for (let ly = 0; ly < sy; ly++) {
    const yOff = ly * sz;
    for (let lz = zStart; lz < zEnd; lz++) {
      const row = (yOff + lz) * sx;
      for (let lx = xStart; lx < xEnd; lx++) {
        const m = grid.data[row + lx] as VoxMat;
        if (!isSolidVoxel(m)) continue;

        const spec = VOX_MAT_SPECS[m];
        const isLeaf = isLeafMat(m);
        const ei = ((ly >> 1) * EZ + (lz >> 1)) * EX + (lx >> 1);
        const gp = groundProx[ei];
        const wp = isLeaf ? computeLeafThickness(lx, ly, lz) : waterProx[ei];
        let elevCached = -1;

        const wx = lx + originX;
        const wy = ly + originY;
        const wz = lz + originZ;

        // Check all 6 faces
        for (let d = 0; d < 6; d++) {
          const dir = DIRS[d];
          const nlx = lx + dir.nx;
          const nly = ly + dir.ny;
          const nlz = lz + dir.nz;
          if (isSolidVoxel(getVox(nlx, nly, nlz))) continue;

          // Skip world bottom faces at y=0
          if (ly === 0 && dir.ny < 0) continue;

          if (elevCached < 0) {
            elevCached = computeLocalElev(lx, ly, lz, m);
          }

          // Sky visibility GI + 3D Bent Normal
          let faceSky = 1.0;
          let smoothSky = 1.0;
          let bnx = dir.nx;
          let bny = dir.ny;
          let bnz = dir.nz;

          if (fastLod || isGlowMat(m)) {
            const topY = topSolidY[lz * sx + lx];
            const underRoof = ly < topY;
            faceSky = underRoof ? 0.55 : dir.ny > 0 ? 1.0 : dir.ny < 0 ? 0.42 : 0.85;
            smoothSky = faceSky;
          } else {
            const rays = RAY_TABLES[d];
            const ox = lx + 0.5 + dir.nx * 0.55;
            const oy = ly + 0.5 + dir.ny * 0.55;
            const oz = lz + 0.5 + dir.nz * 0.55;
            let occSmooth = 0;
            let occOrig = 0;
            let bx = 0;
            let by = 0;
            let bz = 0;

            for (let r = 0; r < rays.count; r++) {
              const base = r * rays.steps;
              let clear = 1.0;
              for (let s = 0; s < rays.steps; s++) {
                const k = base + s;
                const sxp = Math.floor(ox + rays.rx[k]);
                const syp = Math.floor(oy + rays.ry[k]);
                const szp = Math.floor(oz + rays.rz[k]);
                if (syp >= sy) break;
                if (syp < 0) {
                  occSmooth += rays.stepWeight * rays.rw[k];
                  occOrig += rays.stepWeight * rays.rw[k];
                  clear = 0.25;
                  break;
                }
                const hit = getVox(sxp, syp, szp);
                if (!isSolidVoxel(hit) || isGlowMat(hit)) continue;
                const leafHit = isLeafMat(hit);
                const term = rays.stepWeight * rays.rw[k];
                occSmooth += term * (leafHit ? 0.72 : 1.0);
                occOrig += term;
                clear = Math.max(0.08, 1.0 - rays.rw[k] * (leafHit ? 0.55 : 0.88));
                break;
              }
              bx += rays.ux[r] * clear;
              by += rays.uy[r] * clear;
              bz += rays.uz[r] * clear;
            }
            smoothSky = Math.max(0.16, Math.min(1.0, 1.0 - occSmooth));
            faceSky = Math.max(0.16, Math.min(1.0, 1.0 - occOrig));
            const topY = topSolidY[lz * sx + lx];
            if (ly < topY && dir.ny >= 0) {
              smoothSky *= 0.88;
            }
            const blen = Math.hypot(bx, by, bz);
            if (blen > 1e-4) {
              bnx = bx / blen;
              bny = by / blen;
              bnz = bz / blen;
            }
          }

          // 4-Corner Voxel AO
          const ao00 = cornerAO(lx, ly, lz, dir.axis, dir.sign, dir.uAxis, dir.vAxis, -1, -1);
          const ao10 = cornerAO(lx, ly, lz, dir.axis, dir.sign, dir.uAxis, dir.vAxis, 1, -1);
          const ao11 = cornerAO(lx, ly, lz, dir.axis, dir.sign, dir.uAxis, dir.vAxis, 1, 1);
          const ao01 = cornerAO(lx, ly, lz, dir.axis, dir.sign, dir.uAxis, dir.vAxis, -1, 1);

          // Construct 4 quad corners in world space
          const makeVert = (du: number, dv: number): [number, number, number] => {
            const p: [number, number, number] = [wx, wy, wz];
            p[dir.axis] += dir.sign > 0 ? 1 : 0;
            p[dir.uAxis] += du;
            p[dir.vAxis] += dv;
            return [p[0] * voxelScale, p[1] * voxelScale, p[2] * voxelScale];
          };
          const c00 = makeVert(0, 0);
          const c10 = makeVert(1, 0);
          const c11 = makeVert(1, 1);
          const c01 = makeVert(0, 1);

          // Ensure outward counter-clockwise winding
          const e1x = c10[0] - c00[0];
          const e1y = c10[1] - c00[1];
          const e1z = c10[2] - c00[2];
          const e2x = c11[0] - c00[0];
          const e2y = c11[1] - c00[1];
          const e2z = c11[2] - c00[2];
          const crx = e1y * e2z - e1z * e2y;
          const cry = e1z * e2x - e1x * e2z;
          const crz = e1x * e2y - e1y * e2x;
          const frontFacing = crx * dir.nx + cry * dir.ny + crz * dir.nz > 0;

          const baseVert = pos.length / 3;
          const cr = MAT_LINEAR_RGB[m * 3];
          const cg = MAT_LINEAR_RGB[m * 3 + 1];
          const cb = MAT_LINEAR_RGB[m * 3 + 2];

          const corners: Array<{ p: [number, number, number]; u: number; v: number; ao: number }> = [
            { p: c00, u: 0, v: 0, ao: ao00 },
            { p: c10, u: 1, v: 0, ao: ao10 },
            { p: c11, u: 1, v: 1, ao: ao11 },
            { p: c01, u: 0, v: 1, ao: ao01 },
          ];

          for (let ci = 0; ci < 4; ci++) {
            const q = corners[ci];
            pos.push(q.p[0], q.p[1], q.p[2]);
            norm.push(dir.nx, dir.ny, dir.nz);
            bentNorm.push(bnx, bny, bnz);
            flowMeta.push(spec.flowMatId, elevCached, gp, wp);
            lightMeta.push(faceSky, smoothSky, q.ao, spec.matKind);
            uvs.push(q.u, q.v);

            if (m === VoxMat.GRASS) {
              const [gr, gg, gb] = sampleGrassBiome(q.p[0], q.p[2], wp);
              col.push(gr, gg, gb);
            } else {
              col.push(cr, cg, cb);
            }
          }

          // SeedWorld FixAnisotropy diagonal split for artifact-free AO interpolation
          const flipDiag = ao00 + ao11 < ao10 + ao01;
          if (frontFacing) {
            if (!flipDiag) {
              idx.push(baseVert, baseVert + 1, baseVert + 2, baseVert, baseVert + 2, baseVert + 3);
            } else {
              idx.push(baseVert + 1, baseVert + 2, baseVert + 3, baseVert + 1, baseVert + 3, baseVert);
            }
          } else {
            if (!flipDiag) {
              idx.push(baseVert, baseVert + 2, baseVert + 1, baseVert, baseVert + 3, baseVert + 2);
            } else {
              idx.push(baseVert + 1, baseVert + 3, baseVert + 2, baseVert + 1, baseVert, baseVert + 3);
            }
          }
        }
      }
    }
  }

  let geometry: THREE.BufferGeometry | null = null;
  if (idx.length > 0) {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    geometry.setAttribute('aBentNorm', new THREE.Float32BufferAttribute(bentNorm, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geometry.setAttribute('aFlowMeta', new THREE.Float32BufferAttribute(flowMeta, 4));
    geometry.setAttribute('aLightMeta', new THREE.Float32BufferAttribute(lightMeta, 4));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(idx);
    geometry.computeBoundingSphere();
  }

  // 4. Extract Water Surface Geometry (top faces of water columns with exact depth & shore foam)
  const wPos: number[] = [];
  const wDepthShore: number[] = [];
  const wIdx: number[] = [];

  for (let lz = zStart; lz < zEnd; lz++) {
    for (let lx = xStart; lx < xEnd; lx++) {
      const ci = lz * sx + lx;
      const topW = waterSurfaceY[ci];
      if (topW < 0) continue;
      // Only emit water surface if air is above it
      if (getVox(lx, topW + 1, lz) !== VoxMat.EMPTY) continue;

      const bed = waterBedY[ci] >= 0 ? waterBedY[ci] : topW - 2;
      const depth = Math.max(0.5, (topW - bed) * voxelScale);

      // Shoreline detection: adjacent to any solid block at surface level
      let shore = 0;
      if (
        isSolidVoxel(getVox(lx - 1, topW, lz)) ||
        isSolidVoxel(getVox(lx + 1, topW, lz)) ||
        isSolidVoxel(getVox(lx, topW, lz - 1)) ||
        isSolidVoxel(getVox(lx, topW, lz + 1))
      ) {
        shore = 1.0;
      }

      const x0 = (lx + originX) * voxelScale;
      const x1 = (lx + 1 + originX) * voxelScale;
      const z0 = (lz + originZ) * voxelScale;
      const z1 = (lz + 1 + originZ) * voxelScale;
      const wy = (topW + 0.84 + originY) * voxelScale;

      const bv = wPos.length / 3;
      wPos.push(x0, wy, z0, x0, wy, z1, x1, wy, z1, x1, wy, z0);
      wDepthShore.push(depth, shore, depth, shore, depth, shore, depth, shore);
      wIdx.push(bv, bv + 1, bv + 2, bv, bv + 2, bv + 3);
    }
  }

  let waterGeometry: THREE.BufferGeometry | null = null;
  if (wIdx.length > 0) {
    waterGeometry = new THREE.BufferGeometry();
    waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
    waterGeometry.setAttribute('aDepthShore', new THREE.Float32BufferAttribute(wDepthShore, 2));
    waterGeometry.setIndex(wIdx);
    waterGeometry.computeBoundingSphere();
  }

  // 5. Optional 3D Flood-Fill Chromatic Albedo Bounce + Lantern/Window Light Spill Texture
  let bleedTex: THREE.Data3DTexture | null = null;
  if (opts.buildBleedVolume) {
    bleedTex = buildColorBleed3DTexture(grid);
  }

  return {
    geometry,
    waterGeometry,
    bleedTex,
    volMin: new THREE.Vector3(originX * voxelScale, originY * voxelScale, originZ * voxelScale),
    volSize: new THREE.Vector3(sx * voxelScale, sy * voxelScale, sz * voxelScale),
    triangleCount: idx.length / 3,
  };
}

/**
 * Port of seedworld-tree-house_base.html's 3D Flood-Fill Color Bleeding Volume:
 * Half-res RGBA Data3DTexture where RGB = chromatic albedo bounce & A = glowing lantern/window spill.
 */
export function buildColorBleed3DTexture(grid: VoxelGrid): THREE.Data3DTexture {
  const BX = Math.max(2, grid.sx >> 1);
  const BY = Math.max(2, grid.sy >> 1);
  const BZ = Math.max(2, grid.sz >> 1);
  const total = BX * BY * BZ;

  const occCnt = new Uint8Array(total);
  const solidWall = new Uint8Array(total);
  let srcR = new Float32Array(total);
  let srcG = new Float32Array(total);
  let srcB = new Float32Array(total);
  let srcE = new Float32Array(total);

  const nb6 = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  for (let y = 0; y < grid.sy; y++) {
    const by = Math.min(BY - 1, y >> 1);
    for (let z = 0; z < grid.sz; z++) {
      const bz = Math.min(BZ - 1, z >> 1);
      const row = (y * grid.sz + z) * grid.sx;
      const bRow = (bz * BY + by) * BX;
      for (let x = 0; x < grid.sx; x++) {
        const mat = grid.data[row + x] as VoxMat;
        if (mat === VoxMat.EMPTY) continue;
        const bx = Math.min(BX - 1, x >> 1);
        const bi = bRow + bx;
        if (mat === VoxMat.WATER) {
          srcR[bi] += 0.05;
          srcG[bi] += 0.22;
          srcB[bi] += 0.34;
          continue;
        }
        occCnt[bi]++;
        if (isGlowMat(mat)) {
          srcE[bi] = Math.max(srcE[bi], 1.35);
          for (let d = 0; d < 6; d++) {
            const nx = bx + nb6[d][0];
            const ny = by + nb6[d][1];
            const nz = bz + nb6[d][2];
            if (nx >= 0 && nx < BX && ny >= 0 && ny < BY && nz >= 0 && nz < BZ) {
              const ni = (nz * BY + ny) * BX + nx;
              srcE[ni] = Math.max(srcE[ni], 1.05);
            }
          }
        } else {
          const bounce = VOX_MAT_SPECS[mat].bounce;
          if (bounce && (x & 1) === 0 && (z & 1) === 0) {
            const airAbove = grid.getLocal(x, y + 1, z) === VoxMat.EMPTY;
            if (
              airAbove ||
              grid.getLocal(x + 1, y, z) === VoxMat.EMPTY ||
              grid.getLocal(x, y, z + 1) === VoxMat.EMPTY
            ) {
              const w = airAbove ? 0.36 : 0.22;
              const ai = (bz * BY + Math.min(BY - 1, (y + 1) >> 1)) * BX + bx;
              srcR[ai] += bounce[0] * w;
              srcG[ai] += bounce[1] * w;
              srcB[ai] += bounce[2] * w;
            }
          }
        }
      }
    }
  }

  for (let i = 0; i < total; i++) {
    solidWall[i] = occCnt[i] >= 6 ? 1 : 0;
    srcR[i] = Math.min(1.4, srcR[i]);
    srcG[i] = Math.min(1.4, srcG[i]);
    srcB[i] = Math.min(1.4, srcB[i]);
  }

  let dstR = new Float32Array(total);
  let dstG = new Float32Array(total);
  let dstB = new Float32Array(total);
  let dstE = new Float32Array(total);
  const strideZ = BX * BY;

  for (let pass = 0; pass < 5; pass++) {
    for (let z = 0; z < BZ; z++) {
      for (let y = 0; y < BY; y++) {
        const row = (z * BY + y) * BX;
        for (let x = 0; x < BX; x++) {
          const i = row + x;
          if (solidWall[i]) {
            dstR[i] = srcR[i];
            dstG[i] = srcG[i];
            dstB[i] = srcB[i];
            dstE[i] = srcE[i];
            continue;
          }
          let sr = srcR[i];
          let sg = srcG[i];
          let sb = srcB[i];
          let se = srcE[i];
          let cnt = 1.0;
          const check = (ni: number) => {
            if (solidWall[ni]) return;
            sr += srcR[ni];
            sg += srcG[ni];
            sb += srcB[ni];
            se += srcE[ni];
            cnt += 1.0;
          };
          if (x > 0) check(i - 1);
          if (x < BX - 1) check(i + 1);
          if (y > 0) check(i - BX);
          if (y < BY - 1) check(i + BX);
          if (z > 0) check(i - strideZ);
          if (z < BZ - 1) check(i + strideZ);
          const inv = 0.88 / cnt;
          dstR[i] = Math.max(srcR[i] * 0.55, sr * inv);
          dstG[i] = Math.max(srcG[i] * 0.55, sg * inv);
          dstB[i] = Math.max(srcB[i] * 0.55, sb * inv);
          dstE[i] = Math.max(srcE[i] * 0.65, se * (0.88 / cnt));
        }
      }
    }
    [srcR, dstR] = [dstR, srcR];
    [srcG, dstG] = [dstG, srcG];
    [srcB, dstB] = [dstB, srcB];
    [srcE, dstE] = [dstE, srcE];
  }

  const rgba = new Uint8Array(total * 4);
  for (let i = 0; i < total; i++) {
    const j = i * 4;
    rgba[j] = Math.min(255, Math.round((srcR[i] / 1.4) * 255));
    rgba[j + 1] = Math.min(255, Math.round((srcG[i] / 1.4) * 255));
    rgba[j + 2] = Math.min(255, Math.round((srcB[i] / 1.4) * 255));
    rgba[j + 3] = Math.min(255, Math.round(Math.min(1.0, srcE[i]) * 255));
  }

  const tex = new THREE.Data3DTexture(rgba, BX, BY, BZ);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
