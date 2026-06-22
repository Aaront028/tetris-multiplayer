import React from "react";
import ReactDOM from "react-dom/client";
import { Copy, Play, RotateCcw, Users } from "lucide-react";
import "./styles.css";

type Cell = number;
type Board = Cell[][];
type PieceKey = "I" | "J" | "L" | "O" | "S" | "T" | "Z";
type Piece = { key: PieceKey; matrix: number[][]; x: number; y: number };
type PublicState = {
  board: Board;
  active: Piece | null;
  score: number;
  lines: number;
  level: number;
  started: boolean;
  gameOver: boolean;
};
type Player = { id: string; name: string; connected: boolean; state: PublicState | null };

const WIDTH = 10;
const HEIGHT = 20;
const LINES_PER_LEVEL = 8;
const MAX_LEVEL = 12;
const START_DROP_MS = 900;
const MIN_DROP_MS = 95;
const LEVEL_SPEED_MULTIPLIER = 0.82;
const COLORS = ["", "cyan", "blue", "orange", "yellow", "green", "purple", "red", "garbage"];
const PIECES: Record<PieceKey, number[][]> = {
  I: [[1, 1, 1, 1]],
  J: [[2, 0, 0], [2, 2, 2]],
  L: [[0, 0, 3], [3, 3, 3]],
  O: [[4, 4], [4, 4]],
  S: [[0, 5, 5], [5, 5, 0]],
  T: [[0, 6, 0], [6, 6, 6]],
  Z: [[7, 7, 0], [0, 7, 7]]
};
const KEYS = Object.keys(PIECES) as PieceKey[];

const emptyBoard = (): Board => Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(0));
const cloneBoard = (board: Board): Board => board.map((row) => [...row]);
const randomPiece = (): Piece => {
  const key = KEYS[Math.floor(Math.random() * KEYS.length)];
  return { key, matrix: PIECES[key].map((row) => [...row]), x: Math.floor(WIDTH / 2) - 2, y: 0 };
};
const spawnPiece = (piece: Piece): Piece => ({
  key: piece.key,
  matrix: piece.matrix.map((row) => [...row]),
  x: Math.floor(WIDTH / 2) - 2,
  y: 0
});
const rotate = (matrix: number[][]) => matrix[0].map((_, x) => matrix.map((row) => row[x]).reverse());
const levelForLines = (lineCount: number) => Math.min(MAX_LEVEL, Math.floor(lineCount / LINES_PER_LEVEL) + 1);
const dropIntervalForLevel = (currentLevel: number) =>
  Math.max(MIN_DROP_MS, Math.round(START_DROP_MS * LEVEL_SPEED_MULTIPLIER ** (Math.min(currentLevel, MAX_LEVEL) - 1)));

function collides(board: Board, piece: Piece, dx = 0, dy = 0, matrix = piece.matrix) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) continue;
      const nx = piece.x + x + dx;
      const ny = piece.y + y + dy;
      if (nx < 0 || nx >= WIDTH || ny >= HEIGHT) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function merge(board: Board, piece: Piece) {
  const next = cloneBoard(board);
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value && next[piece.y + y]) next[piece.y + y][piece.x + x] = value;
    });
  });
  return next;
}

function clearLines(board: Board) {
  let cleared = 0;
  const remaining = board.filter((row) => {
    const full = row.every(Boolean);
    if (full) cleared++;
    return !full;
  });
  while (remaining.length < HEIGHT) remaining.unshift(Array(WIDTH).fill(0));
  return { board: remaining, cleared };
}

function addGarbage(board: Board, lines: number) {
  const next = cloneBoard(board);
  let toppedOut = false;
  for (let i = 0; i < lines; i++) {
    const removed = next.shift();
    if (removed?.some(Boolean)) toppedOut = true;
    const gap = Math.floor(Math.random() * WIDTH);
    next.push(Array.from({ length: WIDTH }, (_, x) => (x === gap ? 0 : 8)));
  }
  return { board: next, toppedOut };
}

