import type { AreaId } from '../types/world';

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash2(ix: number, iz: number): number {
  const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function smoothNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let px = x;
  let pz = z;
  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise(px + i * 13.7, pz - i * 7.3) * amp;
    norm += amp;
    amp *= 0.5;
    px *= 2.02;
    pz *= 2.02;
  }
  return sum / norm;
}

/** Ridged multifractal inspired by SeedWorld Terrain.cc for majestic mountain spines */
export function ridgedNoise(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let px = x;
  let pz = z;
  for (let i = 0; i < octaves; i++) {
    const n = smoothNoise(px + i * 9.1, pz + i * 5.7);
    const r = 1 - Math.abs(n * 2 - 1);
    sum += r * r * amp;
    norm += amp;
    amp *= 0.48;
    px *= 2.05;
    pz *= 2.05;
  }
  return sum / norm;
}

export function segmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 > 1e-6 ? clamp((wx * vx + wz * vz) / len2, 0, 1) : 0;
  const dx = px - (ax + vx * t);
  const dz = pz - (az + vz * t);
  return Math.hypot(dx, dz);
}

// ============================================================================
// Weizhou Region (渭州郊野 · 官道 — Monumental 288x288 Streamed Open World)
// Water level = 6.0, Valley Floor ≈ 8.5..13, Framing Guanxi Ridges ≈ 32..62
// ============================================================================

export function weizhouRoadX(z: number): number {
  return Math.sin(z * 0.028) * 7.5;
}

export function weizhouRiverZ(x: number): number {
  return 16 + Math.sin(x * 0.036 + 0.5) * 11.5;
}

export function weizhouRoadMask(x: number, z: number): number {
  const mainDist = Math.abs(x - weizhouRoadX(z));
  const branchDist = segmentDistance(x, z, weizhouRoadX(-22), -22, 82, -22);
  const d = Math.min(mainDist, branchDist);
  return 1 - smoothstep(3.2, 5.8, d);
}

export function weizhouRiverDepth(x: number, z: number): number {
  const rz = weizhouRiverZ(x);
  const d = Math.abs(z - rz);
  return 1 - smoothstep(4.8, 10.5, d);
}

export function weizhouGroundHeight(x: number, z: number): number {
  const baseRoll =
    8.5 +
    fbm(x * 0.016 + 1.4, z * 0.016 - 2.3, 4) * 5.8 +
    smoothNoise(x * 0.048 - 3.1, z * 0.048 + 4.7) * 1.8;

  // Majestic Guanxi mountain massifs rising dramatically around the valley
  const distCenter = Math.hypot(x, z);
  const rimWeight = smoothstep(48, 128, distCenter);
  const ridge = ridgedNoise(x * 0.016 + 4.2, z * 0.016 - 1.7, 4);
  let mountain = rimWeight * (14 + ridge * 40);

  // Iconic flanking twin peaks framing the northern Weizhou gate & western horizon
  const heroPeaks: Array<[number, number, number, number]> = [
    [-68, -74, 38, 42],
    [66, -78, 42, 44],
    [-92, 12, 34, 40],
    [94, 42, 32, 38],
    [0, -124, 48, 48],
  ];
  for (const [px, pz, height, radius] of heroPeaks) {
    const d = Math.hypot(x - px, z - pz);
    const w = 1 - smoothstep(6, radius, d);
    mountain = Math.max(mountain, w * height * (0.72 + ridge * 0.42));
  }

  // Keep north town gate, east Wutai pass, and south road corridor clear
  const northPass = 1 - (1 - smoothstep(12, 28, Math.abs(x))) * smoothstep(-36, -92, z);
  const eastPass = 1 - (1 - smoothstep(10, 26, Math.abs(z + 22))) * smoothstep(32, 92, x);
  const southPass =
    1 - (1 - smoothstep(12, 28, Math.abs(x - weizhouRoadX(60)))) * smoothstep(36, 92, z);
  mountain *= Math.min(northPass, eastPass, southPass);

  let h = baseRoll + mountain;

  // Wayside Ten-Li Pavilion terrace near (-18, -6)
  const pavDist = Math.hypot(x + 18, z + 6);
  h = lerp(h, 10.0, 1 - smoothstep(7, 15, pavDist));

  // Roadside farmstead terrace near (24, 34)
  const farmDist = Math.hypot(x - 24, z - 34);
  h = lerp(h, 10.0, 1 - smoothstep(8, 16, farmDist));

  // North Weizhou Gatehouse approach plaza near (0, -74)
  const gateDist = Math.hypot(x, z + 74);
  h = lerp(h, 10.0, 1 - smoothstep(10, 20, gateDist));

  // Carve winding Wei River valley below water level (6.0)
  const river = weizhouRiverDepth(x, z);
  h -= river * 7.8;

  // Smooth imperial road & arched Vermilion Bridge across Wei River
  const road = weizhouRoadMask(x, z);
  const riverDist = Math.abs(z - weizhouRiverZ(x));
  const roadDist = Math.abs(x - weizhouRoadX(z));
  const onBridge = roadDist < 4.5 && riverDist < 11.5;
  if (onBridge) {
    const arch = Math.cos((riverDist / 11.5) * (Math.PI * 0.5));
    const bridgeY = 9.0 + arch * 3.0;
    return Math.max(2.0, bridgeY);
  }

  h = lerp(h, 9.0, road * 0.88);
  return Math.max(2.0, h);
}

