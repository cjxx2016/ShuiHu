import * as THREE from 'three';
import { VoxMat } from '../voxel/materials';
import { VoxelGrid } from '../voxel/VoxelGrid';
import { bakeSeedWorldMesh } from '../voxel/SeedWorldMesher';
import {
  SeedWorldUniforms,
  createSeedWorldVoxelMaterial,
  createSeedWorldWaterMaterial,
} from '../voxel/SeedWorldShaders';

export interface SceneBuildResult {
  group: THREE.Group;
  bleedTextures: THREE.Data3DTexture[];
  guardianGroup?: THREE.Group;
  willowGroup?: THREE.Group;
}

/** Helper to turn a populated VoxelGrid into a SeedWorld-shaded THREE.Group */
function finalizeGridToGroup(
  grid: VoxelGrid,
  sharedUniforms: SeedWorldUniforms,
  buildBleedVolume = true
): { group: THREE.Group; bleedTex: THREE.Data3DTexture | null } {
  const baked = bakeSeedWorldMesh(grid, { buildBleedVolume });
  const group = new THREE.Group();

  if (baked.geometry) {
    const mat = createSeedWorldVoxelMaterial(
      sharedUniforms,
      baked.bleedTex ?? undefined,
      baked.volMin,
      baked.volSize
    );
    const mesh = new THREE.Mesh(baked.geometry, mat);
    group.add(mesh);
  }
  if (baked.waterGeometry) {
    const wMat = createSeedWorldWaterMaterial(sharedUniforms);
    const wMesh = new THREE.Mesh(baked.waterGeometry, wMat);
    wMesh.renderOrder = 2;
    group.add(wMesh);
  }
  return { group, bleedTex: baked.bleedTex };
}

/**
 * ============================================================================
 * 1. WEIZHOU TOWN (渭州府 · 状元桥坊) — 112 × 48 × 112 Dense 1-Voxel Architecture
 * ============================================================================
 * - Winding Wei Canal (water y=4, carved stone quays y=6, docked Song boats, weeping willows)
 * - Sculpted High-Arched Vermilion 状元虹桥 (Zhuangyuan Rainbow Bridge) with lanterns & finials
 * - Towering 3-story 潘家酒楼 (Pan's Grand Tavern) with balconies, dougong, wine flags & glowing shoji
 * - Detailed 镇关西肉铺 (Butcher Zheng's Meat Stall) with timber canopy, chopping block & hanging pork
 * - Flanking 2-story Song timber-frame shops, street market stalls, ceremonial Paifang & South City Gate
 */
