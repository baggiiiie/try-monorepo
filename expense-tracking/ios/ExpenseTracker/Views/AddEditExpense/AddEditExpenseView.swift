import SwiftUI

struct AddEditExpenseView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: AddEditExpenseViewModel
    @State private var showingNotesEditor = false
    @State private var showingDateEditor = false
    @State private var toastMessage: String?

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
            GeometryReader { proxy in
                let topInset = proxy.safeAreaInsets.top
                let bottomInset = proxy.safeAreaInsets.bottom
                let availableHeight = proxy.size.height - topInset - bottomInset
                let topGap = min(88, max(32, availableHeight * 0.07))
                let middleGap = min(104, max(44, availableHeight * 0.09))
                let reservedHeight = topGap + 26 + 62 + middleGap + 70 + 14 + 42
                let keypadButtonHeight = min(112, max(82, (availableHeight - reservedHeight - (14 * 3)) / 4))

                ZStack(alignment: .top) {
                    Color(.systemBackground)
                        .ignoresSafeArea()

                    VStack(spacing: 0) {
                        Spacer()
                            .frame(height: topGap)

                        amountSection

                        Spacer()
                            .frame(height: 26)

                        noteButton

                        Spacer()
                            .frame(height: middleGap)

                        controlsRow

                        Spacer()
                            .frame(height: 14)

                        keypad(buttonHeight: keypadButtonHeight)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .padding(.top, topInset)
                    .padding(.bottom, bottomInset + 8)
                    .padding(.horizontal, 18)

                    if let toastMessage {
                        toastView(message: toastMessage)
                            .padding(.top, topInset + 12)
                            .transition(.move(edge: .top).combined(with: .opacity))
                            .zIndex(1)
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showingNotesEditor) {
                notesEditorSheet
            }
            .sheet(isPresented: $showingDateEditor) {
                dateEditorSheet
            }
        }
    }

    private var amountSection: some View {
        HStack(alignment: .lastTextBaseline, spacing: 4) {
            Text("SGD")
                .font(.system(size: 43, weight: .regular, design: .rounded))
                .foregroundStyle(Color(.systemGray))

            Text(viewModel.amountDisplay)
                .font(.system(size: 74, weight: .regular, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.primary)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.45)
        .frame(maxWidth: .infinity)
    }

    private var noteButton: some View {
        Button {
            showingNotesEditor = true
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 22, weight: .regular))

                Text(viewModel.noteButtonTitle)
                    .font(.system(size: 21, weight: .medium, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .foregroundStyle(viewModel.hasNoteDetails ? Color.primary : Color(.systemGray))
            .frame(maxWidth: 332)
            .frame(height: 62)
            .background(
                Capsule(style: .continuous)
                    .fill(Color(.systemBackground))
            )
            .overlay {
                Capsule(style: .continuous)
                    .stroke(Color(.systemGray5), lineWidth: 1.5)
            }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
    }

    private var controlsRow: some View {
        HStack(spacing: 12) {
            Button {
                showingDateEditor = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "calendar")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Color(.systemGray))

                    Text(viewModel.formattedDate)
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.95)
                        .layoutPriority(1)

                    Spacer(minLength: 6)

                    Text(viewModel.formattedTime)
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                .padding(.horizontal, 18)
                .frame(maxWidth: .infinity)
                .frame(height: 70)
                .background(controlPillBackground)
            }
            .buttonStyle(.plain)
            .layoutPriority(1)

            Menu {
                ForEach(viewModel.categories) { category in
                    Button {
                        viewModel.selectedCategoryId = category.id
                    } label: {
                        Label(category.name, systemImage: category.displayIcon)
                    }
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: viewModel.selectedCategory?.displayIcon ?? "circle.grid.2x2.fill")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Color(.systemGray))

                    Text(viewModel.selectedCategory?.name ?? "Category")
                        .font(.system(size: 16, weight: .medium, design: .rounded))
                        .foregroundStyle(viewModel.selectedCategory == nil ? Color(.systemGray) : .primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 18)
                .frame(width: 114, height: 70)
                .background(controlPillBackground)
            }
            .buttonStyle(.plain)
        }
    }

    private var controlPillBackground: some View {
        RoundedRectangle(cornerRadius: 21, style: .continuous)
            .fill(Color(.systemBackground))
            .overlay {
                RoundedRectangle(cornerRadius: 21, style: .continuous)
                    .stroke(Color(.systemGray5), lineWidth: 1.5)
            }
    }

    private func keypad(buttonHeight: CGFloat) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 14), count: 3)

        return LazyVGrid(columns: columns, spacing: 14) {
            keypadNumberButton("1", height: buttonHeight)
            keypadNumberButton("2", height: buttonHeight)
            keypadNumberButton("3", height: buttonHeight)
            keypadNumberButton("4", height: buttonHeight)
            keypadNumberButton("5", height: buttonHeight)
            keypadNumberButton("6", height: buttonHeight)
            keypadNumberButton("7", height: buttonHeight)
            keypadNumberButton("8", height: buttonHeight)
            keypadNumberButton("9", height: buttonHeight)
            keypadActionButton(systemName: "xmark", height: buttonHeight) {
                viewModel.deleteLastDigit()
            }
            keypadNumberButton("0", height: buttonHeight)
            keypadActionButton(systemName: "checkmark", height: buttonHeight) {
                handleSaveTapped()
            }
        }
    }

    private func keypadNumberButton(_ value: String, height: CGFloat) -> some View {
        Button {
            viewModel.appendDigit(value)
        } label: {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color(.systemGray6))
                .frame(height: height)
                .overlay {
                    Text(value)
                        .font(.system(size: min(height * 0.44, 52), weight: .regular, design: .rounded))
                        .foregroundStyle(.primary)
                }
        }
        .buttonStyle(.plain)
    }

    private func keypadActionButton(systemName: String, height: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color.black.opacity(0.72))
                .frame(height: height)
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color(.systemBackground))
                        .frame(width: min(height * 0.44, 56), height: min(height * 0.44, 56))
                        .overlay {
                            Image(systemName: systemName)
                                .font(.system(size: min(height * 0.18, 23), weight: .bold))
                                .foregroundStyle(Color.black.opacity(0.72))
                        }
                }
        }
        .buttonStyle(.plain)
    }

    private func handleSaveTapped() {
        guard let amount = Double(viewModel.amountText), amount > 0 else {
            showToast("Enter an amount first")
            return
        }

        guard !viewModel.selectedCategoryId.isEmpty else {
            showToast("Pick a category")
            return
        }

        viewModel.save()
        dismiss()
    }

    private func showToast(_ message: String) {
        withAnimation(.spring(duration: 0.3)) {
            toastMessage = message
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
            if toastMessage == message {
                withAnimation(.spring(duration: 0.3)) {
                    toastMessage = nil
                }
            }
        }
    }

    private func toastView(message: String) -> some View {
        Text(message)
            .font(.system(size: 15, weight: .medium, design: .rounded))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(
                Capsule(style: .continuous)
                    .fill(Color.black.opacity(0.82))
            )
            .shadow(color: .black.opacity(0.12), radius: 12, y: 6)
    }

    private var notesEditorSheet: some View {
        NavigationStack {
            Form {
                Section("Merchant") {
                    TextField("Optional", text: $viewModel.merchant)
                }

                Section("Note") {
                    TextField("Add a note", text: $viewModel.descriptionText, axis: .vertical)
                        .lineLimit(4...8)
                }
            }
            .navigationTitle("Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { showingNotesEditor = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private var dateEditorSheet: some View {
        NavigationStack {
            Form {
                Section("Date") {
                    DatePicker(
                        "Date",
                        selection: $viewModel.date,
                        displayedComponents: .date
                    )
                    .datePickerStyle(.graphical)
                }

                Section("Time") {
                    DatePicker(
                        "Time",
                        selection: $viewModel.date,
                        displayedComponents: .hourAndMinute
                    )
                    .datePickerStyle(.wheel)
                    .labelsHidden()
                    .frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("When")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { showingDateEditor = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

@MainActor
private extension AddEditExpenseViewModel {
    var selectedCategory: Category? {
        categories.first { $0.id == selectedCategoryId }
    }

    var amountDisplay: String {
        amountText.isEmpty ? "0.00" : amountText
    }

    var hasNoteDetails: Bool {
        !merchant.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var noteButtonTitle: String {
        let trimmedMerchant = merchant.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedMerchant.isEmpty {
            return trimmedMerchant
        }

        let trimmedDescription = descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedDescription.isEmpty {
            return trimmedDescription
        }

        return "Add Note"
    }

    var formattedDate: String {
        let calendar = Calendar.current
        let suffix = date.formatted(.dateTime.day().month(.abbreviated))

        if calendar.isDateInToday(date) {
            return "Today, \(suffix)"
        }

        if calendar.isDateInYesterday(date) {
            return "Yesterday, \(suffix)"
        }

        if calendar.isDateInTomorrow(date) {
            return "Tomorrow, \(suffix)"
        }

        return date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }

    var formattedTime: String {
        date.formatted(date: .omitted, time: .shortened)
    }

    var canDeleteAmount: Bool {
        digitsOnlyAmount != "0"
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

    private var digitsOnlyAmount: String {
        let digits = amountText.filter(\.isWholeNumber)
        return digits.isEmpty ? "0" : digits
    }

    static func amountString(fromDigits digits: String) -> String {
        let normalizedDigits = digits.isEmpty ? "0" : digits
        let cents = Int(normalizedDigits) ?? 0
        return String(format: "%.2f", Double(cents) / 100.0)
    }
}
