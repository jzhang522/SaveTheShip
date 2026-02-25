    import { randomInt, createHmac, timingSafeEqual } from "crypto";
    import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
    import {
        DynamoDBDocumentClient,
        PutCommand,
        UpdateCommand,
        QueryCommand,
        GetCommand,
        DeleteCommand,
        ScanCommand
    } from "@aws-sdk/lib-dynamodb";
    import { v4 as uuidv4 } from "uuid";

    const client = new DynamoDBClient({});
    const ddb = DynamoDBDocumentClient.from(client);

    const TABLE_NAME = "SaveTheShipGameLobbies";
    const GSI_NAME = "status-playerCount-index";

    function createLeaveToken(lobbyId, playerId) {
        const secret = process.env.LEAVE_TOKEN_SECRET;
        if (!secret) return null;
        return createHmac("sha256", secret).update(`${lobbyId}|${playerId}`).digest("base64url");
    }

    function verifyLeaveToken(lobbyId, playerId, token) {
        const expected = createLeaveToken(lobbyId, playerId);
        if (!expected || !token || typeof token !== "string") return false;
        if (expected.length !== token.length) return false;
        try {
            return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(token, "utf8"));
        } catch {
            return false;
        }
    }
    const MAX_PLAYERS = 5;
    const MIN_PLAYERS = 2;
    const SERVER_ENDPOINT = "????????????????????????????????????????"; // TODO: Change to the actual server endpoint

    export const handler = async (event) => {
        let body = {};
        try {
            if (event.body) {
                const raw = typeof event.body === "string" ? event.body : Buffer.from(event.body, "base64").toString("utf8");
                body = raw ? JSON.parse(raw) : {};
            }
        } catch (e) {
            console.error("Body parse error:", e);
            return response(400, { message: "Invalid request body" });
        }
        const action = body.action;
        const lobbyId = body.pkLobbyId || body.lobbyId;

        try {
            switch (action) {
                case "matchmake":
                    return await handleMatchmake(body.playerName);
                case "validateSession":
                    return await handleValidateSession(lobbyId, body.playerId);
                case "leave":
                    return await handleLeave(lobbyId, body.playerId, body.leaveToken);
                case "start":
                    return await startGame(lobbyId, body.secret);
                case "finish":
                    return await updateStatus(lobbyId, "finished", 300, body.secret);
                case "expire":
                    return await updateStatus(lobbyId, "expired", 60, body.secret);
                default:
                    return response(400, { message: "Invalid action" });
            }
        } catch (err) {
            console.error("Handler Error:", err);
            return response(500, { message: err.message });
        }
    };

    // -------------------------
    // Handle matchmaking
    // -------------------------
    async function handleMatchmake(playerName) {
        if (!playerName || playerName.trim() === "") {
            return response(400, { message: "playerName required" });
        }
        if (playerName.length > 30) {
            return response(400, { message: "playerName too long" });
        }

        const playerId = uuidv4();
        const playerObject = {
            playerId,
            playerName: playerName.trim(),
            role: null,
            connectionId: null,
            isAlive: true,
            joinedAt: Date.now()
        };

        // Use base table Scan with ConsistentRead (second player sees first lobby immediately)
        const scanResult = await ddb.send(new ScanCommand({
            TableName: TABLE_NAME,
            FilterExpression: "SK = :sk AND #s = :status",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":sk": "METADATA", ":status": "waiting" },
            ConsistentRead: true
        }));

        const waitingLobbies = (scanResult.Items || [])
            .filter((item) => item.status === "waiting" && item.playerCount < MAX_PLAYERS)
            .sort((a, b) => (a.playerCount ?? 0) - (b.playerCount ?? 0));

        if (waitingLobbies.length > 0) {
            const lobby = waitingLobbies[0];
            const newCount = lobby.playerCount + 1;
            const isNowFull = newCount >= MAX_PLAYERS;
            const newStatus = isNowFull ? "full" : "waiting";
            const gsiSK = `${newStatus}#${newCount}`;

            try {
                await ddb.send(new UpdateCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: lobby.PK, SK: "METADATA" },
                    UpdateExpression: "SET playerCount = :newCount, #s = :newStatus, gsiSK = :gsiSK",
                    ConditionExpression: "playerCount < :max AND #s = :waiting",
                    ExpressionAttributeNames: { "#s": "status" },
                    ExpressionAttributeValues: {
                        ":newCount": newCount,
                        ":newStatus": newStatus,
                        ":gsiSK": gsiSK,
                        ":max": MAX_PLAYERS,
                        ":waiting": "waiting"
                    }
                }));

                await ddb.send(new PutCommand({
                    TableName: TABLE_NAME,
                    Item: {
                        PK: lobby.PK,
                        SK: `PLAYER#${playerId}`,
                        entityType: "PLAYER",
                        ...playerObject
                    }
                }));

                const leaveToken = createLeaveToken(lobby.PK, playerId);
                return response(200, {
                    lobbyId: lobby.PK,
                    playerId,
                    leaveToken,
                    status: newStatus,
                    serverEndpoint: lobby.serverEndpoint
                });

            } catch (err) {
                if (err.name === "ConditionalCheckFailedException") {
                    const retryScan = await ddb.send(new ScanCommand({
                        TableName: TABLE_NAME,
                        FilterExpression: "SK = :sk AND #s = :status",
                        ExpressionAttributeNames: { "#s": "status" },
                        ExpressionAttributeValues: { ":sk": "METADATA", ":status": "waiting" },
                        ConsistentRead: true
                    }));
                    const retryLobbies = (retryScan.Items || [])
                        .filter((item) => item.status === "waiting" && item.playerCount < MAX_PLAYERS)
                        .sort((a, b) => (a.playerCount ?? 0) - (b.playerCount ?? 0));
                    if (retryLobbies.length > 0) {
                        const retryLobby = retryLobbies[0];
                        const rCount = retryLobby.playerCount + 1;
                        const rFull = rCount >= MAX_PLAYERS;
                        const rStatus = rFull ? "full" : "waiting";
                        const rGsiSK = `${rStatus}#${rCount}`;
                        await ddb.send(new UpdateCommand({
                            TableName: TABLE_NAME,
                            Key: { PK: retryLobby.PK, SK: "METADATA" },
                            UpdateExpression: "SET playerCount = :nc, #s = :ns, gsiSK = :gsk",
                            ConditionExpression: "playerCount < :max AND #s = :waiting",
                            ExpressionAttributeNames: { "#s": "status" },
                            ExpressionAttributeValues: { ":nc": rCount, ":ns": rStatus, ":gsk": rGsiSK, ":max": MAX_PLAYERS, ":waiting": "waiting" }
                        }));
                        await ddb.send(new PutCommand({
                            TableName: TABLE_NAME,
                            Item: { PK: retryLobby.PK, SK: `PLAYER#${playerId}`, entityType: "PLAYER", ...playerObject }
                        }));
                        const leaveToken = createLeaveToken(retryLobby.PK, playerId);
                        return response(200, { lobbyId: retryLobby.PK, playerId, leaveToken, status: rStatus, serverEndpoint: retryLobby.serverEndpoint });
                    }
                }
                throw err;
            }
        }

        // CREATE NEW LOBBY if no waiting lobby found
        const now = Math.floor(Date.now() / 1000);
        const newLobbyId = `LOBBY#${uuidv4()}`;
        const newLobbyItem = {
            PK: newLobbyId,
            SK: "METADATA",
            entityType: "LOBBY",
            status: "waiting",
            playerCount: 1,
            maxPlayers: MAX_PLAYERS,
            serverEndpoint: SERVER_ENDPOINT,
            createdAt: now,
            ttl: now + 900,
            gsiPK: "LOBBY",
            gsiSK: `waiting#1`
        };

        await ddb.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: newLobbyItem
        }));

        // Add the player item
        await ddb.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                PK: newLobbyId,
                SK: `PLAYER#${playerId}`,
                entityType: "PLAYER",
                ...playerObject
            }
        }));

        const leaveToken = createLeaveToken(newLobbyId, playerId);
        return response(200, {
            lobbyId: newLobbyId,
            playerId,
            leaveToken,
            status: "waiting",
            serverEndpoint: SERVER_ENDPOINT
        });
    }

    // -------------------------
    // Validate session (for refresh before reconnect)
    // -------------------------
    async function handleValidateSession(lobbyId, playerId) {
        if (!lobbyId || !playerId) {
            return response(400, { valid: false, message: "lobbyId and playerId required" });
        }
        try {
            const [lobbyRes, playerRes] = await Promise.all([
                ddb.send(new GetCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: lobbyId, SK: "METADATA" }
                })),
                ddb.send(new GetCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: lobbyId, SK: `PLAYER#${playerId}` }
                }))
            ]);
            const lobby = lobbyRes.Item;
            const player = playerRes.Item;
            if (!lobby || !player) {
                return response(200, { valid: false });
            }
            const validStatuses = ["waiting", "full", "in-progress"];
            if (!validStatuses.includes(lobby.status)) {
                return response(200, { valid: false });
            }
            const leaveToken = createLeaveToken(lobbyId, playerId);
            return response(200, { valid: true, leaveToken });
        } catch (err) {
            console.error("validateSession error:", err);
            return response(200, { valid: false });
        }
    }

    // -------------------------
    // Remove player from lobby (browser close, leave button, etc.)
    // -------------------------
    async function handleLeave(lobbyId, playerId, leaveToken) {
        if (!lobbyId || !playerId) {
            return response(400, { ok: false, message: "lobbyId and playerId required" });
        }
        if (!String(lobbyId).startsWith("LOBBY#")) {
            return response(400, { ok: false, message: "Invalid lobbyId format" });
        }
        if (!verifyLeaveToken(lobbyId, playerId, leaveToken)) {
            return response(403, { ok: false, message: "Invalid or missing leave token" });
        }
        try {
            await ddb.send(new DeleteCommand({
                TableName: TABLE_NAME,
                Key: { PK: lobbyId, SK: `PLAYER#${playerId}` }
            }));
            await ddb.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK: lobbyId, SK: "METADATA" },
                UpdateExpression: "SET playerCount = playerCount - :one",
                ConditionExpression: "playerCount > :zero",
                ExpressionAttributeValues: { ":one": 1, ":zero": 0 }
            }));
            const res = await ddb.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: lobbyId, SK: "METADATA" }
            }));
            const meta = res.Item;
            const newCount = meta?.playerCount ?? 0;
            if (meta && newCount > 0) {
                const newStatus = meta.status === "full" ? "waiting" : meta.status;
                await ddb.send(new UpdateCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: lobbyId, SK: "METADATA" },
                    UpdateExpression: "SET #s = :status, gsiSK = :gsiSK",
                    ExpressionAttributeNames: { "#s": "status" },
                    ExpressionAttributeValues: { ":status": newStatus, ":gsiSK": `${newStatus}#${newCount}` }
                }));
            } else if (meta && newCount === 0) {
                const now = Math.floor(Date.now() / 1000);
                await ddb.send(new UpdateCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: lobbyId, SK: "METADATA" },
                    UpdateExpression: "SET #s = :expired, #ttl = :ttlVal",
                    ExpressionAttributeNames: { "#s": "status", "#ttl": "ttl" },
                    ExpressionAttributeValues: { ":expired": "expired", ":ttlVal": now + 60 }
                }));
            }
            return response(200, { ok: true });
        } catch (err) {
            if (err.name === "ConditionalCheckFailedException") {
                return response(200, { ok: true });
            }
            console.error("handleLeave error:", err);
            return response(500, { ok: false, message: err.message });
        }
    }

    // -------------------------
    // Start game: assign roles
    // -------------------------
    async function startGame(lobbyId, secret) {
        if (!lobbyId) return response(400, { message: "lobbyId required" });

        const expectedSecret = process.env.START_GAME_SECRET;
        if (!expectedSecret || secret !== expectedSecret) {
            return response(403, { message: "Unauthorized" });
        }

        // Get lobby metadata
        const lobbyResult = await ddb.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: lobbyId, SK: "METADATA" }
        }));
        const lobby = lobbyResult.Item;
        if (!lobby) return response(404, { message: "Lobby not found" });

        if (lobby.status === "in-progress") {
            return response(200, { message: "Game already started", lobbyId });
        }

        const playerCount = lobby.playerCount ?? 0;
        const canStart = (lobby.status === "full" || lobby.status === "waiting") && playerCount >= MIN_PLAYERS;
        if (!canStart) {
            return response(400, { message: "Lobby not ready to start", status: lobby.status, playerCount });
        }

        // Get all players
        const playersQuery = await ddb.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :playerPrefix)",
            ExpressionAttributeValues: {
                ":pk": lobbyId,
                ":playerPrefix": "PLAYER#"
            }
        }));
        const players = playersQuery.Items ?? [];
        if (players.length < MIN_PLAYERS) {
            return response(400, { message: `Minimum ${MIN_PLAYERS} players required`, actualCount: players.length });
        }

        try {
            await ddb.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK: lobbyId, SK: "METADATA" },
                UpdateExpression: "SET #s = :status",
                ConditionExpression: "#s IN (:full, :waiting)",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: { ":status": "in-progress", ":full": "full", ":waiting": "waiting" }
            }));
        } catch (err) {
            if (err.name === "ConditionalCheckFailedException") {
                return response(200, { message: "Game already started", lobbyId });
            }
            throw err;
        }

        // Shuffle using Fisher-Yates with crypto randomness
        const shuffled = [...players];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = randomInt(0, i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const sabotagerCount = 1; // adjust as needed

        const updatePromises = shuffled.map((player, i) => {
            const role = i < sabotagerCount ? "saboteur" : "crew";
            return ddb.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK: lobbyId, SK: player.SK },
                UpdateExpression: "SET #r = :role",
                ExpressionAttributeNames: { "#r": "role" },
                ExpressionAttributeValues: { ":role": role }
            }));
        });

        await Promise.all(updatePromises);

        return response(200, { message: "Game started", lobbyId });
    }

    // -------------------------
    // Update lobby status (finish/expire - trusted callers only)
    // -------------------------
    async function updateStatus(lobbyId, newStatus, ttlSeconds, secret) {
        if (!lobbyId) return response(400, { message: "lobbyId required" });
        if (!String(lobbyId).startsWith("LOBBY#")) {
            return response(400, { message: "Invalid lobbyId format" });
        }
        const expectedSecret = process.env.ADMIN_SECRET;
        if (!expectedSecret || secret !== expectedSecret) {
            return response(403, { message: "Unauthorized" });
        }
        const now = Math.floor(Date.now() / 1000);

        try {
            await ddb.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { PK: lobbyId, SK: "METADATA" },
                UpdateExpression: "SET #s = :status, #ttl = :ttlVal",
                ConditionExpression: "attribute_exists(PK)",
                ExpressionAttributeNames: { "#s": "status", "#ttl": "ttl" },
                ExpressionAttributeValues: { ":status": newStatus, ":ttlVal": now + ttlSeconds }
            }));
        } catch (err) {
            if (err.name === "ConditionalCheckFailedException") {
                return response(404, { message: "Lobby not found" });
            }
            throw err;
        }
        return response(200, { message: `Lobby set to ${newStatus}` });
    }

    // -------------------------
    // Response helper
    // -------------------------
    function response(statusCode, body) {
        return {
            statusCode,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify(body)
        };
    }