import { GameLogic } from './core/gameLogic.js';

function loadGameContext() {
  try {
    const raw = sessionStorage.getItem('gameContext');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function initChatToggle(game) {
  const chatToggle = document.getElementById('chatToggle');
  const chatWindow = document.getElementById('chatWindow');
  const chatClose = chatWindow?.querySelector('.chat-close');
  const chatInput = document.getElementById('chatInput');

  function sendChatMessage() {
    const text = chatInput?.value?.trim();
    if (!text || !game?.ws || game.ws.readyState !== WebSocket.OPEN) return;
    game.ws.send(JSON.stringify({ type: 'chat', text }));
    chatInput.value = '';
    chatInput?.blur();
  }

  function toggleChat() {
    if (!chatWindow) return;
    const isOpen = chatWindow.classList.toggle('open');
    chatWindow.setAttribute('aria-hidden', !isOpen);
    if (!isOpen) {
      chatInput?.blur();
    }
  }

  chatToggle?.addEventListener('click', toggleChat);
  chatClose?.addEventListener('click', toggleChat);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.repeat) return;
    if (document.activeElement === chatInput) return;
    e.preventDefault();
    e.stopPropagation();
    toggleChat();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!chatWindow?.classList.contains('open')) return;
    if (document.activeElement === chatInput) return;
    const isLetter = /^[a-zA-Z]$/.test(e.key);
    const isShift = e.key === 'Shift';
    if (!isLetter && !isShift) return;
    e.preventDefault();
    e.stopPropagation();
    chatInput?.focus();
    if (isLetter) {
      chatInput.value += e.key;
    }
  }, true);

  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.repeat) {
      e.preventDefault();
      sendChatMessage();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const ctx = loadGameContext();
  if (!ctx?.lobbyId || !ctx?.playerId) {
    window.location.replace('index.html');
    return;
  }
  const game = new GameLogic();
  game.init();
  initChatToggle(game);
});
