# gui-cache

A reusable GUI cache layer for native accessibility automation, with Simulang
and CUA Driver backends. It is to native GUI grounding what
[Stagehand](https://github.com/browserbase/stagehand) is to Playwright: you
`observe` a UI concept once to ground + cache it, then `act` on it
deterministically, with automatic self-healing when the UI drifts.

- `src/` is the library: cache keys, descriptor matching, storage, and the
  `observe`/`act` replay + self-heal engine. It is app-agnostic.
- `examples/outlook-check.mjs` is a cache-backed Outlook email-triage demo.

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

Configure model-backed grounding explicitly:

```js
import { createPiGrounder, openApp } from 'gui-cache'

const gui = openApp('outlook', {
  grounder: createPiGrounder({ providerId: 'openai', modelId: 'gpt-5-mini' }),
})
```

The Outlook checks also enable it when `GUI_CACHE_MODEL_ID` is set; provider
defaults to `openai` and can be changed with `GUI_CACHE_MODEL_PROVIDER`.
Authentication is handled by `@earendil-works/pi-ai` through the provider's
normal environment variables, such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

The alternate CUA command uses the host-native `cua-driver` CLI and background
AX actions. Unlike the Simulang backend (live accessibility nodes and
`scoredSearch`), the CUA backend normalizes each CLI snapshot and re-resolves a
durable descriptor to a fresh ephemeral element token/index before every
action. Both cache only grounding and read returned data live. See
[`CUA-LEARNINGS.md`](CUA-LEARNINGS.md) for the current Outlook recursive AX-tree
and unavailable screenshot limitation. The command requires a running Cua
Driver daemon with macOS Accessibility permission; screenshot fallback also
requires capturable Screen Recording permission.
