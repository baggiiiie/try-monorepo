#!/usr/bin/env node
import { formatStateSnapshot, initGame, loadState, saveState } from "./game.ts";

const [, , name, preferredArg] = process.argv;

if (!name) {
  console.log("Usage: node join.ts <your_name> [X|O]");
  console.log("Example: node join.ts Alice");
  console.log("Example: node join.ts Bob O");
  process.exit(1);
}

const preferred = preferredArg?.toUpperCase();
if (preferred && preferred !== "X" && preferred !== "O") {
  console.log("Symbol must be X or O");
  process.exit(1);
}

let state = loadState();
if (!state) {
  console.log("No game found. Starting a new game...");
  state = initGame();
}

if (state.status === "done") {
  console.log("Game is over. Start a new game with: node new_game.ts");
  process.exit(1);
}

const players = state.players;
for (const symbol of ["X", "O"] as const) {
  if (players[symbol] === name) {
    console.log(`A player named (${name}) is already in the game as ${symbol}!`);
    console.log("Try another name!");
    process.exit(0);
  }
}

if (Object.keys(players).length >= 2) {
  console.log("Game is full! Two players already joined.");
  for (const symbol of ["X", "O"] as const) {
    if (players[symbol]) console.log(`  ${symbol}: ${players[symbol]}`);
  }
  process.exit(1);
}

const taken = new Set(Object.keys(players));
let symbol: "X" | "O";
if (preferred) {
  if (taken.has(preferred)) {
    console.log(`${preferred} is already taken by ${players[preferred]}.`);
    symbol = preferred === "X" ? "O" : "X";
    console.log(`Assigning you ${symbol} instead.`);
  } else {
    symbol = preferred;
  }
} else {
  symbol = taken.has("X") ? "O" : "X";
}

players[symbol] = name;
state.players = players;

if (Object.keys(players).length === 2) {
  state.status = "playing";
  state.message = `Game on! ${players.X} (X) vs ${players.O} (O). X goes first.`;
} else {
  state.message = `${name} joined as ${symbol}. Waiting for opponent...`;
}

saveState(state);

console.log(`✓ Joined as ${symbol} (${name})`);
console.log(formatStateSnapshot(state, name));
console.log();
console.log(`Move with: node move.ts <1-9> --name "${name}"`);
console.log(`Wait with: node wait_for_turn.ts --name "${name}"`);
