#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { loadState } from "./game.ts";

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const ITALIC = "\u001b[3m";
const RED = "\u001b[91m";
const BLUE = "\u001b[94m";
const YELLOW = "\u001b[93m";
const GREEN = "\u001b[92m";
const CYAN = "\u001b[96m";
const MAGENTA = "\u001b[95m";
const CLEAR = "\u001b[2J\u001b[H";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const SOCKET_DIR = path.join(process.cwd(), ".pi", "ttt-streams");

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

type PlayerSymbol = "X" | "O";

type ThinkingEntry = {
  player: string;
  moveNumber: number;
  position: number;
  thinking: string;
  timestamp: number;
  gameCreatedAt: number | null;
};

type StreamSource = {
  pid: number;
  sessionTag: string;
  playerName: string | null;
  playerSymbol: PlayerSymbol | null;
};

type StreamStateMessage = {
  type: "state";
  source: StreamSource;
  currentThinking: string;
  latestThinking: ThinkingEntry | null;
};

type RemoteStream = {
  socketPath: string;
  source: StreamSource;
  currentThinking: string;
  latestThinking: ThinkingEntry | null;
};

const streams = new Map<string, RemoteStream>();
const cleanupFns = new Map<string, () => void>();

function getArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((arg) => arg === name);
  return index >= 0 ? args[index + 1] : undefined;
}

function getWinCells(board: string[]): Set<number> {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] !== " " && board[a] === board[b] && board[a] === board[c]) {
      return new Set([a, b, c]);
    }
  }
  return new Set();
}

function cellString(cell: string, index: number, winCells: Set<number>): string {
  const highlighted = winCells.has(index);
  if (cell === "X") return highlighted ? `${BOLD}\u001b[101m${RED}X${RESET}` : `${BOLD}${RED}X${RESET}`;
  if (cell === "O") return highlighted ? `${BOLD}\u001b[104m${BLUE}O${RESET}` : `${BOLD}${BLUE}O${RESET}`;
  return `${DIM}${ITALIC}${index + 1}${RESET}`;
}

