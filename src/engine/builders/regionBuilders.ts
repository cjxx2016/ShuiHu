import * as THREE from 'three';
import {
  ridgedNoise,
  smoothNoise,
  weizhouGroundHeight,
  weizhouRiverDepth,
  weizhouRiverZ,
  weizhouRoadMask,
  weizhouRoadX,
  wutaiGroundHeight,
  wutaiRoadMask,
  wutaiRoadX,
  wutaiStreamZ,
} from '../../game/terrainMath';
import { VoxMat } from '../voxel/materials';
import { VoxelGrid } from '../voxel/VoxelGrid';
import type { ChunkPopulateFn } from '../voxel/ChunkStreamer';
import type { SeedWorldUniforms } from '../voxel/SeedWorldShaders';

function hash2i(x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 1. WEIZHOU REGION POPULATOR (渭州郊野 · 官道)
 * Chunk-streamed 288×288 open valley:
 * - Winding turquoise Wei River with sandy banks & caustic shallows (water surface ≈ 5.84)
 * - Paved imperial stone road crossing a sculpted Vermilion Arched Bridge
 * - Wayside Ten-Li Pavilion (十里长亭), Song countryside farmstead, & North Frontier Gatehouse
 * - Majestic Guanxi stratified granite ridges rising 45–62 voxels around the valley
 * - Deterministic SeedWorld giant radial-bough trees, riverside weeping willows, alpine pines & wildflower tufts
 */
export function createWeizhouRegionPopulator(): ChunkPopulateFn {
  const WATER_TOP = 5; // top surface at y=5.84

  return (grid: VoxelGrid) => {
    const x0 = grid.originX;
    const x1 = grid.originX + grid.sx - 1;
    const z0 = grid.originZ;
    const z1 = grid.originZ + grid.sz - 1;

    // 1. Column-by-column geological terrain & river sculpting
    for (let wz = z0; wz <= z1; wz++) {
      for (let wx = x0; wx <= x1; wx++) {
        const hFloat = weizhouGroundHeight(wx, wz);
        const road = weizhouRoadMask(wx, wz);
        const river = weizhouRiverDepth(wx, wz);
        const riverDist = Math.abs(wz - weizhouRiverZ(wx));
        const roadDist = Math.abs(wx - weizhouRoadX(wz));
        const onBridge = roadDist < 4.8 && riverDist < 11.8;

        // Under bridge, carve riverbed so turquoise water flows cleanly beneath the arch
        let topSolid = Math.round(hFloat) - 1;
        if (onBridge) {
          topSolid = Math.max(1, Math.min(4, Math.round(5.0 - (1 - riverDist / 11.8) * 3.0)));
        }

        const slope =
          Math.abs(weizhouGroundHeight(wx + 1, wz) - hFloat) +
          Math.abs(weizhouGroundHeight(wx, wz + 1) - hFloat);

        // Fill solid ground column with geological strata
        const yMin = Math.max(0, topSolid - 8);
        if (topSolid > 0) {
          // Seal column down to y=0 for cliffs so no hollow holes show
          for (let y = 0; y < yMin; y++) {
            grid.setW(wx, y, wz, VoxMat.ROCK);
          }
        }
        for (let y = yMin; y <= topSolid; y++) {
          let mat = VoxMat.DIRT;
          if (y === topSolid) {
            if (road > 0.45 && !onBridge) {
              mat = (wx + wz) % 3 === 0 ? VoxMat.STONE : VoxMat.ROAD;
            } else if (topSolid <= WATER_TOP + 1 && river > 0.08) {
              mat = VoxMat.SAND;
            } else if (topSolid >= 44 + smoothNoise(wx * 0.08, wz * 0.08) * 4) {
              mat = slope > 2.8 ? VoxMat.GRANITE : VoxMat.SNOW;
            } else if (topSolid >= 26 || slope > 1.85) {
              mat = topSolid >= 32 ? VoxMat.GRANITE : VoxMat.ROCK;
            } else {
              mat = smoothNoise(wx * 0.09, wz * 0.09) > 0.72 ? VoxMat.MOSS : VoxMat.GRASS;
            }
          } else if (y >= topSolid - 2 && topSolid < 24 && slope <= 1.8) {
            mat = topSolid <= WATER_TOP ? VoxMat.SAND : VoxMat.DIRT;
          } else {
            mat = y % 7 === 0 ? VoxMat.GRANITE : VoxMat.ROCK;
          }
          grid.setW(wx, y, wz, mat);
        }

        // Fill Wei River water up to WATER_TOP
        if (topSolid < WATER_TOP) {
          for (let y = topSolid + 1; y <= WATER_TOP; y++) {
            grid.setW(wx, y, wz, VoxMat.WATER);
          }
        }

        // Wildflowers & reed tufts along sunny meadows and riverbanks
        if (!onBridge && road < 0.15 && topSolid >= WATER_TOP + 1 && topSolid <= 16 && slope < 1.1) {
          const rh = hash2i(wx * 3 + 7, wz * 3 - 11);
          if (rh > 0.988) {
            grid.setW(wx, topSolid + 1, wz, rh > 0.994 ? VoxMat.FLOWER_GOLD : VoxMat.FLOWER_PINK);
          } else if (topSolid === WATER_TOP + 1 && river > 0.15 && rh > 0.94) {
            grid.setW(wx, topSolid + 1, wz, VoxMat.LEAF_WILLOW);
            grid.setW(wx, topSolid + 2, wz, VoxMat.LEAF_WILLOW);
          }
        }
      }
    }

    // 2. Hero Landmarks (each checks chunk AABB automatically inside VoxelGrid or fast overlap check)
    const overlaps = (cx: number, cz: number, r: number) =>
      cx + r >= x0 && cx - r <= x1 && cz + r >= z0 && cz - r <= z1;

    // 2A. Arched Vermilion Bridge over Wei River (around x≈3, z≈9..33)
    const bridgeX = Math.round(weizhouRoadX(21));
    const bridgeZ = Math.round(weizhouRiverZ(bridgeX));
    if (overlaps(bridgeX, bridgeZ, 18)) {
      grid.buildArchedBridgeZ(bridgeX, bridgeZ - 11, bridgeZ + 11, 4, 8, 3.0, 'vermilion');
    }

    // 2B. Wayside Ten-Li Pavilion (十里长亭) at (-18, -6) + Hero SeedWorld Shade Tree
    if (overlaps(-18, -6, 18)) {
      grid.buildPavilion(-18, 9, -6, 4, VoxMat.JADE_TILE);
      grid.buildBannerPole(-12, 10, -2, 8, VoxMat.BANNER_BLUE);
      grid.buildLanternPost(-12, 10, -9, 5, 'stone');
      grid.buildSeedWorldTree(-28, 10, -10, 1.18, VoxMat.LEAF_SPRING, 17);
    }

    // 2C. Roadside Song Farmstead & Granary at (24, 34)
    if (overlaps(24, 34, 20)) {
      grid.buildSongBuilding(26, 9, 34, 6, 5, 1, VoxMat.CLAY_TILE, 'plaster', 'west');
      grid.buildLanternPost(17, 10, 31, 5, 'street');
      // Timber fence & wheat stacks
      for (let dz = -7; dz <= 7; dz++) {
        if (Math.abs(dz) > 2) grid.setW(16, 10, 34 + dz, VoxMat.TIMBER);
      }
      grid.fillBoxW(18, 10, 40, 21, 12, 42, VoxMat.BANNER_GOLD);
      grid.buildSeedWorldTree(36, 10, 28, 1.05, VoxMat.LEAF_AUTUMN, 31);
    }

    // 2D. North Weizhou Frontier Gatehouse (渭州城关) at (0, -78)
    if (overlaps(0, -78, 28)) {
      const gy = 9;
      // Battered stone city wall wings
      grid.fillBoxW(-24, gy - 2, -82, -6, gy + 8, -75, VoxMat.STONE);
      grid.fillBoxW(6, gy - 2, -82, 24, gy + 8, -75, VoxMat.STONE);
      // Gatehouse arch header
      grid.fillBoxW(-6, gy + 6, -82, 6, gy + 8, -75, VoxMat.STONE);
      // Crenellations
      for (let x = -24; x <= 24; x += 2) {
        grid.setW(x, gy + 9, -75, VoxMat.SLATE);
        grid.setW(x, gy + 9, -82, VoxMat.SLATE);
      }
      // Open studded vermilion gate doors
      grid.fillBoxW(-5, gy + 1, -76, -5, gy + 5, -74, VoxMat.VERMILION);
      grid.fillBoxW(5, gy + 1, -76, 5, gy + 5, -74, VoxMat.VERMILION);
      // Upper gate pavilion
      grid.buildSongBuilding(0, gy + 9, -78, 8, 4, 1, VoxMat.JADE_TILE, 'vermilion', 'south');
      grid.buildLanternPost(-7, gy + 1, -72, 6, 'street');
      grid.buildLanternPost(7, gy + 1, -72, 6, 'street');
      grid.buildBannerPole(-14, gy + 9, -75, 7, VoxMat.BANNER_RED);
      grid.buildBannerPole(14, gy + 9, -75, 7, VoxMat.BANNER_RED);
    }

    // 2E. East Wutai Mountain Trail Paifang at (74, -22)
    if (overlaps(74, -22, 16)) {
      const py = Math.round(weizhouGroundHeight(74, -22)) - 1;
      grid.buildPaifang(74, py, -22, 6, VoxMat.JADE_TILE);
    }

    // 2F. Docked River Boats along Wei River
    if (overlaps(-24, 14, 10)) {
      grid.buildCanalBoat(-24, WATER_TOP, Math.round(weizhouRiverZ(-24)), 'x');
    }
    if (overlaps(30, 12, 10)) {
      grid.buildCanalBoat(30, WATER_TOP, Math.round(weizhouRiverZ(30)), 'x');
    }

    // 2G. Roadside Stone Lanterns guiding the traveler along the imperial road
    for (let lz = -66; lz <= 66; lz += 18) {
      if (Math.abs(lz - bridgeZ) < 14) continue;
      const rx = Math.round(weizhouRoadX(lz)) + (lz % 36 === 0 ? -6 : 6);
      if (overlaps(rx, lz, 4)) {
        const ly = Math.round(weizhouGroundHeight(rx, lz));
        if (ly > WATER_TOP + 1 && ly < 18) {
          grid.buildLanternPost(rx, ly, lz, 5, 'stone');
        }
      }
    }

    // 3. Deterministic Macro-Grid Forest Scatter (SeedWorld Giant Trees, Weeping Willows, Alpine Pines)
    // Expand search cell range by 1 cell around chunk so overhanging canopies stay 100% seamless across chunk borders!
    const CELL = 16;
    const gx0 = Math.floor((x0 - 16) / CELL);
    const gx1 = Math.floor((x1 + 16) / CELL);
    const gz0 = Math.floor((z0 - 16) / CELL);
    const gz1 = Math.floor((z1 + 16) / CELL);

    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const h1 = hash2i(gx * 19 + 5, gz * 23 - 7);
        if (h1 < 0.24) continue;
        const tx = gx * CELL + 3 + Math.floor(hash2i(gx * 7, gz * 13) * (CELL - 6));
        const tz = gz * CELL + 3 + Math.floor(hash2i(gx * 11 + 3, gz * 5 + 9) * (CELL - 6));

        // Keep roads, landmarks, portals & spawn corridors open
        if (weizhouRoadMask(tx, tz) > 0.08) continue;
        if (Math.hypot(tx + 18, tz + 6) < 14) continue;
        if (Math.hypot(tx - 24, tz - 34) < 15) continue;
        if (Math.hypot(tx, tz + 76) < 20) continue;
        if (Math.hypot(tx - 74, tz + 22) < 14) continue;
        if (Math.hypot(tx - 4, tz - 46) < 11) continue;

        const ty = Math.round(weizhouGroundHeight(tx, tz));
        if (ty <= WATER_TOP + 1 || ty >= 34) continue;

        const rDist = Math.abs(tz - weizhouRiverZ(tx));
        const sc = 0.78 + hash2i(gx * 31, gz * 37) * 0.45;
        const seed = gx * 13 + gz * 29;

        if (rDist < 14) {
          // Graceful Weeping Willows lining the Wei River banks
          grid.buildWeepingWillow(tx, ty - 1, tz, sc * 0.95, seed);
        } else if (ty >= 18) {
          // Rugged Alpine Pines climbing the Guanxi foothills
          grid.buildAlpinePine(tx, ty - 1, tz, sc * 1.15, seed);
        } else if (h1 > 0.72) {
          // Hero SeedWorld Radial-Bough Trees (spring emerald + golden autumn accents)
          const leaf = h1 > 0.91 ? VoxMat.LEAF_AUTUMN : VoxMat.LEAF_SPRING;
          grid.buildSeedWorldTree(tx, ty - 1, tz, sc, leaf, seed);
        } else {
          grid.buildAlpinePine(tx, ty - 1, tz, sc * 0.95, seed);
        }
      }
    }
  };
}

