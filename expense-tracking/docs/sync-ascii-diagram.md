# Server ↔ iOS Sync Flow

This document explains how the Go server and the iOS client synchronize expenses, categories, and recurring expense rules.

The design is intentionally simple because this is a **single-user** expense tracker:

- The iOS app is **offline-first**.
- The server is the **source of truth**.
- The server is the **only scheduler** for recurring expenses.
- Sync is **client-initiated** over HTTP.
- Conflict resolution is **timestamp-based last-write-wins**.
- Deletes are **soft deletes** so they can propagate across devices.

---

## System overview

```text
+--------------------------------+   HTTPS  +-------------------------------+
|            iOS App             | <------> |          Go Server            |
|  SwiftUI + GRDB + local SQLite |          |  HTTP API + services + SQLite |
+--------------------------------+          +-------------------------------+
|                                |          |                               |
|  Views / ViewModels            |          |  HTTP API                     |
|      |                         |          |      |                        |
|      v                         |          |      v                        |
|  Repositories                  |          |  Services                     |
|      |                         |          |      |                        |
|      v                         |          |      v                        |
|  Local SQLite                  |          |  Server SQLite                |
|                                |          |                               |
|  SyncService                   |          |  SyncService                  |
|      |                         |          |      |                        |
|      +-------------- push / pull ----------------+                        |
|                                |          |                               |
+--------------------------------+          +-------------------------------+
```

The iOS app never needs the server for normal user interactions. It writes to local SQLite first, then syncs later when possible.

---

## Important files

### iOS

| File | Purpose |
| --- | --- |
| `ios/ExpenseTracker/Services/SyncService.swift` | Orchestrates sync: push first, then pull. Owns UI-visible sync state. |
| `ios/ExpenseTracker/Services/SyncAPIClient.swift` | Performs HTTP requests to `/api/sync/push` and `/api/sync/pull`. |
| `ios/ExpenseTracker/Services/SyncRepository.swift` | Reads pending local changes and applies server responses to GRDB. |
| `ios/ExpenseTracker/Models/Expense.swift` | Expense model, including `updatedAt`, `deletedAt`, and `syncStatus`. |
| `ios/ExpenseTracker/Models/Category.swift` | Category model, including `updatedAt`, `deletedAt`, and `syncStatus`. |
| `ios/ExpenseTracker/Models/RecurringExpense.swift` | Recurring rule model, including `nextRunDate`, `lastRunDate`, and `syncStatus`. |
| `ios/ExpenseTracker/ExpenseTrackerApp.swift` | Starts sync on app launch and when the app becomes active. |

### Server

| File | Purpose |
| --- | --- |
| `server/internal/api/sync.go` | HTTP handlers for sync endpoints. |
| `server/internal/service/sync.go` | Main server-side sync logic. |
| `server/internal/service/recurring.go` | Server-owned recurring expense materialization. |
| `server/internal/api/router.go` | Registers `/api/sync/push` and `/api/sync/pull`, with auth middleware. |
| `server/db/queries/expenses.sql` | SQL queries for expenses, including `ListExpensesUpdatedSince`. |
| `server/db/queries/categories.sql` | SQL queries for categories, including `ListCategoriesUpdatedSince`. |
| `server/db/migrations/00005_recurring_expenses.sql` | Server recurring rule and run tables. |
| `server/internal/auth/secret.go` | Shared bearer-token auth used by the iOS client. |

---

## Local writes on iOS

When the user creates, edits, or deletes an expense, category, or recurring rule, the iOS app writes to its local database first.

```text
+-------------------+      create/edit/delete      +-----------------------------+
| iOS UI/ViewModels | ---------------------------> | Local SQLite via GRDB       |
+-------------------+                              |                             |
                                                   | rows get:                   |
                                                   | - updated_at = now          |
                                                   | - sync_status=pending_push  |
                                                   | - deleted_at set on delete  |
                                                   +-----------------------------+
```

For changed rows, iOS marks: `sync_status = 'pending_push'`

This is how the sync system knows what needs to be sent to the server.

A successful sync later changes the local row to:

