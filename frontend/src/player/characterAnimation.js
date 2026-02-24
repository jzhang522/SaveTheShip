import * as THREE from 'three';
import { PlayerAnimationLoader } from './animation/playerAnimationLoader.js';
import { PlayerNameLabel } from './playerNameLabel.js';
import { createPlayerSpotlight, updateSpotlightForPlayer } from './playerSpotlight.js';

export class CharacterAnimation {
  constructor(id, name, isLocalPlayer = false, color = 0xff0000) {
    this.id = id;
    this.name = name;
    this.isLocalPlayer = isLocalPlayer;
    this.color = color;

    this.position = new THREE.Vector3();
    this.rotation = new THREE.Euler();
    this.lastPosition = new THREE.Vector3();
    this.isMoving = false;
    this.movementThreshold = 0.05;

    this.animationManager = null;
    this.currentAnimation = 'Idle';
    this.idleAnimationName = 'Idle';
    this.runAnimationName = 'Run';
    this.fixAnimationName = 'Fix';
    this.kickAnimationName = 'Kick';
    this.isFixing = false;
    this.isAttacking = false;
    this.spotlightOn = true;

    this.group = new THREE.Group();
    this.fbxModel = null;
    this.fbxLoaded = false;

    this.spotlight = null;
    this.spotlightTarget = null;
    this.nameLabel = null;
    if (!isLocalPlayer) {
      const { spotlight, target } = createPlayerSpotlight();
      this.spotlight = spotlight;
      this.spotlightTarget = target;
      this.nameLabel = PlayerNameLabel.createNameLabel(name, this.group);
    }

    PlayerAnimationLoader.loadAnimations(this);
  }

  setPosition(x, y, z) {
    this.lastPosition.copy(this.position);
    this.position.set(x, y, z);
    this.group.position.copy(this.position);

    const delta = this.lastPosition.distanceTo(this.position);
    const wasMoving = this.isMoving;
    this.isMoving = delta > this.movementThreshold;

    if (this.fbxLoaded && this.animationManager && this.isMoving !== wasMoving && !this.isFixing && !this.isAttacking) {
      this.playAnimation(this.isMoving ? this.runAnimationName : this.idleAnimationName);
    }
  }

  setRotation(x, y, z) {
    this.rotation.set(x, y, z);
    this.group.rotation.copy(this.rotation);
  }

  playAnimation(name) {
    if (!this.fbxLoaded || !this.animationManager) return;
    this.currentAnimation = name;
    if (this.animationManager.animations.has(name)) {
      this.animationManager.playAnimationWithBlend(name, 0.3);
    }
  }

  update(x, y, z, deltaTime = 0.016, yaw = 0) {
    this.setPosition(x, y, z);
    this.setRotation(0, yaw, 0);

    if (this.spotlight) {
      updateSpotlightForPlayer(this.spotlight, this.spotlightTarget, x, y, z, yaw);
    }
    if (this.animationManager) {
      this.animationManager.update(deltaTime);
    }
  }

  toggleSpotlight() {
    this.spotlightOn = !this.spotlightOn;
    if (this.spotlight) {
      this.spotlight.visible = this.spotlightOn;
    }
    return this.spotlightOn;
  }

  setSpotlightVisible(visible) {
    this.spotlightOn = visible;
    if (this.spotlight) {
      this.spotlight.visible = visible;
    }
    if (this.nameLabel) {
      this.nameLabel.visible = visible;
    }
  }

  getGroup() { return this.group; }
  getPosition() { return this.position.clone(); }

  dispose() {
    if (this.spotlight) {
      if (this.spotlight.parent) this.spotlight.parent.remove(this.spotlight);
      if (this.spotlightTarget?.parent) this.spotlightTarget.parent.remove(this.spotlightTarget);
      this.spotlight.dispose();
      this.spotlight = null;
      this.spotlightTarget = null;
    }
    if (this.animationManager) this.animationManager.dispose();
  }
}
