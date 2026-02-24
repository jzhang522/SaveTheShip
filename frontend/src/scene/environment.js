import * as THREE from 'three';
import { FBXLoader } from '../loaders/fbxLoader.js';

export class EnvironmentBuilder {
  static loadShip(scene, onShipLoaded) {
    const textureLoader = new THREE.TextureLoader();
    const shipTexture = textureLoader.load('/DefaultMaterial_Base_Color.png');
    
    const loader = new FBXLoader();
    loader.load('/ship.fbx', (model) => {
      model.scale.set(0.2, 0.2, 0.2);
      model.position.set(0, 0, 0);
      model.rotation.y = Math.PI; // Rotate to face forward
      
      // Shared material for all ship meshes
      const sharedMaterial = new THREE.MeshStandardMaterial({ 
        map: shipTexture,
        metalness: 0.3,
        roughness: 0.4
      });

      model.traverse((node) => {
        if (node.isMesh) {
          node.material = sharedMaterial;
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      
      scene.add(model);
      
      // Call callback to notify when ship is loaded
      if (onShipLoaded) {
        onShipLoaded();
      }
    });
  }
}
