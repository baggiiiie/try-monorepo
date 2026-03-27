#!/usr/bin/env node
import { formatStateSnapshot, loadState } from "./game.ts";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const nameIndex = args.findIndex((arg) => arg === "--name" || arg === "-n");
const name = nameIndex >= 0 ? args[nameIndex + 1] : undefined;

const state = loadState();
if (!state) {
  console.log("No game found. Run: node new_game.ts");
  process.exit(1);
}

if (jsonMode) {
  console.log(JSON.stringify(state, null, 2));
} else {
  console.log(formatStateSnapshot(state, name));
}
