import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  TextareaRenderable,
  createCliRenderer,
  vstyles,
} from "@opentui/core";
import { spawn, type Subprocess } from "bun";

// ── Colors ────────────────────────────────────────────────────────────
const colors = {
  bg: "#090909",
  panel: "#171717",
  footer: "#202020",
  accent: "#4a98ff",
  text: "#f1f1f1",
  muted: "#8b8b92",
  subtle: "#67676d",
  guide: "#262626",
  thinking: "#a68557",
  warning: "#f1ab3c",
  track: "#2f2f2f",
  thumb: "#5f5f5f",
  error: "#ff5555",
  success: "#50fa7b",
  toolIcon: "#a78bfa",
};

const composerBorderChars = {
  topLeft: " ",
  topRight: " ",
  bottomLeft: "╹",
  bottomRight: " ",
  horizontal: "▀",
  vertical: "┃",
  topT: " ",
  bottomT: " ",
  leftT: " ",
  rightT: " ",
  cross: " ",
};

// ── Renderer ──────────────────────────────────────────────────────────
const renderer = await createCliRenderer({
  backgroundColor: colors.bg,
  consoleMode: "disabled",
  exitOnCtrlC: false,
  screenMode: "alternate-screen",
  useMouse: true,
});

renderer.setTerminalTitle("pi · opentui");

// ── Helpers ───────────────────────────────────────────────────────────
const box = (options: ConstructorParameters<typeof BoxRenderable>[1]) =>
  new BoxRenderable(renderer, options);

const text = (options: ConstructorParameters<typeof TextRenderable>[1]) =>
  new TextRenderable(renderer, options);

const textarea = (options: ConstructorParameters<typeof TextareaRenderable>[1]) =>
  new TextareaRenderable(renderer, options);

const spacer = (height = 1) =>
  box({
    height,
    shouldFill: false,
  });

const leftBorderBox = (
  borderColor: string,
  options?: Omit<ConstructorParameters<typeof BoxRenderable>[1], "border" | "customBorderChars" | "borderColor">,
) =>
  box({
    ...options,
    border: ["left"],
    borderColor,
    customBorderChars: composerBorderChars,
  });

// ── Component factories ───────────────────────────────────────────────

const userPrompt = (content: string) => {
  const wrapper = leftBorderBox(colors.accent, {
    width: "100%",
    height: 3,
    backgroundColor: colors.panel,
    paddingLeft: 2,
    justifyContent: "center",
  });

  wrapper.add(
    text({
      width: "100%",
      content,
      fg: colors.text,
      wrapMode: "none",
      truncate: true,
    }),
  );

  return wrapper;
};

/** Creates a thinking block. Returns { wrapper, textEl } for live updates. */
const thinkingBlock = (content = "") => {
  const wrapper = leftBorderBox(colors.guide, {
    width: "100%",
    paddingLeft: 2,
  });

  const line = text({
    width: "100%",
    fg: colors.muted,
    wrapMode: "word",
  });

  line.add(vstyles.fg(colors.thinking, vstyles.italic("Thinking:")));
  line.add(" ");
  line.add(vstyles.fg(colors.muted, content));
  wrapper.add(line);

  return { wrapper, textEl: line };
};

/** Creates an assistant reply. Returns { el } for live updates via content setter. */
const assistantReply = (content = "") => {
  const el = text({
    width: "100%",
    marginLeft: 3,
    content,
    fg: colors.text,
    wrapMode: "word",
  });
  return { el };
};

/** Creates a tool status line. Returns { el, update } for live updates. */
const toolLine = (toolName: string, status: "running" | "done" | "error" = "running") => {
  const el = text({
    width: "100%",
    marginLeft: 3,
    wrapMode: "none",
    truncate: true,
  });

  const update = (name: string, st: "running" | "done" | "error", detail = "") => {
    el.clear();
    const icon = st === "running" ? "◼" : st === "done" ? "▣" : "✗";
    const iconColor = st === "running" ? colors.warning : st === "done" ? colors.accent : colors.error;
    el.add(vstyles.fg(iconColor, icon));
    el.add("  ");
    el.add(vstyles.fg(colors.text, name));
    if (detail) el.add(vstyles.fg(colors.subtle, ` · ${detail}`));
  };

  update(toolName, status);
  return { el, update };
};

// ── Layout ────────────────────────────────────────────────────────────

const transcriptContent = box({
  width: "100%",
  paddingLeft: 2,
  paddingRight: 2,
  paddingTop: 1,
});

