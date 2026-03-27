import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { loadState } from "../../game.ts";

type PlayerSymbol = "X" | "O";

type ThinkingEntry = {
  player: string;
  moveNumber: number;
  position: number;
  thinking: string;
  timestamp: number;
  gameCreatedAt: number | null;
};

type PlayerBinding = {
  name: string | null;
  symbol: PlayerSymbol | null;
  manual: boolean;
};

type StreamSource = {
  pid: number;
  sessionTag: string;
  playerName: string | null;
  playerSymbol: PlayerSymbol | null;
};

type StreamState = {
  type: "state";
  source: StreamSource;
  currentThinking: string;
  latestThinking: ThinkingEntry | null;
};

const THINKING_ENTRY_TYPE = "tic-tac-toe-thinking";
const PLAYER_ENTRY_TYPE = "tic-tac-toe-player";
const SOCKET_DIR = path.join(process.cwd(), ".pi", "ttt-streams");
const SOCKET_PATH = path.join(SOCKET_DIR, `${process.pid}.sock`);

function extractThinking(message: any): string {
  const content = Array.isArray(message?.content) ? message.content : [];
  const thinking = content
    .filter((block: any) => block?.type === "thinking" && !block?.redacted)
    .map((block: any) => String(block.thinking ?? ""))
    .join("\n")
    .trim();

  if (thinking) return thinking;

  const text = content
    .filter((block: any) => block?.type === "text")
    .map((block: any) => String(block.text ?? ""))
    .join("\n");
  const matches = [...text.matchAll(/<thinking>([\s\S]*?)<\/thinking>/g)];
  return matches.map((match) => match[1].trim()).filter(Boolean).join("\n").trim();
}

function shellSplit(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < command.length) {
        i += 1;
        current += command[i];
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    if (ch === "\\" && i + 1 < command.length) {
      i += 1;
      current += command[i];
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

function scriptBase(token: string): string {
  return path.basename(token.replace(/^@/, ""));
}

function parseJoinCommand(command: string): { name: string; requestedSymbol: PlayerSymbol | null } | null {
  const tokens = shellSplit(command);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = tokens[i + 1];

    if ((token === "node" || token === "bun") && next && scriptBase(next) === "join.ts") {
      const name = tokens[i + 2];
      const maybeSymbol = tokens[i + 3];
      if (!name) return null;
      return {
        name,
        requestedSymbol: maybeSymbol === "X" || maybeSymbol === "O" ? maybeSymbol : null,
      };
    }

    if (scriptBase(token) === "join.ts") {
      const name = tokens[i + 1];
      const maybeSymbol = tokens[i + 2];
      if (!name) return null;
      return {
        name,
        requestedSymbol: maybeSymbol === "X" || maybeSymbol === "O" ? maybeSymbol : null,
      };
    }
  }

  return null;
}

function parseMoveCommand(command: string): { name: string } | null {
  const tokens = shellSplit(command);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = tokens[i + 1];
    const scriptIndex = (token === "node" || token === "bun") && next && scriptBase(next) === "move.ts"
      ? i + 1
      : scriptBase(token) === "move.ts"
        ? i
        : -1;

    if (scriptIndex === -1) continue;

    for (let j = scriptIndex + 1; j < tokens.length; j += 1) {
      if (tokens[j] === "--name" || tokens[j] === "-n") {
        const name = tokens[j + 1];
        if (name) return { name };
      }
    }
  }

  return null;
}

function sanitizeSessionTag(sessionFile: string | null | undefined): string {
  if (!sessionFile) return "ephemeral";
  const base = path.basename(sessionFile, path.extname(sessionFile));
  const clean = base.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 24);
  return clean || "session";
}

