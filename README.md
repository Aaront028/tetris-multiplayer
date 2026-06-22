# Battle Tetris

A simple two-player Tetris battle game built with React, TypeScript, Vite, Node, Express, and WebSockets.

Each player sees their own board and a live preview of their opponent's board. When you clear lines, the same number of garbage lines is sent to your opponent.

## Requirements

- Node.js 20 or newer
- pnpm

If you do not have pnpm installed:

```bash
npm install -g pnpm
```

## Install

From the project folder:

```bash
pnpm install
```

## Start The App

Run both the frontend and multiplayer server:

```bash
pnpm run dev
```

Then open:

```text
http://127.0.0.1:5173
```

The Vite frontend runs on port `5173`.
The WebSocket multiplayer server runs on port `3001`.

## How To Play

- Move left/right: `A` / `D` or arrow keys
- Soft drop: `S` or down arrow
- Rotate: `W` or up arrow
- Hard drop: `Space`

Click `Start` to begin.

## Playing With A Friend

1. Start the app with `pnpm run dev`.
2. Open `http://127.0.0.1:5173` on the host machine, or `http://YOUR_LAN_IP:5173` from another device on the same network.
3. Click `Invite`.
4. Send the copied room link to your friend.

For someone outside your local network to join, the app must be deployed somewhere public because local network addresses only work near your machine.

## Build For Production

```bash
pnpm run build
```

The compiled frontend is created in `dist`.

## Run The Production Server

After building:

```bash
pnpm run server
```

Then open:

```text
http://127.0.0.1:3001
```

## Deploying

This app needs a Node server because multiplayer uses WebSockets. Static-only hosts are not enough unless you split the frontend and server.

Good free or low-cost places to try:

- Render
- Railway
- Koyeb
- Fly.io

The client automatically uses the same deployed host for WebSockets in production. In local Vite development, it connects to the same host on port `3001`.

## Scripts

```bash
pnpm run dev
```

Starts the frontend and multiplayer server together.

```bash
pnpm run client
```

Starts only the Vite frontend.

```bash
pnpm run server
```

Starts only the Node/WebSocket server.

```bash
pnpm run build
```

Type-checks and builds the frontend.
