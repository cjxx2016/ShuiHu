import * as THREE from 'three';
import type { CharacterIdentity, NpcRole } from '../types/world';

export interface ArticulatedCharacter {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  walkPhase: number;
  attackTimer: number;
  knockedDown: boolean;
}

const sharedGeo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  shadow: new THREE.CircleGeometry(0.68, 16),
};
sharedGeo.shadow.rotateX(-Math.PI / 2);

const shadowMat = new THREE.MeshBasicMaterial({
  color: 0x0d0c0a,
  transparent: true,
  opacity: 0.36,
  depthWrite: false,
});

function part(
  w: number,
  h: number,
  d: number,
  hex: number,
  x: number,
  y: number,
  z: number,
  roughness = 0.78,
  metalness = 0.08
): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: hex,
    roughness,
    metalness,
  });
  const mesh = new THREE.Mesh(sharedGeo.box, mat);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  return mesh;
}

function addContactShadow(root: THREE.Group, scale = 1.0): void {
  const disc = new THREE.Mesh(sharedGeo.shadow, shadowMat);
  disc.scale.setScalar(scale);
  disc.position.y = 0.03;
  root.add(disc);
}

/** Builds articulated voxel player model: 提辖鲁达 or 花和尚鲁智深 (with monk robe & Zen staff) */
export function createPlayerCharacter(identity: CharacterIdentity): ArticulatedCharacter {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);
  addContactShadow(root, 1.25);

  const isMonk = identity === 'luzhishen';

  // Broad sturdy legs
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.26, 0.85, 0);
  leftLeg.add(part(0.38, 0.72, 0.38, isMonk ? 0x45423d : 0x2c3645, 0, -0.36, 0));
  leftLeg.add(part(0.42, 0.22, 0.48, 0x26211e, 0, -0.74, 0.05));
  bodyPivot.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.26, 0.85, 0);
  rightLeg.add(part(0.38, 0.72, 0.38, isMonk ? 0x45423d : 0x2c3645, 0, -0.36, 0));
  rightLeg.add(part(0.42, 0.22, 0.48, 0x26211e, 0, -0.74, 0.05));
  bodyPivot.add(rightLeg);

  // Broad Heroic Torso
  const torsoColor = isMonk ? 0x4f4c48 : 0x2b4563;
  bodyPivot.add(part(1.06, 1.08, 0.62, torsoColor, 0, 1.38, 0));
  // Waist sash / belt
  bodyPivot.add(part(1.12, 0.24, 0.68, isMonk ? 0xc86b28 : 0xb83528, 0, 0.96, 0));

  if (isMonk) {
    // Diagonal saffron-amber kasaya monk robe sash + wooden prayer beads
    bodyPivot.add(part(0.32, 1.02, 0.68, 0xd8882c, -0.26, 1.42, 0.02));
    bodyPivot.add(part(0.74, 0.16, 0.68, 0x5c361c, 0, 1.82, 0.03)); // 念珠
  } else {
    // Song Military Officer breastplate trim & crimson collar
    bodyPivot.add(part(0.84, 0.54, 0.68, 0x8f2c22, 0, 1.56, 0.02, 0.55, 0.25));
    bodyPivot.add(part(0.34, 0.34, 0.72, 0xd8a642, 0, 1.56, 0.02, 0.32, 0.55));
  }

  // Head + Thick Full Beard (满脸络腮胡)
  bodyPivot.add(part(0.68, 0.68, 0.66, 0xe8ba96, 0, 2.28, 0));
  bodyPivot.add(part(0.72, 0.24, 0.36, 0x221d1a, 0, 2.02, 0.22)); // signature full beard!
  bodyPivot.add(part(0.11, 0.1, 0.08, 0x1a1512, -0.16, 2.34, 0.33));
  bodyPivot.add(part(0.11, 0.1, 0.08, 0x1a1512, 0.16, 2.34, 0.33));

  if (isMonk) {
    // Gleaming shaved monk crown + metallic戒箍 headband
    bodyPivot.add(part(0.72, 0.11, 0.7, 0xd4a446, 0, 2.48, 0, 0.32, 0.55));
  } else {
    // Song Officer cloth cap (幞头/巾帻) + red knot
    bodyPivot.add(part(0.74, 0.28, 0.72, 0x262930, 0, 2.66, 0));
    bodyPivot.add(part(0.24, 0.16, 0.24, 0xc93528, 0, 2.84, 0));
  }

  // Arms
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.68, 1.76, 0);
  leftArm.add(part(0.34, 0.88, 0.36, isMonk ? 0x4f4c48 : 0x2b4563, 0, -0.34, 0));
  leftArm.add(part(0.3, 0.26, 0.3, 0xe8ba96, 0, -0.82, 0));
  bodyPivot.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.68, 1.76, 0);
  rightArm.add(part(0.34, 0.88, 0.36, isMonk ? 0xd8882c : 0x2b4563, 0, -0.34, 0));
  rightArm.add(part(0.3, 0.26, 0.3, 0xe8ba96, 0, -0.82, 0));

  if (isMonk) {
    // Iconic 62-Jin Water-Grind Iron Zen Staff (浑铁禅杖)
    rightArm.add(part(0.12, 3.1, 0.12, 0x454a52, 0.06, -0.42, 0.24, 0.35, 0.7));
    rightArm.add(part(0.36, 0.32, 0.16, 0xd8a846, 0.06, 1.15, 0.24, 0.3, 0.65)); // crescent spade tip
    rightArm.add(part(0.26, 0.22, 0.26, 0xc89838, 0.06, -1.92, 0.24, 0.35, 0.6));
  }
  bodyPivot.add(rightArm);

  return {
    root,
    bodyPivot,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    walkPhase: 0,
    attackTimer: 0,
    knockedDown: false,
  };
}

