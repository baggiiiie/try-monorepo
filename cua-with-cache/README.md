# gui-cache

A reusable GUI cache layer on top of [`@simular-ai/simulang-js`](https://github.com/simular-ai/simulang-js).
It is to simulang's accessibility grounding what
[Stagehand](https://github.com/browserbase/stagehand) is to Playwright: you
`observe` a UI concept once to ground + cache it, then `act` on it
deterministically, with automatic self-healing when the UI drifts.

- `src/` is the library: cache keys, descriptor matching, storage, and the
  `observe`/`act` replay + self-heal engine. It is app-agnostic.
- `examples/` contains app-specific demo scripts (Outlook, Teams) and their
  live-reading helpers under `examples/apps/...`.

## API

```js
import { openApp } from './src/index.mjs'

const gui = openApp('outlook', { app: 'Microsoft Outlook' })

// observe: ground a concept, cache the descriptor, do NOT act.
const found = await gui.observe('Search')

// act: cached grounding + a simulang action on the element.
await gui.act('Inbox', { action: 'activate' })
```

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

## Run the demos

```sh
npm run check:outlook
npm run check:teams
```

The demos are intentionally thin: `openApp(...)`, a few `observe`/`act` calls
on stable controls, then live reading via the `examples/apps/...` helpers.

The cache stores only reusable UI grounding (descriptors for stable controls).
It never caches returned Outlook email content or Teams chat content; those are
read live on each call. URLs in extracted content are redacted to `[url]`.

Note: selecting unread messages in Outlook may cause Outlook to mark them read,
depending on the user's mail settings.
