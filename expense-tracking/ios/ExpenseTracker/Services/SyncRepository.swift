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
            for category in response.categories {
                try markCategorySynced(category, in: db)
            }
            for expense in response.expenses {
                try markExpenseSynced(expense, in: db)
            }
        }
    }

    func applyPullResponse(_ response: PullResponse) throws {
        try dbQueue.write { db in
            for category in response.categories {
                try upsertCategory(category, in: db)
            }
            for expense in response.expenses {
                try upsertExpense(expense, in: db)
            }
        }
    }

    // MARK: - Push reconciliation

    private func markCategorySynced(_ serverCategory: PullCategory, in db: Database) throws {
        try db.execute(
            sql: "UPDATE categories SET updated_at = ?, sync_status = ? WHERE id = ?",
            arguments: [
                serverCategory.updatedAt,
                RecordSyncStatus.synced.rawValue,
                serverCategory.id,
            ]
        )
    }

    private func markExpenseSynced(_ serverExpense: PullExpense, in db: Database) throws {
        try db.execute(
            sql: "UPDATE expenses SET category_id = ?, updated_at = ?, sync_status = ? WHERE id = ?",
            arguments: [
                serverExpense.categoryId,
                serverExpense.updatedAt,
                RecordSyncStatus.synced.rawValue,
                serverExpense.id,
            ]
        )
    }

    // MARK: - Pull upserts

    private func upsertCategory(_ serverCategory: PullCategory, in db: Database) throws {
        let category = Category(
            id: serverCategory.id,
            name: serverCategory.name,
            icon: serverCategory.icon,
            budget: serverCategory.budget,
            createdAt: serverCategory.createdAt,
            updatedAt: serverCategory.updatedAt,
            deletedAt: serverCategory.deletedAt,
            syncStatus: RecordSyncStatus.synced.rawValue
        )
        try category.save(db)
    }

    private func upsertExpense(_ serverExpense: PullExpense, in db: Database) throws {
        let expense = Expense(
            id: serverExpense.id,
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
        try expense.save(db)
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
