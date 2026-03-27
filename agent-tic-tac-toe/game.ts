#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const STATE_FILE = path.join(__dirname, "game_state.json");
export type PlayerSymbol = "X" | "O";
export type Winner = PlayerSymbol | "draw" | null;
export type GameStatus = "waiting" | "playing" | "done";

export interface MoveHistoryEntry {
  player: string;
  symbol: PlayerSymbol;
  position: number;
}

export interface GameState {
  board: string[];
  players: Partial<Record<PlayerSymbol, string>>;
  current_turn: PlayerSymbol | null;
  status: GameStatus;
  winner: Winner;
  message: string;
  history: MoveHistoryEntry[];
  created_at: number | null;
}

export const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}

export function newState(): GameState {
  return {
    board: Array(9).fill(" "),
    players: {},
    current_turn: "X",
    status: "waiting",
    winner: null,
    message: "Waiting for players to join...",
    history: [],
    created_at: null,
  };
}

export function loadState(): GameState | null {
  if (!fs.existsSync(STATE_FILE)) return null;

  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8").trim();
    if (!raw) return null;
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

export function saveState(state: GameState): void {
  const tmpFile = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  const content = `${JSON.stringify(state, null, 2)}\n`;

  fs.writeFileSync(tmpFile, content, "utf8");
  fs.renameSync(tmpFile, STATE_FILE);
}

export function initGame(): GameState {
  const state = newState();
  state.created_at = Date.now() / 1000;
  saveState(state);
  return state;
}

export function checkWinner(board: string[]): PlayerSymbol | null {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] !== " " && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as PlayerSymbol;
    }
  }
  return null;
}

export function isDraw(board: string[]): boolean {
  return !board.includes(" ");
}

export function boardToDisplay(board: string[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < 9; i += 3) {
    const row: string[] = [];
    for (let j = 0; j < 3; j += 1) {
      const cell = board[i + j];
      row.push(cell === " " ? String(i + j + 1) : cell);
    }
    rows.push(row);
  }
  return rows;
}

export function boardLines(board: string[]): string[] {
  const rows = boardToDisplay(board);
  return [
    `  ${rows[0][0]} | ${rows[0][1]} | ${rows[0][2]}`,
    "  ---------",
    `  ${rows[1][0]} | ${rows[1][1]} | ${rows[1][2]}`,
    "  ---------",
    `  ${rows[2][0]} | ${rows[2][1]} | ${rows[2][2]}`,
  ];
}

export function formatBoard(board: string[]): string {
  return boardLines(board).join("\n");
}

export function findPlayerSymbol(
  players: Partial<Record<PlayerSymbol, string>>,
  name: string,
): PlayerSymbol | null {
  for (const symbol of ["X", "O"] as const) {
    if (players[symbol] === name) return symbol;
  }
  return null;
}

export function otherSymbol(symbol: PlayerSymbol): PlayerSymbol {
  return symbol === "X" ? "O" : "X";
}

export function formatStateSnapshot(
  state: GameState,
  viewerName?: string,
): string {
  const players = state.players;
  const viewerSymbol = viewerName ? findPlayerSymbol(players, viewerName) : null;
  const history = state.history ?? [];
  const lines: string[] = [];

  const xName = players.X ?? "---";
  const oName = players.O ?? "---";
  lines.push(`Players: X=${xName}  O=${oName}`);

  if (viewerName) {
    if (!viewerSymbol) lines.push(`You: ${viewerName} (not joined)`);
    else lines.push(`You: ${viewerName} (${viewerSymbol})`);
  }

  lines.push("Board:");
  lines.push(...boardLines(state.board));

  if (history.length > 0) {
    const lastMove = history[history.length - 1];
    lines.push(
      `Last move: ${lastMove.player} (${lastMove.symbol}) -> ${lastMove.position}`,
    );
  }

  if (state.status === "waiting") {
    lines.push("Status: waiting for both players to join");
  } else if (state.status === "playing") {
    const current = state.current_turn as PlayerSymbol;
    const currentName = players[current] ?? current;
    if (viewerSymbol === current) lines.push(`Status: your turn (${current})`);
    else lines.push(`Status: ${currentName}'s turn (${current})`);
  } else if (state.status === "done") {
    if (state.winner === "draw") {
      lines.push("Status: game over (draw)");
    } else {
      const winner = state.winner as PlayerSymbol;
      const winnerName = players[winner] ?? winner;
      lines.push(`Status: game over (${winnerName} won as ${winner})`);
    }
  }

  if (state.message) lines.push(`Message: ${state.message}`);
  return lines.join("\n");
}

export function applyMove(
  state: GameState | null,
  name: string,
  position: number,
): PlayerSymbol {
  if (position < 1 || position > 9) {
    throw new GameError("Position must be between 1 and 9.");
  }

  if (!state) {
    throw new GameError("No game found. Run: node new_game.ts");
  }

  if (state.status === "waiting") {
    throw new GameError("Game hasn't started yet. Waiting for both players to join.");
  }

  if (state.status === "done") {
    throw new GameError(`Game is already over. ${state.message}`);
  }

  const symbol = findPlayerSymbol(state.players, name);
  if (!symbol) {
    throw new GameError(
      `Player '${name}' is not in this game. Join with: node join.ts \"${name}\"`,
    );
  }

  if (state.current_turn !== symbol) {
    const current = state.current_turn as PlayerSymbol;
    const currentName = state.players[current] ?? current;
    throw new GameError(`Not your turn! It's ${currentName}'s turn (${current}).`);
  }

  const index = position - 1;
  if (state.board[index] !== " ") {
    throw new GameError(
      `Position ${position} is already taken by ${state.board[index]}.`,
    );
  }

  state.board[index] = symbol;
  state.history.push({ player: name, symbol, position });

  const winner = checkWinner(state.board);
  if (winner) {
    state.status = "done";
    state.winner = winner;
    state.message = `🎉 ${state.players[winner]} (${winner}) wins!`;
    state.current_turn = null;
  } else if (isDraw(state.board)) {
    state.status = "done";
    state.winner = "draw";
    state.message = "It's a draw! Well played both.";
    state.current_turn = null;
  } else {
    const nextTurn = otherSymbol(symbol);
    state.current_turn = nextTurn;
    state.message = `${state.players[nextTurn]}'s turn (${nextTurn})`;
  }

  return symbol;
}
