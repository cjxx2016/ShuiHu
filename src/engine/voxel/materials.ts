import * as THREE from 'three';

/**
 * Unified Song Dynasty + SeedWorld Voxel Material IDs.
 * Follows seedworld-tree-house_base.html's strict clean base palette + continuous 3D Color Flow,
 * enriched with Song architectural finishes (vermilion lacquer, jade-glazed tiles, gold finials,
 * warm glowing shoji windows, crimson palace lanterns, alpine snow, and waterfall foam).
 */
export enum VoxMat {
  EMPTY = 0,
  GRASS = 1,
  MOSS = 2,
  DIRT = 3,
  ROAD = 4,
  STONE = 5,
  SLATE = 6,
  BASALT = 7,
  SNOW = 8,
  SAND = 9,
  TRUNK = 10,
  TIMBER = 11,
  LIGHT_WOOD = 12,
  PLASTER = 13,
  VERMILION = 14,
  JADE_TILE = 15,
  ROOF_RED = 16,
  ROOF_DARK = 17,
  GOLD = 18,
  BRONZE = 19,
  LEAF_SPRING = 20,
  LEAF_PINE = 21,
  LEAF_AUTUMN = 22,
  LEAF_SAKURA = 23,
  LEAF_WILLOW = 24,
  GLOW_WARM = 25,
  GLOW_LANTERN = 26,
  WATER = 27,
  FOAM = 28,
  BANNER_RED = 29,
  BANNER_GOLD = 30,
  CARPET_RED = 31,
  ROCK = 32,
  GRANITE = 33,
  CLAY_TILE = 34,
  BANNER_BLUE = 35,
  FLOWER_GOLD = 36,
  FLOWER_PINK = 37,
}

export interface VoxMatSpec {
  hex: number;
  /**
   * 0 = Biome/Glow (no object flow)
   * 1 = Foliage (chartreuse tips <-> teal-emerald depth)
   * 2 = Wood/Trunk (weathered walnut <-> warm honey cedar + moss grounding)
   * 3 = Plaster/Wall (cool chalk <-> warm ivory + moss grounding)
   * 4 = Roof/Vermilion/Tile (deep kiln shade <-> sunlit warm)
   * 5 = Stone/Slate/Road (cool slate <-> warm ochre + wet river patina)
   * 6 = Dirt/Cliff Strata (geological peat <-> warm loam bands)
   * 7 = Banners/Flowers/Snow
   */
  flowMatId: number;
  /** 0 = matte, 1 = glazed/metallic/lacquer, 2 = foliage (canopy SSS + wind), 3 = emissive */
  matKind: number;
  /** Chromatic 3D flood-fill albedo bounce RGB (or null if minimal) */
  bounce: [number, number, number] | null;
}

