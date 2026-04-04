import SwiftUI

struct ExpenseRowView: View {
    let expense: Expense
    let categoryName: String
    let categoryIcon: String

    var body: some View {
        HStack {
            Text(categoryIcon)
                .font(.title2)

            VStack(alignment: .leading, spacing: 2) {
                Text(expense.merchant.isEmpty ? categoryName : expense.merchant)
                    .font(.body)
                if !expense.description.isEmpty {
                    Text(expense.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Text("\(expense.currency) \(expense.displayAmount)")
                .font(.body.monospacedDigit())
                .fontWeight(.medium)
        }
        .padding(.vertical, 2)
    }
}
