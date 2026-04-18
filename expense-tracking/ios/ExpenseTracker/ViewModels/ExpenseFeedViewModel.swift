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

@MainActor
final class ExpenseFeedViewModel: ObservableObject {
    @Published var groupedExpenses: [ExpenseGroup] = []

    private let expenseRepository: ExpenseRepository

    init(database: AppDatabase) {
        self.expenseRepository = database.expenseRepository
        refresh()
    }

    func refresh() {
        do {
            let items = try expenseRepository.fetchFeedItems()
            groupedExpenses = Self.groupExpenses(items)
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
}
