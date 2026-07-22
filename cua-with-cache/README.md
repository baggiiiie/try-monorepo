# gui-cache

A prototype GUI action compiler and cache for native automation, with Simulang
and CUA Driver backends. The target is Stagehand-style behavior: Pi resolves a
semantic instruction once, the library condenses it into a structured action,
and later runs replay that action deterministically without a model call.

Current development focuses on making the CUA path complete. Simulang remains
available but is not being removed or given a duplicate Outlook workflow.

- `src/` is the library: cache keys, descriptor matching, storage, and the
  `observe`/`act` replay + self-heal engine. It is app-agnostic.
- `examples/outlook-check.mjs` is a cache-backed Outlook email-triage demo.

> **Current status:** the library currently caches element descriptors, not
> complete actions or workflow replay steps. Pi can select structural AX
> candidates, but cannot yet ground from CUA screenshots. The Outlook demo is a
> prototype and still encounters CUA's intermittent recursive menu-only AX
> snapshots. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the intended design.

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

The demo grounds stable Outlook controls through the cache, then reads the top
three emails live from the accessibility tree and prints a JSON report. The
runner executes the workflow once and reports failures; it never launches a
coding agent. Today, cache misses are grounded deterministically with
Simulang's `scoredSearch` unless a Pi grounder is configured. With a grounder,
misses and stale descriptors make one in-process model turn with a structured
`select_element` tool, validate the selection, and store the resulting durable
descriptor. The cache stores only reusable UI grounding and never caches
returned app content.

The model receives bounded structural candidate data and sanitized durable
tokens—not screenshots, live values, descendants, sender/subject/body text,
window titles, CUA indices, or CUA element tokens. It may select only one
offered candidate and cannot change the caller's action. Low confidence,
unknown IDs, generic identities, provider errors, and target drift are refused.

By default, the Outlook demos load Pi's local defaults and credentials from
`~/.pi/agent/{settings,models,auth}.json`. Set `GUI_CACHE_MODEL=0` to run with
deterministic grounding only, or override the local selection with
`GUI_CACHE_MODEL_PROVIDER` and `GUI_CACHE_MODEL_ID`.

Library callers can use the same local configuration:

```js
import { createLocalPiGrounder, openApp } from 'gui-cache'

const gui = openApp('outlook', {
  grounder: await createLocalPiGrounder(),
})
```

`createPiGrounder(...)` remains available for explicit application-owned model
runtimes or environment-based provider authentication.

The alternate CUA command uses the host-native `cua-driver` CLI. Unlike the
Simulang backend (live accessibility nodes and `scoredSearch`), the CUA backend
normalizes each CLI snapshot and re-resolves a durable descriptor to a fresh
ephemeral element token/index before every action. Outlook message rows expose
no AX action, so this example explicitly converts their fresh AX frames to
screenshot coordinates and uses CUA's foreground pixel delivery; CUA briefly
fronts Outlook, clicks once, and restores the prior app. Both backends cache
only grounding and read returned data live. See
[`CUA-LEARNINGS.md`](CUA-LEARNINGS.md) for the intermittent recursive Outlook
AX-tree limitation. The command requires a running Cua Driver daemon with macOS
Accessibility and Screen Recording permission.