interface RoleStyle {
  robe: number;
  accent: number;
  hat: number | null;
  skin: number;
  scale: number;
  hasSpear?: boolean;
  hasStaff?: boolean;
  hasPoles?: boolean;
  important?: boolean;
}

const ROLE_STYLES: Record<NpcRole, RoleStyle> = {
  shijin: { robe: 0x3b6088, accent: 0xd9a845, hat: 0x262930, skin: 0xebb995, scale: 1.0, important: true },
  lizhong: { robe: 0x5c4a38, accent: 0xa8382c, hat: 0x3b2f24, skin: 0xe3b18a, scale: 0.98, important: true },
  jincuilian: { robe: 0xd98fa3, accent: 0xf4e8d6, hat: 0x2a1f1e, skin: 0xf4cfb6, scale: 0.9, important: true },
  zhengtu: { robe: 0x6b3a2e, accent: 0xded4c3, hat: null, skin: 0xe0aa86, scale: 1.12, important: true },
  waiter: { robe: 0x8a7d65, accent: 0xf0e7d6, hat: 0x3b3530, skin: 0xe8be9b, scale: 0.93 },
  wine_peddler: { robe: 0x6e6850, accent: 0x99582e, hat: 0xc9a86a, skin: 0xdfad86, scale: 0.96, hasPoles: true, important: true },
  zhizhen: { robe: 0xb52f24, accent: 0xe8b848, hat: null, skin: 0xf0c9ab, scale: 1.0, hasStaff: true, important: true },
  monk: { robe: 0x6b6760, accent: 0xc47e32, hat: null, skin: 0xe8be9b, scale: 0.96 },
  guard: { robe: 0x8f2c24, accent: 0x3a404a, hat: 0x545c66, skin: 0xe2b38f, scale: 1.02, hasSpear: true },
  citizen: { robe: 0x5b7685, accent: 0xd9cdb6, hat: 0x2d2a26, skin: 0xecc2a1, scale: 0.94 },
  merchant: { robe: 0x4b6e56, accent: 0xd4a44a, hat: 0x3d3024, skin: 0xe6ba96, scale: 0.96 },
  ruffian: { robe: 0x4d453d, accent: 0x8a4834, hat: 0x2e2a26, skin: 0xe0af88, scale: 0.97, important: true },
};

