import SwiftUI

extension View {
    /// Keeps empty-state presentation consistent across list-based screens.
    func emptyState(
        _ isPresented: Bool,
        title: LocalizedStringKey,
        systemImage: String,
        description: LocalizedStringKey
    ) -> some View {
        overlay {
            if isPresented {
                ContentUnavailableView(
                    title,
                    systemImage: systemImage,
                    description: Text(description)
                )
            }
        }
    }
}
