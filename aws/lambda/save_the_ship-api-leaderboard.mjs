import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME; // Set in Lambda env vars

export const handler = async () => {
  try {
    // Scan only player records
    const command = new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "#entityType = :playerType",
      ExpressionAttributeNames: {
        "#entityType": "entityType",
      },
      ExpressionAttributeValues: {
        ":playerType": "player",
      },
    });

    const response = await docClient.send(command);
    const players = response.Items || [];

    // Sort by score descending
    players.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Separate roles
    const crew = [];
    const saboteur = [];

    for (const player of players) {
      const playerData = {
        playerName: player.playerName,
        fixedHp: player.fixedHp,
        damageDone: player.damageDone,
        score: player.score,
      };

      if (player.role === "crew") {
        crew.push(playerData);
      } else if (player.role === "saboteur") {
        saboteur.push(playerData);
      }
    }

    return {
    statusCode: 200,
    headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*"
    },
    body: JSON.stringify({
        crew,
        saboteur
    })
};

  } catch (error) {
    console.error("Error fetching players:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch players" }),
    };
  }
};