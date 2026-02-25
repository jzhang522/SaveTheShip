# SaveTheShip — AWS Architecture Diagram

## Mermaid Diagram

```mermaid
flowchart TB
    subgraph Internet["🌐 Internet"]
        User["User Browser"]
    end

    subgraph Frontend["Frontend (Static)"]
        CF["CloudFront<br/>CDN"]
        S3["S3 Bucket<br/>save-the-ship-bucket<br/>HTML, JS, CSS"]
    end

    subgraph API["API Layer"]
        APIGW["API Gateway<br/>REST API"]
        LAMBDA_MM["Lambda<br/>Matchmaking"]
        LAMBDA_LB["Lambda<br/>Leaderboard"]
    end

    subgraph Data["Data Layer"]
        DDB["DynamoDB<br/>SaveTheShipGameLobbies"]
    end

    subgraph Backend["Game Server"]
        EC2["EC2 Instance<br/>Node.js WebSocket Server<br/>:8080"]
    end

    %% User flows
    User -->|"1. Load app (HTTPS)"| CF
    CF -->|"Serve static files"| S3

    User -->|"2. Matchmake / Leaderboard (HTTPS)"| APIGW
    APIGW --> LAMBDA_MM
    APIGW --> LAMBDA_LB
    LAMBDA_MM -->|"Read/Write"| DDB
    LAMBDA_LB -->|"Query"| DDB

    User -->|"3. WebSocket (ws/wss)"| EC2
    EC2 -->|"startGame, validate"| LAMBDA_MM
    EC2 -->|"Read roles, update lobby"| DDB

    %% Styling
    classDef aws fill:#FF9900,stroke:#232F3E,color:#232F3E
    classDef data fill:#4053D6,stroke:#232F3E,color:#fff
    classDef compute fill:#8C4FFF,stroke:#232F3E,color:#fff
```

---

## Architecture Overview

| Component | AWS Service | Purpose |
|-----------|-------------|---------|
| **Frontend** | S3 + CloudFront | Static site (HTML, JS, CSS) |
| **Matchmaking API** | API Gateway + Lambda | Create/join lobbies, validate sessions |
| **Leaderboard API** | API Gateway + Lambda | Fetch game stats |
| **Game State** | DynamoDB | Lobby metadata, players, roles |
| **Game Server** | EC2 | WebSocket server for real-time gameplay |

---

## Data Flow

1. **Page load** — User → CloudFront → S3 (static files)
2. **Matchmaking** — User → API Gateway → Lambda → DynamoDB
3. **Game connection** — User → EC2 (WebSocket)
4. **Game start** — EC2 → Lambda (assign roles) → DynamoDB
5. **Leaderboard** — User → API Gateway → Lambda → DynamoDB

---

## Alternative: S3 Website (No CloudFront)

```
User → S3 Website Endpoint (HTTP) → Static files
User → API Gateway → Lambda → DynamoDB
User → EC2 (WebSocket)
```

---

## Region

All services deployed in **us-west-2** (Oregon).
