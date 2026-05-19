import Foundation
import GRDB

struct WalletSuggestionRepository {
    let dbQueue: DatabaseQueue

    func fetchPending() throws -> [WalletSuggestion] {
        try dbQueue.read { db in
            try WalletSuggestion
                .filter(WalletSuggestion.Columns.status == WalletSuggestionStatus.pending.rawValue)
                .order(WalletSuggestion.Columns.capturedAt.desc)
                .fetchAll(db)
        }
    }

    func accept(_ suggestion: WalletSuggestion, linkedExpenseId: String) throws {
        try updateStatus(suggestion, status: .accepted, linkedExpenseId: linkedExpenseId)
    }

    func dismiss(_ suggestion: WalletSuggestion) throws {
        try updateStatus(suggestion, status: .dismissed, linkedExpenseId: nil)
    }

    private func updateStatus(_ suggestion: WalletSuggestion, status: WalletSuggestionStatus, linkedExpenseId: String?) throws {
        let now = Int64(Date().timeIntervalSince1970)
        try dbQueue.write { db in
            try db.execute(
                sql: """
                    UPDATE wallet_suggestions
                    SET status = ?, linked_expense_id = ?, updated_at = ?, client_updated_at = ?, sync_status = ?
                    WHERE id = ?
                    """,
                arguments: [status.rawValue, linkedExpenseId, now, now, RecordSyncStatus.pendingPush.rawValue, suggestion.id]
            )
        }
    }
}
