require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, GetCommand, DeleteCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const PORT = process.env.PORT || 8080;

// DynamoDB setup (region must match Lambda/table, e.g. us-west-2)
const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-west-2" });
const ddb = DynamoDBDocumentClient.from(client);

// Game state
const games = new Map();
const players = new Map();

const GAME_WIDTH = 1400;
const GAME_HEIGHT = 800;
const PLAYER_SIZE = 20;
const MAX_PLAYERS_PER_GAME = 5;
const MIN_PLAYERS_PER_GAME = 2; // TODO: Change to 2
const LOBBY_COUNTDOWN_SECONDS = 3; // TODO: Change to 10

const TOTAL_PANELS = 8;
const PANELS_NEED_FIX = 4;
const PANEL_MAX_HP = 15;
const DECAY_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
const DECAY_PANEL_COUNT = 4; // number of undamaged panels to break each cycle

// Role & win-condition constants
const SABOTEUR_HP = 5;
const CREW_HP = 3;
const GAME_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const TIMER_BROADCAST_INTERVAL_MS = 1000; // broadcast remaining time every second

// Panel positions (must match frontend controlPanel.js)
const PANEL_POSITIONS = [
  { id: 1, x: -26.5,  y: 53.5,  z: -1120.5 },
  { id: 2, x: 160,    y: 21,    z: -727 },
  { id: 3, x: 0,      y: -4,    z: -120 },
  { id: 4, x: 156,    y: -8,    z: 136 },
  { id: 5, x: -143,   y: -8,    z: 118 },
  { id: 6, x: 0,      y: -9,    z: 371 },
  { id: 7, x: 0,      y: -8,    z: 753 },
  { id: 8, x: 0,      y: 7,     z: 1363 },
];

// HTTP server
const server = http.createServer();

// WebSocket server
const wss = new WebSocket.Server({ server });

// Generate unique IDs
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Generate random color from palette
function generateRandomColor() {
  const colors = [0x000000, 0x8B00FF, 0xFF0000, 0x00FF00, 0xFFFF00, 0x0000FF, 0xFFFFFF, 0xFFA500];
  return colors[Math.floor(Math.random() * colors.length)]; // fallback, not used for unique assignment
}

// Assign a unique color to a player in a game
function assignUniqueColor(game) {
  const palette = [0x000000, 0x8B00FF, 0xFF0000, 0x00FF00, 0xFFFF00, 0x0000FF, 0xFFFFFF, 0xFFA500];
  const used = new Set();
  for (const p of game.players.values()) {
    if (p.color != null) used.add(p.color);
  }
  for (const color of palette) {
    if (!used.has(color)) return color;
  }
  // If all colors are used, pick a random one (should not happen with max 8 players)
  return palette[Math.floor(Math.random() * palette.length)];
}

// Utility: fetch roles from DynamoDB
async function loadRolesFromDB(lobbyId) {
  try {
    const res = await ddb.send(new QueryCommand({
      TableName: "SaveTheShipGameLobbies",
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :playerPrefix)",
      ExpressionAttributeValues: {
        ":pk": lobbyId,
        ":playerPrefix": "PLAYER#"
      }
    }));

    const roles = {};
    if (res.Items) {
      res.Items.forEach(p => {
        roles[p.playerId] = p.role;
      });
    }
    return roles;
  } catch (err) {
    console.error("Failed to load roles from DB:", err);
    return {};
  }
}

const TABLE_NAME = "SaveTheShipGameLobbies";

// Validate that player exists in lobby in DynamoDB (required for lobbyId from matchmaking)
async function validatePlayerInLobby(lobbyId, playerId) {
  if (!lobbyId || !playerId) return false;
  try {
    const res = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: lobbyId, SK: `PLAYER#${playerId}` }
    }));
    if (!res.Item) {
      console.log(`[Join] Player not in DynamoDB lobby (may have left or been removed)`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Join] DynamoDB validation failed (check AWS credentials/region):", err.message);
    return false;
  }
}

