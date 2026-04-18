import SwiftUI

struct AddEditExpenseView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: AddEditExpenseViewModel
    @State private var showingDatePicker = false
    @State private var showCategoryPicker = false
    @State private var toastMessage: String?
    @State private var noteText = ""
    @FocusState private var noteFocused: Bool

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
        GeometryReader { proxy in
            let bottomInset = proxy.safeAreaInsets.bottom
            let padHeight = max(240, proxy.size.height * 0.42)

            ZStack {
                Color(.systemBackground).ignoresSafeArea()

                VStack(spacing: 0) {
                    // Top bar: X button + Expense/Income toggle
                    topBar
                        .padding(.top, 8)
                        .padding(.horizontal, 18)

                    Spacer(minLength: 0)

                    // Amount display
                    amountSection
                        .padding(.horizontal, 18)

                    Spacer().frame(height: 12)

                    // Note field (inline pill)
                    noteField
                        .padding(.horizontal, 18)

                    Spacer(minLength: 0)

                    // Date + Category row
                    if !showCategoryPicker {
                        controlsRow
                            .padding(.horizontal, 18)
                            .transition(.move(edge: .leading).combined(with: .opacity))
                    }

                    Spacer().frame(height: 10)

                    // Number pad or category picker
                    if showCategoryPicker {
                        categoryPickerView
                            .frame(height: padHeight)
                            .padding(.horizontal, 18)
                            .padding(.bottom, bottomInset + 8)
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                    } else {
                        keypad
                            .frame(height: padHeight)
                            .padding(.horizontal, 18)
                            .padding(.bottom, bottomInset + 8)
                            .transition(.move(edge: .leading).combined(with: .opacity))
                    }
                }

                // Toast
                if let toastMessage {
                    VStack {
                        toastView(message: toastMessage)
                            .padding(.top, 60)
                        Spacer()
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(10)
                }

                // Date picker overlay
                if showingDatePicker {
                    datePickerOverlay
                        .zIndex(5)
                }
            }
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .onAppear {
            noteText = viewModel.merchant
        }
    }

    // MARK: - Top Bar

    private var topBar: some View {
        ZStack {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Color(.label))
                        .frame(width: 32, height: 32)
                        .background(Color(.systemGray6), in: Circle())
                }
                .buttonStyle(.plain)

                Spacer()
            }

            Text("Expense")
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .foregroundStyle(.primary)
        }
    }

    // MARK: - Amount

    private var amountSection: some View {
        HStack(alignment: .lastTextBaseline, spacing: 2) {
            Text("$")
                .font(.system(size: 32, weight: .light, design: .rounded))
                .foregroundStyle(Color(.systemGray))

            Text(viewModel.amountDisplay)
                .font(.system(size: 54, weight: .regular, design: .rounded))
                .foregroundStyle(.primary)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .frame(maxWidth: .infinity)
    }

    // MARK: - Note Field (inline pill like dimeApp)

    private var noteField: some View {
        HStack(spacing: 6) {
            Image(systemName: "text.alignleft")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(Color(.systemGray))

            ZStack(alignment: .leading) {
                if noteText.isEmpty && !noteFocused {
                    Text("Add Note")
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .foregroundStyle(Color(.systemGray))
                }

                TextField("", text: $noteText)
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(.primary)
                    .focused($noteFocused)
                    .onChange(of: noteText) { _, newValue in
                        viewModel.merchant = newValue
                    }
                    .onSubmit {
                        noteFocused = false
                    }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            Capsule(style: .continuous)
                .stroke(Color(.systemGray4), lineWidth: 1.2)
        )
        .frame(maxWidth: 260)
    }

    // MARK: - Controls Row (Date + Category)

    private var controlsRow: some View {
        HStack(spacing: 8) {
            // Date pill
            Button {
                showingDatePicker = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "calendar")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color(.systemGray))

                    Text(viewModel.formattedDate)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    Spacer(minLength: 4)

                    Text(viewModel.formattedTime)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity)
                .background(
                    Capsule(style: .continuous)
                        .stroke(Color(.systemGray4), lineWidth: 1.2)
                )
            }
            .buttonStyle(.plain)

            // Category chip
            Button {
                withAnimation(.easeInOut(duration: 0.25)) {
                    showCategoryPicker.toggle()
                }
            } label: {
                HStack(spacing: 5) {
                    if let cat = viewModel.selectedCategory {
                        Image(systemName: cat.displayIcon)
                            .font(.system(size: 13, weight: .medium))
                        Text(cat.name)
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                            .lineLimit(1)
                    } else {
                        Image(systemName: "square.grid.2x2")
                            .font(.system(size: 13, weight: .medium))
                        Text("Category")
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                    }
                }
                .foregroundStyle(viewModel.selectedCategory != nil ? .white : Color(.systemGray))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(
                    Capsule(style: .continuous)
                        .fill(viewModel.selectedCategory != nil ? Color.accentColor : Color.clear)
                )
                .overlay {
                    if viewModel.selectedCategory == nil {
                        Capsule(style: .continuous)
                            .stroke(Color(.systemGray4), lineWidth: 1.2)
                    }
                }
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Category Picker

    private var categoryPickerView: some View {
        VStack(spacing: 0) {
            // Close button for category picker
            HStack {
                Spacer()
                Button {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        showCategoryPicker = false
                    }
                } label: {
                    Text("Close")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.red)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(
                            Capsule(style: .continuous)
                                .stroke(Color.red.opacity(0.3), lineWidth: 1.2)
                        )
                }
                .buttonStyle(.plain)
            }
            .padding(.bottom, 12)

            let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

            ScrollView(showsIndicators: false) {
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(viewModel.categories) { category in
                        let isSelected = category.id == viewModel.selectedCategoryId

                        Button {
                            viewModel.selectedCategoryId = category.id
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                withAnimation(.easeInOut(duration: 0.25)) {
                                    showCategoryPicker = false
                                }
                            }
                        } label: {
                            HStack(spacing: 7) {
                                Image(systemName: category.displayIcon)
                                    .font(.system(size: 14, weight: .medium))
                                Text(category.name)
                                    .font(.system(size: 14, weight: .medium, design: .rounded))
                                    .lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 11)
                            .foregroundStyle(isSelected ? .white : .primary)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(isSelected ? Color.accentColor : Color(.systemGray6))
                            )
                            .opacity(viewModel.selectedCategoryId.isEmpty || isSelected ? 1 : 0.6)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Keypad

    private var keypad: some View {
        GeometryReader { proxy in
            let spacing: CGFloat = 10
            let btnWidth = (proxy.size.width - spacing * 2) / 3
            let btnHeight = (proxy.size.height - spacing * 3) / 4

            VStack(spacing: spacing) {
                ForEach([[1,2,3],[4,5,6],[7,8,9]], id: \.self) { row in
                    HStack(spacing: spacing) {
                        ForEach(row, id: \.self) { n in
                            numberButton("\(n)", width: btnWidth, height: btnHeight)
                        }
                    }
                }

                // Bottom row: backspace, 0, submit
                HStack(spacing: spacing) {
                    Button {
                        viewModel.deleteLastDigit()
                    } label: {
                        Image(systemName: "delete.backward")
                            .font(.system(size: 22, weight: .regular))
                            .foregroundStyle(.primary)
                            .frame(width: btnWidth, height: btnHeight)
                            .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(NumPadButtonStyle())

                    numberButton("0", width: btnWidth, height: btnHeight)

                    // Submit button
                    Button {
                        handleSaveTapped()
                    } label: {
                        ZStack {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Color(.label))
                                .frame(width: btnWidth, height: btnHeight)

                            Image(systemName: "checkmark")
                                .font(.system(size: 22, weight: .bold))
                                .foregroundStyle(Color(.systemBackground))
                        }
                    }
                    .buttonStyle(NumPadButtonStyle())
                }
            }
        }
    }

    private func numberButton(_ value: String, width: CGFloat, height: CGFloat) -> some View {
        Button {
            viewModel.appendDigit(value)
        } label: {
            Text(value)
                .font(.system(size: min(height * 0.4, 34), weight: .regular, design: .rounded))
                .foregroundStyle(.primary)
                .frame(width: width, height: height)
                .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(NumPadButtonStyle())
    }

    // MARK: - Date Picker Overlay

    private var datePickerOverlay: some View {
        ZStack {
            Color.black.opacity(0.25)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.easeOut(duration: 0.25)) {
                        showingDatePicker = false
                    }
                }

            VStack {
                Spacer()
                DatePicker("Date", selection: $viewModel.date)
                    .datePickerStyle(.graphical)
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .padding(.horizontal, 18)
                    .padding(.bottom, 40)
            }
        }
        .transition(.opacity)
    }

    // MARK: - Actions

    private func handleSaveTapped() {
        guard let amount = Double(viewModel.amountText), amount > 0 else {
            showToast("Enter an amount")
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
}

// MARK: - Button Style

struct NumPadButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .opacity(configuration.isPressed ? 0.6 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: - ViewModel Extensions

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
