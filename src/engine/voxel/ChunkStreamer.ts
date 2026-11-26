import * as THREE from 'three';
import { VoxelGrid } from './VoxelGrid';
import { bakeSeedWorldMesh } from './SeedWorldMesher';
import {
  SeedWorldUniforms,
  createSeedWorldVoxelMaterial,
  createSeedWorldWaterMaterial,
} from './SeedWorldShaders';

export type ChunkPopulateFn = (grid: VoxelGrid) => void;

interface LoadedChunk {
  cx: number;
  cz: number;
  quality: 'full' | 'lod';
  group: THREE.Group;
  bleedTex: THREE.Data3DTexture | null;
}

/**
 * Dynamic Chunk Streamer modeled on SeedWorld's WorldPartition.cc:
 * - Divides massive open regions (288x288+) into 32xH x 32 voxel chunks with 2-voxel seamless halos.
 * - Immediately builds the inner spawn neighborhood so Frame 0 is solid and dramatic.
 * - Streams outer chunks in distance + forward-direction priority order (1-2 chunks/frame)
 *   and evicts chunks far behind the player to keep GPU memory & frame times rock-steady.
 */
export class ChunkStreamer {
  public readonly root = new THREE.Group();
  public readonly chunkSize: number;
  public readonly chunkHeight: number;
  public readonly halo: number;
  public readonly activeRadius: number;
  public readonly fullQualityRadius: number;

  private populate: ChunkPopulateFn;
  private sharedUniforms: SeedWorldUniforms;
  private sharedWaterMat: THREE.ShaderMaterial;
  private sharedLodMat: THREE.ShaderMaterial;
  private chunks = new Map<string, LoadedChunk>();
  private focusCx = 0;
  private focusCz = 0;
  private minChunk: number;
  private maxChunk: number;

  constructor(
    populate: ChunkPopulateFn,
    sharedUniforms: SeedWorldUniforms,
    options?: {
      chunkSize?: number;
      chunkHeight?: number;
      halo?: number;
      activeRadius?: number;
      fullQualityRadius?: number;
      minChunk?: number;
      maxChunk?: number;
    }
  ) {
    this.populate = populate;
    this.sharedUniforms = sharedUniforms;
    this.chunkSize = options?.chunkSize ?? 32;
    this.chunkHeight = options?.chunkHeight ?? 78;
    this.halo = options?.halo ?? 2;
    this.activeRadius = options?.activeRadius ?? 4;
    this.fullQualityRadius = options?.fullQualityRadius ?? 2;
    this.minChunk = options?.minChunk ?? -5;
    this.maxChunk = options?.maxChunk ?? 5;
    this.sharedWaterMat = createSeedWorldWaterMaterial(sharedUniforms);
    this.sharedLodMat = createSeedWorldVoxelMaterial(sharedUniforms);
  }

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  private worldToChunk(v: number): number {
    return Math.floor((v + this.chunkSize * 0.5) / this.chunkSize);
  }

