import SwiftUI

@main
struct ExpenseTrackerApp: App {
    let database: AppDatabase
    @StateObject private var syncService: SyncService

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

                SettingsView(syncService: syncService)
                    .tabItem {
                        Label("Settings", systemImage: "gear")
                    }
            }
        }
    }

}
