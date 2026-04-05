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
                TextField("Icon (emoji)", text: $icon)
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
                    .disabled(name.isEmpty)
                }
            }
            .onAppear {
                if let category {
                    name = category.name
                    icon = category.icon
                    if let budget = category.budget {
                        budgetText = String(format: "%.2f", Double(budget) / 100.0)
                    }
                }
            }
        }
    }

    private func save() {
        let now = Int64(Date().timeIntervalSince1970)
        var budget: Int64?
        if let parsed = Double(budgetText) {
            budget = Int64(parsed * 100)
        }

        do {
            try database.dbQueue.write { db in
                if var existing = category {
                    existing.name = name
                    existing.icon = icon
                    existing.budget = budget
                    existing.updatedAt = now
                    existing.syncStatus = "pending_push"
                    try existing.update(db)
                } else {
                    var newCategory = Category(
                        id: UUID().uuidString,
                        clientId: UUID().uuidString,
                        name: name,
                        icon: icon,
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
