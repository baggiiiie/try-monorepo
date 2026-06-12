# Codemode and Pi Coding Agent

Codemode is a Pi Coding Agent extension that gives the model one typed TypeScript execution tool instead of requiring many small tool calls. In this repo, the extension registers a top-level `codemode` tool plus visible file-editing helpers such as `replace_in_file` and `apply_patch`.

## What Codemode does

When the agent calls `codemode`, it passes a TypeScript code body. Codemode type-checks that code first, then runs it in a QuickJS sandbox with only explicit globals available.

Example code body:

```ts
const pkg = await read({ path: "package.json" });
const status = await cli.git.status({ short: true });

return {
  packageName: JSON.parse(pkg).name,
  gitStatus: status.stdout,
};
```

## How Pi uses it

Pi loads Codemode as an extension package from the package manifest. On startup, the extension:

1. Loads config from `~/.pi/agent/codemode.json` and `.pi/codemode.json`.
2. Registers the `codemode` tool and related file-editing tools.
3. Adds Codemode instructions and generated TypeScript API definitions to Pi's system prompt.
4. Adjusts Pi's active tool list based on `/codemode` mode.

Useful modes:

- `/codemode on` enables Codemode and normal non-bash tools.
- `/codemode yolo` also enables native Pi `bash` when available.
- `/codemode off` restores normal Pi tools.

## Available APIs inside Codemode

Inside the sandboxed code, the model can use approved host-backed APIs such as:

- `read({ path })` for project file reads.
- `cli.<tool>.<operation>(args)` for configured typed CLI operations.
- `codemode.search_tools(...)`, `codemode.list_tools(...)`, and `codemode.describe_tools(...)` for discovery.
- `codemode.<namespace>.<tool>(args)` for configured MCP tools.
- `print(...)` for diagnostic output.
- `π.key` for string constants passed separately from code.

MCP tools are not registered as separate Pi tools. They are discovered and called through the `codemode` namespace from inside the single Codemode tool.

## Security model

Generated code is treated as untrusted. It cannot directly access Node.js, the filesystem, environment variables, network, or subprocess APIs. All real work goes through Codemode's host dispatcher, which enforces project path checks, configured CLI allowlists, MCP routing, timeouts, and sandbox limits.
