# gui-cache

A prototype GUI action compiler and cache for native automation, with Simulang
and CUA Driver backends. The target is Stagehand-style behavior: Pi resolves a
semantic instruction once, the library condenses it into a structured action,
and later runs replay that action deterministically without a model call.

Current development focuses on making the CUA path complete. Simulang remains
available but is not being removed or given a duplicate Outlook workflow.

- `src/` is the library: cache keys, descriptor matching, storage, and the
  `observe`/`act` replay + self-heal engine. It is app-agnostic.
- `examples/outlook-cua-check.mjs` is the thin CUA Outlook email-triage demo.

> **Current status:** `CachedCua` compiles and caches semantic actions and
> extraction recipes; its optional autonomous `execute()` API also caches
> workflow plans. It supplies Pi with bounded AX data plus a screenshot on
> misses, and keeps Pi lazy on replay hits. Live Outlook
> runs can still encounter CUA's intermittent recursive menu-only AX snapshot;
> that is reported as a failure rather than hidden by blind input.

## API

```js
import { openApp } from './src/index.mjs'

const gui = openApp('outlook', { app: 'Microsoft Outlook' })

// observe: ground a concept, cache the descriptor, do NOT act.
const found = await gui.observe('Search')

// act: cached grounding + a simulang action on the element.
await gui.act('Inbox', { action: 'activate' })
```

Grounding is cached by UI concept, application, and route. Actions and runtime
values do not create duplicate locator entries, and the verification supplied
by the current call is always used.

By default `openApp` launches and focuses the target app. To attach to an
already-running instance without launching or stealing focus, pass
`openApp: false` (and optionally `focusApp: false`):

```js
const gui = openApp('outlook', { app: 'Microsoft Outlook', openApp: false })
```

Every `observe`/`act` returns a JSON-friendly report and a hierarchical runtime
locator. Passing that report to another operation always re-resolves it, rather
than acting on its potentially stale `.node`. Scoped and collection operations
compose without importing Simulang:

```js
const list = await gui.observe('Message List', { within: 'Inbox' })
const rows = await gui.observeMany('messages', { within: list, role: 'cell', limit: 3 })
const before = await gui.extract('Reading pane', { project: parsePane })
await gui.act(rows.items[0], 'activate')
await gui.waitForChange('Reading pane', { from: before, project: parsePane })
```

`extract` serializes a bounded, JSON-safe `NodeView` and applies the caller's
deterministic `project(view)` and optional `validate(data, view)` callbacks.
It does not infer a schema or semantics from natural language, and neither the
tree nor projected dynamic data is cached. App-specific filtering and parsing
belongs in concise workflow/capability code under `examples/`.

Reports carry a `cacheStatus`:

- `HIT` — cached descriptor re-resolved to a unique element and verified.
- `MISS` — no cache entry; grounded from the current UI and stored.
- `HEALED` — a cache entry existed but was stale or its application context
  changed; the target was grounded again and the descriptor replaced.
- `REFUSED` — the cache entry was not safe to use (ambiguous / failed
  verification).