// Remove player from DynamoDB lobby when they leave (browser close, disconnect, etc.)
async function removePlayerFromDynamoDBLobby(lobbyId, playerId) {
  if (!lobbyId || !playerId) return;
  // Only update DynamoDB for matchmaking lobbies (LOBBY#uuid format)
  if (!String(lobbyId).startsWith("LOBBY#")) return;
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: lobbyId, SK: `PLAYER#${playerId}` }
    }));
    // Decrement playerCount and update status/gsiSK
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: lobbyId, SK: "METADATA" },
      UpdateExpression: "SET playerCount = playerCount - :one",
      ConditionExpression: "playerCount > :zero",
      ExpressionAttributeValues: { ":one": 1, ":zero": 0 }
    }));
    // Fetch current count to update status and gsiSK
    const res = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: lobbyId, SK: "METADATA" }
    }));
    const meta = res.Item;
    const newCount = meta?.playerCount ?? 0;
    if (meta && newCount > 0) {
      const newStatus = meta.status === "full" ? "waiting" : meta.status;
      const newGsiSK = `${newStatus}#${newCount}`;
      await ddb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: lobbyId, SK: "METADATA" },
        UpdateExpression: "SET #s = :status, gsiSK = :gsiSK",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":status": newStatus, ":gsiSK": newGsiSK }
      }));
    }
    if (meta && newCount === 0) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: lobbyId, SK: "METADATA" },
        UpdateExpression: "SET #s = :expired, #ttl = :ttlVal",
        ExpressionAttributeNames: { "#s": "status", "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":expired": "expired",
          ":ttlVal": Math.floor(Date.now() / 1000) + 60
        }
      }));
    }
    console.log(`[Lobby] Removed player ${playerId} from DynamoDB lobby ${lobbyId}`);
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      // playerCount already 0 or item missing
      return;
    }
    console.error("Failed to remove player from DynamoDB:", err);
  }
}

// Create or join a game by lobbyId (from Lambda/DynamoDB)
function findOrCreateGameByLobbyId(lobbyId, playerId, playerName) {
  const trimmedLobbyId = lobbyId && String(lobbyId).trim();
  if (trimmedLobbyId && games.has(trimmedLobbyId)) {
    const game = games.get(trimmedLobbyId);
    if (game.state === 'waiting' && game.players.size < MAX_PLAYERS_PER_GAME) {
      console.log(`[Lobby] Joining existing game ${trimmedLobbyId}`);
      return trimmedLobbyId;
    }
    if (game.state === 'playing') {
      console.log(`[Lobby] Reconnecting to in-progress game ${trimmedLobbyId}`);
      return trimmedLobbyId;
    }
  }
  // Fallback: find any waiting game with space (only if no lobbyId - avoid splitting same-lobby players)
  if (!trimmedLobbyId) {
    for (let [gameId, game] of games.entries()) {
      if (game.players.size < MAX_PLAYERS_PER_GAME && game.state === 'waiting') {
        return gameId;
      }
    }
  }
  // Create new game (use lobbyId if provided, else generate)
  const gameId = trimmedLobbyId || generateId();
  console.log(`[Lobby] Creating new game ${gameId}`);
  const game = {
    id: gameId,
    players: new Map(),
    state: 'waiting',
    panelsNeedFix: [],
    panelHP: {},
    fixingIntervals: {},
    countdownTimer: null,
    decayTimer: null,
    gameTimerInterval: null,
    gameStartTime: null,
    gameEndTime: null,
    createdAt: Date.now(),
    playerStats: new Map(), // playerId -> { damageDone, fixedHp }
  };

  // Initialize all panels with max HP
  for (let i = 1; i <= TOTAL_PANELS; i++) {
    game.panelHP[i] = PANEL_MAX_HP;
  }
  
  games.set(gameId, game);
  return gameId;
}

// Invoke Lambda startGame to assign roles when game starts (backend-only, requires secret)
async function invokeStartGameLambda(lobbyId) {
  const apiUrl = process.env.MATCHMAKING_API_URL || process.env.VITE_API_URL;
  const secret = process.env.MATCHMAKING_API_SECRET;
  if (!apiUrl) {
    console.warn('[Lambda] MATCHMAKING_API_URL / VITE_API_URL not set, skipping startGame');
    return;
  }
  if (!secret) {
    console.warn('[Lambda] MATCHMAKING_API_SECRET not set, skipping startGame');
    return;
  }
  if (!lobbyId || !String(lobbyId).startsWith('LOBBY#')) {
    console.log('[Lambda] Skipping startGame for non-matchmaking lobby:', lobbyId);
    return;
  }
  console.log(`[Lambda] Invoking startGame for lobby ${lobbyId}...`);
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', lobbyId, pkLobbyId: lobbyId, secret })
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`[Lambda] startGame OK for lobby ${lobbyId}`);
    } else {
      console.warn(`[Lambda] startGame failed: ${res.status}`, text);
    }
  } catch (err) {
    console.error('[Lambda] startGame error:', err.message);
  }
}

// Set lobby status to "finished" in DynamoDB when game ends (direct update, no Lambda)
async function setLobbyStatusFinished(lobbyId) {
  if (!lobbyId || !String(lobbyId).startsWith('LOBBY#')) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = 300;
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: lobbyId, SK: 'METADATA' },
      UpdateExpression: 'SET #s = :status, #ttl = :ttlVal',
      ExpressionAttributeNames: { '#s': 'status', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':status': 'finished', ':ttlVal': now + ttlSeconds }
    }));
    console.log(`[DynamoDB] Lobby ${lobbyId} status set to finished`);
  } catch (err) {
    console.error('[DynamoDB] Failed to set lobby finished:', err.message);
  }
}

