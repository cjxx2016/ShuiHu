import * as THREE from 'three';
import { VoxMat } from '../voxel/materials';
import { VoxelGrid } from '../voxel/VoxelGrid';
import { bakeSeedWorldMesh } from '../voxel/SeedWorldMesher';
import {
  SeedWorldUniforms,
  createSeedWorldVoxelMaterial,
} from '../voxel/SeedWorldShaders';
import type { SceneBuildResult } from './sceneBuilders';

function finalizeInteriorGrid(
  grid: VoxelGrid,
  sharedUniforms: SeedWorldUniforms
): SceneBuildResult {
  const baked = bakeSeedWorldMesh(grid, { buildBleedVolume: true });
  const group = new THREE.Group();
  if (baked.geometry) {
    const mat = createSeedWorldVoxelMaterial(
      sharedUniforms,
      baked.bleedTex ?? undefined,
      baked.volMin,
      baked.volSize
    );
    group.add(new THREE.Mesh(baked.geometry, mat));
  }
  return {
    group,
    bleedTextures: baked.bleedTex ? [baked.bleedTex] : [],
  };
}

/**
 * ============================================================================
 * 1. PAN'S GRAND TAVERN INTERIOR (潘家酒楼 · 阁楼雅堂)
 * High-Precision 0.5-Unit Fine Voxel Grid (66 × 34 × 66 covering 33×17×33 world units)
 * ============================================================================
 * - Top of floor sits at exact world y = 0.0 (grid originY = -2, floor at wy = -2..-1)
 * - Low cutaway south wainscot (<= 3 fine voxels = 1.5 world units) so camera never clips!
 * - Exposed timber ceiling trusses, wrap-around mezzanine gallery & carved staircase
 * - Glowing Song lattice windows, red-lacquer wine bar with rows of clay wine jars
 * - Carved wooden folding screen separating Jin Cuilian's alcove
 * - Warm hanging silk lanterns casting rich 3D flood-fill golden light spill!
 */
