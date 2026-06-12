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

- `gui` — helper API: `observe`, `act`, `step`, `batch`, `find`, `verify`, `screenshot`, `sleep`, `writeArtifact`, `record`.
- `sim` — raw `@simular-ai/simulang-js` namespace.
- `input` / `params` — original tool input.

Do not write `import` statements in the body; use `sim` for raw APIs.

## Structured examples

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