// Update player rows in DynamoDB with damageDone, fixedHp, score
async function updatePlayerStatsInDynamoDB(lobbyId, playerStats) {
  if (!lobbyId || !String(lobbyId).startsWith('LOBBY#')) return;
  try {
    for (const [playerId, stats] of Object.entries(playerStats)) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: lobbyId, SK: `PLAYER#${playerId}` },
        UpdateExpression: 'SET damageDone = :dd, fixedHp = :fh, score = :s',
        ExpressionAttributeValues: {
          ':dd': stats.damageDone ?? 0,
          ':fh': stats.fixedHp ?? 0,
          ':s': stats.score ?? 0
        }
      }));
    }
    console.log(`[DynamoDB] Updated player stats for lobby ${lobbyId}`);
  } catch (err) {
    console.error('[DynamoDB] Failed to update player stats:', err.message);
  }
}

// Start 10-second countdown when lobby is filled, then start game
function scheduleGameStart(gameId) {
  const game = games.get(gameId);
  if (!game || game.state !== 'waiting' || game.countdownTimer) return;

  let secondsLeft = LOBBY_COUNTDOWN_SECONDS;
  broadcastToGame(gameId, { type: 'gameStartCountdown', secondsLeft });

  game.countdownTimer = setInterval(async () => {
    secondsLeft--;
    broadcastToGame(gameId, { type: 'gameStartCountdown', secondsLeft });

    if (secondsLeft <= 0) {
      clearInterval(game.countdownTimer);
      game.countdownTimer = null;
      await invokeStartGameLambda(gameId);
      startGame(gameId);
      broadcastToGame(gameId, { type: 'gameStart', gameId });
    }
  }, 1000);
}

// Select random panel IDs that need fixing
function selectPanelsNeedFix() {
  const allIds = [];
  for (let i = 1; i <= TOTAL_PANELS; i++) allIds.push(i);
  // Shuffle and pick PANELS_NEED_FIX
  for (let i = allIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allIds[i], allIds[j]] = [allIds[j], allIds[i]];
  }
  return allIds.slice(0, PANELS_NEED_FIX);
}

// Assign roles: one random saboteur, rest are crew. Set HP accordingly.
function assignRoles(game) {
  const playerIds = Array.from(game.players.keys());
  const saboteurIdx = Math.floor(Math.random() * playerIds.length);

  playerIds.forEach((pid, idx) => {
    const player = game.players.get(pid);
    if (idx === saboteurIdx) {
      player.role = 'saboteur';
      player.maxHp = SABOTEUR_HP;
      player.hp = SABOTEUR_HP;
    } else {
      player.role = 'crew';
      player.maxHp = CREW_HP;
      player.hp = CREW_HP;
    }
    player.isDead = false;
  });

  // Send each player their own role assignment (private)
  game.players.forEach((player) => {
    if (player.ws?.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify({
        type: 'roleAssignment',
        role: player.role,
        maxHp: player.maxHp,
        hp: player.hp
      }));
    }
  });

  console.log(`[Roles] Game ${game.id}: saboteur=${playerIds[saboteurIdx]}, crew=${playerIds.filter((_, i) => i !== saboteurIdx).join(', ')}`);
}

// Start the game: assign roles, select broken panels, set their HP to 0, and notify all players
function startGame(gameId) {
  const game = games.get(gameId);
  if (!game || game.state === 'playing') return;

  game.state = 'playing';

  // Assign roles & HP
  assignRoles(game);

  const brokenPanelIds = selectPanelsNeedFix();

  // Set HP to 0 for broken panels, max for others
  for (let i = 1; i <= TOTAL_PANELS; i++) {
    game.panelHP[i] = brokenPanelIds.includes(i) ? 0 : PANEL_MAX_HP;
  }
  game.panelsNeedFix = brokenPanelIds;

  broadcastToGame(gameId, {
    type: 'panelsNeedFix',
    panelIds: game.panelsNeedFix,
    panelHP: game.panelHP
  });

  console.log(`Game ${gameId} started — panels needing fix: [${game.panelsNeedFix.join(', ')}]`);

  // Start periodic decay: every 3 minutes, damage up to 4 undamaged panels
  startPanelDecayTimer(gameId);

  // Start 15-minute game timer
  startGameTimer(gameId);
}

