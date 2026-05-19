import Foundation

@MainActor
final class AddEditExpenseViewModel: ObservableObject {
    let existingExpense: Expense?
    let walletSuggestion: WalletSuggestion?

    @Published var amountText = ""
    @Published var selectedCategoryId = ""
    @Published var merchant = ""
    @Published var descriptionText = ""
    @Published var date = Date()
    @Published var categories: [Category] = []

    private let categoryRepository: CategoryRepository
    private let expenseRepository: ExpenseRepository

    init(database: AppDatabase, expense: Expense?, walletSuggestion: WalletSuggestion? = nil) {
        self.existingExpense = expense
        self.walletSuggestion = walletSuggestion
        self.categoryRepository = database.categoryRepository
        self.expenseRepository = database.expenseRepository

        loadCategories()
        populateForm(expense: expense, walletSuggestion: walletSuggestion)
    }

    var selectedCategory: Category? {
        categories.first { $0.id == selectedCategoryId }
    }

    var amountDisplay: String {
        amountText.isEmpty ? "0.00" : amountText
    }

    var formattedDate: String {
        AppDateFormatter.relativeExpenseDateString(from: date)
    }

    var formattedTime: String {
        AppDateFormatter.shortTimeString(from: date)
    }

    var validationMessage: String? {
        guard let amountInCents = MoneyFormatter.cents(fromDecimalString: amountText), amountInCents > 0 else {
            return "Enter an amount"
        }

        guard !selectedCategoryId.isEmpty else {
            return "Pick a category"
        }

        return nil
    }

    func appendDigit(_ digit: String) {
        guard digit.count == 1, digit.first?.isNumber == true else { return }

        var digits = digitsOnlyAmount
        if digits == "0" {
            digits = ""
        }

        guard digits.count < 9 else { return }

        digits.append(digit)
        amountText = Self.amountString(fromDigits: digits)
    }

    func deleteLastDigit() {
        var digits = digitsOnlyAmount
        guard !digits.isEmpty else {
            amountText = "0.00"
            return
        }

        digits.removeLast()
        amountText = Self.amountString(fromDigits: digits)
    }

    func save() throws {
        guard let amountInCents = MoneyFormatter.cents(fromDecimalString: amountText), amountInCents > 0 else {
            throw AddEditExpenseError.invalidAmount
        }

        let draft = ExpenseDraft(
            amount: amountInCents,
            currency: "SGD",
            categoryId: selectedCategoryId,
            description: descriptionText,
            merchant: merchant,
            date: AppDateFormatter.unixTimestamp(from: date),
            source: defaultSource
        )

        try expenseRepository.save(draft, editing: existingExpense, from: walletSuggestion)
    }

    private var defaultSource: ExpenseSource {
        walletSuggestion == nil ? .manual : .shortcut
    }

    private var digitsOnlyAmount: String {
        let digits = amountText.filter(\.isWholeNumber)
        return digits.isEmpty ? "0" : digits
    }

    private func populateForm(expense: Expense?, walletSuggestion: WalletSuggestion?) {
        if let expense {
            amountText = MoneyFormatter.decimalString(fromCents: expense.amount)
            selectedCategoryId = expense.categoryId
            merchant = expense.merchant
            descriptionText = expense.description
            date = AppDateFormatter.date(fromUnixTimestamp: expense.date)
            return
        }

        guard let walletSuggestion else { return }

        if let amount = walletSuggestion.amount, amount > 0 {
            amountText = MoneyFormatter.decimalString(fromCents: amount)
        }

        merchant = walletSuggestion.merchant
        date = AppDateFormatter.date(fromUnixTimestamp: walletSuggestion.capturedAt)
    }

    private func loadCategories() {
        do {
            categories = try categoryRepository.fetchActive()

            if selectedCategoryId.isEmpty {
                let defaultId = UserDefaults.standard.string(forKey: "defaultCategoryId") ?? ""
                if !defaultId.isEmpty, categories.contains(where: { $0.id == defaultId }) {
                    selectedCategoryId = defaultId
                } else if let firstCategory = categories.first {
                    selectedCategoryId = firstCategory.id
                }
            }
        } catch {
            print("Error loading categories: \(error)")
        }
    }

    private static func amountString(fromDigits digits: String) -> String {
        let normalizedDigits = digits.isEmpty ? "0" : digits
        let cents = Int64(normalizedDigits) ?? 0
        return MoneyFormatter.decimalString(fromCents: cents)
    }
}

private enum AddEditExpenseError: LocalizedError {
    case invalidAmount

    var errorDescription: String? {
        switch self {
        case .invalidAmount:
            return "Enter an amount"
        }
    }
}
