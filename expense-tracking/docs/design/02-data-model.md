# Data Model

## Core Entities

### Expense

The central entity. Represents a single spending event.

| Field        | Type     | Description                                              |
| ------------ | -------- | -------------------------------------------------------- |
| id           | UUID     | Server-assigned canonical ID                             |
| client_id    | UUID     | Client-generated ID (used for deduplication during sync) |
| amount       | integer  | Amount in cents (avoids floating point issues)           |
| currency     | text     | ISO 4217 currency code (e.g., "USD", "CAD")             |
| category_id  | UUID     | FK to Category                                           |
| description  | text     | Free-text note                                           |
| merchant     | text     | Where the money was spent                                |
| date         | date     | When the expense occurred (user-facing date)             |
| source       | text     | How this entry was created: "manual", "financekit", "shortcut", "cli"|
| created_at   | datetime | When the record was created                              |
| updated_at   | datetime | Last modification time (used for sync)                   |
| deleted_at   | datetime | Soft delete timestamp (nullable)                         |

### Category

User-defined spending categories.

| Field      | Type     | Description                          |
| ---------- | -------- | ------------------------------------ |
| id         | UUID     | Server-assigned canonical ID         |
| client_id  | UUID     | Client-generated ID                  |
| name       | text     | Display name (e.g., "Groceries")     |
| icon       | text     | Emoji or SF Symbol name              |
| budget     | integer  | Optional monthly budget in cents     |
| created_at | datetime |                                      |
| updated_at | datetime |                                      |
| deleted_at | datetime | Soft delete                          |

### WalletSuggestion (iOS local only)

Transactions detected via FinanceKit or iOS Shortcuts automation that the user hasn't acted on yet. These live only on the iOS device — they are never synced to the server. Once the user accepts a suggestion, it becomes an Expense and syncs normally.

| Field              | Type     | Description                                                    |
| ------------------ | -------- | -------------------------------------------------------------- |
| id                 | UUID     | Local ID                                                       |
| financekit_tx_id   | text?    | FinanceKit transaction identifier (nullable; only for FinanceKit entries) |
| amount             | integer? | Amount in cents (nullable; Shortcuts may report 0)             |
| currency           | text     | ISO 4217                                                       |
| merchant           | text     | Merchant name from FinanceKit or Shortcuts                     |
| date               | date     | Transaction date                                               |
| source             | text     | Where this suggestion came from: "financekit", "shortcut"      |
| status             | text     | "pending", "accepted", "dismissed"                             |
| linked_expense_id  | UUID     | FK to Expense (set when accepted)                              |
| created_at         | datetime |                                                                |

## Design Notes

- **Amounts in cents**: All monetary values are stored as integers in the smallest currency unit. $12.50 → 1250. This avoids floating-point rounding issues.
- **Soft deletes**: Records are never physically deleted. `deleted_at` is set instead. This is critical for sync — the client needs to know that a record was deleted on the server.
- **client_id for deduplication**: The client generates a UUID before syncing. The server uses this to detect duplicate submissions (e.g., if the sync request succeeds but the client doesn't get the response).
- **WalletSuggestion is local-only**: Raw financial data from FinanceKit stays on the device. Only user-confirmed expenses leave the device. This is both a privacy decision and a simplicity decision.