// Start a recurring timer that sets HP of up to DECAY_PANEL_COUNT undamaged panels to 0
function startPanelDecayTimer(gameId) {
  const game = games.get(gameId);
  if (!game) return;

  // Clear any existing decay timer
  if (game.decayTimer) {
    clearInterval(game.decayTimer);
    game.decayTimer = null;
  }

  game.decayTimer = setInterval(() => {
    const g = games.get(gameId);
    if (!g || g.state !== 'playing') {
      clearInterval(g?.decayTimer);
      if (g) g.decayTimer = null;
      return;
    }

    // Collect panels that are at full HP (undamaged)
    const undamaged = [];
    for (let i = 1; i <= TOTAL_PANELS; i++) {
      if (g.panelHP[i] >= PANEL_MAX_HP) undamaged.push(i);
    }

    if (undamaged.length === 0) return;

    // Shuffle and pick up to DECAY_PANEL_COUNT
    for (let i = undamaged.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [undamaged[i], undamaged[j]] = [undamaged[j], undamaged[i]];
    }
    const toBreak = undamaged.slice(0, DECAY_PANEL_COUNT);

    toBreak.forEach(pid => {
      g.panelHP[pid] = 0;
      broadcastToGame(gameId, {
        type: 'panelHpUpdate',
        panelId: pid,
        hp: 0,
        wasDamaged: true
      });
    });

    g.panelsNeedFix = getPanelsNeedFix(g);
    console.log(`[Decay] Game ${gameId} — broke panels [${toBreak.join(', ')}]`);

    // Check if all panels are now damaged
    checkWinConditions(gameId);
  }, DECAY_INTERVAL_MS);
}

// Start the 15-minute countdown timer; crew wins when it expires
function startGameTimer(gameId) {
  const game = games.get(gameId);
  if (!game) return;

  game.gameStartTime = Date.now();
  game.gameEndTime = game.gameStartTime + GAME_DURATION_MS;

  // Broadcast remaining time every second
  game.gameTimerInterval = setInterval(() => {
    const g = games.get(gameId);
    if (!g || g.state !== 'playing') {
      clearInterval(g?.gameTimerInterval);
      if (g) g.gameTimerInterval = null;
      return;
    }
    const remaining = Math.max(0, g.gameEndTime - Date.now());
    broadcastToGame(gameId, {
      type: 'gameTimer',
      remainingMs: remaining
    });

    // Time's up → crew wins
    if (remaining <= 0) {
      clearInterval(g.gameTimerInterval);
      g.gameTimerInterval = null;
      endGame(gameId, 'crew', 'Time is up! The crew survived!');
    }
  }, TIMER_BROADCAST_INTERVAL_MS);
}

// Check win conditions and end game if met
function checkWinConditions(gameId) {
  const game = games.get(gameId);
  if (!game || game.state !== 'playing') return;

  // Condition 1: All crew dead → saboteur wins
  let allCrewDead = true;
  let hasCrewPlayers = false;
  for (const player of game.players.values()) {
    if (player.role === 'crew') {
      hasCrewPlayers = true;
      if (!player.isDead) {
        allCrewDead = false;
        break;
      }
    }
  }
  if (hasCrewPlayers && allCrewDead) {
    endGame(gameId, 'saboteur', 'All crew members have been eliminated!');
    return;
  }


  // Condition 2: All control panels HP < PANEL_MAX_HP → saboteur wins
  let allPanelsDamaged = true;
  let allPanelsFixed = true;
  for (let i = 1; i <= TOTAL_PANELS; i++) {
    if (game.panelHP[i] >= PANEL_MAX_HP) {
      allPanelsDamaged = false;
    } else {
      allPanelsFixed = false;
    }
  }
  if (allPanelsDamaged) {
    endGame(gameId, 'saboteur', 'All control panels have been compromised!');
    return;
  }

  // Condition 3: All panels fixed AND saboteur dead → crew wins
  let saboteurDead = false;
  for (const player of game.players.values()) {
    if (player.role === 'saboteur') {
      saboteurDead = player.isDead;
      break;
    }
  }
  if (allPanelsFixed && saboteurDead) {
    endGame(gameId, 'crew', 'All panels are fixed and the saboteur is dead!');
    return;
  }
}

