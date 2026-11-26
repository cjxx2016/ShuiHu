import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_ORDER, AREAS, getNpcDialogue } from './worldData';
import { getGroundHeight, isPointWalkable } from './terrainMath';
import {
  applyDialogueEffect,
  createInitialQuestFlags,
  getActiveObjective,
  getCharacterIdentity,
} from './questEngine';
import { VoxelGrid } from '../engine/voxel/VoxelGrid';
import { VoxMat } from '../engine/voxel/materials';
import { bakeSeedWorldMesh } from '../engine/voxel/SeedWorldMesher';

test('world contains exactly 2 regions, 3 scenes, and 2 interiors', () => {
  const list = AREA_ORDER.map((id) => AREAS[id]);
  assert.equal(list.length, 7);
  assert.equal(list.filter((a) => a.tier === 'region').length, 2);
  assert.equal(list.filter((a) => a.tier === 'scene').length, 3);
  assert.equal(list.filter((a) => a.tier === 'interior').length, 2);
});

test('every area default spawn and every portal destination is walkable with finite ground height', () => {
  for (const areaId of AREA_ORDER) {
    const area = AREAS[areaId];
    const h = getGroundHeight(areaId, area.defaultSpawn.x, area.defaultSpawn.z);
    assert.equal(Number.isFinite(h), true, `finite height for ${areaId} default spawn`);
    assert.equal(
      isPointWalkable(areaId, area.defaultSpawn.x, area.defaultSpawn.z, area.size),
      true,
      `walkable default spawn for ${areaId}`
    );

    for (const portal of area.portals) {
      const target = AREAS[portal.targetArea];
      assert.ok(target, `portal ${portal.id} target exists`);
      const targetH = getGroundHeight(portal.targetArea, portal.spawnX, portal.spawnZ);
      assert.equal(Number.isFinite(targetH), true, `finite target height for ${portal.id}`);
      assert.equal(
        isPointWalkable(portal.targetArea, portal.spawnX, portal.spawnZ, target.size),
        true,
        `walkable portal spawn for ${portal.id} -> ${portal.targetArea}`
      );
    }
  }
});

test('Bianliang monumental XuanDe city wall blocks solid wall but leaves triple arches & Zhou Bridge open', () => {
  const size = AREAS.bianliang_city.size;
  // Central imperial gate tunnel & side pedestrian arches at z = 26
  assert.equal(isPointWalkable('bianliang_city', 0, 26, size), true);
  assert.equal(isPointWalkable('bianliang_city', 15, 26, size), true);
  assert.equal(isPointWalkable('bianliang_city', -15, 26, size), true);
  // Solid battered wall wings blocked
  assert.equal(isPointWalkable('bianliang_city', 30, 26, size), false);
  assert.equal(isPointWalkable('bianliang_city', -30, 26, size), false);
  // Outer moat Zhou Bridge open at center, deep moat blocked at flanks (z = 48)
  assert.equal(isPointWalkable('bianliang_city', 0, 48, size), true);
  assert.equal(isPointWalkable('bianliang_city', 24, 48, size), false);
});

test('Mount Wutai region rises dramatically from south valley to 58+ voxel sacred peaks', () => {
  const southFoot = getGroundHeight('wutai_region', 4, 66);
  const northSummit = getGroundHeight('wutai_region', 0, -72);
  const westSacredPeak = getGroundHeight('wutai_region', -64, -56);
  assert.ok(northSummit > southFoot + 12, 'pilgrimage road ascends steadily toward monastery');
  assert.ok(westSacredPeak > 55, 'sacred mountain peaks tower over 55 voxels high');
});

test('SeedWorld VoxelGrid + Mesher bakes solid AO, 3D bent normals, water caustics & 3D color bleed', () => {
  const grid = new VoxelGrid(20, 18, 20, -10, 0, -10, 1.0);
  grid.fillBoxW(-8, 0, -8, 8, 2, 8, VoxMat.GRASS);
  grid.fillBoxW(-4, 1, 2, 4, 2, 6, VoxMat.WATER);
  grid.buildPavilion(0, 2, -3, 3, VoxMat.JADE_TILE);
  const baked = bakeSeedWorldMesh(grid, { buildBleedVolume: true });

  assert.ok(baked.geometry !== null, 'solid voxel geometry emitted');
  assert.ok(baked.triangleCount > 200, 'rich architectural voxel geometry emitted');
  assert.ok(baked.geometry!.getAttribute('aBentNorm'), '3D bent normal attribute present');
  assert.ok(baked.geometry!.getAttribute('aFlowMeta'), '3D object color flow attribute present');
  assert.ok(baked.geometry!.getAttribute('aLightMeta'), 'SkyGI + AO attribute present');
  assert.ok(baked.waterGeometry !== null, 'water surface geometry emitted');
  assert.ok(baked.bleedTex !== null, '3D flood-fill color bleed texture emitted');
});

test('full 5-chapter Lu Zhishen storyline advances cleanly and transforms identity at Wutai', () => {
  let flags = createInitialQuestFlags();
  assert.equal(getCharacterIdentity(flags), 'luda');
  assert.equal(getActiveObjective(flags).chapter, 1);

  flags = applyDialogueEffect(flags, 'hear_jin_story').nextFlags;
  assert.equal(getActiveObjective(flags).chapter, 2);

  flags = applyDialogueEffect(flags, 'fight_zhengtu').nextFlags;
  assert.equal(getActiveObjective(flags).chapter, 3);

  flags = applyDialogueEffect(flags, 'take_tonsure').nextFlags;
  assert.equal(getCharacterIdentity(flags), 'luzhishen');
  assert.equal(getActiveObjective(flags).chapter, 4);

  flags = applyDialogueEffect(flags, 'receive_letter').nextFlags;
  assert.equal(getActiveObjective(flags).chapter, 5);
  assert.equal(getActiveObjective(flags).targetArea, 'bianliang_city');

  flags = applyDialogueEffect(flags, 'uproot_willow_action').nextFlags;
  assert.equal(getActiveObjective(flags).allCompleted, true);
  assert.match(getNpcDialogue('ruffian_zhangsan', flags).text, /垂杨柳/);
});
