import SwiftUI

struct FormToolbar: ToolbarContent {
    let cancelTitle: String
    let saveTitle: String
    let isSaveDisabled: Bool
    let onCancel: () -> Void
    let onSave: () -> Void

    init(
        cancelTitle: String = "Cancel",
        saveTitle: String = "Save",
        isSaveDisabled: Bool = false,
        onCancel: @escaping () -> Void,
        onSave: @escaping () -> Void
    ) {
        self.cancelTitle = cancelTitle
        self.saveTitle = saveTitle
        self.isSaveDisabled = isSaveDisabled
        self.onCancel = onCancel
        self.onSave = onSave
    }

    var body: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button(cancelTitle, action: onCancel)
        }

        ToolbarItem(placement: .confirmationAction) {
            Button(saveTitle, action: onSave)
                .disabled(isSaveDisabled)
        }
    }
}
