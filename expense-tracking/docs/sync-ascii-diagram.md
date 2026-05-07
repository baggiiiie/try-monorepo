# Server ↔ iOS Sync Flow

This document describes the current sync contract between the Go server and the iOS client.

## Core rules

- iOS is **offline-first** and writes locally first.
- The server is the **source of truth**.
- Every sync cycle is **Push, then Pull**.
- **Empty Push is valid** and required: it asks the server to materialize due recurring expenses before Pull.
- `Pull` is a **read-only**, snapshot-consistent operation.
- The pull cursor is **`server_version`**, not a timestamp.
- Conflict resolution for pushed rows is still **last-write-wins on `updated_at`**.
- Deletes are **soft deletes**.

---

## System overview

```text
+--------------------------------+   HTTPS  +-------------------------------+
|            iOS App             | <------> |          Go Server            |
|  SwiftUI + GRDB + local SQLite |          |  HTTP API + services + SQLite |
+--------------------------------+          +-------------------------------+
|                                |          |                               |
|  Local SQLite                  |          |  Server SQLite                |
|      ^                         |          |      ^                        |
|      |                         |          |      |                        |
|  SyncRepository                |          |  SyncService                  |
|      ^                         |          |      ^                        |
|      |                         |          |      |                        |
|  SyncService                   |          |  /api/sync/push + pull        |
|                                |          |                               |
+--------------------------------+          +-------------------------------+
```

---

## Important files

### iOS

| File | Purpose |
| --- | --- |
| `ios/ExpenseTracker/Services/SyncService.swift` | Orchestrates sync and enforces push-then-pull. |
| `ios/ExpenseTracker/Services/SyncAPIClient.swift` | Performs HTTP requests to `/api/sync/push` and `/api/sync/pull`. |
| `ios/ExpenseTracker/Services/SyncRepository.swift` | Reads pending local changes and applies server responses to GRDB. |
| `ios/ExpenseTracker/Models/Preferences.swift` | Stores `lastPulledVersion` in `UserDefaults`. |

### Server

| File | Purpose |
| --- | --- |
| `server/internal/service/sync.go` | Main push/pull implementation. |
| `server/internal/service/recurring.go` | Due recurring-expense materialization. |
| `server/internal/repository/store.go` | SQLite transaction helpers, including read-only pull snapshots. |
| `server/db/queries/*.sql` | sqlc queries for syncable rows and `sync_state.current_version`. |

---

## Local writes on iOS

When the user changes an expense, category, or recurring rule, iOS writes to local SQLite first.

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

Rows waiting to be uploaded are marked:

```text
sync_status = 'pending_push'
```

---

## Sync trigger points

Sync runs when the app asks for it:

- app startup
- app returns to foreground
- pull-to-refresh
- user taps **Sync Now**
- sync configuration changes

`SyncService.sync()` coalesces concurrent callers so only one sync cycle runs at a time.

---

## Full sync sequence

```mermaid
sequenceDiagram
    participant IOS as iOS SyncService
    participant Repo as iOS SyncRepository
    participant API as Server API
    participant Server as Server SyncService
    participant Store as Server SQLite

    IOS->>Repo: 1. Read pending local changes
    Repo-->>IOS: pending rows

    IOS->>API: 2. POST /api/sync/push (may be empty)
    API->>Server: Push request
    Server->>Store: BEGIN IMMEDIATE
    Server->>Store: Process categories
    Server->>Store: Process recurring rules
    Server->>Store: Materialize due recurring expenses
    Server->>Store: Process expenses
    Server->>Store: COMMIT
    Server-->>API: pushed rows + server_version
    API-->>IOS: push response
    IOS->>Repo: apply push response; mark rows synced

    IOS->>API: 3. GET /api/sync/pull?since=lastPulledVersion
    API->>Server: Pull request
    Server->>Store: BEGIN DEFERRED + query_only=ON
    Server->>Store: Read current server_version inside snapshot
    Server->>Store: Read rows where server_version > since
    Server->>Store: Load dependency categories in same snapshot
    Server->>Store: COMMIT
    Server-->>API: changed rows + server_version
    API-->>IOS: pull response
    IOS->>Repo: apply pull response
    IOS->>IOS: lastPulledVersion = response.serverVersion
```

