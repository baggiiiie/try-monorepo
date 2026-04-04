# iOS App Design

## Principles

- **Offline-first**: The app is fully functional without internet. All data lives locally.
- **Minimal friction**: Adding an expense should take as few taps as possible.
- **Privacy-respecting**: Raw financial data from FinanceKit stays on-device. Only user-confirmed expenses sync to the server.

## Core Screens

### 1. Expense Feed (Home)

The main screen. A chronological list of expenses, grouped by day.

- Pull-to-refresh triggers a sync.
- Floating "+" button to add a new expense.
- If there are pending wallet suggestions, a banner appears at the top: _"3 new transactions detected — Review"_.

### 2. Add/Edit Expense

A form with:

- Amount (numeric keypad, large input)
- Category (horizontal scrollable chips)
- Merchant (text field with autocomplete from past entries)
- Date (defaults to today)
- Description (optional)

When opened from a wallet suggestion, the amount, merchant, and date are pre-filled.

### 3. Wallet Suggestions

A list of FinanceKit-detected transactions that haven't been added yet.

Each item shows:

- Merchant name, amount, date
- Two actions: **Add** (opens Add Expense pre-filled) or **Dismiss**

Dismissed suggestions are hidden but stored locally (to avoid re-suggesting).

### 4. Summary / Budget

- Monthly spending breakdown by category (bar chart or pie chart).
- Budget progress bars for categories with budgets set.
- Comparison to previous month.

### 5. Categories

Manage categories — add, edit, reorder, set budgets.

### 6. Settings

- Server URL configuration
- Sync status and last sync time
- Manual sync trigger
- FinanceKit permissions management
- Apple Pay automation setup guide

## Transaction Detection

The app supports two mechanisms for automatically detecting transactions and surfacing them as wallet suggestions. Both feed into the same `WalletSuggestion` → user review → `Expense` flow.

### Primary: iOS Shortcuts Transaction Automation

See [06-apple-pay-automation.md](06-apple-pay-automation.md) for full details.

The app exposes an `ImportTransactionIntent` (via the App Intents framework) that the user wires up to an iOS Shortcuts "Transaction" automation. When they tap Apple Pay, the shortcut fires immediately in the background and passes the **merchant name** and **amount** to the app, which stores a pending `WalletSuggestion`.

This approach:
- Works with **any card** in Apple Wallet (not limited to Apple Card/Cash).
- Requires no entitlement from Apple.
- Requires a one-time user setup in the Shortcuts app (the app guides them through it in Settings).
- Has a known limitation: the amount may come through as 0 for some card issuers.

### Secondary: FinanceKit (Future)

FinanceKit could provide richer data (full transaction history, merchant category codes, etc.) but requires a managed entitlement, organization developer account, and App Store distribution.

If we later obtain the entitlement, the existing `WalletSuggestion` table and UI support it with no structural changes.

### Fallback

If neither mechanism is set up, the app works normally — all expenses are entered manually.

## Sync Behavior

- **Automatic sync**: On app launch and when returning to foreground, if connected to the internet.
- **Manual sync**: Pull-to-refresh on the expense feed.
- **Background sync**: Using iOS Background Tasks framework for periodic sync when the app isn't open.
- **Sync indicator**: A subtle icon in the nav bar shows sync status (synced, syncing, offline, error).

## Local Database

The iOS app uses a local SQLite database with the same schema as the server (plus the `WalletSuggestion` table). This keeps the data model aligned and simplifies sync logic.

Additional local-only metadata:

- `last_push_at`: Timestamp of last successful push.
- `last_pull_at`: Timestamp of last successful pull.
- `sync_status` per record: "synced", "pending_push", "conflict".