// ============================================================================
// Mount Wutai Region (五台山 · 巍峨群峰 — Monumental 288x288 Alpine Massif)
// Water level = 7.0, Climbing Stone Road 9 -> 27, Five Sacred Peaks 56..74!!
// ============================================================================

export function wutaiRoadX(z: number): number {
  return Math.sin(z * 0.036 + 0.4) * 11.0;
}

export function wutaiStreamZ(x: number): number {
  return 34 + Math.sin(x * 0.048) * 5.5 - x * 0.14;
}

export function wutaiRoadMask(x: number, z: number): number {
  const mainDist = Math.abs(x - wutaiRoadX(z));
  const pavSpur = segmentDistance(x, z, wutaiRoadX(4), 4, 20, 4);
  const eastSpur = segmentDistance(x, z, wutaiRoadX(46), 46, 78, 44);
  const d = Math.min(mainDist, pavSpur, eastSpur);
  return 1 - smoothstep(3.0, 5.6, d);
}

export function wutaiGroundHeight(x: number, z: number): number {
  // Steady grand alpine pilgrimage ascent from south valley (z=+78) to summit gate (z=-76)
  const climbT = smoothstep(78, -74, z);
  const valleyFloor = 9.0 + climbT * 17.5;

  // Towering ridged alpine crags flanking both sides of the gorge
  const pathDist = Math.abs(x - wutaiRoadX(z));
  const flankFactor = smoothstep(13, 62, pathDist);
  const ridgeA = ridgedNoise(x * 0.017 + 2.1, z * 0.017 + 6.4, 4);
  const ridgeB = fbm(x * 0.038 - 5.2, z * 0.038 + 1.8, 3);

  // The Five Sacred Peaks of Mount Wutai (五台巍峨主峰) rising 56–74 voxels into the clouds!
  const peaks: Array<[number, number, number, number]> = [
    [-64, -56, 54, 46], // North-West Sacred Peak (西台)
    [66, -52, 56, 46],  // North-East Sacred Peak (东台)
    [-74, 16, 48, 42],  // West Cliff Massif (waterfall cliff!)
    [76, -4, 46, 42],   // East Pine Ridge
    [0, -112, 62, 54],  // Rear Summit Peak (北台叶斗峰)
    [-44, -104, 52, 42],
    [48, -100, 50, 42],
  ];
  let peakBoost = 0;
  for (const [px, pz, height, radius] of peaks) {
    const d = Math.hypot(x - px, z - pz);
    const w = 1 - smoothstep(5, radius, d);
    peakBoost = Math.max(peakBoost, w * height * (0.74 + ridgeA * 0.38));
  }

  let h = valleyFloor + flankFactor * (11 + ridgeA * 32 + ridgeB * 7) + peakBoost;

  // Carve mountain gorge stream & waterfall plunge pool around (-30, 38)
  const streamDist = Math.abs(z - wutaiStreamZ(x));
  const streamCarve = 1 - smoothstep(3.5, 9.0, streamDist);
  const poolDist = Math.hypot(x + 32, z - 38);
  const poolCarve = 1 - smoothstep(5.5, 13.0, poolDist);
  h -= Math.max(streamCarve * 6.8, poolCarve * 7.5);

  // Halfway Wine Pavilion terrace (半山亭) around (20, 4)
  const halfDist = Math.hypot(x - 20, z - 4);
  h = lerp(h, 17.0, 1 - smoothstep(7, 15, halfDist));

  // Summit Monastery Gate terrace around (0, -72)
  const summitDist = Math.hypot(x, z + 72);
  h = lerp(h, 26.0, 1 - smoothstep(10, 20, summitDist));

  // East courier trail to Bianliang around (74, 44)
  const eastDist = Math.hypot(x - 74, z - 44);
  h = lerp(h, 11.0, 1 - smoothstep(8, 16, eastDist));

  // Arched stone pilgrimage bridge over the mountain gorge stream
  const roadDist = Math.abs(x - wutaiRoadX(z));
  if (roadDist < 4.5 && streamDist < 9.5) {
    const arch = Math.cos((streamDist / 9.5) * (Math.PI * 0.5));
    return Math.max(4.0, 11.0 + arch * 2.8);
  }

  // Smooth walkable stone pilgrimage path
  const road = wutaiRoadMask(x, z);
  const targetRoadY = Math.max(9.5, valleyFloor + 0.5);
  h = lerp(h, targetRoadY, road * 0.92);

  return Math.max(2.0, h);
}

