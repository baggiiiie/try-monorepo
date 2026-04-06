import AppIntents

struct ExpenseTrackerShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ImportTransactionIntent(),
            phrases: ["Import transaction in \(.applicationName)"],
            shortTitle: "Import Transaction",
            systemImageName: "creditcard"
        )
    }
}
