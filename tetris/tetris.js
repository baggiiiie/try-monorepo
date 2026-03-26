#!/usr/bin/env node

/**
 * tetris.js — Agent-playable Tetris via CLI
 *
 * Usage:
 *   node tetris.js new          Start a new game
 *   node tetris.js status       Show board + current piece
 *   node tetris.js move left    Move piece left
 *   node tetris.js move right   Move piece right
 *   node tetris.js rotate       Rotate piece clockwise
 *   node tetris.js drop         Hard drop piece to bottom
 *   node tetris.js tick         Advance game by one row
 *   node tetris.js watch        Watch the game render in real time
 *   node tetris.js help         Show this help
 *
 * State is persisted to tetris_state.json so agent can call
 * commands independently between turns.
 */

const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "tetris_state.json");

// ─── Board constants ──────────────────────────────────────────────────────────
const COLS = 10;
const ROWS = 20;

// ─── Tetromino definitions (each rotation variant) ───────────────────────────
const PIECES = {
    I: [
        [[0, 0], [1, 0], [2, 0], [3, 0]],
        [[0, 0], [0, 1], [0, 2], [0, 3]],
    ],
    O: [
        [[0, 0], [1, 0], [0, 1], [1, 1]],
    ],
    T: [
        [[0, 0], [1, 0], [2, 0], [1, 1]],
        [[0, 0], [0, 1], [0, 2], [1, 1]],
        [[1, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
    S: [
        [[1, 0], [2, 0], [0, 1], [1, 1]],
        [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],
    Z: [
        [[0, 0], [1, 0], [1, 1], [2, 1]],
        [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],
    J: [
        [[0, 0], [0, 1], [1, 1], [2, 1]],
        [[0, 0], [1, 0], [0, 1], [0, 2]],
        [[0, 0], [1, 0], [2, 0], [2, 1]],
        [[1, 0], [1, 1], [0, 2], [1, 2]],
    ],
    L: [
        [[2, 0], [0, 1], [1, 1], [2, 1]],
        [[0, 0], [0, 1], [0, 2], [1, 2]],
        [[0, 0], [1, 0], [2, 0], [0, 1]],
        [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
};

const PIECE_NAMES = Object.keys(PIECES);

// ─── State helpers ────────────────────────────────────────────────────────────
function emptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function randomPiece() {
    const name = PIECE_NAMES[Math.floor(Math.random() * PIECE_NAMES.length)];
    return { name, rotation: 0, x: 3, y: 0 };
}

function newGame() {
    const current = randomPiece();
    const next = randomPiece();
    return {
        board: emptyBoard(),
        current,
        next,
        score: 0,
        lines: 0,
        level: 1,
        ticks: 0,
        over: false,
    };
}

function loadState() {
    if (!fs.existsSync(STATE_FILE)) return null;
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
        return null;
    }
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Piece helpers ────────────────────────────────────────────────────────────
function getCells(piece) {
    const rotations = PIECES[piece.name];
    const rot = rotations[piece.rotation % rotations.length];
    return rot.map(([dx, dy]) => [piece.x + dx, piece.y + dy]);
}

function isValid(board, piece) {
    for (const [x, y] of getCells(piece)) {
        if (x < 0 || x >= COLS || y >= ROWS) return false;
        if (y >= 0 && board[y][x]) return false;
    }
    return true;
}

function placePiece(board, piece) {
    const newBoard = board.map(r => [...r]);
    for (const [x, y] of getCells(piece)) {
        if (y >= 0) newBoard[y][x] = piece.name;
    }
    return newBoard;
}

function clearLines(board) {
    const kept = board.filter(row => row.some(cell => !cell));
    const cleared = ROWS - kept.length;
    const newBoard = [
        ...Array.from({ length: cleared }, () => Array(COLS).fill(0)),
        ...kept,
    ];
    return { board: newBoard, cleared };
}

const LINE_SCORES = [0, 100, 300, 500, 800];

const WATCH_FRAME_MS = 80;
const WATCH_GRAVITY_BASE_MS = 700;
const WATCH_GRAVITY_MIN_MS = 120;

// ─── Rendering ────────────────────────────────────────────────────────────────
function renderBoard(state) {
    const { board, current, next, score, lines, level, ticks, over } = state;

    // Overlay current piece on a display board
    const display = board.map(r => [...r]);
    if (!over) {
        for (const [x, y] of getCells(current)) {
            if (y >= 0 && y < ROWS && x >= 0 && x < COLS) {
                display[y][x] = current.name;
            }
        }
        // Show ghost piece (where piece would land)
        let ghost = { ...current };
        while (isValid(board, { ...ghost, y: ghost.y + 1 })) ghost = { ...ghost, y: ghost.y + 1 };
        for (const [x, y] of getCells(ghost)) {
            if (y >= 0 && y < ROWS && x >= 0 && x < COLS && !display[y][x]) {
                display[y][x] = ".";
            }
        }
    }

    const CELL = {
        0: "  ",   // empty
        ".": "··", // ghost
        I: "II",
        O: "OO",
        T: "TT",
        S: "SS",
        Z: "ZZ",
        J: "JJ",
        L: "LL",
    };

    const lines_out = [];
    lines_out.push("┌" + "──".repeat(COLS) + "┐");
    for (let r = 0; r < ROWS; r++) {
        const row = display[r].map(c => CELL[c] || "??").join("");
        lines_out.push("│" + row + "│");
    }
    lines_out.push("└" + "──".repeat(COLS) + "┘");

    // Next piece preview (4x4 grid)
    const nextCells = PIECES[next.name][0];
    const preview = Array.from({ length: 4 }, () => Array(4).fill("  "));
    for (const [x, y] of nextCells) {
        if (y < 4 && x < 4) preview[y][x] = next.name + next.name[0];
    }

    // Sidebar info
    const sidebar = [
        `TETRIS`,
        ``,
        `Score : ${score}`,
        `Lines : ${lines}`,
        `Level : ${level}`,
        `Ticks : ${ticks}`,
        ``,
        `Next:`,
        ...preview.map(row => row.join("")),
        ``,
        over ? `GAME OVER` : ``,
        ``,
        `Commands:`,
        `  tick`,
        `  move left`,
        `  move right`,
        `  rotate`,
        `  drop`,
    ];

    // Combine board + sidebar
    const boardLines = lines_out;
    const output = boardLines.map((line, i) => {
        const side = sidebar[i] !== undefined ? `  ${sidebar[i]}` : "";
        return line + side;
    });

    return output.join("\n");
}

// ─── Game logic ───────────────────────────────────────────────────────────────
function applyTick(state) {
    if (state.over) return { state, event: "GAME_OVER" };

    const moved = { ...state.current, y: state.current.y + 1 };
    if (isValid(state.board, moved)) {
        return { state: { ...state, current: moved, ticks: state.ticks + 1 }, event: "MOVED_DOWN" };
    }

    // Lock piece
    let board = placePiece(state.board, state.current);
    const { board: clearedBoard, cleared } = clearLines(board);
    const scoreGain = (LINE_SCORES[cleared] || 0) * state.level;
    const newLines = state.lines + cleared;
    const newLevel = Math.floor(newLines / 10) + 1;
    const newCurrent = state.next;
    const newNext = randomPiece();

    // Check game over
    const over = !isValid(clearedBoard, newCurrent);

    const newState = {
        board: clearedBoard,
        current: newCurrent,
        next: newNext,
        score: state.score + scoreGain,
        lines: newLines,
        level: newLevel,
        ticks: state.ticks + 1,
        over,
    };

    const event = over ? "GAME_OVER" : cleared > 0 ? `LOCKED+CLEARED_${cleared}` : "LOCKED";
    return { state: newState, event };
}

function applyMove(state, dir) {
    if (state.over) return { state, event: "GAME_OVER" };
    const dx = dir === "left" ? -1 : 1;
    const moved = { ...state.current, x: state.current.x + dx };
    if (isValid(state.board, moved)) {
        return { state: { ...state, current: moved }, event: `MOVED_${dir.toUpperCase()}` };
    }
    return { state, event: "BLOCKED" };
}

function applyRotate(state) {
    if (state.over) return { state, event: "GAME_OVER" };
    const rotations = PIECES[state.current.name];
    const newRot = (state.current.rotation + 1) % rotations.length;
    const rotated = { ...state.current, rotation: newRot };

    // Try wall kicks: 0, -1, +1, -2, +2
    for (const kick of [0, -1, 1, -2, 2]) {
        const kicked = { ...rotated, x: rotated.x + kick };
        if (isValid(state.board, kicked)) {
            return { state: { ...state, current: kicked }, event: "ROTATED" };
        }
    }
    return { state, event: "BLOCKED" };
}

function applyDrop(state) {
    if (state.over) return { state, event: "GAME_OVER" };
    let piece = state.current;
    let dropped = 0;
    while (isValid(state.board, { ...piece, y: piece.y + 1 })) {
        piece = { ...piece, y: piece.y + 1 };
        dropped++;
    }
    const newState = { ...state, current: piece, score: state.score + dropped * 2 };
    // Lock immediately
    return applyTick(newState);
}

function gravityDelayForLevel(level) {
    return Math.max(WATCH_GRAVITY_MIN_MS, WATCH_GRAVITY_BASE_MS - ((level - 1) * 55));
}

function paintWatch(state, event) {
    process.stdout.write("\x1b[H\x1b[2J");
    process.stdout.write(`EVENT: ${event}\n`);
    process.stdout.write(`${renderBoard(state)}\n`);
    process.stdout.write("\nWatching live game state. Press Ctrl+C to stop.\n");
}

function watchGame(initialState) {
  let state = initialState || newGame();
  let event = initialState ? "WATCH_START" : "NEW_GAME";
  let lastGravityAt = Date.now();
  let stateSnapshot = JSON.stringify(state);

  if (!initialState) {
    saveState(state);
  }

    const cleanup = () => {
        process.stdout.write("\x1b[?25h\x1b[0m");
        if (process.stdout.isTTY) process.stdout.write("\x1b[?1049l");
    };

    const stop = () => {
        clearInterval(loop);
        cleanup();
    };

    if (process.stdout.isTTY) {
        process.stdout.write("\x1b[?1049h\x1b[?25l");
    }

    paintWatch(state, event);

    const onSigint = () => {
        stop();
        process.exit(0);
    };

  process.once("SIGINT", onSigint);

  const loop = setInterval(() => {
    const latestState = loadState();
    if (latestState) {
      const latestSnapshot = JSON.stringify(latestState);
      if (latestSnapshot !== stateSnapshot) {
        state = latestState;
        stateSnapshot = latestSnapshot;
        event = "EXTERNAL_UPDATE";
        lastGravityAt = Date.now();
      } else if ((Date.now() - lastGravityAt) >= gravityDelayForLevel(state.level)) {
        const result = applyTick(state);
        state = result.state;
        stateSnapshot = JSON.stringify(state);
        event = result.event;
        lastGravityAt = Date.now();
        saveState(state);
      } else {
        event = "WAITING";
      }
    } else if ((Date.now() - lastGravityAt) >= gravityDelayForLevel(state.level)) {
      const result = applyTick(state);
      state = result.state;
      stateSnapshot = JSON.stringify(state);
      event = result.event;
      lastGravityAt = Date.now();
      saveState(state);
    } else {
      event = "WAITING";
    }

    paintWatch(state, event);

        if (state.over) {
            stop();
            process.removeListener("SIGINT", onSigint);
            console.log("EVENT: GAME_OVER");
            console.log(renderBoard(state));
        }
    }, WATCH_FRAME_MS);
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
const [, , cmd, arg] = process.argv;

function printHelp() {
    console.log(`
tetris.js — Agent-playable Tetris CLI

COMMANDS:
  new           Start a fresh game
  status        Print the board and game info
  tick          Advance game: drop piece one row (or lock if at bottom)
  move left     Move current piece left
  move right    Move current piece right
  rotate        Rotate current piece clockwise
  drop          Hard-drop piece to bottom and lock it
  watch         Render the game live in the terminal
  help          Show this help

STATE:
  Saved to tetris_state.json in the same directory.
  Each command prints the updated board to stdout.

AGENT WORKFLOW:
  1. Call \`status\` to observe the board.
  2. Call \`move\` / \`rotate\` to position the piece.
  3. Call \`drop\` or repeated \`tick\` to place it.
  4. Repeat until GAME OVER.
  Or call \`watch\` to watch gravity advance the current game live.

OUTPUT FORMAT:
  Board is 10×20. Active piece shown as letter pairs (II, TT, etc.).
  Ghost piece shown as ·· indicating where piece will land.
  After each command, EVENT: line tells you what happened.
`.trim());
}

function run() {
    if (!cmd || cmd === "help") {
        printHelp();
        return;
    }

    if (cmd === "new") {
        const state = newGame();
        saveState(state);
        console.log("EVENT: NEW_GAME");
        console.log(renderBoard(state));
        return;
    }

    let state = loadState();
    if (!state && cmd === "watch") {
        watchGame(null);
        return;
    }
    if (!state) {
        console.error("ERROR: No game found. Run `node tetris.js new` first.");
        process.exit(1);
    }

    let result;
    if (cmd === "status") {
        console.log("EVENT: STATUS");
        console.log(renderBoard(state));
        return;
    } else if (cmd === "watch") {
        watchGame(state);
        return;
    } else if (cmd === "tick") {
        result = applyTick(state);
    } else if (cmd === "move" && (arg === "left" || arg === "right")) {
        result = applyMove(state, arg);
    } else if (cmd === "rotate") {
        result = applyRotate(state);
    } else if (cmd === "drop") {
        result = applyDrop(state);
    } else {
        console.error(`ERROR: Unknown command "${cmd} ${arg || ""}". Run \`node tetris.js help\`.`);
        process.exit(1);
    }

    saveState(result.state);
    console.log(`EVENT: ${result.event}`);
    console.log(renderBoard(result.state));
}

run();
