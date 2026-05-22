# Web Client Plan

> Status: Plan. Supersedes `pwa-migration-plan.md` (renamed; obsolete framing
> as a "migration"). See the Decisions Log at the end for the why behind each
> choice.

## Status & Handoff (read me first)

**Last updated:** 2026-05-22

**What is done:**
- Plan fully grilled and locked (see Decisions Log at the end of this doc —
  22 sub-questions resolved).
- [ADR-005](adr/005-single-user-auth-scope.md) amended with an "Update
  (2026-05-17)" section covering CF Tunnel exposure, the cookie credential
  path, the rate-limit decision, and three new replacement triggers.
- Phase 1 server work is implemented:
  - `POST /api/auth/exchange`, `HttpOnly` cookie auth support, and per-IP
    auth-failure rate limiting in
    [singleusersecret](../server/internal/singleusersecret/).
  - `GET /api/expenses` pagination with default last-7-days window.
  - Recurring expenses REST handlers.
  - `wallet_suggestions` migration, sqlc queries, service, REST handlers,
    and sync cursor integration.
  - API handler tests for auth exchange, expenses pagination, recurring
    expenses, and wallet suggestions; service round-trip tests for
    suggestion confirm.
- Phase 2 server static plumbing is implemented: `server/web/dist` is embedded
  and served with SPA fallback and cache headers; `make web` / `make web-dev`
  exist.
- Phase 3 PWA shell is complete: SvelteKit scaffolded under `server/web/`,
  builds to `server/web/dist`, includes install metadata/icons, service worker
  does shell pre-cache + network-first GET caching, manual SW registration
  with an "Update available — Reload" banner (user-consented `SKIP_WAITING`),
  and a one-time iOS Safari "Add to Home Screen" instruction sheet.
- Phase 4 v1 features are implemented:
  - HTTP client wrapper ([api.ts](../server/web/src/lib/api.ts)) with same-origin
    fetch, cookie credential, 401 → `/settings?reauth=1` redirect, and
    network/5xx failure → outbox handoff.
  - Dexie outbox ([outbox.ts](../server/web/src/lib/outbox.ts)) with per-`targetKey`
    FIFO, the documented backoff schedule, 4xx → failed, 5xx/network → retry,
    drain triggers on online/focus/visibilitychange + periodic kick.
  - Layout with bottom tab navigation and a header sync-status pill
    ([SyncStatusPill.svelte](../server/web/src/lib/SyncStatusPill.svelte)).
  - Screens: expense feed (day-grouped, cursor pagination), add/edit
    expense form, category CRUD, recurring CRUD, wallet-suggestion review
    (pre-filled confirm or dismiss), settings (paste secret, preferences,
    sync errors with Retry/Discard).

**What is in progress:** nothing.

**What blocks implementation:**
- **Phase 0 manual work — user responsibility:** provision Cloudflare
  Tunnel (domain, `cloudflared` daemon on the host, DNS record). Without
  HTTPS reachable at a stable hostname, Phase 3 PWA installability cannot
  be validated. This is not an agent task.

**Recommended next step for the next agent:**

1. Run the Validation Checklist end-to-end once the Cloudflare Tunnel is up
   (Phase 0 user task) — Lighthouse "Installable" audit, offline cold launch,
   offline write with outbox drain, auth-rotation 401 flow.
2. Start **Phase 5 + 6 together** (per Q7 they must ship as a pair): author
   the Shortcut recipe and document it in the rewritten
   `docs/design/06-apple-pay-automation.md`, then on the iOS side delete the
   App Intent files, rewrite `ApplePaySetupView`, and add the GRDB migration
   that aligns `wallet_suggestions` with the server schema + sync columns.

**Conventions a new agent must follow** (already in root
[AGENTS.md](../AGENTS.md), but repeated here for handoff clarity):

- SQL queries belong in `server/db/queries/`; generate Go accessors with
  sqlc rather than embedding SQL in services.
- Schema changes use goose migrations under `server/db/migrations/`.
- iOS UI changes must be built and launched in the simulator via
  `make build|install|run`. **Phase 6 (iOS rework) ships only with
  Phase 5**; do not partially delete the App Intent without the Shortcut
  recipe in place.
- Tests live under `tests/` (run via `make test`).

