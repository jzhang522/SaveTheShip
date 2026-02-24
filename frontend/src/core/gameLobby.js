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
            <span class="avatar avatar-waiting">
                <svg class="avatar-progress" viewBox="0 0 36 36">
                    <circle class="avatar-progress-bg" cx="18" cy="18" r="16"/>
                    <circle class="avatar-progress-fill" cx="18" cy="18" r="16"/>
                </svg>
                <span class="avatar-icon">?</span>
            </span>
            <span class="name">Waiting for player<span class="waiting-dots"><span>.</span><span>.</span><span>.</span></span></span>
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
        const statusEl = document.getElementById("lobbyStatus") || document.getElementById("status");
        if (statusEl) {
            statusEl.classList.add("success");
            statusEl.classList.remove("error");
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
                        <div><strong>Lobby ID</strong> <span class="lobby-value lobby-value-truncate" title="${escapeHtml(String(msg.gameId || msg.lobbyId || ""))}">${msg.gameId || msg.lobbyId || "—"}</span></div>
                        <div><strong>Player ID</strong> <span class="lobby-value lobby-value-truncate" title="${escapeHtml(String(msg.playerId || ""))}">${msg.playerId || "—"}</span></div>
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
            if (msg.type === "error") {
                const statusEl = document.getElementById("lobbyStatus") || document.getElementById("status");
                if (statusEl) {
                    statusEl.textContent = msg.message || "Session invalid. Please find a new match.";
                    statusEl.classList.add("error");
                }
                clearLobbyContext();
            }
        } catch (e) {
            console.warn("WebSocket message parse error:", e);
        }
    };

    ws.onerror = () => {
        const statusEl = document.getElementById("lobbyStatus") || document.getElementById("status");
        if (statusEl) {
            statusEl.textContent = "WebSocket error";
            statusEl.classList.add("error");
        }
    };

    ws.onclose = () => {
        const statusEl = document.getElementById("lobbyStatus") || document.getElementById("status");
        if (statusEl) {
            statusEl.textContent = "Disconnected from game server";
            statusEl.classList.remove("success");
        }
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
        lobbyId: lobbyData?.lobbyId ?? lobbyData?.LobbyId ?? gameStartMsg?.gameId,
        playerId: lobbyData?.playerId ?? lobbyData?.PlayerId ?? gameStartMsg?.playerId,
        playerName: playerName || currentPlayerName,
        serverEndpoint,
    };
    sessionStorage.setItem("gameContext", JSON.stringify(context));
    clearLobbyContext();
    window.location.href = "game.html";
}

function showLobbyView(playerName, data) {
    document.getElementById("matchmakingCard").classList.add("hidden");
    const lobbyView = document.getElementById("lobbyView");
    lobbyView.classList.add("visible");

    const playerIdDisplay = data?.playerId ?? data?.PlayerId ?? "—";
    document.getElementById("lobbyInfo").innerHTML = `
                    <div><strong>Lobby ID</strong> <span class="lobby-value lobby-value-truncate" title="${escapeHtml(String(data.lobbyId ?? data?.LobbyId ?? ""))}">${data.lobbyId ?? data?.LobbyId ?? "—"}</span></div>
                    <div><strong>Player ID</strong> <span class="lobby-value lobby-value-truncate" title="${escapeHtml(String(playerIdDisplay))}">${playerIdDisplay}</span></div>
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
                        <span class="avatar avatar-waiting">
                            <svg class="avatar-progress" viewBox="0 0 36 36">
                                <circle class="avatar-progress-bg" cx="18" cy="18" r="16"/>
                                <circle class="avatar-progress-fill" cx="18" cy="18" r="16"/>
                            </svg>
                            <span class="avatar-icon">?</span>
                        </span>
                        <span class="name">Waiting for player<span class="waiting-dots"><span>.</span><span>.</span><span>.</span></span></span>
                    `;
        playerList.appendChild(li);
    }
}

const LOBBY_CONTEXT_KEY = "lobbyContext";

