import Foundation

@MainActor
final class RecurringExpensesViewModel: ObservableObject {
    @Published var recurringExpenses: [RecurringExpenseWithCategory] = []
    @Published var categories: [Category] = []
    @Published var amountText = ""
    @Published var selectedCategoryId = ""
    @Published var merchant = ""
    @Published var descriptionText = ""
    @Published var frequency: RecurringFrequency = .monthly
    @Published var dayOfMonth = Calendar.current.component(.day, from: Date())
    @Published var startDate = Date()
    @Published var endDate: Date?

    private let categoryRepository: CategoryRepository
    private let recurringExpenseRepository: RecurringExpenseRepository
    private var editingRecurringExpense: RecurringExpense?

    init(database: AppDatabase) {
        self.categoryRepository = database.categoryRepository
        self.recurringExpenseRepository = database.recurringExpenseRepository
        refresh()
        resetForm()
    }

    var isEditing: Bool {
        editingRecurringExpense != nil
    }

    var selectedCategory: Category? {
        categories.first { $0.id == selectedCategoryId }
    }

    var validationMessage: String? {
        guard let amount = MoneyFormatter.cents(fromDecimalString: amountText), amount > 0 else {
            return "Enter an amount"
        }

        guard !selectedCategoryId.isEmpty else {
            return "Pick a category"
        }

        if let endDate, Calendar.current.startOfDay(for: endDate) < Calendar.current.startOfDay(for: startDate) {
            return "End date must be after start date"
        }

        return nil
    }

    func refresh() {
        do {
            recurringExpenses = try recurringExpenseRepository.fetchActive()
            categories = try categoryRepository.fetchActive()
        } catch {
            print("Error loading recurring expenses: \(error)")
        }
    }

    func edit(_ recurringExpense: RecurringExpense) {
        editingRecurringExpense = recurringExpense
        amountText = MoneyFormatter.decimalString(fromCents: recurringExpense.amount)
        selectedCategoryId = recurringExpense.categoryId
        merchant = recurringExpense.merchant
        descriptionText = recurringExpense.description
        frequency = RecurringFrequency(rawValue: recurringExpense.frequency) ?? .monthly
        dayOfMonth = recurringExpense.dayOfMonth ?? Calendar.current.component(.day, from: Date())
        startDate = AppDateFormatter.date(fromUnixTimestamp: recurringExpense.startDate)
        endDate = recurringExpense.endDate.map { AppDateFormatter.date(fromUnixTimestamp: $0) }
    }

    func resetForm() {
        editingRecurringExpense = nil
        amountText = ""
        selectedCategoryId = categories.first?.id ?? ""
        merchant = ""
        descriptionText = ""
        frequency = .monthly
        dayOfMonth = Calendar.current.component(.day, from: Date())
        startDate = Date()
        endDate = nil
    }

    func save() throws {
        guard let amount = MoneyFormatter.cents(fromDecimalString: amountText), amount > 0 else {
            throw RecurringExpenseFormError.invalidAmount
        }

        guard !selectedCategoryId.isEmpty else {
            throw RecurringExpenseFormError.missingCategory
        }

        let normalizedStartDate = Calendar.current.startOfDay(for: startDate)
        let normalizedEndDate = endDate.map { Calendar.current.startOfDay(for: $0) }
        if let normalizedEndDate, normalizedEndDate < normalizedStartDate {
            throw RecurringExpenseFormError.invalidEndDate
        }

        let draft = RecurringExpenseDraft(
            amount: amount,
            currency: "SGD",
            categoryId: selectedCategoryId,
            description: descriptionText,
            merchant: merchant,
            frequency: frequency,
            dayOfMonth: frequency == .monthly ? dayOfMonth : nil,
            startDate: AppDateFormatter.unixTimestamp(from: normalizedStartDate),
            endDate: normalizedEndDate.map(AppDateFormatter.unixTimestamp(from:))
        )

        try recurringExpenseRepository.save(draft, editing: editingRecurringExpense)
        refresh()
        resetForm()
    }

    func delete(_ recurringExpense: RecurringExpense) {
        do {
            try recurringExpenseRepository.softDelete(recurringExpense)
            refresh()
        } catch {
            print("Error deleting recurring expense: \(error)")
        }
    }
}

private enum RecurringExpenseFormError: LocalizedError {
    case invalidAmount
    case missingCategory
    case invalidEndDate

    var errorDescription: String? {
        switch self {
        case .invalidAmount:
            return "Enter an amount"
        case .missingCategory:
            return "Pick a category"
        case .invalidEndDate:
            return "End date must be after start date"
        }
    }
}