/**
 * 2. MOUNT WUTAI REGION POPULATOR (五台山 · 巍峨群峰)
 * Chunk-streamed 288×288 dramatic alpine massif:
 * - Five Sacred Peaks rising 58–74 voxels high with stratified slate/granite cliffs & snow caps!
 * - Multi-tier cascading mountain waterfall plunging down the West Cliff (-34, 34) into a foaming turquoise plunge pool
 * - Cliffside Mountain Shrine (山神祠) overlooking the gorge
 * - Arched Stone Pilgrimage Bridge spanning the mountain stream
 * - Winding carved stone pilgrim staircase lined with glowing stone lanterns
 * - Halfway Wine Pavilion (半山亭) at (20, 4) with red-sealed wine barrels & shade pines
 * - Grand Crimson Paifang Archway at the North Summit approach (0, -75)
 * - Lush alpine pine groves, golden autumn ginkgos & pink mountain cherry blossoms
 */
export function createWutaiRegionPopulator(): ChunkPopulateFn {
  const WATER_TOP = 6; // stream surface at y=6.84

  return (grid: VoxelGrid) => {
    const x0 = grid.originX;
    const x1 = grid.originX + grid.sx - 1;
    const z0 = grid.originZ;
    const z1 = grid.originZ + grid.sz - 1;

    // 1. Sculpt soaring 74-voxel Alpine Peaks, gorge stream & stone pilgrimage steps
    for (let wz = z0; wz <= z1; wz++) {
      for (let wx = x0; wx <= x1; wx++) {
        const hFloat = wutaiGroundHeight(wx, wz);
        const road = wutaiRoadMask(wx, wz);
        const streamDist = Math.abs(wz - wutaiStreamZ(wx));
        const roadDist = Math.abs(wx - wutaiRoadX(wz));
        const onBridge = roadDist < 4.6 && streamDist < 9.6;

        let topSolid = Math.min(grid.sy - 2, Math.round(hFloat) - 1);
        if (onBridge) {
          topSolid = Math.max(2, Math.min(5, Math.round(6.0 - (1 - streamDist / 9.6) * 3.0)));
        }

        const slope =
          Math.abs(wutaiGroundHeight(wx + 1, wz) - hFloat) +
          Math.abs(wutaiGroundHeight(wx, wz + 1) - hFloat);

        const yMin = Math.max(0, topSolid - 10);
        for (let y = 0; y < yMin; y++) {
          grid.setW(wx, y, wz, VoxMat.SLATE);
        }
        for (let y = yMin; y <= topSolid; y++) {
          let mat = VoxMat.ROCK;
          if (y === topSolid) {
            if (road > 0.44 && !onBridge) {
              mat = wz % 2 === 0 ? VoxMat.STONE : VoxMat.ROAD;
            } else if (topSolid <= WATER_TOP && streamDist < 10) {
              mat = VoxMat.SAND;
            } else if (topSolid >= 48 + smoothNoise(wx * 0.07, wz * 0.07) * 5) {
              mat = slope > 2.9 ? VoxMat.GRANITE : VoxMat.SNOW;
            } else if (topSolid >= 36) {
              mat = slope > 1.75 ? VoxMat.GRANITE : VoxMat.MOSS;
            } else if (slope > 1.65) {
              mat = (wx + y) % 5 === 0 ? VoxMat.GRANITE : VoxMat.ROCK;
            } else {
              mat = topSolid > 22 ? VoxMat.MOSS : VoxMat.GRASS;
            }
          } else if (y >= topSolid - 2 && slope < 1.6 && topSolid < 30) {
            mat = VoxMat.DIRT;
          } else {
            mat = y % 6 === 0 ? VoxMat.GRANITE : y % 3 === 0 ? VoxMat.SLATE : VoxMat.ROCK;
          }
          grid.setW(wx, y, wz, mat);
        }

        // Fill gorge stream & plunge pool with turquoise water
        if (topSolid < WATER_TOP && wz > -20) {
          for (let y = topSolid + 1; y <= WATER_TOP; y++) {
            grid.setW(wx, y, wz, VoxMat.WATER);
          }
        }
      }
    }

    const overlaps = (cx: number, cz: number, r: number) =>
      cx + r >= x0 && cx - r <= x1 && cz + r >= z0 && cz - r <= z1;

    // 2A. Multi-Tier Cascading Mountain Waterfall down the West Cliff into Plunge Pool (-32, 38)
    if (overlaps(-36, 32, 16)) {
      for (let wz = 22; wz <= 36; wz++) {
        for (let wx = -44; wx <= -30; wx++) {
          const dCenter = Math.abs(wx + 37 + Math.sin(wz * 0.25) * 1.5);
          if (dCenter <= 3.2) {
            const topY = Math.round(wutaiGroundHeight(wx, wz));
            const waterMax = Math.min(34, Math.max(WATER_TOP + 1, topY));
            for (let y = WATER_TOP + 1; y <= waterMax; y++) {
              // Luminous foamy cascade
              const isFoam = y === WATER_TOP + 1 || y === waterMax || (wx + y + wz) % 4 === 0;
              grid.setW(wx, y, wz, isFoam ? VoxMat.SNOW : VoxMat.WATER);
            }
          }
        }
      }
    }

    // 2B. Arched Stone Pilgrimage Bridge over the gorge stream
    const sBridgeZ = Math.round(wutaiStreamZ(wutaiRoadX(32)));
    const sBridgeX = Math.round(wutaiRoadX(sBridgeZ));
    if (overlaps(sBridgeX, sBridgeZ, 16)) {
      grid.buildArchedBridgeZ(sBridgeX, sBridgeZ - 9, sBridgeZ + 9, 4, 10, 2.8, 'stone');
    }

    // 2C. Halfway Wine Pavilion (半山亭) at (20, 4) with wine barrels & ancient pine
    if (overlaps(20, 4, 18)) {
      grid.buildPavilion(20, 16, 4, 4, VoxMat.JADE_TILE);
      // Iconic wine vats carried by the peddler
      grid.fillBoxW(21, 17, 2, 22, 18, 3, VoxMat.TIMBER);
      grid.setW(21, 19, 2, VoxMat.BANNER_RED);
      grid.setW(22, 19, 3, VoxMat.BANNER_RED);
      grid.buildBannerPole(14, 17, 6, 8, VoxMat.BANNER_RED);
      grid.buildLanternPost(15, 17, 1, 5, 'stone');
      grid.buildAlpinePine(29, 17, -2, 1.3, 41);
    }

    // 2D. Cliffside Mountain Shrine (山神祠) perched at (-22, 18)
    if (overlaps(-22, 18, 12)) {
      const sy = Math.round(wutaiGroundHeight(-22, 18)) - 1;
      grid.buildPavilion(-22, sy, 18, 3, VoxMat.CLAY_TILE);
      grid.buildLanternPost(-18, sy + 1, 18, 4, 'stone');
    }

    // 2E. Grand Summit Wutai Paifang (清凉山牌坊) at (0, -76)
    if (overlaps(0, -76, 18)) {
      grid.buildPaifang(0, 25, -76, 8, VoxMat.JADE_TILE);
      grid.buildLanternPost(-9, 26, -71, 5, 'stone');
      grid.buildLanternPost(9, 26, -71, 5, 'stone');
      grid.buildSeedWorldTree(-16, 26, -74, 1.05, VoxMat.LEAF_SAKURA, 77);
      grid.buildSeedWorldTree(16, 26, -74, 1.05, VoxMat.LEAF_AUTUMN, 83);
    }

    // 2F. East Bianliang Courier Trail Archway at (74, 44)
    if (overlaps(74, 44, 14)) {
      grid.buildPaifang(74, 10, 44, 6, VoxMat.CLAY_TILE);
    }

    // 2G. Stone Pilgrim Lanterns lining the winding mountain ascent
    for (let lz = -62; lz <= 62; lz += 16) {
      if (Math.abs(lz - sBridgeZ) < 12) continue;
      const rx = Math.round(wutaiRoadX(lz)) + (lz % 32 === 0 ? -5 : 5);
      if (overlaps(rx, lz, 4)) {
        const ly = Math.round(wutaiGroundHeight(rx, lz));
        if (ly > WATER_TOP + 1 && ly < 32) {
          grid.buildLanternPost(rx, ly, lz, 4, 'stone');
        }
      }
    }

    // 3. Alpine Conifer, Golden Ginkgo & Sakura Groves clinging to mountain slopes
    const CELL = 15;
    const gx0 = Math.floor((x0 - 15) / CELL);
    const gx1 = Math.floor((x1 + 15) / CELL);
    const gz0 = Math.floor((z0 - 15) / CELL);
    const gz1 = Math.floor((z1 + 15) / CELL);

    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const h1 = hash2i(gx * 29 + 11, gz * 31 - 17);
        if (h1 < 0.20) continue;
        const tx = gx * CELL + 2 + Math.floor(hash2i(gx * 13, gz * 7) * (CELL - 4));
        const tz = gz * CELL + 2 + Math.floor(hash2i(gx * 5 + 17, gz * 19 + 3) * (CELL - 4));

        if (wutaiRoadMask(tx, tz) > 0.02) continue;
        if (Math.abs(tx - wutaiRoadX(tz)) < 11) continue;
        if (Math.hypot(tx - 2, tz - 58) < 22) continue;
        if (Math.hypot(tx - 20, tz - 4) < 15) continue;
        if (Math.hypot(tx, tz + 74) < 18) continue;
        if (Math.hypot(tx - 74, tz - 44) < 14) continue;
        if (Math.hypot(tx + 34, tz - 34) < 15) continue;
        if (Math.hypot(tx + 22, tz - 18) < 10) continue;

        const ty = Math.round(wutaiGroundHeight(tx, tz));
        if (ty <= WATER_TOP + 1 || ty >= 48) continue;

        const sc = 0.85 + hash2i(gx * 41, gz * 43) * 0.52;
        const seed = gx * 17 + gz * 37;

        if (h1 > 0.88 && ty < 32) {
          // Luminous autumn golden ginkgo / pink mountain blossom SeedWorld trees
          const leaf = h1 > 0.94 ? VoxMat.LEAF_SAKURA : VoxMat.LEAF_AUTUMN;
          grid.buildSeedWorldTree(tx, ty - 1, tz, sc * 0.92, leaf, seed);
        } else if (h1 > 0.72 && ty < 24) {
          grid.buildSeedWorldTree(tx, ty - 1, tz, sc * 0.9, VoxMat.LEAF_SPRING, seed);
        } else {
          // Towering Wutai Alpine Pines
          grid.buildAlpinePine(tx, ty - 1, tz, sc * 1.15, seed);
        }
      }
    }
  };
}

