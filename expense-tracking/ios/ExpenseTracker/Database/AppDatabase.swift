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

struct CategoryDraft {
    let name: String
    let icon: String
    let budget: Int64?
}

struct ExpenseDraft {
    let amount: Int64
    let currency: String
    let categoryId: String
    let description: String
    let merchant: String
    let date: Int64
    let source: ExpenseSource
}

struct CategoryRepository {
    let dbQueue: DatabaseQueue

    func fetchActive() throws -> [Category] {
        try dbQueue.read { db in
            try Category
                .filter(Category.Columns.deletedAt == nil)
                .order(Category.Columns.name)
                .fetchAll(db)
        }
    }

    func save(_ draft: CategoryDraft, editing existingCategory: Category?) throws {
        let now = Int64(Date().timeIntervalSince1970)

        try dbQueue.write { db in
            if var existingCategory {
                existingCategory.name = draft.name
                existingCategory.icon = draft.icon
                existingCategory.budget = draft.budget
                existingCategory.updatedAt = now
                existingCategory.syncStatus = RecordSyncStatus.pendingPush.rawValue
                try existingCategory.update(db)
                return
            }

            let category = Category(
                id: UUID().uuidString,
                clientId: UUID().uuidString,
                name: draft.name,
                icon: draft.icon,
                budget: draft.budget,
                createdAt: now,
                updatedAt: now,
                deletedAt: nil,
                syncStatus: RecordSyncStatus.pendingPush.rawValue
            )
            try category.insert(db)
        }
    }

    func softDelete(_ category: Category) throws {
        let deletedAt = Int64(Date().timeIntervalSince1970)

        try dbQueue.write { db in
            var category = category
            category.deletedAt = deletedAt
            category.updatedAt = deletedAt
            category.syncStatus = RecordSyncStatus.pendingPush.rawValue
            try category.update(db)
        }
    }
}

struct ExpenseRepository {
    let dbQueue: DatabaseQueue

    func fetchFeedItems() throws -> [ExpenseWithCategory] {
        try dbQueue.read { db in
            let expenses = try Expense
                .filter(Expense.Columns.deletedAt == nil)
                .order(Expense.Columns.date.desc, Expense.Columns.createdAt.desc)
                .fetchAll(db)

            let categoryIds = Set(expenses.map(\.categoryId))
            let categories = try Category
                .filter(categoryIds.contains(Category.Columns.id))
                .fetchAll(db)
            let categoryMap = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })

            return expenses.map { expense in
                let category = categoryMap[expense.categoryId]
                return ExpenseWithCategory(
                    expense: expense,
                    categoryName: category?.name ?? "Unknown",
                    categoryIcon: category?.displayIcon ?? "shippingbox"
                )
            }
        }
    }

    func save(_ draft: ExpenseDraft, editing existingExpense: Expense?, from walletSuggestion: WalletSuggestion?) throws {
        let now = Int64(Date().timeIntervalSince1970)

        try dbQueue.write { db in
            if var existingExpense {
                existingExpense.amount = draft.amount
                existingExpense.categoryId = draft.categoryId
                existingExpense.merchant = draft.merchant
                existingExpense.description = draft.description
                existingExpense.date = draft.date
                existingExpense.updatedAt = now
                existingExpense.syncStatus = RecordSyncStatus.pendingPush.rawValue
                try existingExpense.update(db)
                return
            }

            let expense = Expense(
                id: UUID().uuidString,
                clientId: UUID().uuidString,
                amount: draft.amount,
                currency: draft.currency,
                categoryId: draft.categoryId,
                description: draft.description,
                merchant: draft.merchant,
                date: draft.date,
                source: draft.source.rawValue,
                createdAt: now,
                updatedAt: now,
                deletedAt: nil
            )
            try expense.insert(db)

            if let walletSuggestion {
                try db.execute(
                    sql: "UPDATE wallet_suggestions SET status = ?, linked_expense_id = ? WHERE id = ?",
                    arguments: [WalletSuggestionStatus.accepted.rawValue, expense.id, walletSuggestion.id]
                )
            }
        }
    }
}

struct WalletSuggestionRepository {
    let dbQueue: DatabaseQueue

    func fetchPending() throws -> [WalletSuggestion] {
        try dbQueue.read { db in
            try WalletSuggestion
                .filter(WalletSuggestion.Columns.status == WalletSuggestionStatus.pending.rawValue)
                .order(WalletSuggestion.Columns.createdAt.desc)
                .fetchAll(db)
        }
    }

    func dismiss(_ suggestion: WalletSuggestion) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "UPDATE wallet_suggestions SET status = ? WHERE id = ?",
                arguments: [WalletSuggestionStatus.dismissed.rawValue, suggestion.id]
            )
        }
    }
}
