import Foundation
import GRDB

struct Category: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: String
    var name: String
    var icon: String
    var budget: Int64?
    var createdAt: Int64
    var updatedAt: Int64
    var clientUpdatedAt: Int64
    var deletedAt: Int64?
    var syncStatus: String = RecordSyncStatus.pendingPush.rawValue

    static let databaseTableName = "categories"
    static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    private static let suggestedSymbolsByName: [String: String] = [
        "Bills": "doc.text",
        "Entertainment": "film",
        "Food & Dining": "fork.knife",
        "Groceries": "cart",
        "Health": "cross.case",
        "Other": "shippingbox",
        "Shopping": "bag",
        "Transport": "car",
    ]

    private static let legacyIconsByName: [String: Set<String>] = [
        "Bills": ["🧾", "📄", "doc.text"],
        "Entertainment": ["🎬", "film"],
        "Food & Dining": ["🍽️", "fork.knife"],
        "Groceries": ["🛒", "cart"],
        "Health": ["🩺", "💊", "cross.case"],
        "Other": ["📦", "shippingbox"],
        "Shopping": ["🛍️", "bag"],
        "Transport": ["🚗", "🚌", "car"],
    ]

    enum Columns {
        static let id = Column("id")
        static let name = Column("name")
        static let icon = Column("icon")
        static let budget = Column("budget")
        static let createdAt = Column("created_at")
        static let updatedAt = Column("updated_at")
        static let clientUpdatedAt = Column("client_updated_at")
        static let deletedAt = Column("deleted_at")
        static let syncStatus = Column("sync_status")
    }

    static let expenses = hasMany(Expense.self)

    static func suggestedSymbol(for name: String) -> String? {
        suggestedSymbolsByName[name]
    }

    static func resolvedIcon(name: String, icon: String) -> String {
        let trimmedIcon = icon.trimmingCharacters(in: .whitespacesAndNewlines)

        if let suggested = suggestedSymbol(for: name) {
            if trimmedIcon.isEmpty || trimmedIcon == "?" || trimmedIcon == "❓" {
                return suggested
            }

            if legacyIconsByName[name]?.contains(trimmedIcon) == true {
                return suggested
            }
        }

        return trimmedIcon
    }

    var displayIcon: String {
        let resolved = Self.resolvedIcon(name: name, icon: icon)
        return resolved.isEmpty ? "shippingbox" : resolved
    }

    var displayBudget: String? {
        guard let budget else { return nil }
        return MoneyFormatter.decimalString(fromCents: budget)
    }

}