const transcript = new ScrollBoxRenderable(renderer, {
  flexGrow: 1,
  height: "100%",
  backgroundColor: colors.bg,
  rootOptions: { backgroundColor: colors.bg },
  wrapperOptions: { backgroundColor: colors.bg },
  viewportOptions: { backgroundColor: colors.bg },
  contentOptions: { backgroundColor: colors.bg },
  verticalScrollbarOptions: {
    showArrows: false,
    trackOptions: {
      backgroundColor: colors.track,
      foregroundColor: colors.thumb,
    },
  },
  scrollY: true,
  scrollX: false,
  stickyScroll: true,
  stickyStart: "bottom",
});
transcript.verticalScrollBar.visible = false;

const rightRail = text({
  width: 1,
  height: "100%",
  fg: colors.thumb,
  content: Array.from({ length: 256 }, () => "█").join("\n"),
  wrapMode: "none",
  truncate: true,
});

transcript.add(transcriptContent);

const root = box({
  width: "100%",
  height: "100%",
  flexDirection: "column",
  backgroundColor: colors.bg,
});

const transcriptArea = box({
  width: "100%",
  flexGrow: 1,
  minHeight: 0,
  flexDirection: "row",
});
transcriptArea.add(transcript);
transcriptArea.add(rightRail);
transcriptArea.add(box({ width: 2, height: "100%", backgroundColor: colors.bg }));
root.add(transcriptArea);
root.add(spacer());

const bottomArea = box({
  width: "100%",
  height: 7,
  flexDirection: "column",
  backgroundColor: colors.bg,
  paddingLeft: 2,
  paddingRight: 2,
});

const composerShell = leftBorderBox(colors.accent, {
  width: "100%",
  height: 4,
  backgroundColor: colors.footer,
  flexDirection: "column",
  paddingLeft: 2,
  paddingRight: 1,
  paddingTop: 0,
  paddingBottom: 0,
});

const composer = textarea({
  width: "100%",
  height: 3,
  backgroundColor: colors.footer,
  focusedBackgroundColor: colors.footer,
  textColor: colors.text,
  focusedTextColor: colors.text,
  placeholder: "",
  cursorColor: colors.accent,
  wrapMode: "word",
  keyBindings: [
    { name: "return", action: "submit" as any },
    { name: "linefeed", action: "submit" as any },
    { name: "return", shift: true, action: "newline" as any },
  ],
});
composerShell.add(composer);

const statusRow = text({
  width: "100%",
  wrapMode: "none",
  truncate: true,
});

const updateStatus = (modelName: string, extra = "") => {
  statusRow.clear();
  statusRow.add(vstyles.fg(colors.accent, "●"));
  statusRow.add("  ");
  statusRow.add(vstyles.fg(colors.text, modelName));
  if (extra) statusRow.add(vstyles.fg(colors.subtle, ` ${extra}`));
};
updateStatus("connecting…");
composerShell.add(statusRow);
bottomArea.add(composerShell);

bottomArea.add(
  text({
    width: "100%",
    content: `╹${"▀".repeat(400)}`,
    fg: colors.subtle,
    wrapMode: "none",
  }),
);

const helpRow = box({
  width: "100%",
  height: 1,
  flexDirection: "row",
  justifyContent: "flex-end",
});
const helpText = text({
  content: "enter send · esc interrupt · ctrl+c quit",
  fg: colors.muted,
  wrapMode: "none",
  truncate: true,
});
helpRow.add(helpText);
bottomArea.add(helpRow);

root.add(bottomArea);
renderer.root.add(root);
composer.focus();
renderer.requestRender();

// ── RPC Transport ─────────────────────────────────────────────────────

type RunStatus = "idle" | "running" | "interrupting";

let runStatus: RunStatus = "idle";
let piProcess: Subprocess<"pipe", "pipe", "pipe"> | null = null;
let requestCounter = 0;
let lineBuffer = "";

type PendingRequest = {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
};
const pendingRequests = new Map<string, PendingRequest>();

