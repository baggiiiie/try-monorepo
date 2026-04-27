import SwiftUI

@main
struct ExpenseTrackerApp: App {
    let database: AppDatabase
    @StateObject private var syncService: SyncService
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let db = AppDatabase.shared
        self.database = db
        _syncService = StateObject(wrappedValue: SyncService(database: db))
    }

    var body: some Scene {
        WindowGroup {
            TabView {
                ExpenseFeedView(database: database, syncService: syncService)
                    .tabItem {
                        Label("Expenses", systemImage: "list.bullet")
                    }

                WalletSuggestionsView(database: database)
                    .tabItem {
                        Label("Wallet", systemImage: "creditcard")
                    }

                CategoryListView(database: database)
                    .tabItem {
                        Label("Categories", systemImage: "tag")
                    }

                RecurringExpensesView(database: database)
                    .tabItem {
                        Label("Recurring", systemImage: "repeat")
                    }

                SettingsView(syncService: syncService)
                    .tabItem {
                        Label("Settings", systemImage: "gear")
                    }
            }
            .task {
                materializeDueRecurringExpenses()
                // App-level initial sync. Lives across tab switches and is
                // immune to view-cycle cancellation.
                await syncService.sync()
            }
            .onChange(of: scenePhase) { _, newPhase in
                guard newPhase == .active else { return }
                materializeDueRecurringExpenses()
                Task { await syncService.sync() }
            }
        }
    }

    private func materializeDueRecurringExpenses() {
        do {
            try database.recurringExpenseRepository.materializeDueExpenses()
        } catch {
            print("Error materializing recurring expenses: \(error)")
        }
    }
}
