import SwiftUI

struct AddEditExpenseView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: AddEditExpenseViewModel
    @State private var isShowingDatePicker = false
    @State private var isShowingCategoryPicker = false
    @State private var toastMessage: String?
    @FocusState private var isMerchantFieldFocused: Bool

    init(database: AppDatabase, expense: Expense?) {
        _viewModel = StateObject(wrappedValue: AddEditExpenseViewModel(database: database, expense: expense))
    }

    init(database: AppDatabase, suggestion: WalletSuggestion) {
        _viewModel = StateObject(
            wrappedValue: AddEditExpenseViewModel(database: database, expense: nil, walletSuggestion: suggestion)
        )
    }

    var body: some View {
        GeometryReader { proxy in
            let bottomInset = proxy.safeAreaInsets.bottom
            let inputPanelHeight = max(240, proxy.size.height * 0.42)

            ZStack {
                Color(.systemBackground).ignoresSafeArea()

                VStack(spacing: 0) {
                    AddEditExpenseTopBar(onClose: { dismiss() })
                        .padding(.top, 8)
                        .padding(.horizontal, 18)

                    Spacer(minLength: 0)

                    ExpenseAmountSection(amount: viewModel.amountDisplay)
                        .padding(.horizontal, 18)

                    Spacer().frame(height: 12)

                    ExpenseMerchantField(
                        text: $viewModel.merchant,
                        isFocused: $isMerchantFieldFocused
                    )
                    .padding(.horizontal, 18)

                    Spacer(minLength: 0)

                    if !isShowingCategoryPicker {
                        ExpenseControlsRow(
                            formattedDate: viewModel.formattedDate,
                            formattedTime: viewModel.formattedTime,
                            selectedCategory: viewModel.selectedCategory,
                            onDateTap: { isShowingDatePicker = true },
                            onCategoryTap: toggleCategoryPicker
                        )
                        .padding(.horizontal, 18)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                    }

                    Spacer().frame(height: 10)

                    Group {
                        if isShowingCategoryPicker {
                            ExpenseCategoryPicker(
                                categories: viewModel.categories,
                                selectedCategoryId: viewModel.selectedCategoryId,
                                onClose: hideCategoryPicker,
                                onSelectCategory: selectCategory
                            )
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                        } else {
                            ExpenseKeypad(
                                onDigitTap: viewModel.appendDigit,
                                onDeleteTap: viewModel.deleteLastDigit,
                                onSubmitTap: handleSaveTapped
                            )
                            .transition(.move(edge: .leading).combined(with: .opacity))
                        }
                    }
                    .frame(height: inputPanelHeight)
                    .padding(.horizontal, 18)
                    .padding(.bottom, bottomInset + 8)
                }

                if let toastMessage {
                    VStack {
                        ToastBanner(message: toastMessage)
                            .padding(.top, 60)
                        Spacer()
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(10)
                }

                if isShowingDatePicker {
                    ExpenseDatePickerOverlay(date: $viewModel.date) {
                        withAnimation(.easeOut(duration: 0.25)) {
                            isShowingDatePicker = false
                        }
                    }
                    .zIndex(5)
                }
            }
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
    }

    private func handleSaveTapped() {
        if let validationMessage = viewModel.validationMessage {
            showToast(validationMessage)
            return
        }

        do {
            try viewModel.save()
            dismiss()
        } catch {
            showToast(error.localizedDescription.isEmpty ? "Couldn't save expense" : error.localizedDescription)
        }
    }

    private func toggleCategoryPicker() {
        withAnimation(.easeInOut(duration: 0.25)) {
            isShowingCategoryPicker.toggle()
        }
    }

    private func hideCategoryPicker() {
        withAnimation(.easeInOut(duration: 0.25)) {
            isShowingCategoryPicker = false
        }
    }

    private func selectCategory(_ category: Category) {
        viewModel.selectedCategoryId = category.id

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            hideCategoryPicker()
        }
    }

    private func showToast(_ message: String) {
        withAnimation(.spring(duration: 0.3)) {
            toastMessage = message
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
            guard toastMessage == message else { return }

            withAnimation(.spring(duration: 0.3)) {
                toastMessage = nil
            }
        }
    }
}

private struct AddEditExpenseTopBar: View {
    let onClose: () -> Void