function paint(board: Board, piece: Piece | null) {
  const view = cloneBoard(board);
  if (!piece) return view;
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      const py = piece.y + y;
      const px = piece.x + x;
      if (value && view[py]?.[px] === 0) view[py][px] = value;
    });
  });
  return view;
}

function BoardView({ state, small = false }: { state: PublicState | null; small?: boolean }) {
  const view = state ? paint(state.board, state.active) : emptyBoard();
  return (
    <div className={small ? "board small" : "board"} aria-label={small ? "Opponent board" : "Your board"}>
      {view.flatMap((row, y) =>
        row.map((cell, x) => <div className={`cell ${cell ? COLORS[cell] : ""}`} key={`${x}-${y}`} />)
      )}
    </div>
  );
}

function PiecePreview({ piece }: { piece: Piece }) {
  const preview = Array.from({ length: 4 }, (_, y) =>
    Array.from({ length: 4 }, (_, x) => piece.matrix[y]?.[x] || 0)
  );

  return (
    <div className="piece-preview" aria-label={`${piece.key} piece`}>
      {preview.flatMap((row, y) =>
        row.map((cell, x) => <div className={`preview-cell ${cell ? COLORS[cell] : ""}`} key={`${piece.key}-${x}-${y}`} />)
      )}
    </div>
  );
}

function getSocketUrl(room: string, name: string) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const host = location.port && location.port !== "3001" ? `${location.hostname}:3001` : location.host;
  const params = new URLSearchParams({ room, name });
  return `${protocol}//${host}?${params.toString()}`;
}

function useBattleSocket(
  room: string,
  name: string,
  onGarbage: (lines: number) => void,
  onStart: () => void,
  onRematch: () => void,
  onGameOver: () => void
) {
  const [socket, setSocket] = React.useState<WebSocket | null>(null);
  const [me, setMe] = React.useState("");
  const [serverRoom, setServerRoom] = React.useState(room);
  const [players, setPlayers] = React.useState<Player[]>([]);
  const [status, setStatus] = React.useState("Connecting");

  React.useEffect(() => {
    const ws = new WebSocket(getSocketUrl(room, name));
    setSocket(ws);
    ws.onopen = () => setStatus("Connected");
    ws.onclose = () => setStatus("Disconnected");
    ws.onerror = () => setStatus("Connection issue");
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "welcome") {
        setMe(message.id);
        setServerRoom(message.room);
        setPlayers(message.players);
        history.replaceState(null, "", `?room=${message.room}`);
      }
      if (message.type === "players") setPlayers(message.players);
      if (message.type === "garbage") onGarbage(message.lines);
      if (message.type === "startMatch") onStart();
      if (message.type === "rematch") onRematch();
      if (message.type === "gameOver") onGameOver();
      if (message.type === "full") setStatus("Room full");
    };
    return () => ws.close();
  }, [room, name, onGarbage, onStart, onRematch, onGameOver]);

  const send = React.useCallback((message: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, [socket]);

  return { send, me, room: serverRoom, players, status };
}

