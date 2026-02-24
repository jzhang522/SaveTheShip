/**
 * Game loop: update logic, network throttling, and rendering.
 */
export function startGameLoop(game) {
  const targetFPS = 30;
  const frameInterval = 1000 / targetFPS;
  let lastFrameTime = 0;

  const loop = (now) => {
    game.animationId = requestAnimationFrame(loop);
    const elapsed = now - lastFrameTime;
    if (elapsed < frameInterval) return;
    lastFrameTime = now - (elapsed % frameInterval);
    updateGame(game);
    render(game);
  };
  game.animationId = requestAnimationFrame(loop);
}

function updateGame(game) {
  if (!game.playerId || !game.character || !game.fpsCamera) return;

  const deltaTime = game.clock.getDelta();

  // Movement → camera → spotlight
  game.character.update(deltaTime);
  game.fpsCamera.update();

  const characterPos = game.character.getPosition();
  const characterYaw = game.character.getYaw();

  // Only update spotlight when alive
  if (!game.character.isDead) {
    game.scene3d.updateSpotlightPosition(characterPos, characterYaw);
  }

  // Update local player model (hide when dead)
  const localPlayer = game.players.get(game.playerId);
  if (localPlayer?._model) {
    localPlayer._model.update(
      characterPos.x, characterPos.y, characterPos.z,
      deltaTime, characterYaw
    );
    // Hide/show model based on alive/dead state
    const modelGroup = localPlayer._model.getGroup();
    if (modelGroup) {
      modelGroup.visible = !game.character.isDead;
    }
  }

  // Update remote player animations
  for (const [, character] of game.otherPlayers.entries()) {
    if (character?.animationManager) {
      character.animationManager.update(deltaTime);
    }
  }

  sendNetworkUpdate(game, characterPos, characterYaw);
}

function sendNetworkUpdate(game, pos, yaw) {
  const now = performance.now();
  const posChanged = game.lastSentPosition.distanceToSquared(pos) > 0.001;
  const rotChanged = Math.abs(yaw - game.lastSentRotationY) > 0.01;

  if (
    game.ws?.readyState === WebSocket.OPEN &&
    now - game.lastNetworkSend >= game.networkSendInterval &&
    (posChanged || rotChanged)
  ) {
    game.lastNetworkSend = now;
    game.lastSentPosition.copy(pos);
    game.lastSentRotationY = yaw;
    game.ws.send(JSON.stringify({
      type: 'move',
      x: pos.x, y: pos.y, z: pos.z,
      rotationY: yaw
    }));
  }
}

function render(game) {
  game.renderer.render(game.scene3d.getScene(), game.camera);
}