export function buildWeizhouTown(sharedUniforms: SeedWorldUniforms): SceneBuildResult {
  const grid = new VoxelGrid(114, 48, 114, -57, 0, -57, 1.0);
  const GROUND = 5; // top walkable surface at y=6.0
  const WATER_TOP = 3; // water surface at y=3.84

  // 1. Stone courtyard pavement, canal trench & quays
  for (let wz = -56; wz <= 56; wz++) {
    for (let wx = -56; wx <= 56; wx++) {
      if (Math.abs(wz) <= 6) {
        // Canal bed + turquoise water
        const bed = Math.abs(wz) >= 5 ? 1 : 0;
        for (let y = 0; y <= bed; y++) grid.setW(wx, y, wz, VoxMat.SAND);
        for (let y = bed + 1; y <= WATER_TOP; y++) grid.setW(wx, y, wz, VoxMat.WATER);
      } else {
        const isQuayEdge = Math.abs(wz) === 7;
        const isMainRoad = Math.abs(wx) <= 7 || (Math.abs(wz + 22) <= 4 && Math.abs(wx) <= 34);
        const isPerimeterGrass = Math.abs(wx) >= 48 || Math.abs(wz) >= 49;
        for (let y = 0; y < GROUND; y++) grid.setW(wx, y, wz, VoxMat.STONE);
        let topMat = VoxMat.ROAD;
        if (isQuayEdge) topMat = VoxMat.SLATE;
        else if (isPerimeterGrass) topMat = VoxMat.GRASS;
        else if (isMainRoad) topMat = (wx + wz) % 2 === 0 ? VoxMat.STONE : VoxMat.ROAD;
        else topMat = (wx + wz) % 3 === 0 ? VoxMat.ROAD : VoxMat.STONE;
        grid.setW(wx, GROUND, wz, topMat);
      }
    }
  }

  // Carved stone quay balustrades along canal banks (leaving bridge opening at x in [-6..6])
  for (let wx = -52; wx <= 52; wx++) {
    if (Math.abs(wx) <= 6) continue;
    for (const qz of [-7, 7]) {
      grid.setW(wx, GROUND + 1, qz, wx % 4 === 0 ? VoxMat.STONE : VoxMat.SLATE);
      if (wx % 8 === 0) {
        grid.setW(wx, GROUND + 2, qz, VoxMat.STONE);
        grid.setW(wx, GROUND + 3, qz, VoxMat.GOLD);
      }
    }
  }

  // 2. Sculpted Zhuangyuan Rainbow Bridge (状元虹桥) spanning z = -7..7
  grid.buildArchedBridgeZ(0, -7, 7, 5, GROUND, 3.2, 'vermilion');

  // Docked Canal Boats floating on Wei Canal
  grid.buildCanalBoat(-22, WATER_TOP, 0, 'x');
  grid.buildCanalBoat(24, WATER_TOP, 1, 'x');

  // 3. Towering 3-Story Pan's Grand Tavern (潘家酒楼) on North-West (-26, -26)
  grid.buildSongBuilding(-26, GROUND, -26, 10, 9, 3, VoxMat.JADE_TILE, 'vermilion', 'east');
  // Grand wine pennants & red silk lanterns framing tavern entrance
  grid.buildBannerPole(-14, GROUND + 1, -17, 11, VoxMat.BANNER_RED);
  grid.buildBannerPole(-14, GROUND + 1, -27, 11, VoxMat.BANNER_GOLD);
  grid.buildLanternPost(-13, GROUND + 1, -19, 6, 'street');
  grid.buildLanternPost(-13, GROUND + 1, -25, 6, 'street');

  // 4. Butcher Zheng's Meat Stall (镇关西郑屠肉铺) on North-East (24, -20)
  grid.buildSongBuilding(24, GROUND, -21, 7, 5, 2, VoxMat.CLAY_TILE, 'plaster', 'west');
  // Open street-side butcher awning, chopping block & hanging meat cuts at x=16..18
  grid.fillBoxW(15, GROUND + 1, -24, 17, GROUND + 2, -17, VoxMat.TIMBER);
  grid.fillBoxW(15, GROUND + 3, -22, 16, GROUND + 3, -20, VoxMat.BANNER_RED); // meat cuts
  grid.setW(15, GROUND + 3, -18, VoxMat.PLASTER); // cleaver gleam
  for (const bz of [-24, -17]) {
    grid.fillBoxW(15, GROUND + 1, bz, 15, GROUND + 6, bz, VoxMat.TRUNK);
  }
  for (let oz = -25; oz <= -16; oz++) {
    for (let ox = 14; ox <= 17; ox++) {
      grid.setW(ox, GROUND + 6 + (ox > 15 ? 1 : 0), oz, oz % 2 === 0 ? VoxMat.BANNER_BLUE : VoxMat.PLASTER);
    }
  }
  grid.buildBannerPole(14, GROUND + 1, -15, 9, VoxMat.BANNER_BLUE);

  // 5. Flanking 2-Story Song Timber-Frame Shops & Teahouses
  grid.buildSongBuilding(-31, GROUND, 24, 8, 9, 2, VoxMat.CLAY_TILE, 'plaster', 'east');
  grid.buildSongBuilding(31, GROUND, 24, 8, 9, 2, VoxMat.JADE_TILE, 'plaster', 'west');
  grid.buildSongBuilding(0, GROUND, -44, 12, 6, 2, VoxMat.JADE_TILE, 'vermilion', 'south');

  // Bustling Street Market Stalls
  grid.buildMarketStall(-14, GROUND, 17, VoxMat.BANNER_RED, 'east');
  grid.buildMarketStall(14, GROUND, 17, VoxMat.BANNER_GOLD, 'west');
  grid.buildMarketStall(-14, GROUND, 31, VoxMat.BANNER_BLUE, 'east');
  grid.buildMarketStall(14, GROUND, 31, VoxMat.BANNER_RED, 'west');

  // 6. Ceremonial Zhuangyuan Paifang & South City Gate Wall (z = 48..54)
  grid.buildPaifang(0, GROUND, 13, 8, VoxMat.JADE_TILE);
  // South fortified town wall & gatehouse
  grid.fillBoxW(-52, GROUND, 48, -7, GROUND + 9, 54, VoxMat.STONE);
  grid.fillBoxW(7, GROUND, 48, 52, GROUND + 9, 54, VoxMat.STONE);
  grid.fillBoxW(-7, GROUND + 6, 48, 7, GROUND + 9, 54, VoxMat.STONE);
  for (let wx = -52; wx <= 52; wx += 2) {
    grid.setW(wx, GROUND + 10, 48, VoxMat.SLATE);
    grid.setW(wx, GROUND + 10, 54, VoxMat.SLATE);
  }
  grid.buildSongBuilding(0, GROUND + 10, 51, 9, 4, 1, VoxMat.JADE_TILE, 'vermilion', 'north');

  // East & West enclosing garden walls
  grid.fillBoxW(-54, GROUND, -52, -51, GROUND + 6, 48, VoxMat.STONE);
  grid.fillBoxW(51, GROUND, -52, 54, GROUND + 6, 48, VoxMat.STONE);
  grid.fillBoxW(-52, GROUND, -54, 52, GROUND + 6, -51, VoxMat.STONE);

  // 7. Riverside Weeping Willows, SeedWorld Courtyard Trees & Lantern Rows
  grid.buildWeepingWillow(-38, GROUND, -9, 1.0, 11);
  grid.buildWeepingWillow(39, GROUND, -9, 1.0, 23);
  grid.buildWeepingWillow(-38, GROUND, 9, 0.95, 37);
  grid.buildWeepingWillow(39, GROUND, 9, 0.95, 43);
  grid.buildSeedWorldTree(-42, GROUND, -40, 1.05, VoxMat.LEAF_AUTUMN, 51);
  grid.buildSeedWorldTree(42, GROUND, -40, 1.05, VoxMat.LEAF_SPRING, 61);

  for (const lz of [-34, -14, 24, 38]) {
    grid.buildLanternPost(-9, GROUND + 1, lz, 5, 'street');
    grid.buildLanternPost(9, GROUND + 1, lz, 5, 'street');
  }

  const { group, bleedTex } = finalizeGridToGroup(grid, sharedUniforms, true);
  return { group, bleedTextures: bleedTex ? [bleedTex] : [] };
}

