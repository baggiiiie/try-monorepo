import SwiftUI

struct ExpenseFeedView: View {
    let database: AppDatabase
    @StateObject private var viewModel: ExpenseFeedViewModel
    @StateObject private var suggestionsViewModel: WalletSuggestionsViewModel
    @ObservedObject var syncService: SyncService
    @State private var showingAddExpense = false
    @State private var expenseToEdit: Expense?

    init(database: AppDatabase, syncService: SyncService) {
        self.database = database
        _viewModel = StateObject(wrappedValue: ExpenseFeedViewModel(database: database))
        _suggestionsViewModel = StateObject(wrappedValue: WalletSuggestionsViewModel(database: database))
        self.syncService = syncService
    }

    var body: some View {
        NavigationStack {
            List {
                if suggestionsViewModel.pendingCount > 0 {
                    Section {
                        NavigationLink {
                            WalletSuggestionsView(database: database)
                        } label: {
                            HStack {
                                Image(systemName: "creditcard.fill")
                                    .foregroundStyle(.blue)
                                Text("\(suggestionsViewModel.pendingCount) pending suggestion\(suggestionsViewModel.pendingCount == 1 ? "" : "s")")
                                Spacer()
                            }
                        }
                    }
                }
                ForEach(viewModel.groupedExpenses, id: \.date) { group in
                    Section(header: Text(group.displayDate)) {
                        ForEach(group.expenses) { item in
                            Button {
                                expenseToEdit = item.expense
                            } label: {
                                ExpenseRowView(
                                    expense: item.expense,
                                    categoryName: item.categoryName,
                                    categoryIcon: item.categoryIcon
                                )
                            }
                            .tint(.primary)
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
                refreshViewModels()
            }
            .sheet(isPresented: $showingAddExpense) {
                AddEditExpenseView(database: database, expense: nil)
                    .onDisappear(perform: refreshViewModels)
            }
            .sheet(item: $expenseToEdit) { expense in
                AddEditExpenseView(database: database, expense: expense)
                    .onDisappear(perform: refreshViewModels)
            }
            .onAppear(perform: refreshViewModels)
            .task {
                await syncService.sync()
                refreshViewModels()
            }
        }
    }

    private func refreshViewModels() {
        viewModel.refresh()
        suggestionsViewModel.refresh()
    }
}