// End the game, broadcast result, and clean up timers
function endGame(gameId, winningTeam, reason) {
  const game = games.get(gameId);
  if (!game || game.state === 'ended') return;

  game.state = 'ended';

  // Clean up all timers
  if (game.gameTimerInterval) { clearInterval(game.gameTimerInterval); game.gameTimerInterval = null; }
  if (game.decayTimer) { clearInterval(game.decayTimer); game.decayTimer = null; }
  if (game.countdownTimer) { clearInterval(game.countdownTimer); game.countdownTimer = null; }
  for (const [panelId, fixInfo] of Object.entries(game.fixingIntervals)) {
    clearInterval(fixInfo.interval);
  }
  game.fixingIntervals = {};

  // Calculate seconds left (0 if timer expired)
  let secondsLeft = 0;
  if (game.gameEndTime && Date.now() < game.gameEndTime) {
    secondsLeft = Math.floor((game.gameEndTime - Date.now()) / 1000);
    if (secondsLeft < 0) secondsLeft = 0;
  }

  // Prepare stats for each player
  const playerStats = {};
  for (const [playerId, player] of game.players.entries()) {
    const stats = game.playerStats.get(playerId) || { damageDone: 0, fixedHp: 0 };
    let score = 0;
    if (player.role === 'saboteur') {
      score = stats.damageDone * 50;
      if (winningTeam === 'saboteur') score += 1000;
      score += secondsLeft * 2;
    } else {
      score = stats.fixedHp * 10;
      if (winningTeam === 'crew') score += 1000;
      score += secondsLeft * 2;
    }
    playerStats[playerId] = {
      name: player.name,
      role: player.role,
      damageDone: stats.damageDone,
      fixedHp: stats.fixedHp,
      score
    };
  }

  broadcastToGame(gameId, {
    type: 'gameOver',
    winningTeam,
    reason,
    playerStats,
    secondsLeft
  });

  // Persist lobby status and player stats to DynamoDB (matchmaking lobbies only)
  void setLobbyStatusFinished(gameId);
  void updatePlayerStatsInDynamoDB(gameId, playerStats);

  console.log(`[GameOver] Game ${gameId} — ${winningTeam} wins! Reason: ${reason}`);
}

// Get all panel IDs with HP < max
function getPanelsNeedFix(game) {
  const ids = [];
  for (let i = 1; i <= TOTAL_PANELS; i++) {
    if (game.panelHP[i] < PANEL_MAX_HP) ids.push(i);
  }
  return ids;
}

// Clean up fixing intervals when a player leaves/disconnects
function cleanupPlayerFixing(game, leavingPlayerId, gameId) {
  if (!game.fixingIntervals) return;
  for (const [panelId, fixInfo] of Object.entries(game.fixingIntervals)) {
    if (fixInfo.playerId === leavingPlayerId) {
      clearInterval(fixInfo.interval);
      delete game.fixingIntervals[panelId];
      broadcastToGame(gameId, {
        type: 'fixingStopped',
        panelId: parseInt(panelId),
        playerId: leavingPlayerId
      });
    }
  }
}

// Broadcast to all players in a game
function broadcastToGame(gameId, message) {
  const game = games.get(gameId);
  if (!game) return;
  
  const data = JSON.stringify(message);
  game.players.forEach(player => {
    try {
      if (player.ws && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(data);
      }
    } catch (err) {
      console.error(`broadcastToGame send error for player ${player.id}:`, err.message);
    }
  });
}

