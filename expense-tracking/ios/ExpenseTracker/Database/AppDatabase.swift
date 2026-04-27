import Foundation
import GRDB

struct AppDatabase {
    private static let sharedDatabase: AppDatabase = {
        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let path = documentsURL.appendingPathComponent("expense-tracker.sqlite").path
        return try! AppDatabase(path: path)
    }()

    static var shared: AppDatabase { sharedDatabase }

    let dbQueue: DatabaseQueue

    var categoryRepository: CategoryRepository {
        CategoryRepository(dbQueue: dbQueue)
    }

    var expenseRepository: ExpenseRepository {
        ExpenseRepository(dbQueue: dbQueue)
    }

    var walletSuggestionRepository: WalletSuggestionRepository {
        WalletSuggestionRepository(dbQueue: dbQueue)
    }

    var recurringExpenseRepository: RecurringExpenseRepository {
        RecurringExpenseRepository(dbQueue: dbQueue)
    }

    init(path: String) throws {
        var config = Configuration()
        config.foreignKeysEnabled = true

        dbQueue = try DatabaseQueue(path: path, configuration: config)
        try migrator.migrate(dbQueue)
        try seedDefaultCategories()
    }

    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1") { db in
            try db.create(table: "categories") { t in
                t.column("id", .text).primaryKey()
                t.column("client_id", .text).notNull().unique()
                t.column("name", .text).notNull()
                t.column("icon", .text).notNull().defaults(to: "")
                t.column("budget", .integer)
                t.column("created_at", .integer).notNull()
                t.column("updated_at", .integer).notNull()
                t.column("deleted_at", .integer)
            }

            try db.create(table: "expenses") { t in
                t.column("id", .text).primaryKey()
                t.column("client_id", .text).notNull().unique()
                t.column("amount", .integer).notNull()
                t.column("currency", .text).notNull()
                t.column("category_id", .text).notNull().references("categories")
                t.column("description", .text).notNull().defaults(to: "")
                t.column("merchant", .text).notNull().defaults(to: "")
                t.column("date", .integer).notNull()
                t.column("source", .text).notNull().defaults(to: ExpenseSource.manual.rawValue)
                t.column("created_at", .integer).notNull()
                t.column("updated_at", .integer).notNull()
                t.column("deleted_at", .integer)
            }

            try db.create(index: "idx_expenses_category_id", on: "expenses", columns: ["category_id"])
            try db.create(index: "idx_expenses_date", on: "expenses", columns: ["date"])
            try db.create(index: "idx_expenses_updated_at", on: "expenses", columns: ["updated_at"])
            try db.create(index: "idx_categories_updated_at", on: "categories", columns: ["updated_at"])
        }

        migrator.registerMigration("v2") { db in
            try db.alter(table: "expenses") { t in
                t.add(column: "sync_status", .text).notNull().defaults(to: RecordSyncStatus.pendingPush.rawValue)
            }
            try db.alter(table: "categories") { t in
                t.add(column: "sync_status", .text).notNull().defaults(to: RecordSyncStatus.pendingPush.rawValue)
            }
        }

        migrator.registerMigration("v3") { db in
            try db.create(table: "wallet_suggestions") { t in
                t.column("id", .text).primaryKey()
                t.column("financekit_tx_id", .text)
                t.column("amount", .integer)
                t.column("currency", .text).notNull().defaults(to: "SGD")
                t.column("merchant", .text).notNull()
                t.column("date", .integer).notNull()
                t.column("source", .text).notNull()
                t.column("status", .text).notNull().defaults(to: WalletSuggestionStatus.pending.rawValue)
                t.column("linked_expense_id", .text)
                t.column("created_at", .integer).notNull()
            }
        }

        migrator.registerMigration("v4-normalize-icons") { db in
            let now = Int64(Date().timeIntervalSince1970)
            let categories = try Category
                .filter(Category.Columns.deletedAt == nil)
                .fetchAll(db)

            for var category in categories {
                let resolvedIcon = Category.resolvedIcon(name: category.name, icon: category.icon)
                guard resolvedIcon != category.icon, !resolvedIcon.isEmpty else { continue }

                category.icon = resolvedIcon
                category.updatedAt = now
                category.syncStatus = RecordSyncStatus.pendingPush.rawValue
                try category.update(db)
            }
        }

        migrator.registerMigration("v5-wallet-card-name") { db in
            try db.alter(table: "wallet_suggestions") { t in
                t.add(column: "card_name", .text)
                t.add(column: "transaction_name", .text)
            }
        }

        migrator.registerMigration("v6-recurring-expenses") { db in
            try db.create(table: "recurring_expenses") { t in
                t.column("id", .text).primaryKey()
                t.column("client_id", .text).notNull().unique()
                t.column("amount", .integer).notNull()
                t.column("currency", .text).notNull()
                t.column("category_id", .text).notNull().references("categories")
                t.column("description", .text).notNull().defaults(to: "")
                t.column("merchant", .text).notNull().defaults(to: "")
                t.column("frequency", .text).notNull()
                t.column("day_of_month", .integer)
                t.column("start_date", .integer).notNull()
                t.column("end_date", .integer)
                t.column("next_run_date", .integer).notNull()
                t.column("last_run_date", .integer)
                t.column("created_at", .integer).notNull()
                t.column("updated_at", .integer).notNull()
                t.column("deleted_at", .integer)
            }

            try db.create(index: "idx_recurring_expenses_next_run_date", on: "recurring_expenses", columns: ["next_run_date"])
            try db.create(index: "idx_recurring_expenses_category_id", on: "recurring_expenses", columns: ["category_id"])

            try db.create(table: "recurring_expense_runs") { t in
                t.column("id", .text).primaryKey()
                t.column("recurring_expense_id", .text).notNull().references("recurring_expenses")
                t.column("expense_id", .text).notNull().references("expenses")
                t.column("occurrence_date", .integer).notNull()
                t.column("created_at", .integer).notNull()
            }

            try db.create(
                index: "idx_recurring_expense_runs_unique_occurrence",
                on: "recurring_expense_runs",
                columns: ["recurring_expense_id", "occurrence_date"],
                unique: true
            )
        }

        return migrator
    }

    private func seedDefaultCategories() throws {
        try dbQueue.write { db in
            let count = try Category.filter(Category.Columns.deletedAt == nil).fetchCount(db)
            if count > 0 { return }

            let now = Int64(Date().timeIntervalSince1970)

            for (name, icon) in DefaultCategories.all {
                let category = Category(
                    id: UUID().uuidString,
                    clientId: UUID().uuidString,
                    name: name,
                    icon: icon,
                    budget: nil,
                    createdAt: now,
                    updatedAt: now,
                    deletedAt: nil,
                    syncStatus: RecordSyncStatus.pendingPush.rawValue
                )
                try category.insert(db)
            }
        }
    }
}
