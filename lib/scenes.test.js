import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, resolveScene, rewriteImportMap } from './scenes.js';

test('resolveScene returns default SeedWorld scene for empty or unknown ids', () => {
  assert.equal(resolveScene(undefined).id, 'seedworld');
  assert.equal(resolveScene('').id, 'seedworld');
  assert.equal(resolveScene('unknown').id, 'seedworld');
});

test('resolveScene matches known scene ids case-insensitively', () => {
  assert.equal(resolveScene('pagoda').path, '/simple_scene/google_ai_studio_pagoda.html');
  assert.equal(resolveScene('PAGODA').id, 'pagoda');
  assert.equal(resolveScene(' seedworld ').path, '/simple_scene/seedworld-tree-house_base.html');
});

test('rewriteImportMap replaces jsdelivr Three.js URLs with local vendor paths', () => {
  const sampleHtml = `<script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
  </script>`;
  const rewritten = rewriteImportMap(sampleHtml);
  assert.match(rewritten, /"three": "\/vendor\/three\/build\/three\.module\.js"/);
  assert.match(rewritten, /"three\/addons\/": "\/vendor\/three\/examples\/jsm\/"/);
  assert.equal(rewritten.includes('cdn.jsdelivr.net'), false);
});

test('SCENES list contains both imported HTML scenes', () => {
  assert.equal(SCENES.length, 2);
  assert.deepEqual(
    SCENES.map((s) => s.id),
    ['seedworld', 'pagoda']
  );
});