/**
 * 3. DISTANT PANORAMIC MOUNTAIN RING (r = 128..340)
 * Surrounds open regions (and optionally scenes) with stratified, voxel-stepped mountain ranges
 * shaded with SeedWorld's exact warm-sun->cool-cyan atmospheric palette & fog so horizons feel endless!
 */
export function createDistantMountainRing(
  style: 'weizhou' | 'wutai' | 'horizon',
  sharedUniforms: SeedWorldUniforms
): THREE.Mesh {
  const segAng = 144;
  const rings = 10;
  const rInner = style === 'horizon' ? 88 : 132;
  const rOuter = style === 'horizon' ? 260 : 340;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const cGrass = new THREE.Color(0x3f8a48);
  const cPine = new THREE.Color(0x2a6144);
  const cRock = new THREE.Color(0x637282);
  const cSnow = new THREE.Color(0xeef5fc);
  const tmp = new THREE.Color();

  for (let r = 0; r <= rings; r++) {
    const rt = r / rings;
    const rad = rInner + (rOuter - rInner) * rt;
    const heightEnvelope = Math.sin(rt * Math.PI) * (style === 'wutai' ? 115 : style === 'weizhou' ? 78 : 42);

    for (let a = 0; a <= segAng; a++) {
      const ang = (a / segAng) * Math.PI * 2;
      const wx = Math.cos(ang) * rad;
      const wz = Math.sin(ang) * rad;

      const rid = ridgedNoise(wx * 0.0085 + 3.1, wz * 0.0085 - 2.4, 4);
      const det = smoothNoise(wx * 0.025, wz * 0.025);
      // Quantize subtly to 3-voxel terraces so distant peaks match the voxel art language
      const rawH =
        (style === 'wutai' ? 10 : 6) +
        heightEnvelope * (0.28 + rid * 0.92) +
        det * 8;
      const y = r === 0 ? 4 : Math.round(rawH / 3) * 3;

      positions.push(wx, y, wz);

      if (style === 'wutai' && y >= 62) {
        tmp.copy(cRock).lerp(cSnow, Math.min(1, (y - 62) / 18));
      } else if (y >= 34) {
        tmp.copy(cPine).lerp(cRock, Math.min(1, (y - 34) / 22));
      } else {
        tmp.copy(cGrass).lerp(cPine, Math.min(1, Math.max(0, (y - 10) / 22)));
      }
      colors.push(tmp.r, tmp.g, tmp.b);
    }
  }

  const stride = segAng + 1;
  for (let r = 0; r < rings; r++) {
    for (let a = 0; a < segAng; a++) {
      const i0 = r * stride + a;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uSunDir: sharedUniforms.uSunDir,
      uSunColor: sharedUniforms.uSunColor,
      uSunIntensity: sharedUniforms.uSunIntensity,
      uTopColor: sharedUniforms.uTopColor,
      uMidColor: sharedUniforms.uMidColor,
      uHorizonColor: sharedUniforms.uHorizonColor,
      uFogColor: sharedUniforms.uFogColor,
      uFogDensity: sharedUniforms.uFogDensity,
    },
    vertexShader: /* glsl */ `
      in vec3 color;
      out vec3 vColor;
      out vec3 vNormal;
      out vec3 vWorldPos;
      void main() {
        vColor = color;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunIntensity;
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      in vec3 vColor;
      in vec3 vNormal;
      in vec3 vWorldPos;
      out vec4 fragColor;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 sunDir = normalize(uSunDir);
        float NdL = max(dot(N, sunDir), 0.0);
        vec3 skyAmb = mix(uHorizonColor, uTopColor, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
        vec3 direct = vColor * vec3(1.12, 1.04, 0.84) * uSunColor * (pow(NdL, 0.85) * uSunIntensity * 0.82);
        vec3 indirect = vColor * skyAmb * 0.62;
        vec3 col = direct + indirect;

        float dist = length(cameraPosition - vWorldPos);
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 0.78);
        col = mix(col, uFogColor, clamp(fogF, 0.0, 0.92));

        vec3 tm = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
        vec3 srgb = mix(tm * 12.92, 1.055 * pow(max(tm, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), tm));
        fragColor = vec4(srgb, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  return mesh;
}
