import SwiftUI
import GRDB

struct ExpenseFeedView: View {
    @StateObject private var viewModel: ExpenseFeedViewModel
    @State private var showingAddExpense = false

    init(database: AppDatabase) {
        _viewModel = StateObject(wrappedValue: ExpenseFeedViewModel(database: database))
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(viewModel.groupedExpenses, id: \.date) { group in
                    Section(header: Text(group.displayDate)) {
                        ForEach(group.expenses) { item in
                            ExpenseRowView(
                                expense: item.expense,
                                categoryName: item.categoryName,
                                categoryIcon: item.categoryIcon
                            )
                        }
                    }
                }
            }
            .navigationTitle("Expenses")
            .overlay {
                if viewModel.groupedExpenses.isEmpty {
                    ContentUnavailableView(
                        "No Expenses",
                        systemImage: "tray",
                        description: Text("Tap + to add your first expense")
                    )
                }
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingAddExpense = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddExpense) {
                AddEditExpenseView(database: viewModel.database, expense: nil)
                    .onDisappear { viewModel.refresh() }
            }
            .onAppear { viewModel.refresh() }
        }
    }
}
