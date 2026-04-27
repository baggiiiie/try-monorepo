import SwiftUI

struct RecurringExpensesView: View {
    let database: AppDatabase
    @StateObject private var viewModel: RecurringExpensesViewModel
    @State private var showingForm = false
    @State private var alertMessage: String?

    init(database: AppDatabase) {
        self.database = database
        _viewModel = StateObject(wrappedValue: RecurringExpensesViewModel(database: database))
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(viewModel.recurringExpenses) { item in
                    Button {
                        viewModel.edit(item.recurringExpense)
                        showingForm = true
                    } label: {
                        RecurringExpenseRow(item: item)
                    }
                    .tint(.primary)
                    .deleteSwipeAction {
                        viewModel.delete(item.recurringExpense)
                    }
                }
            }
            .navigationTitle("Recurring")
            .overlay {
                if viewModel.recurringExpenses.isEmpty {
                    ContentUnavailableView(
                        "No Recurring Expenses",
                        systemImage: "repeat",
                        description: Text("Add rent, subscriptions, or bills that repeat automatically")
                    )
                }
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        viewModel.resetForm()
                        showingForm = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingForm) {
                RecurringExpenseFormView(
                    viewModel: viewModel,
                    onSave: handleSaveTapped,
                    onCancel: { showingForm = false }
                )
            }
            .alert("Recurring Expense", isPresented: alertBinding) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(alertMessage ?? "")
            }
            .onAppear {
                viewModel.refresh()
            }
        }
    }

    private func handleSaveTapped() {
        if let validationMessage = viewModel.validationMessage {
            showToast(validationMessage)
            return
        }

        do {
            try viewModel.save()
            HapticManager.notify(.success)
            showingForm = false
        } catch {
            showToast(error.localizedDescription.isEmpty ? "Couldn't save recurring expense" : error.localizedDescription)
        }
    }

    private func showToast(_ message: String) {
        alertMessage = message
    }

    private var alertBinding: Binding<Bool> {
        Binding(
            get: { alertMessage != nil },
            set: { isPresented in
                if !isPresented {
                    alertMessage = nil
                }
            }
        )
    }
}

private struct RecurringExpenseRow: View {
    let item: RecurringExpenseWithCategory

    private var recurringExpense: RecurringExpense {
        item.recurringExpense
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.categoryIcon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 38, height: 38)
                .background(Color.accentColor, in: Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(recurringExpense.merchant.isEmpty ? item.categoryName : recurringExpense.merchant)
                    .font(.system(.body, design: .rounded).weight(.semibold))
                    .lineLimit(1)

                Text(scheduleSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text(CurrencyFormatter.format(cents: recurringExpense.amount, currency: recurringExpense.currency))
                    .font(.system(.body, design: .rounded).weight(.semibold))
                    .monospacedDigit()

                Text(AppDateFormatter.mediumDateString(from: recurringExpense.displayNextRunDate))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    private var scheduleSummary: String {
        let frequency = RecurringFrequency(rawValue: recurringExpense.frequency) ?? .monthly
        switch frequency {
        case .weekly:
            return "Every week"
        case .monthly:
            return "Every month on day \(recurringExpense.dayOfMonth ?? 1)"
        case .yearly:
            return "Every year"
        }
    }
}

private struct RecurringExpenseFormView: View {
    @ObservedObject var viewModel: RecurringExpensesViewModel
    let onSave: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Expense") {
                    TextField("Amount", text: $viewModel.amountText)
                        .keyboardType(.decimalPad)

                    TextField("Merchant", text: $viewModel.merchant)

                    TextField("Description", text: $viewModel.descriptionText)

                    Picker("Category", selection: $viewModel.selectedCategoryId) {
                        ForEach(viewModel.categories) { category in
                            Label(category.name, systemImage: category.displayIcon)
                                .tag(category.id)
                        }
                    }
                }

                Section("Schedule") {
                    Picker("Repeats", selection: $viewModel.frequency) {
                        ForEach(RecurringFrequency.allCases) { frequency in
                            Text(frequency.displayName).tag(frequency)
                        }
                    }

                    if viewModel.frequency == .monthly {
                        Picker("Day", selection: $viewModel.dayOfMonth) {
                            ForEach(1...31, id: \.self) { day in
                                Text("\(day)").tag(day)
                            }
                        }
                    }

                    DatePicker("Starts", selection: $viewModel.startDate, displayedComponents: .date)

                    OptionalEndDatePicker(endDate: $viewModel.endDate)
                }
            }
            .navigationTitle(viewModel.isEditing ? "Edit Recurring" : "New Recurring")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: onSave)
                }
            }
        }
    }
}

private struct OptionalEndDatePicker: View {
    @Binding var endDate: Date?

    private var hasEndDate: Binding<Bool> {
        Binding(
            get: { endDate != nil },
            set: { enabled in
                endDate = enabled ? Date() : nil
            }
        )
    }

    private var selectedEndDate: Binding<Date> {
        Binding(
            get: { endDate ?? Date() },
            set: { endDate = $0 }
        )
    }

    var body: some View {
        Toggle("Ends", isOn: hasEndDate)

        if endDate != nil {
            DatePicker("End Date", selection: selectedEndDate, displayedComponents: .date)
        }
    }
}
