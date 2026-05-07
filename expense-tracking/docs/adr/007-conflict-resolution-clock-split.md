# ADR 007: Conflict-Resolution Clock Split

## Status

Accepted (2026-05-07). Depends on ADR 001.

## Context

The current `updated_at` column on every syncable table is asked to encode
two unrelated facts:

1. *When the user made the edit* (used by `ApplyLWW` for conflict resolution).
2. *When the server received the write* (historically used as the pull
   cursor; replaced by `server_version` in ADR 001).

Worse, the current code's hybrid behavior is internally inconsistent:

- `ApplyLWW` compares `incoming.GetUpdatedAt()` (the **client's** claimed
  timestamp from the push payload) against `existing.UpdatedAt` (the
  **server's** `now()` from the previous push, since all hooks write
  `UpdatedAt: now`).
- The client's value is used to decide the comparison, then thrown away.

Consequence: every comparison after the first push is apples-to-oranges
(client clock vs. server clock). A client edit at 10:00 (client wall clock)
that arrives after a server-side write stamped at 17:00 (server wall clock)
loses, even if the edit is genuinely newer than the prior server-side
write — the "winner" is determined by upload order, not edit order.

Two pure alternatives were considered:

- **Server-only `updated_at`**: collapses LWW into "last-to-sync wins,"
  which actively penalizes clients with better connectivity. Rejected for
  an offline-first app.
- **Client-only `updated_at`**: honest LWW, but a client with a wrong
  clock can permanently overwrite everyone else's edits.

## Decision

Add a dedicated `client_updated_at` column to every syncable table. Keep
the existing `updated_at` column **only** for display/audit purposes
("when did the server receive this") — it is no longer load-bearing for
either conflict resolution or the pull cursor.

### Schema

For each syncable table (`expenses`, `categories`, `recurring_expenses`):

```sql
ALTER TABLE expenses ADD COLUMN client_updated_at INTEGER NOT NULL DEFAULT 0;
-- Backfill from existing updated_at:
UPDATE expenses SET client_updated_at = updated_at;
CREATE INDEX idx_expenses_client_updated_at ON expenses(client_updated_at);
```

Repeat for `categories` and `recurring_expenses`.

### Push payload

`PushExpense.UpdatedAt` (and the other `Push*` types) is renamed
`ClientUpdatedAt` to make its origin explicit.

### `ApplyLWW`

`LWWInput.GetUpdatedAt()` is replaced by `GetClientUpdatedAt()`. The
comparison becomes:

```go
incomingTs := incoming.GetClientUpdatedAt()
existingTs := hooks.ExistingClientUpdatedAt(existing)
```

Both sides are client clocks → apples-to-apples → LWW means what it says.

### Writes

On Create/Update/SoftDelete, the hook writes `client_updated_at` from the
incoming push payload (the client's claimed value). The server-stamped
`updated_at` continues to be set to `now` for audit purposes.

### Recurring-expense materializer

The materializer runs on the server and has no client. When it materializes
a due recurring expense into a new `expenses` row, it sets
`client_updated_at = now` (server time). This is acceptable because:

- A materialized expense did not originate from a client edit; there is no
  "client clock" to honor.
- If a client subsequently edits the materialized expense, the client's
  new `client_updated_at` will (in normal operation) be later than the
  server's materialization time, and LWW resolves correctly.

## Consequences

- Conflict resolution is honest: the client whose user edited the row most
  recently (by their own clock) wins.
- A client with a badly skewed clock can still misbehave, but the failure
  mode is local to that client and visible in the data
  (`client_updated_at` will be conspicuously off). It can no longer be
  silently masked by server-side stamping.
- The pull cursor (`server_version`, ADR 001) and conflict resolution
  (`client_updated_at`, this ADR) are fully decoupled.
- The legacy `updated_at` column lingers for display. It can be dropped
  in a future migration if no consumer needs it.

## Tradeoffs

- Extra column per syncable table. Trivial storage cost.
- Materializer-written rows use server time as a stand-in for client
  time. This is a minor semantic compromise; the alternative (a separate
  "synthetic origin" flag) is more machinery for no real benefit.
- The migration must run before any client code starts sending the new
  payload field. Coordinate the ADR 001 migration and this one if both
  ship together; otherwise keep them sequential.
