import React from "react";
import ReactDOM from "react-dom/client";
import { Copy, LogIn, MessageSquare, Play, RotateCcw, Send, Users, X, ChevronRight, ChevronLeft, RotateCw, ArrowDown, ChevronsDown, Pause } from "lucide-react";
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
type Role = "player" | "spectator";
type Player = { id: string; name: string; connected: boolean; role?: Role; state: PublicState | null };
type Spectator = { id: string; name: string; connected: boolean };
type QueueEntry = { id: string; name: string };
type ChatMessage = { id: string; at: number; from: string; text: string; system?: boolean };
type EndReason = "lost" | "won" | null;

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

function useTouchRepeat(action: () => void) {
  const timers = React.useRef<{ delay?: number; interval?: number }>({});

  const clear = React.useCallback(() => {
    if (timers.current.delay) window.clearTimeout(timers.current.delay);
    if (timers.current.interval) window.clearInterval(timers.current.interval);
    timers.current = {};
  }, []);

  React.useEffect(() => () => clear(), [clear]);

  return {
    onPointerDown: (event: React.PointerEvent) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      action();
      timers.current.delay = window.setTimeout(() => {
        timers.current.interval = window.setInterval(action, 75);
      }, 160);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear
  };
}

function useBoardSwipe(
  enabled: boolean,
  move: (dx: number) => void,
  softDrop: () => void,
  hardDrop: () => void,
  rotateActive: () => void
) {
  const start = React.useRef({ x: 0, y: 0, t: 0 });

  return {
    onTouchStart: (event: React.TouchEvent) => {
      if (!enabled) return;
      const touch = event.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    },
    onTouchEnd: (event: React.TouchEvent) => {
      if (!enabled) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.current.x;
      const dy = touch.clientY - start.current.y;
      const elapsed = Date.now() - start.current.t;
      if (elapsed < 260 && Math.abs(dx) < 24 && Math.abs(dy) < 24) {
        rotateActive();
        return;
      }
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 28) {
        move(dx > 0 ? 1 : -1);
        return;
      }
      if (dy > 36) {
        if (dy > 92) hardDrop();
        else softDrop();
      }
    }
  };
}

function MobileControls({
  visible,
  onLeft,
  onRight,
  onRotate,
  onSoftDrop,
  onHardDrop
}: {
  visible: boolean;
  onLeft: () => void;
  onRight: () => void;
  onRotate: () => void;
  onSoftDrop: () => void;
  onHardDrop: () => void;
}) {
  const left = useTouchRepeat(onLeft);
  const right = useTouchRepeat(onRight);
  const down = useTouchRepeat(onSoftDrop);
  const rotate = useTouchRepeat(onRotate);

  if (!visible) return null;

  return (
    <div className="mobile-controls" aria-label="Touch controls">
      <button type="button" className="mobile-btn rotate" aria-label="Rotate" {...rotate}>
        <RotateCw size={24} />
      </button>
      <button type="button" className="mobile-btn left" aria-label="Move left" {...left}>
        <ChevronLeft size={28} />
      </button>
      <button type="button" className="mobile-btn down" aria-label="Soft drop" {...down}>
        <ArrowDown size={24} />
      </button>
      <button type="button" className="mobile-btn right" aria-label="Move right" {...right}>
        <ChevronRight size={28} />
      </button>
      <button
        type="button"
        className="mobile-btn hard-drop"
        aria-label="Hard drop"
        onPointerDown={(event) => {
          event.preventDefault();
          onHardDrop();
        }}
      >
        <ChevronsDown size={26} />
      </button>
    </div>
  );
}

function getSocketUrl(room: string, name: string) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ room, name });
  return `${protocol}//${location.host}/ws?${params.toString()}`;
}

