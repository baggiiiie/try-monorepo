import Foundation
import GRDB

struct WalletSuggestionRepository {
    let dbQueue: DatabaseQueue

    func fetchPending() throws -> [WalletSuggestion] {
        try dbQueue.read { db in
            try WalletSuggestion
                .filter(WalletSuggestion.Columns.status == WalletSuggestionStatus.pending.rawValue)
                .order(WalletSuggestion.Columns.createdAt.desc)
                .fetchAll(db)
        }
    }

    func dismiss(_ suggestion: WalletSuggestion) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "UPDATE wallet_suggestions SET status = ? WHERE id = ?",
                arguments: [WalletSuggestionStatus.dismissed.rawValue, suggestion.id]
            )
        }
    }
}
