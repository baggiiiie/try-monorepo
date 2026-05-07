# ADR 001: Server Version Sync Cursor Proposal

## Status

Accepted (2026-05-07). Conflict-resolution split deferred to ADR 007.

## Context

The current sync cursor is timestamp-based:

- iOS stores `lastPullAt` in `UserDefaults`.
- Pull requests call `GET /api/sync/pull?since=<lastPullAt>`.
- The server returns rows where `updated_at > since`.
- After a successful pull, iOS stores `response.server_time` as the next `lastPullAt`.

This works today because accepted server writes are stamped with server time. For example, if a client creates an expense locally at 10:00 but pushes it at 22:00, the server stores the row with `updated_at = 22:00`, so other clients with a 16:00 pull cursor can still receive it.

However, the current model gives `updated_at` two meanings:

1. Local edit/conflict timestamp before a pending push.
2. Server replication timestamp after push/pull reconciliation.

It also relies on Unix-second timestamps and strict `updated_at > since` queries, which can have same-second edge cases.

## Proposal

Replace the timestamp pull cursor with a global monotonic `server_version`.

There are two related concepts:

1. A global server counter, for example `sync_state.current_version`.
2. A per-row `server_version` stamp on each synced row.

The `server_version` is global, not per table. Synced tables would store the version at which each row last changed:

- `expenses.server_version`
- `categories.server_version`
- `recurring_expenses.server_version`

The client would store:

- `lastPulledVersion`

Pull would become:

```sql
SELECT * FROM expenses WHERE server_version > ?;
SELECT * FROM categories WHERE server_version > ?;
SELECT * FROM recurring_expenses WHERE server_version > ?;
```

The response would include the latest committed server version:

```json
{
  "expenses": [],
  "categories": [],
  "recurring_expenses": [],
  "server_version": 123
}
```

After successfully applying the response, iOS would store:

```text
lastPulledVersion = response.server_version
```

## Example

Initial server state:

```text
current_server_version = 0
```

A category is created:

```text
current_server_version = 1
CategoryFood.server_version = 1
```

An expense is created:

```text
current_server_version = 2
ExpenseLunch.server_version = 2
```

A client whose `lastPulledVersion` is `1` pulls:

```sql
WHERE server_version > 1
```

It receives `ExpenseLunch`, then stores:

```text
lastPulledVersion = 2
```

## Conflict Resolution

`server_version` is not a conflict-resolution timestamp.

It only answers:

> Has this server row changed since the client's last successful pull?

Conflict resolution should remain separate. Options:

- Keep the current LWW behavior temporarily.
- Or split timestamps more explicitly with `client_updated_at` for client/user edit time and `server_version` for replication.

A cleaner future model would be:

```text
client_updated_at  // local/user edit time; used for LWW/conflicts
server_version     // server-assigned replication cursor
sync_status        // local pending/synced state
```

## Migration Plan

1. Add a server database migration:
   - Create `sync_state` with `current_version`.
   - Add `server_version` columns to synced tables.
2. Backfill existing rows with initial versions.
3. Update sqlc queries to pull by `server_version > ?`.
4. Update server push paths to increment the global version and stamp changed rows.
5. Update pull response to return `server_version` instead of or alongside `server_time`.
6. Update iOS preferences from `lastPullAt` to `lastPulledVersion`.
7. Update iOS API models and sync service to use version cursors.
8. Keep old timestamp fields for display/conflict purposes, or explicitly rename/split them later.

## Tradeoffs

Pros:

- Avoids client/server clock skew.
- Avoids timezone concerns.
- Avoids same-second timestamp cursor bugs.
- Gives a clearer sync invariant.
- Makes pull cursor logic easier to audit.

Cons:

- Requires schema migrations.
- Requires API changes.
- Adds server-side bookkeeping.
- Does not by itself solve conflict resolution; that remains separate.

## Decision Notes

For the current personal app, the timestamp cursor is workable. If sync becomes more important or multi-device usage increases, `server_version` is the preferred direction because it separates replication ordering from edit/conflict timestamps.

## Decision (2026-05-07)

Accepted as the design direction. The trigger for promotion was a re-derivation
of the same-second cursor-skip bug from first principles, plus the observation
that the current code's hybrid behavior (compare-with-client-clock,
store-with-server-clock) makes every comparison an apples-to-oranges mix after
the first push.

This ADR is scoped to the **replication cursor only**:

- `sync_state.current_version` (global counter).
- Per-row `server_version` columns on every syncable table.
- Pull cursor becomes `WHERE server_version > ?`; response carries
  `server_version` instead of `server_time`.

The conflict-resolution clock split (`client_updated_at`) is split out into
ADR 007 so the two changes can ship independently.
