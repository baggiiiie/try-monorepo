import Foundation
import GRDB

struct AppDatabase {
    private static let _shared: AppDatabase = {
        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let path = documentsURL.appendingPathComponent("expense-tracker.sqlite").path
        return try! AppDatabase(path: path)
    }()

    static var shared: AppDatabase { _shared }

    let dbQueue: DatabaseQueue

    init(path: String) throws {
        var config = Configuration()
        config.foreignKeysEnabled = true

        dbQueue = try DatabaseQueue(path: path, configuration: config)
        try migrator.migrate(dbQueue)
        try seedDefaultCategories()
        try normalizeCategoryIcons()
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
                t.column("source", .text).notNull().defaults(to: "manual")
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
                t.add(column: "sync_status", .text).notNull().defaults(to: "pending_push")
            }
            try db.alter(table: "categories") { t in
                t.add(column: "sync_status", .text).notNull().defaults(to: "pending_push")
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
                t.column("status", .text).notNull().defaults(to: "pending")
                t.column("linked_expense_id", .text)
                t.column("created_at", .integer).notNull()
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
                var category = Category(
                    id: UUID().uuidString,
                    clientId: UUID().uuidString,
                    name: name,
                    icon: icon,
                    budget: nil,
                    createdAt: now,
                    updatedAt: now,
                    deletedAt: nil,
                    syncStatus: "pending_push"
                )
                try category.insert(db)
            }
        }
    }

    private func normalizeCategoryIcons() throws {
        try dbQueue.write { db in
            let now = Int64(Date().timeIntervalSince1970)
            let categories = try Category
                .filter(Category.Columns.deletedAt == nil)
                .fetchAll(db)

            for var category in categories {
                let resolvedIcon = Category.resolvedIcon(name: category.name, icon: category.icon)
                guard resolvedIcon != category.icon, !resolvedIcon.isEmpty else { continue }

                category.icon = resolvedIcon
                category.updatedAt = now
                category.syncStatus = "pending_push"
                try category.update(db)
            }
        }
    }
}
