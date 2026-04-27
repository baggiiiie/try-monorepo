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

struct RecurringExpenseDraft {
    let amount: Int64
    let currency: String
    let categoryId: String
    let description: String
    let merchant: String
    let frequency: RecurringFrequency
    let dayOfMonth: Int?
    let startDate: Int64
    let endDate: Int64?
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
                clientId: UUID().uuidString,
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
                        let expense = Expense(
                            id: UUID().uuidString,
                            clientId: UUID().uuidString,
                            amount: workingRecurringExpense.amount,
                            currency: workingRecurringExpense.currency,
                            categoryId: workingRecurringExpense.categoryId,
                            description: workingRecurringExpense.description,
                            merchant: workingRecurringExpense.merchant,
                            date: occurrenceTimestamp,
                            source: ExpenseSource.recurring.rawValue,
                            createdAt: Int64(Date().timeIntervalSince1970),
                            updatedAt: Int64(Date().timeIntervalSince1970),
                            deletedAt: nil
                        )
                        try expense.insert(db)

                        let run = RecurringExpenseRun(
                            id: UUID().uuidString,
                            recurringExpenseId: workingRecurringExpense.id,
                            expenseId: expense.id,
                            occurrenceDate: occurrenceTimestamp,
                            createdAt: Int64(Date().timeIntervalSince1970)
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

enum RecurringExpenseSchedule {
    static func nextRunTimestamp(
        after previousRunDate: Date?,
        frequency: RecurringFrequency,
        dayOfMonth: Int?,
        startDate: Date,
        calendar: Calendar = .current
    ) -> Int64 {
        let date = nextRunDateValue(
            after: previousRunDate,
            frequency: frequency,
            dayOfMonth: dayOfMonth,
            startDate: startDate,
            calendar: calendar
        )
        return AppDateFormatter.unixTimestamp(from: date)
    }

    static func nextRunDate(
        after previousRunDate: Date?,
        frequency: RecurringFrequency,
        dayOfMonth: Int?,
        startDate: Date,
        calendar: Calendar = .current
    ) -> Date {
        nextRunDateValue(
            after: previousRunDate,
            frequency: frequency,
            dayOfMonth: dayOfMonth,
            startDate: startDate,
            calendar: calendar
        )
    }

    private static func nextRunDateValue(
        after previousRunDate: Date?,
        frequency: RecurringFrequency,
        dayOfMonth: Int?,
        startDate: Date,
        calendar: Calendar
    ) -> Date {
        let normalizedStartDate = calendar.startOfDay(for: startDate)

        guard let previousRunDate else {
            if frequency == .monthly {
                return firstMonthlyRunDate(onOrAfter: normalizedStartDate, dayOfMonth: dayOfMonth, calendar: calendar)
            }

            return normalizedStartDate
        }

        switch frequency {
        case .weekly:
            return calendar.date(byAdding: .weekOfYear, value: 1, to: calendar.startOfDay(for: previousRunDate)) ?? normalizedStartDate
        case .monthly:
            return nextMonthlyRunDate(after: previousRunDate, dayOfMonth: dayOfMonth, calendar: calendar)
        case .yearly:
            return calendar.date(byAdding: .year, value: 1, to: calendar.startOfDay(for: previousRunDate)) ?? normalizedStartDate
        }
    }

    private static func nextMonthlyRunDate(after previousRunDate: Date, dayOfMonth: Int?, calendar: Calendar) -> Date {
        let previousStart = calendar.startOfDay(for: previousRunDate)
        let targetDay = max(1, min(dayOfMonth ?? calendar.component(.day, from: previousStart), 31))
        guard let nextMonth = calendar.date(byAdding: .month, value: 1, to: previousStart) else {
            return previousStart
        }

        let components = calendar.dateComponents([.year, .month], from: nextMonth)
        let daysInMonth = calendar.range(of: .day, in: .month, for: nextMonth)?.count ?? targetDay

        var nextComponents = DateComponents()
        nextComponents.year = components.year
        nextComponents.month = components.month
        nextComponents.day = min(targetDay, daysInMonth)
        return calendar.date(from: nextComponents) ?? nextMonth
    }

    private static func firstMonthlyRunDate(onOrAfter startDate: Date, dayOfMonth: Int?, calendar: Calendar) -> Date {
        let targetDay = max(1, min(dayOfMonth ?? calendar.component(.day, from: startDate), 31))
        let currentMonthCandidate = monthlyRunDate(inMonthOf: startDate, targetDay: targetDay, calendar: calendar)

        if currentMonthCandidate >= startDate {
            return currentMonthCandidate
        }

        guard let nextMonth = calendar.date(byAdding: .month, value: 1, to: startDate) else {
            return startDate
        }
        return monthlyRunDate(inMonthOf: nextMonth, targetDay: targetDay, calendar: calendar)
    }

    private static func monthlyRunDate(inMonthOf date: Date, targetDay: Int, calendar: Calendar) -> Date {
        let components = calendar.dateComponents([.year, .month], from: date)
        let daysInMonth = calendar.range(of: .day, in: .month, for: date)?.count ?? targetDay

        var runComponents = DateComponents()
        runComponents.year = components.year
        runComponents.month = components.month
        runComponents.day = min(targetDay, daysInMonth)
        return calendar.date(from: runComponents) ?? calendar.startOfDay(for: date)
    }
}
