import * as THREE from 'three';
import { FBXLoader } from '../loaders/fbxLoader.js';

const DEFAULT_LIGHT_COLOR = 0x948d81;
const NEED_FIX_LIGHT_COLOR = 0xff0000;
const FIXED_LIGHT_COLOR = 0x00ff00;
const PANEL_MAX_HP = 15;

export class ControlPanel {
  // Shared panel registry: Map<id, { id, model, light, needFix }>
  static panels = new Map();

  static loadCPanel(scene, onCPanelLoaded) {
    const textureLoader = new THREE.TextureLoader();
    const CPanelTexture = textureLoader.load('/CP_Texture_Paint_003.png');

    // rotY is in degrees (0 = facing backward/default Math.PI, 90 = facing right, etc.)
    const panelConfigs = [
      { id: 1, x: -26.5,  y: 53.5,  z: -1120.5, rotY: 180 },
      { id: 2, x: 160,  y: 21,  z: -727,  rotY: 270 },
      { id: 3, x: 0,    y: -4,  z: -120,  rotY: 90 },
      { id: 4, x: 156,  y: -8, z: 136,   rotY: 0 },
      { id: 5, x: -143, y: -8, z: 118,   rotY: 180 },
      { id: 6, x: 0,    y: -9, z: 371,   rotY: -90 },
      { id: 7, x: 0,    y: -8, z: 753,   rotY: -90 },
      { id: 8, x: 0,    y: 7,   z: 1363,  rotY: -90 },
    ];

    let loaded = 0;
    const loader = new FBXLoader();

    // Load the FBX once, then clone for each panel placement
    loader.load('/ControlPanel.fbx', (baseModel) => {
      // Create a shared material for all panel meshes
      const sharedMaterial = new THREE.MeshStandardMaterial({
        map: CPanelTexture,
        metalness: 0,
        roughness: 0.4,
      });

      panelConfigs.forEach((panel) => {
        const model = baseModel.clone();
        model.scale.set(0.06, 0.06, 0.06);
        model.position.set(panel.x, panel.y, panel.z);
        model.rotation.y = Math.PI + THREE.MathUtils.degToRad(panel.rotY);

        model.traverse((node) => {
          if (node.isMesh) {
            node.material = sharedMaterial;
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });

        scene.add(model);

        // Add a point light above the control panel
        const panelLight = new THREE.PointLight(DEFAULT_LIGHT_COLOR, 8, 25, 0);
        panelLight.position.set(panel.x, panel.y + 8, panel.z);
        panelLight.castShadow = false;
        scene.add(panelLight);

        // Register panel with id, needFix state, and HP
        ControlPanel.panels.set(panel.id, {
          id: panel.id,
          model,
          light: panelLight,
          needFix: false,
          hp: PANEL_MAX_HP,
        });
      });

      if (onCPanelLoaded) {
        onCPanelLoaded();
      }
    });
  }

  /**
   * Mark specific panels as needing repair and set their HP.
   * @param {number[]} panelIds - Array of panel IDs that need fixing.
   * @param {Object} panelHP - Optional map of panelId → hp values.
   */
  static setNeedFix(panelIds, panelHP = {}) {
    for (const [id, panel] of ControlPanel.panels) {
      if (panelHP[id] !== undefined) {
        panel.hp = panelHP[id];
      } else if (panelIds.includes(id)) {
        panel.hp = 0;
      } else {
        panel.hp = PANEL_MAX_HP;
      }
      panel.needFix = panel.hp < PANEL_MAX_HP;
      panel.light.color.setHex(panel.needFix ? NEED_FIX_LIGHT_COLOR : FIXED_LIGHT_COLOR);
    }
  }

  /**
   * Update a single panel's HP and needFix/light state.
   * @param {number} panelId
   * @param {number} hp
   */
  static updatePanelHp(panelId, hp) {
    const panel = ControlPanel.panels.get(panelId);
    if (panel) {
      panel.hp = hp;
      panel.needFix = hp < PANEL_MAX_HP;
      panel.light.color.setHex(panel.needFix ? NEED_FIX_LIGHT_COLOR : FIXED_LIGHT_COLOR);
      console.log(`Panel ${panelId} HP: ${hp}/${PANEL_MAX_HP} needFix: ${panel.needFix}`);
    }
  }

  /**
   * Get all panel IDs.
   */
  static getAllPanelIds() {
    return Array.from(ControlPanel.panels.keys());
  }

  /**
   * Find the nearest panel with needFix === true within maxDistance.
   * @param {THREE.Vector3} playerPosition
   * @param {number} maxDistance
   * @returns {object|null} The nearest fixable panel entry, or null.
   */
  static getNearestFixablePanel(playerPosition, maxDistance = 12) {
    let nearest = null;
    let nearestDistSq = maxDistance * maxDistance;
    for (const panel of ControlPanel.panels.values()) {
      if (panel.hp >= PANEL_MAX_HP) continue;
      const panelPos = panel.model.position;
      const distSq = playerPosition.distanceToSquared(panelPos);
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = panel;
      }
    }
    return nearest;
  }

  /**
   * Mark a single panel as fixed (needFix = false) and restore its light.
   * @param {number} panelId
   */
  static fixPanel(panelId) {
    const panel = ControlPanel.panels.get(panelId);
    if (panel) {
      panel.hp = PANEL_MAX_HP;
      panel.needFix = false;
      panel.light.color.setHex(FIXED_LIGHT_COLOR);
    }
  }
}