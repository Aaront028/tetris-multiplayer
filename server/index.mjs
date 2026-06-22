import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const MAX_CHAT_MESSAGES = 60;
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const rooms = new Map();

const dist = join(__dirname, "..", "dist");
if (process.env.NODE_ENV === "production" || existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_, res) => res.sendFile(join(dist, "index.html")));
}

function getRoom(code) {
  const key = (code || randomRoom()).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (!rooms.has(key)) rooms.set(key, { clients: new Map(), activeIds: [], queue: [], pendingChallengerId: null, chat: [], rematchReady: new Set() });
  return [key, rooms.get(key)];
}

function randomRoom() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function safeSend(ws, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}

function publicClient(client) {
  return {
    id: client.id,
    name: client.name,
    connected: client.ws.readyState === client.ws.OPEN,
    role: client.role,
    state: client.state
  };
}

function reconcileRoom(room) {
  room.activeIds = room.activeIds.filter((id) => room.clients.has(id));
  const hadActivePlayers = room.activeIds.length > 0;
  for (const client of room.clients.values()) {
    if (room.activeIds.length >= 2) break;
    if (room.activeIds.includes(client.id)) continue;
    if (room.queue.includes(client.id) || room.pendingChallengerId === client.id) continue;
    if (client.role === "spectator" && hadActivePlayers) continue;
    client.role = "player";
    room.activeIds.push(client.id);
  }
  for (const client of room.clients.values()) {
    if (!room.activeIds.includes(client.id) && client.role === "player") client.role = "spectator";
  }
}

function roomSnapshot(room) {
  reconcileRoom(room);
  const active = room.activeIds.map((id) => room.clients.get(id)).filter(Boolean);
  const spectators = [...room.clients.values()].filter((client) => !room.activeIds.includes(client.id));
  return {
    players: active.map(publicClient),
    spectators: spectators.map((client) => ({ id: client.id, name: client.name, connected: client.ws.readyState === client.ws.OPEN })),
    queue: room.queue.map((id) => room.clients.get(id)).filter(Boolean).map((client) => ({ id: client.id, name: client.name })),
    pendingChallengerId: room.pendingChallengerId,
    chat: room.chat,
    rematchReady: [...(room.rematchReady || [])].filter((readyId) => room.clients.has(readyId))
  };
}

function broadcast(room, data) {
  for (const client of room.clients.values()) safeSend(client.ws, data);
}

function beginMatch(room, by) {
  const activeClients = room.activeIds.map((activeId) => room.clients.get(activeId)).filter(Boolean);
  const ready = activeClients.length >= 2 && activeClients.every((entry) => entry.ws.readyState === entry.ws.OPEN);
  if (!ready) return false;
  room.rematchReady = new Set();
  for (const activeId of room.activeIds) {
    const activeClient = room.clients.get(activeId);
    if (activeClient) {
      activeClient.role = "player";
      activeClient.state = null;
    }
  }
  broadcastActive(room, { type: "startMatch", by, at: Date.now() });
  broadcastRoom(room);
  return true;
}

function broadcastRoom(room) {
  reconcileRoom(room);
  broadcast(room, { type: "room", ...roomSnapshot(room) });
}
function broadcastActive(room, data) {
  for (const id of room.activeIds) {
    const client = room.clients.get(id);
    if (client) safeSend(client.ws, data);
  }
}

function broadcastActiveExcept(room, id, data) {
  for (const activeId of room.activeIds) {
    if (activeId === id) continue;
    const client = room.clients.get(activeId);
    if (client) safeSend(client.ws, data);
  }
}

function removeFromQueue(room, id) {
  room.queue = room.queue.filter((queuedId) => queuedId !== id);
  if (room.pendingChallengerId === id) room.pendingChallengerId = null;
}

function startQueuedChallenger(room, challengerId) {
  if (room.activeIds.length !== 1) return false;
  const challenger = room.clients.get(challengerId);
  if (!challenger || room.activeIds.includes(challengerId)) return false;

  removeFromQueue(room, challengerId);
  room.pendingChallengerId = null;
  challenger.role = "player";
  challenger.state = null;
  room.activeIds.push(challengerId);
  addChat(room, challenger, `${challenger.name} is up next against the winner.`, true);
  beginMatch(room, challengerId);
  return true;
}

function offerNextChallenger(room, winnerId) {
  if (!winnerId || !room.clients.has(winnerId) || room.pendingChallengerId) return;
  const nextId = room.queue.find((id) => room.clients.has(id) && !room.activeIds.includes(id));
  if (!nextId) return;
  startQueuedChallenger(room, nextId);
}

function addChat(room, client, text, system = false) {
  const message = {
    id: randomUUID(),
    at: Date.now(),
    from: system ? "System" : client.name,
    text: String(text || "").trim().slice(0, 220),
    system
  };
  if (!message.text) return;
  room.chat.push(message);
  room.chat = room.chat.slice(-MAX_CHAT_MESSAGES);
  broadcast(room, { type: "chat", message });
}

