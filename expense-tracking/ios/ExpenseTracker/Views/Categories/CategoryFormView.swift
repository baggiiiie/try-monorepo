import SwiftUI

struct CategoryFormView: View {
    @Environment(\.dismiss) private var dismiss
    let database: AppDatabase
    let category: Category?

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
                        budgetText = String(format: "%.2f", Double(budget) / 100.0)
                    }
                }
            }
        }
    }

    private func save() {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedIcon = Category.resolvedIcon(name: trimmedName, icon: icon)
        let now = Int64(Date().timeIntervalSince1970)
        var budget: Int64?
        if let parsed = Double(budgetText) {
            budget = Int64(parsed * 100)
        }

        do {
            try database.dbQueue.write { db in
                if var existing = category {
                    existing.name = trimmedName
                    existing.icon = resolvedIcon
                    existing.budget = budget
                    existing.updatedAt = now
                    existing.syncStatus = "pending_push"
                    try existing.update(db)
                } else {
                    let newCategory = Category(
                        id: UUID().uuidString,
                        clientId: UUID().uuidString,
                        name: trimmedName,
                        icon: resolvedIcon,
                        budget: budget,
                        createdAt: now,
                        updatedAt: now,
                        deletedAt: nil
                    )
                    try newCategory.insert(db)
                }
            }
        } catch {
            print("Error saving category: \(error)")
        }
    }
}
