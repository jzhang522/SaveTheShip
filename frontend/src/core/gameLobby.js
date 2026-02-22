"use strict";

const API_URL = import.meta.env.VITE_API_URL;
const SERVER_ENDPOINT = import.meta.env.VITE_SERVER_ENDPOINT || "localhost:8080";
const USE_LOCAL_WS = import.meta.env.VITE_USE_LOCAL_WS === "true";

const MAX_LOBBY_PLAYERS = 5;

let ws = null;
let currentPlayerName = null;

function getWebSocketUrl(data) {
    if (USE_LOCAL_WS) {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return SERVER_ENDPOINT.startsWith("ws") ? SERVER_ENDPOINT : `${protocol}//${SERVER_ENDPOINT}`;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const endpoint = data?.serverEndpoint ?? data?.ServerEndpoint;
    if (endpoint && typeof endpoint === "string" && endpoint.length > 2) {
        if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) {
            return endpoint;
        }
        return `${protocol}//${endpoint}`;
    }
    if (data?.serverIp && data?.port != null) {
        return `${protocol}//${data.serverIp}:${data.port}`;
    }
    return SERVER_ENDPOINT.startsWith("ws") ? SERVER_ENDPOINT : `${protocol}//${SERVER_ENDPOINT}`;
}

function updateLobbyPlayerList(players, myName) {
    const playerList = document.getElementById("playerList");
    if (!playerList) return;

    const list = (players || []).map((p) => (typeof p === "string" ? p : p?.name)).filter(Boolean);
    const myNameNorm = String(myName || "").trim().toLowerCase();
    list.sort((a, b) => {
        const aIsYou = String(a || "").trim().toLowerCase() === myNameNorm;
        const bIsYou = String(b || "").trim().toLowerCase() === myNameNorm;
        if (aIsYou && !bIsYou) return -1;
        if (!aIsYou && bIsYou) return 1;
        return 0;
    });
    const emptySlots = Math.max(0, MAX_LOBBY_PLAYERS - list.length);

    playerList.innerHTML = "";
    list.forEach((p) => {
        const isYou = String(p || "").trim().toLowerCase() === String(myName || "").trim().toLowerCase();
        const li = document.createElement("li");
        li.className = isYou ? "player-item you" : "player-item other";
        const initial = (p || "?").charAt(0).toUpperCase();
        li.innerHTML = `
            <span class="avatar">${initial}</span>
            <span class="name">${escapeHtml(p || "Unknown")}</span>
            ${isYou ? '<span class="badge">You</span>' : ""}
        `;
        playerList.appendChild(li);
    });
    for (let i = 0; i < emptySlots; i++) {
        const li = document.createElement("li");
        li.className = "player-item empty";
        li.innerHTML = `
            <span class="avatar">?</span>
            <span class="name">Waiting for player...</span>
        `;
        playerList.appendChild(li);
    }
}

function connectWebSocket(playerName, data) {
    currentPlayerName = playerName;
    const lobbyId = (data?.lobbyId ?? data?.LobbyId ?? "").toString().trim() || undefined;
    const playerId = (data?.playerId ?? data?.PlayerId ?? "").toString().trim() || undefined;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    const url = getWebSocketUrl(data);
    ws = new WebSocket(url);

    ws.onopen = () => {
        const joinPayload = { type: "join", lobbyId, playerId, name: playerName };
        console.log("[Lobby] Joining with", joinPayload);
        ws.send(JSON.stringify(joinPayload));
        const statusEl = document.getElementById("status");
        if (statusEl) {
            statusEl.classList.add("success");
            statusEl.textContent = "Connected to game server";
        }
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === "welcomeMessage") {
                const lobbyInfo = document.getElementById("lobbyInfo");
                if (lobbyInfo) {
                    lobbyInfo.innerHTML = `
                        <strong>Lobby ID</strong> <span>${msg.gameId || msg.lobbyId || "—"}</span> &nbsp;·&nbsp;
                        <strong>Your ID</strong> <span>${msg.playerId || "—"}</span>
                    `;
                }
            }
            if (msg.type === "gameState" && msg.players) {
                updateLobbyPlayerList(msg.players, currentPlayerName);
            }
            if (msg.type === "gameStartCountdown") {
                showCountdown(msg.secondsLeft);
            }
            if (msg.type === "gameStart") {
                navigateToGame(data, msg, currentPlayerName);
            }
        } catch (e) {
            console.warn("WebSocket message parse error:", e);
        }
    };

    ws.onerror = () => {
        document.getElementById("status").textContent = "WebSocket error";
        document.getElementById("status").classList.add("error");
    };

    ws.onclose = () => {
        document.getElementById("status").textContent = "Disconnected from game server";
        document.getElementById("status").classList.remove("success");
    };
}