  /**
   * Synchronously builds the immediate chunks around spawn (inner 3x3 + forward vista chunks)
   * so the very first rendered frame already displays towering peaks, bridges, and trees.
   */
  public primeAround(worldX: number, worldZ: number, forwardX = 0, forwardZ = -1): void {
    this.focusCx = this.worldToChunk(worldX);
    this.focusCz = this.worldToChunk(worldZ);

    const priority: Array<{ cx: number; cz: number; score: number; quality: 'full' | 'lod' }> = [];
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = this.focusCx + dx;
        const cz = this.focusCz + dz;
        if (cx < this.minChunk || cx > this.maxChunk || cz < this.minChunk || cz > this.maxChunk) {
          continue;
        }
        const cheb = Math.max(Math.abs(dx), Math.abs(dz));
        const dot = dx * forwardX + dz * forwardZ;
        // Build inner 3x3 at full quality, plus forward vista chunks at fast LOD immediately
        if (cheb <= 1 || dot >= 1.2) {
          priority.push({
            cx,
            cz,
            score: cheb * 2 - dot * 0.7,
            quality: cheb <= 1 ? 'full' : 'lod',
          });
        }
      }
    }
    priority.sort((a, b) => a.score - b.score);
    for (const item of priority) {
      this.buildChunk(item.cx, item.cz, item.quality);
    }
  }

  /**
   * Incremental per-frame streaming & eviction (modeled on WorldPartition::Update).
   */
  public update(
    worldX: number,
    worldZ: number,
    forwardX: number,
    forwardZ: number,
    maxBuildsPerFrame = 2
  ): void {
    this.focusCx = this.worldToChunk(worldX);
    this.focusCz = this.worldToChunk(worldZ);

    // 1. Evict chunks outside hysteresis window (activeRadius + 1)
    const evictKeys: string[] = [];
    for (const [k, chunk] of this.chunks.entries()) {
      const cheb = Math.max(Math.abs(chunk.cx - this.focusCx), Math.abs(chunk.cz - this.focusCz));
      if (cheb > this.activeRadius + 1) {
        evictKeys.push(k);
      }
    }
    for (const k of evictKeys) {
      this.removeChunk(k);
    }

    // 2. Gather missing chunks or LOD chunks needing upgrade to full quality
    const missing: Array<{ cx: number; cz: number; dist: number; ahead: number; want: 'full' | 'lod' }> = [];
    for (let dz = -this.activeRadius; dz <= this.activeRadius; dz++) {
      for (let dx = -this.activeRadius; dx <= this.activeRadius; dx++) {
        const cx = this.focusCx + dx;
        const cz = this.focusCz + dz;
        if (cx < this.minChunk || cx > this.maxChunk || cz < this.minChunk || cz > this.maxChunk) {
          continue;
        }
        const cheb = Math.max(Math.abs(dx), Math.abs(dz));
        const want: 'full' | 'lod' = cheb <= this.fullQualityRadius ? 'full' : 'lod';
        const existing = this.chunks.get(this.key(cx, cz));
        if (existing && (existing.quality === want || existing.quality === 'full')) {
          continue;
        }
        const len = Math.hypot(dx, dz);
        const ahead = len > 0.01 ? (dx * forwardX + dz * forwardZ) / len : 1.0;
        missing.push({ cx, cz, dist: Math.abs(dx) + Math.abs(dz), ahead, want });
      }
    }

    if (missing.length === 0) return;

    // Sort: missing chunks first, then nearest, then directly ahead of camera
    missing.sort((a, b) => {
      const aLoaded = this.chunks.has(this.key(a.cx, a.cz)) ? 1 : 0;
      const bLoaded = this.chunks.has(this.key(b.cx, b.cz)) ? 1 : 0;
      if (aLoaded !== bLoaded) return aLoaded - bLoaded;
      if (a.dist !== b.dist) return a.dist - b.dist;
      return b.ahead - a.ahead;
    });

    const budget = Math.min(maxBuildsPerFrame, missing.length);
    for (let i = 0; i < budget; i++) {
      const item = missing[i];
      this.buildChunk(item.cx, item.cz, item.want);
    }
  }

  private buildChunk(cx: number, cz: number, quality: 'full' | 'lod'): void {
    const k = this.key(cx, cz);
    const originX = Math.round(cx * this.chunkSize - this.chunkSize * 0.5) - this.halo;
    const originZ = Math.round(cz * this.chunkSize - this.chunkSize * 0.5) - this.halo;
    const span = this.chunkSize + this.halo * 2;

    const grid = new VoxelGrid(span, this.chunkHeight, span, originX, 0, originZ, 1.0);
    this.populate(grid);

    const baked = bakeSeedWorldMesh(grid, {
      halo: this.halo,
      fastLod: quality === 'lod',
      buildBleedVolume: quality === 'full',
    });

    // Replace previous version cleanly
    this.removeChunk(k);

    const group = new THREE.Group();
    group.name = `chunk_${cx}_${cz}_${quality}`;

    if (baked.geometry) {
      const mat =
        quality === 'full' && baked.bleedTex
          ? createSeedWorldVoxelMaterial(
              this.sharedUniforms,
              baked.bleedTex,
              baked.volMin,
              baked.volSize
            )
          : this.sharedLodMat;
      const mesh = new THREE.Mesh(baked.geometry, mat);
      mesh.frustumCulled = true;
      group.add(mesh);
    }

    if (baked.waterGeometry) {
      const wMesh = new THREE.Mesh(baked.waterGeometry, this.sharedWaterMat);
      wMesh.renderOrder = 2;
      group.add(wMesh);
    }

    this.root.add(group);
    this.chunks.set(k, { cx, cz, quality, group, bleedTex: baked.bleedTex });
  }

  private removeChunk(k: string): void {
    const old = this.chunks.get(k);
    if (!old) return;
    this.root.remove(old.group);
    old.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        if (obj.material !== this.sharedWaterMat && obj.material !== this.sharedLodMat) {
          (obj.material as THREE.Material)?.dispose();
        }
      }
    });
    old.bleedTex?.dispose();
    this.chunks.delete(k);
  }

  public getLoadedCount(): number {
    return this.chunks.size;
  }

  public dispose(): void {
    for (const k of Array.from(this.chunks.keys())) {
      this.removeChunk(k);
    }
    this.sharedWaterMat.dispose();
    this.sharedLodMat.dispose();
  }
}
