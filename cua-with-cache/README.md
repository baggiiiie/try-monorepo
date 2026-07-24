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

> **Current status:** `CachedCua` compiles and caches semantic actions,
> extraction recipes, and workflow plans. It supplies Pi with bounded AX data
> plus a screenshot on misses, and keeps Pi lazy on replay hits. Live Outlook
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

With no `grounder`, grounding is deterministic (`scoredSearch` for Simulang;
descriptor scoring for CUA). With a configured Pi grounder, a miss or stale
descriptor gets at most one model selection turn for that operation. A failed
caller precondition is terminal and does not trigger healing.

Candidate selection requires both a minimum score and a clear margin over the
runner-up. These can be tuned with `minScore` and `minScoreGap`.

Window-scoped context is refreshed before every lookup. App-root snapshots can
block in some applications, so callers should name routes explicitly when they
navigate between materially different screens:

```js
gui.setRoute('mail/inbox')
await gui.act('Inbox', { action: 'activate' })

gui.setRoute('mail/compose')
await gui.observe('Send')
```

Actions marked `risk: 'high'` use a stricter score margin and require explicit
pre- and post-verification. Their cached match must retain target text, and the
postcondition must check an outcome using `textPresent` or `valueContainsVar`:

```js
await gui.act('Send', {
  action: 'activate',
  risk: 'high',
  verify: {
    pre: { enabled: true },
    post: { textPresent: 'Message sent' },
  },
})
```

An action is executed at most once per `act` call. If post-verification fails,
the report is `REFUSED` with `actionPerformed: true`; self-healing will not
retry the action.

See [`CACHE-EXPLAINER.html`](CACHE-EXPLAINER.html) for an interactive overview
of the cache-hit, miss, and self-healing paths.

## Run the demos

```sh
npm run check:outlook
npm run check:outlook:cua
```

`check:outlook` preserves the older Simulang demo. `check:outlook:cua` uses the
new Stagehand-shaped API: the runner opens Outlook, provides one instruction and
one result schema, executes the cached workflow, and prints the report. It does
not contain Outlook traversal helpers or launch a coding agent.

The CUA resolver receives bounded structural candidate data and the current
screenshot; screenshots remain transient and are never cached. It may select
only one offered candidate or a single current-run visual point and cannot
change the caller's action. Low confidence, unknown IDs, generic replay
identity, provider errors, and stale structure are refused.

By default, the CUA demo loads Pi's local defaults and credentials from
`~/.pi/agent/{settings,models,auth}.json`. Override the directory with `PI_DIR`
or the model with `GUI_CACHE_MODEL=provider/model`. Pi initializes lazily, so a
complete warm cache can replay even if local Pi is unavailable.

Library callers can use the same local configuration:

```js
import { CachedCua } from 'gui-cache'

const cua = new CachedCua({ piDir: '~/.pi' })
const outlook = await cua.openApp('Outlook', {
  bundleId: 'com.microsoft.Outlook',
  windowTitle: 'Inbox',
})

const result = await outlook.agent().execute({ instruction, schema })
```

`CachedCua` logs app startup, cache hits and misses, Pi resolution, extraction,
and self-healing to the terminal by default. Pass `logger: false` to silence it
or `logger: (line) => { ... }` to route the same status lines elsewhere.

On a workflow miss, Pi first produces only semantic `act`/`extract` steps. Each
missing action is then resolved against a bounded current CUA snapshot, checked,
and compiled. Screenshot-only points may be dispatched for that miss but are
not persisted because they have no durable replay identity. Extraction recipes
store paths and stable endpoint structure, then read all values live.

The alternate CUA command uses the host-native `cua-driver` CLI. Unlike the
Simulang backend (live accessibility nodes and `scoredSearch`), the CUA backend
normalizes each CLI snapshot and re-resolves a durable descriptor to a fresh
ephemeral element token/index before every action. Outlook message rows expose
no AX action, so durable element actions convert a fresh AX frame to screenshot
coordinates and use CUA's foreground pixel delivery; CUA briefly fronts
Outlook, clicks once, and restores the prior app. The workflow verifies live
extraction changes between repeated selections, requires exactly three
non-duplicate messages, and never retries uncertain dispatch. See
[`CUA-LEARNINGS.md`](CUA-LEARNINGS.md) for the intermittent recursive Outlook
AX-tree limitation. The command requires a running Cua Driver daemon with macOS
Accessibility and Screen Recording permission.
