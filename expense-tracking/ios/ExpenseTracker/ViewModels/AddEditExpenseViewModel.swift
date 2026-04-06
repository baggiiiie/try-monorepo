import Foundation
import GRDB

@MainActor
class AddEditExpenseViewModel: ObservableObject {
    let database: AppDatabase
    let existingExpense: Expense?

    @Published var amountText: String = ""
    @Published var selectedCategoryId: String = ""
    @Published var merchant: String = ""
    @Published var descriptionText: String = ""
    @Published var date: Date = Date()
    @Published var categories: [Category] = []

    var isValid: Bool {
        guard let amount = Double(amountText), amount > 0 else { return false }
        return !selectedCategoryId.isEmpty
    }

    let walletSuggestion: WalletSuggestion?

    init(database: AppDatabase, expense: Expense?, walletSuggestion: WalletSuggestion? = nil) {
        self.database = database
        self.existingExpense = expense
        self.walletSuggestion = walletSuggestion

        loadCategories()

        if let expense {
            self.amountText = String(format: "%.2f", Double(expense.amount) / 100.0)
            self.selectedCategoryId = expense.categoryId
            self.merchant = expense.merchant
            self.descriptionText = expense.description
            self.date = Date(timeIntervalSince1970: TimeInterval(expense.date))
        } else if let suggestion = walletSuggestion {
            if let amount = suggestion.amount, amount > 0 {
                self.amountText = String(format: "%.2f", Double(amount) / 100.0)
            }
            self.merchant = suggestion.merchant
            self.date = Date(timeIntervalSince1970: TimeInterval(suggestion.date))
        }
    }

    private func loadCategories() {
        do {
            categories = try database.dbQueue.read { db in
                try Category
                    .filter(Category.Columns.deletedAt == nil)
                    .order(Category.Columns.name)
                    .fetchAll(db)
            }
            if selectedCategoryId.isEmpty, let first = categories.first {
                selectedCategoryId = first.id
            }
        } catch {
            print("Error loading categories: \(error)")
        }
    }

    func save() {
        guard let amount = Double(amountText) else { return }
        let amountCents = Int64(amount * 100)
        let now = Int64(Date().timeIntervalSince1970)
        let dateTs = Int64(date.timeIntervalSince1970)

        do {
            try database.dbQueue.write { db in
                if var existing = existingExpense {
                    existing.amount = amountCents
                    existing.categoryId = selectedCategoryId
                    existing.merchant = merchant
                    existing.description = descriptionText
                    existing.date = dateTs
                    existing.updatedAt = now
                    existing.syncStatus = "pending_push"
                    try existing.update(db)
                } else {
                    let source = walletSuggestion != nil ? "shortcut" : "manual"
                    var expense = Expense(
                        id: UUID().uuidString,
                        clientId: UUID().uuidString,
                        amount: amountCents,
                        currency: "SGD",
                        categoryId: selectedCategoryId,
                        description: descriptionText,
                        merchant: merchant,
                        date: dateTs,
                        source: source,
                        createdAt: now,
                        updatedAt: now,
                        deletedAt: nil
                    )
                    try expense.insert(db)

                    if let suggestion = walletSuggestion {
                        try db.execute(
                            sql: "UPDATE wallet_suggestions SET status = 'accepted', linked_expense_id = ? WHERE id = ?",
                            arguments: [expense.id, suggestion.id]
                        )
                    }
                }
            }
        } catch {
            print("Error saving expense: \(error)")
        }
    }
}
