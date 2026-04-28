# SQLite Table Shape

Conventions:

- IDs are client-minted `TEXT` IDs and are the sync identity across iOS and server.
- Monetary amounts are integer minor units, e.g. cents.
- Timestamps are Unix seconds stored as `INTEGER`.
- Deletes are soft deletes via nullable `deleted_at`.
- iOS-only `sync_status` tracks local push state and is not stored on the server.

---

## Shared sync tables

These tables exist on both iOS and server, with the same synced columns.

### `categories`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | Client-minted category ID. |
| `name` | `TEXT NOT NULL` | Display name. |
| `icon` | `TEXT NOT NULL DEFAULT ''` | SF Symbol / icon name. |
| `budget` | `INTEGER NULL` | Optional budget in minor units. |
| `created_at` | `INTEGER NOT NULL` | Unix seconds. |
| `updated_at` | `INTEGER NOT NULL` | Unix seconds; sync conflict cursor. |
| `deleted_at` | `INTEGER NULL` | Soft-delete timestamp. |
| `sync_status` | `TEXT NOT NULL` | iOS only: `pending_push` or `synced`. |

Server indexes:

- `idx_categories_updated_at(updated_at)`
- `idx_categories_name_active(name) WHERE deleted_at IS NULL` unique

### `expenses`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | Client/server-minted expense ID. |
| `amount` | `INTEGER NOT NULL` | Minor units. |
| `currency` | `TEXT NOT NULL` | Currency code, e.g. `SGD`. |
| `category_id` | `TEXT NOT NULL` | FK to `categories(id)`. |
| `description` | `TEXT NOT NULL DEFAULT ''` | User-entered description. |
| `merchant` | `TEXT NOT NULL DEFAULT ''` | Merchant/payee. |
| `date` | `INTEGER NOT NULL` | Expense date as Unix seconds. |
| `source` | `TEXT NOT NULL` | `manual`, `wallet`, `recurring`, etc. |
| `created_at` | `INTEGER NOT NULL` | Unix seconds. |
| `updated_at` | `INTEGER NOT NULL` | Unix seconds; sync conflict cursor. |
| `deleted_at` | `INTEGER NULL` | Soft-delete timestamp. |
| `sync_status` | `TEXT NOT NULL` | iOS only: `pending_push` or `synced`. |

Server indexes:

- `idx_expenses_category_id(category_id)`
- `idx_expenses_updated_at(updated_at)`
- `idx_expenses_date(date)`

### `recurring_expenses`

Recurring rules are synced, but materialization is server-owned. On sync, the server looks for active rows where `next_run_date <= today`, creates the due `expenses` rows, then advances `next_run_date` to the next scheduled occurrence.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | Client-minted recurring rule ID. |
| `amount` | `INTEGER NOT NULL` | Minor units for generated expenses. |
| `currency` | `TEXT NOT NULL` | Currency code. |
| `category_id` | `TEXT NOT NULL` | FK to `categories(id)`. |
| `description` | `TEXT NOT NULL DEFAULT ''` | Copied to generated expenses. |
| `merchant` | `TEXT NOT NULL DEFAULT ''` | Copied to generated expenses. |
| `frequency` | `TEXT NOT NULL` | `weekly`, `monthly`, or `yearly`. |
| `day_of_month` | `INTEGER NULL` | Monthly/yearly target day when applicable. |
| `start_date` | `INTEGER NOT NULL` | First eligible run date. |
| `end_date` | `INTEGER NULL` | Optional final run date. |
| `next_run_date` | `INTEGER NOT NULL` | Server scheduling cursor. |
| `last_run_date` | `INTEGER NULL` | Last materialized occurrence. |
| `created_at` | `INTEGER NOT NULL` | Unix seconds. |
| `updated_at` | `INTEGER NOT NULL` | Unix seconds; sync conflict cursor. |
| `deleted_at` | `INTEGER NULL` | Soft-delete timestamp. |
| `sync_status` | `TEXT NOT NULL` | iOS only: `pending_push` or `synced`. |

Server indexes:

- `idx_recurring_expenses_updated_at(updated_at)`
- `idx_recurring_expenses_category_id(category_id)`
- `idx_recurring_expenses_due(next_run_date) WHERE deleted_at IS NULL`

---

## Server-only tables

### `recurring_expense_runs`

Tracks which recurring occurrences have already been materialized. This is intentionally server-only; iOS receives the generated `expenses` rows instead.

`recurring_expenses.next_run_date` drives what is due; this table is the idempotency/audit record. 

Without this table, the app technically works fine in normal conditions, but it's kept in the server, to prevents duplicate generations:
- if sync retries,
- if two syncs race,
- or if the server creates an expense but fails before advancing `next_run_date`.

TODO: im not sure if the above reasons are actually valid if we implemented atomic transactions properly


| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | Deterministic run ID. |
| `recurring_expense_id` | `TEXT NOT NULL` | FK to `recurring_expenses(id)`. |
| `expense_id` | `TEXT NOT NULL` | FK to generated `expenses(id)`. |
| `occurrence_date` | `INTEGER NOT NULL` | Scheduled occurrence date. |
| `created_at` | `INTEGER NOT NULL` | Unix seconds. |

Server indexes:

- `idx_recurring_expense_runs_unique_occurrence(recurring_expense_id, occurrence_date)` unique

---

## iOS-only tables

### `wallet_suggestions`

Local staging table for Apple Pay / Wallet import suggestions. Suggestions are reviewed locally and can be converted into normal synced `expenses`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | Local suggestion ID. |
| `financekit_tx_id` | `TEXT NULL` | Optional source transaction ID. |
| `amount` | `INTEGER NULL` | Minor units if known. |
| `currency` | `TEXT NOT NULL DEFAULT 'SGD'` | Currency code. |
| `merchant` | `TEXT NOT NULL` | Suggested merchant. |
| `date` | `INTEGER NOT NULL` | Transaction date. |
| `source` | `TEXT NOT NULL` | Suggestion source. |
| `status` | `TEXT NOT NULL DEFAULT 'pending'` | Review state. |
| `linked_expense_id` | `TEXT NULL` | Soft reference to confirmed expense. |
| `created_at` | `INTEGER NOT NULL` | Unix seconds. |
| `card_name` | `TEXT NULL` | Optional card label. |
| `transaction_name` | `TEXT NULL` | Optional transaction label. |

---

## Main shape differences

| Area | iOS | Server |
| --- | --- | --- |
| Sync tracking | Has `sync_status` on synced tables. | Uses `updated_at` and soft deletes only. |
| Wallet suggestions | Local-only staging table. | Not stored. |
| Recurring runs | Not stored after current migrations. | Stored in `recurring_expense_runs`. |
| Recurring scheduling | Displays/edits rules only. | Owns materialization and advances run cursors. |