function wrapText(text: string, width: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function streamLabel(stream: RemoteStream): string {
  const source = stream.source;
  const player = source.playerName ?? `pi:${source.pid}`;
  const symbol = source.playerSymbol ? ` (${source.playerSymbol})` : "";
  return `${player}${symbol} · ${source.sessionTag}`;
}

function sortedStreams(): RemoteStream[] {
  return [...streams.values()].sort((a, b) => streamLabel(a).localeCompare(streamLabel(b)));
}

function renderThinkingSections(gameCreatedAt: number | null): string[] {
  const lines: string[] = [];
  const activeStreams = sortedStreams();

  lines.push("");
  lines.push(`  ${BOLD}${CYAN}Pi reasoning streams${RESET}`);

  if (activeStreams.length === 0) {
    lines.push(`  ${DIM}No active pi streams detected.${RESET}`);
    lines.push(`  ${DIM}Start pi in this repo and run /reload to enable streaming.${RESET}`);
    return lines;
  }

  for (const stream of activeStreams) {
    const latestThinking =
      stream.latestThinking && stream.latestThinking.gameCreatedAt === gameCreatedAt
        ? stream.latestThinking
        : null;

    lines.push(`  ${GREEN}● ${streamLabel(stream)}${RESET}`);

    if (stream.currentThinking.trim()) {
      lines.push(...wrapText(stream.currentThinking, 60).slice(-10).map((line) => `  ${DIM}│${RESET} ${line}`));
      continue;
    }

    if (latestThinking?.thinking) {
      lines.push(
        `  ${DIM}latest move:${RESET} ${latestThinking.position} ${DIM}(move ${latestThinking.moveNumber})${RESET}`,
      );
      lines.push(...wrapText(latestThinking.thinking, 60).slice(0, 8).map((line) => `  ${DIM}│${RESET} ${line}`));
      continue;
    }

    lines.push(`  ${DIM}Connected. Waiting for this agent to think...${RESET}`);
  }

  return lines;
}

function render(tick: number): string {
  const state = loadState();
  if (!state) {
    return `\n  ${BOLD}${CYAN}TIC-TAC-TOE${RESET}\n\n  ${DIM}No game found.${RESET}\n  ${DIM}Run: node new_game.ts${RESET}\n`;
  }

  const lines: string[] = [];
  const board = state.board;
  const players = state.players;
  const status = state.status;
  const winCells = status === "done" ? getWinCells(board) : new Set<number>();

  lines.push("");
  lines.push(`  ${BOLD}${CYAN}╔══════════════════╗${RESET}`);
  lines.push(`  ${BOLD}${CYAN}║  TIC · TAC · TOE ║${RESET}`);
  lines.push(`  ${BOLD}${CYAN}╚══════════════════╝${RESET}`);
  lines.push("");

  let xLabel = `${BOLD}${RED}✕ ${players.X ?? `${DIM}waiting...${RESET}`}${RESET}`;
  let oLabel = `${BOLD}${BLUE}○ ${players.O ?? `${DIM}waiting...${RESET}`}${RESET}`;
  if (status === "playing") {
    if (state.current_turn === "X") xLabel = `${BOLD}${RED}▶ ${players.X}${RESET}`;
    if (state.current_turn === "O") oLabel = `${BOLD}${BLUE}▶ ${players.O}${RESET}`;
  }

  lines.push(`  ${xLabel}   ${oLabel}`);
  lines.push("");

  const divider = `  ${DIM}━━━━━┿━━━━━┿━━━━━${RESET}`;
  for (let row = 0; row < 3; row += 1) {
    const cells: string[] = [];
    for (let col = 0; col < 3; col += 1) {
      const index = row * 3 + col;
      cells.push(`  ${cellString(board[index], index, winCells)}  `);
    }
    lines.push(`  ${cells.join("┃")}`);
    if (row < 2) lines.push(divider);
  }

  lines.push("");
  if (status === "done") {
    if (state.winner === "draw") {
      lines.push(`  ${YELLOW}${BOLD}🤝  Draw! Well played.${RESET}`);
    } else {
      lines.push(`  ${GREEN}${BOLD}🎉  ${players[state.winner!]} wins!${RESET}`);
    }
    lines.push(`  ${DIM}Run 'node new_game.ts' to play again.${RESET}`);
  } else if (status === "playing") {
    const turn = state.current_turn!;
    const turnName = players[turn] ?? "?";
    const symbol = turn === "X" ? `${BOLD}${RED}✕${RESET}` : `${BOLD}${BLUE}○${RESET}`;
    lines.push(`  ${DIM}${SPINNER[tick % SPINNER.length]}${RESET}  ${symbol}  ${turnName}'s turn`);
    lines.push(`  ${DIM}  node move.ts <1-9> --name "${turnName}"${RESET}`);
  } else {
    lines.push(`  ${MAGENTA}${state.message}${RESET}`);
    lines.push("");
    lines.push(`  ${DIM}Join with: node join.ts <name>${RESET}`);
  }

  if (state.history.length > 0) {
    const moves = state.history.map((entry) => {
      const symbol = entry.symbol === "X" ? `${RED}✕${RESET}` : `${BLUE}○${RESET}`;
      return `${symbol}${DIM}${entry.position}${RESET}`;
    });
    lines.push("");
    lines.push(`  ${DIM}Moves:${RESET}  ${moves.join(" → ")}`);
  }

  lines.push(...renderThinkingSections(state.created_at));
  lines.push("");
  lines.push(`  ${DIM}Refreshing every 0.2s  •  Ctrl+C to quit${RESET}`);
  lines.push("");
  return lines.join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onStreamUpdate(_socketPath: string, message: StreamStateMessage) {
  streams.set(_socketPath, {
    socketPath: _socketPath,
    source: message.source,
    currentThinking: message.currentThinking ?? "",
    latestThinking: message.latestThinking ?? null,
  });
}

function connectToSocket(socketPath: string) {
  if (cleanupFns.has(socketPath)) return;

  let socket: net.Socket | null = null;
  let buffer = "";

  const cleanup = () => {
    if (cleanupFns.get(socketPath) !== cleanup) return;
    cleanupFns.delete(socketPath);
    streams.delete(socketPath);
    socket?.destroy();
  };

  cleanupFns.set(socketPath, cleanup);
  socket = net.createConnection(socketPath);

  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line) as StreamStateMessage;
        if (message.type === "state") {
          onStreamUpdate(socketPath, message);
        }
      } catch {}
    }
  });

  const end = () => cleanup();
  socket.on("error", end);
  socket.on("close", end);
  socket.on("end", end);
}

function scanSockets() {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(SOCKET_DIR)
      .filter((entry) => entry.endsWith(".sock"))
      .map((entry) => path.join(SOCKET_DIR, entry));
  } catch {
    entries = [];
  }

  const current = new Set(entries);
  for (const socketPath of entries) {
    connectToSocket(socketPath);
  }

  for (const [socketPath, cleanup] of cleanupFns.entries()) {
    if (!current.has(socketPath)) cleanup();
  }
}

const interval = Number(getArg("--interval") ?? "0.2");
let tick = 0;

function renderNow() {
  process.stdout.write(CLEAR + render(tick));
}

function cleanupAll() {
  for (const cleanup of cleanupFns.values()) cleanup();
  cleanupFns.clear();
  streams.clear();
}

process.on("SIGINT", () => {
  cleanupAll();
  process.stdout.write(SHOW_CURSOR + "\n");
  process.exit(0);
});

async function main(): Promise<void> {
  process.stdout.write(HIDE_CURSOR);

  try {
    while (true) {
      scanSockets();
      renderNow();
      await sleep(interval * 1000);
      tick += 1;
    }
  } finally {
    cleanupAll();
    process.stdout.write(SHOW_CURSOR + "\n");
  }
}

await main();
