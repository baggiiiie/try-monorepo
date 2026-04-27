import Foundation
import SwiftUI

struct ExpenseWithCategory: Identifiable {
    let expense: Expense
    let categoryName: String
    let categoryIcon: String

    var id: String { expense.id }

    var categoryColor: Color {
        Self.color(for: categoryName)
    }

    private static let colorMap: [String: Color] = [
        "Food & Dining": .orange,
        "Groceries": .purple,
        "Transport": .blue,
        "Shopping": .pink,
        "Entertainment": .red,
        "Bills": .green,
        "Health": .teal,
        "Other": .gray,
    ]

    private static func color(for name: String) -> Color {
        colorMap[name] ?? .blue
    }
}

struct ExpenseGroup {
    let date: String
    let displayDate: String
    let dailyTotal: String
    let expenses: [ExpenseWithCategory]
}

struct MonthlyExpenseTotal {
    let cents: Int64
    let currency: String

    var amountText: String {
        MoneyFormatter.decimalString(fromCents: cents)
    }
}

@MainActor
final class ExpenseFeedViewModel: ObservableObject {
    @Published var groupedExpenses: [ExpenseGroup] = []
    @Published var monthlyTotal = MonthlyExpenseTotal(cents: 0, currency: "SGD")

    private let expenseRepository: ExpenseRepository
    private let recurringExpenseRepository: RecurringExpenseRepository

    init(database: AppDatabase) {
        self.expenseRepository = database.expenseRepository
        self.recurringExpenseRepository = database.recurringExpenseRepository
        refresh()
    }

    func refresh() {
        do {
            try recurringExpenseRepository.materializeDueExpenses()
            let items = try expenseRepository.fetchFeedItems()
            groupedExpenses = Self.groupExpenses(items)
            monthlyTotal = Self.monthlyTotal(from: items)
        } catch {
            print("Error loading expenses: \(error)")
        }
    }

    private static func groupExpenses(_ items: [ExpenseWithCategory]) -> [ExpenseGroup] {
        let groupedByDay = Dictionary(grouping: items) { item in
            AppDateFormatter.dayKey(from: item.expense.displayDate)
        }

        return groupedByDay
            .sorted { $0.key > $1.key }
            .map { key, value in
                let date = AppDateFormatter.date(fromDayKey: key) ?? Date()
                let totalCents = value.reduce(Int64(0)) { $0 + $1.expense.amount }
                let currency = value.first?.expense.currency ?? "SGD"
                return ExpenseGroup(
                    date: key,
                    displayDate: AppDateFormatter.relativeExpenseDateString(from: date).uppercased(),
                    dailyTotal: "-\(CurrencyFormatter.format(cents: totalCents, currency: currency))",
                    expenses: value
                )
            }
    }

    private static func monthlyTotal(
        from items: [ExpenseWithCategory],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> MonthlyExpenseTotal {
        guard let monthInterval = calendar.dateInterval(of: .month, for: now) else {
            return MonthlyExpenseTotal(cents: 0, currency: "SGD")
        }

        let currentMonthItems = items.filter { item in
            monthInterval.contains(item.expense.displayDate)
        }

        let totalCents = currentMonthItems.reduce(Int64(0)) { $0 + $1.expense.amount }
        let currency = currentMonthItems.first?.expense.currency ?? items.first?.expense.currency ?? "SGD"
        return MonthlyExpenseTotal(cents: totalCents, currency: currency)
    }
}
