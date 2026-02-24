import * as THREE from 'three';

const CHARACTER_HEIGHT = 2;
const GROUND_CHECK_DISTANCE = 5;

const RAY_OFFSETS = [
  new THREE.Vector3(0, 1, 5),
  new THREE.Vector3(4, 1, 4),
  new THREE.Vector3(-4, 1, 4),
  new THREE.Vector3(4, 1, 0),
  new THREE.Vector3(-4, 1, 0),
  new THREE.Vector3(4, 1, -4),
  new THREE.Vector3(-4, 1, -4),
  new THREE.Vector3(0, 1, -3),
];

const _raycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _downDir = new THREE.Vector3(0, -1, 0);

/**
 * Cast multiple rays to detect horizontal collisions.
 * Returns the first hit within distance 1, or null.
 */
export function checkCollisionMultiRay(position, direction, shipMeshes) {
  for (const offset of RAY_OFFSETS) {
    _rayOrigin.copy(position).add(offset);
    _raycaster.set(_rayOrigin, direction);
    const hits = _raycaster.intersectObjects(shipMeshes, false);
    if (hits.length > 0 && hits[0].distance < 1) return hits[0];
  }
  return null;
}

/**
 * Snap the character to the surface below via downward raycast.
 * Mutates position and velocity. Returns true if on ground.
 */
export function stickToSurface(position, velocity, shipMeshes) {
  _raycaster.set(position, _downDir);
  const intersects = _raycaster.intersectObjects(shipMeshes, false);

  if (intersects.length > 0) {
    const surfacePoint = intersects[0].point;
    const distanceToSurface = position.y - surfacePoint.y;

    if (velocity.y <= 0 && distanceToSurface < GROUND_CHECK_DISTANCE) {
      position.y = surfacePoint.y + CHARACTER_HEIGHT / 2;
      velocity.y = 0;
      return true;
    }
  }
  return false;
}