export function buildTavernInterior(sharedUniforms: SeedWorldUniforms): SceneBuildResult {
  // Fine 0.5-unit voxels: 1 world unit = 2 voxels!
  const grid = new VoxelGrid(66, 34, 66, -33, -2, -33, 0.5);
  const RX = 30; // ±15 world units
  const RZ = 28; // ±14 world units
  const H = 26;  // 13 world units tall

  // 1. Planked Cedar Floor (top at world y = 0)
  for (let wz = -RZ; wz <= RZ; wz++) {
    for (let wx = -RX; wx <= RX; wx++) {
      grid.setW(wx, -2, wz, VoxMat.TRUNK);
      const isRunner = Math.abs(wx) <= 5 && wz >= -16 && wz <= 26;
      const plank = Math.abs(wz) % 4 === 0 ? VoxMat.TRUNK : VoxMat.TIMBER;
      grid.setW(wx, -1, wz, isRunner ? VoxMat.BANNER_RED : plank);
    }
  }

  // 2. North, West, East Timber-Framed Plaster Walls + Glowing Shoji Lattice Windows
  for (let y = 0; y <= H; y++) {
    for (let wx = -RX; wx <= RX; wx++) {
      // North wall (wz = -RZ)
      const isPost = Math.abs(wx) === RX || Math.abs(wx) % 10 === 0;
      const isBeam = y === 0 || y === 13 || y === H;
      const isWin = y >= 15 && y <= 22 && Math.abs(wx) % 10 >= 2 && Math.abs(wx) % 10 <= 8;
      grid.setW(
        wx,
        y,
        -RZ,
        isPost || isBeam
          ? VoxMat.TRUNK
          : isWin
            ? (wx + y) % 3 === 0
              ? VoxMat.TIMBER
              : VoxMat.GLOW_WARM
            : VoxMat.PLASTER
      );
    }
    for (let wz = -RZ; wz <= RZ; wz++) {
      const isPost = Math.abs(wz) === RZ || Math.abs(wz) % 10 === 0;
      const isBeam = y === 0 || y === 13 || y === H;
      const isWin =
        ((y >= 4 && y <= 10) || (y >= 16 && y <= 22)) &&
        Math.abs(wz) % 10 >= 2 &&
        Math.abs(wz) % 10 <= 8;
      for (const sideX of [-RX, RX]) {
        grid.setW(
          sideX,
          y,
          wz,
          isPost || isBeam
            ? VoxMat.TRUNK
            : isWin
              ? (wz + y) % 3 === 0
                ? VoxMat.TIMBER
                : VoxMat.GLOW_WARM
              : VoxMat.PLASTER
        );
      }
    }
  }

  // Low cutaway south wainscot (only 3 fine voxels = 1.5 world units tall!) + portal doormat
  for (let wx = -RX; wx <= RX; wx++) {
    if (Math.abs(wx) <= 5) continue;
    grid.fillBoxW(wx, 0, RZ, wx, 2, RZ, VoxMat.TRUNK);
    grid.setW(wx, 3, RZ, VoxMat.VERMILION);
  }
  grid.fillBoxW(-6, 0, RZ - 1, -6, 6, RZ, VoxMat.VERMILION);
  grid.fillBoxW(6, 0, RZ - 1, 6, 6, RZ, VoxMat.VERMILION);
  grid.setW(-6, 7, RZ, VoxMat.GLOW_LANTERN);
  grid.setW(6, 7, RZ, VoxMat.GLOW_LANTERN);

  // 3. Mezzanine Loft Gallery Balcony along North, West & East (y = 13) + Exposed Rafters
  grid.fillBoxW(-RX + 1, 13, -RZ + 1, RX - 1, 13, -RZ + 8, VoxMat.TIMBER);
  grid.fillBoxW(-RX + 1, 13, -RZ + 8, -RX + 7, 13, RZ - 4, VoxMat.TIMBER);
  grid.fillBoxW(RX - 7, 13, -RZ + 8, RX - 1, 13, RZ - 4, VoxMat.TIMBER);
  // Vermilion balcony railings & golden corner finials
  for (let wx = -RX + 7; wx <= RX - 7; wx++) {
    grid.setW(wx, 14, -RZ + 8, wx % 2 === 0 ? VoxMat.VERMILION : VoxMat.EMPTY);
    grid.setW(wx, 15, -RZ + 8, VoxMat.VERMILION);
  }
  for (let wz = -RZ + 8; wz <= RZ - 4; wz++) {
    for (const bx of [-RX + 7, RX - 7]) {
      grid.setW(bx, 14, wz, wz % 2 === 0 ? VoxMat.VERMILION : VoxMat.EMPTY);
      grid.setW(bx, 15, wz, VoxMat.VERMILION);
    }
  }
  // Corner vermilion support pillars
  for (const px of [-RX + 7, -8, 8, RX - 7]) {
    grid.fillBoxW(px, 0, -RZ + 8, px, H, -RZ + 8, VoxMat.VERMILION);
  }
  for (const pz of [-6, 10]) {
    grid.fillBoxW(-RX + 7, 0, pz, -RX + 7, H, pz, VoxMat.VERMILION);
    grid.fillBoxW(RX - 7, 0, pz, RX - 7, H, pz, VoxMat.VERMILION);
  }
  // Ceiling crossbeams (only at north & mid so camera overhead stays clear)
  for (let wz = -RZ + 4; wz <= 6; wz += 10) {
    grid.fillBoxW(-RX, H - 1, wz, RX, H, wz, VoxMat.TRUNK);
  }

  // 4. Grand Song Wine Bar Counter & Shelf of Red-Sealed Clay Wine Jars (x = -18..14, z = -25..-18)
  grid.fillBoxW(-18, 0, -18, 14, 3, -17, VoxMat.VERMILION);
  grid.fillBoxW(-18, 4, -19, 14, 4, -17, VoxMat.LIGHT_WOOD); // polished bar top
  grid.fillBoxW(-18, 0, -25, -17, 3, -18, VoxMat.VERMILION);
  grid.fillBoxW(13, 0, -25, 14, 3, -18, VoxMat.VERMILION);
  // Multi-tier wine rack against north wall
  for (const sy of [3, 7, 10]) {
    grid.fillBoxW(-16, sy, -RZ + 1, 12, sy, -RZ + 3, VoxMat.TRUNK);
    for (let wx = -15; wx <= 11; wx += 3) {
      grid.fillBoxW(wx, sy + 1, -RZ + 2, wx + 1, sy + 2, -RZ + 2, VoxMat.BRONZE);
      grid.setW(wx, sy + 3, -RZ + 2, VoxMat.BANNER_RED); // red cloth wine seal!
    }
  }
  // Golden plaque "状元红 · 潘家酒楼"
  grid.fillBoxW(-8, 16, -RZ + 8, 8, 18, -RZ + 8, VoxMat.TRUNK);
  grid.fillBoxW(-7, 16, -RZ + 9, 7, 18, -RZ + 9, VoxMat.GOLD);

  // 5. Fine Voxel Dining Tables, Benches, Wine Bowls & Plates (matching colliders!)
  const addDiningSet = (cx: number, cz: number) => {
    // Table legs & tabletop (height 3 fine voxels = 1.5 world units)
    for (const ox of [-3, 3]) {
      for (const oz of [-3, 3]) {
        grid.fillBoxW(cx + ox, 0, cz + oz, cx + ox, 2, cz + oz, VoxMat.TRUNK);
      }
    }
    grid.fillBoxW(cx - 3, 3, cz - 3, cx + 3, 3, cz + 3, VoxMat.TIMBER);
    // Clay wine jar, porcelain bowls & roast beef platter
    grid.fillBoxW(cx - 1, 4, cz - 1, cx, 5, cz, VoxMat.BRONZE);
    grid.setW(cx - 1, 6, cz - 1, VoxMat.BANNER_RED);
    grid.setW(cx + 2, 4, cz + 1, VoxMat.PLASTER);
    grid.setW(cx - 2, 4, cz + 2, VoxMat.PLASTER);
    grid.setW(cx + 1, 4, cz - 2, VoxMat.BANNER_GOLD);
    // Wooden benches
    grid.fillBoxW(cx - 2, 0, cz - 5, cx + 2, 1, cz - 5, VoxMat.LIGHT_WOOD);
    grid.fillBoxW(cx - 2, 0, cz + 5, cx + 2, 1, cz + 5, VoxMat.LIGHT_WOOD);
  };
  addDiningSet(-17, -1); // Shi Jin's table (-8.5, -0.5)
  addDiningSet(-17, 13); // South-west table (-8.5, 6.5)
  addDiningSet(11, 10);  // South-east table (5.5, 5.0)

  // 6. Carved Lacquer Folding Screen separating Jin Cuilian's East Alcove (x = 12, z = -15..-3)
  for (let wz = -15; wz <= -3; wz++) {
    const zig = wz % 4 < 2 ? 0 : 1;
    grid.fillBoxW(11 + zig, 0, wz, 11 + zig, 8, wz, VoxMat.TRUNK);
    if (wz % 3 !== 0) {
      grid.fillBoxW(11 + zig, 2, wz, 11 + zig, 7, wz, VoxMat.BANNER_GOLD);
    }
  }
  // Small musical pipa stool & glowing tabletop lantern in Jin Cuilian's alcove
  grid.fillBoxW(22, 0, -12, 25, 2, -9, VoxMat.TIMBER);
  grid.setW(23, 3, -10, VoxMat.GLOW_LANTERN);

  // 7. Hanging Silk Palace Lanterns (cast warm orange-gold 3D light bleed across the whole tavern!)
  const lanterns: Array<[number, number, number]> = [
    [-16, 11, -1],
    [-16, 11, 13],
    [12, 11, 10],
    [18, 11, -9],
    [-8, 11, -14],
    [8, 11, -14],
    [0, 18, -6],
    [0, 18, 8],
  ];
  for (const [lx, ly, lz] of lanterns) {
    grid.fillBoxW(lx, ly + 2, lz, lx, ly + 4, lz, VoxMat.TRUNK);
    grid.fillBoxW(lx - 1, ly, lz - 1, lx + 1, ly + 1, lz + 1, VoxMat.GLOW_LANTERN);
    grid.setW(lx, ly - 1, lz, VoxMat.GOLD);
  }

  return finalizeInteriorGrid(grid, sharedUniforms);
}

