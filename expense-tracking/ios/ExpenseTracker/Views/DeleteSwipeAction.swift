import SwiftUI

extension View {
    func deleteSwipeAction(_ action: @escaping () -> Void) -> some View {
        swipeActions(edge: .trailing) {
            Button(role: .destructive, action: action) {
                Label("Delete", systemImage: "trash")
            }
        }
    }
}