function sendCommand(cmd: Record<string, any>): Promise<any> {
  if (!piProcess?.stdin) return Promise.reject(new Error("pi not connected"));
  const id = `req_${++requestCounter}`;
  const full = { ...cmd, id };
  const line = JSON.stringify(full) + "\n";
  piProcess.stdin.write(line);

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${cmd.type}`));
      }
    }, 30000);
  });
}

function sendFire(cmd: Record<string, any>) {
  if (!piProcess?.stdin) return;
  const line = JSON.stringify(cmd) + "\n";
  piProcess.stdin.write(line);
}

// ── Active streaming state ────────────────────────────────────────────

type ActiveThinking = {
  buffer: string;
  wrapper: BoxRenderable;
  textEl: TextRenderable;
};

type ActiveReply = {
  buffer: string;
  el: TextRenderable;
};

type ActiveToolExec = {
  toolName: string;
  el: TextRenderable;
  update: (name: string, st: "running" | "done" | "error", detail?: string) => void;
  startTime: number;
};

let activeThinking: ActiveThinking | null = null;
let activeReply: ActiveReply | null = null;
const activeToolExecs = new Map<string, ActiveToolExec>();

function addToTranscript(child: BoxRenderable | TextRenderable) {
  transcriptContent.add(child);
  transcriptContent.add(spacer());
  renderer.requestRender();
}

// ── Event handling ────────────────────────────────────────────────────

function handleEvent(event: any) {
  switch (event.type) {
    case "agent_start":
      runStatus = "running";
      composerShell.borderColor = colors.warning;
      renderer.requestRender();
      break;

    case "agent_end":
      runStatus = "idle";
      finalizeActiveBlocks();
      composerShell.borderColor = colors.accent;
      composer.focus();
      renderer.requestRender();
      break;

    case "turn_start":
      break;

    case "turn_end":
      finalizeActiveBlocks();
      break;

    case "message_start":
      break;

    case "message_update":
      handleMessageUpdate(event);
      break;

    case "message_end":
      finalizeActiveBlocks();
      break;

    case "tool_execution_start":
      handleToolExecStart(event);
      break;

    case "tool_execution_update":
      handleToolExecUpdate(event);
      break;

    case "tool_execution_end":
      handleToolExecEnd(event);
      break;

    case "compaction_start":
      addStatusLine(`Compacting context (${event.reason})…`, colors.warning);
      break;

    case "compaction_end":
      addStatusLine(
        event.aborted ? "Compaction aborted" : "Context compacted",
        event.aborted ? colors.error : colors.success,
      );
      break;

    case "auto_retry_start":
      addStatusLine(
        `Retrying (${event.attempt}/${event.maxAttempts})…`,
        colors.warning,
      );
      break;

    case "auto_retry_end":
      addStatusLine(
        event.success ? "Retry succeeded" : `Retry failed: ${event.finalError ?? "unknown"}`,
        event.success ? colors.success : colors.error,
      );
      break;

    case "extension_ui_request":
      handleExtensionUI(event);
      break;

    case "extension_error":
      addStatusLine(`Extension error: ${event.error}`, colors.error);
      break;

    case "queue_update":
      break;
  }
}

function handleMessageUpdate(event: any) {
  const delta = event.assistantMessageEvent;
  if (!delta) return;

  switch (delta.type) {
    case "thinking_start":
      ensureThinkingBlock();
      break;

    case "thinking_delta":
      ensureThinkingBlock();
      activeThinking!.buffer += delta.delta;
      rebuildThinkingText();
      renderer.requestRender();
      break;

    case "thinking_end":
      // keep it visible, just stop updating
      activeThinking = null;
      break;

    case "text_start":
      ensureReplyBlock();
      break;

    case "text_delta":
      ensureReplyBlock();
      activeReply!.buffer += delta.delta;
      activeReply!.el.content = activeReply!.buffer;
      renderer.requestRender();
      break;

    case "text_end":
      if (activeReply) {
        activeReply.el.content = delta.content ?? activeReply.buffer;
        activeReply = null;
      }
      renderer.requestRender();
      break;

    case "toolcall_start":
      break;

    case "toolcall_delta":
      break;

    case "toolcall_end":
      if (delta.toolCall) {
        const name = delta.toolCall.name ?? delta.toolCall.toolName ?? "tool";
        const { el } = toolLine(name, "running");
        addToTranscript(el);
      }
      break;

    case "done":
    case "error":
      break;
  }
}

function ensureThinkingBlock() {
  if (activeThinking) return;
  const { wrapper, textEl } = thinkingBlock("");
  activeThinking = { buffer: "", wrapper, textEl };
  addToTranscript(wrapper);
}

function rebuildThinkingText() {
  if (!activeThinking) return;
  activeThinking.textEl.clear();
  activeThinking.textEl.add(vstyles.fg(colors.thinking, vstyles.italic("Thinking:")));
  activeThinking.textEl.add(" ");
  activeThinking.textEl.add(vstyles.fg(colors.muted, activeThinking.buffer));
}

function ensureReplyBlock() {
  if (activeReply) return;
  const { el } = assistantReply("");
  activeReply = { buffer: "", el };
  addToTranscript(el);
}

function handleToolExecStart(event: any) {
  const id = event.toolCallId;
  const name = event.toolName ?? "tool";
  const tl = toolLine(name, "running");
  activeToolExecs.set(id, {
    toolName: name,
    el: tl.el,
    update: tl.update,
    startTime: Date.now(),
  });
  addToTranscript(tl.el);
}

function handleToolExecUpdate(event: any) {
  const exec = activeToolExecs.get(event.toolCallId);
  if (!exec) return;
  const elapsed = ((Date.now() - exec.startTime) / 1000).toFixed(1);
  exec.update(exec.toolName, "running", `${elapsed}s`);
  renderer.requestRender();
}

function handleToolExecEnd(event: any) {
  const exec = activeToolExecs.get(event.toolCallId);
  if (!exec) return;
  const elapsed = ((Date.now() - exec.startTime) / 1000).toFixed(1);
  const status = event.isError ? "error" : "done";
  exec.update(exec.toolName, status, `${elapsed}s`);
  activeToolExecs.delete(event.toolCallId);
  renderer.requestRender();
}

function finalizeActiveBlocks() {
  activeThinking = null;
  activeReply = null;
}

function addStatusLine(message: string, color: string) {
  const el = text({
    width: "100%",
    marginLeft: 3,
    fg: color,
    content: message,
    wrapMode: "word",
  });
  addToTranscript(el);
}

// ── Extension UI ──────────────────────────────────────────────────────

function handleExtensionUI(event: any) {
  const { id, method } = event;

  switch (method) {
    case "notify":
      addStatusLine(
        `[ext] ${event.message}`,
        event.notifyType === "error" ? colors.error
          : event.notifyType === "warning" ? colors.warning
          : colors.muted,
      );
      break;

    case "setStatus":
      if (event.statusText) {
        updateStatus(currentModel, event.statusText);
        renderer.requestRender();
      }
      break;

    case "setTitle":
      renderer.setTerminalTitle(event.title);
      break;

    case "select":
      handleSelectDialog(id, event.title, event.options);
      break;

    case "confirm":
      handleConfirmDialog(id, event.title, event.message);
      break;

    case "input":
      // For simplicity, auto-cancel input/editor requests
      sendFire({ type: "extension_ui_response", id, cancelled: true });
      break;

    case "editor":
      sendFire({ type: "extension_ui_response", id, cancelled: true });
      break;

    case "set_editor_text":
      break;

    case "setWidget":
      if (event.widgetLines?.length) {
        addStatusLine(`[widget] ${event.widgetLines.join(" ")}`, colors.muted);
      }
      break;
  }
}

function handleSelectDialog(requestId: string, title: string, options: string[]) {
  const wrapper = leftBorderBox(colors.warning, {
    width: "100%",
    paddingLeft: 2,
  });

  const titleEl = text({
    width: "100%",
    content: title,
    fg: colors.warning,
    wrapMode: "word",
  });
  wrapper.add(titleEl);

  options.forEach((opt, i) => {
    const optEl = text({
      width: "100%",
      fg: colors.text,
      wrapMode: "none",
      truncate: true,
    });
    optEl.add(vstyles.fg(colors.accent, `  ${i + 1}. `));
    optEl.add(opt);
    wrapper.add(optEl);
  });

  addToTranscript(wrapper);

  // Listen for a number key press
  const handler = (key: any) => {
    const num = parseInt(key.name);
    if (num >= 1 && num <= options.length) {
      renderer.keyInput.off("keypress", handler);
      sendFire({ type: "extension_ui_response", id: requestId, value: options[num - 1] });
      addStatusLine(`Selected: ${options[num - 1]}`, colors.success);
    } else if (key.name === "escape") {
      renderer.keyInput.off("keypress", handler);
      sendFire({ type: "extension_ui_response", id: requestId, cancelled: true });
      addStatusLine("Selection cancelled", colors.muted);
    }
  };
  renderer.keyInput.on("keypress", handler);
}

function handleConfirmDialog(requestId: string, title: string, message: string) {
  const wrapper = leftBorderBox(colors.warning, {
    width: "100%",
    paddingLeft: 2,
  });

  const titleEl = text({
    width: "100%",
    fg: colors.warning,
    wrapMode: "word",
  });
  titleEl.add(title);
  if (message) {
    titleEl.add(vstyles.fg(colors.text, ` — ${message}`));
  }
  titleEl.add(vstyles.fg(colors.muted, " (y/n)"));
  wrapper.add(titleEl);
  addToTranscript(wrapper);

  const handler = (key: any) => {
    if (key.name === "y" || key.name === "Y") {
      renderer.keyInput.off("keypress", handler);
      sendFire({ type: "extension_ui_response", id: requestId, confirmed: true });
      addStatusLine("Confirmed", colors.success);
    } else if (key.name === "n" || key.name === "N" || key.name === "escape") {
      renderer.keyInput.off("keypress", handler);
      sendFire({ type: "extension_ui_response", id: requestId, confirmed: false });
      addStatusLine("Declined", colors.muted);
    }
  };
  renderer.keyInput.on("keypress", handler);
}

// ── Composer wiring ───────────────────────────────────────────────────

composer.onSubmit = () => {
  const value = composer.editBuffer.getText().trim();
  if (!value) return;

  composer.setText("");

  if (runStatus === "idle") {
    addToTranscript(userPrompt(value));
    sendCommand({ type: "prompt", message: value }).catch((err) => {
      addStatusLine(`Error: ${err.message}`, colors.error);
    });
  } else if (runStatus === "running") {
    addToTranscript(userPrompt(`[steer] ${value}`));
    sendCommand({ type: "steer", message: value }).catch((err) => {
      addStatusLine(`Steer error: ${err.message}`, colors.error);
    });
  }
};

// ── Key handling ──────────────────────────────────────────────────────

renderer.keyInput.on("keypress", (key: any) => {
  if (key.name === "c" && key.ctrl) {
    if (runStatus === "running") {
      runStatus = "interrupting";
      sendCommand({ type: "abort" }).catch(() => {});
      addStatusLine("Interrupting…", colors.warning);
    } else {
      cleanup();
      process.exit(0);
    }
  }

  if (key.name === "escape" && runStatus === "running") {
    runStatus = "interrupting";
    sendCommand({ type: "abort" }).catch(() => {});
    addStatusLine("Interrupting…", colors.warning);
  }
});

// ── Spawn pi ──────────────────────────────────────────────────────────

let currentModel = "…";

async function startPi() {
  piProcess = spawn(["pi", "--mode", "rpc"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Read stderr for debugging
  if (piProcess.stderr) {
    (async () => {
      const reader = piProcess!.stderr!.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // stderr is silently consumed; could log to a file if needed
          void decoder.decode(value, { stream: true });
        }
      } catch {}
    })();
  }

  // Read stdout line by line
  if (piProcess.stdout) {
    const reader = piProcess.stdout.getReader();
    const decoder = new TextDecoder();

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuffer += decoder.decode(value, { stream: true });
          let nlIndex: number;
          while ((nlIndex = lineBuffer.indexOf("\n")) !== -1) {
            const line = lineBuffer.slice(0, nlIndex).replace(/\r$/, "");
            lineBuffer = lineBuffer.slice(nlIndex + 1);

            if (!line) continue;
            try {
              const parsed = JSON.parse(line);
              handleLine(parsed);
            } catch {
              // skip malformed lines
            }
          }
        }
      } catch {
        addStatusLine("pi process stdout closed", colors.error);
      }
    })();
  }

  // Wait briefly then get initial state
  await Bun.sleep(200);

  try {
    const resp = await sendCommand({ type: "get_state" });
    if (resp?.model) {
      currentModel = resp.model.name ?? resp.model.id ?? "unknown";
      updateStatus(currentModel);
      renderer.requestRender();
    }
  } catch {
    updateStatus("pi (unknown model)");
    renderer.requestRender();
  }
}

function handleLine(data: any) {
  if (data.type === "response" && data.id && pendingRequests.has(data.id)) {
    const pending = pendingRequests.get(data.id)!;
    pendingRequests.delete(data.id);
    if (data.success) {
      pending.resolve(data.data ?? null);
    } else {
      pending.reject(new Error(data.error ?? "RPC error"));
    }
    // Also update model info from responses
    if (data.command === "set_model" && data.success && data.data) {
      currentModel = data.data.name ?? data.data.id ?? currentModel;
      updateStatus(currentModel);
      renderer.requestRender();
    }
    return;
  }

  // It's an event
  handleEvent(data);
}

function cleanup() {
  if (piProcess) {
    try {
      piProcess.stdin?.end();
      piProcess.kill();
    } catch {}
    piProcess = null;
  }
  renderer.destroy();
}

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

// ── Start ─────────────────────────────────────────────────────────────
startPi().catch((err) => {
  addStatusLine(`Failed to start pi: ${err.message}`, colors.error);
});
