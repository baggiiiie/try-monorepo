import Foundation

@MainActor
final class WalletSuggestionsViewModel: ObservableObject {
    @Published var suggestions: [WalletSuggestion] = []

    private let walletSuggestionRepository: WalletSuggestionRepository

    var pendingCount: Int {
        suggestions.count
    }

    init(database: AppDatabase) {
        self.walletSuggestionRepository = database.walletSuggestionRepository
        refresh()
    }

    func refresh() {
        do {
            suggestions = try walletSuggestionRepository.fetchPending()
        } catch {
            print("Error loading wallet suggestions: \(error)")
        }
    }

    func dismiss(_ suggestion: WalletSuggestion) {
        do {
            try walletSuggestionRepository.dismiss(suggestion)
            refresh()
        } catch {
            print("Error dismissing suggestion: \(error)")
        }
    }
}