```text
sync_status = 'synced'
```

---

## Sync trigger points

Sync is not continuous. It runs when the iOS app asks it to run.

Current trigger points:

- App startup.
- App returns to foreground / active scene phase.
- Pull-to-refresh in the expense feed.
- User taps **Sync Now** in Settings.
- User enters or updates sync credentials.

`SyncService.sync()` coalesces concurrent calls. If a sync is already running, a second caller waits for the same sync task instead of starting another push/pull pair.

---

## Full sync sequence

```mermaid
sequenceDiagram
    participant IOS as iOS SyncService
    participant Repo as SyncRepository
    participant API as Server /api/sync
    participant Server as Server SyncService
    participant Store as Server SQLite

    IOS->>Repo: 1. Read pending local changes
    Repo-->>IOS: pending expenses, categories, and recurring_expenses

    IOS->>API: 2. POST /api/sync/push with bearer token and pending rows
    API->>Server: Push request

    Server->>Store: Begin transaction
    Server->>Store: Process categories first
    Server->>Store: Process recurring rules
    Server->>Store: Materialize due recurring rules
    Server->>Store: Process expenses
    Server->>Store: Insert missing IDs, update newer rows, soft-delete deleted rows
    Server->>Store: Commit transaction

    Server-->>API: Canonical pushed rows and server_time
    API-->>IOS: 3. 200 OK with expenses, categories, recurring_expenses, server_time
    IOS->>Repo: Apply push response
    Repo->>Repo: Update canonical fields and mark rows synced

    IOS->>API: 4. GET /api/sync/pull?since=lastPullAt with bearer token
    API->>Server: Pull request
    Server->>Store: Materialize due recurring rules
    Server->>Store: Select rows where updated_at is greater than since
    Server->>Store: Include soft-deleted rows and referenced categories

    Server-->>API: Changed server rows and server_time
    API-->>IOS: 5. 200 OK with expenses, categories, recurring_expenses, server_time
    IOS->>Repo: Apply pull response
    Repo->>Repo: Upsert categories, recurring rules, and expenses; mark rows synced
    IOS->>IOS: lastPullAt = server_time
```

The order is important: **push happens before pull**.

This lets local pending changes reach the server before the client pulls remote state back down.

---

## Recurring expenses

Recurring rules are synced, but scheduling is server-owned. iOS can create, edit, delete, and display recurring rules, but it does not generate ledger entries from them.

Server-only recurring state:

```text
recurring_expense_runs(recurring_expense_id, occurrence_date)
```

This table prevents duplicate materialization. iOS does not sync run records because generated `expenses` are enough for normal client behavior.

---

## Push: iOS → server

### iOS side

Before pushing, iOS reads rows with:

```text
sync_status = 'pending_push'
```

It sends them to:

```http
POST /api/sync/push
Authorization: Bearer <sync secret>
Content-Type: application/json
```

The request shape is:

```json
{
  "expenses": [
    {
      "id": "expense-id",
      "amount": 1250,
      "currency": "SGD",
      "category_id": "category-id",
      "description": "Lunch",
      "merchant": "Cafe",
      "date": 1714200000,
      "source": "manual",
      "updated_at": 1714200100,
      "deleted_at": null
    }
  ],
  "categories": [
    {
      "id": "category-id",
      "name": "Food & Dining",
      "icon": "fork.knife",
      "budget": 50000,
      "updated_at": 1714200100,
      "deleted_at": null
    }
  ],
  "recurring_expenses": [
    {
      "id": "recurring-id",
      "amount": 250000,
      "currency": "SGD",
      "category_id": "category-id",
      "description": "Rent",
      "merchant": "Landlord",
      "frequency": "monthly",
      "day_of_month": 1,
      "start_date": 1711929600,
      "end_date": null,
      "next_run_date": 1714521600,
      "last_run_date": null,
      "updated_at": 1714200100,
      "deleted_at": null
    }
  ]
}
```

### Server side

The server processes the push inside a transaction.

