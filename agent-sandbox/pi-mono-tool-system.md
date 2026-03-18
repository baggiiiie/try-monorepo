## Tool Registration & Extension Architecture in `coding-agent`

The [`coding-agent`](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) package has a **two-tier tool system**: a fixed set of built-in tools and a fully dynamic plugin system for custom tools. Tools are absolutely **not hardcoded**—extensions can register, override, and even dynamically add new tools at runtime after session start.

---

## 1. Built-in Tools (Static Layer)

Seven built-in tools are defined in [`src/core/tools/`](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/src/core/tools) and are pre-instantiated using `process.cwd()` as the working directory:

| Tool | Description |
|---|---|
| `read` | File reading with image support and auto-resize |
| `bash` | Shell command execution |
| `edit` | String-based file diffing/editing |
| `write` | File writing |
| `grep` | Pattern search across files |
| `find` | File path discovery |
| `ls` | Directory listing |

These are exported from [`src/core/tools/index.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/index.ts) as both pre-built instances (e.g., `readTool`) and factory functions (e.g., `createReadTool(cwd)`). Three named sets are also exported:

```typescript
// Default full-access set
export const codingTools: Tool[] = [readTool, bashTool, editTool, writeTool];

// Read-only set
export const readOnlyTools: Tool[] = [readTool, grepTool, findTool, lsTool];

// All tools in a named map (used for tool registry lookup)
export const allTools = { read, bash, edit, write, grep, find, ls };
```

At session creation, the `tools` option in [`CreateAgentSessionOptions`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/sdk.ts#L60) selects which built-in tools are active (defaults to `[read, bash, edit, write]`).

---

## 2. The Extension System (Dynamic Layer)

The real power comes from the **extension system**, centered on four files:

### `ToolDefinition` Interface

Defined in [`src/core/extensions/types.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts#L335):

```typescript
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
    name: string;            // LLM tool call name
    label: string;           // Human-readable UI label
    description: string;     // Sent to the LLM as part of the tool schema
    promptSnippet?: string;  // One-line snippet for the system prompt's "Available tools" section
    promptGuidelines?: string[]; // Bullet points appended to system prompt's Guidelines section
    parameters: TParams;     // TypeBox schema for parameter validation

    execute(toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult<TDetails>>;

    renderCall?: (args, theme) => Component;    // Custom TUI rendering for the call
    renderResult?: (result, options, theme) => Component; // Custom TUI rendering for the result
}
```

### Registration Flow

Extensions are TypeScript/JavaScript modules that export a factory function `(pi: ExtensionAPI) => void`. The API object exposes `pi.registerTool(tool)`:

```typescript
// In loader.ts
registerTool(tool: ToolDefinition): void {
    extension.tools.set(tool.name, {
        definition: tool,
        extensionPath: extension.path,
    });
    runtime.refreshTools(); // Triggers live refresh!
},
```

The call to `runtime.refreshTools()` is key — it immediately propagates new tools to the live agent. During the initial load phase, `refreshTools` is a no-op (real action is bound later via `bindCore()`).

### Discovery & Loading

Extensions are discovered by [`discoverAndLoadExtensions()`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/loader.ts#L499) in three locations (in priority order):

1. **Project-local**: `.pi/extensions/` in the project working directory
2. **Global**: `~/.pi/agent/extensions/`
3. **Explicitly configured**: paths from `settings.extensions[]`

Each location supports:
- Direct `.ts`/`.js` files
- Subdirectories with `index.ts` / `index.js`
- Subdirectories with a `package.json` declaring a `"pi": { "extensions": [...] }` manifest

Extensions are loaded using [`@mariozechner/jiti`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/loader.ts#L288) to transpile TypeScript at runtime — no build step required. When running as a compiled Bun binary, bundled packages are made available to extension modules via `virtualModules`.

### Tool Wrapping

When tools from extensions are brought into the agent's tool registry, they are wrapped by [`wrapRegisteredTool()`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/extensions/wrapper.ts#L16) in `wrapper.ts`:

```typescript
export function wrapRegisteredTool(registeredTool: RegisteredTool, runner: ExtensionRunner): AgentTool {
    const { definition } = registeredTool;
    return {
        name: definition.name,
        label: definition.label,
        description: definition.description,
        parameters: definition.parameters,
        execute: (toolCallId, params, signal, onUpdate) =>
            definition.execute(toolCallId, params, signal, onUpdate, runner.createContext()),
    };
}
```

This adapter bridges the extension's `ToolDefinition` (which receives `ExtensionContext`) to the agent-core's `AgentTool` interface.

---

## 3. The Tool Registry (`AgentSession`)

[`AgentSession`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/agent-session.ts) maintains two registries:

- `_baseToolRegistry`: the built-in tools (read, bash, edit, etc.)
- `_toolRegistry`: merged map of base tools + all wrapped extension/custom tools

The key method is [`_refreshToolRegistry()`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/agent-session.ts#L2196):

```typescript
private _refreshToolRegistry(options?): void {
    // 1. Gather all extension-registered tools
    const registeredTools = this._extensionRunner?.getAllRegisteredTools() ?? [];

    // 2. Include SDK-provided customTools
    const allCustomTools = [
        ...registeredTools,
        ...this._customTools.map(def => ({ definition: def, extensionPath: "<sdk>" })),
    ];

    // 3. Build prompt snippet and guidelines maps per-tool
    this._toolPromptSnippets = new Map(...)
    this._toolPromptGuidelines = new Map(...)

    // 4. Wrap extension tools into AgentTools
    const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, this._extensionRunner);

    // 5. Merge with base tools (extension tools can OVERRIDE built-ins by name)
    const toolRegistry = new Map(this._baseToolRegistry);
    for (const tool of wrappedExtensionTools) {
        toolRegistry.set(tool.name, tool);  // Override if same name!
    }
    this._toolRegistry = toolRegistry;

    // 6. Set active tools on the agent and rebuild system prompt
    this.setActiveToolsByName([...new Set(nextActiveToolNames)]);
}
```

`setActiveToolsByName` then calls [`agent.setTools(tools)`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/agent-session.ts#L732) and rebuilds the system prompt to reflect the new tool listing.

---

## 4. Dynamic Tool Registration at Runtime

Tools can be added **after session start**, including from within running command handlers. The [`dynamic-tools.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/dynamic-tools.ts) example demonstrates this explicitly:

```typescript
export default function dynamicToolsExtension(pi: ExtensionAPI) {
    // Register one tool at session_start
    pi.on("session_start", (_event, ctx) => {
        registerEchoTool("echo_session", "Echo Session", "[session] ");
    });

    // Register more tools at runtime via a slash command
    pi.registerCommand("add-echo-tool", {
        handler: async (args, ctx) => {
            const toolName = normalizeToolName(args);
            registerEchoTool(toolName, `Echo ${toolName}`, `[${toolName}] `);
            ctx.ui.notify(`Registered dynamic tool: ${toolName}`, "info");
        },
    });
}
```

When `pi.registerTool()` is called after the session is initialized, `runtime.refreshTools()` is already bound to the real `_refreshToolRegistry()` action, so the agent's tool list and system prompt update immediately without requiring any restart.

---

## 5. Tool Overriding

Extensions can **override built-in tools** by registering a tool with the same name. The [`tool-override.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/tool-override.ts) example replaces the built-in `read` tool with one that adds path-blocking and access logging:

```typescript
pi.registerTool({
    name: "read",  // Same name as built-in — will replace it in the registry
    label: "read (audited)",
    // ...
});
```

In `_refreshToolRegistry`, the `toolRegistry` is first populated with base tools, then extension tools overwrite entries with matching names.

---

## 6. Event Interception (Hooks on Tools)

Beyond registering new tools, extensions can also **intercept built-in tool calls** via event handlers — without replacing the tool itself:

```typescript
// Block or modify tool calls before execution
pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command.includes("rm -rf")) {
        return { block: true, reason: "Destructive command blocked" };
    }
});

// Modify tool results after execution  
pi.on("tool_result", async (event, ctx) => {
    // Can replace content, details, or isError
    return { content: [...modifiedContent] };
});
```

These hooks are installed on the agent-core via `agent.setBeforeToolCall()` / `agent.setAfterToolCall()` in [`_installAgentToolHooks()`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/agent-session.ts#L314).

---

## 7. SDK-level Custom Tools

As an alternative to the file-based extension system, the `createAgentSession()` API also accepts `customTools` directly:

```typescript
await createAgentSession({
    customTools: [
        {
            name: "my_tool",
            label: "My Tool",
            description: "Does something custom",
            parameters: Type.Object({ input: Type.String() }),
            async execute(toolCallId, params, signal, onUpdate, ctx) {
                return { content: [{ type: "text", text: `Got: ${params.input}` }] };
            }
        }
    ]
});
```

These are treated identically to extension-registered tools in `_refreshToolRegistry`.

---

## Architecture Summary

```
flowchart TD
    A[createAgentSession] --> B[AgentSession]
    B --> C[_buildRuntime]
    C --> D[_baseToolRegistry\nread/bash/edit/write/grep/find/ls]
    C --> E[ExtensionRunner]

    E --> F[discoverAndLoadExtensions\n.pi/extensions/\n~/.pi/agent/extensions/]
    F --> G[loader.ts / jiti\nTypeScript transpilation]
    G --> H[ExtensionAPI\nper-extension]
    H --> I[pi.registerTool\nToolDefinition stored\nin extension.tools Map]

    I --> J[runtime.refreshTools\n→ _refreshToolRegistry]
    J --> K[_toolRegistry\nbase tools + wrapped extension tools]
    K --> L[agent.setTools\n+ rebuilt system prompt]
```

**Key design principles:**
1. **Tools can be registered at any time** — before session start (during extension loading), at `session_start`, or dynamically from command handlers at runtime.
2. **Extension tools override built-ins by name** — no special API needed.
3. **No binary recompilation** — extensions are loaded as raw TypeScript files via `jiti`.
4. **Tool prompt integration is automatic** — `promptSnippet` and `promptGuidelines` fields are merged into the system prompt whenever `setActiveToolsByName` is called.
5. **Tool call/result interception** works independently of tool registration, allowing behavior modification without replacement.


How it works:
- Extensions export a factory function that receives an ExtensionAPI object
- They call pi.registerTool() with a full ToolDefinition (name, description, schema, execute function)
- registerTool calls runtime.refreshTools() which immediately updates the live agent's tool registry and system prompt — true hot reload
- Tools can be registered at any point: during loading, at session_start, or dynamically via slash commands mid-session

What makes it powerful:
- No recompilation — raw .ts files are loaded and transpiled at runtime
- Override built-ins — register a tool with the same name as a built-in and it replaces it
- Event hooks — intercept any tool call/result via pi.on("tool_call", ...) without replacing the tool
- Full code, not just bash — tools are real functions with typed parameters, not shell command templates
