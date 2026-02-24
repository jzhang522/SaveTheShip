import * as THREE from 'three';
import { checkCollisionMultiRay, stickToSurface } from './characterCollision.js';

// Spawn position constants
const SPAWN_X = 0;
const SPAWN_Y = 25;
const SPAWN_Z = -225;
const DEATH_Y_THRESHOLD = -30;

export class Character {
  constructor(inputState) {
    this.inputState = inputState;

    this.position = new THREE.Vector3(
      SPAWN_X + Math.random() * 30 - 15,
      SPAWN_Y,
      SPAWN_Z + Math.random() * 30 - 15
    );
    this.rotation = new THREE.Euler(0, 0, 0);
    this.velocity = new THREE.Vector3();

    this.speed = 12;
    this.turnSpeed = 3;
    this.jumpForce = 1.5;
    this.gravity = 2.5;
    this.friction = 0.00015; // per-second exponential friction base
    this.onGround = true;
    this.yaw = 0;

    this.isFixing = false;
    this.isAttacking = false;

    // HP system
    this.maxHp = 3;
    this.hp = this.maxHp;
    this.isDead = false;
    this._onHpChange = null; // callback: (hp, maxHp, isDead) => void
    this._onDeath = null;    // callback: () => void

    this.shipMeshes = [];

    // Reusable vectors
    this._forward = new THREE.Vector3();
    this._movement = new THREE.Vector3();
    this._horizontalVel = new THREE.Vector3();
    this._returnPos = new THREE.Vector3();
    this._tempVec = new THREE.Vector3();
  }

  setShipMeshes(meshes) {
    this.shipMeshes = meshes;
  }

  /**
   * Remove one heart. If HP reaches 0, the player dies.
   * Otherwise, warp to spawn.
   */
  takeDamage() {
    if (this.isDead) return;
    this.hp = Math.max(0, this.hp - 1);
    if (this._onHpChange) this._onHpChange(this.hp, this.maxHp, this.isDead);
    if (this.hp <= 0) {
      this.die();
    }
  }

  /**
   * Kill the player: warp to spawn, enter dead/ghost mode.
   */
  die() {
    this.isDead = true;
    this.warpToSpawn();
    if (this._onHpChange) this._onHpChange(this.hp, this.maxHp, this.isDead);
    if (this._onDeath) this._onDeath();
  }

  /**
   * Teleport the character back to the spawn area.
   */
  warpToSpawn() {
    this.position.set(
      SPAWN_X + Math.random() * 30 - 15,
      SPAWN_Y,
      SPAWN_Z + Math.random() * 30 - 15
    );
    this.velocity.set(0, 0, 0);
    this.onGround = true;
  }

  update(deltaTime = 0.016) {
    if (this.isFixing || this.isAttacking) return;

    // Clamp deltaTime to prevent huge jumps when returning from another tab
    const dt = Math.min(deltaTime, 0.05);

    const keys = this.inputState.getKeys();
    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._movement.set(0, 0, 0);

    if (keys['w'] || keys['arrowup']) this._movement.add(this._tempVec.copy(this._forward).negate());
    if (keys['s'] || keys['arrowdown']) this._movement.add(this._forward);
    if (keys['d'] || keys['arrowright']) this.yaw -= this.turnSpeed * dt;
    if (keys['a'] || keys['arrowleft']) this.yaw += this.turnSpeed * dt;
    if (keys['1']) console.log('Position:', this.position);

    if (this._movement.length() > 0) {
      this._movement.normalize();
      this.velocity.add(this._movement.multiplyScalar(this.speed * dt));
    }

    // Friction and gravity (frame-rate independent)
    const frictionFactor = Math.pow(this.friction, dt);
    this.velocity.x *= frictionFactor;
    this.velocity.z *= frictionFactor;
    this.velocity.y -= this.gravity * dt;

    // Jumping
    if ((keys[' '] || keys['space']) && this.onGround) {
      this.velocity.y = this.jumpForce;
      this.onGround = false;
    }

    // Horizontal collision check
    this._horizontalVel.set(this.velocity.x, 0, this.velocity.z);
    if (this._horizontalVel.length() > 0) {
      const direction = this._horizontalVel.normalize();
      if (checkCollisionMultiRay(this.position, direction, this.shipMeshes)) {
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
    }

    // Death by falling
    if (this.position.y < DEATH_Y_THRESHOLD) {
      this.takeDamage();
      this.takeDamage();
      this.takeDamage();
      return;
    }

    this.position.add(this.velocity);
    this.onGround = stickToSurface(this.position, this.velocity, this.shipMeshes);
    this.rotation.y = this.yaw;
  }

  getPosition() {
    return this._returnPos.copy(this.position);
  }

  getYaw() {
    return this.yaw;
  }

  setPosition(x, y, z) {
    this.position.set(x, y, z);
  }
}

