import SwiftUI

@main
struct ExpenseTrackerApp: App {
    let database: AppDatabase

    init() {
        do {
            let path = Self.databasePath()
            database = try AppDatabase(path: path)
        } catch {
            fatalError("Database initialization failed: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            TabView {
                ExpenseFeedView(database: database)
                    .tabItem {
                        Label("Expenses", systemImage: "list.bullet")
                    }

                CategoryListView(database: database)
                    .tabItem {
                        Label("Categories", systemImage: "tag")
                    }

                SettingsView()
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
