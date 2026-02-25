/**
 * Central event listener registry.
 * ALL addEventListener calls live here for easy tracking and cleanup.
 */
import { ControlPanel } from '../scene/controlPanel.js';

export class EventManager {
  static setup(game) {
    this.setupKeyboard(game);
    this.setupMouse(game);
    this.setupPointerLock(game);
    this.setupWindow(game);
  }

  static setupKeyboard(game) {
    const movementKeys = [
      'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
      'w', 'a', 's', 'd', ' '
    ];

    // Helper: cancel an active fix
    function cancelFixing() {
      const fixingPanelId = game.character._fixingPanelId;
      game.character.isFixing = false;
      game.character._fixingPanelId = null;
      if (game.character._fixSafetyTimeout) {
        clearTimeout(game.character._fixSafetyTimeout);
        game.character._fixSafetyTimeout = null;
      }
      const lp = game.players.get(game.playerId);
      if (lp?._model) {
        lp._model.isFixing = false;
        lp._model.playAnimation('Idle');
      }
      if (game.ws?.readyState === WebSocket.OPEN && fixingPanelId != null) {
        game.ws.send(JSON.stringify({ type: 'stopFix', panelId: fixingPanelId }));
      }
    }

    window.addEventListener('keydown', (e) => {
      game.inputState.keys[e.key.toLowerCase()] = true;

      if (movementKeys.includes(e.key.toLowerCase())) {
        e.preventDefault();
        // Cancel fixing if player tries to move or jump
        if (game.character.isFixing) {
          cancelFixing();
          return;
        }
      }

      // Animation debug keys
      if (e.key === 'i' || e.key === 'I') {
        const localPlayer = game.players.get(game.playerId);
        if (localPlayer?._model) localPlayer._model.playAnimation('Idle');
      }
      if (e.key === 'r' || e.key === 'R') {
        const localPlayer = game.players.get(game.playerId);
        if (localPlayer?._model) localPlayer._model.playAnimation('Run');
      }

      // Attack: press Q to kick a player in front of you
      if ((e.key === 'q' || e.key === 'Q') && !e.repeat) {
        if (game.character.isDead) return;
        if (game.character.isAttacking || game.character.isFixing) return;

        // Lock movement
        game.character.isAttacking = true;

        // Play Kick animation on local model
        const localPlayer = game.players.get(game.playerId);
        if (localPlayer?._model) {
          localPlayer._model.isAttacking = true;
          localPlayer._model.playAnimation('Kick');
        }

        // Send attack to server with position and yaw — server does hit detection
        const attackerPos = game.character.getPosition();
        const attackerYaw = game.character.getYaw();
        if (game.ws?.readyState === WebSocket.OPEN) {
          game.ws.send(JSON.stringify({
            type: 'playerAttack',
            x: attackerPos.x,
            y: attackerPos.y,
            z: attackerPos.z,
            yaw: attackerYaw
          }));
        }

        // After kick animation duration, unlock movement
        setTimeout(() => {
          game.character.isAttacking = false;
          if (localPlayer?._model) {
            localPlayer._model.isAttacking = false;
            localPlayer._model.playAnimation('Idle');
          }
        }, 1000);
      }

      // Toggle spotlight: press E
      if ((e.key === 'e' || e.key === 'E') && !e.repeat) {
        if (game.character.isDead) return;
        const spotlightOn = game.scene3d.toggleSpotlight();
        const localPlayer = game.players.get(game.playerId);
        if (localPlayer?._model) {
          localPlayer._model.spotlightOn = spotlightOn;
        }
        if (game.ws?.readyState === WebSocket.OPEN) {
          game.ws.send(JSON.stringify({ type: 'toggleSpotlight', spotlightOn }));
        }
      }

      // Fix interaction: press F near a broken control panel
      if ((e.key === 'f' || e.key === 'F') && !e.repeat) {
        // Dead players cannot fix panels
        if (game.character.isDead) return;
        if (game.ws?.readyState !== WebSocket.OPEN) return;
        if (!game.character.isFixing) {
          const playerPos = game.character.getPosition();
          const panel = ControlPanel.getNearestFixablePanel(playerPos, 12);
          if (panel) {
            // Lock movement
            game.character.isFixing = true;
            game.character._fixingPanelId = panel.id;

            // Face the control panel
            const panelPos = panel.model.position;
            const dx = panelPos.x - playerPos.x;
            const dz = panelPos.z - playerPos.z;
            const yawToPanel = Math.atan2(dx, dz);
            game.character.yaw = yawToPanel;
            game.character.rotation.y = yawToPanel;

            // Play Fix animation on local model
            const localPlayer = game.players.get(game.playerId);
            if (localPlayer?._model) {
              localPlayer._model.isFixing = true;
              localPlayer._model.playAnimation('Fix');
            }

            // Notify server — server will increase HP by 1/sec and send fixingStopped when done
            game.ws.send(JSON.stringify({ type: 'startFix', panelId: panel.id }));

            // Safety timeout: if server never responds, unlock after 20s
            game.character._fixSafetyTimeout = setTimeout(() => {
              if (game.character.isFixing) {
                game.character.isFixing = false;
                game.character._fixingPanelId = null;
                const lp = game.players.get(game.playerId);
                if (lp?._model) {
                  lp._model.isFixing = false;
                  lp._model.playAnimation('Idle');
                }
                console.warn('Fix safety timeout — forcibly unlocked character');
              }
            }, 20000);
          }
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      game.inputState.keys[e.key.toLowerCase()] = false;
    });
  }

  static setupMouse(game) {
    document.addEventListener('mousemove', (e) => {
      if (!game.inputState.isPointerLocked) return;
      if (game.character.isFixing || game.character.isAttacking) return;

      game.character.yaw -= e.movementX * game.fpsCamera.mouseSensitivity;
      game.fpsCamera.pitch -= e.movementY * game.fpsCamera.mouseSensitivity;
      game.fpsCamera.pitch = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, game.fpsCamera.pitch)
      );
    });
  }

  static setupPointerLock(game) {
    const domElement = game.renderer.domElement;

    document.addEventListener('click', (e) => {
      // Don't re-lock pointer when game-over overlay is showing
      if (document.getElementById('gameOverOverlay')) return;
      domElement.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      game.inputState.isPointerLocked =
        document.pointerLockElement === domElement;
    });
  }

  static setupWindow(game) {
    window.addEventListener('resize', () => {
      const width = window.innerWidth - 320;
      const height = window.innerHeight - 100;
      game.camera.aspect = width / height;
      game.camera.updateProjectionMatrix();
      game.renderer.setSize(width, height);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) game.clock.getElapsedTime();
    });
  }
}