import { CharacterAnimation } from '../player/characterAnimation.js';
import { GameStateManager } from './gameStateManager.js';
import { generateRandomColor } from '../player/animation/playerColorUtils.js';
import { ControlPanel } from '../scene/controlPanel.js';

export class MessageHandler {
  static handleMessage(game, message) {
    switch (message.type) {
      case 'welcomeMessage':
        this.handleWelcomeMessage(game, message);
        break;
      case 'gameState':
        GameStateManager.updateGameState(game, message);
        break;
      case 'panelsNeedFix':
        this.handlePanelsNeedFix(game, message);
        break;
      case 'panelHpUpdate':
        this.handlePanelHpUpdate(game, message);
        break;
      case 'playerFixing':
        this.handlePlayerFixing(game, message);
        break;
      case 'panelFixed':
        this.handlePanelFixed(game, message);
        break;
      case 'fixingStopped':
        this.handleFixingStopped(game, message);
        break;
      case 'spotlightToggle':
        this.handleSpotlightToggle(game, message);
        break;
      case 'playerAttacking':
        this.handlePlayerAttacking(game, message);
        break;
      case 'playerHit':
        this.handlePlayerHit(game, message);
        break;
    }
  }

  static handleWelcomeMessage(game, message) {
    game.playerId = message.playerId;
    game.gameId = message.gameId;

    document.getElementById('gameId').textContent = game.gameId;
    document.getElementById('playerId').textContent = game.playerId.substr(0, 8);
    document.getElementById('instructions').textContent = 'Click to lock mouse, use WASD to move, mouse to look';

    this.createLocalPlayer(game, message.color);
  }

  static createLocalPlayer(game, serverColor) {
    if (!game.players.has(game.playerId)) {
      const color = serverColor ?? generateRandomColor();
      const localPlayer = new CharacterAnimation(game.playerId, game.playerName, true, color);
      game.players.set(game.playerId, {
        id: game.playerId,
        name: game.playerName,
        color: color,
        x: 0,
        y: 0,
        z: 0,
        _model: localPlayer
      });
      game.scene3d.addObject(localPlayer.getGroup());
      console.log('✓ Local player created with color:', color.toString(16));
    }
  }

  static handlePanelsNeedFix(game, message) {
    const panelIds = message.panelIds;
    const panelHP = message.panelHP || {};
    ControlPanel.setNeedFix(panelIds, panelHP);
    console.log('⚠ Panels need fix:', panelIds);
  }

  static handlePanelHpUpdate(game, message) {
    ControlPanel.updatePanelHp(message.panelId, message.hp);
  }

  static handlePlayerFixing(game, message) {
    // Another player started fixing — play Fix animation on their character
    const character = game.otherPlayers.get(message.playerId);
    if (character) {
      character.isFixing = true;
      character.playAnimation('Fix');
      // Safety timeout: auto-stop fix animation after 20s if fixingStopped never arrives
      if (character._fixSafetyTimeout) clearTimeout(character._fixSafetyTimeout);
      character._fixSafetyTimeout = setTimeout(() => {
        if (character.isFixing) {
          character.isFixing = false;
          character.playAnimation('Idle');
        }
      }, 20000);
    }
  }

  static handlePanelFixed(game, message) {
    ControlPanel.fixPanel(message.panelId);
    console.log(`✓ Panel ${message.panelId} has been fixed!`);
  }

  static handleFixingStopped(game, message) {
    // If this is the local player, stop fixing animation and unlock movement
    if (message.playerId === game.playerId) {
      game.character.isFixing = false;
      game.character._fixingPanelId = null;
      // Clear safety timeout
      if (game.character._fixSafetyTimeout) {
        clearTimeout(game.character._fixSafetyTimeout);
        game.character._fixSafetyTimeout = null;
      }
      const localPlayer = game.players.get(game.playerId);
      if (localPlayer?._model) {
        localPlayer._model.isFixing = false;
        localPlayer._model.playAnimation('Idle');
      }
    } else {
      // Remote player stopped fixing
      const character = game.otherPlayers.get(message.playerId);
      if (character) {
        if (character._fixSafetyTimeout) {
          clearTimeout(character._fixSafetyTimeout);
          character._fixSafetyTimeout = null;
        }
        character.isFixing = false;
        character.playAnimation('Idle');
      }
    }
  }

  static handleSpotlightToggle(game, message) {
    const character = game.otherPlayers.get(message.playerId);
    if (character) {
      character.setSpotlightVisible(message.spotlightOn);
    }
  }

  static handlePlayerAttacking(game, message) {
    // Another player is attacking — play Kick animation on their character
    const character = game.otherPlayers.get(message.playerId);
    if (character) {
      character.isAttacking = true;
      character.playAnimation('Kick');
      setTimeout(() => {
        character.isAttacking = false;
        character.playAnimation('Idle');
      }, 1000);
    }
  }

  static handlePlayerHit(game, message) {
    // This local player was hit by another player's attack
    if (message.targetId === game.playerId) {
      if (game.character && !game.character.isDead) {
        // Cancel fixing if player is hit while fixing
        if (game.character.isFixing) {
          const fixingPanelId = game.character._fixingPanelId;
          game.character.isFixing = false;
          game.character._fixingPanelId = null;
          if (game.character._fixSafetyTimeout) {
            clearTimeout(game.character._fixSafetyTimeout);
            game.character._fixSafetyTimeout = null;
          }
          const localPlayer = game.players.get(game.playerId);
          if (localPlayer?._model) {
            localPlayer._model.isFixing = false;
            localPlayer._model.playAnimation('Idle');
          }
          // Tell server to stop the fixing interval
          if (game.ws?.readyState === WebSocket.OPEN && fixingPanelId != null) {
            game.ws.send(JSON.stringify({ type: 'stopFix', panelId: fixingPanelId }));
          }
        }
        game.character.takeDamage();
        console.log(`⚔ You were hit by ${message.attackerId}! HP: ${game.character.hp}`);
      }
    }
  }
}
