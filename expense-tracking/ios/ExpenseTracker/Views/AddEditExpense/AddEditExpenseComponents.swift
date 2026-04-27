import SwiftUI

struct AddEditExpenseTopBar: View {
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

struct ExpenseAmountSection: View {
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

struct ExpenseMerchantField: View {
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

struct ExpenseControlsRow: View {
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

struct ExpenseCategoryPicker: View {
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

struct ExpenseDatePickerOverlay: View {
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
