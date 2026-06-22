import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();

const dist = join(__dirname, "..", "dist");
if (process.env.NODE_ENV === "production" || existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_, res) => res.sendFile(join(dist, "index.html")));
}

function getRoom(code) {
  const key = (code || randomRoom()).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (!rooms.has(key)) rooms.set(key, { players: new Map() });
  return [key, rooms.get(key)];
}

function randomRoom() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function safeSend(ws, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}

function roomSnapshot(room) {
  return [...room.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    connected: player.ws.readyState === player.ws.OPEN,
    state: player.state
  }));
}

function broadcast(room, data) {
  for (const player of room.players.values()) safeSend(player.ws, data);
}

function broadcastExcept(room, id, data) {
  for (const player of room.players.values()) {
    if (player.id !== id) safeSend(player.ws, data);
  }
}

wss.on("connection", (ws, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const [roomCode, room] = getRoom(url.searchParams.get("room"));
  const name = (url.searchParams.get("name") || "Player").slice(0, 18);

  if (room.players.size >= 2) {
    safeSend(ws, { type: "full", room: roomCode });
    ws.close();
    return;
  }

  const id = randomUUID();
  const player = { id, name, ws, state: null };
  room.players.set(id, player);

  safeSend(ws, { type: "welcome", id, room: roomCode, players: roomSnapshot(room) });
  broadcast(room, { type: "players", players: roomSnapshot(room) });

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "state") {
      player.state = message.state;
      broadcast(room, { type: "players", players: roomSnapshot(room) });
    }

    if (message.type === "lineClear") {
      const lines = Math.max(0, Math.min(4, Number(message.lines) || 0));
      for (const opponent of room.players.values()) {
        if (opponent.id !== id) safeSend(opponent.ws, { type: "garbage", lines, from: id });
      }
    }

    if (message.type === "startMatch") {
      broadcastExcept(room, id, { type: "startMatch", by: id, at: Date.now() });
    }

    if (message.type === "gameOver") {
      broadcastExcept(room, id, { type: "gameOver", by: id, at: Date.now() });
    }

    if (message.type === "rematch") {
      broadcastExcept(room, id, { type: "rematch", by: id, at: Date.now() });
    }
  });

  ws.on("close", () => {
    room.players.delete(id);
    broadcast(room, { type: "players", players: roomSnapshot(room) });
    if (room.players.size === 0) rooms.delete(roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Battle Tetris server listening on http://0.0.0.0:${PORT}`);
});