function showCountdown(secondsLeft) {
    const el = document.getElementById("lobbyCountdown");
    if (!el) return;
    el.classList.remove("hidden");
    el.textContent = secondsLeft > 0 ? `Starting in ${secondsLeft}...` : "Starting now!";
}

function navigateToGame(lobbyData, gameStartMsg, playerName) {
    const serverEndpoint = lobbyData?.serverEndpoint ??
        (lobbyData?.serverIp && lobbyData?.port != null ? `${lobbyData.serverIp}:${lobbyData.port}` : null);
    const context = {
        lobbyId: lobbyData?.lobbyId || gameStartMsg?.gameId,
        playerId: lobbyData?.playerId || gameStartMsg?.playerId,
        playerName: playerName || currentPlayerName,
        serverEndpoint,
    };
    sessionStorage.setItem("gameContext", JSON.stringify(context));
    window.location.href = "game.html";
}

function showLobbyView(playerName, data) {
    document.getElementById("matchmakingCard").classList.add("hidden");
    const lobbyView = document.getElementById("lobbyView");
    lobbyView.classList.add("visible");

    const serverDisplay = data.serverEndpoint ?? (data.serverIp && data.port != null ? `${data.serverIp}:${data.port}` : "—");
    document.getElementById("lobbyInfo").innerHTML = `
                    <strong>Lobby ID</strong> <span>${data.lobbyId || "—"}</span> &nbsp;·&nbsp;
                    <strong>Server</strong> <span>${serverDisplay}</span>
                `;

    const playerList = document.getElementById("playerList");
    const players = data.players || [playerName];
    let list = Array.isArray(players) ? [...players].map((p) => (typeof p === "string" ? p : p?.name)).filter(Boolean) : [];
    if (list.length === 0 && playerName) list = [playerName];
    const myNameNorm = String(playerName || "").trim().toLowerCase();
    list.sort((a, b) => {
        const aIsYou = String(a || "").trim().toLowerCase() === myNameNorm;
        const bIsYou = String(b || "").trim().toLowerCase() === myNameNorm;
        if (aIsYou && !bIsYou) return -1;
        if (!aIsYou && bIsYou) return 1;
        return 0;
    });
    const emptySlots = Math.max(0, MAX_LOBBY_PLAYERS - list.length);

    playerList.innerHTML = "";
    list.forEach((p) => {
        const isYou = String(p || "").trim().toLowerCase() === myNameNorm;
        const li = document.createElement("li");
        li.className = isYou ? "player-item you" : "player-item other";
        const initial = (p || "?").charAt(0).toUpperCase();
        li.innerHTML = `
                        <span class="avatar">${initial}</span>
                        <span class="name">${escapeHtml(p || "Unknown")}</span>
                        ${isYou ? '<span class="badge">You</span>' : ""}
                    `;
        playerList.appendChild(li);
    });
    for (let i = 0; i < emptySlots; i++) {
        const li = document.createElement("li");
        li.className = "player-item empty";
        li.innerHTML = `
                        <span class="avatar">?</span>
                        <span class="name">Waiting for player...</span>
                    `;
        playerList.appendChild(li);
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

async function findMatch() {
    const name = document.getElementById("playerName").value.trim();
    const statusDiv = document.getElementById("status");
    const resultDiv = document.getElementById("result");

    statusDiv.classList.remove("success", "error");
    if (!name) {
        statusDiv.innerText = "Please enter a name.";
        statusDiv.classList.add("error");
        return;
    }

    statusDiv.innerText = "Finding match...";
    resultDiv.innerText = "";

    try {
        // Send the action field required by your Lambda
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                action: "matchmake",
                playerName: name,
            }),
        });

        if (!response.ok) {
            throw new Error("Server error: " + response.status);
        }

        let data = await response.json();
        // API Gateway Lambda proxy returns { statusCode, body } where body is a JSON string
        if (typeof data?.body === "string") {
            data = JSON.parse(data.body);
        }
        showLobbyView(name, data);
        connectWebSocket(name, data);
    } catch (err) {
        statusDiv.innerText = "Error connecting to server.";
        statusDiv.classList.add("error");
        resultDiv.innerText = err.message;
    }
}

document.getElementById("findMatchBtn")?.addEventListener("click", findMatch);