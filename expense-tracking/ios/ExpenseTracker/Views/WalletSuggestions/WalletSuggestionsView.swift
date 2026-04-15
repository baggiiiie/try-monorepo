import SwiftUI

struct WalletSuggestionsView: View {
    @StateObject private var viewModel: WalletSuggestionsViewModel
    let database: AppDatabase

    init(database: AppDatabase) {
        self.database = database
        _viewModel = StateObject(wrappedValue: WalletSuggestionsViewModel(database: database))
    }

    var body: some View {
        NavigationStack {
            List {
                if viewModel.suggestions.isEmpty {
                    ContentUnavailableView(
                        "No Pending Suggestions",
                        systemImage: "creditcard",
                        description: Text("Apple Pay transactions will appear here")
                    )
                } else {
                    ForEach(viewModel.suggestions) { suggestion in
                        WalletSuggestionRow(
                            suggestion: suggestion,
                            database: database,
                            onAccept: { viewModel.refresh() },
                            onDismiss: { viewModel.dismiss(suggestion) }
                        )
                    }
                }
            }
            .navigationTitle("Wallet Suggestions")
            .onAppear { viewModel.refresh() }
        }
    }
}

struct WalletSuggestionRow: View {
    let suggestion: WalletSuggestion
    let database: AppDatabase
    let onAccept: () -> Void
    let onDismiss: () -> Void
    @State private var showingAddExpense = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: "creditcard.fill")
                    .foregroundStyle(.blue)
                Text(suggestion.merchant)
                    .font(.headline)
                Spacer()
                if let amount = suggestion.amount, amount > 0 {
                    Text(CurrencyFormatter.format(cents: amount, currency: suggestion.currency))
                        .font(.headline)
                } else {
                    Text("No amount")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            HStack {
                Text(suggestion.displayDate, style: .date)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let cardName = suggestion.cardName {
                    Text(cardName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(suggestion.source)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color(.systemGray5))
                    .clipShape(Capsule())
            }

            HStack(spacing: 12) {
                Button {
                    showingAddExpense = true
                } label: {
                    Label("Add as Expense", systemImage: "plus.circle.fill")
                        .font(.subheadline)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)

                Button(role: .destructive) {
                    onDismiss()
                } label: {
                    Label("Dismiss", systemImage: "xmark.circle")
                        .font(.subheadline)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            .padding(.top, 4)
        }
        .padding(.vertical, 4)
        .sheet(isPresented: $showingAddExpense) {
            AddEditExpenseView(database: database, suggestion: suggestion)
                .onDisappear { onAccept() }
        }
    }
}