function useBattleSocket(
  room: string,
  name: string,
  onGarbage: (lines: number) => void,
  onStart: () => void,
  onMatchWon: () => void,
  onWinner: (winner: string, loser: string) => void,
  onMatchPause: (paused: boolean, by?: string | null) => void
) {
  const [socket, setSocket] = React.useState<WebSocket | null>(null);
  const [me, setMe] = React.useState("");
  const [serverRoom, setServerRoom] = React.useState(room);
  const [players, setPlayers] = React.useState<Player[]>([]);
  const [spectators, setSpectators] = React.useState<Spectator[]>([]);
  const [queue, setQueue] = React.useState<QueueEntry[]>([]);
  const [pendingChallengerId, setPendingChallengerId] = React.useState<string | null>(null);
  const [chat, setChat] = React.useState<ChatMessage[]>([]);
  const [rematchReady, setRematchReady] = React.useState<string[]>([]);
  const [role, setRole] = React.useState<Role>("spectator");
  const [status, setStatus] = React.useState("Connecting");

  const onGarbageRef = React.useRef(onGarbage);
  const onStartRef = React.useRef(onStart);
  const onMatchWonRef = React.useRef(onMatchWon);
  const onWinnerRef = React.useRef(onWinner);
  const onMatchPauseRef = React.useRef(onMatchPause);
  onGarbageRef.current = onGarbage;
  onStartRef.current = onStart;
  onMatchWonRef.current = onMatchWon;
  onWinnerRef.current = onWinner;
  onMatchPauseRef.current = onMatchPause;

  const applyRoom = React.useCallback((message: any) => {
    setPlayers(message.players || []);
    setSpectators(message.spectators || []);
    setQueue(message.queue || []);
    setPendingChallengerId(message.pendingChallengerId || null);
    setRematchReady(message.rematchReady || []);
    if (message.chat) setChat(message.chat);
    if (typeof message.matchPaused === "boolean") {
      onMatchPauseRef.current(message.matchPaused, message.pausedBy || null);
    }
  }, []);

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
        setRole(message.role || "spectator");
        setServerRoom(message.room);
        applyRoom(message);
        history.replaceState(null, "", `?room=${message.room}`);
      }
      if (message.type === "room") applyRoom(message);
      if (message.type === "chat") setChat((current) => [...current.slice(-59), message.message]);
      if (message.type === "garbage") onGarbageRef.current(message.lines);
      if (message.type === "startMatch") onStartRef.current();
      if (message.type === "matchPause") onMatchPauseRef.current(message.paused, message.by || null);
      if (message.type === "matchWon") onMatchWonRef.current();
      if (message.type === "winner") onWinnerRef.current(message.winner, message.loser);
    };
    return () => ws.close();
  }, [room, name, applyRoom]);

  React.useEffect(() => {
    if (!me) return;
    setRole(players.some((player) => player.id === me) ? "player" : "spectator");
  }, [me, players]);

  const send = React.useCallback((message: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, [socket]);

  return { send, me, room: serverRoom, players, spectators, queue, pendingChallengerId, rematchReady, chat, role, status };
}