// ============================================================================
// Scenes & Interiors Height Functions (1-voxel precision!)
// ============================================================================

export function weizhouTownGroundHeight(x: number, z: number): number {
  // Winding canal spans z in [-7, 7], water surface at y=4, quay at y=6
  if (Math.abs(z) < 7.5) {
    if (Math.abs(x) <= 5.5) {
      const arch = Math.cos((z / 7.5) * (Math.PI * 0.5));
      return 6.0 + arch * 3.2;
    }
    const bank = smoothstep(4.8, 7.5, Math.abs(z));
    return lerp(2.0, 6.0, bank);
  }
  return 6.0;
}

export function wutaiTempleGroundHeight(x: number, z: number): number {
  // Three grand terraced monastery courtyards: y=6 -> y=10 -> y=14
  if (z >= 22) return 6.0;
  if (z >= 14) {
    const t = smoothstep(22, 14, z);
    return Math.abs(x) <= 9 ? lerp(6.0, 10.0, t) : z > 18 ? 6.0 : 10.0;
  }
  if (z >= -6) return 10.0;
  if (z >= -14) {
    const t = smoothstep(-6, -14, z);
    return Math.abs(x) <= 10 ? lerp(10.0, 14.0, t) : z > -10 ? 10.0 : 14.0;
  }
  return 14.0;
}

export function bianliangCityGroundHeight(x: number, z: number): number {
  // Outer moat at z in [42, 54], water surface at y=4, city ground at y=6
  // Grand Imperial Stone Bridge (州桥) spans x in [-7, 7]
  if (z >= 41 && z <= 55) {
    if (Math.abs(x) <= 7.0) {
      const arch = Math.cos(((z - 48) / 7.0) * (Math.PI * 0.5));
      return 6.0 + arch * 2.8;
    }
    const bank = smoothstep(4.8, 7.0, Math.abs(z - 48));
    return lerp(2.0, 6.0, bank);
  }
  return 6.0;
}

export function getGroundHeight(areaId: AreaId, x: number, z: number): number {
  switch (areaId) {
    case 'weizhou_region':
      return weizhouGroundHeight(x, z);
    case 'wutai_region':
      return wutaiGroundHeight(x, z);
    case 'weizhou_town':
      return weizhouTownGroundHeight(x, z);
    case 'wutai_temple':
      return wutaiTempleGroundHeight(x, z);
    case 'bianliang_city':
      return bianliangCityGroundHeight(x, z);
    case 'tavern_interior':
    case 'temple_interior':
      return 0.0;
  }
}