/** Builds a composite voxel NPC mesh tailored to their Water Margin role */
export function createNpcCharacter(role: NpcRole): ArticulatedCharacter {
  const s = ROLE_STYLES[role];
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  bodyPivot.scale.setScalar(s.scale);
  root.add(bodyPivot);
  addContactShadow(root, 1.05 * s.scale);

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.22, 0.8, 0);
  leftLeg.add(part(0.32, 0.78, 0.32, 0x302e2c, 0, -0.39, 0));
  bodyPivot.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.22, 0.8, 0);
  rightLeg.add(part(0.32, 0.78, 0.32, 0x302e2c, 0, -0.39, 0));
  bodyPivot.add(rightLeg);

  // Body robe + waist accent
  bodyPivot.add(part(0.92, 1.04, 0.54, s.robe, 0, 1.32, 0));
  bodyPivot.add(part(0.96, 0.24, 0.58, s.accent, 0, 0.94, 0));

  // Head
  bodyPivot.add(part(0.62, 0.62, 0.6, s.skin, 0, 2.18, 0));
  bodyPivot.add(part(0.09, 0.09, 0.08, 0x1a1512, -0.14, 2.24, 0.3));
  bodyPivot.add(part(0.09, 0.09, 0.08, 0x1a1512, 0.14, 2.24, 0.3));

  if (role === 'zhizhen') {
    // White beard & golden kasaya drape for Abbot Zhizhen
    bodyPivot.add(part(0.36, 0.42, 0.24, 0xf2f0eb, 0, 1.88, 0.26));
    bodyPivot.add(part(0.34, 0.98, 0.6, 0xe8b848, -0.22, 1.36, 0.02));
  }

  if (s.hat !== null) {
    const hatW = role === 'wine_peddler' ? 1.15 : 0.68;
    const hatH = role === 'wine_peddler' ? 0.22 : 0.26;
    bodyPivot.add(part(hatW, hatH, hatW, s.hat, 0, 2.55, 0));
  }

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.6, 1.68, 0);
  leftArm.add(part(0.28, 0.82, 0.3, s.robe, 0, -0.34, 0));
  bodyPivot.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.6, 1.68, 0);
  rightArm.add(part(0.28, 0.82, 0.3, s.robe, 0, -0.34, 0));
  if (s.hasSpear) {
    rightArm.add(part(0.09, 3.2, 0.09, 0x5c3c24, 0.05, -0.2, 0.22));
    rightArm.add(part(0.16, 0.48, 0.08, 0xd8dce2, 0.05, 1.55, 0.22, 0.3, 0.7));
  }
  if (s.hasStaff) {
    rightArm.add(part(0.09, 2.6, 0.09, 0xd8a846, 0.05, -0.3, 0.2, 0.32, 0.6));
  }
  bodyPivot.add(rightArm);

  // Subtle floating amber diamond beacon above key storyline NPCs
  if (s.important) {
    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.26, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffd25a,
        emissive: 0xffa832,
        emissiveIntensity: 0.9,
        roughness: 0.3,
      })
    );
    beacon.position.set(0, 3.25, 0);
    beacon.name = 'npc_beacon';
    bodyPivot.add(beacon);
  }

  return {
    root,
    bodyPivot,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    walkPhase: Math.random() * Math.PI * 2,
    attackTimer: 0,
    knockedDown: false,
  };
}

/** Updates articulated walk/attack/KO kinematics on a character without allocating */
export function updateCharacterAnim(
  char: ArticulatedCharacter,
  moveDist: number,
  dt: number
): void {
  if (char.knockedDown) {
    char.bodyPivot.rotation.x = THREE.MathUtils.damp(char.bodyPivot.rotation.x, -Math.PI / 2, 7, dt);
    char.bodyPivot.position.y = THREE.MathUtils.damp(char.bodyPivot.position.y, 0.35, 7, dt);
    return;
  }

  char.bodyPivot.rotation.x = THREE.MathUtils.damp(char.bodyPivot.rotation.x, 0, 8, dt);

  if (moveDist > 0.002) {
    char.walkPhase += moveDist * 2.2;
    const swing = Math.sin(char.walkPhase) * 0.65;
    char.leftLeg.rotation.x = swing;
    char.rightLeg.rotation.x = -swing;
    char.leftArm.rotation.x = -swing * 0.75;
    if (char.attackTimer <= 0) {
      char.rightArm.rotation.x = swing * 0.75;
    }
    char.bodyPivot.position.y = Math.abs(Math.sin(char.walkPhase)) * 0.12;
  } else {
    char.leftLeg.rotation.x = THREE.MathUtils.damp(char.leftLeg.rotation.x, 0, 10, dt);
    char.rightLeg.rotation.x = THREE.MathUtils.damp(char.rightLeg.rotation.x, 0, 10, dt);
    char.leftArm.rotation.x = THREE.MathUtils.damp(char.leftArm.rotation.x, 0, 10, dt);
    if (char.attackTimer <= 0) {
      char.rightArm.rotation.x = THREE.MathUtils.damp(char.rightArm.rotation.x, 0, 10, dt);
    }
    char.bodyPivot.position.y = THREE.MathUtils.damp(char.bodyPivot.position.y, 0, 10, dt);
  }

  if (char.attackTimer > 0) {
    char.attackTimer = Math.max(0, char.attackTimer - dt);
    const p = 1 - char.attackTimer / 0.36;
    // Windup -> Active Strike -> Recovery curve
    if (p < 0.25) {
      char.rightArm.rotation.x = THREE.MathUtils.lerp(0, -2.1, p / 0.25);
    } else if (p < 0.58) {
      char.rightArm.rotation.x = THREE.MathUtils.lerp(-2.1, 1.35, (p - 0.25) / 0.33);
    } else {
      char.rightArm.rotation.x = THREE.MathUtils.lerp(1.35, 0, (p - 0.58) / 0.42);
    }
  }
}