/**
 * ============================================================================
 * 2. MAHAVIRA HALL INTERIOR (文殊院 · 大雄宝殿内)
 * High-Precision 0.5-Unit Fine Voxel Grid (72 × 38 × 72 covering 36×19×36 world units)
 * ============================================================================
 * - Patterned stone-and-slate sanctuary floor (top at exact world y = 0.0) + royal crimson carpet
 * - Soaring vermilion temple columns with carved stone bases & golden dougong capitals
 * - Monumental Sculpted GOLDEN VOXEL BUDDHA (金身如来) seated on a multi-tier carved Lotus Pedestal
 *   with a radiant glowing golden Mandorla Halo (背光) casting golden 3D light bleed across the hall!
 * - Bronze tripod incense cauldron with glowing embers, prayer cushions, sutra stands & silk temple banners
 * - Low cutaway south wainscot so the 3rd-person camera never clips behind walls!
 */
export function buildTempleInterior(sharedUniforms: SeedWorldUniforms): SceneBuildResult {
  const grid = new VoxelGrid(72, 38, 72, -36, -2, -36, 0.5);
  const RX = 32; // ±16 world units
  const RZ = 30; // ±15 world units
  const H = 32;  // 16 world units tall

  // 1. Patterned Stone & Slate Temple Floor (top at exact world y = 0)
  for (let wz = -RZ; wz <= RZ; wz++) {
    for (let wx = -RX; wx <= RX; wx++) {
      grid.setW(wx, -2, wz, VoxMat.SLATE);
      const isCarpet = Math.abs(wx) <= 5 && wz >= -12 && wz <= 28;
      const isBorder = Math.abs(wx) === 6 && wz >= -12 && wz <= 28;
      let mat = (Math.floor(wx / 4) + Math.floor(wz / 4)) % 2 === 0 ? VoxMat.STONE : VoxMat.ROAD;
      if (isCarpet) mat = VoxMat.BANNER_RED;
      else if (isBorder) mat = VoxMat.GOLD;
      grid.setW(wx, -1, wz, mat);
    }
  }

  // 2. Crimson Temple Walls, Recessed Golden Sutra Niches & High Clerestory Windows
  for (let y = 0; y <= H; y++) {
    for (let wx = -RX; wx <= RX; wx++) {
      const isPillar = Math.abs(wx) === RX || Math.abs(wx) % 10 === 0;
      const isBeam = y <= 2 || y === 18 || y === H;
      const isClerestory = y >= 21 && y <= 27 && Math.abs(wx) % 10 >= 2 && Math.abs(wx) % 10 <= 8;
      grid.setW(
        wx,
        y,
        -RZ,
        isPillar
          ? VoxMat.VERMILION
          : isBeam
            ? VoxMat.TRUNK
            : isClerestory
              ? VoxMat.GLOW_WARM
              : VoxMat.VERMILION
      );
    }
    for (let wz = -RZ; wz <= RZ; wz++) {
      const isPillar = Math.abs(wz) === RZ || Math.abs(wz) % 10 === 0;
      const isBeam = y <= 2 || y === 18 || y === H;
      const isWin =
        ((y >= 6 && y <= 14) || (y >= 21 && y <= 27)) &&
        Math.abs(wz) % 10 >= 3 &&
        Math.abs(wz) % 10 <= 7;
      for (const sx of [-RX, RX]) {
        grid.setW(
          sx,
          y,
          wz,
          isPillar
            ? VoxMat.VERMILION
            : isBeam
              ? VoxMat.TRUNK
              : isWin
                ? (wz + y) % 3 === 0
                  ? VoxMat.TRUNK
                  : VoxMat.GLOW_WARM
                : VoxMat.PLASTER
        );
      }
    }
  }

  // Low cutaway south wainscot (<= 3 fine voxels = 1.5 world units)
  for (let wx = -RX; wx <= RX; wx++) {
    if (Math.abs(wx) <= 6) continue;
    grid.fillBoxW(wx, 0, RZ, wx, 2, RZ, VoxMat.VERMILION);
    grid.setW(wx, 3, RZ, VoxMat.GOLD);
  }

  // 3. Soaring Vermilion Temple Columns with Carved Marble Bases & Golden Capitals
  const colPositions: Array<[number, number]> = [
    [-20, -20],
    [20, -20],
    [-20, -4],
    [20, -4],
    [-20, 12],
    [20, 12],
  ];
  for (const [cx, cz] of colPositions) {
    grid.fillBoxW(cx - 2, 0, cz - 2, cx + 2, 1, cz + 2, VoxMat.PLASTER);
    grid.fillBoxW(cx - 1, 2, cz - 1, cx + 1, H - 3, cz + 1, VoxMat.VERMILION);
    // Golden dougong capital
    grid.fillBoxW(cx - 2, H - 2, cz - 2, cx + 2, H - 1, cz + 2, VoxMat.GOLD);
    // Hanging temple silk banner beside inner columns
    if (cz <= 0) {
      const bx = cx > 0 ? cx - 3 : cx + 3;
      grid.fillBoxW(bx, 10, cz, bx, 22, cz, VoxMat.BANNER_GOLD);
      grid.setW(bx, 9, cz, VoxMat.BANNER_RED);
    }
  }
  // Ornate dark-cedar ceiling beams over north & center
  for (const bz of [-20, -4]) {
    grid.fillBoxW(-RX, H - 1, bz, RX, H, bz, VoxMat.TRUNK);
  }

  // 4. MONUMENTAL SCULPTED GOLDEN BUDDHA (金身如来) & CARVED LOTUS ALTAR (z = -28..-15)
  // Multi-tier stone & marble altar plinth
  grid.fillBoxW(-15, 0, -28, 15, 3, -15, VoxMat.STONE);
  grid.fillBoxW(-14, 4, -27, 14, 5, -16, VoxMat.PLASTER);
  grid.fillBoxW(-11, 6, -26, 11, 7, -17, VoxMat.VERMILION);
  // Carved Golden Lotus Throne (莲花座)
  for (let dx = -7; dx <= 7; dx++) {
    for (let dz = -25; dz <= -18; dz++) {
      const dist = Math.hypot(dx, dz + 21.5);
      if (dist <= 6.2) {
        grid.setW(dx, 8, dz, VoxMat.GOLD);
        if (dist <= 5.0) grid.setW(dx, 9, dz, VoxMat.BANNER_GOLD);
      }
    }
  }

  // Seated Golden Buddha Figure (cross-legged knees, kasaya robes, mudra hands, serene head & ushnisha)
  // Crossed legs & lap
  grid.fillBoxW(-6, 10, -23, 6, 12, -19, VoxMat.GOLD);
  grid.fillBoxW(-4, 12, -21, 4, 13, -19, VoxMat.BANNER_GOLD);
  // Broad torso & draped robe fold
  grid.fillBoxW(-4, 13, -23, 4, 20, -20, VoxMat.GOLD);
  for (let i = 0; i <= 6; i++) {
    grid.setW(-4 + i, 19 - i, -19, VoxMat.BANNER_RED);
  }
  // Shoulders & meditative arms
  grid.fillBoxW(-6, 15, -22, -5, 19, -20, VoxMat.GOLD);
  grid.fillBoxW(5, 15, -22, 6, 19, -20, VoxMat.GOLD);
  grid.fillBoxW(-5, 13, -19, -2, 14, -18, VoxMat.GOLD);
  grid.fillBoxW(2, 13, -19, 5, 14, -18, VoxMat.GOLD);
  // Serene head, elongated ears & crown ushnisha
  grid.fillBoxW(-2, 21, -23, 2, 25, -20, VoxMat.GOLD);
  grid.fillBoxW(-3, 22, -22, -3, 24, -21, VoxMat.GOLD);
  grid.fillBoxW(3, 22, -22, 3, 24, -21, VoxMat.GOLD);
  grid.fillBoxW(-2, 25, -23, 2, 26, -20, VoxMat.SLATE); // dark blue-black hair curls
  grid.fillBoxW(-1, 27, -22, 1, 27, -21, VoxMat.SLATE);
  grid.setW(0, 24, -19, VoxMat.GLOW_WARM); // urna brow jewel

  // Radiant Glowing Golden Mandorla Halo (背光) behind Buddha (emits golden 3D light bleed!)
  for (let y = 10; y <= 30; y++) {
    for (let dx = -9; dx <= 9; dx++) {
      const d = Math.hypot(dx / 9.2, (y - 20) / 10.5);
      if (d <= 1.0 && d >= 0.72) {
        grid.setW(dx, y, -25, VoxMat.GLOW_WARM);
      } else if (d < 0.72 && d >= 0.56) {
        grid.setW(dx, y, -25, VoxMat.GOLD);
      }
    }
  }

  // 5. Incense Altar Table, Bronze Cauldron & Prayer Cushions (z = -9..-5)
  grid.fillBoxW(-6, 0, -9, 6, 3, -5, VoxMat.VERMILION);
  grid.fillBoxW(-7, 4, -9, 7, 4, -5, VoxMat.GOLD);
  // Bronze incense burner with glowing incense embers + twin altar candles
  grid.fillBoxW(-2, 5, -8, 2, 7, -6, VoxMat.BRONZE);
  grid.fillBoxW(-1, 8, -7, 1, 8, -7, VoxMat.GLOW_LANTERN);
  grid.fillBoxW(-5, 5, -7, -5, 7, -7, VoxMat.BANNER_RED);
  grid.setW(-5, 8, -7, VoxMat.GLOW_WARM);
  grid.fillBoxW(5, 5, -7, 5, 7, -7, VoxMat.BANNER_RED);
  grid.setW(5, 8, -7, VoxMat.GLOW_WARM);

  // Prayer Cushions (蒲团) on floor in front of altar
  for (const px of [-8, 0, 8]) {
    grid.fillBoxW(px - 2, 0, 2, px + 2, 0, 5, VoxMat.BANNER_GOLD);
    grid.fillBoxW(px - 1, 1, 3, px + 1, 1, 4, VoxMat.BANNER_RED);
  }

  // Side Sutra Bookcases along West & East walls
  for (const sx of [-RX + 2, RX - 4]) {
    grid.fillBoxW(sx, 0, -14, sx + 2, 10, -4, VoxMat.TRUNK);
    for (let sy = 2; sy <= 8; sy += 3) {
      grid.fillBoxW(sx, sy, -13, sx + 2, sy + 1, -5, VoxMat.BANNER_GOLD);
    }
  }

  // 6. Hanging Palace Sanctuary Lanterns
  const hallLanterns: Array<[number, number, number]> = [
    [-12, 14, -12],
    [12, 14, -12],
    [-12, 14, 4],
    [12, 14, 4],
    [0, 18, 12],
  ];
  for (const [lx, ly, lz] of hallLanterns) {
    grid.fillBoxW(lx, ly + 2, lz, lx, ly + 5, lz, VoxMat.TRUNK);
    grid.fillBoxW(lx - 1, ly, lz - 1, lx + 1, ly + 1, lz + 1, VoxMat.GLOW_LANTERN);
    grid.setW(lx, ly - 1, lz, VoxMat.GOLD);
  }

  return finalizeInteriorGrid(grid, sharedUniforms);
}
