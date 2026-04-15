import SwiftUI

struct ApplePaySetupView: View {
    var body: some View {
        List {
            Section {
                Text("Automatically capture Apple Pay transactions by setting up a Shortcuts automation. This runs in the background every time you tap to pay.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Section("Setup Steps") {
                SetupStepRow(number: 1, text: "Open the **Shortcuts** app")
                SetupStepRow(number: 2, text: "Go to **Automation** → tap **+**")
                SetupStepRow(number: 3, text: "Select **Transaction** (or **Wallet** on iOS 18+)")
                SetupStepRow(number: 4, text: "Under \"When I tap\", select the cards you want to track")
                SetupStepRow(number: 5, text: "Set to **Run Immediately**")
                SetupStepRow(number: 6, text: "Add action → search for **Import Transaction**")
                SetupStepRow(number: 7, text: "Tap the **Amount** field → select **Shortcut Input** → choose type **Amount**")
                SetupStepRow(number: 8, text: "Tap the **Merchant** field → select **Shortcut Input** → choose type **Merchant**")
                SetupStepRow(number: 9, text: "Tap the **Card** field → select **Shortcut Input** → choose type **Card or Pass**")
                SetupStepRow(number: 10, text: "Tap the **Name** field → select **Shortcut Input** → choose type **Name**")
                SetupStepRow(number: 11, text: "Tap **Done**")
            }

            Section("Notes") {
                Label("The amount may show as $0 for some card issuers — you can fill it in manually when reviewing.", systemImage: "info.circle")
                    .font(.caption)
                Label("Make sure Wallet has mobile data enabled in Settings → Cellular.", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.caption)
                Label("Only NFC/contactless taps trigger the automation. In-app purchases may not.", systemImage: "wave.3.right")
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
