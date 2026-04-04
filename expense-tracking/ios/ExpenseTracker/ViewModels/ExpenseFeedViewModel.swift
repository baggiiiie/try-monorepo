import Foundation
import GRDB
import Combine

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
class ExpenseFeedViewModel: ObservableObject {
    let database: AppDatabase
    @Published var groupedExpenses: [ExpenseGroup] = []

    init(database: AppDatabase) {
        self.database = database
        refresh()
    }

    func refresh() {
        do {
            let items = try database.dbQueue.read { db in
                let request = Expense
                    .filter(Expense.Columns.deletedAt == nil)
                    .order(Expense.Columns.date.desc, Expense.Columns.createdAt.desc)

                let expenses = try request.fetchAll(db)

                return try expenses.map { expense in
                    let category = try Category.fetchOne(db, key: expense.categoryId)
                    return ExpenseWithCategory(
                        expense: expense,
                        categoryName: category?.name ?? "Unknown",
                        categoryIcon: category?.icon ?? "📦"
                    )
                }
            }

            let calendar = Calendar.current
            let formatter = DateFormatter()
            formatter.dateStyle = .medium

            let grouped = Dictionary(grouping: items) { item -> String in
                let date = Date(timeIntervalSince1970: TimeInterval(item.expense.date))
                let components = calendar.dateComponents([.year, .month, .day], from: date)
                return "\(components.year!)-\(String(format: "%02d", components.month!))-\(String(format: "%02d", components.day!))"
            }

            self.groupedExpenses = grouped
                .sorted { $0.key > $1.key }
                .map { key, value in
                    let isoFormatter = DateFormatter()
                    isoFormatter.dateFormat = "yyyy-MM-dd"
                    let date = isoFormatter.date(from: key) ?? Date()

                    return ExpenseGroup(
                        date: key,
                        displayDate: formatter.string(from: date),
                        expenses: value
                    )
                }
        } catch {
            print("Error loading expenses: \(error)")
        }
    }
}
