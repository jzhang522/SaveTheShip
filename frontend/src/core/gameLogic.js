import * as THREE from 'three';
import { Scene3D } from '../scene/scene3d.js';
import { Character } from '../player/character.js';
import { FPSCamera } from '../camera/fpsCamera.js';
import { InputState } from '../input/inputState.js';
import { EventManager } from '../events/eventManager.js';
import { MessageHandler } from '../networking/messageHandler.js';
import { createRenderer } from './renderer.js';
import { startGameLoop } from './gameLoop.js';

export class GameLogic {
  constructor() {
    const ctx = this.loadGameContext();
    this.playerId = ctx?.playerId ?? null;
    this.gameId = ctx?.lobbyId ?? null;
    this.playerName = ctx?.playerName ?? `Player_${Math.random().toString(36).substring(2, 7)}`;
    this.players = new Map();
    this.otherPlayers = new Map();
    this.controlPanels = new Map();
    this.role = null; // 'saboteur' or 'crew'

    this.renderer = null;
    this.camera = null;
    this.scene3d = null;
    this.character = null;
    this.fpsCamera = null;
    this.inputState = new InputState();

    this.ws = null;
    this.wsUrl = this.getWebSocketUrl();
    this.clock = new THREE.Clock();
    this.animationId = null;

    // Throttle network sends (~15 updates/sec)
    this.lastNetworkSend = 0;
    this.networkSendInterval = 1000 / 15;
    this.lastSentPosition = new THREE.Vector3();
    this.lastSentRotationY = 0;
  }

  init() {
    this.renderer = createRenderer();
    this.setupScene();
    this.createHeartsUI();
    EventManager.setup(this);
    this.connect();
  }

  setupScene() {
    this.scene3d = new Scene3D(() => {
      const shipMeshes = [];
      this.scene3d.getScene().traverse((node) => {
        if (node.isMesh) shipMeshes.push(node);
      });
      this.character.setShipMeshes(shipMeshes);
    });

    this.camera = new THREE.PerspectiveCamera(
      75,
      (window.innerWidth - 320) / (window.innerHeight - 100),
      0.1,
      1000
    );

    this.character = new Character(this.inputState);
    this.fpsCamera = new FPSCamera(this.camera, this.character);

    // HP change callback — update hearts UI
    this.character._onHpChange = (hp, maxHp, isDead) => {
      this.updateHeartsUI(hp, maxHp);
    };

    // Death callback — enter ghost mode (no fog, no spotlight, ambient light, no model)
    this.character._onDeath = () => {
      this.scene3d.setFogEnabled(false);
      this.scene3d.setLocalSpotlightVisible(false);
      this.scene3d.setAmbientLightEnabled(true);

    };

    this.character._playerDying = () => {
      // Notify server so other players can hide this player
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'playerDying' }));
      }
    }
  }

  loadGameContext() {
    try {
      const raw = sessionStorage.getItem('gameContext');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const localEndpoint = import.meta.env.VITE_SERVER_ENDPOINT || 'localhost:8080';
    const useLocalWs = import.meta.env.VITE_USE_LOCAL_WS === 'true';

    if (useLocalWs) {
      return localEndpoint.startsWith('ws') ? localEndpoint : `${protocol}//${localEndpoint}`;
    }

    const ctx = this.loadGameContext();
    let endpoint = ctx?.serverEndpoint ?? ctx?.ServerEndpoint;
    if (!endpoint || typeof endpoint !== 'string' || endpoint.includes('?') || endpoint.length < 5) {
      endpoint = localEndpoint;
    }
    if (endpoint.startsWith('ws://') || endpoint.startsWith('wss://')) {
      return endpoint;
    }
    return `${protocol}//${endpoint}`;
  }

  connect() {
    try {
      this.wsUrl = this.getWebSocketUrl();
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.updateStatus('Connected', true);
        this.ws.send(JSON.stringify({
          type: 'join',
          lobbyId: this.gameId,
          playerId: this.playerId,
          name: this.playerName,
        }));
        startGameLoop(this);
      };

      this.ws.onmessage = (event) => {
        try {
          MessageHandler.handleMessage(this, JSON.parse(event.data));
        } catch (error) {
          console.error('Message parse error:', error);
        }
      };

      this.ws.onerror = () => this.updateStatus('Error', false);

      this.ws.onclose = () => {
        this.updateStatus('Disconnected', false);
        setTimeout(() => this.connect(), 3000);
      };
    } catch (error) {
      console.error('Connection error:', error);
      this.updateStatus('Connection Failed', false);
    }
  }

  updateStatus(message, isConnected) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.style.color = isConnected ? '#0f0' : '#f00';
    }
  }

  /**
   * Create the hearts overlay inside the game container.
   */
  createHeartsUI() {
    const container = document.getElementById('gameContainer');
    if (!container) return;

    const heartsDiv = document.createElement('div');
    heartsDiv.id = 'heartsUI';
    heartsDiv.className = 'hearts-ui';
    container.appendChild(heartsDiv);

    this.updateHeartsUI(this.character.hp, this.character.maxHp);
  }

  /**
   * Update the hearts display.
   */
  updateHeartsUI(hp, maxHp) {
    const heartsDiv = document.getElementById('heartsUI');
    if (!heartsDiv) return;

    heartsDiv.innerHTML = '';
    for (let i = 0; i < maxHp; i++) {
      const heart = document.createElement('span');
      heart.className = i < hp ? 'heart heart-full' : 'heart heart-empty';
      heart.textContent = i < hp ? '❤️' : '🖤';
      heartsDiv.appendChild(heart);
    }

    if (hp <= 0) {
      const deadLabel = document.createElement('span');
      deadLabel.className = 'dead-label';
      deadLabel.textContent = ' DEAD';
      heartsDiv.appendChild(deadLabel);
    }
  }
}