function App() {
  const params = new URLSearchParams(location.search);
  const [name] = React.useState(() => localStorage.getItem("battle-name") || `Player ${Math.ceil(Math.random() * 99)}`);
  const [room] = React.useState(() => params.get("room") || Math.random().toString(36).slice(2, 8).toUpperCase());
  const [board, setBoard] = React.useState(emptyBoard);
  const [active, setActive] = React.useState<Piece | null>(null);
  const [score, setScore] = React.useState(0);
  const [lines, setLines] = React.useState(0);
  const [level, setLevel] = React.useState(1);
  const [gameOver, setGameOver] = React.useState(false);
  const [started, setStarted] = React.useState(false);
  const [nextPieces, setNextPieces] = React.useState<Piece[]>(() => [randomPiece(), randomPiece(), randomPiece()]);
  const [flash, setFlash] = React.useState("");
  const boardRef = React.useRef(board);
  const activeRef = React.useRef(active);
  const nextPiecesRef = React.useRef(nextPieces);
  const gameOverRef = React.useRef(gameOver);
  const startedRef = React.useRef(started);
  const lastDrop = React.useRef(0);

  const startRound = React.useCallback(() => {
    const fresh = emptyBoard();
    const queue = [randomPiece(), randomPiece(), randomPiece()];
    const piece = spawnPiece(randomPiece());
    setBoard(fresh);
    setActive(piece);
    setNextPieces(queue);
    setScore(0);
    setLines(0);
    setLevel(1);
    setGameOver(false);
    setStarted(true);
    lastDrop.current = 0;
    boardRef.current = fresh;
    activeRef.current = piece;
    nextPiecesRef.current = queue;
    gameOverRef.current = false;
    startedRef.current = true;
  }, []);

  const finishRound = React.useCallback((message = "Game over", notifyOpponent = false) => {
    setGameOver(true);
    setStarted(false);
    setActive(null);
    setFlash(message);
    gameOverRef.current = true;
    startedRef.current = false;
    activeRef.current = null;
    setTimeout(() => setFlash(""), 1100);
    if (notifyOpponent) {
      window.dispatchEvent(new CustomEvent("battle-game-over"));
    }
  }, []);

  const handleGarbage = React.useCallback((incoming: number) => {
    if (!incoming || !startedRef.current || gameOverRef.current) return;
    setFlash(`+${incoming} garbage`);
    setTimeout(() => setFlash(""), 700);
    setBoard((current) => {
      const result = addGarbage(current, incoming);
      boardRef.current = result.board;
      if (result.toppedOut) finishRound("Game over", true);
      return result.board;
    });
  }, [finishRound]);

  const handleOpponentGameOver = React.useCallback(() => {
    finishRound("Opponent topped out");
  }, [finishRound]);

  const { send, me, room: serverRoom, players, status } = useBattleSocket(
    room,
    name,
    handleGarbage,
    startRound,
    startRound,
    handleOpponentGameOver
  );

  const state: PublicState = { board, active, score, lines, level, started, gameOver };
  const opponent = players.find((player) => player.id !== me);
  const invite = `${location.origin}${location.pathname}?room=${serverRoom}`;

  React.useEffect(() => {
    boardRef.current = board;
    activeRef.current = active;
    nextPiecesRef.current = nextPieces;
    gameOverRef.current = gameOver;
    startedRef.current = started;
    send({ type: "state", state });
  }, [board, active, nextPieces, score, lines, level, started, gameOver, send]);

  React.useEffect(() => {
    const onBattleGameOver = () => send({ type: "gameOver" });
    window.addEventListener("battle-game-over", onBattleGameOver);
    return () => window.removeEventListener("battle-game-over", onBattleGameOver);
  }, [send]);

  const lockPiece = React.useCallback(() => {
    const piece = activeRef.current;
    if (!piece || !startedRef.current || gameOverRef.current) return;
    const merged = merge(boardRef.current, piece);
    const result = clearLines(merged);
    const queue = nextPiecesRef.current.length ? nextPiecesRef.current : [randomPiece(), randomPiece(), randomPiece()];
    const nextPiece = spawnPiece(queue[0]);
    const nextQueue = [...queue.slice(1), randomPiece()];
    const newLines = lines + result.cleared;
    const newLevel = levelForLines(newLines);

    if (result.cleared) {
      send({ type: "lineClear", lines: result.cleared });
      setFlash(`${result.cleared} line${result.cleared > 1 ? "s" : ""} sent`);
      setTimeout(() => setFlash(""), 700);
    }

    if (collides(result.board, nextPiece)) {
      finishRound("Game over", true);
    } else {
      setActive(nextPiece);
      activeRef.current = nextPiece;
      setNextPieces(nextQueue);
      nextPiecesRef.current = nextQueue;
    }

    setBoard(result.board);
    boardRef.current = result.board;
    setLines(newLines);
    setLevel(newLevel);
    setScore((value) => value + [0, 100, 300, 500, 800][result.cleared] * newLevel + 12);
  }, [finishRound, lines, send]);

  const move = React.useCallback((dx: number) => {
    const piece = activeRef.current;
    if (!piece || !startedRef.current || gameOverRef.current) return;
    if (!collides(boardRef.current, piece, dx, 0)) {
      const next = { ...piece, x: piece.x + dx };
      activeRef.current = next;
      setActive(next);
    }
  }, []);

  const softDrop = React.useCallback(() => {
    const piece = activeRef.current;
    if (!piece || !startedRef.current || gameOverRef.current) return;
    if (!collides(boardRef.current, piece, 0, 1)) {
      const next = { ...piece, y: piece.y + 1 };
      activeRef.current = next;
      setActive(next);
    } else {
      lockPiece();
    }
  }, [lockPiece]);

  const hardDrop = React.useCallback(() => {
    const piece = activeRef.current;
    if (!piece || !startedRef.current || gameOverRef.current) return;
    let y = piece.y;
    while (!collides(boardRef.current, { ...piece, y }, 0, 1)) y++;
    const next = { ...piece, y };
    activeRef.current = next;
    setActive(next);
    setTimeout(lockPiece, 0);
  }, [lockPiece]);

  const rotateActive = React.useCallback(() => {
    const piece = activeRef.current;
    if (!piece || !startedRef.current || gameOverRef.current) return;
    const matrix = rotate(piece.matrix);
    const kick = [0, -1, 1, -2, 2].find((offset) => !collides(boardRef.current, piece, offset, 0, matrix));
    if (kick !== undefined) {
      const next = { ...piece, x: piece.x + kick, matrix };
      activeRef.current = next;
      setActive(next);
    }
  }, []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") move(-1);
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") move(1);
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") softDrop();
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") rotateActive();
      if (event.key === " ") {
        event.preventDefault();
        hardDrop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hardDrop, move, rotateActive, softDrop]);

  React.useEffect(() => {
    let frame = 0;
    const tick = (time: number) => {
      if (startedRef.current && !gameOverRef.current && time - lastDrop.current > dropIntervalForLevel(level)) {
        softDrop();
        lastDrop.current = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [level, softDrop, started]);

  const copyInvite = async () => {
    await navigator.clipboard.writeText(invite);
    setFlash("Invite copied");
    setTimeout(() => setFlash(""), 700);
  };

  const startMatch = () => {
    startRound();
    send({ type: "startMatch" });
  };

  const rematch = () => {
    startRound();
    send({ type: "rematch" });
  };

  return (
    <main className="app">
      <section className="topbar">
        <div>
          <h1>Battle Tetris</h1>
          <p><Users size={16} /> Room {serverRoom} - {status}</p>
        </div>
        <div className="actions">
          <button onClick={copyInvite}><Copy size={18} /> Invite</button>
          <button onClick={rematch}><RotateCcw size={18} /> Rematch</button>
        </div>
      </section>

      <section className="arena">
        <div className="playfield">
          <div className="panel-head">
            <span>{name}</span>
            <strong>{score}</strong>
          </div>
          <BoardView state={state} />
          {flash && <div className="toast">{flash}</div>}
          {!started && !gameOver && <button className="start" onClick={startMatch}><Play size={20} /> Start game</button>}
          {gameOver && (
            <div className="game-over">
              <strong>Game over</strong>
              <button onClick={rematch}><RotateCcw size={20} /> Play again</button>
            </div>
          )}
        </div>

        <aside className="side">
          <div className="stats">
            <span>Lines <strong>{lines}</strong></span>
            <span>Level <strong>{level}</strong></span>
          </div>
          <div className="next-panel">
            <div className="panel-head">
              <span>Next pieces</span>
            </div>
            <div className="next-list">
              {nextPieces.map((piece, index) => <PiecePreview piece={piece} key={`${piece.key}-${index}`} />)}
            </div>
          </div>
          <div className="opponent">
            <div className="panel-head">
              <span>{opponent?.name || "Waiting for friend"}</span>
              <strong>{opponent?.state?.score || 0}</strong>
            </div>
            <BoardView state={opponent?.state || null} small />
          </div>
          <div className="keys">
            <span>Move</span><b>A/D or Arrows</b>
            <span>Rotate</span><b>W or Up</b>
            <span>Drop</span><b>Space</b>
          </div>
        </aside>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