// Build game state including roles
function getGameState(gameId) {
  const game = games.get(gameId);
  if (!game) return null;
  
  const playersList = Array.from(game.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    z: p.z,
    rotationY: p.rotationY,
    role: p.role || null,
    color: p.color,
    spotlightOn: p.spotlightOn !== undefined ? p.spotlightOn : true,
    isDead: p.isDead || false
  }));
  
  return {
    type: 'gameState',
    gameId,
    players: playersList,
    gameWidth: GAME_WIDTH,
    gameHeight: GAME_HEIGHT,
    playerSize: PLAYER_SIZE
  };
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
  let playerId = null;
  let gameId = null;

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      
      // Player joins game (lobbyId/playerId from Lambda, or generated)
      if (message.type === 'join') {
        const lobbyId = typeof message.lobbyId === 'string' ? message.lobbyId.trim() : message.lobbyId;
        playerId = (message.playerId && String(message.playerId).trim()) || generateId();
        const playerName = message.name || `Player_${playerId.substr(0, 5)}`;

        // Validate against DynamoDB when lobbyId is provided (from matchmaking)
        if (lobbyId && playerId) {
          const isValid = await validatePlayerInLobby(lobbyId, playerId);
          if (!isValid) {
            console.log(`[Join] Rejected: invalid lobby session lobbyId=${lobbyId} playerId=${playerId}`);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid lobby session' }));
            ws.close();
            return;
          }
        }

        gameId = findOrCreateGameByLobbyId(lobbyId, playerId, playerName);
        const game = games.get(gameId);
        console.log(`[Join] lobbyId=${lobbyId} playerId=${playerId} gameId=${gameId} playersInGame=${game.players.size}`);

        const color = assignUniqueColor(game);

        // If game already started, load roles
        let roles = {};
        if (game.state === 'playing') {
          roles = await loadRolesFromDB(gameId);
        }
        
        const player = {
          id: playerId,
          name: playerName,
          ws: ws,
          x: 0,
          y: 10,
          z: -225,
          rotationY: 0,
          color: color,
          role: roles[playerId] || null,
          spotlightOn: true,
          isDead: false,
          joinedAt: Date.now()
        };
        // Initialize stats if not present
        if (!game.playerStats.has(playerId)) {
          game.playerStats.set(playerId, { damageDone: 0, fixedHp: 0 });
        }

        
        game.players.set(playerId, player);
        players.set(playerId, { gameId, ws });

        // Cancel any pending DynamoDB removal (e.g. they navigated to /game and came back)
        const removalKey = `${gameId}:${playerId}`;
        if (global.pendingDynamoRemovals?.has(removalKey)) {
          clearTimeout(global.pendingDynamoRemovals.get(removalKey));
          global.pendingDynamoRemovals.delete(removalKey);
        }
        
        // Send welcome message
        ws.send(JSON.stringify({
          type: 'welcomeMessage',
          playerId,
          gameId,
          lobbyId: gameId,
          playerName,
          role: player.role,
          color
        }));
        
        // Update all players in game
        broadcastToGame(gameId, getGameState(gameId));

        // When lobby has enough players (min), start 10-second countdown then game
        if (game.players.size >= MIN_PLAYERS_PER_GAME && game.state === 'waiting') {
          scheduleGameStart(gameId);
        }

        // If game already started, send panelsNeedFix to the new joiner
        if (game.state === 'playing' && game.panelsNeedFix.length > 0) {
          ws.send(JSON.stringify({
            type: 'panelsNeedFix',
            panelIds: game.panelsNeedFix,
            panelHP: game.panelHP
          }));
        }
      }
      
      // Player moved
      if (message.type === 'move' && playerId && gameId) {
        const game = games.get(gameId);
        if (!game) return;
        
        const player = game.players.get(playerId);
        if (!player) return;
        
        // Update position and rotation
        player.x = message.x;
        player.y = message.y;
        player.z = message.z;
        if (message.rotationY !== undefined) {
          player.rotationY = message.rotationY;
        }
        
        // Broadcast updated game state
        broadcastToGame(gameId, getGameState(gameId));
      }

      // Player toggled their spotlight
      if (message.type === 'toggleSpotlight' && playerId && gameId) {
        const game = games.get(gameId);
        if (game) {
          const player = game.players.get(playerId);
          if (player) {
            player.spotlightOn = message.spotlightOn;
          }
          // Broadcast to all other players in the game
          broadcastToGame(gameId, {
            type: 'spotlightToggle',
            playerId: playerId,
            spotlightOn: message.spotlightOn
          });
        }
      }

      // Player attacked
      if (message.type === 'playerAttack' && playerId && gameId) {
        const game = games.get(gameId);
        if (game) {
          // Broadcast kick animation to all players
          broadcastToGame(gameId, {
            type: 'playerAttacking',
            playerId: playerId
          });

          // Server-side hit detection using stored positions
          const attackRange = 15;
          const attackAngle = Math.PI / 2; // 90-degree cone
          const ax = message.x;
          const az = message.z;
          const yaw = message.yaw;
          const fwdX = Math.sin(yaw);
          const fwdZ = Math.cos(yaw);

          let closestId = null;
          let closestDist = attackRange;

          for (const [pid, p] of game.players.entries()) {
            if (pid === playerId) continue; // skip self
            if (p.isDead) continue; // skip dead
            const dx = p.x - ax;
            const dz = p.z - az;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > attackRange || dist < 0.1) continue;

            const dirX = dx / dist;
            const dirZ = dz / dist;
            const dot = fwdX * dirX + fwdZ * dirZ;
            const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
            if (angle < attackAngle && dist < closestDist) {
              closestDist = dist;
              closestId = pid;
            }
          }

          if (closestId) {
            const targetPlayer = game.players.get(closestId);
            if (targetPlayer && targetPlayer.ws?.readyState === WebSocket.OPEN) {
              targetPlayer.ws.send(JSON.stringify({
                type: 'playerHit',
                attackerId: playerId,
                targetId: closestId
              }));
              // Track attack damage
              const stats = game.playerStats.get(playerId) || { damageDone: 0, fixedHp: 0 };
              stats.damageDone += 1;
              game.playerStats.set(playerId, stats);
            }
          }

          // Panel attack detection: check if any panel is in attack range
          const panelAttackRange = 15;
          for (const panelPos of PANEL_POSITIONS) {
            const dx = panelPos.x - ax;
            const dz = panelPos.z - az;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > panelAttackRange || dist < 0.1) continue;

            const dirX = dx / dist;
            const dirZ = dz / dist;
            const dot = fwdX * dirX + fwdZ * dirZ;
            const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
            if (angle < attackAngle) {
              const pid = panelPos.id;
              if (game.panelHP[pid] > 0) {
                const prevHp = game.panelHP[pid];
                game.panelHP[pid] = Math.max(0, game.panelHP[pid] - 1);
                game.panelsNeedFix = getPanelsNeedFix(game);

                const msg = {
                  type: 'panelHpUpdate',
                  panelId: pid,
                  hp: game.panelHP[pid]
                };
                if (prevHp >= PANEL_MAX_HP && game.panelHP[pid] < PANEL_MAX_HP) {
                  msg.wasDamaged = true;
                }
                broadcastToGame(gameId, msg);

                console.log(`Panel ${pid} attacked by ${playerId}! HP: ${game.panelHP[pid]}`);
                // Check if all panels are now damaged
                checkWinConditions(gameId);
              }
            }
          }

          console.log(`Player ${playerId} attacked${closestId ? ` hit ${closestId} (dist=${closestDist.toFixed(1)})` : ' (no player target)'}`);
        }
      }

      // Player died
      if (message.type === 'playerDied' && playerId && gameId) {
        const game = games.get(gameId);
        if (game) {
          const player = game.players.get(playerId);
          if (player) {
            player.isDead = true;
            player.spotlightOn = false;
          }
          broadcastToGame(gameId, getGameState(gameId));
          console.log(`Player ${playerId} has died`);
          // Check if this death triggers a win condition
          checkWinConditions(gameId);
        }
      }

      // Player started fixing a panel — server manages HP increase via interval
      if (message.type === 'startFix' && playerId && gameId) {
        const game = games.get(gameId);
        if (!game) return;
        const panelId = message.panelId;

        // Validate panelId
        if (typeof panelId !== 'number' || panelId < 1 || panelId > TOTAL_PANELS) {
          ws.send(JSON.stringify({ type: 'fixingStopped', panelId, playerId }));
          return;
        }

        // Don't start if panel already at max HP — tell client to stop fixing
        if (game.panelHP[panelId] >= PANEL_MAX_HP) {
          ws.send(JSON.stringify({ type: 'fixingStopped', panelId, playerId }));
          return;
        }

        // Don't start if someone is already fixing this panel — tell client to stop
        if (game.fixingIntervals[panelId]) {
          ws.send(JSON.stringify({ type: 'fixingStopped', panelId, playerId }));
          return;
        }

        // Broadcast fixing animation to all players
        broadcastToGame(gameId, {
          type: 'playerFixing',
          playerId: playerId,
          panelId: panelId
        });

        // Capture fixPlayerId in closure scope to avoid reference issues
        const fixPlayerId = playerId;
        const fixGameId = gameId;

        // Start HP increase: +1 every second
        game.fixingIntervals[panelId] = {
          playerId: fixPlayerId,
          interval: setInterval(() => {
            try {
              const prevHp = game.panelHP[panelId] || 0;
              game.panelHP[panelId] = Math.min(PANEL_MAX_HP, prevHp + 1);

              // Track fixed HP for the player
              const stats = game.playerStats.get(fixPlayerId) || { damageDone: 0, fixedHp: 0 };
              if (game.panelHP[panelId] > prevHp) {
                stats.fixedHp += (game.panelHP[panelId] - prevHp);
                game.playerStats.set(fixPlayerId, stats);
              }

              // Broadcast HP update
              broadcastToGame(fixGameId, {
                type: 'panelHpUpdate',
                panelId: panelId,
                hp: game.panelHP[panelId]
              });

              // If fully repaired, stop fixing
              if (game.panelHP[panelId] >= PANEL_MAX_HP) {
                if (game.fixingIntervals[panelId]) {
                  clearInterval(game.fixingIntervals[panelId].interval);
                  delete game.fixingIntervals[panelId];
                }

                game.panelsNeedFix = getPanelsNeedFix(game);

                broadcastToGame(fixGameId, {
                  type: 'fixingStopped',
                  panelId: panelId,
                  playerId: fixPlayerId
                });

                console.log(`Panel ${panelId} fully fixed by ${fixPlayerId}. HP: ${game.panelHP[panelId]}`);
              }
            } catch (err) {
              console.error(`Fix interval error for panel ${panelId}:`, err);
              // On error, clean up and broadcast fixingStopped so players aren't stuck
              if (game.fixingIntervals[panelId]) {
                clearInterval(game.fixingIntervals[panelId].interval);
                delete game.fixingIntervals[panelId];
              }
              broadcastToGame(fixGameId, {
                type: 'fixingStopped',
                panelId: panelId,
                playerId: fixPlayerId
              });
            }
          }, 1000)
        };

        console.log(`Player ${playerId} started fixing panel ${panelId} (HP: ${game.panelHP[panelId]})`);
      }

      // Player requested to stop fixing (disconnect, hit, etc.)
      if (message.type === 'stopFix' && playerId && gameId) {
        const game = games.get(gameId);
        if (!game) return;
        const panelId = message.panelId;
        if (game.fixingIntervals[panelId] && game.fixingIntervals[panelId].playerId === playerId) {
          clearInterval(game.fixingIntervals[panelId].interval);
          delete game.fixingIntervals[panelId];
          broadcastToGame(gameId, {
            type: 'fixingStopped',
            panelId: panelId,
            playerId: playerId
          });
          console.log(`Player ${playerId} stopped fixing panel ${panelId} (HP: ${game.panelHP[panelId]})`);
        }
      }
      
      // Chat message - broadcast to all players in the same lobby
      if (message.type === 'chat' && playerId && gameId) {
        const game = games.get(gameId);
        const player = game?.players.get(playerId);
        if (game && player && typeof message.text === 'string') {
          const text = String(message.text).trim().slice(0, 500);
          if (text) {
            broadcastToGame(gameId, {
              type: 'chat',
              playerId,
              playerName: player.name,
              color: player.color,
              text
            });
          }
        }
      }

      // Player explicitly leaves (e.g. before browser close)
      if (message.type === 'leave' && playerId && gameId) {
        const game = games.get(gameId);
        if (game) {
          // Clear any fixing intervals for this player
          cleanupPlayerFixing(game, playerId, gameId);

          game.players.delete(playerId);
          removePlayerFromDynamoDBLobby(gameId, playerId).catch((err) =>
            console.error("[Lobby] DynamoDB cleanup error:", err)
          );
          if (game.state === 'waiting' && game.countdownTimer && game.players.size < MIN_PLAYERS_PER_GAME) {
            clearInterval(game.countdownTimer);
            game.countdownTimer = null;
          }
          if (game.players.size === 0) {
            // Clean up ALL fixing intervals before deleting game
            for (const [panelId, fixInfo] of Object.entries(game.fixingIntervals)) {
              clearInterval(fixInfo.interval);
            }
            game.fixingIntervals = {};
            if (game.decayTimer) { clearInterval(game.decayTimer); game.decayTimer = null; }
            if (game.gameTimerInterval) { clearInterval(game.gameTimerInterval); game.gameTimerInterval = null; }
            games.delete(gameId);
          } else {
            broadcastToGame(gameId, getGameState(gameId));
          }
          players.delete(playerId);
        }
        playerId = null;
        gameId = null;
        ws.close();
        return;
      }
    } catch (error) {
      console.error('Message handling error:', error);
    }
  });
  
  ws.on('close', () => {
    if (playerId && gameId) {
      const game = games.get(gameId);
      const closedPlayerId = playerId;
      const closedGameId = gameId;
      if (game) {
        // Clear any fixing intervals for this player
        cleanupPlayerFixing(game, playerId, closedGameId);

        game.players.delete(playerId);

        // Delay DynamoDB removal so accidental nav to /game can reconnect within grace period.
        // Skip removal when game is playing — keep player in DynamoDB so they can reconnect.
        const removalKey = `${closedGameId}:${closedPlayerId}`;
        if (game.state === 'waiting') {
          const removalTimer = setTimeout(() => {
            global.pendingDynamoRemovals?.delete(removalKey);
            removePlayerFromDynamoDBLobby(closedGameId, closedPlayerId).catch((err) =>
              console.error("[Lobby] DynamoDB cleanup error:", err)
            );
          }, 10000);

          if (!global.pendingDynamoRemovals) global.pendingDynamoRemovals = new Map();
          global.pendingDynamoRemovals.set(removalKey, removalTimer);
        }

        // Cancel countdown if we drop below min players during lobby (lobby no longer filled)
        if (game.state === 'waiting' && game.countdownTimer && game.players.size < MIN_PLAYERS_PER_GAME) {
          clearInterval(game.countdownTimer);
          game.countdownTimer = null;
        }

        // Remove empty games
        if (game.players.size === 0) {
          // Clean up ALL fixing intervals before deleting game
          for (const [panelId, fixInfo] of Object.entries(game.fixingIntervals)) {
            clearInterval(fixInfo.interval);
          }
          game.fixingIntervals = {};
          if (game.decayTimer) { clearInterval(game.decayTimer); game.decayTimer = null; }
          if (game.gameTimerInterval) { clearInterval(game.gameTimerInterval); game.gameTimerInterval = null; }
          games.delete(gameId);
        } else {
          // Notify remaining players
          broadcastToGame(gameId, getGameState(gameId));
        }
      }
      
      players.delete(playerId);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Game server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://<EC2_PUBLIC_IP>:${PORT}`);
  const hasApi = !!(process.env.MATCHMAKING_API_URL || process.env.VITE_API_URL);
  const hasSecret = !!process.env.MATCHMAKING_API_SECRET;
  console.log(`[Lambda] startGame config: API_URL=${hasApi ? 'set' : 'MISSING'}, SECRET=${hasSecret ? 'set' : 'MISSING'}`);
});