---

## Push: iOS → server

iOS always sends a push request, even if there are no pending local rows.

```http
POST /api/sync/push
Authorization: Bearer <sync secret>
Content-Type: application/json
```

Why empty push matters:

```text
empty push
    |
    v
server materializes due recurring expenses inside Push
    |
    v
following Pull can stay read-only
```

Push order on the server:

```text
+--------------------------+
| Begin write transaction  |
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

Conflict rule during Push:

```text
compare incoming updated_at with server updated_at
        |
        +-- incoming newer --> apply incoming state
        |
        +-- incoming older --> keep server state
        |
        +-- equal but different --> apply incoming state
```

The push response returns canonical server rows plus the latest `server_version`.

---

## Pull: server → iOS

After Push, iOS pulls by `server_version`:

```http
GET /api/sync/pull?since=<lastPulledVersion>
Authorization: Bearer <sync secret>
```

`Pull` is a true read:

- it runs inside a SQLite **read-only transaction**
- the transaction uses one consistent snapshot
- `server_version` is sampled **inside** that snapshot before row queries
- `Pull` performs **no writes**

Server-side query model:

```sql
SELECT * FROM expenses WHERE server_version > ?;
SELECT * FROM categories WHERE server_version > ?;
SELECT * FROM recurring_expenses WHERE server_version > ?;
SELECT current_version FROM sync_state WHERE id = 1;
```

The server also includes dependency categories for any pulled expenses or recurring rules whose category did not itself change after `since`.

Response shape:

```json
{
  "expenses": [],
  "categories": [],
  "recurring_expenses": [],
  "server_version": 123
}
```

On iOS, apply order is:

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
| lastPulledVersion = |
| response.serverVersion |
+---------------------+
```

---

## Cursor model

The pull cursor stored on iOS is `lastPulledVersion`.

```text
+-----------------------------+
| lastPulledVersion           |
+-----------------------------+
| Initially 0                 |
| After successful pull:      |
|   response.server_version   |
+-----------------------------+
```

This means:

- local changes are pushed because they are `pending_push`
- remote changes are pulled because their `server_version` is greater than the last successful pull cursor
- recurring materialization becomes visible after the push that triggers it, followed by pull

---

## Recurring expenses

Recurring rules sync like normal entities, but only the server materializes them into ledger expenses.

iOS can:
- create recurring rules
- edit recurring rules
- delete recurring rules
- display recurring rules

The server alone can:
- decide what is due
- create `source = 'recurring'` expenses
- advance `last_run_date` and `next_run_date`

A client that only Pulls and never Pushes will not see newly materialized recurring expenses. The current contract intentionally relies on push-then-pull instead.

---

## Delete model

Deletes are soft deletes:

```text
row.deleted_at = now
row.updated_at = now
```

The row stays syncable, so other devices can learn about the delete.

---

## Failure behavior

```text
+----------------------+-------------------------------------------+
| Failure point        | Result                                    |
+----------------------+-------------------------------------------+
| Missing server URL   | iOS reports not configured                |
| Missing secret       | iOS reports not configured                |
| Offline/network fail | local rows remain unchanged               |
| Push fails           | local rows stay pending_push              |
| Pull fails           | lastPulledVersion is not advanced         |
| Materialization fail | push fails; retry on next sync            |
| Decode fail          | sync fails; retry later                   |
+----------------------+-------------------------------------------+
```

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
| iOS always pushes first      |
| even if the body is empty    |
+---------------+--------------+
                |
                v
+------------------------------+
| Server materializes due      |
| recurring expenses in Push   |
+---------------+--------------+
                |
                v
+------------------------------+
| iOS pulls by server_version  |
| from a read-only snapshot    |
+---------------+--------------+
                |
                v
+------------------------------+
| iOS upserts rows locally     |
| and advances lastPulledVersion |
+------------------------------+
```

In one sentence: **the iOS app works offline, pushes pending changes (or an empty ping), the server materializes due recurring expenses during Push, and iOS then pulls a read-only `server_version` delta back down.**