wss.on("connection", (ws, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const [roomCode, room] = getRoom(url.searchParams.get("room"));
  const name = (url.searchParams.get("name") || "Player").trim().slice(0, 18) || "Player";
  const id = randomUUID();
  const role = room.activeIds.length < 2 ? "player" : "spectator";
  const client = { id, name, ws, state: null, role };

  room.clients.set(id, client);
  if (role === "player") room.activeIds.push(id);

  safeSend(ws, { type: "welcome", id, room: roomCode, role, ...roomSnapshot(room) });
  addChat(room, client, `${name} joined as ${role}.`, true);
  broadcastRoom(room);

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const isActive = room.activeIds.includes(id);

    if (message.type === "state" && isActive) {
      client.state = message.state;
      broadcastRoom(room);
    }

    if (message.type === "lineClear" && isActive) {
      const lines = Math.max(0, Math.min(4, Number(message.lines) || 0));
      broadcastActiveExcept(room, id, { type: "garbage", lines, from: id });
    }

    if (message.type === "startMatch" && isActive) {
      beginMatch(room, id);
    }

    if (message.type === "rematch" && isActive) {
      if (!room.rematchReady) room.rematchReady = new Set();
      room.rematchReady.add(id);
      const allReady = room.activeIds.length >= 2 && room.activeIds.every((activeId) => room.rematchReady.has(activeId));
      broadcastRoom(room);
      if (allReady) beginMatch(room, id);
    }

    if (message.type === "gameOver" && isActive) {
      if (client.role === "spectator" && client.state?.gameOver) return;
      const loserId = id;
      const winnerId = room.activeIds.find((activeId) => activeId !== loserId) || null;
      const winner = winnerId ? room.clients.get(winnerId) : null;
      const matchWasLive = Boolean(winner?.state?.started && (client.state?.started || client.state?.gameOver));
      if (!matchWasLive) return;

      client.role = "spectator";
      if (client.state) {
        client.state = { ...client.state, gameOver: true, started: false, active: null };
      }
      room.rematchReady = new Set();
      removeFromQueue(room, loserId);
      room.activeIds = room.activeIds.filter((activeId) => activeId !== loserId);

      if (winnerId) {
        const winner = room.clients.get(winnerId);
        addChat(room, client, `${winner?.name || "Winner"} beat ${client.name}.`, true);
        broadcast(room, { type: "winner", winner: winner?.name || "Winner", loser: client.name, at: Date.now() });
        safeSend(winner.ws, { type: "matchWon", loserId });
        offerNextChallenger(room, winnerId);
      }
      broadcastRoom(room);
    }

    if (message.type === "becomePlayer" && !isActive && room.activeIds.length < 2) {
      removeFromQueue(room, id);
      client.role = "player";
      client.state = null;
      room.activeIds.push(id);
      addChat(room, client, `${client.name} joined the match.`, true);
      broadcastRoom(room);
    }
    if (message.type === "joinQueue" && !isActive) {
      if (!room.queue.includes(id)) room.queue.push(id);
      const winnerId = room.activeIds.length === 1 ? room.activeIds[0] : null;
      offerNextChallenger(room, winnerId);
      broadcastRoom(room);
    }

    if (message.type === "leaveQueue" && !isActive) {
      removeFromQueue(room, id);
      const winnerId = room.activeIds.length === 1 ? room.activeIds[0] : null;
      offerNextChallenger(room, winnerId);
      broadcastRoom(room);
    }

    if (message.type === "passChallenge" && room.pendingChallengerId === id) {
      removeFromQueue(room, id);
      const winnerId = room.activeIds.length === 1 ? room.activeIds[0] : null;
      offerNextChallenger(room, winnerId);
      broadcastRoom(room);
    }

    if (message.type === "acceptChallenge" && room.pendingChallengerId === id) {
      startQueuedChallenger(room, id);
    }

    if (message.type === "rename") {
      const nextName = String(message.name || "").trim().slice(0, 18);
      if (nextName && nextName !== client.name) {
        const previous = client.name;
        client.name = nextName;
        addChat(room, client, `${previous} is now ${nextName}.`, true);
        broadcastRoom(room);
      }
    }
    if (message.type === "chat") {
      addChat(room, client, message.text);
    }
  });

  ws.on("close", () => {
    const wasActive = room.activeIds.includes(id);
    room.clients.delete(id);
    removeFromQueue(room, id);
    room.rematchReady?.delete(id);
    room.activeIds = room.activeIds.filter((activeId) => activeId !== id);

    if (wasActive && room.activeIds.length === 1) {
      const winnerId = room.activeIds[0];
      const winner = room.clients.get(winnerId);
      const matchWasLive = Boolean(client.state?.started && winner?.state?.started);
      if (winner && matchWasLive) {
        broadcast(room, { type: "winner", winner: winner.name, loser: client.name, at: Date.now() });
        safeSend(winner.ws, { type: "matchWon", loserId: id });
        offerNextChallenger(room, winnerId);
      } else if (winner && client.state?.started) {
        addChat(room, client, `${client.name} left the match.`, true);
      }
    }

    broadcastRoom(room);
    if (room.clients.size === 0) rooms.delete(roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Battle Tetris server listening on http://0.0.0.0:${PORT}`);
});