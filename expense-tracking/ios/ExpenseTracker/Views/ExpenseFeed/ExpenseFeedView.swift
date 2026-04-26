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
            ScrollView {
                LazyVStack(spacing: 0) {
                    if suggestionsViewModel.pendingCount > 0 {
                        NavigationLink {
                            WalletSuggestionsView(database: database)
                        } label: {
                            HStack {
                                Image(systemName: "creditcard.fill")
                                    .foregroundStyle(.blue)
                                Text("\(suggestionsViewModel.pendingCount) pending suggestion\(suggestionsViewModel.pendingCount == 1 ? "" : "s")")
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding()
                        }
                        .tint(.primary)
                    }

                    ForEach(viewModel.groupedExpenses, id: \.date) { group in
                        VStack(spacing: 0) {
                            HStack {
                                Text(group.displayDate)
                                Spacer()
                                Text(group.dailyTotal)
                            }
                            .font(.system(.callout, design: .rounded).weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal)
                            .padding(.top, 16)
                            .padding(.bottom, 4)

                            Divider()
                                .padding(.horizontal)

                            ForEach(group.expenses) { item in
                                Button {
                                    expenseToEdit = item.expense
                                } label: {
                                    ExpenseRowView(
                                        expense: item.expense,
                                        categoryName: item.categoryName,
                                        categoryIcon: item.categoryIcon,
                                        categoryColor: item.categoryColor
                                    )
                                }
                                .tint(.primary)
                                .padding(.horizontal)
                            }
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
                    SyncStatusIndicator(
                        status: syncService.status,
                        lastSucceededAt: syncService.lastSucceededAt
                    )
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { showingAddExpense = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .refreshable {
                // Safe to await: SyncService runs the work in an unstructured
                // task, so a cancellation of this Task (e.g. user scrolls away
                // from the refresh control) won't abort the request.
                await syncService.sync()
                refreshViewModels()
            }
            .onChange(of: syncService.lastSucceededAt) { _, newValue in
                // After every successful sync, refresh local view models so
                // newly pulled data appears without requiring a manual reload.
                guard newValue != nil else { return }
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
        }
    }

    private func refreshViewModels() {
        viewModel.refresh()
        suggestionsViewModel.refresh()
    }
}
