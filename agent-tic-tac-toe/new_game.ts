#!/usr/bin/env node
import fs from "node:fs";
import { STATE_FILE, initGame } from "./game.ts";

if (fs.existsSync(STATE_FILE)) {
  fs.unlinkSync(STATE_FILE);
}

initGame();

console.log("✓ New game started!");
console.log();
console.log("Join with:");
console.log("  node join.ts <name>      # auto-assign X/O");
console.log("  node join.ts <name> X");
console.log("  node join.ts <name> O");
console.log();
console.log("Watch live:");
console.log("  node watch.ts");
console.log();
console.log("Play turns with:");
console.log('  node wait_for_turn.ts --name "<your_name>"');
console.log('  node move.ts <1-9> --name "<your_name>"');
