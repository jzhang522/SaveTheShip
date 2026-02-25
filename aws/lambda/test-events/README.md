# Lambda Test Events

Test events for the matchmaking Lambda (`save_the_ship-api-matchmaking.mjs`). Use these in the AWS Lambda console **Test** tab.

## How to Use

1. AWS Console → Lambda → your matchmaking function
2. Click **Test** tab
3. Create new event or edit existing
4. Paste the JSON from the desired file (replace placeholders if needed)
5. Name the event (e.g. "matchmake", "start-game")
6. Click **Test**

---

## matchmaking-event.json

**Action:** `matchmake` — Find or create a lobby for a player.

**Body:** `action`, `playerName`

**Placeholders:** None. Uses `"CaptainJimmy"` as player name.

**Expected:** 200 with `{ lobbyId, playerId, status, serverEndpoint }`

---

## start-game.json

**Action:** `start` — Assign roles and transition lobby to in-progress.

**Body:** `action`, `lobbyId`, `pkLobbyId`, `secret`

**Placeholders:**
1. Replace `LOBBY#REPLACE-WITH-REAL-LOBBY-ID` with a real lobby ID (must exist, `status: "full"`, ≥2 players)
2. Replace `REPLACE-WITH-YOUR-START_GAME_SECRET` with your Lambda `START_GAME_SECRET` env var

**Expected:** 200 with `{ "message": "Game started", lobbyId }` or 200 with `"Game already started"` if already in-progress.

---

## start-game-invalid-secret.json

**Action:** `start` — Tests authorization rejection.

**Body:** `action`, `lobbyId`, `pkLobbyId`, `secret` (invalid)

**Placeholders:** Optional — replace lobbyId with a real one (403 happens before lobby lookup).

**Expected:** 403 with `{ "message": "Unauthorized" }`

---

## finish-game-event.json

**Action:** `finish` — Set lobby status to finished (requires `ADMIN_SECRET`).

**Body:** `action`, `lobbyId`, `secret`

**Placeholders:** Replace `LOBBY#test-uuid` with a real lobby ID. Replace `<ADMIN_SECRET>` with the Lambda's `ADMIN_SECRET` env var.

**Expected:** 200 with `{ "message": "Lobby set to finished" }` (403 if secret missing/invalid)

---

## expire-event.json

**Action:** `expire` — Set lobby status to expired (requires `ADMIN_SECRET`).

**Body:** `action`, `lobbyId`, `secret`

**Placeholders:** Replace `LOBBY#test-uuid` with a real lobby ID. Replace `<ADMIN_SECRET>` with the Lambda's `ADMIN_SECRET` env var.

**Expected:** 200 with `{ "message": "Lobby set to expired" }` (403 if secret missing/invalid)

---

## error-matching-event.json

**Action:** `matchmake` — Tests validation (missing playerName).

**Body:** `action` only (no required `playerName`)

**Expected:** 400 with `{ "message": "playerName required" }`

---

## Other Actions (not in test-events)

| Action           | Body                          | Description                    |
|------------------|-------------------------------|--------------------------------|
| `validateSession`| `lobbyId`, `playerId`         | Validate player in lobby       |
| `leave`          | `lobbyId`, `playerId`         | Remove player from lobby       |