```text
+--------------------------+
| Begin transaction        |
+------------+-------------+
             |
             v
+--------------------------+
| Process categories first |
+------------+-------------+
             |
             v
+--------------------------+
| Process recurring rules  |
+------------+-------------+
             |
             v
+--------------------------+
| Materialize due rules    |
+------------+-------------+
             |
             v
+--------------------------+
| Process expenses next    |
+------------+-------------+
             |
             v
+--------------------------+
| Commit transaction       |
+--------------------------+
```

Categories are processed first because expenses and recurring rules have a foreign key to categories.

For each pushed category/expense/recurring rule:

```text
Does ID exist on server?

        +------ no ------+
        |                v
        |        Insert new row
        |
        v
       yes
        |
        v
Compare incoming updated_at with server updated_at
        |
        +-- incoming newer --> apply incoming state
        |
        +-- incoming older --> keep server state
        |
        +-- equal but different --> apply incoming state
```

The response includes the canonical server version of affected rows.

---

## Pull: server → iOS

After push, iOS pulls changed rows using its last successful pull cursor.

```http
GET /api/sync/pull?since=<lastPullAt>
Authorization: Bearer <sync secret>
```

Before querying changed rows, the server materializes due recurring rules. Any generated ledger rows are normal expenses with `source = 'recurring'`.

The server then queries:

```sql
SELECT * FROM expenses WHERE updated_at > ?;
SELECT * FROM categories WHERE updated_at > ?;
SELECT * FROM recurring_expenses WHERE updated_at > ?;
```

The response shape is:

```json
{
  "expenses": [
    {
      "id": "expense-id",
      "amount": 1250,
      "currency": "SGD",
      "category_id": "category-id",
      "description": "Lunch",
      "merchant": "Cafe",
      "date": 1714200000,
      "source": "manual",
      "created_at": 1714200000,
      "updated_at": 1714200100,
      "deleted_at": null
    }
  ],
  "categories": [
    {
      "id": "category-id",
      "name": "Food & Dining",
      "icon": "fork.knife",
      "budget": 50000,
      "created_at": 1714200000,
      "updated_at": 1714200100,
      "deleted_at": null
    }
  ],
  "recurring_expenses": [
    {
      "id": "recurring-id",
      "amount": 250000,
      "currency": "SGD",
      "category_id": "category-id",
      "description": "Rent",
      "merchant": "Landlord",
      "frequency": "monthly",
      "day_of_month": 1,
      "start_date": 1711929600,
      "end_date": null,
      "next_run_date": 1717200000,
      "last_run_date": 1714521600,
      "created_at": 1714200000,
      "updated_at": 1714521600,
      "deleted_at": null
    }
  ],
  "server_time": 1714200200
}
```

On iOS, the pull response is applied by upserting categories first, then recurring rules, then expenses:

```text
+---------------------+
| Upsert categories   |
+----------+----------+
           |
           v
+---------------------+
| Upsert recurring    |
| rules               |
+----------+----------+
           |
           v
+---------------------+
| Upsert expenses     |
+----------+----------+
           |
           v
+---------------------+
| Mark rows synced    |
+----------+----------+
           |
           v
+---------------------+
| lastPullAt =        |
| response.serverTime |
+---------------------+
```

The server includes dependency categories for pulled expenses and recurring rules. This prevents the client from receiving a row whose `category_id` points to a category not present locally.

---

## Cursor model

The pull cursor is stored on iOS in `UserDefaults` as `lastPullAt`.

```text
+-----------------------------+
| lastPullAt                  |
+-----------------------------+
| Initially 0                 |
| After successful pull:      |
|   response.server_time      |
+-----------------------------+
```

Only the pull cursor is persisted. Push uses local `sync_status` instead of a timestamp cursor.

This means:

- Rows changed locally are pushed because they are marked `pending_push`.
- Rows changed remotely are pulled because their server `updated_at` is greater than `lastPullAt`.
- Recurring materialization advances the server-side recurring rule's `updated_at`, so clients learn the new `next_run_date` and generated expense on the next pull.

---

## Conflict model

