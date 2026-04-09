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
    var syncStatus: String = "pending_push"

    static let databaseTableName = "expenses"
    static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    enum Columns {
        static let id = Column("id")
        static let clientId = Column("client_id")
        static let amount = Column("amount")
        static let currency = Column("currency")
        static let categoryId = Column("category_id")
        static let description = Column("description")
        static let merchant = Column("merchant")
        static let date = Column("date")
        static let source = Column("source")
        static let createdAt = Column("created_at")
        static let updatedAt = Column("updated_at")
        static let deletedAt = Column("deleted_at")
        static let syncStatus = Column("sync_status")
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
