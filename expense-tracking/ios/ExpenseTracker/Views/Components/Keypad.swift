import SwiftUI

struct ExpenseKeypad: View {
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
                            KeypadButton(
                                content: .text("\(digit)", size: min(buttonHeight * 0.4, 34)),
                                style: .secondary,
                                width: buttonWidth,
                                height: buttonHeight,
                                action: { onDigitTap("\(digit)") }
                            )
                        }
                    }
                }

                HStack(spacing: spacing) {
                    KeypadButton(
                        content: .systemImage("delete.backward", size: 22, weight: .regular),
                        style: .secondary,
                        width: buttonWidth,
                        height: buttonHeight,
                        action: onDeleteTap
                    )

                    KeypadButton(
                        content: .text("0", size: min(buttonHeight * 0.4, 34)),
                        style: .secondary,
                        width: buttonWidth,
                        height: buttonHeight,
                        action: { onDigitTap("0") }
                    )

                    KeypadButton(
                        content: .systemImage("checkmark", size: 22, weight: .bold),
                        style: .primary,
                        width: buttonWidth,
                        height: buttonHeight,
                        action: onSubmitTap
                    )
                }
            }
        }
    }
}

private enum KeypadContent {
    case text(String, size: CGFloat)
    case systemImage(String, size: CGFloat, weight: Font.Weight)
}

private enum KeypadButtonVisualStyle {
    case primary
    case secondary

    var foregroundColor: Color {
        switch self {
        case .primary:
            return Color(.systemBackground)
        case .secondary:
            return Color(.label)
        }
    }

    var backgroundColor: Color {
        switch self {
        case .primary:
            return Color(.label)
        case .secondary:
            return Color(.systemGray6)
        }
    }
}

private struct KeypadButton: View {
    let content: KeypadContent
    let style: KeypadButtonVisualStyle
    let width: CGFloat
    let height: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            contentView
                .foregroundStyle(style.foregroundColor)
                .frame(width: width, height: height)
                .background(style.backgroundColor, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(NumPadButtonStyle())
    }

    @ViewBuilder
    private var contentView: some View {
        switch content {
        case .text(let title, let size):
            Text(title)
                .font(.system(size: size, weight: .regular, design: .rounded))
        case .systemImage(let systemImage, let size, let weight):
            Image(systemName: systemImage)
                .font(.system(size: size, weight: weight))
        }
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