export default function (pi: ExtensionAPI) {
  let currentThinking = "";
  let latestThinking: ThinkingEntry | null = null;
  let lastMoveCount = loadState()?.history.length ?? 0;
  let lastGameCreatedAt = loadState()?.created_at ?? null;
  let playerBinding: PlayerBinding = { name: null, symbol: null, manual: false };
  let sessionTag = "ephemeral";

  let server: net.Server | undefined;
  const clients = new Set<net.Socket>();

  function snapshot(): StreamState {
    return {
      type: "state",
      source: {
        pid: process.pid,
        sessionTag,
        playerName: playerBinding.name,
        playerSymbol: playerBinding.symbol,
      },
      currentThinking,
      latestThinking,
    };
  }

  function writeLine(socket: net.Socket, payload: StreamState) {
    if (socket.destroyed) return;
    socket.write(`${JSON.stringify(payload)}\n`);
  }

  function broadcast() {
    const payload = snapshot();
    for (const client of clients) writeLine(client, payload);
  }

  function syncGameReset() {
    const state = loadState();
    const moveCount = state?.history.length ?? 0;
    const createdAt = state?.created_at ?? null;

    if (!state) {
      lastMoveCount = 0;
      lastGameCreatedAt = null;
      latestThinking = null;
      return;
    }

    if (createdAt !== lastGameCreatedAt || moveCount < lastMoveCount) {
      latestThinking = null;
    }

    lastMoveCount = moveCount;
    lastGameCreatedAt = createdAt;
  }

  function setPlayerBinding(binding: Partial<PlayerBinding>, persist = false) {
    playerBinding = {
      name: binding.name ?? playerBinding.name,
      symbol: binding.symbol ?? playerBinding.symbol,
      manual: binding.manual ?? playerBinding.manual,
    };

    if (persist) {
      pi.appendEntry(PLAYER_ENTRY_TYPE, playerBinding);
    }

    broadcast();
  }

  function autoDetectPlayerFromCommand(command: string) {
    if (playerBinding.manual) return;

    const join = parseJoinCommand(command);
    if (join) {
      const state = loadState();
      const actualSymbol = state?.players?.X === join.name ? "X" : state?.players?.O === join.name ? "O" : join.requestedSymbol;
      setPlayerBinding({ name: join.name, symbol: actualSymbol ?? null, manual: false }, true);
      return;
    }

    const move = parseMoveCommand(command);
    if (move) {
      const state = loadState();
      const actualSymbol = state?.players?.X === move.name ? "X" : state?.players?.O === move.name ? "O" : null;
      setPlayerBinding({ name: move.name, symbol: actualSymbol, manual: false }, true);
    }
  }

  function startServer() {
    if (server) return;

    fs.mkdirSync(SOCKET_DIR, { recursive: true });
    try {
      if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
    } catch {}

    server = net.createServer((socket) => {
      clients.add(socket);
      writeLine(socket, snapshot());

      const cleanup = () => clients.delete(socket);
      socket.on("close", cleanup);
      socket.on("end", cleanup);
      socket.on("error", cleanup);
    });

    server.on("error", (error: any) => {
      console.error("tic-tac-toe extension: socket server error", error);
    });

    server.listen(SOCKET_PATH);
  }

  async function stopServer() {
    const closingServer = server;
    server = undefined;

    for (const client of clients) client.destroy();
    clients.clear();

    if (closingServer) {
      await new Promise<void>((resolve) => closingServer.close(() => resolve()));
    }

    try {
      if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
    } catch {}
  }

  pi.registerCommand("ttt-player", {
    description: "Override or inspect the player identity for Tic-Tac-Toe thinking streaming",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();
      if (!trimmed) {
        const label = playerBinding.name
          ? `${playerBinding.name}${playerBinding.symbol ? ` (${playerBinding.symbol})` : ""}${playerBinding.manual ? " [manual]" : " [auto]"}`
          : "not set";
        ctx.ui.notify(`tic-tac-toe player: ${label}`, "info");
        return;
      }

      if (trimmed === "clear") {
        setPlayerBinding({ name: null, symbol: null, manual: false }, true);
        ctx.ui.notify("tic-tac-toe player binding cleared", "info");
        return;
      }

      const parts = shellSplit(trimmed);
      const name = parts[0] ?? null;
      const symbol = parts[1] === "X" || parts[1] === "O" ? parts[1] : null;
      setPlayerBinding({ name, symbol, manual: true }, true);
      ctx.ui.notify(
        `tic-tac-toe player set to ${name}${symbol ? ` (${symbol})` : ""}`,
        "success",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionTag = sanitizeSessionTag(ctx.sessionManager.getSessionFile());
    startServer();

    currentThinking = "";
    latestThinking = null;
    playerBinding = { name: null, symbol: null, manual: false };
    syncGameReset();

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === THINKING_ENTRY_TYPE) {
        latestThinking = entry.data as ThinkingEntry;
      }
      if (entry.type === "custom" && entry.customType === PLAYER_ENTRY_TYPE) {
        playerBinding = entry.data as PlayerBinding;
      }
    }

    broadcast();
  });

  pi.on("session_shutdown", async () => {
    currentThinking = "";
    latestThinking = null;
    await stopServer();
  });

  pi.on("tool_execution_end", async (event) => {
    if (event.toolName !== "bash" || event.isError) return;
    const command = (event.args as any)?.command;
    if (typeof command !== "string") return;
    autoDetectPlayerFromCommand(command);
  });

  pi.on("message_start", async (event) => {
    if (event.message.role !== "assistant") return;
    currentThinking = "";
    broadcast();
  });

  pi.on("message_update", async (event) => {
    const update = event.assistantMessageEvent as any;
    if (update?.type !== "thinking_delta") return;
    currentThinking += String(update.delta ?? "");
    broadcast();
  });

  pi.on("message_end", async (event) => {
    if (event.message.role !== "assistant") return;
    if (!currentThinking.trim()) {
      const extracted = extractThinking(event.message);
      if (extracted) {
        currentThinking = extracted;
        broadcast();
      }
    }
  });

  pi.on("turn_end", async (event) => {
    if (event.message.role !== "assistant") return;

    const finalThinking = currentThinking.trim() || extractThinking(event.message);
    const state = loadState();
    const moveCount = state?.history.length ?? 0;
    const createdAt = state?.created_at ?? null;

    if (!state) {
      latestThinking = null;
    } else if (createdAt !== lastGameCreatedAt || moveCount < lastMoveCount) {
      latestThinking = null;
    }

    if (state && moveCount > lastMoveCount) {
      const lastMove = state.history[state.history.length - 1];
      latestThinking = finalThinking
        ? {
            player: lastMove.player,
            moveNumber: moveCount,
            position: lastMove.position,
            thinking: finalThinking,
            timestamp: Date.now(),
            gameCreatedAt: state.created_at,
          }
        : null;

      if (latestThinking) {
        pi.appendEntry(THINKING_ENTRY_TYPE, latestThinking);
      }
    }

    currentThinking = "";
    lastMoveCount = moveCount;
    lastGameCreatedAt = createdAt;
    broadcast();
  });
}