/**
 * ============================================================================
 * 2. WUTAI MONASTERY (五台山 · 文殊院) — 114 × 64 × 114 Grand Terraced Sanctuary
 * ============================================================================
 * - Three ascending carved marble terraces (y = 6 -> 10 -> 14) with central dragon steps
 * - Monumental Mountain Gate (山门殿) + dynamic SeedWorld-baked Vajra Guardians (`guardianGroup`)
 * - Soaring 4-Story Qingliang Pagoda (清凉宝塔 — ported directly from google_ai_studio_pagoda.html!)
 * - Two-story Bell Tower (晨钟阁) with hanging bronze bell on the West Courtyard
 * - Grand double-eave Mahavira Hall (大雄宝殿) on the Upper Terrace with glowing golden altar windows
 * - Bronze tripod incense cauldron with glowing embers, gnarled alpine pines & blooming mountain sakura!
 */
export function buildWutaiTemple(sharedUniforms: SeedWorldUniforms): SceneBuildResult {
  const grid = new VoxelGrid(114, 64, 114, -57, 0, -57, 1.0);

  // 1. Three Grand Stone Terraces & Carved Staircases
  for (let wz = -55; wz <= 55; wz++) {
    for (let wx = -55; wx <= 55; wx++) {
      let topY = 5; // lower courtyard top = 6
      if (wz <= -14) {
        topY = 13; // upper hall terrace top = 14
      } else if (wz < -6) {
        if (Math.abs(wx) <= 10) {
          topY = Math.round(9 + ((-6 - wz) / 8) * 4);
        } else {
          topY = wz > -10 ? 9 : 13;
        }
      } else if (wz <= 14) {
        topY = 9; // middle courtyard top = 10
      } else if (wz < 22) {
        if (Math.abs(wx) <= 9) {
          topY = Math.round(5 + ((22 - wz) / 8) * 4);
        } else {
          topY = wz > 18 ? 5 : 9;
        }
      }

      const isCenterAxis = Math.abs(wx) <= 6;
      const isGardenEdge = Math.abs(wx) >= 44 || wz <= -47;
      for (let y = 0; y < topY; y++) {
        grid.setW(wx, y, wz, y % 3 === 0 ? VoxMat.SLATE : VoxMat.STONE);
      }
      let surf = VoxMat.ROAD;
      if (isGardenEdge) surf = VoxMat.MOSS;
      else if (isCenterAxis) surf = (wx + wz) % 2 === 0 ? VoxMat.PLASTER : VoxMat.STONE;
      else surf = (wx + wz) % 4 === 0 ? VoxMat.STONE : VoxMat.ROAD;
      grid.setW(wx, topY, wz, surf);
    }
  }

  // Carved marble terrace balustrades & staircase side rails
  for (let wx = -48; wx <= 48; wx++) {
    if (Math.abs(wx) > 9) {
      grid.setW(wx, 10, 17, VoxMat.PLASTER);
      grid.setW(wx, 11, 17, wx % 3 === 0 ? VoxMat.GOLD : VoxMat.PLASTER);
    }
    if (Math.abs(wx) > 10) {
      grid.setW(wx, 14, -10, VoxMat.PLASTER);
      grid.setW(wx, 15, -10, wx % 3 === 0 ? VoxMat.GOLD : VoxMat.PLASTER);
    }
  }
  for (let wz = 14; wz <= 22; wz++) {
    const sy = Math.round(6 + ((22 - wz) / 8) * 4);
    grid.fillBoxW(-10, sy, wz, -10, sy + 1, wz, VoxMat.PLASTER);
    grid.fillBoxW(10, sy, wz, 10, sy + 1, wz, VoxMat.PLASTER);
  }
  for (let wz = -14; wz <= -6; wz++) {
    const sy = Math.round(10 + ((-6 - wz) / 8) * 4);
    grid.fillBoxW(-11, sy, wz, -11, sy + 1, wz, VoxMat.PLASTER);
    grid.fillBoxW(11, sy, wz, 11, sy + 1, wz, VoxMat.PLASTER);
  }

  // 2. Monumental Mountain Gate Pavilion (山门殿) at z = 32 (wide open 10-voxel passage!)
  const G1 = 5;
  grid.fillBoxW(-18, G1 + 1, 29, -6, G1 + 9, 35, VoxMat.VERMILION);
  grid.fillBoxW(6, G1 + 1, 29, 18, G1 + 9, 35, VoxMat.VERMILION);
  grid.fillBoxW(-6, G1 + 7, 29, 6, G1 + 9, 35, VoxMat.VERMILION);
  // White plaster panels & glowing side lattice windows
  grid.fillBoxW(-16, G1 + 3, 35, -8, G1 + 6, 35, VoxMat.PLASTER);
  grid.fillBoxW(8, G1 + 3, 35, 16, G1 + 6, 35, VoxMat.PLASTER);
  grid.fillBoxW(-13, G1 + 4, 35, -11, G1 + 5, 35, VoxMat.GLOW_WARM);
  grid.fillBoxW(11, G1 + 4, 35, 13, G1 + 5, 35, VoxMat.GLOW_WARM);
  // Golden plaque "五台山文殊院"
  grid.fillBoxW(-4, G1 + 7, 36, 4, G1 + 8, 36, VoxMat.TRUNK);
  grid.fillBoxW(-3, G1 + 7, 36, 3, G1 + 8, 36, VoxMat.GOLD);
  grid.buildDougong(0, G1 + 9, 32, 18, 4);
  grid.buildSongRoof(0, G1 + 10, 32, 22, 8, 6, 3.0, VoxMat.JADE_TILE, VoxMat.SLATE, 0, 0, true);
  // Crimson Monastery Enclosure Walls
  grid.fillBoxW(-50, G1 + 1, 31, -18, G1 + 7, 33, VoxMat.VERMILION);
  grid.fillBoxW(18, G1 + 1, 31, 50, G1 + 7, 33, VoxMat.VERMILION);
  grid.fillBoxW(-50, G1 + 8, 31, -18, G1 + 8, 33, VoxMat.JADE_TILE);
  grid.fillBoxW(18, G1 + 8, 31, 50, G1 + 8, 33, VoxMat.JADE_TILE);
  grid.fillBoxW(-52, G1 + 1, -50, -49, 20, 33, VoxMat.VERMILION);
  grid.fillBoxW(49, G1 + 1, -50, 52, 20, 33, VoxMat.VERMILION);
  grid.fillBoxW(-52, 14, -52, 52, 21, -49, VoxMat.VERMILION);

  // 3. GRAND 4-STORY QINGLIANG PAGODA (清凉宝塔) on East Middle Courtyard (32, 10, 2)
  grid.buildGrandPagoda(32, 9, 2, 4);

  // 4. TWO-STORY BELL TOWER (晨钟阁) on West Middle Courtyard (-29, 10, 7)
  grid.buildSongBuilding(-29, 9, 7, 6, 6, 2, VoxMat.JADE_TILE, 'vermilion', 'east');
  // Hanging bronze bell visible in lower arch
  grid.fillBoxW(-23, 12, 6, -22, 14, 8, VoxMat.BRONZE);
  grid.setW(-22, 11, 7, VoxMat.GOLD);

  // 5. Bronze Tripod Incense Cauldron (青铜香炉) in Center Courtyard (0, 10, 5)
  grid.fillBoxW(-2, 10, 3, 2, 11, 7, VoxMat.STONE);
  grid.fillBoxW(-2, 12, 4, 2, 14, 6, VoxMat.BRONZE);
  grid.fillBoxW(-1, 15, 4, 1, 15, 6, VoxMat.GLOW_LANTERN); // glowing incense embers!

  // 6. MONUMENTAL DOUBLE-EAVE MAHAVIRA HALL (大雄宝殿) on Upper Terrace (0, 14, -33)
  const UY = 13;
  // Grand carved white marble terrace plinth
  grid.fillBoxW(-22, UY, -44, 22, UY + 2, -22, VoxMat.PLASTER);
  grid.fillBoxW(-21, UY + 2, -43, 21, UY + 2, -23, VoxMat.ROAD);
  // Central entrance steps
  for (let s = 0; s < 3; s++) {
    grid.fillBoxW(-5, UY, -21 + s, 5, UY + 2 - s, -21 + s, VoxMat.PLASTER);
  }
  // Colonnade hall (2-story majestic double-eave temple roof)
  grid.buildSongBuilding(0, UY + 2, -33, 18, 9, 2, VoxMat.JADE_TILE, 'vermilion', 'south');
  // Golden temple plaque over entrance
  grid.fillBoxW(-4, UY + 8, -23, 4, UY + 9, -23, VoxMat.GOLD);
  // Hanging temple palace lanterns
  for (const lx of [-14, -8, 8, 14]) {
    grid.setW(lx, UY + 7, -23, VoxMat.GLOW_LANTERN);
  }

  // 7. Ancient Gnarled Alpine Pines, Blooming Mountain Cherry Blossoms & Stone Lanterns
  grid.buildAlpinePine(-34, 14, -30, 1.35, 19);
  grid.buildAlpinePine(34, 14, -30, 1.35, 29);
  grid.buildSeedWorldTree(-36, 10, -14, 1.0, VoxMat.LEAF_SAKURA, 47);
  grid.buildSeedWorldTree(36, 10, -18, 1.0, VoxMat.LEAF_SAKURA, 53);
  grid.buildSeedWorldTree(-32, 6, 42, 0.95, VoxMat.LEAF_AUTUMN, 67);
  grid.buildSeedWorldTree(32, 6, 42, 0.95, VoxMat.LEAF_SPRING, 71);

  for (const lz of [25, 10, -2, -16]) {
    const ly = lz >= 22 ? 6 : lz >= -6 ? 10 : 14;
    grid.buildLanternPost(-11, ly, lz, 4, 'stone');
    grid.buildLanternPost(11, ly, lz, 4, 'stone');
  }

  // 8. Dynamic Vajra Guardian Statues (山门金刚塑像) baked in a dedicated mini-grid so Lu Zhishen can shake them!
  const gGrid = new VoxelGrid(22, 16, 12, -11, 0, -6, 0.5);
  for (const gx of [-8, 8]) {
    // Carved stone lotus pedestal
    gGrid.fillBoxW(gx - 2, 0, -2, gx + 2, 2, 2, VoxMat.STONE);
    // Golden armored guardian torso & legs
    gGrid.fillBoxW(gx - 2, 3, -1, gx + 2, 9, 1, VoxMat.GOLD);
    gGrid.fillBoxW(gx - 2, 5, -2, gx + 2, 7, 2, VoxMat.VERMILION); // battle sash
    // Raised Vajra fist & gilded head crown
    gGrid.fillBoxW(gx - 3, 7, 0, gx - 3, 11, 1, VoxMat.GOLD);
    gGrid.fillBoxW(gx + 3, 8, -1, gx + 3, 12, 0, VoxMat.BRONZE); // Vajra staff
    gGrid.fillBoxW(gx - 1, 10, -1, gx + 1, 12, 1, VoxMat.GOLD);
    gGrid.setW(gx, 13, 0, VoxMat.GLOW_WARM);
  }

  const main = finalizeGridToGroup(grid, sharedUniforms, true);
  const guardian = finalizeGridToGroup(gGrid, sharedUniforms, false);
  guardian.group.position.set(0, 6.0, 32.0);

  const bleedTextures: THREE.Data3DTexture[] = [];
  if (main.bleedTex) bleedTextures.push(main.bleedTex);

  return {
    group: main.group,
    bleedTextures,
    guardianGroup: guardian.group,
  };
}

