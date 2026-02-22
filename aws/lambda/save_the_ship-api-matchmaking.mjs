import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { 
    DynamoDBDocumentClient, 
    PutCommand, 
    UpdateCommand, 
    QueryCommand,
    GetCommand
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = "SaveTheShipGameLobbies";
const GSI_NAME = "status-playerCount-index";
const MAX_PLAYERS = 5; 
const SERVER_ENDPOINT = "????????????????????????????????????????"; // TODO: Change to the actual server endpoint

export const handler = async (event) => {
    const body = event.body ? JSON.parse(event.body) : {};
    const action = body.action;
    const lobbyId = body.pkLobbyId || body.lobbyId;

    try {
        switch (action) {
            case "matchmake":
                return await handleMatchmake(body.playerName);
            case "start":
                return await startGame(lobbyId);
            case "finish":
                return await updateStatus(lobbyId, "finished", 300);
            case "expire":
                return await updateStatus(lobbyId, "expired", 60);
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

    // Try to find an existing lobby (3 attempts)
    for (let attempt = 0; attempt < 3; attempt++) {
        const queryResult = await ddb.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: GSI_NAME,
            KeyConditionExpression: "#gpk = :gpk AND begins_with(#gsk, :status)",
            ExpressionAttributeNames: {
                "#gpk": "gsiPK",
                "#gsk": "gsiSK"
            },
            ExpressionAttributeValues: {
                ":gpk": "LOBBY",
                ":status": "waiting"
            },
            ScanIndexForward: true,
            Limit: 1
        }));

        if (queryResult.Items && queryResult.Items.length > 0) {
            const lobby = queryResult.Items[0];
            const newCount = lobby.playerCount + 1;
            const isNowFull = newCount >= MAX_PLAYERS;
            const newStatus = isNowFull ? "full" : "waiting";
            const gsiSK = `${newStatus}#${newCount}`;

            try {
                // Update lobby playerCount atomically
                await ddb.send(new UpdateCommand({
                    TableName: TABLE_NAME,
                    Key: { PK: lobby.PK, SK: "METADATA" },
                    UpdateExpression: `
                        SET playerCount = :newCount,
                            #s = :newStatus,
                            gsiSK = :gsiSK
                    `,
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

                // Add the new player item
                await ddb.send(new PutCommand({
                    TableName: TABLE_NAME,
                    Item: {
                        PK: lobby.PK,
                        SK: `PLAYER#${playerId}`,
                        entityType: "PLAYER",
                        ...playerObject
                    }
                }));

                return response(200, {
                    lobbyId: lobby.PK,
                    playerId,
                    status: newStatus,
                    serverEndpoint: lobby.serverEndpoint
                });

            } catch (err) {
                if (err.name === "ConditionalCheckFailedException") continue;
                throw err;
            }
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

    return response(200, {
        lobbyId: newLobbyId,
        playerId,
        status: "waiting",
        serverEndpoint: SERVER_ENDPOINT
    });
}

// -------------------------
// Start game: assign roles
// -------------------------
async function startGame(lobbyId) {
    if (!lobbyId) return response(400, { message: "lobbyId required" });

    // Get lobby metadata
    const lobbyResult = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: lobbyId, SK: "METADATA" }
    }));
    const lobby = lobbyResult.Item;
    if (!lobby) return response(404, { message: "Lobby not found" });

    // Get all players
    const playersQuery = await ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :playerPrefix)",
        ExpressionAttributeValues: {
            ":pk": lobbyId,
            ":playerPrefix": "PLAYER#"
        }
    }));
    const players = playersQuery.Items;

    // Shuffle and assign sabotage role
    const shuffled = players.sort(() => 0.5 - Math.random());
    const sabotagerCount = 1; // adjust as needed

    const updatePromises = shuffled.map((player, i) => {
        const role = i < sabotagerCount ? "sabotager" : "crew";
        return ddb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: lobbyId, SK: player.SK },
            UpdateExpression: "SET #r = :role",
            ExpressionAttributeNames: { "#r": "role" },
            ExpressionAttributeValues: { ":role": role }
        }));
    });
    
    await Promise.all(updatePromises);

    // Update lobby status
    await ddb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: lobbyId, SK: "METADATA" },
        UpdateExpression: "SET #s = :status",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":status": "in-progress" }
    }));

    return response(200, { message: "Game started", lobbyId });
}

// -------------------------
// Update lobby status
// -------------------------
async function updateStatus(lobbyId, newStatus, ttlSeconds) {
    if (!lobbyId) return response(400, { message: "lobbyId required" });
    const now = Math.floor(Date.now() / 1000);

    await ddb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: lobbyId, SK: "METADATA" },
        UpdateExpression: "SET #s = :status, ttl = :ttl",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":status": newStatus, ":ttl": now + ttlSeconds }
    }));

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