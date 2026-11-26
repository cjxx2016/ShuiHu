export const SCENES = [
  {
    id: 'seedworld',
    label: 'SeedWorld Tree House',
    subtitle: 'Voxel Lighting Study',
    path: '/simple_scene/seedworld-tree-house_base.html',
  },
  {
    id: 'pagoda',
    label: 'Sakura Pagoda Garden',
    subtitle: 'Procedural Voxel Art',
    path: '/simple_scene/google_ai_studio_pagoda.html',
  },
];

export function resolveScene(id) {
  if (!id || typeof id !== 'string') {
    return SCENES[0];
  }
  const normalized = id.trim().toLowerCase();
  return SCENES.find((scene) => scene.id === normalized) || SCENES[0];
}

/**
 * Rewrites CDN Three.js importmap URLs in standalone scene HTML files to the
 * locally served `/vendor/three/` directory so scenes load deterministically
 * without external CDN dependencies.
 */
export function rewriteImportMap(html) {
  if (typeof html !== 'string') {
    return '';
  }
  return html
    .replace(
      /https:\/\/cdn\.jsdelivr\.net\/npm\/three@[^"']+\/build\/three\.module\.js/g,
      '/vendor/three/build/three.module.js'
    )
    .replace(
      /https:\/\/cdn\.jsdelivr\.net\/npm\/three@[^"']+\/examples\/jsm\//g,
      '/vendor/three/examples/jsm/'
    );
}
