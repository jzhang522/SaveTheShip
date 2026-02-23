import { GameLogic } from './core/gameLogic.js';

function loadGameContext() {
  try {
    const raw = sessionStorage.getItem('gameContext');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // const ctx = loadGameContext();
  // if (!ctx?.lobbyId || !ctx?.playerId) {
  //   window.location.replace('index.html');
  //   return;
  // }
  const game = new GameLogic();
  game.init();
});
