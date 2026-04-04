import Foundation
import GRDB

struct Expense: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: String
    var clientId: String
    var amount: Int64
    var currency: String
    var categoryId: String
    var description: String
    var merchant: String
    var date: Int64
    var source: String
    var createdAt: Int64
    var updatedAt: Int64
    var deletedAt: Int64?

    static let databaseTableName = "expenses"

    enum Columns {
        static let id = Column(CodingKeys.id)
        static let clientId = Column(CodingKeys.clientId)
        static let amount = Column(CodingKeys.amount)
        static let currency = Column(CodingKeys.currency)
        static let categoryId = Column(CodingKeys.categoryId)
        static let description = Column(CodingKeys.description)
        static let merchant = Column(CodingKeys.merchant)
        static let date = Column(CodingKeys.date)
        static let source = Column(CodingKeys.source)
        static let createdAt = Column(CodingKeys.createdAt)
        static let updatedAt = Column(CodingKeys.updatedAt)
        static let deletedAt = Column(CodingKeys.deletedAt)
    }

    static let category = belongsTo(Category.self)
    var category: QueryInterfaceRequest<Category> {
        request(for: Expense.category)
    }

    var displayAmount: String {
        let dollars = Double(amount) / 100.0
        return String(format: "%.2f", dollars)
    }

    var displayDate: Date {
        Date(timeIntervalSince1970: TimeInterval(date))
    }

    var isDeleted: Bool {
        deletedAt != nil
    }
}
