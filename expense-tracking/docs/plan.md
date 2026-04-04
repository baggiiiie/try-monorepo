# Implementation Plan

## Phase 1: Go Server + CLI (Foundation)

Get the core working end-to-end on the command line.

1. Scaffold Go project (`cmd/expense/`, `internal/`, `db/`)
2. Set up SQLite with sqlc — write migrations for `expenses`, `categories` tables
3. Implement repository layer (sqlc-generated)
4. Implement service layer — CRUD for expenses and categories, validation
5. Build CLI commands with cobra: `expense add`, `list`, `show`, `edit`, `delete`, `category add/list/edit/delete`
6. Seed default categories on first run
7. Add user preferences (`preferences.json`) — `expense config get/set`
8. Add `expense summary` and `expense budget` commands
9. Use goose for database migrartion

**Done when**: You can add expenses, categorize them, and see summaries entirely from the terminal.

## Phase 2: HTTP API + Sync

Make the server accessible to the iOS app.

1. Set up HTTP server with `net/http` — router, JSON helpers, error handling
2. Implement CRUD endpoints (`/api/expenses`, `/api/categories`, `/api/preferences`)
3. Implement sync endpoints (`/api/sync/push`, `/api/sync/pull`)
4. Add `last_push_at` / `last_pull_at` tracking
5. Handle `client_id` deduplication on push
6. Test sync flow manually with curl — push new records, pull changes, verify soft deletes propagate
7. Use chi for routing

**Done when**: You can curl the sync endpoints and get correct push/pull behavior.

## Phase 3: iOS App (Core)

Get a functional offline-first app without Apple Pay integration.

1. Create Xcode project (SwiftUI, iOS 17+)
2. Set up GRDB with the same schema as the server
3. Build the Expense Feed (home screen) — list grouped by day
4. Build Add/Edit Expense form — amount, category, merchant, date
5. Build Category management screen
6. Build Settings screen — server URL config
7. Seed default categories on first launch

**Done when**: You can add and browse expenses on the phone with no server connection.

## Phase 4: Sync

Connect the iOS app to the server.

1. Implement sync service — push local changes, pull remote changes
2. Add `sync_status` tracking per record (synced, pending_push, conflict)
3. Trigger sync on app launch, foreground return, and pull-to-refresh
4. Add sync status indicator in nav bar
5. Handle offline gracefully — queue changes, sync when back online
6. Test: add expense on CLI, pull on phone; add on phone, push to server

**Done when**: Changes flow reliably between CLI and iOS app.

## Phase 5: Apple Pay Automation

Wire up the Shortcuts integration.

1. Implement `ImportTransactionIntent` (App Intents framework)
2. Register it via `AppShortcutsProvider`
3. Add `WalletSuggestion` table to local DB
4. Build Wallet Suggestions screen — list pending entries with Add/Dismiss actions
5. Add banner on home screen when pending suggestions exist
6. Build onboarding/settings flow that walks user through Shortcuts setup
7. Handle amount = 0 gracefully (let user fill in manually)

**Done when**: Tap Apple Pay → open app → see pre-filled expense ready to confirm.

## Phase 6: Polish

1. Monthly summary screen with category breakdown (bar/pie chart)
2. Budget progress bars
3. Merchant autocomplete from past entries
4. Background sync via iOS Background Tasks
5. Edge cases — timezone display, currency formatting for SGD, empty states
