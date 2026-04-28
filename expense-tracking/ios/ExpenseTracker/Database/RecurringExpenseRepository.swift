import Foundation
import GRDB

struct RecurringExpenseWithCategory: Identifiable {
    let recurringExpense: RecurringExpense
    let categoryName: String
    let categoryIcon: String

    var id: String { recurringExpense.id }
}

struct RecurringExpenseRepository {
    let dbQueue: DatabaseQueue

    func fetchActive() throws -> [RecurringExpenseWithCategory] {
        try dbQueue.read { db in
            let recurringExpenses = try RecurringExpense
                .filter(RecurringExpense.Columns.deletedAt == nil)
                .order(RecurringExpense.Columns.nextRunDate, RecurringExpense.Columns.createdAt.desc)
                .fetchAll(db)

            let categoryIds = Set(recurringExpenses.map(\.categoryId))
            let categories = try Category
                .filter(categoryIds.contains(Category.Columns.id))
                .fetchAll(db)
            let categoryMap = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })

            return recurringExpenses.map { recurringExpense in
                let category = categoryMap[recurringExpense.categoryId]
                return RecurringExpenseWithCategory(
                    recurringExpense: recurringExpense,
                    categoryName: category?.name ?? "Unknown",
                    categoryIcon: category?.displayIcon ?? "repeat"
                )
            }
        }
    }

    func save(_ draft: RecurringExpenseDraft, editing existingRecurringExpense: RecurringExpense?) throws {
        let now = Int64(Date().timeIntervalSince1970)
        try dbQueue.write { db in
            if var existingRecurringExpense {
                let scheduleChanged = existingRecurringExpense.frequency != draft.frequency.rawValue ||
                    existingRecurringExpense.dayOfMonth != draft.dayOfMonth ||
                    existingRecurringExpense.startDate != draft.startDate
                let nextRunDate = scheduleChanged ? RecurringExpenseSchedule.nextRunTimestamp(
                    after: existingRecurringExpense.lastRunDate.map { AppDateFormatter.date(fromUnixTimestamp: $0) },
                    frequency: draft.frequency,
                    dayOfMonth: draft.dayOfMonth,
                    startDate: AppDateFormatter.date(fromUnixTimestamp: draft.startDate)
                ) : existingRecurringExpense.nextRunDate
                existingRecurringExpense.amount = draft.amount
                existingRecurringExpense.currency = draft.currency
                existingRecurringExpense.categoryId = draft.categoryId
                existingRecurringExpense.description = draft.description
                existingRecurringExpense.merchant = draft.merchant
                existingRecurringExpense.frequency = draft.frequency.rawValue
                existingRecurringExpense.dayOfMonth = draft.dayOfMonth
                existingRecurringExpense.startDate = draft.startDate
                existingRecurringExpense.endDate = draft.endDate
                existingRecurringExpense.nextRunDate = nextRunDate
                existingRecurringExpense.updatedAt = now
                existingRecurringExpense.syncStatus = RecordSyncStatus.pendingPush.rawValue
                try existingRecurringExpense.update(db)
                return
            }

            let nextRunDate = RecurringExpenseSchedule.nextRunTimestamp(
                after: nil,
                frequency: draft.frequency,
                dayOfMonth: draft.dayOfMonth,
                startDate: AppDateFormatter.date(fromUnixTimestamp: draft.startDate)
            )

            let recurringExpense = RecurringExpense(
                id: UUID().uuidString,
                amount: draft.amount,
                currency: draft.currency,
                categoryId: draft.categoryId,
                description: draft.description,
                merchant: draft.merchant,
                frequency: draft.frequency.rawValue,
                dayOfMonth: draft.dayOfMonth,
                startDate: draft.startDate,
                endDate: draft.endDate,
                nextRunDate: nextRunDate,
                lastRunDate: nil,
                createdAt: now,
                updatedAt: now,
                deletedAt: nil,
                syncStatus: RecordSyncStatus.pendingPush.rawValue
            )
            try recurringExpense.insert(db)
        }
    }

    func softDelete(_ recurringExpense: RecurringExpense) throws {
        let deletedAt = Int64(Date().timeIntervalSince1970)

        try dbQueue.write { db in
            var recurringExpense = recurringExpense
            recurringExpense.deletedAt = deletedAt
            recurringExpense.updatedAt = deletedAt
            recurringExpense.syncStatus = RecordSyncStatus.pendingPush.rawValue
            try recurringExpense.update(db)
        }
    }
}
