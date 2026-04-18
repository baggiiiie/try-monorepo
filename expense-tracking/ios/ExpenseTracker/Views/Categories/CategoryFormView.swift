import SwiftUI

struct CategoryFormView: View {
    @Environment(\.dismiss) private var dismiss
    let database: AppDatabase
    let category: Category?

    private var categoryRepository: CategoryRepository {
        database.categoryRepository
    }

    @State private var name: String = ""
    @State private var icon: String = ""
    @State private var budgetText: String = ""

    var isEditing: Bool { category != nil }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)

                HStack(spacing: 12) {
                    Image(systemName: Category.resolvedIcon(
                        name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                        icon: icon
                    ))
                    .frame(width: 24)

                    TextField("Icon (SF Symbol)", text: $icon)
                }

                TextField("Monthly Budget (optional)", text: $budgetText)
                    .keyboardType(.decimalPad)
            }
            .navigationTitle(isEditing ? "Edit Category" : "New Category")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                        dismiss()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear {
                if let category {
                    name = category.name
                    icon = category.displayIcon
                    if let budget = category.budget {
                        budgetText = MoneyFormatter.decimalString(fromCents: budget)
                    }
                }
            }
        }
    }

    private func save() {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedIcon = Category.resolvedIcon(name: trimmedName, icon: icon)
        let budget = MoneyFormatter.cents(fromDecimalString: budgetText)

        let draft = CategoryDraft(
            name: trimmedName,
            icon: resolvedIcon,
            budget: budget
        )

        do {
            try categoryRepository.save(draft, editing: category)
        } catch {
            print("Error saving category: \(error)")
        }
    }
}
