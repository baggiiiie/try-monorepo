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

    static let databaseTableName = "categories"

    enum Columns {
        static let id = Column(CodingKeys.id)
        static let clientId = Column(CodingKeys.clientId)
        static let name = Column(CodingKeys.name)
        static let icon = Column(CodingKeys.icon)
        static let budget = Column(CodingKeys.budget)
        static let createdAt = Column(CodingKeys.createdAt)
        static let updatedAt = Column(CodingKeys.updatedAt)
        static let deletedAt = Column(CodingKeys.deletedAt)
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