/**
 * ============================================================================
 * 3. BIANLIANG CAPITAL CITY (东京汴梁城) — 156 × 56 × 156 MONUMENTAL SONG METROPOLIS
 * ============================================================================
 * Surpasses all reference density with true 1-voxel Song Dynasty urban grandeur:
 * - MONUMENTAL 宣德门 (XuanDe Gatehouse Fortress) at z = 21..31:
 *     * 152-voxel-wide battered gray-stone city walls (height 14v) with merlons & arrow slits
 *     * Triple arched gate tunnels (central grand imperial arch x=-6..6 + twin side pedestrian arches)
 *     * Studded vermilion gate doors swung wide open
 *     * Soaring 40-voxel-high TWO-STORY IMPERIAL GATE PAVILION (重檐歇山顶城楼) with vermilion colonnade,
 *       white marble terrace balustrade, 3-tier dougong, golden plaque, sweeping double jade roofs & chiwen!
 *     * Twin Corner Watchtowers (角楼) at x = ±58 with double upturned roofs & crimson banners
 * - Outer Moat (护城河 z = 42..54) with carved stone embankments, docked Song barges & weeping willows
 * - Grand Arched Imperial Stone Bridge (州桥) spanning the moat into XuanDe Gate
 * - Bustling 十里御街 (Imperial Avenue):
 *     * Towering 3-Story 樊楼 (Fanlou Grand Tavern) on west (-32, -4)
 *     * Ceremonial Imperial Avenue Paifang at (0, 6)
 *     * 6 rich 2-story Song timber shops, colorful striped market stalls, wine banners & glowing palace lanterns
 * - North 大相国寺 (Daxiangguo Temple) & 菜园 (Vegetable Garden) with dynamic SeedWorld-baked Weeping Willow!
 */