```text
                 Same row edited in two places
                           |
                           v
              +---------------------------+
              | Compare updated_at values |
              +---------------------------+
                    |                 |
          newer client          newer server / pulled row
                    |                 |
                    v                 v
          client wins on push    server wins on pull
                    \                 /
                     \               /
                      v             v
                       Last edit wins
```

More specifically:

- During push, the server accepts incoming state if the incoming `updated_at` is newer.
- If timestamps are equal but the row state differs, the server applies the incoming state.
- During pull, iOS upserts server rows directly, so server state overwrites local state.

Because this is a single-user app, this simple model is considered sufficient.

---

## Delete model

Deletes are soft deletes. Rows are not removed from the database during normal delete operations.

```text
Delete does not remove rows immediately.

+-------------+       delete       +-----------------------------+
| iOS/Server  | ----------------> | row.deleted_at = now        |
+-------------+                   | row.updated_at = now        |
                                  +-----------------------------+
                                                |
                                                v
                                  +-----------------------------+
                                  | Sync treats this as a       |
                                  | normal changed row.         |
                                  +-----------------------------+
```

Why soft deletes are needed:

```text
If rows were hard-deleted:

Device A deletes row
        |
        v
Row disappears completely
        |
        v
Device B asks, "what changed since last sync?"
        |
        v
Server has no row to return
        |
        v
Device B never learns about the delete
```

With soft deletes, the deleted row still has an `updated_at` and can be sent during sync.

Normal app queries hide soft-deleted rows by filtering:

```sql
deleted_at IS NULL
```

Sync queries include them.

---

## Authentication

All protected API routes require a shared bearer token:

```http
Authorization: Bearer <sync secret>
```

The server loads or creates this secret using `server/internal/auth/secret.go`.

The iOS app stores the secret in the keychain via `SyncSecretStore`.

```text
+-----------------------+                         +-----------------------+
| iOS Keychain          |                         | Server secret file    |
| sync secret           |                         | or env var            |
+-----------+-----------+                         +-----------+-----------+
            |                                                 |
            v                                                 v
+---------------------------------------------------------------+
| Authorization: Bearer <secret>                                |
+---------------------------------------------------------------+
```

If the secret is missing or wrong, the server returns `401 Unauthorized`.

---

## Failure behavior

```text
+----------------------+-------------------------------+
| Failure point        | Result                        |
+----------------------+-------------------------------+
| Missing server URL   | iOS reports not configured    |
| Missing secret       | iOS reports not configured    |
| Offline/network fail | iOS reports offline/failed    |
| Push fails           | local rows remain pending     |
| Pull fails           | lastPullAt is not advanced    |
| Recurring materialization fails | sync fails and retries later |
| Response decode fail | sync fails, retry later       |
+----------------------+-------------------------------+
```

Important details:

- If push fails, iOS does not mark local rows as synced.
- If pull fails, iOS does not update `lastPullAt`.
- Retrying sync is safe because server operations are keyed by stable IDs.
- `SyncService` hides intentional cancellation from the user.

---

## Observability headers

The iOS client sends request metadata with each sync request:

```http
X-Request-ID: <uuid>
X-Client-Build: <app build version>
User-Agent: ExpenseTracker/<app build version>
```

These help correlate client errors with server logs.

---

## Summary

```text
+------------------------------+
| iOS writes locally first     |
+---------------+--------------+
                |
                v
+------------------------------+
| Changed rows become          |
| sync_status = pending_push   |
+---------------+--------------+
                |
                v
+------------------------------+
| Sync pushes pending rows     |
| to server                    |
+---------------+--------------+
                |
                v
+------------------------------+
| Server stores canonical      |
| state and timestamps         |
+---------------+--------------+
                |
                v
+------------------------------+
| Server materializes due      |
| recurring rules into         |
| source=recurring expenses    |
+---------------+--------------+
                |
                v
+------------------------------+
| iOS pulls server changes     |
| since lastPullAt             |
+---------------+--------------+
                |
                v
+------------------------------+
| iOS upserts rows locally     |
| and advances lastPullAt      |
+------------------------------+
```

In one sentence: **the iOS app works offline, marks local changes as pending, pushes them to the server, the server materializes recurring expenses, and iOS pulls the canonical result back down.**