    var body: some View {
        ZStack {
            HStack {
                Button(action: onClose) {
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
}

private struct ExpenseAmountSection: View {
    let amount: String

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 2) {
            Text("$")
                .font(.system(size: 32, weight: .light, design: .rounded))
                .foregroundStyle(Color(.systemGray))

            Text(amount)
                .font(.system(size: 54, weight: .regular, design: .rounded))
                .foregroundStyle(.primary)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .frame(maxWidth: .infinity)
    }
}

private struct ExpenseMerchantField: View {
    @Binding var text: String
    let isFocused: FocusState<Bool>.Binding

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "building.2")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(Color(.systemGray))

            ZStack(alignment: .leading) {
                if text.isEmpty && !isFocused.wrappedValue {
                    Text("Merchant")
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .foregroundStyle(Color(.systemGray))
                }

                TextField("", text: $text)
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(.primary)
                    .focused(isFocused)
                    .onSubmit {
                        isFocused.wrappedValue = false
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
}

private struct ExpenseControlsRow: View {
    let formattedDate: String
    let formattedTime: String
    let selectedCategory: Category?
    let onDateTap: () -> Void
    let onCategoryTap: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onDateTap) {
                HStack(spacing: 6) {
                    Image(systemName: "calendar")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color(.systemGray))

                    Text(formattedDate)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    Spacer(minLength: 4)

                    Text(formattedTime)
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

            Button(action: onCategoryTap) {
                HStack(spacing: 5) {
                    if let selectedCategory {
                        Image(systemName: selectedCategory.displayIcon)
                            .font(.system(size: 13, weight: .medium))
                        Text(selectedCategory.name)
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                            .lineLimit(1)
                    } else {
                        Image(systemName: "square.grid.2x2")
                            .font(.system(size: 13, weight: .medium))
                        Text("Category")
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                    }
                }
                .foregroundStyle(selectedCategory != nil ? .white : Color(.systemGray))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(
                    Capsule(style: .continuous)
                        .fill(selectedCategory != nil ? Color.accentColor : Color.clear)
                )
                .overlay {
                    if selectedCategory == nil {
                        Capsule(style: .continuous)
                            .stroke(Color(.systemGray4), lineWidth: 1.2)
                    }
                }
            }
            .buttonStyle(.plain)
        }
    }
}

private struct ExpenseCategoryPicker: View {
    let categories: [Category]
    let selectedCategoryId: String
    let onClose: () -> Void
    let onSelectCategory: (Category) -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10)
    ]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button(action: onClose) {
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

            ScrollView(showsIndicators: false) {
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(categories) { category in
                        let isSelected = category.id == selectedCategoryId

                        Button {
                            onSelectCategory(category)
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
                            .opacity(selectedCategoryId.isEmpty || isSelected ? 1 : 0.6)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

private struct ExpenseKeypad: View {
    let onDigitTap: (String) -> Void
    let onDeleteTap: () -> Void
    let onSubmitTap: () -> Void

    private let digitRows = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
    private let spacing: CGFloat = 10

    var body: some View {
        GeometryReader { proxy in
            let buttonWidth = (proxy.size.width - spacing * 2) / 3
            let buttonHeight = (proxy.size.height - spacing * 3) / 4

            VStack(spacing: spacing) {
                ForEach(digitRows, id: \.self) { row in
                    HStack(spacing: spacing) {
                        ForEach(row, id: \.self) { digit in
                            DigitButton(
                                title: "\(digit)",
                                width: buttonWidth,
                                height: buttonHeight,
                                action: { onDigitTap("\(digit)") }
                            )
                        }
                    }
                }

                HStack(spacing: spacing) {
                    IconKeypadButton(
                        systemImage: "delete.backward",
                        width: buttonWidth,
                        height: buttonHeight,
                        action: onDeleteTap
                    )

                    DigitButton(
                        title: "0",
                        width: buttonWidth,
                        height: buttonHeight,
                        action: { onDigitTap("0") }
                    )

                    SubmitKeypadButton(
                        width: buttonWidth,
                        height: buttonHeight,
                        action: onSubmitTap
                    )
                }
            }
        }
    }
}

private struct DigitButton: View {
    let title: String
    let width: CGFloat
    let height: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: min(height * 0.4, 34), weight: .regular, design: .rounded))
                .foregroundStyle(.primary)
                .frame(width: width, height: height)
                .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(NumPadButtonStyle())
    }
}

private struct IconKeypadButton: View {
    let systemImage: String
    let width: CGFloat
    let height: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 22, weight: .regular))
                .foregroundStyle(.primary)
                .frame(width: width, height: height)
                .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(NumPadButtonStyle())
    }
}

private struct SubmitKeypadButton: View {
    let width: CGFloat
    let height: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color(.label))
                    .frame(width: width, height: height)

                Image(systemName: "checkmark")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Color(.systemBackground))
            }
        }
        .buttonStyle(NumPadButtonStyle())
    }
}

private struct ExpenseDatePickerOverlay: View {
    @Binding var date: Date
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.25)
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)

            VStack {
                Spacer()
                DatePicker("Date", selection: $date)
                    .datePickerStyle(.graphical)
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .padding(.horizontal, 18)
                    .padding(.bottom, 40)
            }
        }
        .transition(.opacity)
    }
}

private struct ToastBanner: View {
    let message: String

    var body: some View {
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

private struct NumPadButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .opacity(configuration.isPressed ? 0.6 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
