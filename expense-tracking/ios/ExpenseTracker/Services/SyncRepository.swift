import Foundation
import GRDB

/// Local-database half of synchronization. Reads pending changes for the
/// next push, and applies push/pull responses back into GRDB. Pure DB; no
/// network or UI state.
struct SyncRepository {
    let dbQueue: DatabaseQueue

    func fetchPendingPushChanges() throws -> PendingPushChanges {
        try dbQueue.read { db in
            let expenses = try Expense
                .filter(Expense.Columns.syncStatus == RecordSyncStatus.pendingPush.rawValue)
                .fetchAll(db)
            let categories = try Category
                .filter(Category.Columns.syncStatus == RecordSyncStatus.pendingPush.rawValue)
                .fetchAll(db)
            return PendingPushChanges(expenses: expenses, categories: categories)
        }
    }

    func applyPushResponse(_ response: PushResponse) throws {
        try dbQueue.write { db in
            try db.execute(sql: "PRAGMA defer_foreign_keys = ON")
            try markPushedCategoriesAsSynced(response.categories, in: db)
            try markPushedExpensesAsSynced(response.expenses, in: db)
        }
    }

    func applyPullResponse(_ response: PullResponse) throws {
        try dbQueue.write { db in
            try db.execute(sql: "PRAGMA defer_foreign_keys = ON")
            for category in response.categories {
                try upsertCategory(category, in: db)
            }
            for expense in response.expenses {
                try upsertExpense(expense, in: db)
            }
        }
    }

    // MARK: - Push reconciliation

    private func markPushedCategoriesAsSynced(_ categories: [PullCategory], in db: Database) throws {
        for serverCategory in categories {
            guard let localCategory = try Category
                .filter(Category.Columns.clientId == serverCategory.clientId)
                .fetchOne(db) else {
                continue
            }

            if localCategory.id != serverCategory.id {
                try updateExpenseCategoryReferences(from: localCategory.id, to: serverCategory.id, in: db)
                try db.execute(
                    sql: "UPDATE categories SET id = ?, updated_at = ?, sync_status = ? WHERE client_id = ?",
                    arguments: [
                        serverCategory.id,
                        serverCategory.updatedAt,
                        RecordSyncStatus.synced.rawValue,
                        serverCategory.clientId,
                    ]
                )
            } else {
                try db.execute(
                    sql: "UPDATE categories SET updated_at = ?, sync_status = ? WHERE client_id = ?",
                    arguments: [
                        serverCategory.updatedAt,
                        RecordSyncStatus.synced.rawValue,
                        serverCategory.clientId,
                    ]
                )
            }
        }
    }

    private func markPushedExpensesAsSynced(_ expenses: [PullExpense], in db: Database) throws {
        for serverExpense in expenses {
            guard let localExpense = try Expense
                .filter(Expense.Columns.clientId == serverExpense.clientId)
                .fetchOne(db) else {
                continue
            }

            if localExpense.id != serverExpense.id {
                try db.execute(
                    sql: "UPDATE expenses SET id = ?, category_id = ?, updated_at = ?, sync_status = ? WHERE client_id = ?",
                    arguments: [
                        serverExpense.id,
                        serverExpense.categoryId,
                        serverExpense.updatedAt,
                        RecordSyncStatus.synced.rawValue,
                        serverExpense.clientId,
                    ]
                )
            } else {
                try db.execute(
                    sql: "UPDATE expenses SET category_id = ?, updated_at = ?, sync_status = ? WHERE client_id = ?",
                    arguments: [
                        serverExpense.categoryId,
                        serverExpense.updatedAt,
                        RecordSyncStatus.synced.rawValue,
                        serverExpense.clientId,
                    ]
                )
            }
        }
    }

    // MARK: - Pull upserts

    private func upsertCategory(_ serverCategory: PullCategory, in db: Database) throws {
        let localCategory = try Category
            .filter(Category.Columns.clientId == serverCategory.clientId)
            .fetchOne(db)

        if let localCategory {
            if localCategory.id != serverCategory.id {
                try updateExpenseCategoryReferences(from: localCategory.id, to: serverCategory.id, in: db)
            }

            try db.execute(
                sql: """
                    UPDATE categories
                    SET id = ?, name = ?, icon = ?, budget = ?,
                        created_at = ?, updated_at = ?, deleted_at = ?, sync_status = ?
                    WHERE client_id = ?
                    """,
                arguments: [
                    serverCategory.id,
                    serverCategory.name,
                    serverCategory.icon,
                    serverCategory.budget,
                    serverCategory.createdAt,
                    serverCategory.updatedAt,
                    serverCategory.deletedAt,
                    RecordSyncStatus.synced.rawValue,
                    serverCategory.clientId,
                ]
            )
            return
        }

        let category = Category(
            id: serverCategory.id,
            clientId: serverCategory.clientId,
            name: serverCategory.name,
            icon: serverCategory.icon,
            budget: serverCategory.budget,
            createdAt: serverCategory.createdAt,
            updatedAt: serverCategory.updatedAt,
            deletedAt: serverCategory.deletedAt,
            syncStatus: RecordSyncStatus.synced.rawValue
        )
        try category.insert(db)
    }

    private func upsertExpense(_ serverExpense: PullExpense, in db: Database) throws {
        let localExpense = try Expense
            .filter(Expense.Columns.clientId == serverExpense.clientId)
            .fetchOne(db)

        if localExpense != nil {
            try db.execute(
                sql: """
                    UPDATE expenses
                    SET id = ?, amount = ?, currency = ?, category_id = ?,
                        description = ?, merchant = ?, date = ?, source = ?,
                        created_at = ?, updated_at = ?, deleted_at = ?, sync_status = ?
                    WHERE client_id = ?
                    """,
                arguments: [
                    serverExpense.id,
                    serverExpense.amount,
                    serverExpense.currency,
                    serverExpense.categoryId,
                    serverExpense.description,
                    serverExpense.merchant,
                    serverExpense.date,
                    serverExpense.source,
                    serverExpense.createdAt,
                    serverExpense.updatedAt,
                    serverExpense.deletedAt,
                    RecordSyncStatus.synced.rawValue,
                    serverExpense.clientId,
                ]
            )
            return
        }

        let expense = Expense(
            id: serverExpense.id,
            clientId: serverExpense.clientId,
            amount: serverExpense.amount,
            currency: serverExpense.currency,
            categoryId: serverExpense.categoryId,
            description: serverExpense.description,
            merchant: serverExpense.merchant,
            date: serverExpense.date,
            source: serverExpense.source,
            createdAt: serverExpense.createdAt,
            updatedAt: serverExpense.updatedAt,
            deletedAt: serverExpense.deletedAt,
            syncStatus: RecordSyncStatus.synced.rawValue
        )
        try expense.insert(db)
    }

    private func updateExpenseCategoryReferences(from oldCategoryId: String, to newCategoryId: String, in db: Database) throws {
        try db.execute(
            sql: "UPDATE expenses SET category_id = ? WHERE category_id = ?",
            arguments: [newCategoryId, oldCategoryId]
        )
    }
}

// MARK: - Pending changes

struct PendingPushChanges {
    let expenses: [Expense]
    let categories: [Category]

    var hasChanges: Bool {
        !expenses.isEmpty || !categories.isEmpty
    }

    var request: PushRequest {
        PushRequest(
            expenses: expenses.map(PushExpense.init),
            categories: categories.map(PushCategory.init)
        )
    }
}
