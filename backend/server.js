const WebSocket = require('ws');
const http = require('http');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, GetCommand, DeleteCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const PORT = process.env.PORT || 8080;

// DynamoDB setup
const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

// Game state
const games = new Map();
const players = new Map();

const GAME_WIDTH = 1400;
const GAME_HEIGHT = 800;
const PLAYER_SIZE = 20;
const MAX_PLAYERS_PER_GAME = 5;
const MIN_PLAYERS_PER_GAME = 2;
const LOBBY_COUNTDOWN_SECONDS = 10;

const TOTAL_PANELS = 8;
const PANELS_NEED_FIX = 6;

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
  return colors[Math.floor(Math.random() * colors.length)];
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
    return !!res.Item;
  } catch (err) {
    console.error("Failed to validate player in lobby:", err);
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
        UpdateExpression: "SET #s = :expired, ttl = :ttl",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":expired": "expired",
          ":ttl": Math.floor(Date.now() / 1000) + 60
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
    if (game.players.size < MAX_PLAYERS_PER_GAME && game.state === 'waiting') {
      console.log(`[Lobby] Joining existing game ${trimmedLobbyId}`);
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
    countdownTimer: null,
    createdAt: Date.now()
  };
  
  games.set(gameId, game);
  return gameId;
}

// Start 10-second countdown when lobby is filled, then start game
function scheduleGameStart(gameId) {
  const game = games.get(gameId);
  if (!game || game.state !== 'waiting' || game.countdownTimer) return;

  let secondsLeft = LOBBY_COUNTDOWN_SECONDS;
  broadcastToGame(gameId, { type: 'gameStartCountdown', secondsLeft });

  game.countdownTimer = setInterval(() => {
    secondsLeft--;
    broadcastToGame(gameId, { type: 'gameStartCountdown', secondsLeft });

    if (secondsLeft <= 0) {
      clearInterval(game.countdownTimer);
      game.countdownTimer = null;
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

// Start the game: select broken panels and notify all players
function startGame(gameId) {
  const game = games.get(gameId);
  if (!game || game.state === 'playing') return;

  game.state = 'playing';
  game.panelsNeedFix = selectPanelsNeedFix();

  broadcastToGame(gameId, {
    type: 'panelsNeedFix',
    panelIds: game.panelsNeedFix
  });

  console.log(`Game ${gameId} started — panels needing fix: [${game.panelsNeedFix.join(', ')}]`);
}

// Broadcast to all players in a game
function broadcastToGame(gameId, message) {
  const game = games.get(gameId);
  if (!game) return;
  
  const data = JSON.stringify(message);
  game.players.forEach(player => {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
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
    color: p.color
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

        const color = generateRandomColor();

        // If game already started, load roles
        let roles = {};
        if (game.state === 'in-progress') {
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
          joinedAt: Date.now()
        };

        
        game.players.set(playerId, player);
        players.set(playerId, { gameId, ws });
        
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

        // When lobby is filled (max players), start 10-second countdown then game
        if (game.players.size >= MAX_PLAYERS_PER_GAME && game.state === 'waiting') {
          scheduleGameStart(gameId);
        }

        // If game already started, send panelsNeedFix to the new joiner
        if (game.state === 'playing' && game.panelsNeedFix.length > 0) {
          ws.send(JSON.stringify({
            type: 'panelsNeedFix',
            panelIds: game.panelsNeedFix
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

      // Player started fixing a panel
      if (message.type === 'startFix' && playerId && gameId) {
        broadcastToGame(gameId, {
          type: 'playerFixing',
          playerId: playerId,
          panelId: message.panelId
        });
        console.log(`Player ${playerId} started fixing panel ${message.panelId}`);
      }

      // Player finished fixing a panel
      if (message.type === 'fixComplete' && playerId && gameId) {
        const game = games.get(gameId);
        if (game) {
          const idx = game.panelsNeedFix.indexOf(message.panelId);
          if (idx !== -1) {
            game.panelsNeedFix.splice(idx, 1);
          }
          broadcastToGame(gameId, {
            type: 'panelFixed',
            panelId: message.panelId
          });
          console.log(`Panel ${message.panelId} fixed by ${playerId}. Remaining: [${game.panelsNeedFix.join(', ')}]`);
        }
      }

      // Player explicitly leaves (e.g. before browser close)
      if (message.type === 'leave' && playerId && gameId) {
        const game = games.get(gameId);
        if (game) {
          game.players.delete(playerId);
          removePlayerFromDynamoDBLobby(gameId, playerId).catch((err) =>
            console.error("[Lobby] DynamoDB cleanup error:", err)
          );
          if (game.state === 'waiting' && game.countdownTimer && game.players.size < MAX_PLAYERS_PER_GAME) {
            clearInterval(game.countdownTimer);
            game.countdownTimer = null;
          }
          if (game.players.size === 0) {
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
      if (game) {
        game.players.delete(playerId);

        // Remove player from DynamoDB when browser closes / disconnects
        removePlayerFromDynamoDBLobby(gameId, playerId).catch((err) =>
          console.error("[Lobby] DynamoDB cleanup error:", err)
        );

        // Cancel countdown if we drop below max players during lobby (lobby no longer filled)
        if (game.state === 'waiting' && game.countdownTimer && game.players.size < MAX_PLAYERS_PER_GAME) {
          clearInterval(game.countdownTimer);
          game.countdownTimer = null;
        }

        // Remove empty games
        if (game.players.size === 0) {
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
});
