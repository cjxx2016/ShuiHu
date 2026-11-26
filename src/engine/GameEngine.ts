import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AREAS } from '../game/worldData';
import { clamp, getGroundHeight, isPointWalkable } from '../game/terrainMath';
import type {
  AreaId,
  CharacterIdentity,
  GameMode,
  MinimapSnapshot,
  NearbyInteraction,
  NpcDef,
  PropActionDef,
  QuestFlags,
  TimeOfDay,
} from '../types/world';
import { ChunkStreamer } from './voxel/ChunkStreamer';
import {
  SeedWorldUniforms,
  createSeedWorldSkyDome,
  createSeedWorldUniforms,
} from './voxel/SeedWorldShaders';
import {
  createDistantMountainRing,
  createWeizhouRegionPopulator,
  createWutaiRegionPopulator,
} from './builders/regionBuilders';
import {
  buildBianliangCity,
  buildWeizhouTown,
  buildWutaiTemple,
} from './builders/sceneBuilders';
import { buildTavernInterior, buildTempleInterior } from './builders/interiorBuilders';
import {
  ArticulatedCharacter,
  createNpcCharacter,
  createPlayerCharacter,
  updateCharacterAnim,
} from './characterMesh';
import { SoundEffects } from './audio';

interface LiveNpc {
  def: NpcDef;
  char: ArticulatedCharacter;
  patrolIndex: number;
  patrolForward: boolean;
}

interface BurstParticle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
}

export interface EngineCallbacks {
  onNearbyChange: (nearby: NearbyInteraction | null) => void;
  onAreaChanged: (areaId: AreaId, timeOfDay: TimeOfDay) => void;
  onInteractNpc: (npcId: string) => void;
  onTriggerProp: (prop: PropActionDef) => void;
  onMinimapUpdate: (snapshot: MinimapSnapshot) => void;
}

interface SeedTimePalette {
  topColor: number;
  midColor: number;
  horizonColor: number;
  groundBounce: number;
  fogColor: number;
  fogDensityRegion: number;
  fogDensityScene: number;
  sunColor: number;
  sunDir: [number, number, number];
  sunInt: number;
  sunGlowStr: number;
  glowBoost: number;
  hemiSky: number;
  hemiGnd: number;
  hemiInt: number;
  exposure: number;
}

const TIME_PALETTES: Record<TimeOfDay, SeedTimePalette> = {
  dawn: {
    topColor: 0x2f69b2,
    midColor: 0x8fbce6,
    horizonColor: 0xf7cfad,
    groundBounce: 0x5c5b46,
    fogColor: 0xe9ccb4,
    fogDensityRegion: 0.0029,
    fogDensityScene: 0.0024,
    sunColor: 0xffd59c,
    sunDir: [0.68, 0.44, 0.58],
    sunInt: 1.56,
    sunGlowStr: 0.42,
    glowBoost: 0.62,
    hemiSky: 0xcbe0f7,
    hemiGnd: 0x6f614d,
    hemiInt: 1.0,
    exposure: 1.06,
  },
  noon: {
    topColor: 0x1e66cc,
    midColor: 0x6ec2f6,
    horizonColor: 0xdceeff,
    groundBounce: 0x4b6b42,
    fogColor: 0xd0e6f8,
    fogDensityRegion: 0.0026,
    fogDensityScene: 0.0021,
    sunColor: 0xfff3d8,
    sunDir: [0.56, 0.68, 0.48],
    sunInt: 1.62,
    sunGlowStr: 0.28,
    glowBoost: 0.44,
    hemiSky: 0xd6eeff,
    hemiGnd: 0x657850,
    hemiInt: 1.08,
    exposure: 1.08,
  },
  sunset: {
    topColor: 0x2b3e73,
    midColor: 0xc47364,
    horizonColor: 0xf7b57c,
    groundBounce: 0x4d3f35,
    fogColor: 0xdca17c,
    fogDensityRegion: 0.0031,
    fogDensityScene: 0.0026,
    sunColor: 0xffaa5e,
    sunDir: [-0.74, 0.34, 0.58],
    sunInt: 1.58,
    sunGlowStr: 0.52,
    glowBoost: 0.92,
    hemiSky: 0xe3a88a,
    hemiGnd: 0x544439,
    hemiInt: 0.95,
    exposure: 1.05,
  },
  night: {
    topColor: 0x0b152a,
    midColor: 0x182b4d,
    horizonColor: 0x2a4066,
    groundBounce: 0x18202c,
    fogColor: 0x1b2944,
    fogDensityRegion: 0.0034,
    fogDensityScene: 0.0029,
    sunColor: 0x9ec4f8,
    sunDir: [-0.45, 0.72, -0.52],
    sunInt: 0.85,
    sunGlowStr: 0.2,
    glowBoost: 1.42,
    hemiSky: 0x4f6d99,
    hemiGnd: 0x202630,
    hemiInt: 0.78,
    exposure: 1.02,
  },
};

// Reusable scratch vectors (zero per-frame GC allocation)
const _vFwd = new THREE.Vector3();
const _vRight = new THREE.Vector3();
const _vMove = new THREE.Vector3();
const _vCamTarget = new THREE.Vector3();
const _vLookTarget = new THREE.Vector3();
const _mDummy = new THREE.Object3D();

