import SwiftUI

@main
struct ExpenseTrackerApp: App {
    let database: AppDatabase
    @StateObject private var syncService: SyncService

    init() {
        let db: AppDatabase
        do {
            let path = Self.databasePath()
            db = try AppDatabase(path: path)
        } catch {
            fatalError("Database initialization failed: \(error)")
        }
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

    private static func databasePath() -> String {
        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return documentsURL.appendingPathComponent("expense-tracker.sqlite").path
    }
}
