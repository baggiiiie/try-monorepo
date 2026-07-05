# gui-cache

A reusable GUI cache layer on top of [`@simular-ai/simulang-js`](https://github.com/simular-ai/simulang-js).
It is to simulang's accessibility grounding what
[Stagehand](https://github.com/browserbase/stagehand) is to Playwright: you
`observe` a UI concept once to ground + cache it, then `act` on it
deterministically, with automatic self-healing when the UI drifts.

- `src/` is the library: cache keys, descriptor matching, storage, and the
  `observe`/`act` replay + self-heal engine. It is app-agnostic.
- `examples/outlook-check.mjs` is a minimal Outlook grounding/cache check.

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

Every `observe`/`act` returns a JSON-friendly report plus a non-enumerable
`.node` — the live simulang `AccessibilityNode` — so callers read app data
directly from the grounded element:

```js
const { node } = await gui.observe('Inbox')
for (const row of node.children()) { /* read live */ }
```

Reports carry a `cacheStatus`:

- `HIT` — cached descriptor re-resolved to a unique element and verified.
- `MISS` — no cache entry; grounded live via `scoredSearch` and stored.
- `HEALED` — cached descriptor was stale; re-grounded from the concept and
  re-stored.
- `REFUSED` — the cache entry was not safe to use (ambiguous / failed
  verification).

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

## Run the demos

```sh
npm run check:outlook
```

The demo is intentionally direct: `openApp(...)`, a few `observe` calls on
stable controls, then a JSON report.

The cache stores only reusable UI grounding (descriptors for stable controls).
It never caches returned app content; demo-specific live reads happen outside
the library.