export function buildBianliangCity(sharedUniforms: SeedWorldUniforms): SceneBuildResult {
  const grid = new VoxelGrid(156, 56, 156, -78, 0, -78, 1.0);
  const GROUND = 5; // top walkable surface at y=6.0
  const WATER_TOP = 3; // moat water surface at y=3.84

  // 1. Imperial Avenue stone paving, Outer Moat trench, Garden soil beds & outer green banks
  for (let wz = -76; wz <= 76; wz++) {
    for (let wx = -76; wx <= 76; wx++) {
      if (wz >= 42 && wz <= 54) {
        // Outer Moat (护城河)
        const bank = wz === 42 || wz === 54;
        const bed = bank ? 1 : 0;
        for (let y = 0; y <= bed; y++) grid.setW(wx, y, wz, VoxMat.SAND);
        for (let y = bed + 1; y <= WATER_TOP; y++) grid.setW(wx, y, wz, VoxMat.WATER);
      } else {
        for (let y = 0; y < GROUND; y++) grid.setW(wx, y, wz, VoxMat.STONE);
        const isImperialAxis = Math.abs(wx) <= 9 && wz >= -34 && wz <= 74;
        const isNorthGarden = wz <= -34 && wx >= 4 && wx <= 52;
        const isOuterPark = wz >= 55 && Math.abs(wx) >= 14;
        const isMoatQuay = wz === 41 || wz === 55;

        let topMat = VoxMat.ROAD;
        if (isMoatQuay) topMat = VoxMat.SLATE;
        else if (isOuterPark) topMat = VoxMat.GRASS;
        else if (isNorthGarden) {
          // Cultivated Daxiangguo vegetable garden furrows!
          const inBed = wx >= 10 && wx <= 44 && wz >= -62 && wz <= -38 && Math.hypot(wx - 20, wz + 48) > 5;
          if (inBed && Math.abs(wx) % 4 !== 0 && Math.abs(wz) % 4 !== 0) {
            topMat = (wx + wz) % 2 === 0 ? VoxMat.DIRT : VoxMat.MOSS;
          } else {
            topMat = VoxMat.GRASS;
          }
        } else if (isImperialAxis) {
          topMat = Math.abs(wx) <= 2 ? VoxMat.PLASTER : (wx + wz) % 2 === 0 ? VoxMat.STONE : VoxMat.ROAD;
        } else {
          topMat = (wx + wz) % 3 === 0 ? VoxMat.STONE : VoxMat.ROAD;
        }
        grid.setW(wx, GROUND, wz, topMat);
      }
    }
  }

  // Moat stone railings along both banks (leaving opening for Zhou Bridge at x in [-7..7])
  for (let wx = -74; wx <= 74; wx++) {
    if (Math.abs(wx) <= 7) continue;
    for (const qz of [41, 55]) {
      grid.setW(wx, GROUND + 1, qz, VoxMat.STONE);
      if (wx % 6 === 0) {
        grid.setW(wx, GROUND + 2, qz, VoxMat.PLASTER);
        grid.setW(wx, GROUND + 3, qz, VoxMat.GOLD);
      }
    }
  }

  // 2. GRAND IMPERIAL STONE BRIDGE (州桥) spanning z = 41..55
  grid.buildArchedBridgeZ(0, 41, 55, 6, GROUND, 2.8, 'stone');

  // Docked Song Canal Barges on the Outer Moat
  grid.buildCanalBoat(-28, WATER_TOP, 48, 'x');
  grid.buildCanalBoat(26, WATER_TOP, 48, 'x');
  grid.buildCanalBoat(-54, WATER_TOP, 48, 'x');
  grid.buildCanalBoat(52, WATER_TOP, 48, 'x');

  // 3. =========================================================================
  // MONUMENTAL XUANDE GATEHOUSE FORTRESS (东京宣德门重檐城楼, z = 20..32)
  // =========================================================================
  const WALL_H = 14; // Top of city wall platform at y = 20
  const WALL_TOP = GROUND + WALL_H; // 19 -> top surface 20

  // 3A. Battered Solid Stone City Wall with Triple Arched Gate Tunnels!
  for (let y = GROUND + 1; y <= WALL_TOP; y++) {
    const rel = y - GROUND;
    // Authentic Song battered wall slope (slightly wider at base, tapering gracefully upward)
    const batter = rel <= 4 ? 1 : 0;
    const zMin = 21 - batter;
    const zMax = 31 + batter;
    const isBand = rel === 1 || rel === 7 || rel === WALL_H;

    for (let wz = zMin; wz <= zMax; wz++) {
      for (let wx = -75; wx <= 75; wx++) {
        const ax = Math.abs(wx);
        // Central Grand Imperial Gate Arch (x in [-6..6], parabolic arch height 10v)
        const inCenterArch =
          ax <= 6 && rel <= Math.round(9.8 - (ax * ax) / 14.0);
        // Twin Side Pedestrian Arches (x in [13..17] and [-17..-13], arch height 7v)
        const dSide = Math.abs(ax - 15);
        const inSideArch =
          dSide <= 2 && rel <= Math.round(7.2 - (dSide * dSide) / 2.2);

        if (inCenterArch || inSideArch) continue;

        // Subtle ashlar masonry bands & crimson gate-frame trim
        const isCentralPillar = ax <= 24 && (wz === zMin || wz === zMax);
        let mat = isBand ? VoxMat.SLATE : VoxMat.STONE;
        if (isCentralPillar && rel >= 11) mat = VoxMat.VERMILION;
        if (ax === 7 && rel <= 9 && (wz === zMin || wz === zMax)) mat = VoxMat.SLATE;
        grid.setW(wx, y, wz, mat);
      }
    }
  }

  // Wide-open Studded Vermilion Imperial Gate Doors inside the main arch
  for (const sx of [-6, 6]) {
    grid.fillBoxW(sx, GROUND + 1, 27, sx, GROUND + 8, 30, VoxMat.VERMILION);
    for (let gy = GROUND + 2; gy <= GROUND + 7; gy += 2) {
      grid.setW(sx, gy, 28, VoxMat.GOLD);
      grid.setW(sx, gy, 29, VoxMat.GOLD);
    }
  }

  // Crenellated Battlements (垛口女墙) along the entire 150-voxel city wall
  for (let wx = -75; wx <= 75; wx++) {
    const isMerlon = Math.abs(wx) % 3 !== 0;
    grid.setW(wx, WALL_TOP + 1, 31, VoxMat.STONE);
    grid.setW(wx, WALL_TOP + 1, 21, VoxMat.STONE);
    if (isMerlon && Math.abs(wx) > 22) {
      grid.setW(wx, WALL_TOP + 2, 31, VoxMat.SLATE);
      grid.setW(wx, WALL_TOP + 2, 21, VoxMat.SLATE);
    }
  }

  // White Marble Ceremonial Balustrade ringing the central Gatehouse Terrace (x = -24..24)
  for (let wx = -24; wx <= 24; wx++) {
    for (const tz of [20, 32]) {
      grid.setW(wx, WALL_TOP + 1, tz, VoxMat.PLASTER);
      if (wx % 4 === 0) grid.setW(wx, WALL_TOP + 2, tz, VoxMat.GOLD);
    }
  }

  // 3B. SOARING TWO-STORY IMPERIAL GATE PAVILION (重檐歇山顶宣德城楼, rising to y=46!)
  // Story 1: Grand Vermilion Colonnade + Glowing Shoji Windows (y = 20..27)
  const pRx = 20;
  const pRz = 5;
  for (let y = WALL_TOP + 1; y <= WALL_TOP + 8; y++) {
    const rel = y - WALL_TOP;
    for (let dz = -pRz; dz <= pRz; dz++) {
      for (let dx = -pRx; dx <= pRx; dx++) {
        const ax = Math.abs(dx);
        const az = Math.abs(dz);
        if (ax !== pRx && az !== pRz) continue;
        const isPillar = ax === pRx || ax % 4 === 0;
        if (rel === 1 || rel >= 7) {
          grid.setW(dx, y, 26 + dz, VoxMat.VERMILION);
        } else if (isPillar) {
          grid.setW(dx, y, 26 + dz, VoxMat.VERMILION);
        } else if (rel >= 3 && rel <= 5) {
          grid.setW(dx, y, 26 + dz, VoxMat.GLOW_WARM);
        } else {
          grid.setW(dx, y, 26 + dz, VoxMat.PLASTER);
        }
      }
    }
  }
  // Golden Imperial Plaque "宣德门" hanging proudly on south facade
  grid.fillBoxW(-5, WALL_TOP + 5, 32, 5, WALL_TOP + 7, 32, VoxMat.TRUNK);
  grid.fillBoxW(-4, WALL_TOP + 5, 32, 4, WALL_TOP + 7, 32, VoxMat.GOLD);
  // Lower Dougong & Sweeping First Skirt Eave Roof
  grid.buildDougong(0, WALL_TOP + 8, 26, pRx, pRz);
  grid.buildSongRoof(0, WALL_TOP + 9, 26, pRx + 5, pRz + 4, 4, 2.8, VoxMat.JADE_TILE, VoxMat.SLATE, pRx - 3, pRz - 1, true);

  // Story 2: Upper Imperial Pavilion + Sweeping Crown Roof (y = 32..46!)
  const uRx = 16;
  const uRz = 4;
  const uBase = WALL_TOP + 12;
  for (let y = uBase; y <= uBase + 6; y++) {
    const rel = y - uBase;
    for (let dz = -uRz; dz <= uRz; dz++) {
      for (let dx = -uRx; dx <= uRx; dx++) {
        const ax = Math.abs(dx);
        const az = Math.abs(dz);
        if (ax !== uRx && az !== uRz) continue;
        if (rel === 0 || rel === 6 || ax % 4 === 0) {
          grid.setW(dx, y, 26 + dz, VoxMat.VERMILION);
        } else if (rel >= 2 && rel <= 4) {
          grid.setW(dx, y, 26 + dz, VoxMat.GLOW_WARM);
        } else {
          grid.setW(dx, y, 26 + dz, VoxMat.PLASTER);
        }
      }
    }
  }
  grid.buildDougong(0, uBase + 6, 26, uRx, uRz);
  grid.buildSongRoof(0, uBase + 7, 26, uRx + 6, uRz + 5, 7, 3.6, VoxMat.JADE_TILE, VoxMat.GOLD, 0, 0, true);

  // Hanging Palace Lanterns across the entire XuanDe Gatehouse facade
  for (const lx of [-18, -12, -6, 6, 12, 18]) {
    grid.setW(lx, WALL_TOP + 7, 33, VoxMat.GLOW_LANTERN);
    grid.setW(lx, WALL_TOP + 2, 33, VoxMat.GLOW_LANTERN);
  }

  // 3C. TWIN CORNER WATCHTOWERS (角楼) at x = ±58, z = 26
  for (const wx of [-58, 58]) {
    grid.fillBoxW(wx - 9, GROUND + 1, 18, wx + 9, WALL_TOP, 34, VoxMat.STONE);
    grid.buildSongBuilding(wx, WALL_TOP, 26, 7, 6, 2, VoxMat.JADE_TILE, 'vermilion', 'south');
    grid.buildBannerPole(wx - 8, WALL_TOP + 1, 33, 8, VoxMat.BANNER_RED);
    grid.buildBannerPole(wx + 8, WALL_TOP + 1, 33, 8, VoxMat.BANNER_GOLD);
  }

  // Imperial War Banners & Guard Braziers flanking gate entrance
  for (const bx of [-10, 10]) {
    grid.buildLanternPost(bx, GROUND + 1, 35, 6, 'street');
    grid.buildBannerPole(bx * 1.4, WALL_TOP + 1, 32, 9, VoxMat.BANNER_RED);
  }

  // 4. BUSTLING IMPERIAL AVENUE (十里御街, z = -22..16)
  // Ceremonial Imperial Paifang inside the gate
  grid.buildPaifang(0, GROUND, 11, 9, VoxMat.JADE_TILE);

  // Towering 3-Story Fanlou Grand Tavern (樊楼) on West (-32, -4)
  grid.buildSongBuilding(-32, GROUND, -4, 12, 11, 3, VoxMat.JADE_TILE, 'vermilion', 'east');
  grid.buildBannerPole(-17, GROUND + 1, 3, 12, VoxMat.BANNER_RED);
  grid.buildBannerPole(-17, GROUND + 1, -11, 12, VoxMat.BANNER_GOLD);

  // Rich 2-Story Song Timber-Frame Shops lining both sides of Imperial Street
  grid.buildSongBuilding(32, GROUND, -6, 11, 9, 2, VoxMat.CLAY_TILE, 'plaster', 'west');
  grid.buildSongBuilding(32, GROUND, 9, 10, 7, 2, VoxMat.JADE_TILE, 'plaster', 'west');
  grid.buildSongBuilding(-32, GROUND, -24, 10, 7, 2, VoxMat.CLAY_TILE, 'plaster', 'east');
  grid.buildSongBuilding(32, GROUND, -24, 10, 7, 2, VoxMat.JADE_TILE, 'plaster', 'west');

  // Vibrant Market Stalls with striped awnings along the Imperial Street sidewalks
  grid.buildMarketStall(-14, GROUND, 6, VoxMat.BANNER_RED, 'east');
  grid.buildMarketStall(14, GROUND, 6, VoxMat.BANNER_GOLD, 'west');
  grid.buildMarketStall(14, GROUND, -8, VoxMat.BANNER_BLUE, 'west');
  grid.buildMarketStall(-14, GROUND, -16, VoxMat.BANNER_GOLD, 'east');
  grid.buildMarketStall(14, GROUND, -20, VoxMat.BANNER_RED, 'west');
  // Outer city stalls by the moat
  grid.buildMarketStall(-18, GROUND, 61, VoxMat.BANNER_BLUE, 'south');
  grid.buildMarketStall(18, GROUND, 61, VoxMat.BANNER_RED, 'south');

  // Glowing Imperial Street Lanterns
  for (const lz of [-28, -14, 0, 14, 60]) {
    grid.buildLanternPost(-10, GROUND + 1, lz, 5, 'street');
    grid.buildLanternPost(10, GROUND + 1, lz, 5, 'street');
  }

  // 5. NORTH DAXIANGGUO TEMPLE (大相国寺) & VEGETABLE GARDEN (菜园)
  // Grand Temple Hall on North-West (-34, -52)
  grid.buildSongBuilding(-34, GROUND, -52, 11, 9, 2, VoxMat.JADE_TILE, 'vermilion', 'east');
  grid.buildLanternPost(-21, GROUND + 1, -46, 5, 'stone');
  grid.buildLanternPost(-21, GROUND + 1, -54, 5, 'stone');
  // Garden Pavilion & Stone Well in the vegetable garden
  grid.buildPavilion(42, GROUND, -52, 4, VoxMat.CLAY_TILE);
  // Stone well at (12, -52)
  grid.fillBoxW(11, GROUND + 1, -53, 13, GROUND + 2, -51, VoxMat.STONE);
  grid.setW(12, GROUND + 2, -52, VoxMat.WATER);
  // Low garden fence & vegetable sprouts
  for (let wx = 6; wx <= 48; wx += 4) {
    for (let wz = -60; wz <= -40; wz += 4) {
      if (Math.hypot(wx - 20, wz + 48) < 7 || Math.hypot(wx - 42, wz + 52) < 8) continue;
      grid.setW(wx, GROUND + 1, wz, VoxMat.LEAF_SPRING);
    }
  }
  // North city enclosure wall
  grid.fillBoxW(-74, GROUND, -74, 74, GROUND + 8, -71, VoxMat.STONE);
  grid.fillBoxW(-74, GROUND, -74, -71, GROUND + 8, 22, VoxMat.STONE);
  grid.fillBoxW(71, GROUND, -74, 74, GROUND + 8, 22, VoxMat.STONE);

  // Lush urban trees framing the moat, outer banks, temple & avenues
  grid.buildWeepingWillow(-32, GROUND, 58, 1.05, 13);
  grid.buildWeepingWillow(32, GROUND, 58, 1.05, 27);
  grid.buildWeepingWillow(-52, GROUND, 39, 1.0, 39);
  grid.buildWeepingWillow(52, GROUND, 39, 1.0, 53);
  grid.buildSeedWorldTree(-56, GROUND, -50, 1.1, VoxMat.LEAF_AUTUMN, 63);
  grid.buildSeedWorldTree(56, GROUND, -42, 1.1, VoxMat.LEAF_SPRING, 79);
  grid.buildSeedWorldTree(-54, GROUND, 64, 1.0, VoxMat.LEAF_SPRING, 89);
  grid.buildSeedWorldTree(54, GROUND, 64, 1.0, VoxMat.LEAF_AUTUMN, 97);

  // 6. Dynamic Iconic Centennial Weeping Willow (大相国寺垂杨柳) baked in its own mini-grid so Lu Zhishen can uproot it!
  const wGrid = new VoxelGrid(22, 22, 22, -11, 0, -11, 1.0);
  wGrid.buildWeepingWillow(0, 0, 0, 1.18, 108);

  const main = finalizeGridToGroup(grid, sharedUniforms, true);
  const willow = finalizeGridToGroup(wGrid, sharedUniforms, false);
  willow.group.position.set(20, 6.0, -48);

  const bleedTextures: THREE.Data3DTexture[] = [];
  if (main.bleedTex) bleedTextures.push(main.bleedTex);

  return {
    group: main.group,
    bleedTextures,
    willowGroup: willow.group,
  };
}
