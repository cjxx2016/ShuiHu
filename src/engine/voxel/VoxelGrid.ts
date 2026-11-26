import { VoxMat, isSolidVoxel } from './materials';

function hash3(x: number, y: number, z: number): number {
  let h =
    Math.imul(x | 0, 374761393) +
    Math.imul(y | 0, 668265263) +
    Math.imul(z | 0, 2147483647);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Dense 3D Voxel Grid supporting world-space coordinates + high-detail Song Dynasty & SeedWorld sculpting.
 */
export class VoxelGrid {
  public readonly sx: number;
  public readonly sy: number;
  public readonly sz: number;
  public readonly originX: number;
  public readonly originY: number;
  public readonly originZ: number;
  public readonly voxelScale: number;
  public readonly data: Uint8Array;

  constructor(
    sx: number,
    sy: number,
    sz: number,
    originX: number,
    originY: number,
    originZ: number,
    voxelScale = 1.0
  ) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.originX = originX;
    this.originY = originY;
    this.originZ = originZ;
    this.voxelScale = voxelScale;
    this.data = new Uint8Array(sx * sy * sz);
  }

  /** Local grid index helper (y-major for cache-friendly vertical & XZ sweeps) */
  public idx(lx: number, ly: number, lz: number): number {
    return (ly * this.sz + lz) * this.sx + lx;
  }

  public inLocal(lx: number, ly: number, lz: number): boolean {
    return lx >= 0 && lx < this.sx && ly >= 0 && ly < this.sy && lz >= 0 && lz < this.sz;
  }

  public setLocal(lx: number, ly: number, lz: number, mat: VoxMat): void {
    const ix = Math.round(lx);
    const iy = Math.round(ly);
    const iz = Math.round(lz);
    if (ix >= 0 && ix < this.sx && iy >= 0 && iy < this.sy && iz >= 0 && iz < this.sz) {
      this.data[(iy * this.sz + iz) * this.sx + ix] = mat;
    }
  }

  public getLocal(lx: number, ly: number, lz: number): VoxMat {
    if (lx < 0 || lx >= this.sx || ly < 0 || ly >= this.sy || lz < 0 || lz >= this.sz) {
      return VoxMat.EMPTY;
    }
    return this.data[(ly * this.sz + lz) * this.sx + lx] as VoxMat;
  }

  /** World-grid coordinate helpers (in voxel units relative to origin) */
  public setW(wx: number, wy: number, wz: number, mat: VoxMat): void {
    this.setLocal(wx - this.originX, wy - this.originY, wz - this.originZ, mat);
  }

  public getW(wx: number, wy: number, wz: number): VoxMat {
    return this.getLocal(
      Math.round(wx - this.originX),
      Math.round(wy - this.originY),
      Math.round(wz - this.originZ)
    );
  }

  public fillBoxW(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    mat: VoxMat
  ): void {
    const ax = Math.max(0, Math.round(Math.min(x0, x1) - this.originX));
    const bx = Math.min(this.sx - 1, Math.round(Math.max(x0, x1) - this.originX));
    const ay = Math.max(0, Math.round(Math.min(y0, y1) - this.originY));
    const by = Math.min(this.sy - 1, Math.round(Math.max(y0, y1) - this.originY));
    const az = Math.max(0, Math.round(Math.min(z0, z1) - this.originZ));
    const bz = Math.min(this.sz - 1, Math.round(Math.max(z0, z1) - this.originZ));
    if (ax > bx || ay > by || az > bz) return;
    const d = this.data;
    const sx = this.sx;
    const sz = this.sz;
    for (let y = ay; y <= by; y++) {
      const yOff = y * sz;
      for (let z = az; z <= bz; z++) {
        const row = (yOff + z) * sx;
        for (let x = ax; x <= bx; x++) {
          d[row + x] = mat;
        }
      }
    }
  }

  public fillEllipsoidW(
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
    mat: VoxMat,
    seed = 0,
    keepTrunk = true
  ): void {
    const xMin = Math.ceil(cx - rx - 1);
    const xMax = Math.floor(cx + rx + 1);
    const yMin = Math.ceil(cy - ry - 1);
    const yMax = Math.floor(cy + ry + 1);
    const zMin = Math.ceil(cz - rz - 1);
    const zMax = Math.floor(cz + rz + 1);
    // Quick chunk overlap reject
    if (
      xMax < this.originX ||
      xMin >= this.originX + this.sx ||
      zMax < this.originZ ||
      zMin >= this.originZ + this.sz ||
      yMax < this.originY ||
      yMin >= this.originY + this.sy
    ) {
      return;
    }

    for (let y = yMin; y <= yMax; y++) {
      const ny = (y - cy) / ry;
      for (let z = zMin; z <= zMax; z++) {
        const nz = (z - cz) / rz;
        for (let x = xMin; x <= xMax; x++) {
          const nx = (x - cx) / rx;
          const d2 = nx * nx + ny * ny + nz * nz;
          const ang = Math.atan2(z - cz, x - cx);
          const lobe =
            0.09 * Math.sin(ang * 3 + seed) + 0.06 * Math.cos((y - cy + seed) * 1.15);
          if (d2 <= 1.0 + lobe) {
            if (keepTrunk && this.getW(x, y, z) === VoxMat.TRUNK) continue;
            this.setW(x, y, z, mat);
          }
        }
      }
    }
  }

  public drawBranchW(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    mat: VoxMat = VoxMat.TRUNK,
    thick = 1
  ): void {
    const steps = Math.max(4, Math.ceil(Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 1.4));
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const bx = x0 + (x1 - x0) * u;
      const by = y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * 0.45;
      const bz = z0 + (z1 - z0) * u;
      const r = u < 0.45 ? thick : 0;
      for (let ox = 0; ox <= r; ox++) {
        for (let oz = 0; oz <= r; oz++) {
          this.setW(bx + ox, by, bz + oz, mat);
        }
      }
    }
  }

  /**
   * Authentic SeedWorld Giant Radial-Bough Tree (ported from seedworld-tree-house_base.html):
   * Flared buttress roots, curved tapered trunk, exposed radiating woody boughs,
   * and 6–8 overlapping organic ellipsoid foliage canopies casting rich volumetric shade!
   */
  public buildSeedWorldTree(
    tx: number,
    baseY: number,
    tz: number,
    scale = 1.0,
    leafMat: VoxMat = VoxMat.LEAF_SPRING,
    seed = 1
  ): void {
    const maxR = Math.ceil(13 * scale);
    if (
      tx + maxR < this.originX ||
      tx - maxR >= this.originX + this.sx ||
      tz + maxR < this.originZ ||
      tz - maxR >= this.originZ + this.sz
    ) {
      return;
    }

    const trunkH = Math.max(5, Math.round(9 * scale));
    const trunkTop = baseY + trunkH;
    // Flared roots & curved trunk
    for (let dy = -2; dy <= trunkH; dy++) {
      const t = Math.max(0, dy) / trunkH;
      const rad = dy <= 1 ? (2.1 - dy * 0.3) * scale : (1.45 - t * 0.62) * scale;
      const cx = tx + Math.sin(t * 2.1 + seed) * 0.85 * scale;
      const cz = tz + Math.cos(t * 1.7 + seed) * 0.55 * scale;
      const rCeil = Math.ceil(rad + 0.5);
      for (let ox = -rCeil; ox <= rCeil; ox++) {
        for (let oz = -rCeil; oz <= rCeil; oz++) {
          const dist = Math.hypot(ox, oz);
          const flare =
            dy <= 2
              ? Math.cos(Math.atan2(oz, ox) * 4 + seed) *
                (0.45 * scale * (1 - Math.max(0, dy) / 2.5))
              : 0;
          if (dist <= Math.max(0.55, rad + flare)) {
            this.setW(cx + ox, baseY + dy, cz + oz, VoxMat.TRUNK);
          }
        }
      }
    }

    const boughs = [
      { ang: 0.2 + seed, dist: 5.4, dy: 2.0, rx: 5.2, ry: 3.4, rz: 4.8 },
      { ang: 1.3 + seed, dist: 4.9, dy: 3.4, rx: 4.8, ry: 3.5, rz: 4.5 },
      { ang: 2.4 + seed, dist: 5.6, dy: 1.2, rx: 5.3, ry: 3.2, rz: 5.0 },
      { ang: 3.5 + seed, dist: 4.8, dy: 2.9, rx: 4.6, ry: 3.4, rz: 4.6 },
      { ang: 4.6 + seed, dist: 5.3, dy: 1.8, rx: 5.0, ry: 3.2, rz: 4.8 },
      { ang: 5.6 + seed, dist: 4.5, dy: 3.8, rx: 4.4, ry: 3.1, rz: 4.3 },
    ];

    boughs.forEach((b, i) => {
      const bx = tx + Math.cos(b.ang) * b.dist * scale;
      const bz = tz + Math.sin(b.ang) * b.dist * scale;
      const by = trunkTop + b.dy * scale;
      this.drawBranchW(
        tx,
        trunkTop - 1,
        tz,
        bx - Math.cos(b.ang) * scale,
        by - scale,
        bz - Math.sin(b.ang) * scale,
        VoxMat.TRUNK,
        scale > 0.85 ? 1 : 0
      );
      this.fillEllipsoidW(
        bx,
        by,
        bz,
        b.rx * scale,
        b.ry * scale,
        b.rz * scale,
        leafMat,
        seed + i * 1.7
      );
    });

    // Central high crown
    this.fillEllipsoidW(
      tx,
      trunkTop + 5.6 * scale,
      tz,
      5.8 * scale,
      3.8 * scale,
      5.6 * scale,
      leafMat,
      seed + 9.1
    );
  }

  /**
   * Sculpted Alpine Mountain Pine (multi-tiered irregular evergreen boughs like Pagoda's pine trees).
   */
  public buildAlpinePine(
    tx: number,
    baseY: number,
    tz: number,
    scale = 1.0,
    seed = 1
  ): void {
    const maxR = Math.ceil(7 * scale);
    if (
      tx + maxR < this.originX ||
      tx - maxR >= this.originX + this.sx ||
      tz + maxR < this.originZ ||
      tz - maxR >= this.originZ + this.sz
    ) {
      return;
    }

    const totalH = Math.max(8, Math.round(14 * scale));
    // Slightly gnarled trunk
    for (let dy = -2; dy <= totalH - 3; dy++) {
      const cx = tx + Math.round(Math.sin(dy * 0.22 + seed) * 0.6);
      const cz = tz + Math.round(Math.cos(dy * 0.18 + seed) * 0.5);
      this.setW(cx, baseY + dy, cz, VoxMat.TRUNK);
      if (dy < 3 && scale >= 0.9) {
        this.setW(cx + 1, baseY + dy, cz, VoxMat.TRUNK);
      }
    }

    // Tiered sweeping conifer whorls
    const tiers = 5;
    for (let t = 0; t < tiers; t++) {
      const frac = t / (tiers - 1);
      const ty = baseY + Math.round((3.5 + frac * (totalH - 4.5)));
      const rad = Math.max(1.6, (4.8 - frac * 3.1) * scale);
      const thick = Math.max(1.3, (1.85 - frac * 0.35) * scale);
      this.fillEllipsoidW(
        tx + Math.sin(t * 2.1 + seed) * 0.5,
        ty,
        tz + Math.cos(t * 1.9 + seed) * 0.5,
        rad,
        thick,
        rad,
        VoxMat.LEAF_PINE,
        seed + t * 2.3
      );
    }
    // Conifer spire tip
    this.fillBoxW(tx, baseY + totalH - 1, tz, tx, baseY + totalH + 1, tz, VoxMat.LEAF_PINE);
  }

  /**
   * Sculpted Weeping Willow with curved trunk, lush multi-bough crown, and hanging voxel curtain tendrils.
   */
  public buildWeepingWillow(
    tx: number,
    baseY: number,
    tz: number,
    scale = 1.0,
    seed = 1
  ): void {
    const maxR = Math.ceil(9 * scale);
    if (
      tx + maxR < this.originX ||
      tx - maxR >= this.originX + this.sx ||
      tz + maxR < this.originZ ||
      tz - maxR >= this.originZ + this.sz
    ) {
      return;
    }

    const trunkH = Math.max(5, Math.round(7.5 * scale));
    for (let dy = -2; dy <= trunkH; dy++) {
      const lean = (dy / trunkH) * 1.2 * scale;
      const rad = dy <= 1 ? 1.6 * scale : 1.1 * scale;
      const ri = Math.ceil(rad);
      for (let ox = -ri; ox <= ri; ox++) {
        for (let oz = -ri; oz <= ri; oz++) {
          if (ox * ox + oz * oz <= rad * rad + 0.2) {
            this.setW(tx + lean + ox, baseY + dy, tz + oz, VoxMat.TRUNK);
          }
        }
      }
    }

    const crownY = baseY + trunkH + 1;
    const crownX = tx + 1.1 * scale;
    const lobes = [
      [0, 1.5, 0, 5.2, 2.8, 5.2],
      [-3.5, 0.2, 2.2, 3.6, 2.3, 3.6],
      [3.4, 0.4, -2.0, 3.6, 2.3, 3.6],
      [2.6, 0.2, 3.0, 3.4, 2.2, 3.4],
      [-2.8, 0.5, -2.8, 3.5, 2.3, 3.5],
    ];
    lobes.forEach(([ox, oy, oz, rx, ry, rz], i) => {
      this.fillEllipsoidW(
        crownX + ox * scale,
        crownY + oy * scale,
        tz + oz * scale,
        rx * scale,
        ry * scale,
        rz * scale,
        VoxMat.LEAF_WILLOW,
        seed + i * 1.9
      );
    });

    // Hanging weeping willow curtains around canopy perimeter
    const strands = 16;
    for (let i = 0; i < strands; i++) {
      const ang = (i / strands) * Math.PI * 2 + seed;
      const dist = (3.4 + hash3(i, seed, 7) * 2.2) * scale;
      const sx = Math.round(crownX + Math.cos(ang) * dist);
      const sz = Math.round(tz + Math.sin(ang) * dist);
      const drop = Math.round((4.5 + hash3(sx, 11, sz) * 3.5) * scale);
      for (let dy = 0; dy < drop; dy++) {
        const py = crownY - dy;
        if (py > baseY + 1) {
          this.setW(sx, py, sz, VoxMat.LEAF_WILLOW);
        }
      }
    }
  }

  /**
   * True Pagoda-Grade Sweeping Chinese Upturned Roof (ported directly from google_ai_studio_pagoda.html):
   * Ribbed glazed tiles, visible light-wood rafters underneath, raised hip ridges,
   * dramatically upturned golden corner tips (飞檐翘角), hanging golden wind bells, and ridge finials (鸱吻)!
   */
  public buildSongRoof(
    cx: number,
    yEave: number,
    cz: number,
    rxOuter: number,
    rzOuter: number,
    roofHeight: number,
    lift: number,
    tileMat: VoxMat = VoxMat.JADE_TILE,
    ridgeMat: VoxMat = VoxMat.SLATE,
    innerRx = 0,
    innerRz = 0,
    withBells = true
  ): void {
    const yPeak = yEave + roofHeight;
    for (let dz = -rzOuter; dz <= rzOuter; dz++) {
      for (let dx = -rxOuter; dx <= rxOuter; dx++) {
        const ax = Math.abs(dx);
        const az = Math.abs(dz);
        if (innerRx > 0 && innerRz > 0 && ax < innerRx - 1 && az < innerRz - 1) continue;

        const tx = rxOuter > innerRx ? clamp((ax - innerRx) / (rxOuter - innerRx), 0, 1) : 0;
        const tz = rzOuter > innerRz ? clamp((az - innerRz) / (rzOuter - innerRz), 0, 1) : 0;
        const t = Math.max(tx, tz);
        const minT = Math.min(ax / Math.max(1, rxOuter), az / Math.max(1, rzOuter));
        const maxT = Math.max(ax / Math.max(1, rxOuter), az / Math.max(1, rzOuter));
        const hip = maxT > 0 ? minT / maxT : 0;
        const curve = Math.pow(hip, 2.2) * Math.pow(clamp((t - 0.30) / 0.70, 0, 1), 1.6);
        const ry = Math.round(yPeak - (yPeak - yEave) * Math.pow(t, 0.74) + curve * lift);

        const isEdge = ax === rxOuter || az === rzOuter;
        const isTip = ax === rxOuter && az === rzOuter;
        const isHip = Math.abs(ax / Math.max(1, rxOuter) - az / Math.max(1, rzOuter)) < 0.085 && t > 0.15;
        const isRib = Math.abs(ax > az ? dz : dx) % 2 === 0;

        // Visible wooden rafters tucked under the overhanging eaves
        if (t > 0.25 && !isEdge) {
          this.setW(cx + dx, ry - 1, cz + dz, isRib ? VoxMat.LIGHT_WOOD : VoxMat.TRUNK);
        }

        let mat = tileMat;
        if (isEdge && isRib) mat = VoxMat.PLASTER; // White Song tile end-caps (瓦当)
        if (isTip) mat = VoxMat.GOLD;
        this.setW(cx + dx, ry, cz + dz, mat);

        // Raised hip ridge & golden upturned tip + hanging wind bell
        if (isHip) {
          this.setW(cx + dx, ry + 1, cz + dz, isTip ? VoxMat.GOLD : ridgeMat);
          if (isTip) {
            this.setW(cx + dx, ry + 2, cz + dz, VoxMat.GOLD);
            if (withBells) {
              this.setW(cx + dx, ry - 1, cz + dz, VoxMat.TRUNK);
              this.setW(cx + dx, ry - 2, cz + dz, VoxMat.GOLD);
            }
          }
        }
      }
    }

    // Central roof ridge & dragon-tail chiwen finials (鸱吻) for rectangular roofs
    if (innerRx === 0 && innerRz === 0) {
      if (rxOuter >= rzOuter) {
        const ridgeR = Math.max(1, rxOuter - rzOuter + 1);
        for (let dx = -ridgeR; dx <= ridgeR; dx++) {
          this.setW(cx + dx, yPeak + 1, cz, VoxMat.GOLD);
        }
        this.setW(cx - ridgeR, yPeak + 2, cz, VoxMat.GOLD);
        this.setW(cx + ridgeR, yPeak + 2, cz, VoxMat.GOLD);
        this.setW(cx, yPeak + 2, cz, VoxMat.GOLD);
      } else {
        const ridgeR = Math.max(1, rzOuter - rxOuter + 1);
        for (let dz = -ridgeR; dz <= ridgeR; dz++) {
          this.setW(cx, yPeak + 1, cz + dz, VoxMat.GOLD);
        }
        this.setW(cx, yPeak + 2, cz - ridgeR, VoxMat.GOLD);
        this.setW(cx, yPeak + 2, cz + ridgeR, VoxMat.GOLD);
      }
    }
  }

  /**
   * Song Dynasty Bracket Complex (斗拱) stepping outward in vermilion & gold beneath eaves.
   */
  public buildDougong(
    cx: number,
    yTop: number,
    cz: number,
    rx: number,
    rz: number
  ): void {
    for (let b = 1; b <= 2; b++) {
      const brx = rx + b;
      const brz = rz + b;
      const by = yTop - 1 + b;
      for (let dz = -brz; dz <= brz; dz++) {
        for (let dx = -brx; dx <= brx; dx++) {
          const onEdge = Math.abs(dx) === brx || Math.abs(dz) === brz;
          if (!onEdge) continue;
          const isCorner = Math.abs(dx) === brx && Math.abs(dz) === brz;
          if (isCorner || (Math.abs(dx) + Math.abs(dz)) % 2 === 0) {
            this.setW(cx + dx, by, cz + dz, b === 2 ? VoxMat.GOLD : VoxMat.VERMILION);
          }
        }
      }
    }
  }

  /**
   * True Multi-Story Song/Tang Voxel Pagoda (directly honoring google_ai_studio_pagoda.html):
   * Stone plinth, carved steps, tiered balconies with vermilion railings & gold finials,
   * glowing lattice shoji windows, dougong brackets, upturned jade roofs, and golden Sōrin spire!
   */
  public buildGrandPagoda(
    cx: number,
    baseY: number,
    cz: number,
    storiesCount = 4
  ): void {
    // 1. Stone Plinth & South Steps
    for (let y = baseY; y <= baseY + 2; y++) {
      const r = y === baseY ? 10 : 9;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const edge = Math.abs(dx) === r || Math.abs(dz) === r;
          this.setW(
            cx + dx,
            y,
            cz + dz,
            edge ? VoxMat.SLATE : y === baseY + 2 ? VoxMat.ROAD : VoxMat.STONE
          );
        }
      }
    }
    for (let s = 0; s < 3; s++) {
      const sy = baseY + s;
      const sz = cz + 12 - s;
      this.fillBoxW(cx - 3, baseY, sz, cx + 3, sy, sz, VoxMat.STONE);
      this.setW(cx - 4, sy, sz, VoxMat.SLATE);
      this.setW(cx + 4, sy, sz, VoxMat.SLATE);
    }

    // 2. Stories
    let curY = baseY + 3;
    const baseCore = 6;
    for (let idx = 0; idx < storiesCount; idx++) {
      const coreR = Math.max(3, baseCore - idx);
      const balcR = coreR + 2;
      const wallH = idx === 0 ? 7 : 6;
      const roofR = coreR + 6 - Math.min(2, idx);
      const roofH = idx === storiesCount - 1 ? 6 : 4;
      const lift = 3.2 - idx * 0.25;
      const yTop = curY + wallH;

      // Balcony deck & vermilion railings
      for (let dz = -balcR; dz <= balcR; dz++) {
        for (let dx = -balcR; dx <= balcR; dx++) {
          const ax = Math.abs(dx);
          const az = Math.abs(dz);
          const m = Math.max(ax, az);
          const outer = m === balcR;
          this.setW(cx + dx, curY, cz + dz, outer ? VoxMat.VERMILION : VoxMat.TIMBER);
          if (outer && !(idx === 0 && dz === balcR && ax <= 2)) {
            const post =
              (ax === balcR && az === balcR) ||
              (ax === balcR && az % 3 === 0) ||
              (az === balcR && ax % 3 === 0);
            if (post) {
              this.setW(cx + dx, curY + 1, cz + dz, VoxMat.VERMILION);
              this.setW(cx + dx, curY + 2, cz + dz, VoxMat.VERMILION);
              if (ax === balcR && az === balcR) {
                this.setW(cx + dx, curY + 3, cz + dz, VoxMat.GOLD);
              }
            } else {
              this.setW(cx + dx, curY + 2, cz + dz, VoxMat.VERMILION);
              if ((dx + dz) % 2 === 0) {
                this.setW(cx + dx, curY + 1, cz + dz, VoxMat.TRUNK);
              }
            }
          }
        }
      }

      // Walls, Vermilion Pillars, Plaster & Glowing Shoji Windows
      for (let y = curY + 1; y <= yTop; y++) {
        const rel = y - curY;
        for (let dz = -coreR; dz <= coreR; dz++) {
          for (let dx = -coreR; dx <= coreR; dx++) {
            const ax = Math.abs(dx);
            const az = Math.abs(dz);
            const m = Math.max(ax, az);
            if (m !== coreR) continue;
            const along = ax === coreR ? az : ax;
            const winW = Math.max(1, Math.floor(coreR * 0.45));
            const door = idx === 0 && dz === coreR && ax <= 2 && rel <= 5;
            if (ax === coreR && az === coreR) {
              this.setW(cx + dx, y, cz + dz, VoxMat.VERMILION);
            } else if (door) {
              if (ax === 2 || rel === 5) this.setW(cx + dx, y, cz + dz, VoxMat.TRUNK);
              else if (ax === 0 && rel === 3) this.setW(cx + dx, y, cz + dz, VoxMat.GOLD);
              else this.setW(cx + dx, y, cz + dz, VoxMat.GLOW_WARM);
            } else if (along <= winW && rel >= 2 && rel <= wallH - 2) {
              const mull = along === winW && coreR >= 5;
              this.setW(cx + dx, y, cz + dz, mull ? VoxMat.TRUNK : VoxMat.GLOW_WARM);
            } else if (rel === 1 || rel >= wallH - 1) {
              this.setW(cx + dx, y, cz + dz, VoxMat.VERMILION);
            } else {
              this.setW(cx + dx, y, cz + dz, VoxMat.PLASTER);
            }
          }
        }
      }

      // Dougong brackets & sweeping jade roof
      this.buildDougong(cx, yTop, cz, coreR, coreR);
      const isTop = idx === storiesCount - 1;
      const nextCore = isTop ? 0 : Math.max(3, baseCore - (idx + 1));
      this.buildSongRoof(
        cx,
        yTop,
        cz,
        roofR,
        roofR,
        roofH,
        lift,
        VoxMat.JADE_TILE,
        VoxMat.SLATE,
        nextCore,
        nextCore,
        true
      );
      curY = yTop + roofH - 1;
    }

    // 3. Golden Spire (相轮 / Sōrin)
    const sb = curY + 2;
    this.fillBoxW(cx - 2, sb, cz - 2, cx + 2, sb, cz + 2, VoxMat.SLATE);
    this.fillBoxW(cx - 1, sb + 1, cz - 1, cx + 1, sb + 1, cz + 1, VoxMat.GOLD);
    for (let y = sb + 2; y <= sb + 11; y++) {
      this.setW(cx, y, cz, VoxMat.GOLD);
      const k = y - (sb + 2);
      if (k === 1 || k === 3 || k === 5 || k === 7) {
        this.setW(cx - 1, y, cz, VoxMat.GOLD);
        this.setW(cx + 1, y, cz, VoxMat.GOLD);
        this.setW(cx, y, cz - 1, VoxMat.GOLD);
        this.setW(cx, y, cz + 1, VoxMat.GOLD);
      }
    }
    this.setW(cx, sb + 12, cz, VoxMat.GLOW_WARM);
  }

  /**
   * Song Dynasty Timber-Frame Shop / House / Pavilion with stone plinth, plaster walls,
   * dark cedar frame, recessed glowing shoji windows, optional upper story balcony,
   * and sweeping upturned Chinese roof!
   */
  public buildSongBuilding(
    cx: number,
    baseY: number,
    cz: number,
    halfW: number,
    halfD: number,
    stories: 1 | 2 | 3,
    roofMat: VoxMat = VoxMat.JADE_TILE,
    wallStyle: 'plaster' | 'vermilion' = 'plaster',
    doorSide: 'south' | 'east' | 'west' | 'north' = 'south'
  ): void {
    // Stone plinth
    this.fillBoxW(cx - halfW - 1, baseY - 2, cz - halfD - 1, cx + halfW + 1, baseY, cz + halfD + 1, VoxMat.STONE);

    let curY = baseY + 1;
    const storyH = 6;
    for (let s = 0; s < stories; s++) {
      const sw = Math.max(3, halfW - (s === 2 ? 1 : 0));
      const sd = Math.max(3, halfD - (s === 2 ? 1 : 0));
      const yTop = curY + storyH;

      // Upper story wrap-around wooden balcony & red balustrade
      if (s > 0) {
        const bw = sw + 2;
        const bd = sd + 2;
        for (let dz = -bd; dz <= bd; dz++) {
          for (let dx = -bw; dx <= bw; dx++) {
            const onEdge = Math.abs(dx) === bw || Math.abs(dz) === bd;
            if (!onEdge && Math.abs(dx) < sw && Math.abs(dz) < sd) continue;
            this.setW(cx + dx, curY, cz + dz, onEdge ? VoxMat.VERMILION : VoxMat.TIMBER);
            if (onEdge) {
              const isPost =
                (Math.abs(dx) === bw && Math.abs(dz) === bd) ||
                (Math.abs(dx) === bw && Math.abs(dz) % 3 === 0) ||
                (Math.abs(dz) === bd && Math.abs(dx) % 3 === 0);
              this.setW(cx + dx, curY + 1, cz + dz, isPost ? VoxMat.VERMILION : VoxMat.TRUNK);
              this.setW(cx + dx, curY + 2, cz + dz, VoxMat.VERMILION);
              if (Math.abs(dx) === bw && Math.abs(dz) === bd) {
                this.setW(cx + dx, curY + 3, cz + dz, VoxMat.GOLD);
              }
            }
          }
        }
      }

      // Hollow walls with corner pillars, cross-beams & glowing lattice windows
      for (let y = curY; y <= yTop; y++) {
        const rel = y - curY;
        for (let dz = -sd; dz <= sd; dz++) {
          for (let dx = -sw; dx <= sw; dx++) {
            const ax = Math.abs(dx);
            const az = Math.abs(dz);
            const onWall = ax === sw || az === sd;
            if (!onWall) continue;

            const isCorner = ax === sw && az === sd;
            const isDoorFace =
              s === 0 &&
              ((doorSide === 'south' && dz === sd && ax <= 2) ||
                (doorSide === 'north' && dz === -sd && ax <= 2) ||
                (doorSide === 'east' && dx === sw && az <= 2) ||
                (doorSide === 'west' && dx === -sw && az <= 2));

            if (isCorner) {
              this.setW(cx + dx, y, cz + dz, wallStyle === 'vermilion' ? VoxMat.VERMILION : VoxMat.TRUNK);
            } else if (isDoorFace && rel <= 4) {
              if (rel === 4) this.setW(cx + dx, y, cz + dz, VoxMat.TRUNK);
              else if ((doorSide === 'south' || doorSide === 'north' ? ax : az) === 2) {
                this.setW(cx + dx, y, cz + dz, VoxMat.VERMILION);
              } else {
                // Recessed warm glowing interior doorway
                this.setW(cx + dx, y, cz + dz, VoxMat.EMPTY);
                const ix = doorSide === 'east' ? dx - 1 : doorSide === 'west' ? dx + 1 : dx;
                const iz = doorSide === 'south' ? dz - 1 : doorSide === 'north' ? dz + 1 : dz;
                this.setW(cx + ix, y, cz + iz, rel >= 1 && rel <= 3 ? VoxMat.GLOW_WARM : VoxMat.TIMBER);
              }
            } else if (rel === 0 || rel === storyH) {
              this.setW(cx + dx, y, cz + dz, wallStyle === 'vermilion' ? VoxMat.VERMILION : VoxMat.TRUNK);
            } else if (rel >= 2 && rel <= 4) {
              const along = ax === sw ? az : ax;
              const span = ax === sw ? sd : sw;
              if (along < span - 1 && along % 4 !== 0) {
                this.setW(cx + dx, y, cz + dz, VoxMat.GLOW_WARM);
              } else if (along % 4 === 0) {
                this.setW(cx + dx, y, cz + dz, VoxMat.TRUNK);
              } else {
                this.setW(cx + dx, y, cz + dz, wallStyle === 'vermilion' ? VoxMat.VERMILION : VoxMat.PLASTER);
              }
            } else {
              this.setW(cx + dx, y, cz + dz, wallStyle === 'vermilion' ? VoxMat.VERMILION : VoxMat.PLASTER);
            }
          }
        }
      }

      // Intermediate skirt eave between stories
      if (s < stories - 1) {
        this.buildSongRoof(
          cx,
          yTop,
          cz,
          sw + 3,
          sd + 3,
          2,
          1.8,
          roofMat,
          VoxMat.SLATE,
          sw,
          sd,
          false
        );
        curY = yTop + 1;
      } else {
        // Crown dougong & grand sweeping top roof
        this.buildDougong(cx, yTop, cz, sw, sd);
        this.buildSongRoof(
          cx,
          yTop + 1,
          cz,
          sw + 4,
          sd + 4,
          Math.max(4, Math.min(7, Math.min(sw, sd))),
          2.8,
          roofMat,
          VoxMat.SLATE,
          0,
          0,
          true
        );
      }
    }

    // Hanging entrance red lanterns flanking the doorway
    const lx1 = doorSide === 'east' ? cx + halfW + 1 : doorSide === 'west' ? cx - halfW - 1 : cx - 3;
    const lx2 = doorSide === 'east' ? cx + halfW + 1 : doorSide === 'west' ? cx - halfW - 1 : cx + 3;
    const lz1 = doorSide === 'south' ? cz + halfD + 1 : doorSide === 'north' ? cz - halfD - 1 : cz - 3;
    const lz2 = doorSide === 'south' ? cz + halfD + 1 : doorSide === 'north' ? cz - halfD - 1 : cz + 3;
    this.setW(lx1, baseY + 5, lz1, VoxMat.GLOW_LANTERN);
    this.setW(lx2, baseY + 5, lz2, VoxMat.GLOW_LANTERN);
  }

  /**
   * Ceremonial 4-Pillar Song Dynasty Paifang Archway (牌坊) with stone bases,
   * golden plaque, dougong brackets, and tiered sweeping roofs.
   */
  public buildPaifang(
    cx: number,
    baseY: number,
    cz: number,
    span = 7,
    roofMat: VoxMat = VoxMat.JADE_TILE
  ): void {
    const h = 11;
    const posts = [-span, -Math.round(span * 0.48), Math.round(span * 0.48), span];
    for (const ox of posts) {
      const px = cx + ox;
      const ph = Math.abs(ox) === span ? h - 2 : h;
      this.fillBoxW(px - 1, baseY - 2, cz - 1, px + 1, baseY + 1, cz + 1, VoxMat.STONE);
      this.fillBoxW(px, baseY + 2, cz, px, baseY + ph, cz, VoxMat.VERMILION);
      this.fillBoxW(px, baseY + 2, cz + 1, px, baseY + ph, cz + 1, VoxMat.VERMILION);
    }
    // Cross beams
    this.fillBoxW(cx - span - 1, baseY + h - 3, cz, cx + span + 1, baseY + h - 3, cz + 1, VoxMat.VERMILION);
    this.fillBoxW(cx - Math.round(span * 0.48) - 1, baseY + h - 1, cz, cx + Math.round(span * 0.48) + 1, baseY + h, cz + 1, VoxMat.VERMILION);
    // Golden imperial plaque in center
    this.fillBoxW(cx - 2, baseY + h - 2, cz - 1, cx + 2, baseY + h - 1, cz + 2, VoxMat.TRUNK);
    this.fillBoxW(cx - 1, baseY + h - 2, cz + 2, cx + 1, baseY + h - 1, cz + 2, VoxMat.GOLD);
    this.fillBoxW(cx - 1, baseY + h - 2, cz - 1, cx + 1, baseY + h - 1, cz - 1, VoxMat.GOLD);
    // Center high upturned roof + flanking side roofs
    const midHalf = Math.round(span * 0.48) + 2;
    this.buildSongRoof(cx, baseY + h + 1, cz, midHalf, 3, 3, 2.2, roofMat, VoxMat.SLATE, 0, 0, true);
    this.buildSongRoof(cx - Math.round(span * 0.78), baseY + h - 1, cz, 3, 2, 2, 1.4, roofMat, VoxMat.SLATE, 0, 0, false);
    this.buildSongRoof(cx + Math.round(span * 0.78), baseY + h - 1, cz, 3, 2, 2, 1.4, roofMat, VoxMat.SLATE, 0, 0, false);
    // Hanging palace lanterns
    this.setW(cx - Math.round(span * 0.48) + 1, baseY + h - 4, cz + 1, VoxMat.GLOW_LANTERN);
    this.setW(cx + Math.round(span * 0.48) - 1, baseY + h - 4, cz + 1, VoxMat.GLOW_LANTERN);
  }

  /**
   * Arched Voxel Bridge spanning along Z (from z0 to z1) with vermilion or white-stone railings,
   * golden lotus finials, and glowing bridge lanterns (honoring pagoda.html's Drum Bridge).
   */
  public buildArchedBridgeZ(
    cx: number,
    z0: number,
    z1: number,
    halfW: number,
    baseY: number,
    archLift: number,
    style: 'vermilion' | 'stone' = 'vermilion'
  ): void {
    const zm = (z0 + z1) * 0.5;
    const halfLen = Math.max(1, (z1 - z0) * 0.5);
    const edgeMat = style === 'vermilion' ? VoxMat.VERMILION : VoxMat.PLASTER;
    const deckMat = style === 'vermilion' ? VoxMat.TIMBER : VoxMat.ROAD;
    const railMat = style === 'vermilion' ? VoxMat.VERMILION : VoxMat.STONE;

    for (let z = z0; z <= z1; z++) {
      const t = (z - zm) / halfLen;
      const ay = Math.round(baseY + Math.cos(t * Math.PI * 0.5) * archLift);
      for (let dx = -halfW; dx <= halfW; dx++) {
        const edge = Math.abs(dx) === halfW;
        this.setW(cx + dx, ay, z, edge ? edgeMat : z % 2 === 0 ? deckMat : VoxMat.STONE);
        this.setW(cx + dx, ay - 1, z, edge ? VoxMat.TRUNK : VoxMat.SLATE);
        // Clear headroom above bridge
        for (let cy = ay + 1; cy <= ay + 7; cy++) {
          this.setW(cx + dx, cy, z, VoxMat.EMPTY);
        }
      }

      // Railings, posts, lotus gold finials & glowing lanterns
      const isPost = z === z0 || z === z1 || Math.abs(z - Math.round(zm)) % 4 === 0;
      for (const s of [-halfW, halfW]) {
        this.setW(cx + s, ay + 2, z, railMat);
        if (isPost || z % 2 === 0) {
          this.setW(cx + s, ay + 1, z, railMat);
        }
        if (isPost) {
          this.setW(cx + s, ay + 3, z, VoxMat.GOLD);
          if (z === z0 || z === z1 || Math.abs(z - Math.round(zm)) <= 1) {
            this.setW(cx + s, ay + 4, z, VoxMat.GLOW_LANTERN);
          }
        }
      }

      // Stone bridge piers descending into riverbed
      if (Math.abs(z - Math.round(zm)) === Math.round(halfLen * 0.55)) {
        for (const s of [-halfW + 1, halfW - 1]) {
          for (let y = baseY - 5; y < ay - 1; y++) {
            this.setW(cx + s, y, z, VoxMat.SLATE);
          }
        }
      }
      if (z === z0 || z === z1) {
        for (let dx = -halfW - 1; dx <= halfW + 1; dx++) {
          for (let y = baseY - 4; y < ay; y++) {
            this.setW(cx + dx, y, z, VoxMat.STONE);
          }
        }
      }
    }
  }

  /** Roadside octagonal/square Song pavilion (十里长亭 / 半山亭) */
  public buildPavilion(
    cx: number,
    baseY: number,
    cz: number,
    radius = 4,
    roofMat: VoxMat = VoxMat.JADE_TILE
  ): void {
    // Stone base
    this.fillBoxW(cx - radius, baseY - 3, cz - radius, cx + radius, baseY, cz + radius, VoxMat.STONE);
    this.fillBoxW(cx - radius + 1, baseY, cz - radius + 1, cx + radius - 1, baseY, cz + radius - 1, VoxMat.ROAD);
    // 4 vermilion corner pillars
    const pOff = radius - 1;
    const h = 6;
    for (const sx of [-pOff, pOff]) {
      for (const sz of [-pOff, pOff]) {
        this.fillBoxW(cx + sx, baseY + 1, cz + sz, cx + sx, baseY + h, cz + sz, VoxMat.VERMILION);
      }
    }
    // Benches along back & side edges
    for (let dx = -pOff + 1; dx <= pOff - 1; dx++) {
      this.setW(cx + dx, baseY + 1, cz - pOff, VoxMat.TIMBER);
    }
    // Hanging center lantern
    this.setW(cx, baseY + h, cz, VoxMat.TRUNK);
    this.setW(cx, baseY + h - 1, cz, VoxMat.GLOW_LANTERN);
    // Sweeping upturned roof
    this.buildDougong(cx, baseY + h, cz, pOff, pOff);
    this.buildSongRoof(cx, baseY + h + 1, cz, radius + 3, radius + 3, 4, 2.5, roofMat, VoxMat.SLATE, 0, 0, true);
    this.setW(cx, baseY + h + 6, cz, VoxMat.GOLD);
  }

  /** Glowing stone or wooden street lantern post */
  public buildLanternPost(
    x: number,
    baseY: number,
    z: number,
    height = 5,
    style: 'street' | 'stone' = 'street'
  ): void {
    if (style === 'stone') {
      this.setW(x, baseY, z, VoxMat.SLATE);
      this.fillBoxW(x, baseY + 1, z, x, baseY + 2, z, VoxMat.STONE);
      this.setW(x, baseY + 3, z, VoxMat.GLOW_WARM);
      this.fillBoxW(x - 1, baseY + 4, z - 1, x + 1, baseY + 4, z + 1, VoxMat.SLATE);
      this.setW(x, baseY + 5, z, VoxMat.GOLD);
    } else {
      this.fillBoxW(x, baseY, z, x, baseY + height, z, VoxMat.TRUNK);
      this.setW(x + 1, baseY + height, z, VoxMat.TRUNK);
      this.setW(x + 1, baseY + height - 1, z, VoxMat.GLOW_LANTERN);
      this.setW(x + 1, baseY + height - 2, z, VoxMat.GOLD);
    }
  }

  /** Song street wine/tea pennant banner pole (酒旗) */
  public buildBannerPole(
    x: number,
    baseY: number,
    z: number,
    height = 9,
    flagMat: VoxMat = VoxMat.BANNER_RED
  ): void {
    this.fillBoxW(x, baseY, z, x, baseY + height, z, VoxMat.TRUNK);
    this.fillBoxW(x + 1, baseY + height, z, x + 3, baseY + height, z, VoxMat.TRUNK);
    this.fillBoxW(x + 1, baseY + height - 3, z, x + 2, baseY + height - 1, z, flagMat);
    this.setW(x + 2, baseY + height - 2, z, VoxMat.BANNER_GOLD);
  }

  /** Bustling Song Market Stall with striped awning, goods counter & warm lantern */
  public buildMarketStall(
    cx: number,
    baseY: number,
    cz: number,
    awningMat: VoxMat = VoxMat.BANNER_RED,
    facing: 'east' | 'west' | 'south' = 'east'
  ): void {
    // Counter
    this.fillBoxW(cx - 2, baseY + 1, cz - 2, cx + 2, baseY + 2, cz + 2, VoxMat.TIMBER);
    // Goods (porcelain / silk / fruit)
    this.setW(cx - 1, baseY + 3, cz, VoxMat.PLASTER);
    this.setW(cx + 1, baseY + 3, cz, VoxMat.BANNER_GOLD);
    this.setW(cx, baseY + 3, cz + (facing === 'south' ? 1 : 0), VoxMat.LEAF_AUTUMN);
    // 4 posts
    for (const ox of [-2, 2]) {
      for (const oz of [-2, 2]) {
        this.fillBoxW(cx + ox, baseY + 1, cz + oz, cx + ox, baseY + 5, cz + oz, VoxMat.TRUNK);
      }
    }
    // Sloped striped canopy
    for (let ox = -3; ox <= 3; ox++) {
      for (let oz = -3; oz <= 3; oz++) {
        const stripe = ((facing === 'south' ? ox : oz) & 1) === 0;
        const slope =
          facing === 'east'
            ? ox > 0 ? 0 : 1
            : facing === 'west'
              ? ox < 0 ? 0 : 1
              : oz > 0 ? 0 : 1;
        this.setW(cx + ox, baseY + 5 + slope, cz + oz, stripe ? awningMat : VoxMat.PLASTER);
      }
    }
    this.setW(cx, baseY + 4, cz + (facing === 'south' ? 2 : 0), VoxMat.GLOW_LANTERN);
  }

  /** Docked Song Canal Boat (乌篷船) floating on water */
  public buildCanalBoat(cx: number, waterY: number, cz: number, lengthAxis: 'x' | 'z' = 'x'): void {
    for (let t = -4; t <= 4; t++) {
      const w = Math.abs(t) >= 3 ? 0 : 1;
      for (let s = -w; s <= w; s++) {
        const bx = lengthAxis === 'x' ? cx + t : cx + s;
        const bz = lengthAxis === 'x' ? cz + s : cz + t;
        this.setW(bx, waterY, bz, VoxMat.TRUNK);
        if (Math.abs(t) <= 3 && Math.abs(s) === w) {
          this.setW(bx, waterY + 1, bz, VoxMat.TIMBER);
        }
        // Woven awning roof in middle
        if (Math.abs(t) <= 1) {
          this.setW(bx, waterY + 2 + (s === 0 ? 1 : 0), bz, VoxMat.SLATE);
        }
      }
    }
    // Bow lantern
    const lx = lengthAxis === 'x' ? cx + 4 : cx;
    const lz = lengthAxis === 'x' ? cz : cz + 4;
    this.setW(lx, waterY + 2, lz, VoxMat.GLOW_LANTERN);
  }

  /** Check solid helper for external mesher */
  public isSolidLocal(lx: number, ly: number, lz: number): boolean {
    return isSolidVoxel(this.getLocal(lx, ly, lz));
  }
}
