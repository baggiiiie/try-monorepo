import SwiftUI

/// Compact icon that visualizes the current `SyncStatus`. Cancellation is
/// intentionally not surfaced (it indicates an aborted in-flight request,
/// not something the user should act on).
struct SyncStatusIndicator: View {
    let status: SyncStatus
    let lastSucceededAt: Date?

    var body: some View {
        switch status {
        case .syncing:
            ProgressView()
        case .failed(let error) where error.isUserVisible:
            switch error {
            case .offline:
                Image(systemName: "wifi.slash")
                    .foregroundStyle(.secondary)
                    .help(error.errorDescription ?? "Offline")
            default:
                Image(systemName: "exclamationmark.arrow.trianglehead.2.clockwise.rotate.90")
                    .foregroundStyle(.red)
                    .help(error.errorDescription ?? "Sync failed")
            }
        case .failed, .idle:
            if lastSucceededAt != nil {
                Image(systemName: "checkmark.icloud")
                    .foregroundStyle(.green)
            }
        }
    }
}
