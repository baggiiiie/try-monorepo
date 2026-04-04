# Sync Strategy

## Goals

- iOS app works fully offline — all reads and writes happen against the local DB.
- When connectivity is available, local changes are pushed to the server and remote changes are pulled.
- Sync should be simple and correct. We optimize for a single-user system.

## Approach: Timestamp-Based Sync

Since this is a single-user app, we use a simple timestamp-based sync with the server as the source of truth.

### Push (Client → Server)

The client sends all records with `updated_at` greater than the last successful push timestamp.

```
POST /api/sync/push
{
  "expenses": [ ... ],
  "categories": [ ... ]
}
```

The server processes each record:

1. If `client_id` doesn't exist on server → insert (assign server `id`).
2. If `client_id` exists → update if client's `updated_at` is newer.
3. Return the canonical server state of all affected records (with server IDs and timestamps).

The client updates its local records with the server-assigned IDs and timestamps.

### Pull (Server → Client)

The client requests all records modified since the last successful pull.

```
GET /api/sync/pull?since=2025-01-15T10:30:00Z
```

The server returns all records (including soft-deleted ones) with `updated_at` after the given timestamp. The client upserts these into its local DB.

### Sync Flow

```
1. Push local changes → server
2. Server responds with canonical state of pushed records
3. Client updates local records with server state
4. Pull remote changes since last sync
5. Client upserts pulled records into local DB
6. Update last sync timestamp
```

Push happens before pull. This ensures the server has the latest client state before the client pulls, avoiding unnecessary conflicts.

## Conflict Resolution

Since this is single-user, true conflicts are rare. They can happen if the user edits the same record on the phone and via CLI before syncing. Resolution:

- **Server wins on pull**: When pulling, server data overwrites local data.
- **Client wins on push**: When pushing, newer `updated_at` wins. Since push happens first, the client's latest edits reach the server before pull overwrites local state.
- **Net effect**: The last edit wins, regardless of which device it was made on.

## Handling Deletes

Soft deletes are essential. When a record is deleted:

1. `deleted_at` is set, `updated_at` is bumped.
2. The record syncs normally (it's just an update).
3. The receiving side sees `deleted_at` is set and marks its local copy as deleted.
4. Soft-deleted records are excluded from normal queries but still participate in sync.

## Failure Handling

- **Push fails**: No local state changes. Retry on next sync.
- **Push succeeds, response lost**: The client retries the push. The server uses `client_id` to detect the duplicate and returns the existing record.
- **Pull fails**: No local state changes. Retry on next sync.
- **Partial sync**: Push and pull are independent operations. If push succeeds but pull fails, the push timestamp is updated but the pull timestamp is not. Next sync will skip the push (nothing new) and retry the pull.