export const VOX_MAT_SPECS: Record<VoxMat, VoxMatSpec> = {
  [VoxMat.EMPTY]:        { hex: 0x000000, flowMatId: 0, matKind: 0, bounce: null },
  [VoxMat.GRASS]:        { hex: 0x59a645, flowMatId: 0, matKind: 0, bounce: [0.34, 0.86, 0.22] },
  [VoxMat.MOSS]:         { hex: 0x4b873c, flowMatId: 1, matKind: 0, bounce: [0.28, 0.72, 0.24] },
  [VoxMat.DIRT]:         { hex: 0x7a5538, flowMatId: 6, matKind: 0, bounce: [0.20, 0.14, 0.10] },
  [VoxMat.ROAD]:         { hex: 0xc9b99b, flowMatId: 5, matKind: 0, bounce: [0.58, 0.52, 0.42] },
  [VoxMat.STONE]:        { hex: 0x999992, flowMatId: 5, matKind: 0, bounce: [0.22, 0.22, 0.23] },
  [VoxMat.SLATE]:        { hex: 0x5e6774, flowMatId: 5, matKind: 0, bounce: [0.16, 0.18, 0.22] },
  [VoxMat.BASALT]:       { hex: 0x3b414d, flowMatId: 5, matKind: 0, bounce: [0.12, 0.13, 0.16] },
  [VoxMat.SNOW]:         { hex: 0xedf3f8, flowMatId: 7, matKind: 0, bounce: [0.80, 0.86, 0.96] },
  [VoxMat.SAND]:         { hex: 0xd8c79d, flowMatId: 5, matKind: 0, bounce: [0.64, 0.56, 0.38] },
  [VoxMat.TRUNK]:        { hex: 0x623f27, flowMatId: 2, matKind: 0, bounce: [0.36, 0.22, 0.12] },
  [VoxMat.TIMBER]:       { hex: 0x7d4e2d, flowMatId: 2, matKind: 0, bounce: [0.46, 0.28, 0.14] },
  [VoxMat.LIGHT_WOOD]:   { hex: 0xc2925e, flowMatId: 2, matKind: 0, bounce: [0.64, 0.46, 0.26] },
  [VoxMat.PLASTER]:      { hex: 0xefe6d5, flowMatId: 3, matKind: 0, bounce: [0.86, 0.80, 0.68] },
  [VoxMat.VERMILION]:    { hex: 0xc93028, flowMatId: 4, matKind: 1, bounce: [0.96, 0.24, 0.16] },
  [VoxMat.JADE_TILE]:    { hex: 0x226875, flowMatId: 4, matKind: 1, bounce: [0.16, 0.52, 0.58] },
  [VoxMat.ROOF_RED]:     { hex: 0xb75038, flowMatId: 4, matKind: 1, bounce: [0.92, 0.34, 0.18] },
  [VoxMat.ROOF_DARK]:    { hex: 0x394552, flowMatId: 5, matKind: 1, bounce: [0.18, 0.22, 0.28] },
  [VoxMat.GOLD]:         { hex: 0xf4be3c, flowMatId: 7, matKind: 1, bounce: [1.02, 0.78, 0.22] },
  [VoxMat.BRONZE]:       { hex: 0x456358, flowMatId: 5, matKind: 1, bounce: [0.22, 0.38, 0.32] },
  [VoxMat.LEAF_SPRING]:  { hex: 0x82c928, flowMatId: 1, matKind: 2, bounce: [0.48, 0.90, 0.16] },
  [VoxMat.LEAF_PINE]:    { hex: 0x2a7a47, flowMatId: 1, matKind: 2, bounce: [0.18, 0.66, 0.34] },
  [VoxMat.LEAF_AUTUMN]:  { hex: 0xe38424, flowMatId: 1, matKind: 2, bounce: [1.04, 0.54, 0.14] },
  [VoxMat.LEAF_SAKURA]:  { hex: 0xf496b6, flowMatId: 1, matKind: 2, bounce: [0.96, 0.52, 0.68] },
  [VoxMat.LEAF_WILLOW]:  { hex: 0x6dc254, flowMatId: 1, matKind: 2, bounce: [0.38, 0.84, 0.26] },
  [VoxMat.GLOW_WARM]:    { hex: 0xffdf94, flowMatId: 0, matKind: 3, bounce: [1.0, 0.78, 0.36] },
  [VoxMat.GLOW_LANTERN]: { hex: 0xff6138, flowMatId: 0, matKind: 3, bounce: [1.05, 0.38, 0.16] },
  [VoxMat.WATER]:        { hex: 0x2f97b8, flowMatId: 0, matKind: 0, bounce: [0.16, 0.62, 0.88] },
  [VoxMat.FOAM]:         { hex: 0xeaf9ff, flowMatId: 7, matKind: 0, bounce: [0.82, 0.92, 0.98] },
  [VoxMat.BANNER_RED]:   { hex: 0xb82e24, flowMatId: 7, matKind: 0, bounce: [0.82, 0.22, 0.16] },
  [VoxMat.BANNER_GOLD]:  { hex: 0xe8b948, flowMatId: 7, matKind: 0, bounce: [0.92, 0.74, 0.26] },
  [VoxMat.CARPET_RED]:   { hex: 0xa62620, flowMatId: 4, matKind: 0, bounce: [0.76, 0.18, 0.14] },
  [VoxMat.ROCK]:         { hex: 0x747c84, flowMatId: 5, matKind: 0, bounce: [0.18, 0.20, 0.23] },
  [VoxMat.GRANITE]:      { hex: 0x9aa2aa, flowMatId: 5, matKind: 0, bounce: [0.24, 0.26, 0.29] },
  [VoxMat.CLAY_TILE]:    { hex: 0x8d4a3a, flowMatId: 4, matKind: 1, bounce: [0.74, 0.32, 0.22] },
  [VoxMat.BANNER_BLUE]:  { hex: 0x2b5c8c, flowMatId: 7, matKind: 0, bounce: [0.22, 0.44, 0.72] },
  [VoxMat.FLOWER_GOLD]:  { hex: 0xf4cc44, flowMatId: 7, matKind: 2, bounce: [0.92, 0.76, 0.20] },
  [VoxMat.FLOWER_PINK]:  { hex: 0xf28db2, flowMatId: 7, matKind: 2, bounce: [0.92, 0.48, 0.64] },
};

// Precomputed linear RGB lookup table for fast meshing (zero per-vertex THREE.Color allocations)
export const MAT_LINEAR_RGB: Float32Array = (() => {
  const arr = new Float32Array(40 * 3);
  const c = new THREE.Color();
  for (let m = 0; m < 40; m++) {
    const spec = VOX_MAT_SPECS[m as VoxMat];
    if (spec) {
      c.setHex(spec.hex);
      arr[m * 3] = c.r;
      arr[m * 3 + 1] = c.g;
      arr[m * 3 + 2] = c.b;
    }
  }
  return arr;
})();

export function isLeafMat(m: number): boolean {
  return (
    m === VoxMat.LEAF_SPRING ||
    m === VoxMat.LEAF_PINE ||
    m === VoxMat.LEAF_AUTUMN ||
    m === VoxMat.LEAF_SAKURA ||
    m === VoxMat.LEAF_WILLOW
  );
}

export function isGlowMat(m: number): boolean {
  return m === VoxMat.GLOW_WARM || m === VoxMat.GLOW_LANTERN;
}

export function isSolidVoxel(m: number): boolean {
  return m !== VoxMat.EMPTY && m !== VoxMat.WATER;
}
