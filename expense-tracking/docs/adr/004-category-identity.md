# ADR 004: Category Identity Is Its UUID

## Status

Accepted (2026-05-07)

## Context

`SyncService.tryReconcileCategoryByName` performs a "splice" when a client
pushes a category whose ID does not exist on the server but whose name
matches an existing server row:

1. `ReassignExpensesCategory` rewrites all expenses pointing at the existing
   server-side category UUID to point at the client-supplied UUID.
2. `ReconcileCategoryByName` mutates the existing row's primary key from the
   server UUID to the client UUID and overwrites its other fields with the
   client's payload.

The triggering scenario is "fresh app install with new local UUIDs pushes a
category that matches an existing server row by name."

This splice has three sharp edges:

- It silently overwrites the server's `icon`, `budget`, and `deleted_at`
  with the client's values **regardless of timestamps**, bypassing LWW.
- It mutates primary keys. Other clients that already synced have the old
  UUID cached locally and reference it from local expenses. After the splice
  their local foreign keys are broken.
- It only fires when the client-supplied ID lookup misses, so whether you
  get LWW or this splice depends on whether the client happens to know the
  server's ID — which under the offline-first model is often "no."

The unique index `idx_categories_name_active` (active categories, by name)
already prevents two active categories with the same name at the DB level,
so without the splice a duplicate insert would surface as a constraint error.

## Decision

### Categories are identified by their UUID. Period.

- Remove `tryReconcileCategoryByName` and the related queries
  (`ReconcileCategoryByName`, `ReassignExpensesCategory`,
  `GetCategoryByName` — keep the last only if some other read path needs it).
- The push path for categories goes through `ApplyLWW` only.

### Shared default categories use deterministic UUIDs

- Default categories ("Food", "Transport", "Rent", etc.) are seeded on both
  the server and the iOS client with **deterministic UUIDs** (e.g., a fixed
  table of `name -> UUID` literals, or UUIDv5 with a project-specific
  namespace and the canonical name as the input).
- Both clients independently generate the same UUID for the same default
  category, so no collision occurs by construction.
- User-created categories continue to use random UUIDs and are unique per
  device.

### Duplicate user-created names are accepted

- If two devices independently create a category named "Snacks" (with
  different random UUIDs), they remain two distinct categories.
- This is consistent with most expense-tracking apps. If users want them
  merged, a future "merge categories" UX action can do so explicitly.
- The active-name unique index is removed (or converted to a non-unique
  index), since duplicate names across devices are now valid.

## Consequences

- Sync of categories becomes uniform with sync of expenses: ID is canonical,
  conflict resolution is LWW, no special pre-step.
- Fresh installs receive default categories from the server (or initialize
  them locally using the same deterministic UUIDs) and never collide.
- The pathological "lost budget on fresh install" case described above
  cannot happen.

## Tradeoffs

- A client that pre-dates this ADR and was created with random UUIDs for
  default categories must be migrated. Either rewrite local UUIDs at
  upgrade time, or accept duplicate "Food" categories until the user merges
  them. **For the personal app today this is moot — there is one user and
  one device per platform; reset is acceptable.**
- The server cannot deduplicate by name. Two users on a future shared
  household budget will see two "Snacks" categories until they merge.
