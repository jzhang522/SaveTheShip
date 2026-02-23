import * as THREE from 'three';

/**
 * Creates and configures the WebGL renderer, appends it to #gameContainer.
 */
export function createRenderer() {
  const container = document.getElementById('gameContainer');

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance'
  });

  renderer.setSize(window.innerWidth - 320, window.innerHeight - 100);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  container.appendChild(renderer.domElement);
  return renderer;
}