**Source-of-truth threads:**
- This plan: [docs/web-client-plan.md](./web-client-plan.md) (you're reading it).
- Auth ADR: [docs/adr/005-single-user-auth-scope.md](adr/005-single-user-auth-scope.md).
- Grilling session that produced these decisions:
  https://ampcode.com/threads/T-019e367e-ce30-773d-91d7-89b3ccd5d70e
  — read with `read_thread` if you need the reasoning for any specific
  decision in the Decisions Log.

**Do not re-litigate locked decisions** unless you find new evidence the
grilling missed. If you do, amend the Decisions Log with the new
finding and the resulting change; do not silently edit phase content
that contradicts a locked decision.

---


## Motivation

The iOS app requires re-signing every 7 days under a free Apple Developer
account. The web client is the escape hatch from that cycle — a second
client served by the existing Go server, installable on iOS via Safari's
**Add to Home Screen**.

This is **not** a migration. The iOS app stays. Both clients live
side-by-side against the same server.

## Goal

Ship an installable PWA with **functional parity** to the iOS app (not
1:1 visual parity). When the PWA is mature enough, retiring iOS becomes an
option — but is not part of this plan.

## Non-Goals

- Retiring or rewriting the iOS app.
- Replacing the existing sync protocol (iOS keeps using `/api/sync/push|pull`
  unchanged).
- Multi-user, per-user auth, sessions, or sign-in.
- Full local-first parity with iOS on the web side (deliberate; see Q5 in
  the Decisions Log).
- Background sync guarantees on the web (best-effort only; iOS retains
  reliable local-first behavior).
- Reports (server-side `ReportService` exists but has no UI in iOS and no
  HTTP handler — out of scope).
- Category reorder on the web (touch drag-drop on Safari is its own
  project; iOS retains it).

## Outcome (what "done" looks like)

1. User taps the home-screen icon → standalone window opens, no Safari
   chrome, real HTTPS via Cloudflare Tunnel.
2. App shell loads from cache; cold launch with no network shows the shell
   and the last-cached views.
3. Online: full CRUD on expenses, categories, recurring expenses,
   preferences, and wallet suggestions.
4. Offline: writes (create / update / delete) queue locally in an IndexedDB
   outbox and replay automatically on reconnect; reads return whatever the
   service worker has cached.
5. Apple Pay tap → Shortcuts automation → `POST /api/wallet-suggestions` →
   suggestion appears in **both** the PWA's "Review" screen (via REST) and
   the iOS app (via `/api/sync/pull`).
6. The iOS app retains all current functionality.
7. ADR-005 amended to reflect public-network exposure via CF Tunnel.

## Architecture

```
                        ┌──────────────────────────────┐
                        │  Go server (single binary)   │
                        │                              │
   ┌─────────────┐      │  /api/expenses               │
   │ iOS app     │◀────▶│  /api/categories             │
   │ (GRDB +     │ sync │  /api/recurring-expenses     │
   │ local-first)│      │  /api/preferences            │
   └─────────────┘      │  /api/wallet-suggestions     │
                        │  /api/sync/{push,pull}       │
   ┌─────────────┐ REST │  /api/auth/exchange          │
   │ Web client  │◀────▶│                              │
   │ (SvelteKit, │      │  Service ─▶ Repository       │
   │  outbox,    │      │              (sqlc/SQLite)   │
   │  installed  │      │                              │
   │  PWA)       │      │  embed.FS: /server/web/dist  │
   └─────────────┘      └──────────────────────────────┘
                                      ▲
                                      │  HTTPS via
                                      │  Cloudflare Tunnel
                                      │
   ┌─────────────┐      ┌─────────────┴───┐
   │ iOS         │ POST │ Apple Pay       │
   │ Shortcut    │──────│ Transaction     │
   │ (HTTP)      │      │ automation      │
   └─────────────┘      └─────────────────┘
```

## Tech Choices

| Concern              | Choice                                           | Notes                                                  |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Web framework        | SvelteKit                                        | Built-in SW, small bundle, file-based routing          |
| Web local storage    | IndexedDB (Dexie) — **outbox only**, no mirror   | Reads come from server; only pending writes persisted  |
| Service worker       | SvelteKit-generated; network-first for `/api/*`  | Pre-cache shell; runtime-cache last GET responses      |
| Sync protocol        | Reused unchanged for iOS; PWA uses REST          | Two clients, two styles, one backend                   |
| Wallet capture       | Shortcut → `POST /api/wallet-suggestions`        | Replaces App Intent; server is source of truth         |
| Auth (PWA)           | `HttpOnly` cookie, set via `POST /api/auth/exchange` | Defends token vs. XSS on a public origin           |
| Auth (iOS)           | Bearer header (existing Keychain)                | Unchanged                                              |
| Auth (Shortcut)      | Bearer header, hardcoded in HTTP action          | Single principal model preserved                       |
| Hosting              | Self-hosted Go binary behind Cloudflare Tunnel   | Real cert, no port-forward, no Let's Encrypt setup     |
| ID generation        | Client-generated UUID (same as iOS today)        | Server accepts client IDs                              |

## Tradeoffs (acknowledged upfront)

- **Privacy regression for wallet capture.** Apple Pay merchant/amount/card
  reach the server *before* user confirmation (Shortcut posts directly).
  Mitigation: suggestions are stored with `status='pending'` and never
  become an `Expense` without explicit user action.
- **Web side is not offline-first.** Offline reads only show what the SW
  cached; offline writes work via outbox but you cannot browse last month's
  data if the SW has never fetched it. iOS remains the durable offline
  surface.
- **No background sync on the web.** Outbox drains on app focus, online
  event, and `visibilitychange`. Safari does not reliably fire these in the
  background.
- **Public-network threat surface.** The shared bearer is the only thing
  between the public internet and the data (modulo Cloudflare's
  edge/WAF/DDoS protections). ADR-005 must be amended; basic rate-limiting
  on auth failures should be added when the endpoint goes public.
- **Existing local wallet suggestion data on iOS will be cleared** during
  the rollout (the GRDB table is dropped and recreated with sync columns).
  Test data only; not a real loss.

## Phased Plan

### Phase 0 — Decide & set up hosting

- [ ] Provision Cloudflare Tunnel: domain, tunnel daemon on the host,
      DNS record pointing the chosen hostname at the tunnel.
- [ ] Verify the existing Go server is reachable over HTTPS via the tunnel.
- [x] Amend or supersede [ADR-005](adr/005-single-user-auth-scope.md) to
      reflect public-network exposure.
- [x] Add a basic auth-failure rate limit to
      [`internal/singleusersecret`](../server/internal/singleusersecret/)
      (e.g., naive in-memory token bucket per remote IP, log on trip).

### Phase 1 — Server-side endpoints

All endpoints sit behind the existing shared-secret middleware (header
**or** cookie — see auth exchange below).

- [x] **goose migration** — `wallet_suggestions` table with columns:
      `id (PK), amount (nullable cents), currency, merchant, card_name (nullable),
      captured_at (unix), source, status (pending|accepted|dismissed),
      linked_expense_id (nullable FK), created_at, client_updated_at,
      server_version`. Add triggers for the `server_version` cursor (same
      pattern as [migration 6](../server/db/migrations/00006_server_version_sync_cursor.sql)).
- [x] **sqlc queries** under `server/db/queries/wallet_suggestions.sql`.
- [x] **HTTP handlers**:
  - `POST   /api/wallet-suggestions` — accepts `{id, merchant, amount,
    currency, captured_at, card_name?, source?}`. `id` is client-generated.
    Idempotent on `id`.
  - `GET    /api/wallet-suggestions?status=pending` — list.
  - `POST   /api/wallet-suggestions/:id/confirm` — body is the expense
    payload (with client-generated expense `id`). Server creates the
    expense and atomically sets the suggestion to
    `status='accepted'`, `linked_expense_id=<expense.id>`. One transaction.
  - `POST   /api/wallet-suggestions/:id/dismiss` — sets `status='dismissed'`.
- [x] **Recurring expenses REST handlers** (parallel shape to
      [expenses.go](../server/internal/api/expenses.go)):
      `GET /api/recurring-expenses`, `POST`, `PUT /:id`, `DELETE /:id`.
      sqlc queries already exist in
      [recurring_expenses.sql](../server/db/queries/recurring_expenses.sql);
      this is HTTP glue only.
- [x] **Pagination** on `GET /api/expenses`:
      `?before=<unix>&limit=<n>`. **Default window: last 7 days.** Returns
      the oldest `captured_at` in the page as the next cursor.
- [x] **`POST /api/auth/exchange`** — accepts `Authorization: Bearer <secret>`,
      responds `Set-Cookie: et_session=<secret>; HttpOnly; Secure;
      SameSite=Strict; Path=/api; Max-Age=<long>`. The
      `singleusersecret.Require` middleware learns to accept the cookie
      as an equivalent credential.
- [x] Tests: handler tests for each new endpoint; round-trip test for
      suggestion → confirm → expense.

### Phase 2 — Server: serve the PWA

- [x] Add `server/web/` for the SvelteKit project (`pnpm create svelte@latest`).
- [x] Build output goes to `server/web/dist`.
- [x] Embed via `//go:embed all:web/dist` and mount at `/` with SPA
      fallback to `index.html`.
- [x] Response headers (set in the static handler):
  - `index.html`: `Cache-Control: no-cache`
  - `sw.js`: `Cache-Control: no-cache`, `Service-Worker-Allowed: /`
  - hashed assets (`/_app/immutable/*`): `Cache-Control: public, max-age=31536000, immutable`
  - `manifest.webmanifest`: `Content-Type: application/manifest+json`
- [x] **Makefile**: add `make web` (runs `pnpm build` under `server/web`)
      and `make web-dev` (Vite dev server proxying `/api` to the Go server).
      Keep the existing iOS `make build|install|run` targets unchanged.

### Phase 3 — PWA shell + install metadata

- [x] Scaffold SvelteKit under `server/web/`.
- [x] `static/manifest.webmanifest`: `name`, `short_name`, `start_url: "/"`,
      `display: "standalone"`, `theme_color`, `background_color`, icons
      (180×180 apple-touch, 192, 512, 512 maskable).
- [x] In `app.html`:
  - `<link rel="manifest" href="/manifest.webmanifest">`
  - `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`
  - `<meta name="apple-mobile-web-app-capable" content="yes">`
  - `<meta name="mobile-web-app-capable" content="yes">`
  - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
  - `<meta name="apple-mobile-web-app-title" content="Expenses">`
- [x] **Service worker** (`src/service-worker.ts`):
  - Pre-cache the app shell on install.
  - Runtime cache for `GET /api/*`: **network-first**, 3-second timeout,
    fall back to cache on failure. Update cache with each successful
    response.
  - Navigations: network-first, fall back to cached `index.html`.
  - Update flow: SvelteKit auto-registration is disabled
    (`kit.serviceWorker.register = false`); `src/lib/sw-client.ts` registers
    the worker, watches `updatefound`, and exposes an `updateAvailable` store.
    `src/lib/UpdateBanner.svelte` renders a dismissable
    "Update available — Reload" pill that posts `SKIP_WAITING` only on user
    click and reloads on `controllerchange`. **No auto-`skipWaiting()`.**
- [x] First-run hint: `src/lib/IosInstallHint.svelte` detects iOS / iPadOS
      Safari that is not in standalone display-mode and shows a one-time
      "Add to Home Screen" sheet (dismissal persisted in `localStorage`).

### Phase 4 — PWA features

**Scope (v1):** expense feed, add/edit expense, category CRUD, recurring
expense CRUD, wallet suggestion review (accept/dismiss), settings, sync
status indicator.

**Not in v1:** category reorder, reports.

- [x] **HTTP client wrapper** ([api.ts](../server/web/src/lib/api.ts)):
  - Same-origin fetches.
  - Cookie credential implicit (`credentials: 'same-origin'`).
  - On `401`: marks auth unauthenticated and routes to
    `/settings?reauth=1`.
  - On network failure or 5xx/408/429 for a write: handed off to the
    outbox; the call returns `{ kind: 'queued' }`.
- [x] **Outbox** ([outbox.ts](../server/web/src/lib/outbox.ts), Dexie):
  - Record shape: `{id, method, url, body, targetKey, status, attempts,
    lastError, nextAttemptAt, createdAt}` — generic HTTP-request shape.
  - **Per-`targetKey` FIFO**: writes targeting the same key
    (e.g. `expense:<uuid>`) replay in order; different keys proceed in
    parallel.
  - Replay triggers: app launch, `online`, `focus`, `visibilitychange`,
    plus a 30 s periodic kick.
  - **4xx (except 408/429)**: mark `failed`, surface in "Sync errors (N)"
    UI; no automatic retry.
  - **5xx / network / 408 / 429**: exponential backoff
    (1 s, 5 s, 30 s, 5 m, 30 m, cap).
  - Every write payload includes `client_updated_at` so the server's LWW
    ([lww.go](../server/internal/service/lww.go)) works correctly.
- [x] **Screens** (ported under `server/web/src/routes/`):
  - `/` — expense feed (day-grouped, cursor "Load older" pagination).
  - `/expenses/new`, `/expenses/[id]` — add/edit form
    ([ExpenseForm.svelte](../server/web/src/lib/ExpenseForm.svelte)).
  - `/categories` — list + inline add/edit + delete (no reorder).
  - `/recurring` — list + inline add/edit + delete.
  - `/suggestions` — pending list → tap → pre-filled confirm form
    posting to `POST /:id/confirm`, or dismiss.
  - `/settings` — see spec below.
  - Header sync-status pill
    ([SyncStatusPill.svelte](../server/web/src/lib/SyncStatusPill.svelte)):
    "Synced" / "Offline" / "Syncing (N)" / "Sync errors (N)".
- [x] **Settings screen contents:**
  - Paste sync secret → `exchangeSecret()` calls `POST /api/auth/exchange`.
  - Currency, timezone, date format → `/api/preferences`.
  - "Sync errors (N)" — list of failed outbox rows with **Retry** /
    **Discard** per row.
  - **No** server URL field (hardcoded same-origin).
  - **No** "sign out" / "clear local data" in v1.

### Phase 5 — Shortcut bridge for Apple Pay

- [ ] Rewrite [`docs/design/06-apple-pay-automation.md`](design/) (or
      create if missing) to document the Shortcut recipe instead of the
      App Intent.
- [ ] Authorable Shortcut recipe (shareable via iCloud link):
  1. Trigger: Transaction (Apple Pay) automation.
  2. **Get Dictionary** action assembling
     `{id: UUID, merchant, amount, currency, captured_at, card_name, source: "shortcut"}`.
     `id` from Shortcuts' UUID action.
  3. **Get Contents of URL** → `POST https://<host>/api/wallet-suggestions`
     with headers:
     - `Authorization: Bearer <secret>` (hardcoded)
     - `Content-Type: application/json`
     - `Idempotency-Key: <same as id>`
  4. On failure (no network, 5xx): **Add to Reminders** with the JSON
     payload, so nothing is silently lost.
- [ ] Document the setup walkthrough (will be displayed in the
      rewritten iOS `ApplePaySetupView` — see Phase 6).

### Phase 6 — iOS rework (forced by Phase 5 + Q7)

This is iOS-side work; it ships *with* Phase 5 because the App Intent
deletion and the Shortcut switch must land together.

- [ ] **Delete**
      [`ios/ExpenseTracker/Intents/ImportTransactionIntent.swift`](../ios/ExpenseTracker/Intents/ImportTransactionIntent.swift)
      and
      [`ios/ExpenseTracker/Intents/ExpenseTrackerShortcuts.swift`](../ios/ExpenseTracker/Intents/ExpenseTrackerShortcuts.swift).
- [ ] **Rewrite**
      [`ios/ExpenseTracker/Views/Settings/ApplePaySetupView.swift`](../ios/ExpenseTracker/Views/Settings/ApplePaySetupView.swift)
      to walk through the Shortcut → HTTP setup (with the shareable
      iCloud link from Phase 5).
- [ ] **GRDB migration** for `wallet_suggestions`:
  - Drop the existing local-only table.
  - Recreate aligned with the server schema (drop `financekit_tx_id`,
    `transaction_name`; keep `card_name`).
  - Add the sync columns (`server_version`, `client_updated_at`).
- [ ] Wire `wallet_suggestions` into iOS sync push/pull
      ([SyncService.swift](../ios/ExpenseTracker/Services/SyncService.swift)
      and friends).
- [ ] Update `WalletSuggestionRepository` to add an `accept` operation
      (it currently only has `fetchPending` / `dismiss`), since accept
      now mutates the suggestion's `status` and `linked_expense_id`
      (was previously implicit via expense creation).
- [ ] Document the one-time data loss in release notes: "wallet
      suggestions captured before vX.Y are cleared on update; re-capture
      via Apple Pay if needed."

## Validation Checklist

- [ ] `manifest.webmanifest` passes Lighthouse "Installable" audit on a
      production build served from the Cloudflare Tunnel hostname.
- [ ] **Install flow**: Safari → Share → Add to Home Screen → tap icon →
      standalone window opens, no Safari chrome.
- [ ] **Offline cold launch**: airplane mode → tap icon → app shell loads
      from cache, last-fetched views render from runtime cache.
- [ ] **Offline write**: airplane mode → create expense → row appears
      optimistically with "queued" badge → restore network → outbox
      drains → badge clears → reload PWA → row is server-confirmed.
- [ ] **Apple Pay end-to-end**: tap a test card → Shortcut fires → server
      returns 2xx → suggestion visible in PWA review screen (next REST
      fetch) AND iOS suggestions screen (next sync-pull).
- [ ] **Confirm round-trip**: accept a suggestion in PWA → expense
      appears in PWA list → iOS sync-pull picks up both the suggestion
      status change and the new expense.
- [ ] **Sync-error UX**: forge a 4xx (e.g., create expense with deleted
      category) → outbox row marked `failed` → "Sync errors (1)" appears
      in header → Settings shows the failed row with Retry / Discard.
- [ ] **Auth rotation**: rotate secret on server → next PWA request 401s
      → user is bounced to Settings → re-paste → cookie exchanged → flow
      resumes. Same for iOS Keychain.
- [ ] **Persistence after 7 days**: installed PWA storage survives 7 days
      of no use (confirms eviction-free behavior of installed PWAs).
- [ ] iOS app retains all functionality; `make build install run` still
      produces a working iOS app.

## Decisions Log

These are the resolved questions from the grilling that produced this
plan. Each decision links to the section it affects.

| Q  | Question                                                              | Decision                                                                                  |
| -- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1  | iOS-only / web-only / dual?                                           | **Dual.** iOS app stays; web is additive. Drove the "Web Client Plan" framing.            |
| 2  | What is the PWA for?                                                  | Feature parity with iOS, not 1:1 — driven by escaping the 7-day re-sign cycle.            |
| 3  | Defer the `wallet_suggestions` server work?                           | **No** — Shortcut writes to server; both clients consume.                                 |
| 4  | Sync transport for suggestions (PWA): synced table vs REST?           | Resolved by Q5: REST on PWA; synced table on iOS.                                         |
| 5  | Thin client / outbox+REST / full local-first?                         | **(B) Outbox + REST.** Solves offline writes; avoids the cost of a full local mirror.     |
| 6a | PWA auth: bearer-in-IDB vs HttpOnly cookie?                           | **HttpOnly cookie** via `POST /api/auth/exchange`. Defends vs. XSS on a public origin.    |
| 6b | Shortcut auth?                                                        | **Hardcoded bearer header.** One principal, one secret.                                   |
| 6c | Hosting?                                                              | **Cloudflare Tunnel.** Real cert, no port-forward, hides home IP.                         |
| 7a | Wallet suggestion writer?                                             | **Shortcut only.** Delete `ImportTransactionIntent` + `ExpenseTrackerShortcuts`.          |
| 7b | iOS reader for suggestions?                                           | **Sync-pull.** Consistent with every other entity on iOS.                                 |
| 7c | `wallet_suggestions` schema?                                          | Drop `financekit_tx_id`, `transaction_name`. Keep `card_name` (used in iOS UI).           |
| 7d | Confirm endpoint shape?                                               | **`POST /api/wallet-suggestions/:id/confirm`** with the (possibly edited) expense body.   |
| 8a | ID generation?                                                        | **Client UUID.** Matches existing iOS / server contract.                                  |
| 8b | Outbox record shape?                                                  | **Generic HTTP request** `{method, url, body, …}`. No domain-typed enum.                  |
| 8c | Outbox ordering?                                                      | **Per-record FIFO** (`target_key`). 4xx → mark failed + surface in UI. 5xx → backoff.     |
| 9a | Web framework?                                                        | **SvelteKit.**                                                                            |
| 9b | v1 scope?                                                             | Expenses, categories, recurring expenses, wallet suggestions, preferences, settings.      |
| 9c | What to cut from v1?                                                  | **Category reorder.** Touch DnD on Safari is too much work for too little win.            |
| 10a| Pagination on `/api/expenses`?                                        | **Hybrid**: default last 7 days, cursor `?before=&limit=` for older.                      |
| 10b| Recurring expenses REST?                                              | **Full REST surface** added in Phase 1.                                                   |
| 10c| Existing iOS local wallet suggestion data?                            | **Abandon.** GRDB migration drops + recreates the table. Documented in release notes.     |
| 11a| Service worker strategy?                                              | Pre-cache shell; **network-first** for `/api/*` GETs; banner-on-update (no auto-reload).  |
| 11b| Settings screen contents?                                             | Paste-secret + preferences + sync-errors. No URL field. No sign-out in v1.                |
| 11c| Doc handling?                                                         | **Rewrite end-to-end** (this doc). Original lives in git history.                         |
