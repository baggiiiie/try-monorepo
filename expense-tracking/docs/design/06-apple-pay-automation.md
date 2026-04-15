# Apple Pay Automation via iOS Shortcuts

> Research date: April 2025

## Goal

When the user pays with Apple Pay, the expense tracking app should automatically receive the transaction data and present a ready-to-add expense entry the next time the app is opened.

## Approach: iOS Shortcuts Transaction Trigger + App Intents

iOS 17 introduced a **Transaction automation trigger** in the Shortcuts app (renamed "Wallet" in iOS 26+). This fires immediately in the background whenever a Wallet card is tapped — no user confirmation required. Combined with the **App Intents framework**, our app can expose a custom action that Shortcuts calls with the transaction data.

This is the same approach used by production apps like TravelSpend.

### Data Flow

```
Apple Pay tap
    ↓
iOS Shortcuts "Transaction" automation (runs immediately, background)
    ↓
Shortcut Input provides: Amount, Merchant, Card/Pass, Name
    ↓
Calls our app's App Intent action ("Import Transaction")
    ↓
App stores a pending WalletSuggestion entry locally (with all fields)
    ↓
User opens app → sees ready-to-confirm entry (amount + merchant pre-filled)
```

### Available Data from Shortcut Input

The Transaction trigger passes a `Shortcut Input` object. To access individual fields, the user taps the Shortcut Input variable, selects "Type", and picks the field:

| Field        | Reliability | Notes                                           |
| ------------ | ----------- | ----------------------------------------------- |
| **Amount**   | Unreliable  | Some card issuers return 0. Known iOS bug.      |
| **Merchant** | Reliable    | Merchant name as reported by the payment system.|
| **Card**     | Reliable    | Which Wallet card was used.                     |
| **Name**     | Reliable    | Transaction name / description.                 |

**Important**: The Amount field has been widely reported as returning 0 for certain card issuers. The app UI must handle this gracefully by allowing the user to fill in the amount manually.

## Implementation Components

### 1. App Intent (`ImportTransactionIntent`)

An `AppIntent`-conforming struct that Shortcuts can invoke. It receives the transaction data and stores it locally.

```swift
import AppIntents

struct ImportTransactionIntent: AppIntent {
    static var title: LocalizedStringResource = "Import Transaction"
    static var description: IntentDescription = "Import an Apple Pay transaction as a pending expense."

    @Parameter(title: "Amount")
    var amount: Double?

    @Parameter(title: "Merchant")
    var merchant: String?

    @Parameter(title: "Card")
    var cardName: String?

    @Parameter(title: "Name")
    var transactionName: String?

    func perform() async throws -> some IntentResult {
        let suggestion = WalletSuggestion(
            amount: amount.map { Int($0 * 100) },  // convert to cents
            merchant: merchant ?? "Unknown",
            date: Date(),
            source: .shortcutAutomation,
            status: .pending
        )
        try await PendingTransactionStore.shared.save(suggestion)
        return .result()
    }
}
```

### 2. App Shortcuts Provider

Registers the intent so it appears in the Shortcuts app under our app's actions.

```swift
import AppIntents

struct ExpenseTrackerShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ImportTransactionIntent(),
            phrases: ["Import transaction in \(.applicationName)"],
            shortTitle: "Import Transaction",
            systemImageName: "creditcard"
        )
    }
}
```

### 3. WalletSuggestion Storage

Pending transactions are stored in the local SQLite database in the existing `WalletSuggestion` table. The `source` field distinguishes between FinanceKit-detected and Shortcut-imported entries.

### 4. User-Facing Setup

The user performs a one-time setup in the iOS Shortcuts app:

1. Open Shortcuts → Automation → New Automation
2. Select **Transaction** (or **Wallet** on iOS 26+)
3. In "When I tap", select all cards to track
4. Set to **Run Immediately**
5. Add action → select our app → **Import Transaction**
6. Map `Shortcut Input > Amount` to the Amount parameter
7. Map `Shortcut Input > Merchant` to the Merchant parameter
8. Map `Shortcut Input > Card or Pass` to the Card parameter
9. Map `Shortcut Input > Name` to the Name parameter
10. Done

The app should include an onboarding screen or settings page that walks the user through this setup with step-by-step instructions (or a deep link to create the automation).

## Why Not Other Approaches?

| Approach                     | Why Not                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| **FinanceKit**               | Requires managed entitlement, organization developer account, App Store distribution.     |
| **Read other apps' notifications** | iOS does not allow apps to read notifications from other apps (unlike Android).     |
| **PassKit transaction history** | PKPaymentAuthorizationController is for merchants processing payments, not reading history. |
| **Direct Wallet API**        | No public API exists to read Wallet transaction history programmatically.                 |
| **Bank APIs (Plaid, etc.)**  | Requires server-side integration, costs money, privacy implications. Overkill for this use case. |

## Known Limitations

1. **Amount may be 0** — Some card issuers don't report the amount through the Shortcuts trigger. The app must let the user fill this in.
2. **One-time user setup required** — The user must create the Shortcuts automation manually. We can guide them but can't do it programmatically.
3. **Physical tap only** — The trigger fires on NFC/contactless tap. Online Apple Pay purchases in apps or Safari may not trigger the automation.
4. **iOS 17+ required** — The Transaction automation trigger was introduced in iOS 17.
5. **Mobile Data for Wallet** — The Wallet app's mobile data setting must be enabled, or the automation may fail silently.

## Impact on Existing Design

### Data Model (`02-data-model.md`)

The `WalletSuggestion` table needs a minor update:
- The `financekit_tx_id` field should be nullable (Shortcut-imported entries won't have one).
- Add `source` field to distinguish: `"financekit"`, `"shortcut"`.

### Expense Source (`02-data-model.md`)

The `source` field on `Expense` should include `"shortcut"` as a valid value alongside `"manual"`, `"financekit"`, and `"cli"`.

### iOS App (`05-ios-app.md`)

- The "Wallet Suggestions" screen works identically for both FinanceKit and Shortcut-imported entries.
- Settings should include a "Set up Apple Pay automation" section with setup instructions.
- The Add/Edit Expense form should handle a nil/zero amount gracefully when pre-filling from a Shortcut import.

### Architecture (`01-architecture.md`)

No structural changes needed. The Shortcuts integration is purely an iOS-side input mechanism that feeds into the existing WalletSuggestion → Expense flow.
