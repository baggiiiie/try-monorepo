import Foundation

struct ExpenseWithCategory: Identifiable {
    let expense: Expense
    let categoryName: String
    let categoryIcon: String

    var id: String { expense.id }
}

struct ExpenseGroup {
    let date: String
    let displayDate: String
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
                return ExpenseGroup(
                    date: key,
                    displayDate: AppDateFormatter.mediumDateString(from: date),
                    expenses: value
                )
            }
    }
}
