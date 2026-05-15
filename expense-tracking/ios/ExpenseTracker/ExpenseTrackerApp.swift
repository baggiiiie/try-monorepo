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
            ExpenseFeedView(database: database, syncService: syncService)
                .task {
                    // App-level initial sync. Immune to view-cycle cancellation.
                    await syncService.sync()
                }
                .onChange(of: scenePhase) { _, newPhase in
                    guard newPhase == .active else { return }
                    Task { await syncService.sync() }
                }
        }
    }
}
