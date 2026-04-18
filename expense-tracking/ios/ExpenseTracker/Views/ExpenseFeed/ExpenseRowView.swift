import SwiftUI

struct ExpenseRowView: View {
    let expense: Expense
    let categoryName: String
    let categoryIcon: String
    let categoryColor: Color

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(categoryColor.opacity(0.2))
                    .frame(width: 44, height: 44)
                Image(systemName: categoryIcon)
                    .font(.title3)
                    .foregroundStyle(categoryColor)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(expense.merchant.isEmpty ? categoryName : expense.merchant)
                    .font(.system(.body, design: .rounded))
                    .fontWeight(.medium)
                Text(AppDateFormatter.shortTimeString(from: expense.displayDate))
                    .font(.system(.subheadline, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text("-\(CurrencyFormatter.format(cents: expense.amount, currency: expense.currency))")
                .font(.system(.title3, design: .rounded))
                .fontWeight(.semibold)
        }
        .padding(.vertical, 6)
    }
}
