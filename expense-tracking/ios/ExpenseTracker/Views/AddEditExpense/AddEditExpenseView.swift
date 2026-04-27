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
                                onDigitTap: { digit in
                                    HapticManager.impact(.light)
                                    viewModel.appendDigit(digit)
                                },
                                onDeleteTap: {
                                    HapticManager.impact(.light)
                                    viewModel.deleteLastDigit()
                                },
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
            HapticManager.notify(.success)
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