function sendLeaveMessage(opts = {}) {
    const ctx = loadStoredLobbyContext();
    const lobbyId = ctx?.lobbyId;
    const playerId = ctx?.playerId;
    if (!lobbyId || !playerId) return Promise.resolve();

    // Call Lambda API to remove player from DynamoDB
    const leavePromise = API_URL
        ? fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "leave", lobbyId, playerId }),
            keepalive: opts.keepalive ?? true
        }).catch(() => { })
        : Promise.resolve();

    // Also notify WebSocket server for in-memory cleanup
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify({ type: "leave", lobbyId, playerId }));
        } catch (_) { /* best-effort */ }
    }

    return leavePromise;
}

function storeLobbyContext(playerName, data) {
    const ctx = {
        lobbyId: data?.lobbyId ?? data?.LobbyId,
        playerId: data?.playerId ?? data?.PlayerId,
        playerName: playerName,
        serverEndpoint: data?.serverEndpoint ?? data?.ServerEndpoint,
        serverIp: data?.serverIp,
        port: data?.port,
    };
    sessionStorage.setItem(LOBBY_CONTEXT_KEY, JSON.stringify(ctx));
}

function loadStoredLobbyContext() {
    try {
        const raw = sessionStorage.getItem(LOBBY_CONTEXT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function clearLobbyContext() {
    sessionStorage.removeItem(LOBBY_CONTEXT_KEY);
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
        storeLobbyContext(name, data);
        showLobbyView(name, data);
        connectWebSocket(name, data);
    } catch (err) {
        statusDiv.innerText = "Error connecting to server.";
        statusDiv.classList.add("error");
        resultDiv.innerText = err.message;
    }
}

document.getElementById("findMatchBtn")?.addEventListener("click", findMatch);

document.getElementById("playerName")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        findMatch();
    }
});

document.addEventListener("keydown", (e) => {
    const matchmakingCard = document.getElementById("matchmakingCard");
    const playerNameInput = document.getElementById("playerName");
    if (!matchmakingCard || !playerNameInput) return;
    if (matchmakingCard.classList.contains("hidden")) return;
    if (document.activeElement === playerNameInput) return;
    const isLetter = /^[a-zA-Z]$/.test(e.key);
    const isShift = e.key === "Shift";
    if (!isLetter && !isShift) return;
    e.preventDefault();
    e.stopPropagation();
    playerNameInput.focus();
    if (isLetter) {
        playerNameInput.value += e.key;
    }
});

document.getElementById("leaveLobbyBtn")?.addEventListener("click", async () => {
    await sendLeaveMessage({ keepalive: false });
    if (ws) {
        ws.close();
        ws = null;
    }
    clearLobbyContext();
    document.getElementById("lobbyView")?.classList.remove("visible");
    document.getElementById("matchmakingCard")?.classList.remove("hidden");
});

// Note: We do NOT use beforeunload/pagehide to send leave - that would incorrectly
// remove the player when they navigate to /game (e.g. typing URL). Browser/tab close
// is handled by the backend when the WebSocket disconnects.

// On load: if we have stored lobby context (e.g. after refresh), validate then rejoin
async function initLobby() {
    if (window.location.pathname === "/game" || window.location.pathname === "/game/") {
        window.history.replaceState(null, "", "/");
    }
    const stored = loadStoredLobbyContext();
    if (!stored?.lobbyId || !stored?.playerId || !stored?.playerName) return;

    const statusDiv = document.getElementById("status");
    if (statusDiv) statusDiv.textContent = "Validating session...";

    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "validateSession",
                lobbyId: stored.lobbyId,
                playerId: stored.playerId,
            }),
        });
        let data = await response.json();
        if (typeof data?.body === "string") data = JSON.parse(data.body);

        if (!data?.valid) {
            clearLobbyContext();
            if (statusDiv) statusDiv.textContent = "Session expired. Please find a new match.";
            return;
        }
        if (statusDiv) statusDiv.textContent = "";

        showLobbyView(stored.playerName, stored);
        const lobbyStatusEl = document.getElementById("lobbyStatus");
        if (lobbyStatusEl) lobbyStatusEl.textContent = "Reconnecting to lobby...";
        connectWebSocket(stored.playerName, stored);
    } catch {
        clearLobbyContext();
        if (statusDiv) statusDiv.textContent = "Could not validate session. Please find a new match.";
    }
}
initLobby();