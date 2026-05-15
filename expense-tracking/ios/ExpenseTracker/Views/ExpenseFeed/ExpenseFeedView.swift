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
                Section {
                    MonthlyTotalHeader(total: viewModel.monthlyTotal)
                        .padding(.top, 28)
                        .padding(.bottom, 20)
                        .listRowInsets(EdgeInsets())
                        .listRowSeparator(.hidden)
                }

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
                        .tint(.primary)
                        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                    }
                }

                ForEach(viewModel.groupedExpenses, id: \.date) { group in
                    Section {
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
                            .deleteSwipeAction {
                                HapticManager.notify(.warning)
                                viewModel.delete(item.expense)
                            }
                        }
                    } header: {
                        HStack {
                            Text(group.displayDate)
                            Spacer()
                            Text(group.dailyTotal)
                        }
                        .font(.system(.callout, design: .rounded).weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(nil)
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Expenses")
            .emptyState(
                viewModel.groupedExpenses.isEmpty,
                title: "No Expenses",
                systemImage: "tray",
                description: "Tap + to add your first expense"
            )
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    SyncStatusIndicator(
                        status: syncService.status,
                        lastSucceededAt: syncService.lastSucceededAt
                    )
                }
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink {
                        SettingsView(database: database, syncService: syncService)
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .safeAreaInset(edge: .bottom, alignment: .trailing) {
                addExpenseButton
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

    private var addExpenseButton: some View {
        Button {
            showingAddExpense = true
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 60, height: 60)
                .background(Color.accentColor)
                .clipShape(Circle())
                .shadow(color: .black.opacity(0.18), radius: 8, x: 0, y: 4)
        }
        .padding(.trailing, 20)
        .padding(.bottom, 8)
        .accessibilityLabel("Add Expense")
    }

    private func refreshViewModels() {
        viewModel.refresh()
        suggestionsViewModel.refresh()
    }
}

private struct MonthlyTotalHeader: View {
    let total: MonthlyExpenseTotal

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Text("Spent")
                    .fontWeight(.semibold)

                Text("this month")
                    .fontWeight(.semibold)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 2)
                    .background(
                        Capsule()
                            .stroke(Color(.systemGray5), lineWidth: 1)
                    )
            }
            .font(.system(.title3, design: .rounded))

            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(total.currency)
                    .font(.system(size: 32, weight: .regular, design: .rounded))
                    .foregroundStyle(.secondary)

                Text(total.amountText)
                    .font(.system(size: 48, weight: .regular, design: .rounded))
                    .minimumScaleFactor(0.72)
                    .lineLimit(1)
            }
            .monospacedDigit()
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Spent this month \(total.currency) \(total.amountText)")
    }
}
