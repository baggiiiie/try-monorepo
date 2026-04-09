import SwiftUI

struct AddEditExpenseView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: AddEditExpenseViewModel

    let isEditing: Bool

    init(database: AppDatabase, expense: Expense?) {
        self.isEditing = expense != nil
        _viewModel = StateObject(wrappedValue: AddEditExpenseViewModel(database: database, expense: expense))
    }

    init(database: AppDatabase, suggestion: WalletSuggestion) {
        self.isEditing = false
        _viewModel = StateObject(wrappedValue: AddEditExpenseViewModel(database: database, expense: nil, walletSuggestion: suggestion))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Amount") {
                    TextField("0.00", text: $viewModel.amountText)
                        .keyboardType(.decimalPad)
                        .font(.title)
                }

                Section("Category") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(viewModel.categories) { cat in
                                CategoryChip(
                                    category: cat,
                                    isSelected: viewModel.selectedCategoryId == cat.id
                                )
                                .onTapGesture { viewModel.selectedCategoryId = cat.id }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section("Details") {
                    TextField("Merchant", text: $viewModel.merchant)
                    TextField("Description (optional)", text: $viewModel.descriptionText)
                    DatePicker("Date", selection: $viewModel.date, displayedComponents: .date)
                }
            }
            .navigationTitle(isEditing ? "Edit Expense" : "Add Expense")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        viewModel.save()
                        dismiss()
                    }
                    .disabled(!viewModel.isValid)
                }
            }
        }
    }
}

struct CategoryChip: View {
    let category: Category
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: category.displayIcon)
            Text(category.name)
                .font(.caption)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(isSelected ? Color.accentColor.opacity(0.2) : Color(.systemGray6))
        .foregroundStyle(isSelected ? Color.accentColor : .primary)
        .clipShape(Capsule())
        .overlay(
            Capsule().stroke(isSelected ? Color.accentColor : .clear, lineWidth: 1)
        )
    }
}
