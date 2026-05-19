import Foundation
import GRDB

enum WalletSuggestionStatus: String {
    case pending
    case accepted
    case dismissed
}

struct WalletSuggestion: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: String
    var amount: Int64?
    var currency: String
    var merchant: String
    var cardName: String?
    var capturedAt: Int64
    var source: String
    var status: String
    var linkedExpenseId: String?
    var createdAt: Int64
    var updatedAt: Int64
    var clientUpdatedAt: Int64
    var serverVersion: Int64
    var syncStatus: String = RecordSyncStatus.synced.rawValue

    static let databaseTableName = "wallet_suggestions"
    static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    enum Columns {
        static let id = Column("id")
        static let amount = Column("amount")
        static let currency = Column("currency")
        static let merchant = Column("merchant")
        static let cardName = Column("card_name")
        static let capturedAt = Column("captured_at")
        static let source = Column("source")
        static let status = Column("status")
        static let linkedExpenseId = Column("linked_expense_id")
        static let createdAt = Column("created_at")
        static let updatedAt = Column("updated_at")
        static let clientUpdatedAt = Column("client_updated_at")
        static let serverVersion = Column("server_version")
        static let syncStatus = Column("sync_status")
    }

    var displayAmount: String? {
        guard let amount else { return nil }
        return MoneyFormatter.decimalString(fromCents: amount)
    }

    var displayDate: Date {
        AppDateFormatter.date(fromUnixTimestamp: capturedAt)
    }
}
