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
            let recurringExpenses = try RecurringExpense
                .filter(RecurringExpense.Columns.syncStatus == RecordSyncStatus.pendingPush.rawValue)
                .fetchAll(db)
            let walletSuggestions = try WalletSuggestion
                .filter(WalletSuggestion.Columns.syncStatus == RecordSyncStatus.pendingPush.rawValue)
                .fetchAll(db)
            return PendingPushChanges(
                expenses: expenses,
                categories: categories,
                recurringExpenses: recurringExpenses,
                walletSuggestions: walletSuggestions
            )
        }
    }

    func applyPushResponse(_ response: PushResponse) throws {
        try dbQueue.write { db in
            for category in response.categories {
                try markCategorySynced(category, in: db)
            }
            for recurringExpense in response.recurringExpenses {
                try markRecurringExpenseSynced(recurringExpense, in: db)
            }
            for expense in response.expenses {
                try markExpenseSynced(expense, in: db)
            }
            for suggestion in response.walletSuggestions {
                try markWalletSuggestionSynced(suggestion, in: db)
            }
        }
    }

    func applyPullResponse(_ response: PullResponse) throws {
        try dbQueue.write { db in
            for category in response.categories {
                try upsertCategory(category, in: db)
            }
            for recurringExpense in response.recurringExpenses {
                try upsertRecurringExpense(recurringExpense, in: db)
            }
            for expense in response.expenses {
                try upsertExpense(expense, in: db)
            }
            for suggestion in response.walletSuggestions {
                try upsertWalletSuggestion(suggestion, in: db)
            }
        }
    }

    // MARK: - Push reconciliation

    private func markCategorySynced(_ serverCategory: PullCategory, in db: Database) throws {
        try db.execute(
            sql: "UPDATE categories SET updated_at = ?, client_updated_at = ?, sync_status = ? WHERE id = ?",
            arguments: [
                serverCategory.updatedAt,
                serverCategory.clientUpdatedAt,
                RecordSyncStatus.synced.rawValue,
                serverCategory.id,
            ]
        )
    }

    private func markExpenseSynced(_ serverExpense: PullExpense, in db: Database) throws {
        try db.execute(
            sql: "UPDATE expenses SET category_id = ?, updated_at = ?, client_updated_at = ?, sync_status = ? WHERE id = ?",
            arguments: [
                serverExpense.categoryId,
                serverExpense.updatedAt,
                serverExpense.clientUpdatedAt,
                RecordSyncStatus.synced.rawValue,
                serverExpense.id,
            ]
        )
    }

    private func markRecurringExpenseSynced(_ serverRecurringExpense: PullRecurringExpense, in db: Database) throws {
        try db.execute(
            sql: "UPDATE recurring_expenses SET category_id = ?, next_run_date = ?, last_run_date = ?, updated_at = ?, client_updated_at = ?, sync_status = ? WHERE id = ?",
            arguments: [
                serverRecurringExpense.categoryId,
                serverRecurringExpense.nextRunDate,
                serverRecurringExpense.lastRunDate,
                serverRecurringExpense.updatedAt,
                serverRecurringExpense.clientUpdatedAt,
                RecordSyncStatus.synced.rawValue,
                serverRecurringExpense.id,
            ]
        )
    }

    private func markWalletSuggestionSynced(_ serverSuggestion: PullWalletSuggestion, in db: Database) throws {
        try db.execute(
            sql: """
                UPDATE wallet_suggestions
                SET status = ?, linked_expense_id = ?, updated_at = ?, client_updated_at = ?, server_version = ?, sync_status = ?
                WHERE id = ?
                """,
            arguments: [
                serverSuggestion.status,
                serverSuggestion.linkedExpenseId,
                serverSuggestion.updatedAt,
                serverSuggestion.clientUpdatedAt,
                serverSuggestion.serverVersion,
                RecordSyncStatus.synced.rawValue,
                serverSuggestion.id,
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
            clientUpdatedAt: serverCategory.clientUpdatedAt,
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
            clientUpdatedAt: serverExpense.clientUpdatedAt,
            deletedAt: serverExpense.deletedAt,
            syncStatus: RecordSyncStatus.synced.rawValue
        )
        try expense.save(db)
    }

    private func upsertRecurringExpense(_ serverRecurringExpense: PullRecurringExpense, in db: Database) throws {
        let recurringExpense = RecurringExpense(
            id: serverRecurringExpense.id,
            amount: serverRecurringExpense.amount,
            currency: serverRecurringExpense.currency,
            categoryId: serverRecurringExpense.categoryId,
            description: serverRecurringExpense.description,
            merchant: serverRecurringExpense.merchant,
            frequency: serverRecurringExpense.frequency,
            dayOfMonth: serverRecurringExpense.dayOfMonth,
            startDate: serverRecurringExpense.startDate,
            endDate: serverRecurringExpense.endDate,
            nextRunDate: serverRecurringExpense.nextRunDate,
            lastRunDate: serverRecurringExpense.lastRunDate,
            createdAt: serverRecurringExpense.createdAt,
            updatedAt: serverRecurringExpense.updatedAt,
            clientUpdatedAt: serverRecurringExpense.clientUpdatedAt,
            deletedAt: serverRecurringExpense.deletedAt,
            syncStatus: RecordSyncStatus.synced.rawValue
        )
        try recurringExpense.save(db)
    }

    private func upsertWalletSuggestion(_ serverSuggestion: PullWalletSuggestion, in db: Database) throws {
        let suggestion = WalletSuggestion(
            id: serverSuggestion.id,
            amount: serverSuggestion.amount,
            currency: serverSuggestion.currency,
            merchant: serverSuggestion.merchant,
            cardName: serverSuggestion.cardName,
            capturedAt: serverSuggestion.capturedAt,
            source: serverSuggestion.source,
            status: serverSuggestion.status,
            linkedExpenseId: serverSuggestion.linkedExpenseId,
            createdAt: serverSuggestion.createdAt,
            updatedAt: serverSuggestion.updatedAt,
            clientUpdatedAt: serverSuggestion.clientUpdatedAt,
            serverVersion: serverSuggestion.serverVersion,
            syncStatus: RecordSyncStatus.synced.rawValue
        )
        try suggestion.save(db)
    }
}

// MARK: - Pending changes

struct PendingPushChanges {
    let expenses: [Expense]
    let categories: [Category]
    let recurringExpenses: [RecurringExpense]
    let walletSuggestions: [WalletSuggestion]

    var hasChanges: Bool {
        !expenses.isEmpty || !categories.isEmpty || !recurringExpenses.isEmpty || !walletSuggestions.isEmpty
    }

    var request: PushRequest {
        PushRequest(
            expenses: expenses.map(PushExpense.init),
            categories: categories.map(PushCategory.init),
            recurringExpenses: recurringExpenses.map(PushRecurringExpense.init),
            walletSuggestions: walletSuggestions.map(PushWalletSuggestion.init)
        )
    }
}
