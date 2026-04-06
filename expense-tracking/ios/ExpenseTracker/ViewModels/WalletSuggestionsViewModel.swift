import Foundation
import GRDB

@MainActor
class WalletSuggestionsViewModel: ObservableObject {
    let database: AppDatabase
    @Published var suggestions: [WalletSuggestion] = []

    var pendingCount: Int {
        suggestions.count
    }

    init(database: AppDatabase) {
        self.database = database
        refresh()
    }

    func refresh() {
        do {
            suggestions = try database.dbQueue.read { db in
                try WalletSuggestion
                    .filter(WalletSuggestion.Columns.status == "pending")
                    .order(WalletSuggestion.Columns.createdAt.desc)
                    .fetchAll(db)
            }
        } catch {
            print("Error loading wallet suggestions: \(error)")
        }
    }

    func dismiss(_ suggestion: WalletSuggestion) {
        do {
            try database.dbQueue.write { db in
                try db.execute(
                    sql: "UPDATE wallet_suggestions SET status = 'dismissed' WHERE id = ?",
                    arguments: [suggestion.id]
                )
            }
            refresh()
        } catch {
            print("Error dismissing suggestion: \(error)")
        }
    }

}
