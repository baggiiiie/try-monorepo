import SwiftUI
import GRDB

struct ExpenseFeedView: View {
    @StateObject private var viewModel: ExpenseFeedViewModel
    @ObservedObject var syncService: SyncService
    @State private var showingAddExpense = false

    init(database: AppDatabase, syncService: SyncService) {
        _viewModel = StateObject(wrappedValue: ExpenseFeedViewModel(database: database))
        self.syncService = syncService
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
                ToolbarItem(placement: .topBarLeading) {
                    if syncService.isSyncing {
                        ProgressView()
                    } else if let error = syncService.lastSyncError {
                        Image(systemName: "exclamationmark.arrow.trianglehead.2.clockwise.rotate.90")
                            .foregroundStyle(.red)
                            .help(error)
                    } else if syncService.lastSyncTime != nil {
                        Image(systemName: "checkmark.icloud")
                            .foregroundStyle(.green)
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { showingAddExpense = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .refreshable {
                await syncService.sync()
                viewModel.refresh()
            }
            .sheet(isPresented: $showingAddExpense) {
                AddEditExpenseView(database: viewModel.database, expense: nil)
                    .onDisappear { viewModel.refresh() }
            }
            .onAppear { viewModel.refresh() }
            .task {
                await syncService.sync()
                viewModel.refresh()
            }
        }
    }
}
