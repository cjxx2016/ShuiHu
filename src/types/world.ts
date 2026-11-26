export type AreaTier = 'region' | 'scene' | 'interior';

export type AreaId =
  | 'weizhou_region'
  | 'wutai_region'
  | 'weizhou_town'
  | 'wutai_temple'
  | 'bianliang_city'
  | 'tavern_interior'
  | 'temple_interior';

export type TimeOfDay = 'dawn' | 'noon' | 'sunset' | 'night';

export type GameMode = 'title' | 'playing' | 'paused' | 'gameover';

export type CharacterIdentity = 'luda' | 'luzhishen';

export interface Vec2 {
  x: number;
  z: number;
}

export interface PortalDef {
  id: string;
  label: string;
  targetArea: AreaId;
  x: number;
  z: number;
  radius: number;
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
  kind: 'road' | 'gate' | 'door' | 'mountain_pass';
}

export type NpcRole =
  | 'shijin'
  | 'lizhong'
  | 'jincuilian'
  | 'zhengtu'
  | 'waiter'
  | 'wine_peddler'
  | 'zhizhen'
  | 'monk'
  | 'guard'
  | 'citizen'
  | 'merchant'
  | 'ruffian';

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  role: NpcRole;
  x: number;
  z: number;
  yaw: number;
  interactable: boolean;
  /** Optional patrol waypoints for lively city/road movement */
  patrol?: Vec2[];
  speed?: number;
}

export interface PropActionDef {
  id: string;
  label: string;
  x: number;
  z: number;
  radius: number;
  actionType: 'drink_wine' | 'strike_guardian' | 'offer_incense' | 'uproot_willow' | 'confront_zheng';
}

export interface AreaConfig {
  id: AreaId;
  tier: AreaTier;
  tierLabel: string;
  name: string;
  subtitle: string;
  poem: string;
  size: number; // half-extent in world units (playable bounds roughly [-size, size])
  defaultSpawn: { x: number; z: number; yaw: number };
  defaultTime: TimeOfDay;
  ambientHint: string;
  portals: PortalDef[];
  npcs: NpcDef[];
  props: PropActionDef[];
  waterLevel: number | null;
  isIndoor: boolean;
}

export interface DialogueChoice {
  label: string;
  nextNodeId?: string;
  effect?:
    | 'drink_tavern_wine'
    | 'hear_jin_story'
    | 'fight_zhengtu'
    | 'take_tonsure'
    | 'buy_mountain_wine'
    | 'receive_letter'
    | 'uproot_willow_action'
    | 'close';
}

export interface DialogueNode {
  id: string;
  speaker: string;
  speakerTitle: string;
  text: string;
  choices: DialogueChoice[];
}

export interface QuestFlags {
  metLiZhong: boolean;
  drankAtPanTavern: boolean;
  heardJinCuilian: boolean;
  defeatedZhengTu: boolean;
  reachedWutai: boolean;
  tookTonsure: boolean;
  drankMountainWine: boolean;
  shookMountainGate: boolean;
  receivedAbbotLetter: boolean;
  enteredBianliang: boolean;
  uprootedWillow: boolean;
}

export interface QuestObjective {
  chapter: number;
  chapterTitle: string;
  summary: string;
  targetArea: AreaId;
  targetLabel: string;
  completedCount: number;
  totalSteps: number;
  allCompleted: boolean;
}

export interface NearbyInteraction {
  kind: 'npc' | 'portal' | 'prop';
  id: string;
  label: string;
  sublabel?: string;
  keyHint: 'E' | 'J';
  targetArea?: AreaId;
}

export interface MinimapSnapshot {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  areaSize: number;
  portals: Array<{ x: number; z: number; label: string }>;
  npcs: Array<{ x: number; z: number; important: boolean }>;
}
