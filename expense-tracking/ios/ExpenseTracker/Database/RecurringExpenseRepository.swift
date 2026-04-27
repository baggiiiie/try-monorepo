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
        let nextRunDate = RecurringExpenseSchedule.nextRunTimestamp(
            after: nil,
            frequency: draft.frequency,
            dayOfMonth: draft.dayOfMonth,
            startDate: AppDateFormatter.date(fromUnixTimestamp: draft.startDate)
        )

        try dbQueue.write { db in
            if var existingRecurringExpense {
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
                try existingRecurringExpense.update(db)
                return
            }

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
                deletedAt: nil
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
            try recurringExpense.update(db)
        }
    }

    @discardableResult
    func materializeDueExpenses(now: Date = Date(), calendar: Calendar = .current) throws -> Int {
        let today = calendar.startOfDay(for: now)
        let todayTimestamp = AppDateFormatter.unixTimestamp(from: today)
        var createdCount = 0

        try dbQueue.write { db in
            let dueRecurringExpenses = try RecurringExpense
                .filter(RecurringExpense.Columns.deletedAt == nil)
                .filter(RecurringExpense.Columns.nextRunDate <= todayTimestamp)
                .filter(sql: "end_date IS NULL OR end_date >= next_run_date")
                .fetchAll(db)

            for recurringExpense in dueRecurringExpenses {
                var workingRecurringExpense = recurringExpense
                var nextRunDate = AppDateFormatter.date(fromUnixTimestamp: workingRecurringExpense.nextRunDate)
                let frequency = RecurringFrequency(rawValue: workingRecurringExpense.frequency) ?? .monthly
                var guardCount = 0

                while calendar.startOfDay(for: nextRunDate) <= today && guardCount < 120 {
                    let occurrenceDate = calendar.startOfDay(for: nextRunDate)
                    let occurrenceTimestamp = AppDateFormatter.unixTimestamp(from: occurrenceDate)

                    if let endDateTimestamp = workingRecurringExpense.endDate,
                       occurrenceTimestamp > endDateTimestamp {
                        break
                    }

                    let existingRunCount = try RecurringExpenseRun
                        .filter(Column("recurring_expense_id") == workingRecurringExpense.id)
                        .filter(Column("occurrence_date") == occurrenceTimestamp)
                        .fetchCount(db)

                    if existingRunCount == 0 {
                        let now = Int64(Date().timeIntervalSince1970)
                        let expense = Expense(
                            id: UUID().uuidString,
                            amount: workingRecurringExpense.amount,
                            currency: workingRecurringExpense.currency,
                            categoryId: workingRecurringExpense.categoryId,
                            description: workingRecurringExpense.description,
                            merchant: workingRecurringExpense.merchant,
                            date: occurrenceTimestamp,
                            source: ExpenseSource.recurring.rawValue,
                            createdAt: now,
                            updatedAt: now,
                            deletedAt: nil
                        )
                        try expense.insert(db)

                        let run = RecurringExpenseRun(
                            id: UUID().uuidString,
                            recurringExpenseId: workingRecurringExpense.id,
                            expenseId: expense.id,
                            occurrenceDate: occurrenceTimestamp,
                            createdAt: now
                        )
                        try run.insert(db)
                        createdCount += 1
                    }

                    workingRecurringExpense.lastRunDate = occurrenceTimestamp
                    nextRunDate = RecurringExpenseSchedule.nextRunDate(
                        after: occurrenceDate,
                        frequency: frequency,
                        dayOfMonth: workingRecurringExpense.dayOfMonth,
                        startDate: AppDateFormatter.date(fromUnixTimestamp: workingRecurringExpense.startDate),
                        calendar: calendar
                    )
                    workingRecurringExpense.nextRunDate = AppDateFormatter.unixTimestamp(from: nextRunDate)
                    guardCount += 1
                }

                workingRecurringExpense.updatedAt = Int64(Date().timeIntervalSince1970)
                try workingRecurringExpense.update(db)
            }
        }

        return createdCount
    }
}
