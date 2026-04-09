import Foundation
import GRDB

struct Category: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: String
    var clientId: String
    var name: String
    var icon: String
    var budget: Int64?
    var createdAt: Int64
    var updatedAt: Int64
    var deletedAt: Int64?
    var syncStatus: String = "pending_push"

    static let databaseTableName = "categories"
    static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    enum Columns {
        static let id = Column("id")
        static let clientId = Column("client_id")
        static let name = Column("name")
        static let icon = Column("icon")
        static let budget = Column("budget")
        static let createdAt = Column("created_at")
        static let updatedAt = Column("updated_at")
        static let deletedAt = Column("deleted_at")
        static let syncStatus = Column("sync_status")
    }

    static let expenses = hasMany(Expense.self)

    var displayBudget: String? {
        guard let budget else { return nil }
        let dollars = Double(budget) / 100.0
        return String(format: "%.2f", dollars)
    }

    var isDeleted: Bool {
        deletedAt != nil
    }
}
