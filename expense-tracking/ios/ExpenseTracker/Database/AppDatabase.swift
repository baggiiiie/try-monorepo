import Foundation
import GRDB

struct AppDatabase {
    let dbQueue: DatabaseQueue

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

        return migrator
    }

    private func seedDefaultCategories() throws {
        try dbQueue.write { db in
            let count = try Category.filter(Category.Columns.deletedAt == nil).fetchCount(db)
            if count > 0 { return }

            let now = Int64(Date().timeIntervalSince1970)
            let defaults: [(String, String)] = [
                ("Food & Dining", "🍽️"),
                ("Groceries", "🛒"),
                ("Transport", "🚌"),
                ("Shopping", "🛍️"),
                ("Entertainment", "🎬"),
                ("Bills", "📄"),
                ("Health", "💊"),
                ("Other", "📦"),
            ]

            for (name, icon) in defaults {
                var category = Category(
                    id: UUID().uuidString,
                    clientId: UUID().uuidString,
                    name: name,
                    icon: icon,
                    budget: nil,
                    createdAt: now,
                    updatedAt: now,
                    deletedAt: nil
                )
                try category.insert(db)
            }
        }
    }
}
