# Pi `simulang` extension

This repo now includes a project-local Pi extension at `.pi/extensions/simulang.ts`.

It registers one tool named `simulang` for fast GUI feedback loops:

- `mode: "observe"` — return compact GUI state and artifacts.
- `mode: "step"` — run one structured GUI action, then observe.
- `mode: "batch"` — run a short sequence of structured actions, optionally observing after each action.
- `mode: "run"` — execute a TypeScript body with a `gui` helper in scope.

The runtime helper lives at `.pi/extensions/simulang-runtime.mts`. It is intentionally not a sandbox: the generated script runs through `simulang run` as normal trusted project code.

## Code-first example

```json
{
  "mode": "run",
  "name": "open-calendar",
  "code": "const before = await gui.observe();\nconst clicked = await gui.act({ type: 'press', query: 'Calendar' });\nconst after = await gui.observe();\nreturn { before: before.summary, clicked, after: after.summary };"
}
```

Inside `mode: "run"`, these names are available:

- `gui` — helper API: `observe`, `activate` / `activateWindow`, `act`, `step`, `batch`, `find`, `verify`, `screenshot`, `sleep`, `writeArtifact`, `record`.
- `sim` — raw `@simular-ai/simulang-js` namespace.
- `input` / `params` — original tool input.

Do not write `import` statements in the body; use `sim` for raw APIs.

## Structured examples

Activate a target window, then observe with screenshot fallback for shallow AX trees:

```json
{
  "mode": "step",
  "target": { "titleIncludes": "Telegram" },
  "action": { "type": "activateWindow" },
  "options": { "observe": { "fallback": "auto" } },
  "stealFocus": true,
  "safety": { "stealFocus": true }
}
```

Act and observe:

```json
{
  "mode": "step",
  "action": { "type": "press", "query": "Calendar" },
  "options": { "observe": { "maxSnapshotLines": 80 } }
}
```

Batch actions:

```json
{
  "mode": "batch",
  "actions": [
    { "type": "press", "query": "Search" },
    { "type": "type", "text": "budget" },
    { "type": "pressKey", "key": "Enter" }
  ],
  "options": { "observe": "afterEach", "stopOnFailure": true }
}
```

## Artifacts

Each invocation writes a run directory under `.runs/simulang-*` containing:

- `run.mts` — generated script;
- `result.json` — structured result returned to Pi;
- `trace.json` — observations/actions/verifications;
- snapshots, candidates, screenshots, and error diagnostics as needed.

`gui.screenshot()` is safe to call with no arguments. If the tool call has a `target`, it captures a window crop when the target window bounds are available; pass `{ full: true }` for a full-screen screenshot. `observe({ fallback: "auto" })` adds a screenshot artifact when the target AX tree is shallow.

## Observe vs find

`observe()` is for app/window state. It does not accept a semantic query:

```ts
const opened = await gui.act({ type: 'openApp', app: 'Microsoft Teams' })
const target = { pid: opened.result.instance.pid }
await gui.observe({ target })
```

Use `find()` to locate semantic UI elements:

```ts
await gui.find({ target, text: 'Unread' })
await gui.find({ target, text: 'Archive' })
```

After `openApp()`, prefer targeting the returned process ID instead of guessing from the window title:

```ts
const opened = await gui.act({ type: 'openApp', app: 'Microsoft Outlook' })
const target = { pid: opened.result.instance.pid }
await gui.observe({ target })
```

Title matching (`{ titleIncludes: '...' }`) is still useful before opening an app or when selecting among multiple visible windows. If a title selector misses after `openApp()`, target resolution falls back to the opened process' visible window, which handles apps such as Outlook whose title may be `Inbox • account` rather than `Outlook`.

Advanced debugging overrides such as `ax: false` or `snapshot: false` may be used manually, but they are not part of the normal Pi-facing interface.

## Safety defaults

By default, the helper avoids focus stealing and blocks destructive, externally visible, and production-impacting actions. Local state-changing actions such as typing/searching are allowed because they are needed for fast GUI navigation. Override higher-risk categories only explicitly:

```json
{
  "safety": {
    "allowDestructive": true,
    "allowExternal": true,
    "allowProduction": true,
    "allowCoordinates": true,
    "stealFocus": true
  }
}
```
