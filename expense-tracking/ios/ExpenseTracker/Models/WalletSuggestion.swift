import Foundation
import GRDB

struct WalletSuggestion: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: String
    var financekitTxId: String?
    var amount: Int64?
    var currency: String
    var merchant: String
    var date: Int64
    var source: String
    var status: String
    var linkedExpenseId: String?
    var createdAt: Int64

    static let databaseTableName = "wallet_suggestions"

    enum CodingKeys: String, CodingKey {
        case id
        case financekitTxId = "financekit_tx_id"
        case amount
        case currency
        case merchant
        case date
        case source
        case status
        case linkedExpenseId = "linked_expense_id"
        case createdAt = "created_at"
    }

    enum Columns {
        static let id = Column(CodingKeys.id)
        static let financekitTxId = Column(CodingKeys.financekitTxId)
        static let amount = Column(CodingKeys.amount)
        static let currency = Column(CodingKeys.currency)
        static let merchant = Column(CodingKeys.merchant)
        static let date = Column(CodingKeys.date)
        static let source = Column(CodingKeys.source)
        static let status = Column(CodingKeys.status)
        static let linkedExpenseId = Column(CodingKeys.linkedExpenseId)
        static let createdAt = Column(CodingKeys.createdAt)
    }

    var displayAmount: String? {
        guard let amount else { return nil }
        let dollars = Double(amount) / 100.0
        return String(format: "%.2f", dollars)
    }

    var displayDate: Date {
        Date(timeIntervalSince1970: TimeInterval(date))
    }

    var isPending: Bool {
        status == "pending"
    }
}