function App() {
  const params = new URLSearchParams(location.search);
  const [name, setName] = React.useState(() => localStorage.getItem("battle-name") || `Player ${Math.ceil(Math.random() * 99)}`);
  const [draftName, setDraftName] = React.useState(name);
  const [chatText, setChatText] = React.useState("");
  const [room] = React.useState(() => params.get("room") || Math.random().toString(36).slice(2, 8).toUpperCase());
  const [board, setBoard] = React.useState(emptyBoard);
  const [active, setActive] = React.useState<Piece | null>(null);
  const [score, setScore] = React.useState(0);
  const [lines, setLines] = React.useState(0);
  const [level, setLevel] = React.useState(1);
  const [gameOver, setGameOver] = React.useState(false);
  const [endReason, setEndReason] = React.useState<EndReason>(null);
  const [started, setStarted] = React.useState(false);
  const [nextPieces, setNextPieces] = React.useState<Piece[]>(() => [randomPiece(), randomPiece(), randomPiece()]);
  const [flash, setFlash] = React.useState("");
  const [winnerBanner, setWinnerBanner] = React.useState("");
  const [winnerSubtext, setWinnerSubtext] = React.useState("");
  const [sideCollapsed, setSideCollapsed] = React.useState(false);
  const [showChat, setShowChat] = React.useState(false);
  const [showInfo, setShowInfo] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [pausedBy, setPausedBy] = React.useState<string | null>(null);
  const boardRef = React.useRef(board);
  const activeRef = React.useRef(active);
  const nextPiecesRef = React.useRef(nextPieces);
  const gameOverRef = React.useRef(gameOver);
  const startedRef = React.useRef(started);
  const pausedRef = React.useRef(paused);
  const lastDrop = React.useRef(0);
  const lockingRef = React.useRef(false);
  const pendingGameOverNotify = React.useRef(false);
  const [opponentSnapshot, setOpponentSnapshot] = React.useState<PublicState | null>(null);
  const [opponentNameSnapshot, setOpponentNameSnapshot] = React.useState("");

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
    setEndReason(null);
    setStarted(true);
    setPaused(false);
    setPausedBy(null);
    setOpponentSnapshot(null);
    setOpponentNameSnapshot("");
    pendingGameOverNotify.current = false;
    lastDrop.current = 0;
    boardRef.current = fresh;
    activeRef.current = piece;
    nextPiecesRef.current = queue;
    gameOverRef.current = false;
    startedRef.current = true;
    pausedRef.current = false;
  }, []);

  const finishRound = React.useCallback((message = "Game over", notifyOpponent = false, reason: EndReason = "lost") => {
    const piece = activeRef.current;
    if (piece) {
      const frozen = merge(boardRef.current, piece);
      boardRef.current = frozen;
      setBoard(frozen);
    }
    setGameOver(true);
    setEndReason(reason);
    setStarted(false);
    setPaused(false);
    setPausedBy(null);
    setActive(null);
    setFlash(message);
    gameOverRef.current = true;
    startedRef.current = false;
    pausedRef.current = false;
    activeRef.current = null;
    lockingRef.current = false;
    setTimeout(() => setFlash(""), 1100);
    if (notifyOpponent) pendingGameOverNotify.current = true;
  }, []);

  const handleGarbage = React.useCallback((incoming: number) => {
    if (!incoming || !startedRef.current || gameOverRef.current || pausedRef.current) return;
    setFlash(`+${incoming} garbage`);
    setTimeout(() => setFlash(""), 700);
    setBoard((current) => {
      const result = addGarbage(current, incoming);
      boardRef.current = result.board;
      if (result.toppedOut) finishRound("Game over", true);
      return result.board;
    });
  }, [finishRound]);

  const handleMatchWon = React.useCallback(() => {
    if (gameOverRef.current) return;
    finishRound("You won!", false, "won");
  }, [finishRound]);

  const handleWinner = React.useCallback((winner: string, loser: string) => {
    const isYou = winner === name;
    setWinnerBanner(isYou ? `You win!` : `${winner} wins!`);
    setWinnerSubtext(isYou ? `${loser} was defeated` : `${loser} lost`);
    setTimeout(() => {
      setWinnerBanner("");
      setWinnerSubtext("");
    }, 4500);
  }, [name]);

  const handleMatchPause = React.useCallback((isPaused: boolean, by?: string | null) => {
    setPaused(isPaused);
    pausedRef.current = isPaused;
    setPausedBy(isPaused ? by || null : null);
    if (isPaused && by && by !== name) {
      setFlash(`${by} paused`);
      setTimeout(() => setFlash(""), 900);
    }
  }, [name]);

  const { send, me, room: serverRoom, players, spectators, queue, pendingChallengerId, rematchReady, chat, role, status } = useBattleSocket(
    room,
    name,
    handleGarbage,
    startRound,
    handleMatchWon,
    handleWinner,
    handleMatchPause
  );

  const state: PublicState = { board, active, score, lines, level, started, gameOver };
  const connected = Boolean(me);
  const isPlayer = connected && players.some((player) => player.id === me);
  const liveMatchUnderway = players.filter((player) => player.state?.started && !player.state?.gameOver).length >= 2;
  const shouldSpectateLiveMatch = !isPlayer && liveMatchUnderway;
  const showMatchLayout = isPlayer || (gameOver && !shouldSpectateLiveMatch);
  const canJoinMatch = connected && !isPlayer && players.length < 2;
  const primaryPlayer = isPlayer ? players.find((player) => player.id === me) : players[0];
  const opponent = isPlayer ? players.find((player) => player.id !== me) : players[1];
  const opponentState = opponent?.state || (gameOver ? opponentSnapshot : null);
  const primaryState = showMatchLayout ? state : primaryPlayer?.state || null;
  const primaryName = showMatchLayout ? name : primaryPlayer?.name || "Waiting for player";
  const primaryScore = showMatchLayout ? score : primaryPlayer?.state?.score || 0;
  const queued = queue.some((entry) => entry.id === me);
  const queuePosition = queue.findIndex((entry) => entry.id === me) + 1;
  const hasChallengeOffer = pendingChallengerId === me;
  const nextInQueue = queue[0];
  const hasQueueWaiting = queue.length > 0;
  const canRematch = gameOver && endReason === "won" && !hasQueueWaiting && !pendingChallengerId && players.length >= 2 && players.every((player) => player.connected);
  const canStartMatch = (isPlayer || gameOver) && players.length >= 2 && players.every((player) => player.connected);
  const rematchQueued = rematchReady.includes(me);
  const waitingForRematch = gameOver && rematchQueued && rematchReady.length < players.length;
  const opponentLabel = opponent?.name || opponentNameSnapshot || "Waiting for friend";
  const invite = `${location.origin}${location.pathname}?room=${serverRoom}`;

  const canPause = isPlayer && started && !gameOver;
  const togglePause = React.useCallback(() => {
    if (!canPause) return;
    send({ type: "setPause", paused: !paused });
  }, [canPause, send, paused]);

  React.useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  React.useEffect(() => {
    if (opponent?.state) setOpponentSnapshot(opponent.state);
    if (opponent?.name) setOpponentNameSnapshot(opponent.name);
  }, [opponent?.state, opponent?.name]);

  React.useEffect(() => {
    if (!shouldSpectateLiveMatch || !gameOver) return;
    setGameOver(false);
    setEndReason(null);
    setStarted(false);
    setActive(null);
    gameOverRef.current = false;
    startedRef.current = false;
    activeRef.current = null;
  }, [shouldSpectateLiveMatch, gameOver]);

  React.useEffect(() => {
    boardRef.current = board;
    activeRef.current = active;
    nextPiecesRef.current = nextPieces;
    gameOverRef.current = gameOver;
    startedRef.current = started;
    const liveState: PublicState = { board, active, score, lines, level, started, gameOver };
    if (isPlayer) send({ type: "state", state: liveState });
    if (pendingGameOverNotify.current && gameOver && isPlayer) {
      pendingGameOverNotify.current = false;
      send({ type: "gameOver" });
    }
  }, [board, active, nextPieces, score, lines, level, started, gameOver, isPlayer, send]);

  const lockPiece = React.useCallback(() => {
    if (lockingRef.current) return;
    const piece = activeRef.current;
    if (!piece || !startedRef.current || gameOverRef.current || pausedRef.current) return;
    if (!collides(boardRef.current, piece, 0, 1)) return;
    lockingRef.current = true;

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
      setBoard(result.board);
      boardRef.current = result.board;
      setLines(newLines);
      setLevel(newLevel);
      setScore((value) => value + [0, 100, 300, 500, 800][result.cleared] * newLevel + 12);
      activeRef.current = null;
      setActive(null);
      lockingRef.current = false;
      finishRound("Game over", true, "lost");
      return;
    }

    setActive(nextPiece);
    activeRef.current = nextPiece;
    setNextPieces(nextQueue);
    nextPiecesRef.current = nextQueue;
    setBoard(result.board);
    boardRef.current = result.board;
    setLines(newLines);
    setLevel(newLevel);
    setScore((value) => value + [0, 100, 300, 500, 800][result.cleared] * newLevel + 12);
    lockingRef.current = false;
  }, [finishRound, lines, send]);

  const move = React.useCallback((dx: number) => {
    const piece = activeRef.current;
    if (!piece || !startedRef.current || gameOverRef.current || pausedRef.current) return;
    if (!collides(boardRef.current, piece, dx, 0)) {
      const next = { ...piece, x: piece.x + dx };
      activeRef.current = next;
      setActive(next);
    }
  }, []);

  const softDrop = React.useCallback(() => {
    const piece = activeRef.current;
    if (!piece || !startedRef.current || gameOverRef.current || pausedRef.current) return;
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
    if (!piece || !startedRef.current || gameOverRef.current || pausedRef.current) return;
    let y = piece.y;
    while (!collides(boardRef.current, { ...piece, y }, 0, 1)) y++;
    const next = { ...piece, y };
    activeRef.current = next;
    setActive(next);
    lockPiece();
  }, [lockPiece]);

  const rotateActive = React.useCallback(() => {
    const piece = activeRef.current;
    if (!piece || !startedRef.current || gameOverRef.current || pausedRef.current) return;
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
      const key = event.key.toLowerCase();
      if (key === "p" && isPlayer && startedRef.current && !gameOverRef.current) {
        event.preventDefault();
        togglePause();
        return;
      }
      const gameKeys = ["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "a", "d", "s", "w"];
      if (!gameKeys.includes(key)) return;
      event.preventDefault();
      if (!isPlayer || !startedRef.current || gameOverRef.current || pausedRef.current) return;
      if (event.key === "ArrowLeft" || key === "a") move(-1);
      if (event.key === "ArrowRight" || key === "d") move(1);
      if (event.key === "ArrowDown" || key === "s") softDrop();
      if (event.key === "ArrowUp" || key === "w") rotateActive();
      if (event.key === " ") hardDrop();
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [hardDrop, isPlayer, move, rotateActive, softDrop, togglePause]);

  const mobileControlsActive = isPlayer && started && !gameOver && !paused;
  const boardSwipe = useBoardSwipe(mobileControlsActive, move, softDrop, hardDrop, rotateActive);

  React.useEffect(() => {
    let frame = 0;
    const tick = (time: number) => {
      if (startedRef.current && !gameOverRef.current && !pausedRef.current && time - lastDrop.current > dropIntervalForLevel(level)) {
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

  const saveName = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = draftName.trim().slice(0, 18) || name;
    localStorage.setItem("battle-name", clean);
    send({ type: "rename", name: clean });
    setName(clean);
    setDraftName(clean);
  };

  const sendChat = (event: React.FormEvent) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    send({ type: "chat", text });
    setChatText("");
  };

  const startMatch = () => {
    if (!canStartMatch) return;
    send({ type: "startMatch" });
  };

  const rematch = () => {
    if (!canRematch) return;
    send({ type: "rematch" });
  };

  const becomePlayer = () => send({ type: "becomePlayer" });
  const joinQueue = () => send({ type: "joinQueue" });
  const leaveQueue = () => send({ type: "leaveQueue" });
  const acceptChallenge = () => send({ type: "acceptChallenge" });
  const passChallenge = () => send({ type: "passChallenge" });

  const renderQueuePanel = () => (
    <div className="queue-panel">
      {hasChallengeOffer ? (
        <>
          <strong>Play winner?</strong>
          <div className="queue-actions">
            <button onClick={acceptChallenge}><Play size={16} /> Play</button>
            <button onClick={passChallenge}>Pass</button>
          </div>
        </>
      ) : queued ? (
        <>
          <span>Queued #{queuePosition}</span>
          <button onClick={leaveQueue}>Leave queue</button>
        </>
      ) : (
        <button onClick={joinQueue}><Play size={16} /> Join queue</button>
      )}
    </div>
  );

  const renderRoomPanel = () => (
    <div className="room-panel">
      <div className="panel-head">
        <span>Room</span>
        <strong>{spectators.length}</strong>
      </div>
      <div className="room-list">
        <span>Players</span>
        <b>{players.map((player) => player.name).join(" vs ") || "Waiting"}</b>
        <span>Queue</span>
        <b>{queue.map((entry) => entry.name).join(", ") || "Empty"}</b>
        <span>Spectators</span>
        <b>{spectators.map((spectator) => spectator.name).join(", ") || "None"}</b>
      </div>
    </div>
  );

  const renderChatPanel = (autoFocus = false) => (
    <div className="chat-panel">
      <div className="chat-log">
        {chat.map((message) => (
          <div className={message.system ? "chat-message system" : "chat-message"} key={message.id}>
            <strong>{message.from}</strong>
            <span>{message.text}</span>
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={sendChat}>
        <input
          value={chatText}
          onChange={(event) => setChatText(event.target.value)}
          maxLength={220}
          aria-label="Chat message"
          autoFocus={autoFocus}
        />
        <button type="submit"><Send size={16} /></button>
      </form>
    </div>
  );

  const renderPlayersList = () => (
    <div className="compact-room-panel">
      <div className="player-badge">
        <Users size={14} />
        <span>{players.length + spectators.length}</span>
        <span className="divider">|</span>
        <span>{players.map(p => p.name).join(" vs ") || "Waiting"}</span>
      </div>
    </div>
  );

  return (
    <main className="app">
      {winnerBanner && (
        <div className="winner-overlay" role="status" aria-live="assertive">
          <div className="winner-content">
            <div className="winner-banner">{winnerBanner}</div>
            {winnerSubtext && <div className="winner-subtext">{winnerSubtext}</div>}
          </div>
        </div>
      )}
      <section className="topbar">
        <div className="topbar-left">
          <h1>Battle Tetris</h1>
          <div className="topbar-meta">
            <span className="room-tag"><Users size={14} /> {serverRoom}</span>
            <span className="status-dot" data-connected={status === "Connected"} />
            <span className="status-text">{paused ? "Paused" : isPlayer ? "Playing" : "Spectating"}</span>
          </div>
        </div>
        <div className="actions">
          <form className="name-form" onSubmit={saveName}>
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={18} aria-label="Username" />
            <button type="submit" title="Save name"><LogIn size={18} /></button>
          </form>
          <button onClick={copyInvite} title="Copy invite link"><Copy size={18} /></button>
          <button onClick={rematch} disabled={!canRematch} title="Rematch"><RotateCcw size={18} /></button>
          <button
            onClick={togglePause}
            disabled={!canPause}
            title={paused ? "Resume (P)" : "Pause (P)"}
            className={paused ? "active-toggle" : ""}
          >
            {paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <button onClick={() => setShowChat(v => !v)} title="Toggle chat" className={showChat ? "active-toggle" : ""}>
            <MessageSquare size={18} />
            {chat.length > 0 && <span className="notif-dot" />}
          </button>
          <button onClick={() => setShowInfo(v => !v)} title="Toggle room info" className={showInfo ? "active-toggle" : ""}>
            <Users size={18} />
          </button>
          <button onClick={() => setSideCollapsed(v => !v)} title="Toggle controls panel">
            {sideCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
      </section>

      {showChat && (
        <div className="popup-overlay" onClick={() => setShowChat(false)}>
          <div className="popup chat-popup" onClick={(e) => e.stopPropagation()}>
            <div className="popup-header">
              <span><MessageSquare size={16} /> Chat</span>
              <button onClick={() => setShowChat(false)} className="close-btn"><X size={18} /></button>
            </div>
            {renderChatPanel(true)}
          </div>
        </div>
      )}

      {showInfo && (
        <div className="popup-overlay" onClick={() => setShowInfo(false)}>
          <div className="popup info-popup" onClick={e => e.stopPropagation()}>
            <div className="popup-header">
              <span><Users size={16} /> Room Info</span>
              <button onClick={() => setShowInfo(false)} className="close-btn"><X size={18} /></button>
            </div>
            {renderRoomPanel()}
            {!isPlayer && renderQueuePanel()}
            <div className="popup-actions">
              {canJoinMatch && (
                <button onClick={() => { becomePlayer(); setShowInfo(false); }}><Play size={16} /> Join match</button>
              )}
              <button onClick={copyInvite}><Copy size={16} /> Copy invite</button>
            </div>
          </div>
        </div>
      )}

      {!connected ? (
        <section className="watch-arena loading-view">
          <div className="spectator-badge">Connecting to room...</div>
        </section>
      ) : !showMatchLayout ? (
        <section className="watch-arena">
          <div className="watch-boards">
            {[players[0], players[1]].map((player, index) => (
              <div className="watch-player" key={player?.id || `empty-${index}`}>
                <div className="panel-head">
                  <span>{player?.name || `Waiting for player ${index + 1}`}</span>
                  <strong>{player?.state?.score || 0}</strong>
                </div>
                <BoardView state={player?.state || null} />
                <div className="watch-stats">
                  <span>Lines <strong>{player?.state?.lines || 0}</strong></span>
                  <span>Level <strong>{player?.state?.level || 1}</strong></span>
                </div>
              </div>
            ))}
          </div>

          <div className="watch-actions">
            {canJoinMatch && (
              <button onClick={becomePlayer}><Play size={16} /> Join match</button>
            )}
            {hasChallengeOffer ? (
              <div className="queue-inline">
                <strong>Play winner?</strong>
                <button onClick={acceptChallenge}><Play size={16} /> Play</button>
                <button onClick={passChallenge}>Pass</button>
              </div>
            ) : queued ? (
              <div className="queue-inline">
                <span>Queued #{queuePosition}</span>
                {liveMatchUnderway && <span className="watching-tag">· Watching</span>}
                <button onClick={leaveQueue}>Leave queue</button>
              </div>
            ) : (
              <button onClick={joinQueue}><Play size={16} /> Join queue</button>
            )}
            {liveMatchUnderway && !queued && !hasChallengeOffer && (
              <span className="queue-inline watching-tag">Watching live match</span>
            )}
          </div>
        </section>
      ) : (
        <section className="arena">
          <div className="playfield" {...boardSwipe}>
            <div className="panel-head">
              <span>{primaryName}</span>
              <strong>{primaryScore}</strong>
            </div>
            <BoardView state={primaryState} />
            {flash && <div className="toast">{flash}</div>}
            {paused && (
              <div className="pause-overlay">
                <strong>{pausedBy && pausedBy !== name ? `Paused by ${pausedBy}` : "Paused"}</strong>
                <button onClick={togglePause}><Play size={18} /> Resume</button>
              </div>
            )}
            {showMatchLayout && !started && !gameOver && (
              <button className="start" onClick={startMatch} disabled={!canStartMatch}>
                <Play size={20} /> {canStartMatch ? "Start game" : "Waiting for opponent"}
              </button>
            )}
            {showMatchLayout && gameOver && (
              <div className="game-over">
                <strong>{endReason === "won" ? "You win!" : "Game over"}</strong>
                <span className="game-over-detail">
                  {endReason === "won"
                    ? hasQueueWaiting
                      ? `${nextInQueue?.name || "Next player"} is up next.`
                      : players.length < 2
                        ? "Waiting for an opponent to join the queue."
                        : "Your opponent was defeated."
                    : "Your board topped out."}
                </span>
                {endReason === "won" && canRematch && (
                  <button onClick={rematch} disabled={rematchQueued}>
                    <RotateCcw size={20} /> {waitingForRematch ? "Waiting for opponent..." : rematchQueued ? "Ready" : "Play again"}
                  </button>
                )}
                {endReason === "lost" && hasChallengeOffer && (
                  <div className="queue-actions">
                    <button onClick={acceptChallenge}><Play size={20} /> Play winner</button>
                    <button onClick={passChallenge}>Pass</button>
                  </div>
                )}
                {endReason === "lost" && !queued && !hasChallengeOffer && (
                  <button onClick={joinQueue}><Play size={20} /> Join queue</button>
                )}
                {endReason === "lost" && queued && !hasChallengeOffer && (
                  <span className="game-over-detail">Queued #{queuePosition} — you'll play when it's your turn.</span>
                )}
              </div>
            )}
          </div>

          <aside className={"side" + (sideCollapsed ? " collapsed" : "")}>
            <div className="stats">
              <span>Lines <strong>{lines}</strong></span>
              <span>Level <strong>{level}</strong></span>
            </div>

            {renderPlayersList()}

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
                <span>{opponentLabel}</span>
                <strong>{opponentState?.score ?? opponent?.state?.score ?? 0}</strong>
              </div>
              <BoardView state={opponentState} small />
            </div>

            <div className="keyboard-controls">
              <div className="panel-head">
                <span>Controls</span>
              </div>
              <div className="keys">
                <span>Move</span><b>A/D or ←/→</b>
                <span>Rotate</span><b>W or ↑</b>
                <span>Drop</span><b>Space</b>
              </div>
            </div>
          </aside>
          <MobileControls
            visible={mobileControlsActive}
            onLeft={() => move(-1)}
            onRight={() => move(1)}
            onRotate={rotateActive}
            onSoftDrop={softDrop}
            onHardDrop={hardDrop}
          />
        </section>
      )}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