export interface ColliderBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function getStaticColliders(areaId: AreaId): ColliderBox[] {
  switch (areaId) {
    case 'weizhou_town':
      return [
        // 3-story Pan's Grand Tavern (portal in front at x=-12, z=-22)
        { minX: -36, maxX: -15, minZ: -36, maxZ: -16 },
        // Butcher Zheng's Meat Stall
        { minX: 16, maxX: 32, minZ: -26, maxZ: -15 },
        // South-West & South-East market houses
        { minX: -40, maxX: -22, minZ: 14, maxZ: 34 },
        { minX: 22, maxX: 40, minZ: 14, maxZ: 34 },
      ];
    case 'wutai_temple':
      return [
        // Grand Mahavira Hall (portal in front at x=0, z=-19)
        { minX: -22, maxX: 22, minZ: -44, maxZ: -22 },
        // Grand 4-Story Qingliang Pagoda (East Courtyard)
        { minX: 22, maxX: 42, minZ: -8, maxZ: 12 },
        // Bell Tower (West Courtyard)
        { minX: -36, maxX: -22, minZ: 0, maxZ: 14 },
        // Bronze Incense Cauldron
        { minX: -2.5, maxX: 2.5, minZ: 2.5, maxZ: 7.5 },
      ];
    case 'bianliang_city':
      return [
        // Monumental City Wall left & right of central gate tunnel (x in [-6.5, 6.5] is wide open!)
        // Side pedestrian arches at x in [-17..-13] and [13..17] are also open!
        { minX: -76, maxX: -18, minZ: 20, maxZ: 32 },
        { minX: -12, maxX: -6.8, minZ: 20, maxZ: 32 },
        { minX: 6.8, maxX: 12, minZ: 20, maxZ: 32 },
        { minX: 18, maxX: 76, minZ: 20, maxZ: 32 },
        // Fanlou Grand Tavern & West Imperial Street Shops
        { minX: -46, maxX: -18, minZ: -20, maxZ: 12 },
        // East Imperial Street Shops
        { minX: 18, maxX: 46, minZ: -20, maxZ: 12 },
        // Daxiangguo Temple Hall (portal in front at x=-22, z=-48)
        { minX: -42, maxX: -25, minZ: -62, maxZ: -42 },
      ];
    case 'tavern_interior':
      return [
        // Wine bar counter
        { minX: -9.5, maxX: 7.5, minZ: -13, maxZ: -8.5 },
        // Dining tables
        { minX: -11, maxX: -6.5, minZ: -2.5, maxZ: 2.0 },
        { minX: -11, maxX: -6.5, minZ: 4.5, maxZ: 8.0 },
        { minX: 3.5, maxX: 8.0, minZ: 3.0, maxZ: 6.8 },
      ];
    case 'temple_interior':
      return [
        // Golden Buddha Lotus Altar
        { minX: -8.0, maxX: 8.0, minZ: -14.5, maxZ: -7.0 },
        // Incense altar table
        { minX: -3.5, maxX: 3.5, minZ: -4.5, maxZ: -2.2 },
      ];
    case 'weizhou_region':
    case 'wutai_region':
      return [];
  }
}

export function isPointWalkable(areaId: AreaId, x: number, z: number, areaSize: number): boolean {
  const margin = areaId === 'tavern_interior' || areaId === 'temple_interior' ? 1.4 : 3.0;
  if (Math.abs(x) > areaSize - margin || Math.abs(z) > areaSize - margin) {
    return false;
  }

  // Keep player out of unbridged canal/moat water
  if (areaId === 'weizhou_town' && Math.abs(z) < 6.4 && Math.abs(x) > 5.3) {
    return false;
  }
  if (areaId === 'bianliang_city' && z > 42.2 && z < 53.8 && Math.abs(x) > 6.8) {
    return false;
  }

  // Static building & wall colliders
  const colliders = getStaticColliders(areaId);
  const pad = 0.75;
  for (const box of colliders) {
    if (
      x >= box.minX - pad &&
      x <= box.maxX + pad &&
      z >= box.minZ - pad &&
      z <= box.maxZ + pad
    ) {
      return false;
    }
  }

  // Prevent climbing vertical alpine cliff faces in open regions
  if (areaId === 'weizhou_region' || areaId === 'wutai_region') {
    const h = getGroundHeight(areaId, x, z);
    if (areaId === 'weizhou_region' && h > 25) return false;
    if (areaId === 'wutai_region' && h > 39) return false;
  }

  return true;
}
