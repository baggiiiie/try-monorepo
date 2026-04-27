import Foundation
import GRDB

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

    func softDelete(_ expense: Expense) throws {
        let deletedAt = Int64(Date().timeIntervalSince1970)

        try dbQueue.write { db in
            var expense = expense
            expense.deletedAt = deletedAt
            expense.updatedAt = deletedAt
            expense.syncStatus = RecordSyncStatus.pendingPush.rawValue
            try expense.update(db)
        }
    }
}
