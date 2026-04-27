import Foundation

struct CategoryDraft {
    let name: String
    let icon: String
    let budget: Int64?
}

struct ExpenseDraft {
    let amount: Int64
    let currency: String
    let categoryId: String
    let description: String
    let merchant: String
    let date: Int64
    let source: ExpenseSource
}

struct RecurringExpenseDraft {
    let amount: Int64
    let currency: String
    let categoryId: String
    let description: String
    let merchant: String
    let frequency: RecurringFrequency
    let dayOfMonth: Int?
    let startDate: Int64
    let endDate: Int64?
}
