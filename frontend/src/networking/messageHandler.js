import { CharacterAnimation } from '../player/characterAnimation.js';
import { GameStateManager } from './gameStateManager.js';
import { generateRandomColor } from '../player/animation/playerColorUtils.js';
import { ControlPanel } from '../scene/controlPanel.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function colorToHex(colorNum) {
  if (colorNum == null) return '#6b7a9e';
  const n = typeof colorNum === 'number' ? colorNum : parseInt(String(colorNum).replace('#', ''), 16);
  return '#' + (n >>> 0).toString(16).padStart(6, '0');
}

export class MessageHandler {
  static handleMessage(game, message) {
    if (message.type === 'welcomeMessage') {
      this.handleWelcomeMessage(game, message);
    }

    if (message.type === 'gameState') {
      GameStateManager.updateGameState(game, message);
    }

    if (message.type === 'panelsNeedFix') {
      this.handlePanelsNeedFix(game, message);
    }

    if (message.type === 'playerFixing') {
      this.handlePlayerFixing(game, message);
    }

    if (message.type === 'panelFixed') {
      this.handlePanelFixed(game, message);
    }

    if (message.type === 'chat') {
      this.handleChatMessage(game, message);
    }
  }

  static handleChatMessage(game, message) {
    const container = document.querySelector('.chat-messages');
    if (!container) return;
    const isOwn = message.playerId === game.playerId;
    if (!isOwn) {
      const chatWindow = document.getElementById('chatWindow');
      if (chatWindow && !chatWindow.classList.contains('open')) {
        chatWindow.classList.add('open');
        chatWindow.setAttribute('aria-hidden', 'false');
      }
    }
    const el = document.createElement('div');
    el.className = 'chat-message';
    const color = message.color ?? game.players.get(message.playerId)?.color ?? game.otherPlayers.get(message.playerId)?.color;
    const accentHex = colorToHex(color);
    el.style.setProperty('--chat-accent', accentHex);
    el.innerHTML = `<span class="chat-sender"><span class="chat-sender-dot" style="background-color:${accentHex}"></span>${escapeHtml(message.playerName || message.playerId)}</span><span class="chat-text">${escapeHtml(message.text)}</span>`;
    if (isOwn) el.classList.add('chat-message-own');
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  static handleWelcomeMessage(game, message) {
    game.playerId = message.playerId;
    game.gameId = message.gameId;

    document.getElementById('gameId').textContent = game.gameId;
    document.getElementById('playerId').textContent = game.playerId.substr(0, 8);
    document.getElementById('instructions').textContent = 'Click to lock mouse, use WASD to move, mouse to look';

    this.createLocalPlayer(game);
  }

  static createLocalPlayer(game) {
    if (!game.players.has(game.playerId)) {
      const randomColor = generateRandomColor();
      const localPlayer = new CharacterAnimation(game.playerId, game.playerName, true, randomColor);
      game.players.set(game.playerId, {
        id: game.playerId,
        name: game.playerName,
        color: randomColor,
        x: 0,
        y: 0,
        z: 0,
        _model: localPlayer
      });
      game.scene3d.addObject(localPlayer.getGroup());
      console.log('✓ Local player created with color:', randomColor.toString(16));
    }
  }

  static handlePanelsNeedFix(game, message) {
    const panelIds = message.panelIds; // Array of panel IDs that need fixing
    ControlPanel.setNeedFix(panelIds);
    console.log('⚠ Panels need fix:', panelIds);
  }

  static handlePlayerFixing(game, message) {
    // Another player started fixing — play Fix animation on their character
    const character = game.otherPlayers.get(message.playerId);
    if (character) {
      character.isFixing = true;
      character.playAnimation('Fix');
      setTimeout(() => {
        character.isFixing = false;
        character.playAnimation('Idle');
      }, 5000);
    }
  }

  static handlePanelFixed(game, message) {
    ControlPanel.fixPanel(message.panelId);
    console.log(`✓ Panel ${message.panelId} has been fixed!`);
  }
}
