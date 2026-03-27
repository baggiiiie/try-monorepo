#!/usr/bin/env node
import { GameError, applyMove, formatStateSnapshot, loadState, saveState } from "./game.ts";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const positionArg = args[0];
  let name: string | undefined;

  for (let i = 1; i < args.length; i += 1) {
    if (args[i] === "--name" || args[i] === "-n") {
      name = args[i + 1];
      i += 1;
    }
  }

  return { positionArg, name };
}

const { positionArg, name } = parseArgs(process.argv);
if (!positionArg || !name) {
  console.log("Usage: node move.ts <position> --name <your_name>");
  process.exit(1);
}

const position = Number(positionArg);
const state = loadState();

try {
  const symbol = applyMove(state, name, position);
  saveState(state!);
  console.log(`Played: ${name} (${symbol}) -> ${position}`);
  console.log(formatStateSnapshot(state!, name));
} catch (error) {
  if (error instanceof GameError) {
    console.log(`Error: ${error.message}`);
    if (state?.board) console.log(formatStateSnapshot(state, name));
    process.exit(1);
  }
  throw error;
}
