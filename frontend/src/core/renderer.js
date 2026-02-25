import * as THREE from 'three';

/**
 * Creates and configures the WebGL renderer, appends it to #gameContainer.
 * Canvas is sized to fill the container.
 */
export function createRenderer() {
  const container = document.getElementById('gameContainer');

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance'
  });

  const width = container.clientWidth || window.innerWidth - 320;
  const height = container.clientHeight || window.innerHeight - 100;
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  container.appendChild(renderer.domElement);
  return renderer;
}