export class GameEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private envMap: THREE.Texture | null = null;
  public sfx = new SoundEffects();

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private seedUniforms: SeedWorldUniforms;
  private skyMesh: THREE.Mesh;
  private timeUniform = { value: 0 };

  private worldGroup = new THREE.Group();
  private dynamicGroup = new THREE.Group();
  private chunkStreamer: ChunkStreamer | null = null;
  private activeBleedTextures: THREE.Data3DTexture[] = [];
  private portalBeacons: THREE.Mesh[] = [];
  private liveNpcs: LiveNpc[] = [];
  private willowGroup: THREE.Group | null = null;
  private guardianGroup: THREE.Group | null = null;

  private player: ArticulatedCharacter;
  private playerIdentity: CharacterIdentity = 'luda';
  private playerPos = new THREE.Vector3(4, 9, 46);
  private playerVelY = 0;
  private playerYaw = Math.PI;
  private onGround = true;
  private coyoteTimer = 0;
  private jumpBuffer = 0;
  private stepDistAccum = 0;
  private squashY = 1;

  // Camera orbit & follow state
  private camYaw = 0;
  private camPitch = 0.19;
  private camDist = 21.5;
  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private cameraTrauma = 0;
  private titleTourAngle = 0;

  // Simulation state
  private currentArea: AreaId = 'weizhou_region';
  private timeOfDay: TimeOfDay = 'noon';
  private gameMode: GameMode = 'title';
  private questFlags: QuestFlags;
  private hitstopTimer = 0;
  private willowUprootProgress = 0;
  private guardianShakeTimer = 0;

  // Pooled particle system (ambient + burst)
  private particleInst: THREE.InstancedMesh;
  private particles: BurstParticle[] = [];
  private ambientInst: THREE.InstancedMesh;
  private ambientOffsets: Array<{ x: number; y: number; z: number; sp: number; ph: number }> = [];

  // Input hub
  private keysHeld = new Set<string>();
  private nearby: NearbyInteraction | null = null;
  private hudEmitAccum = 0;
  private frameId = 0;
  private disposed = false;
  private lastTime = performance.now();
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    initialArea: AreaId,
    initialFlags: QuestFlags,
    callbacks: EngineCallbacks
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.questFlags = initialFlags;
    this.playerIdentity = initialFlags.tookTonsure ? 'luzhishen' : 'luda';

    // 1. Detect software WebGL cleanly from GPU renderer string
    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param) || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = false; // SeedWorld shaders compute baked SkyGI + 4-corner AO + 3D Bleed!
    container.appendChild(this.renderer.domElement);

    // 2. Scene, SeedWorld Uniforms, Atmospheric Sky Dome & Character Lighting
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd0e6f8, 0.0026);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(52, w / h, 0.4, 780);

    // Directional & Hemisphere lights illuminate articulated characters & particles in harmony with SeedWorld shaders
    this.hemiLight = new THREE.HemisphereLight(0xd6eeff, 0x657850, 1.08);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff3d8, 2.35);
    this.sunLight.position.set(70, 95, 60);
    this.scene.add(this.sunLight);

    // SeedWorld Shared Uniforms & 3-Band Atmospheric Sky Dome
    this.seedUniforms = createSeedWorldUniforms();
    this.skyMesh = createSeedWorldSkyDome(this.seedUniforms);
    this.scene.add(this.skyMesh);

    this.scene.add(this.worldGroup);
    this.scene.add(this.dynamicGroup);

    // 3. Player & Pooled Particles
    this.player = createPlayerCharacter(this.playerIdentity);
    this.scene.add(this.player.root);

    const burstCount = 64;
    this.particleInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.32, 0.32, 0.32),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      burstCount
    );
    this.particleInst.frustumCulled = false;
    for (let i = 0; i < burstCount; i++) {
      this.particles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        scale: 0,
        color: new THREE.Color(0xffd26b),
      });
      _mDummy.scale.setScalar(0);
      _mDummy.updateMatrix();
      this.particleInst.setMatrixAt(i, _mDummy.matrix);
      this.particleInst.setColorAt(i, new THREE.Color(0xffd26b));
    }
    this.scene.add(this.particleInst);

    const ambCount = 80;
    this.ambientInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.24, 0.14, 0.24),
      new THREE.MeshBasicMaterial({ color: 0xffe4b8, transparent: true, opacity: 0.78 }),
      ambCount
    );
    this.ambientInst.frustumCulled = false;
    for (let i = 0; i < ambCount; i++) {
      this.ambientOffsets.push({
        x: (Math.random() - 0.5) * 110,
        y: 3 + Math.random() * 28,
        z: (Math.random() - 0.5) * 110,
        sp: 0.6 + Math.random() * 1.0,
        ph: Math.random() * Math.PI * 2,
      });
    }
    this.scene.add(this.ambientInst);

    // 4. Bind Events & ResizeObserver
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    // 5. Load Initial Area & Start Loop
    this.loadArea(initialArea);
    this.lastTime = performance.now();
    this.tick();
  }

  private getAreaCameraDefaults(areaId: AreaId): { dist: number; pitch: number; lookY: number } {
    if (areaId === 'bianliang_city') return { dist: 28.5, pitch: 0.22, lookY: 11.2 };
    if (areaId === 'wutai_temple') return { dist: 27.0, pitch: 0.23, lookY: 9.8 };
    if (areaId === 'wutai_region') return { dist: 23.0, pitch: 0.16, lookY: 9.2 };
    if (areaId === 'weizhou_town') return { dist: 24.5, pitch: 0.22, lookY: 7.4 };
    if (areaId === 'temple_interior') return { dist: 12.6, pitch: 0.2, lookY: 4.9 };
    if (areaId === 'tavern_interior') return { dist: 11.8, pitch: 0.21, lookY: 4.1 };
    return { dist: 22.5, pitch: 0.18, lookY: 6.4 };
  }

  public setGameMode(mode: GameMode): void {
    this.gameMode = mode;
    if (mode !== 'playing') {
      this.keysHeld.clear();
      this.isDragging = false;
    } else {
      const def = this.getAreaCameraDefaults(this.currentArea);
      this.camYaw = this.playerYaw + Math.PI;
      this.camPitch = def.pitch;
      this.camDist = def.dist;
      this.snapCameraImmediate();
    }
  }

  public setQuestFlags(flags: QuestFlags): void {
    this.questFlags = flags;
    const nextId: CharacterIdentity = flags.tookTonsure ? 'luzhishen' : 'luda';
    if (nextId !== this.playerIdentity) {
      this.playerIdentity = nextId;
      this.rebuildPlayerMesh();
      this.spawnBurst(this.playerPos.x, this.playerPos.y + 1.4, this.playerPos.z, 24, 0xf2c95c);
      this.sfx.playTempleGong();
    }
    for (const npc of this.liveNpcs) {
      if (npc.def.id === 'zhengtu' && flags.defeatedZhengTu) {
        npc.char.knockedDown = true;
      }
    }
    if (flags.uprootedWillow && this.willowUprootProgress < 1) {
      this.willowUprootProgress = 1;
      this.applyWillowPose(1);
    }
  }

  public triggerDramaticAction(kind: 'punch' | 'wine' | 'tonsure' | 'willow' | 'gong'): void {
    if (kind === 'punch') {
      this.player.attackTimer = 0.36;
      this.hitstopTimer = 0.06;
      this.cameraTrauma = 0.65;
      this.sfx.playStrike();
      this.spawnBurst(this.playerPos.x, this.playerPos.y + 1.5, this.playerPos.z, 22, 0xff9b4a);
    } else if (kind === 'wine') {
      this.sfx.playWineDrink();
      this.spawnBurst(this.playerPos.x, this.playerPos.y + 1.6, this.playerPos.z, 16, 0xffbe55);
    } else if (kind === 'tonsure' || kind === 'gong') {
      this.sfx.playTempleGong();
      this.spawnBurst(this.playerPos.x, this.playerPos.y + 1.8, this.playerPos.z, 24, 0xf5d46e);
    } else if (kind === 'willow') {
      this.player.attackTimer = 0.36;
      this.hitstopTimer = 0.08;
      this.cameraTrauma = 0.9;
      this.willowUprootProgress = 0.02;
      this.sfx.playStrike();
      this.sfx.playTempleGong();
      if (this.willowGroup) {
        this.spawnBurst(
          this.willowGroup.position.x,
          this.willowGroup.position.y + 1.2,
          this.willowGroup.position.z,
          28,
          0x8f6b43
        );
      }
    }
  }

  public setTimeOfDay(tod: TimeOfDay): void {
    this.timeOfDay = tod;
    const area = AREAS[this.currentArea];
    const pal = TIME_PALETTES[tod];
    const su = this.seedUniforms;

    if (area.isIndoor) {
      const isTemple = this.currentArea === 'temple_interior';
      su.uMode.value = 3.0; // Soft warm continuous GI indoors
      su.uWindStr.value = 0.0;
      su.uTopColor.value.setHex(isTemple ? 0x6e4a38 : 0x614430);
      su.uMidColor.value.setHex(isTemple ? 0xa37452 : 0x996d49);
      su.uHorizonColor.value.setHex(isTemple ? 0xd9a878 : 0xd4a06c);
      su.uGroundBounce.value.setHex(isTemple ? 0x523426 : 0x4d3422);
      su.uSunDir.value.set(0.32, 0.84, 0.44).normalize();
      su.uSunColor.value.setHex(0xffd79e);
      su.uSunIntensity.value = isTemple ? 0.92 : 0.88;
      su.uSunGlowStr.value = 0.15;
      su.uGlowBoost.value = isTemple ? 1.28 : 1.18;
      su.uFogColor.value.setHex(isTemple ? 0x2e1b14 : 0x2b1d14);
      su.uFogDensity.value = 0.0085;

      this.scene.fog = new THREE.FogExp2(isTemple ? 0x2e1b14 : 0x2b1d14, 0.0085);
      this.sunLight.color.setHex(0xffd79e);
      this.sunLight.intensity = isTemple ? 1.35 : 1.25;
      this.sunLight.position.set(12, 26, 18);
      this.hemiLight.color.setHex(0xffdeb2);
      this.hemiLight.groundColor.setHex(0x523624);
      this.hemiLight.intensity = 1.05;
      this.renderer.toneMappingExposure = 1.08;
      return;
    }

    // Outdoor SeedWorld "流光渲染" Vivid Hue-Travel Mode (Mode 5)
    su.uMode.value = 5.0;
    su.uWindStr.value = 1.0;
    su.uTopColor.value.setHex(pal.topColor);
    su.uMidColor.value.setHex(pal.midColor);
    su.uHorizonColor.value.setHex(pal.horizonColor);
    su.uGroundBounce.value.setHex(pal.groundBounce);
    su.uSunDir.value.set(...pal.sunDir).normalize();
    su.uSunColor.value.setHex(pal.sunColor);
    su.uSunIntensity.value = pal.sunInt;
    su.uSunGlowStr.value = pal.sunGlowStr;
    su.uGlowBoost.value = pal.glowBoost;
    const fogD = area.tier === 'region' ? pal.fogDensityRegion : pal.fogDensityScene;
    su.uFogColor.value.setHex(pal.fogColor);
    su.uFogDensity.value = fogD;

    this.scene.fog = new THREE.FogExp2(pal.fogColor, fogD);
    this.sunLight.color.setHex(pal.sunColor);
    this.sunLight.intensity = pal.sunInt * 1.45;
    this.sunLight.position.set(pal.sunDir[0] * 110, pal.sunDir[1] * 110, pal.sunDir[2] * 110);
    this.hemiLight.color.setHex(pal.hemiSky);
    this.hemiLight.groundColor.setHex(pal.hemiGnd);
    this.hemiLight.intensity = pal.hemiInt;
    this.renderer.toneMappingExposure = pal.exposure;
  }

  public loadArea(
    areaId: AreaId,
    spawnOverride?: { x: number; z: number; yaw: number },
    playSound = false
  ): void {
    const area = AREAS[areaId];
    this.currentArea = areaId;
    this.willowGroup = null;
    this.guardianGroup = null;
    this.portalBeacons = [];
    this.liveNpcs = [];
    this.nearby = null;

    // Dispose previous ChunkStreamer, 3D bleed textures & scene meshes cleanly
    if (this.chunkStreamer) {
      this.worldGroup.remove(this.chunkStreamer.root);
      this.chunkStreamer.dispose();
      this.chunkStreamer = null;
    }
    for (const tex of this.activeBleedTextures) {
      tex.dispose();
    }
    this.activeBleedTextures = [];
    this.clearGroup(this.worldGroup);
    this.clearGroup(this.dynamicGroup);

    // Spawn point computed up front so ChunkStreamer primes directly around spawn + forward vista!
    const sp = spawnOverride || area.defaultSpawn;
    const py = getGroundHeight(areaId, sp.x, sp.z);
    this.playerPos.set(sp.x, py, sp.z);
    this.playerVelY = 0;
    this.onGround = true;
    this.playerYaw = sp.yaw;
    this.player.root.position.copy(this.playerPos);
    this.player.root.rotation.y = this.playerYaw;

    // Update lighting uniforms first so materials compile cleanly with target atmosphere
    this.setTimeOfDay(area.defaultTime);

    switch (areaId) {
      case 'weizhou_region': {
        const streamer = new ChunkStreamer(createWeizhouRegionPopulator(), this.seedUniforms, {
          chunkSize: 32,
          chunkHeight: 66,
          halo: 2,
          activeRadius: 4,
          fullQualityRadius: 2,
          minChunk: -5,
          maxChunk: 5,
        });
        const primeX = this.gameMode === 'title' ? 4 : sp.x;
        const primeZ = this.gameMode === 'title' ? 12 : sp.z;
        streamer.primeAround(primeX, primeZ, Math.sin(sp.yaw), Math.cos(sp.yaw));
        this.chunkStreamer = streamer;
        this.worldGroup.add(streamer.root);
        this.worldGroup.add(createDistantMountainRing('weizhou', this.seedUniforms));
        break;
      }
      case 'wutai_region': {
        const streamer = new ChunkStreamer(createWutaiRegionPopulator(), this.seedUniforms, {
          chunkSize: 32,
          chunkHeight: 78,
          halo: 2,
          activeRadius: 4,
          fullQualityRadius: 2,
          minChunk: -5,
          maxChunk: 5,
        });
        streamer.primeAround(sp.x, sp.z, Math.sin(sp.yaw), Math.cos(sp.yaw));
        this.chunkStreamer = streamer;
        this.worldGroup.add(streamer.root);
        this.worldGroup.add(createDistantMountainRing('wutai', this.seedUniforms));
        break;
      }
      case 'weizhou_town': {
        const res = buildWeizhouTown(this.seedUniforms);
        this.worldGroup.add(res.group);
        this.activeBleedTextures.push(...res.bleedTextures);
        this.worldGroup.add(createDistantMountainRing('horizon', this.seedUniforms));
        break;
      }
      case 'wutai_temple': {
        const res = buildWutaiTemple(this.seedUniforms);
        this.worldGroup.add(res.group);
        this.activeBleedTextures.push(...res.bleedTextures);
        if (res.guardianGroup) {
          this.guardianGroup = res.guardianGroup;
          this.dynamicGroup.add(this.guardianGroup);
        }
        this.worldGroup.add(createDistantMountainRing('wutai', this.seedUniforms));
        break;
      }
      case 'bianliang_city': {
        const res = buildBianliangCity(this.seedUniforms);
        this.worldGroup.add(res.group);
        this.activeBleedTextures.push(...res.bleedTextures);
        if (res.willowGroup) {
          this.willowGroup = res.willowGroup;
          this.dynamicGroup.add(this.willowGroup);
          if (this.questFlags.uprootedWillow) {
            this.willowUprootProgress = 1;
            this.applyWillowPose(1);
          } else {
            this.willowUprootProgress = 0;
          }
        }
        this.worldGroup.add(createDistantMountainRing('horizon', this.seedUniforms));
        break;
      }
      case 'tavern_interior': {
        const res = buildTavernInterior(this.seedUniforms);
        this.worldGroup.add(res.group);
        this.activeBleedTextures.push(...res.bleedTextures);
        break;
      }
      case 'temple_interior': {
        const res = buildTempleInterior(this.seedUniforms);
        this.worldGroup.add(res.group);
        this.activeBleedTextures.push(...res.bleedTextures);
        break;
      }
    }

    // Scenic volumetric voxel cloud banks drifting high above peaks for outdoor areas
    if (!area.isIndoor) {
      const cloudPositions: Array<[number, number, number, number]> = [
        [-68, 76, -54, 2.2],
        [52, 82, -72, 2.6],
        [-14, 88, -110, 3.0],
        [78, 72, 24, 2.0],
        [-84, 78, 38, 2.1],
        [18, 79, 54, 1.9],
      ];
      const cloudMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.82,
      });
      for (const [cx, cy, cz, sc] of cloudPositions) {
        const cloud = new THREE.Group();
        const b1 = new THREE.Mesh(new THREE.BoxGeometry(11 * sc, 2.4 * sc, 6.0 * sc), cloudMat);
        const b2 = new THREE.Mesh(new THREE.BoxGeometry(7.0 * sc, 2.8 * sc, 4.6 * sc), cloudMat);
        b2.position.set(1.5 * sc, 1.8 * sc, 0);
        const b3 = new THREE.Mesh(new THREE.BoxGeometry(5.5 * sc, 2.0 * sc, 3.8 * sc), cloudMat);
        b3.position.set(-2.4 * sc, 1.1 * sc, 0.8 * sc);
        cloud.add(b1, b2, b3);
        cloud.position.set(cx, cy, cz);
        this.dynamicGroup.add(cloud);
      }
    }

    // Subtle diegetic portal beacons (warm glowing rings on ground)
    for (const portal of area.portals) {
      const pty = getGroundHeight(areaId, portal.x, portal.z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.25, 1.75, 24),
        new THREE.MeshBasicMaterial({
          color: portal.kind === 'door' ? 0xffc85a : 0x8be29a,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(portal.x, pty + 0.12, portal.z);
      this.dynamicGroup.add(ring);
      this.portalBeacons.push(ring);
    }

    // Spawn NPCs
    for (const def of area.npcs) {
      const char = createNpcCharacter(def.role);
      const ny = getGroundHeight(areaId, def.x, def.z);
      char.root.position.set(def.x, ny, def.z);
      char.root.rotation.y = def.yaw;
      if (def.id === 'zhengtu' && this.questFlags.defeatedZhengTu) {
        char.knockedDown = true;
      }
      this.dynamicGroup.add(char.root);
      this.liveNpcs.push({
        def,
        char,
        patrolIndex: 0,
        patrolForward: true,
      });
    }

    // Camera framing behind player with majestic horizon & roof headroom
    const camDef = this.getAreaCameraDefaults(areaId);
    this.camYaw = sp.yaw + Math.PI;
    this.camPitch = camDef.pitch;
    this.camDist = camDef.dist;
    if (this.gameMode === 'title') {
      this.updateTitleCamera(0);
    } else {
      this.snapCameraImmediate();
    }

    // Update ambient particle hue to match region atmosphere
    const ambColor =
      areaId === 'wutai_temple'
        ? 0xffb8cc
        : areaId === 'temple_interior'
          ? 0xffe4a0
          : areaId === 'tavern_interior'
            ? 0xffb86c
            : 0xf7eed2;
    (this.ambientInst.material as THREE.MeshBasicMaterial).color.setHex(ambColor);

    if (playSound) {
      this.sfx.playPortalChime();
    }
    this.renderer.render(this.scene, this.camera);
    this.callbacks.onAreaChanged(areaId, area.defaultTime);
    this.emitMinimap();
  }

  public performInteract(): void {
    if (this.gameMode !== 'playing' || !this.nearby) return;
    if (this.nearby.kind === 'portal') {
      const portal = AREAS[this.currentArea].portals.find((p) => p.id === this.nearby?.id);
      if (portal) {
        this.loadArea(
          portal.targetArea,
          { x: portal.spawnX, z: portal.spawnZ, yaw: portal.spawnYaw },
          true
        );
      }
      return;
    }
    if (this.nearby.kind === 'npc') {
      this.callbacks.onInteractNpc(this.nearby.id);
      return;
    }
    if (this.nearby.kind === 'prop') {
      const prop = AREAS[this.currentArea].props.find((p) => p.id === this.nearby?.id);
      if (prop) {
        if (prop.actionType === 'strike_guardian') {
          this.guardianShakeTimer = 0.85;
          this.triggerDramaticAction('punch');
        }
        this.callbacks.onTriggerProp(prop);
      }
    }
  }

  public performStrike(): void {
    if (this.gameMode !== 'playing') return;
    this.player.attackTimer = 0.36;
    this.sfx.playStrike();
    this.cameraTrauma = Math.max(this.cameraTrauma, 0.32);
    const fx = this.playerPos.x + Math.sin(this.playerYaw) * 1.4;
    const fz = this.playerPos.z + Math.cos(this.playerYaw) * 1.4;
    this.spawnBurst(fx, this.playerPos.y + 1.3, fz, 12, 0xffc864);

    if (this.nearby && this.nearby.kind === 'prop') {
      const prop = AREAS[this.currentArea].props.find((p) => p.id === this.nearby?.id);
      if (
        prop &&
        (prop.actionType === 'confront_zheng' ||
          prop.actionType === 'strike_guardian' ||
          prop.actionType === 'uproot_willow')
      ) {
        if (prop.actionType === 'strike_guardian') {
          this.guardianShakeTimer = 0.9;
        }
        this.callbacks.onTriggerProp(prop);
      }
    }
  }

  private rebuildPlayerMesh(): void {
    this.scene.remove(this.player.root);
    this.player = createPlayerCharacter(this.playerIdentity);
    this.player.root.position.copy(this.playerPos);
    this.player.root.rotation.y = this.playerYaw;
    this.scene.add(this.player.root);
  }

  private spawnBurst(x: number, y: number, z: number, count: number, hex: number): void {
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.pos.set(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6);
        const ang = Math.random() * Math.PI * 2;
        const spd = 2.2 + Math.random() * 4.2;
        p.vel.set(Math.cos(ang) * spd, 2.5 + Math.random() * 4.0, Math.sin(ang) * spd);
        p.life = 0;
        p.maxLife = 0.45 + Math.random() * 0.45;
        p.scale = 0.65 + Math.random() * 0.85;
        p.color.setHex(hex);
        this.particleInst.setColorAt(i, p.color);
        spawned++;
      }
    }
    if (this.particleInst.instanceColor) {
      this.particleInst.instanceColor.needsUpdate = true;
    }
  }

  private applyWillowPose(progress: number): void {
    if (!this.willowGroup) return;
    const ease = 1 - Math.pow(1 - clamp(progress, 0, 1), 3);
    this.willowGroup.rotation.z = ease * 1.18;
    this.willowGroup.position.y = 6.0 + Math.sin(ease * Math.PI) * 2.2 + ease * 0.8;
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          const m = obj.material;
          if (Array.isArray(m)) m.forEach((item) => item.dispose());
          else m?.dispose();
        }
      });
    }
  }

  private snapCameraImmediate(): void {
    const area = AREAS[this.currentArea];
    const camDef = this.getAreaCameraDefaults(this.currentArea);
    const dist = this.camDist;
    const cx = this.playerPos.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist;
    const cz = this.playerPos.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist;
    let cy = this.playerPos.y + 3.0 + Math.sin(this.camPitch) * dist;
    if (!area.isIndoor) {
      cy = Math.max(cy, getGroundHeight(this.currentArea, cx, cz) + 3.0);
    } else {
      cy = clamp(cy, 3.6, 10.6);
    }
    const lookY = this.playerPos.y + camDef.lookY;
    this.camera.position.set(
      area.isIndoor ? clamp(cx, -(area.size - 1.5), area.size - 1.5) : cx,
      cy,
      area.isIndoor ? clamp(cz, -(area.size - 1.5), area.size - 0.8) : cz
    );
    this.camera.lookAt(this.playerPos.x, lookY, this.playerPos.z - (area.isIndoor ? 4.2 : 0));
  }

  private tick = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    this.timeUniform.value += dt;
    this.seedUniforms.uTime.value = this.timeUniform.value;

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    } else if (this.gameMode === 'playing') {
      this.updatePlayer(dt);
      this.updateNpcs(dt);
      this.updateInteractions(dt);
    } else if (this.gameMode === 'title') {
      this.updateNpcs(dt * 0.7);
      this.updateTitleCamera(dt);
    }

    this.updateEffects(dt);
    if (this.gameMode === 'playing') {
      this.updateFollowCamera(dt);
    }

    // Dynamic World Partition Chunk Streaming for Open Regions
    if (this.chunkStreamer) {
      this.camera.getWorldDirection(_vFwd);
      const focusX = this.gameMode === 'title' ? 0 : this.playerPos.x;
      const focusZ = this.gameMode === 'title' ? 8 : this.playerPos.z;
      this.chunkStreamer.update(
        focusX,
        focusZ,
        _vFwd.x,
        _vFwd.z,
        this.isSoftwareGl ? 1 : 2
      );
    }

    // Center atmospheric sky dome around camera
    this.skyMesh.position.copy(this.camera.position);

    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext();
    if (
      typeof WebGL2RenderingContext !== 'undefined' &&
      gl instanceof WebGL2RenderingContext &&
      gl.fenceSync
    ) {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private updateTitleCamera(dt: number): void {
    this.titleTourAngle += dt * 0.09;
    // Unobstructed panoramic sweep from the SW meadow over Wei River arched bridge, canal boat, pavilion, giant SeedWorld trees & Guanxi peaks!
    const tx = -8 + Math.sin(this.titleTourAngle) * 14;
    const tz = 40 + Math.cos(this.titleTourAngle) * 5;
    const ty = Math.max(22.5, getGroundHeight(this.currentArea, tx, tz) + 12.5);
    this.camera.position.set(tx, ty, tz);
    this.camera.lookAt(-3, 12.5, -16);
  }

  private updatePlayer(dt: number): void {
    const area = AREAS[this.currentArea];
    let inZ = 0;
    let inX = 0;
    if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) inZ += 1;
    if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) inZ -= 1;
    if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) inX -= 1;
    if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) inX += 1;

    _vFwd.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw)).normalize();
    _vRight.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw)).normalize();
    _vMove.set(0, 0, 0).addScaledVector(_vFwd, inZ).addScaledVector(_vRight, inX);

    const sprinting = this.keysHeld.has('ShiftLeft') || this.keysHeld.has('ShiftRight');
    const baseSpeed = area.isIndoor ? 8.2 : sprinting ? 18.5 : 12.0;
    let movedDist = 0;

    if (_vMove.lengthSq() > 0.001) {
      _vMove.normalize();
      const targetYaw = Math.atan2(_vMove.x, _vMove.z);
      let diff = targetYaw - this.playerYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.playerYaw += diff * (1 - Math.exp(-14 * dt));

      const stepX = _vMove.x * baseSpeed * dt;
      const stepZ = _vMove.z * baseSpeed * dt;
      const nextX = this.playerPos.x + stepX;
      const nextZ = this.playerPos.z + stepZ;

      if (isPointWalkable(this.currentArea, nextX, this.playerPos.z, area.size)) {
        this.playerPos.x = nextX;
        movedDist += Math.abs(stepX);
      }
      if (isPointWalkable(this.currentArea, this.playerPos.x, nextZ, area.size)) {
        this.playerPos.z = nextZ;
        movedDist += Math.abs(stepZ);
      }

      this.stepDistAccum += movedDist;
      if (this.onGround && this.stepDistAccum > 3.2) {
        this.stepDistAccum = 0;
        this.sfx.playStep();
      }
    }

    if (this.onGround) {
      this.coyoteTimer = 0.1;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }
    if (this.jumpBuffer > 0) {
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
      if (this.coyoteTimer > 0) {
        this.playerVelY = 11.2;
        this.onGround = false;
        this.coyoteTimer = 0;
        this.jumpBuffer = 0;
        this.squashY = 1.18;
        this.spawnBurst(this.playerPos.x, this.playerPos.y + 0.15, this.playerPos.z, 5, 0xd9cbb2);
      }
    }

    const groundY = getGroundHeight(this.currentArea, this.playerPos.x, this.playerPos.z);
    if (!this.onGround || this.playerPos.y > groundY + 0.05) {
      this.playerVelY -= 28 * dt;
      this.playerPos.y += this.playerVelY * dt;
      if (this.playerPos.y <= groundY) {
        this.playerPos.y = groundY;
        if (!this.onGround && this.playerVelY < -4) {
          this.squashY = 0.8;
          this.spawnBurst(this.playerPos.x, groundY + 0.1, this.playerPos.z, 5, 0xd4c5aa);
        }
        this.playerVelY = 0;
        this.onGround = true;
      }
    } else {
      this.playerPos.y = THREE.MathUtils.damp(this.playerPos.y, groundY, 18, dt);
    }

    this.squashY = THREE.MathUtils.damp(this.squashY, 1.0, 12, dt);
    const invSquash = 1 / Math.sqrt(this.squashY);
    this.player.root.scale.set(invSquash, this.squashY, invSquash);

    this.player.root.position.copy(this.playerPos);
    this.player.root.rotation.y = this.playerYaw;
    updateCharacterAnim(this.player, this.onGround ? movedDist : 0, dt);
  }

  private updateNpcs(dt: number): void {
    for (const npc of this.liveNpcs) {
      let moved = 0;
      const patrol = npc.def.patrol;
      if (patrol && patrol.length >= 2 && !npc.char.knockedDown) {
        const target = patrol[npc.patrolIndex];
        const dx = target.x - npc.char.root.position.x;
        const dz = target.z - npc.char.root.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.8) {
          if (npc.patrolForward) {
            if (npc.patrolIndex < patrol.length - 1) npc.patrolIndex++;
            else {
              npc.patrolForward = false;
              npc.patrolIndex = Math.max(0, patrol.length - 2);
            }
          } else {
            if (npc.patrolIndex > 0) npc.patrolIndex--;
            else {
              npc.patrolForward = true;
              npc.patrolIndex = Math.min(patrol.length - 1, 1);
            }
          }
        } else {
          const spd = npc.def.speed ?? 1.8;
          const step = Math.min(dist, spd * dt);
          npc.char.root.position.x += (dx / dist) * step;
          npc.char.root.position.z += (dz / dist) * step;
          npc.char.root.position.y = getGroundHeight(
            this.currentArea,
            npc.char.root.position.x,
            npc.char.root.position.z
          );
          const yaw = Math.atan2(dx, dz);
          npc.char.root.rotation.y = yaw;
          moved = step;
        }
      }
      const beacon = npc.char.bodyPivot.getObjectByName('npc_beacon');
      if (beacon) {
        beacon.rotation.y += dt * 1.8;
        beacon.position.y = 3.25 + Math.sin(this.timeUniform.value * 2.6) * 0.14;
      }
      updateCharacterAnim(npc.char, moved, dt);
    }
  }

  private updateEffects(dt: number): void {
    for (let i = 0; i < this.portalBeacons.length; i++) {
      const s = 1 + Math.sin(this.timeUniform.value * 2.5 + i) * 0.08;
      this.portalBeacons[i].scale.setScalar(s);
    }

    if (this.willowUprootProgress > 0 && this.willowUprootProgress < 1) {
      this.willowUprootProgress = Math.min(1, this.willowUprootProgress + dt * 1.35);
      this.applyWillowPose(this.willowUprootProgress);
    }

    if (this.guardianGroup && this.guardianShakeTimer > 0) {
      this.guardianShakeTimer = Math.max(0, this.guardianShakeTimer - dt);
      const amp = this.guardianShakeTimer * 0.25;
      this.guardianGroup.position.set(
        Math.sin(this.timeUniform.value * 45) * amp,
        6.0,
        32.0 + Math.cos(this.timeUniform.value * 40) * amp
      );
      if (this.guardianShakeTimer === 0) this.guardianGroup.position.set(0, 6.0, 32.0);
    }

    let dirty = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _mDummy.scale.setScalar(0);
        _mDummy.updateMatrix();
        this.particleInst.setMatrixAt(i, _mDummy.matrix);
        dirty = true;
        continue;
      }
      p.vel.y -= 11 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const sc = p.scale * (1 - p.life / p.maxLife);
      _mDummy.position.copy(p.pos);
      _mDummy.rotation.set(p.life * 4, p.life * 3, 0);
      _mDummy.scale.setScalar(sc);
      _mDummy.updateMatrix();
      this.particleInst.setMatrixAt(i, _mDummy.matrix);
      dirty = true;
    }
    if (dirty) this.particleInst.instanceMatrix.needsUpdate = true;

    const t = this.timeUniform.value;
    const isIndoor = AREAS[this.currentArea].isIndoor;
    for (let i = 0; i < this.ambientOffsets.length; i++) {
      const a = this.ambientOffsets[i];
      const range = isIndoor ? 13 : 60;
      const x = ((a.x + t * a.sp * 1.2 + range) % (range * 2)) - range;
      const y = isIndoor
        ? 1.6 + ((a.y + t * a.sp * 0.5) % 8.5)
        : 6.0 + ((a.y - t * a.sp * 0.65 + 26) % 26);
      const z = ((a.z + Math.sin(t * 0.5 + a.ph) * 2.5 + range) % (range * 2)) - range;
      _mDummy.position.set(x, y, z);
      _mDummy.rotation.set(t + a.ph, t * 0.7, a.ph);
      _mDummy.scale.setScalar(isIndoor ? 0.55 : 0.9);
      _mDummy.updateMatrix();
      this.ambientInst.setMatrixAt(i, _mDummy.matrix);
    }
    this.ambientInst.instanceMatrix.needsUpdate = true;
  }

  private updateFollowCamera(dt: number): void {
    const area = AREAS[this.currentArea];
    const camDef = this.getAreaCameraDefaults(this.currentArea);
    const dist = this.camDist;
    const tx = this.playerPos.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist;
    const tz = this.playerPos.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist;
    let ty = this.playerPos.y + 3.0 + Math.sin(this.camPitch) * dist;

    if (!area.isIndoor) {
      ty = Math.max(ty, getGroundHeight(this.currentArea, tx, tz) + 3.0);
      _vCamTarget.set(tx, ty, tz);
    } else {
      const maxX = area.size - 1.5;
      const maxZ = area.size - 0.8;
      _vCamTarget.set(clamp(tx, -maxX, maxX), clamp(ty, 3.6, 10.6), clamp(tz, -maxX, maxZ));
    }

    const alpha = 1 - Math.exp(-9 * dt);
    this.camera.position.lerp(_vCamTarget, alpha);

    if (this.cameraTrauma > 0) {
      this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.8);
      const shake = this.cameraTrauma * this.cameraTrauma * 0.55;
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }

    const lookY = this.playerPos.y + camDef.lookY;
    _vLookTarget.set(
      this.playerPos.x,
      lookY,
      this.playerPos.z - (area.isIndoor ? 4.2 : 0)
    );
    this.camera.lookAt(_vLookTarget);
  }

  private updateInteractions(dt: number): void {
    this.hudEmitAccum += dt;
    if (this.hudEmitAccum < 0.12) return;
    this.hudEmitAccum = 0;

    const area = AREAS[this.currentArea];
    let best: NearbyInteraction | null = null;
    let bestDist = Infinity;

    for (const portal of area.portals) {
      const d = Math.hypot(this.playerPos.x - portal.x, this.playerPos.z - portal.z);
      if (d <= portal.radius && d < bestDist) {
        bestDist = d;
        best = {
          kind: 'portal',
          id: portal.id,
          label: portal.label,
          sublabel: AREAS[portal.targetArea].tierLabel,
          keyHint: 'E',
          targetArea: portal.targetArea,
        };
      }
    }

    for (const prop of area.props) {
      const d = Math.hypot(this.playerPos.x - prop.x, this.playerPos.z - prop.z);
      if (d <= prop.radius && d < bestDist) {
        bestDist = d;
        best = {
          kind: 'prop',
          id: prop.id,
          label: prop.label,
          keyHint:
            prop.actionType === 'uproot_willow' ||
            prop.actionType === 'confront_zheng' ||
            prop.actionType === 'strike_guardian'
              ? 'J'
              : 'E',
        };
      }
    }

    for (const npc of this.liveNpcs) {
      if (!npc.def.interactable) continue;
      const d = Math.hypot(
        this.playerPos.x - npc.char.root.position.x,
        this.playerPos.z - npc.char.root.position.z
      );
      if (d <= 4.5 && d < bestDist) {
        bestDist = d;
        best = {
          kind: 'npc',
          id: npc.def.id,
          label: `与 ${npc.def.name} 对话`,
          sublabel: npc.def.title,
          keyHint: 'E',
        };
      }
    }

    if (best?.id !== this.nearby?.id || best?.kind !== this.nearby?.kind) {
      this.nearby = best;
      this.callbacks.onNearbyChange(best);
    }

    this.emitMinimap();
  }

  private emitMinimap(): void {
    const area = AREAS[this.currentArea];
    this.callbacks.onMinimapUpdate({
      playerX: this.playerPos.x,
      playerZ: this.playerPos.z,
      playerYaw: this.playerYaw,
      areaSize: area.size,
      portals: area.portals.map((p) => ({ x: p.x, z: p.z, label: p.label })),
      npcs: this.liveNpcs.map((n) => ({
        x: n.char.root.position.x,
        z: n.char.root.position.z,
        important:
          n.def.role === 'shijin' ||
          n.def.role === 'lizhong' ||
          n.def.role === 'jincuilian' ||
          n.def.role === 'zhengtu' ||
          n.def.role === 'zhizhen' ||
          n.def.role === 'wine_peddler' ||
          n.def.role === 'ruffian',
      })),
    });
  }

  private handleResize(): void {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.render(this.scene, this.camera);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.gameMode !== 'playing') return;
    if (e.code === 'Space' && !e.repeat) {
      this.jumpBuffer = 0.14;
    }
    if ((e.code === 'KeyE' || e.code === 'KeyF') && !e.repeat) {
      this.performInteract();
    }
    if (e.code === 'KeyJ' && !e.repeat) {
      this.performStrike();
    }
    this.keysHeld.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysHeld.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (this.gameMode !== 'playing') return;
    this.isDragging = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isDragging || this.gameMode !== 'playing') return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.camYaw -= dx * 0.0065;
    this.camPitch = clamp(this.camPitch + dy * 0.005, 0.14, 1.12);
  };

  private onPointerUp = (): void => {
    this.isDragging = false;
  };

  private onWheel = (e: WheelEvent): void => {
    if (this.gameMode !== 'playing') return;
    const isIndoor = AREAS[this.currentArea].isIndoor;
    this.camDist = clamp(this.camDist + e.deltaY * 0.015, isIndoor ? 7.5 : 10, isIndoor ? 16 : 42);
  };

  private onBlur = (): void => {
    this.keysHeld.clear();
    this.isDragging = false;
  };

  private bindEvents(): void {
    const el = this.renderer.domElement;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: true });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('wheel', this.onWheel);
    if (this.chunkStreamer) {
      this.chunkStreamer.dispose();
      this.chunkStreamer = null;
    }
    for (const tex of this.activeBleedTextures) {
      tex.dispose();
    }
    this.activeBleedTextures = [];
    this.seedUniforms.uBleedTex.value.dispose();
    this.clearGroup(this.worldGroup);
    this.clearGroup(this.dynamicGroup);
    this.skyMesh.geometry.dispose();
    (this.skyMesh.material as THREE.Material).dispose();
    this.envMap?.dispose();
    this.renderer.dispose();
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}
