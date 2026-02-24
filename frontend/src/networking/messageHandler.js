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
      case 'roleAssignment':
        this.handleRoleAssignment(game, message);
        break;
      case 'gameTimer':
        this.handleGameTimer(game, message);
        break;
      case 'gameOver':
        this.handleGameOver(game, message);
        break;
      case 'error':
        this.handleError(game, message);
        break;
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

    // Show notification when a panel first becomes damaged
    if (message.wasDamaged) {
      this.showPanelDamagedNotification(message.panelId);
    }
  }

  static showPanelDamagedNotification(panelId) {
    // Ensure container exists inside game container so it renders above the canvas
    let container = document.getElementById('panelNotifications');
    if (!container) {
      container = document.createElement('div');
      container.id = 'panelNotifications';
      Object.assign(container.style, {
        position: 'fixed',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        zIndex: '99999',
        pointerEvents: 'none',
      });
      document.body.appendChild(container);
    }

    const el = document.createElement('div');
    Object.assign(el.style, {
      padding: '10px 24px',
      background: 'rgba(200, 30, 30, 0.88)',
      color: '#fff',
      fontSize: '15px',
      fontWeight: '600',
      borderRadius: '8px',
      border: '1px solid rgba(255, 80, 80, 0.6)',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
      whiteSpace: 'nowrap',
      opacity: '0',
      transition: 'opacity 0.3s ease, transform 0.3s ease',
      transform: 'translateY(-20px)',
    });
    el.textContent = `Control Panel #${panelId} has been damaged!`;
    container.appendChild(el);

    // Trigger entrance animation on next frame
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });

    console.log(`⚠ Notification: Control Panel #${panelId} has been damaged!`);

    // Fade out and remove after 5 seconds
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-16px)';
      setTimeout(() => el.remove(), 400);
    }, 5000);
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

  static handleRoleAssignment(game, message) {
    game.role = message.role;
    game.character.maxHp = message.maxHp;
    game.character.hp = message.hp;
    game.character.isDead = false;

    // Update hearts UI with new maxHp
    game.updateHeartsUI(message.hp, message.maxHp);

    // Show role banner
    this.showRoleBanner(game, message.role);
    console.log(`Role assigned: ${message.role} (HP: ${message.hp}/${message.maxHp})`);
  }

  static showRoleBanner(game, role) {
    const existing = document.getElementById('roleBanner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'roleBanner';
    banner.className = `role-banner role-${role}`;
    banner.innerHTML = `
      <div class="role-banner-content">
        <span class="role-icon">${role === 'saboteur' ? '🔥' : '🔧'}</span>
        <span class="role-text">You are the <strong>${role === 'saboteur' ? 'SABOTEUR' : 'CREW'}</strong></span>
        <span class="role-desc">${role === 'saboteur' ? 'Destroy all panels and eliminate the crew!' : 'Repair the panels and survive for 15 minutes!'}</span>
      </div>
    `;
    document.body.appendChild(banner);

    // Show the role indicator permanently
    this.showRoleIndicator(game, role);

    // Fade out banner after 5 seconds
    setTimeout(() => {
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 600);
    }, 5000);
  }

  static showRoleIndicator(game, role) {
    let indicator = document.getElementById('roleIndicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'roleIndicator';
      const container = document.getElementById('gameContainer');
      if (container) container.appendChild(indicator);
    }
    indicator.className = `role-indicator role-${role}`;
    indicator.textContent = role === 'saboteur' ? '🔥 SABOTEUR' : '🔧 CREW';
  }

  static handleGameTimer(game, message) {
    const remaining = message.remainingMs;
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    let timerEl = document.getElementById('gameTimer');
    if (!timerEl) {
      timerEl = document.createElement('div');
      timerEl.id = 'gameTimer';
      timerEl.className = 'game-timer';
      const container = document.getElementById('gameContainer');
      if (container) container.appendChild(timerEl);
    }
    timerEl.textContent = timeStr;

    // Add urgency class when under 2 minutes
    if (remaining < 120000) {
      timerEl.classList.add('urgent');
    } else {
      timerEl.classList.remove('urgent');
    }
  }

  static handleGameOver(game, message) {
    const { winningTeam, reason } = message;
    const playerRole = game.role || 'crew';
    const isWinner = playerRole === winningTeam;

    console.log(`[GameOver] received: winningTeam=${winningTeam}, reason=${reason}, playerRole=${playerRole}, isWinner=${isWinner}`);

    // Remove any existing overlay
    const existing = document.getElementById('gameOverOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'gameOverOverlay';

    // Inline all styles to guarantee visibility regardless of CSS load state
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      background: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '2147483647', // max z-index
      opacity: '1',
    });

    const boxBg = isWinner
      ? 'background: rgba(20, 80, 20, 0.95); border: 2px solid rgba(80, 255, 80, 0.5); box-shadow: 0 0 80px rgba(50, 255, 50, 0.25);'
      : 'background: rgba(80, 15, 15, 0.95); border: 2px solid rgba(255, 80, 80, 0.5); box-shadow: 0 0 80px rgba(255, 50, 50, 0.25);';

    const resultGlow = isWinner
      ? 'text-shadow: 0 0 30px rgba(100, 255, 100, 0.5);'
      : 'text-shadow: 0 0 30px rgba(255, 100, 100, 0.5);';

    overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:48px 64px;border-radius:20px;text-align:center;${boxBg}">
        <div style="font-size:48px;font-weight:900;letter-spacing:6px;color:#fff;${resultGlow}">${isWinner ? 'VICTORY' : 'DEFEAT'}</div>
        <div style="font-size:24px;color:rgba(255,255,255,0.9);font-weight:600;">${winningTeam === 'saboteur' ? '🔥 Saboteur' : '🔧 Crew'} Wins!</div>
        <div style="font-size:15px;color:rgba(255,255,255,0.65);max-width:400px;">${reason}</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.5);margin-top:4px;">You were: <strong>${playerRole === 'saboteur' ? '🔥 Saboteur' : '🔧 Crew'}</strong></div>
        ${this.getScoreStatsHtml(game, message)}
        <button id="newGameBtn" style="margin-top:20px;padding:14px 48px;font-size:18px;font-weight:700;border:none;border-radius:10px;cursor:pointer;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;letter-spacing:1px;box-shadow:0 4px 20px rgba(102,126,234,0.4);">New Game</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // Exit pointer lock so the cursor is visible for the button
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // New Game button → go back to index
    document.getElementById('newGameBtn')?.addEventListener('click', () => {
      sessionStorage.removeItem('gameContext');
      window.location.href = 'index.html';
    });
  }

  static handleError(game, message) {
    sessionStorage.removeItem('gameContext');
    window.location.href = 'index.html';
  }

  // --- Score/Stats UI ---
  static getScoreStatsHtml(game, message) {
    let statsHtml = '';
    if (message.playerStats && game.playerId && message.playerStats[game.playerId]) {
      const stats = message.playerStats[game.playerId];
      statsHtml = `<div style="margin-top:18px;font-size:18px;color:#fff;font-weight:700;">Score: <span style='color:#ffe066;'>${stats.score}</span></div>`;
      statsHtml += `<div style="margin-top:8px;font-size:14px;color:#fff;">`;
      if (stats.role === 'saboteur') {
        statsHtml += `Damage Done: <b>${stats.damageDone}</b>`;
      } else {
        statsHtml += `Fixed HP: <b>${stats.fixedHp}</b>`;
      }
      statsHtml += `</div>`;
    }

    return statsHtml;
  }
}
