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

        migrator.registerMigration("v7-align-ids-with-client-ids") { db in
            // Path C: collapse to a single id per row by snapping every row's
            // id back to its (immutable, client-minted) client_id. Existing
            // FK columns still reference the old server-assigned id, so
            // repoint them first, then update the parent ids. defer_foreign_keys
            // tolerates the intermediate violations until COMMIT.
            try db.execute(sql: "PRAGMA defer_foreign_keys = ON")

            try db.execute(sql: """
                UPDATE expenses
                SET category_id = COALESCE(
                    (SELECT client_id FROM categories WHERE categories.id = expenses.category_id),
                    expenses.category_id
                )
                """)
            try db.execute(sql: """
                UPDATE recurring_expenses
                SET category_id = COALESCE(
                    (SELECT client_id FROM categories WHERE categories.id = recurring_expenses.category_id),
                    recurring_expenses.category_id
                )
                """)
            try db.execute(sql: """
                UPDATE recurring_expense_runs
                SET expense_id = COALESCE(
                    (SELECT client_id FROM expenses WHERE expenses.id = recurring_expense_runs.expense_id),
                    recurring_expense_runs.expense_id
                )
                """)
            try db.execute(sql: """
                UPDATE recurring_expense_runs
                SET recurring_expense_id = COALESCE(
                    (SELECT client_id FROM recurring_expenses WHERE recurring_expenses.id = recurring_expense_runs.recurring_expense_id),
                    recurring_expense_runs.recurring_expense_id
                )
                """)
            // wallet_suggestions.linked_expense_id is a soft reference (no FK
            // constraint) but still must be repointed to keep the data sound.
            try db.execute(sql: """
                UPDATE wallet_suggestions
                SET linked_expense_id = (
                    SELECT client_id FROM expenses WHERE expenses.id = wallet_suggestions.linked_expense_id
                )
                WHERE linked_expense_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM expenses WHERE expenses.id = wallet_suggestions.linked_expense_id
                  )
                """)

            try db.execute(sql: "UPDATE categories SET id = client_id WHERE id != client_id")
            try db.execute(sql: "UPDATE expenses SET id = client_id WHERE id != client_id")
            try db.execute(sql: "UPDATE recurring_expenses SET id = client_id WHERE id != client_id")
        }

        migrator.registerMigration("v8-drop-client-id") { db in
            // After v7 every row has id == client_id, so the column is now
            // redundant. client_id was declared UNIQUE in earlier schemas, and
            // SQLite cannot DROP COLUMN when an automatic unique index still
            // references that column. Rebuild the affected tables instead.
            try db.execute(sql: "PRAGMA defer_foreign_keys = ON")

            try db.execute(sql: """
                CREATE TABLE categories_new (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    icon TEXT NOT NULL DEFAULT '',
                    budget INTEGER,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER,
                    sync_status TEXT NOT NULL DEFAULT 'pending_push'
                )
                """)
            try db.execute(sql: """
                INSERT INTO categories_new (id, name, icon, budget, created_at, updated_at, deleted_at, sync_status)
                SELECT id, name, icon, budget, created_at, updated_at, deleted_at, sync_status
                FROM categories
                """)

            try db.execute(sql: """
                CREATE TABLE expenses_new (
                    id TEXT PRIMARY KEY NOT NULL,
                    amount INTEGER NOT NULL,
                    currency TEXT NOT NULL,
                    category_id TEXT NOT NULL REFERENCES categories(id),
                    description TEXT NOT NULL DEFAULT '',
                    merchant TEXT NOT NULL DEFAULT '',
                    date INTEGER NOT NULL,
                    source TEXT NOT NULL DEFAULT 'manual',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER,
                    sync_status TEXT NOT NULL DEFAULT 'pending_push'
                )
                """)
            try db.execute(sql: """
                INSERT INTO expenses_new (id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at, deleted_at, sync_status)
                SELECT id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at, deleted_at, sync_status
                FROM expenses
                """)

            try db.execute(sql: """
                CREATE TABLE recurring_expenses_new (
                    id TEXT PRIMARY KEY NOT NULL,
                    amount INTEGER NOT NULL,
                    currency TEXT NOT NULL,
                    category_id TEXT NOT NULL REFERENCES categories(id),
                    description TEXT NOT NULL DEFAULT '',
                    merchant TEXT NOT NULL DEFAULT '',
                    frequency TEXT NOT NULL,
                    day_of_month INTEGER,
                    start_date INTEGER NOT NULL,
                    end_date INTEGER,
                    next_run_date INTEGER NOT NULL,
                    last_run_date INTEGER,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER
                )
                """)
            try db.execute(sql: """
                INSERT INTO recurring_expenses_new (id, amount, currency, category_id, description, merchant, frequency, day_of_month, start_date, end_date, next_run_date, last_run_date, created_at, updated_at, deleted_at)
                SELECT id, amount, currency, category_id, description, merchant, frequency, day_of_month, start_date, end_date, next_run_date, last_run_date, created_at, updated_at, deleted_at
                FROM recurring_expenses
                """)

            try db.execute(sql: """
                CREATE TABLE recurring_expense_runs_new (
                    id TEXT PRIMARY KEY NOT NULL,
                    recurring_expense_id TEXT NOT NULL REFERENCES recurring_expenses(id),
                    expense_id TEXT NOT NULL REFERENCES expenses(id),
                    occurrence_date INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                )
                """)
            try db.execute(sql: """
                INSERT INTO recurring_expense_runs_new (id, recurring_expense_id, expense_id, occurrence_date, created_at)
                SELECT id, recurring_expense_id, expense_id, occurrence_date, created_at
                FROM recurring_expense_runs
                """)

            try db.execute(sql: "DROP TABLE recurring_expense_runs")
            try db.execute(sql: "DROP TABLE recurring_expenses")
            try db.execute(sql: "DROP TABLE expenses")
            try db.execute(sql: "DROP TABLE categories")

            try db.execute(sql: "ALTER TABLE categories_new RENAME TO categories")
            try db.execute(sql: "ALTER TABLE expenses_new RENAME TO expenses")
            try db.execute(sql: "ALTER TABLE recurring_expenses_new RENAME TO recurring_expenses")
            try db.execute(sql: "ALTER TABLE recurring_expense_runs_new RENAME TO recurring_expense_runs")

            try db.create(index: "idx_categories_updated_at", on: "categories", columns: ["updated_at"])
            try db.create(index: "idx_expenses_category_id", on: "expenses", columns: ["category_id"])
            try db.create(index: "idx_expenses_date", on: "expenses", columns: ["date"])
            try db.create(index: "idx_expenses_updated_at", on: "expenses", columns: ["updated_at"])
            try db.create(index: "idx_recurring_expenses_next_run_date", on: "recurring_expenses", columns: ["next_run_date"])
            try db.create(index: "idx_recurring_expenses_category_id", on: "recurring_expenses", columns: ["category_id"])
            try db.create(
                index: "idx_recurring_expense_runs_unique_occurrence",
                on: "recurring_expense_runs",
                columns: ["recurring_expense_id", "occurrence_date"],
                unique: true
            )
        }

        migrator.registerMigration("v9-recurring-expense-sync-status") { db in
            try db.alter(table: "recurring_expenses") { t in
                t.add(column: "sync_status", .text).notNull().defaults(to: RecordSyncStatus.pendingPush.rawValue)
            }
        }

        migrator.registerMigration("v10-drop-local-recurring-runs") { db in
            try db.drop(table: "recurring_expense_runs")
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
