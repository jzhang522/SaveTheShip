import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = "SaveTheShipGameLobbies";

export const handler = async (event) => {
    try {
        const lobbyId = event.queryStringParameters?.lobbyId;
        if (!lobbyId) {
            return response(400, { message: "lobbyId is required" });
        }

        // Get lobby metadata
        const lobbyResult = await ddb.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: lobbyId, SK: "METADATA" }
        }));

        if (!lobbyResult.Item) {
            return response(404, { message: "Lobby not found" });
        }

        // Get all players in the lobby
        const playersResult = await ddb.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :playerPrefix)",
            ExpressionAttributeValues: {
                ":pk": lobbyId,
                ":playerPrefix": "PLAYER#"
            }
        }));

        const players = (playersResult.Items || []).map(p => ({
            playerId: p.playerId,
            playerName: p.playerName,
            role: p.role,
            joinedAt: p.joinedAt
        }));

        return response(200, { lobbyId, players });

    } catch (err) {
        console.error(err);
        return response(500, { message: err.message });
    }
};

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*" // CORS
        },
        body: JSON.stringify(body)
    };
}