import SwiftUI

struct ApplePaySetupView: View {
    let serverURL: String

    private var walletSuggestionURL: String {
        guard !serverURL.isEmpty else {
            return "https://<your-host>/api/wallet-suggestions"
        }
        return serverURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/wallet-suggestions"
    }

    var body: some View {
        List {
            Section {
                Text("Capture Apple Pay transactions with a personal Shortcuts automation that posts pending suggestions to your ExpenseTracker server. Review and accept them later in the app.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Section("Shortcut recipe") {
                SetupStepRow(number: 1, text: "Open **Shortcuts** → **Automation** → **+** → **Transaction**.")
                SetupStepRow(number: 2, text: "Choose the cards to track and set the automation to **Run Immediately**.")
                SetupStepRow(number: 3, text: "Add **UUID**. Use that UUID as the dictionary `id` and `Idempotency-Key`.")
                SetupStepRow(number: 4, text: "Add **Dictionary** with `id`, `merchant`, `amount` in cents, `currency`, `captured_at` as Unix time, optional `card_name`, and `source` = `shortcut`.")
                SetupStepRow(number: 5, text: LocalizedStringKey("Add **Get Contents of URL** → `POST \(walletSuggestionURL)`."))
                SetupStepRow(number: 6, text: "Set headers: `Authorization: Bearer <sync-secret>`, `Content-Type: application/json`, and `Idempotency-Key: <id>`.")
                SetupStepRow(number: 7, text: "On failure, add the JSON payload to Reminders so failed captures are not silent.")
            }

            Section("Notes") {
                Label("The old in-app Import Transaction action has been retired; the server is now the source of truth for suggestions.", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption)
                Label("Suggestions stay pending until you explicitly accept or dismiss them.", systemImage: "checkmark.circle")
                    .font(.caption)
                Label("See docs/design/06-apple-pay-automation.md for the full recipe.", systemImage: "doc.text")
                    .font(.caption)
            }
        }
        .navigationTitle("Apple Pay Setup")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct SetupStepRow: View {
    let number: Int
    let text: LocalizedStringKey

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.caption.bold())
                .frame(width: 24, height: 24)
                .background(Color.accentColor)
                .foregroundStyle(.white)
                .clipShape(Circle())
            Text(text)
                .font(.subheadline)
        }
    }
}
