# ADR 003: Sync Pull Is Read-Only

## Status

Accepted (2026-05-07)

## Context

`SyncService.Pull` today does five things:

1. Calls `materializeDueRecurringExpenses`, which **writes** new expenses and
   updates `last_run_date` on recurring expenses.
2. Reads expenses updated since the cursor.
3. Reads categories updated since the cursor.
4. Reads recurring expenses updated since the cursor.
5. Loops over dependency categories with `GetCategoryIncludingDeleted` to
   satisfy client-side foreign keys.

None of this is wrapped in a transaction.

Two distinct problems:

- **Pull mutates the database.** A `GET /api/sync/pull` is not idempotent in
  the HTTP sense. Two concurrent pulls race on the materializer. Polling
  clients perform writes.
- **Pull is not a consistent snapshot.** Each query sees the database at its
  own instant. A concurrent `Push` between queries 2 and 3 can return an
  expense without its category, or advance the cursor (`time.Now().Unix()`
  sampled at the end) past rows written during the read window.

The original design rationale for materialization-in-Pull was **laziness**:
recurring expenses should be materialized only when a real user is actively
syncing, not on a server timer for inactive users.

## Decision

### Pull becomes a true read

- `Pull` runs inside a SQLite read-only transaction (`BEGIN DEFERRED`).
- All reads inside `Pull` see one consistent snapshot.
- The cursor (`server_version` per ADR 001) is sampled inside the
  transaction, before the queries.
- `Pull` performs no writes.

### Materialization moves to Push

- `materializeDueRecurringExpenses` is removed from `Pull`.
- `Push` is the only entry point that runs the materializer (it already does;
  the change is to remove the duplicate call in `Pull`).
- The materializer continues to run inside the existing `Push` transaction.

### Client convention: Push-then-Pull

- The iOS client always performs `Push` before `Pull` on every sync cycle,
  even when the local push body is empty (`{}`).
- An empty Push is a valid "ping" that says "materialize anything due, then I
  will Pull."
- Laziness is preserved: only real client syncs trigger materialization.

## Consequences

- `Pull` becomes a pure read; safe to call repeatedly, safe to cache, no
  write-write contention with concurrent pulls.
- A client that only Pulls (never Pushes) will not see freshly materialized
  recurring expenses. **Today no such "view-only" session exists; if it ever
  does, add a dedicated `POST /api/sync/refresh` endpoint whose only job is to
  run the materializer.**
- Dependency-loading inside the read transaction is consistent: a category
  fetched on behalf of a referenced expense is guaranteed to exist as of the
  same snapshot.

## Tradeoffs

- One extra implicit assumption (clients always Push-before-Pull) is now
  load-bearing. It must be honored by every client implementation. Document
  it in the iOS sync code and in the API contract.
- Materializer does not fire on a timer, so a long-dormant user opening the
  app for the first time in months still must Push (even an empty one) before
  they see catch-up materializations.
