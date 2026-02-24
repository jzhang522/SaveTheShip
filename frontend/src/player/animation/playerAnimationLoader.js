import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FBXLoader } from '../../loaders/fbxLoader.js';
import { AnimationManager } from './animationManager.js';
import { generateRandomColor, applyPlayerColor } from './playerColorUtils.js';

// Shared loader instance
const loader = new FBXLoader();

// Cache: loaded once, reused for every player
let cachedBaseModel = null;   // The Idle FBX (model + skeleton)
let cachedIdleClip = null;    // Idle animation clip
let cachedRunClip = null;     // Run animation clip (root-motion filtered)
let cachedFixClip = null;     // Fix animation clip
let cachedKickClip = null;    // Kick animation clip
let cacheReady = false;
let cacheLoading = false;
const pendingPlayers = [];    // Players waiting for cache to be ready

export class PlayerAnimationLoader {
  static generateRandomColor = generateRandomColor;

  static loadAnimations(player) {
    if (cacheReady) {
      this._applyToPlayer(player);
      return;
    }

    pendingPlayers.push(player);

    if (!cacheLoading) {
      cacheLoading = true;
      this._loadAllAssets();
    }
  }

  static _loadAllAssets() {
    loader.load('/Idle.fbx', (idleModel) => {
      try {
        cachedBaseModel = idleModel;
        cachedIdleClip = idleModel.animations[0];

        loader.load('/Run.fbx', (runModel) => {
          try {
            const runClip = runModel.animations[1];
            cachedRunClip = this._filterRootMotion(runClip);

            loader.load('/Fix.fbx', (fixModel) => {
              try {
                cachedFixClip = fixModel.animations[0] || null;
              } catch (error) {
                console.warn('FBX Fix animation error:', error);
              }

              // Load Kick animation
              loader.load('/Kick.fbx', (kickModel) => {
                try {
                  cachedKickClip = kickModel.animations[0] || null;
                } catch (error) {
                  console.warn('FBX Kick animation error:', error);
                }

                // All assets loaded — apply to all pending players
                cacheReady = true;
                for (const p of pendingPlayers) {
                  this._applyToPlayer(p);
                }
                pendingPlayers.length = 0;
              }, undefined, (error) => {
                console.warn('FBX kick loading failed:', error);
                // Still mark cache ready even if kick fails
                cacheReady = true;
                for (const p of pendingPlayers) {
                  this._applyToPlayer(p);
                }
                pendingPlayers.length = 0;
              });
            }, undefined, (error) => {
              console.warn('FBX fix loading failed:', error);
            });
          } catch (error) {
            console.warn('FBX run model error:', error);
          }
        }, undefined, (error) => {
          console.warn('FBX run loading failed:', error);
        });
      } catch (error) {
        console.warn('FBX idle model error:', error);
      }
    }, undefined, (error) => {
      console.warn('FBX idle loading failed:', error);
    });
  }

  static _applyToPlayer(player) {
    try {
      const model = SkeletonUtils.clone(cachedBaseModel);
      model.position.y = 0;
      model.scale.set(0.1, 0.1, 0.1);

      // Deep-clone geometry and material per mesh so vertex colors don't bleed between players
      model.traverse((child) => {
        if (child.isMesh) {
          child.geometry = child.geometry.clone();
          child.material = child.material.clone();
        }
      });

      applyPlayerColor(model, player.color);
      player.group.add(model);
      player.fbxModel = model;

      player.animationManager = new AnimationManager(model);

      if (cachedIdleClip) {
        player.animationManager.addAnimation('Idle', cachedIdleClip.clone());
        player.idleAnimationName = 'Idle';
      }
      if (cachedRunClip) {
        player.animationManager.addAnimation('Run', cachedRunClip.clone());
        player.runAnimationName = 'Run';
      }
      if (cachedFixClip) {
        player.animationManager.addAnimation('Fix', cachedFixClip.clone());
        player.fixAnimationName = 'Fix';
      }
      if (cachedKickClip) {
        player.animationManager.addAnimation('Kick', cachedKickClip.clone());
        player.kickAnimationName = 'Kick';
      }

      player.fbxLoaded = true;
      player.playAnimation(player.idleAnimationName);
    } catch (error) {
      console.warn('Player animation apply error:', error);
    }
  }

  static _filterRootMotion(clip) {
    if (!clip?.tracks.length) return clip;

    const boneNames = new Set();
    clip.tracks.forEach(track => {
      const name = track.name.split('.')[0];
      if (name) boneNames.add(name);
    });

    const rootBoneName =
      ['Armature', 'Root', 'root', 'CTRL_root']
        .find(n => boneNames.has(n)) || Array.from(boneNames)[0];

    const filteredTracks = clip.tracks.filter(track => {
      const bone = track.name.split('.')[0];
      const prop = track.name.split('.')[1];
      return !(bone === rootBoneName && prop === 'position');
    });

    return new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
  }
}
