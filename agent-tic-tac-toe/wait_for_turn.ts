#!/usr/bin/env node
import { findPlayerSymbol, formatStateSnapshot, loadState } from "./game.ts";

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

function getArg(name: string, shortName?: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((arg) => arg === name || (shortName && arg === shortName));
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function clearStatusLine(): void {
  process.stdout.write(`\r${" ".repeat(80)}\r`);
}

function progressMessage(state: NonNullable<ReturnType<typeof loadState>>, symbol: "X" | "O", tick: number): string | null {
  if (state.status === "waiting") {
    return `${SPINNER[tick % SPINNER.length]} Waiting for opponent to join...`;
  }

  if (state.status === "playing") {
    if (state.current_turn === symbol) return null;
    const current = state.current_turn!;
    const currentName = state.players[current] ?? current;
    return `${SPINNER[tick % SPINNER.length]} Waiting for ${currentName} to move...`;
  }

  return null;
}

const name = getArg("--name", "-n");
if (!name) {
  console.log("Usage: node wait_for_turn.ts --name \"Agent\"");
  process.exit(2);
}

const interval = Number(getArg("--interval") ?? "0.4");
const quiet = hasFlag("--quiet");
const showProgress = process.stdout.isTTY && !quiet;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  let tick = 0;

  while (true) {
    const state = loadState();

    if (!state) {
      console.log("No game found. Run: node new_game.ts");
      process.exit(2);
    }

    const symbol = findPlayerSymbol(state.players, name);
    if (!symbol) {
      console.log(`'${name}' is not in this game.`);
      console.log(`Current players: ${JSON.stringify(state.players)}`);
      console.log(`Join with: node join.ts \"${name}\"`);
      process.exit(2);
    }

    if (state.status === "done") {
      if (showProgress) clearStatusLine();
      console.log(formatStateSnapshot(state, name));
      process.exit(1);
    }

    if (state.status === "playing" && state.current_turn === symbol) {
      if (showProgress) clearStatusLine();
      console.log(formatStateSnapshot(state, name));
      process.exit(0);
    }

    if (showProgress) {
      const message = progressMessage(state, symbol, tick);
      if (message) process.stdout.write(`\r${message}`);
    }

    await sleep(interval * 1000);
    tick += 1;
  }
}

process.on("SIGINT", () => {
  process.stdout.write("\nInterrupted.\n");
  process.exit(2);
});

await main();
