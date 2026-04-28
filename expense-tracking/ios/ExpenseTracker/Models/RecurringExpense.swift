import Foundation
import GRDB

enum RecurringFrequency: String, CaseIterable, Identifiable {
    case weekly
    case monthly
    case yearly

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .weekly: return "Weekly"
        case .monthly: return "Monthly"
        case .yearly: return "Yearly"
        }
    }
}

struct RecurringExpense: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: String
    var amount: Int64
    var currency: String
    var categoryId: String
    var description: String
    var merchant: String
    var frequency: String
    var dayOfMonth: Int?
    var startDate: Int64
    var endDate: Int64?
    var nextRunDate: Int64
    var lastRunDate: Int64?
    var createdAt: Int64
    var updatedAt: Int64
    var deletedAt: Int64?
    var syncStatus: String = RecordSyncStatus.pendingPush.rawValue

    static let databaseTableName = "recurring_expenses"
    static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    enum Columns {
        static let id = Column("id")
        static let amount = Column("amount")
        static let currency = Column("currency")
        static let categoryId = Column("category_id")
        static let description = Column("description")
        static let merchant = Column("merchant")
        static let frequency = Column("frequency")
        static let dayOfMonth = Column("day_of_month")
        static let startDate = Column("start_date")
        static let endDate = Column("end_date")
        static let nextRunDate = Column("next_run_date")
        static let lastRunDate = Column("last_run_date")
        static let createdAt = Column("created_at")
        static let updatedAt = Column("updated_at")
        static let deletedAt = Column("deleted_at")
        static let syncStatus = Column("sync_status")
    }

    var displayAmount: String {
        MoneyFormatter.decimalString(fromCents: amount)
    }

    var displayNextRunDate: Date {
        AppDateFormatter.date(fromUnixTimestamp: nextRunDate)
    }
}
