# Expense Tracking

A personal, single-user expense tracker with three interfaces: a Go server (source of truth), a CLI, and an offline-first iOS app (SwiftUI).

## System Overview

```
┌──────────────────┐          ┌─────────────────────────┐
│  iOS App         │          │  Go Server              │
│  (SwiftUI,       │◄────────►│                         │
│   offline-first) │   sync   │  CLI ──┐                │
└──────────────────┘          │        ├─► Service ──► Repository (sqlc) ──► SQLite
                              │  HTTP ─┘                │
                              └─────────────────────────┘
```

## Tech Stack

| Component        | Choice                          | Notes                                        |
| ---------------- | ------------------------------- | -------------------------------------------- |
| Server           | Go                              | Single binary, simple deployment             |
| Server DB        | SQLite via sqlc                 | Single-file DB, easy backups                 |
| HTTP framework   | net/http (stdlib)               | No external dependencies needed              |
| CLI framework    | cobra                           | Standard Go CLI library                      |
| iOS app          | SwiftUI (iOS 17+)              | Modern declarative UI                        |
| iOS local DB     | GRDB (SQLite wrapper)           | Mature Swift SQLite library, matches server  |
| iOS ↔ Shortcuts  | App Intents framework           | Exposes actions to iOS Shortcuts             |

## Go Project Layout

```
server/
├── cmd/expense/              # main entrypoint
├── internal/
│   ├── cli/                  # cobra command definitions
│   ├── api/                  # HTTP handlers + router
│   ├── service/              # business logic (shared by CLI + API)
│   ├── repository/           # sqlc-generated data access
│   └── config/               # user preferences (JSON)
├── db/
│   ├── migrations/           # SQL schema migrations
│   └── queries/              # sqlc query files (.sql)
├── preferences.json          # user config file
└── go.mod
```

## HTTP API

Sync-only design — the iOS app talks to the server exclusively through push/pull:

```
POST /api/sync/push          Push local changes to server
GET  /api/sync/pull?since=   Pull remote changes since server_version cursor
```

Plus basic CRUD for the CLI's HTTP mode (if needed later):

```
POST   /api/expenses          Create expense
GET    /api/expenses           List expenses (with query params)
GET    /api/expenses/:id       Get single expense
PUT    /api/expenses/:id       Update expense
DELETE /api/expenses/:id       Soft-delete expense

GET    /api/categories         List categories
POST   /api/categories         Create category
PUT    /api/categories/:id     Update category
DELETE /api/categories/:id     Soft-delete category

GET    /api/preferences        Get user preferences
PUT    /api/preferences        Update user preferences
```

All endpoints accept and return JSON. All timestamps are **Unix timestamps** (int64).

## Key Design Decisions

- **SQLite everywhere** — Server and iOS both use SQLite. Same schema, simpler sync.
- **Server is source of truth** — Version-cursor sync: clients push, then pull by `server_version`; server wins on pull, client wins on push (last edit wins).
- **CLI-first development** — Every operation the iOS app can do is doable via CLI.
- **Single-user, no auth** — Personal tool. Server runs on a trusted network.
- **Amounts in cents** — All monetary values stored as integers (e.g., $12.50 → 1250). Avoids floating-point issues.
- **Soft deletes** — Records never physically deleted; `deleted_at` is set. Critical for sync.
- **Unix timestamps** — All times stored as Unix timestamps. Displayed in UTC+8 by default, configurable per user preference.
- **Privacy-first** — Raw wallet data stays on-device. Only user-confirmed expenses sync.

## User Preferences

Stored in a JSON file on the server (`preferences.json`). Synced to the iOS app on pull.

```json
{
  "currency": "SGD",
  "timezone": "Asia/Singapore",
  "date_format": "2006-01-02"
}
```

- **`currency`** — Default currency for new expenses. Defaults to `SGD`.
- **`timezone`** — Timezone for display. Defaults to `Asia/Singapore` (UTC+8).
- All preferences are configurable via CLI (`expense config set currency USD`) and the iOS Settings screen.

## Default Categories

The system ships with these categories seeded on first run:

| Name           | Icon |
| -------------- | ---- |
| Food & Dining  | 🍽️   |
| Groceries      | 🛒   |
| Transport      | 🚌   |
| Shopping       | 🛍️   |
| Entertainment  | 🎬   |
| Bills          | 📄   |
| Health         | 💊   |
| Other          | 📦   |

Users can add, edit, reorder, and delete categories.

## Apple Pay Integration

The iOS app captures Apple Pay transactions via **iOS Shortcuts Transaction automation + App Intents**:

1. User sets up a one-time Shortcuts automation (Transaction trigger → app's "Import Transaction" intent).
2. On every Apple Pay tap, the shortcut fires in the background and passes merchant name + amount.
3. The app stores a pending `WalletSuggestion` entry locally.
4. User opens the app, reviews the suggestion, and confirms it as an `Expense` that syncs normally.

See [docs/design/06-apple-pay-automation.md](docs/design/06-apple-pay-automation.md) for details.

## Scope

### In scope (v1)

- Manual expense entry (CLI + iOS)
- Category management with budgets
- Server-owned recurring expense rules
- Apple Pay automation (Shortcuts → App Intent)
- Offline-first iOS with sync
- Configurable preferences (currency, timezone)

### Out of scope (for now)

- Authentication / multi-user
- Multi-currency conversion

## Design Docs

| Doc | Description |
|-----|-------------|
| [01-architecture.md](docs/design/01-architecture.md) | System components, layering, and key decisions |
| [02-data-model.md](docs/design/02-data-model.md) | Core entities: Expense, Category, WalletSuggestion |
| [03-sync-strategy.md](docs/design/03-sync-strategy.md) | Version-cursor push-then-pull sync, conflict resolution |
| [04-cli-design.md](docs/design/04-cli-design.md) | CLI command structure, output modes, agent interaction |
| [05-ios-app.md](docs/design/05-ios-app.md) | iOS app screens, transaction detection, sync behavior |
| [06-apple-pay-automation.md](docs/design/06-apple-pay-automation.md) | Shortcuts + App Intents approach for Apple Pay capture |
