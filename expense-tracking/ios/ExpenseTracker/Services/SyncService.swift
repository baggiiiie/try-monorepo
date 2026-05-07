import Foundation
import GRDB

/// The high-level state of the sync subsystem, observed by the UI.
///
/// Sync is an app-wide concern, not a per-view one. The view layer renders
/// this status; it never owns the underlying work.
enum SyncStatus: Equatable {
    case idle
    case syncing
    case failed(SyncError)

    static func == (lhs: SyncStatus, rhs: SyncStatus) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle), (.syncing, .syncing): return true
        case (.failed(let l), .failed(let r)): return l == r
        default: return false
        }
    }
}

/// Coordinates push/pull synchronization with the backend.
///
/// ## Concurrency model
///
/// `sync()` coalesces concurrent callers: if a sync is already in flight, the
/// new call awaits the same task instead of starting a second request. The
/// underlying work runs in an unstructured `Task` so cancellation of the
/// caller (e.g. SwiftUI tearing down a `.task` or `.refreshable` Task when
/// the view disappears or the user scrolls past the refresh control) does
/// **not** propagate into the URLSession request. A sync, once started, runs
/// to completion unless `cancel()` is called explicitly.
@MainActor
final class SyncService: ObservableObject {
    @Published private(set) var status: SyncStatus = .idle
    @Published private(set) var lastSucceededAt: Date?

    private let repository: SyncRepository
    private let preferences: SyncPreferences
    private let apiClient: SyncAPIClient

    private var inFlight: Task<Void, Never>?

    init(database: AppDatabase) {
        let preferences = SyncPreferences()
        self.preferences = preferences
        self.repository = SyncRepository(dbQueue: database.dbQueue)
        self.apiClient = SyncAPIClient(preferences: preferences)
    }

    /// Run a sync, coalescing with any in-flight sync. Safe to call from
    /// SwiftUI `.task` / `.refreshable`: caller cancellation does not abort
    /// the underlying request.
    @discardableResult
    func sync() async -> SyncStatus {
        let task = inFlight ?? startSync()
        // Task<Void, Never>.value never throws and does not propagate caller
        // cancellation, so we can await it from any context safely.
        await task.value
        return status
    }

    /// Cancel any in-flight sync. Use only for events that genuinely
    /// invalidate the request in flight (e.g. clearing the auth secret).
    func cancel() {
        inFlight?.cancel()
    }

    private func startSync() -> Task<Void, Never> {
        let task = Task { [weak self] in
            guard let self else { return }
            await self.runSync()
        }
        inFlight = task
        return task
    }

    private func runSync() async {
        status = .syncing
        defer { inFlight = nil }

        do {
            try await pushPendingChanges()
            try await pullLatestChanges()
            lastSucceededAt = Date()
            status = .idle
        } catch SyncError.cancelled {
            // Intentional cancellation is never user-visible.
            status = .idle
        } catch let error as SyncError {
            status = .failed(error)
        } catch {
            status = .failed(.unexpected(description: error.localizedDescription))
        }
    }

    private func pushPendingChanges() async throws {
        let pending = try repository.fetchPendingPushChanges()
        guard pending.hasChanges else { return }
        try preflight()
        let response = try await apiClient.push(request: pending.request)
        try repository.applyPushResponse(response)
    }

    private func pullLatestChanges() async throws {
        try preflight()
        let response = try await apiClient.pull(since: preferences.lastPulledVersion)
        try repository.applyPullResponse(response)
        preferences.lastPulledVersion = response.serverVersion
    }

    /// Validate configuration before issuing any network call so the user
    /// gets an actionable error instead of a generic transport failure.
    private func preflight() throws {
        guard preferences.hasServerURL else {
            throw SyncError.notConfigured(reason: "Server URL not configured")
        }
        guard preferences.hasSyncSecret else {
            throw SyncError.notConfigured(
                reason: "Sync secret not configured. Run `expense secret show` on the server and paste the value into Settings."
            )
        }
    }
}

// MARK: - Preferences

/// Thin wrapper over `UserDefaults` and the keychain for sync-related values.
/// Reads happen at request time, so configuration changes take effect on the
/// next sync without any explicit reload step.
final class SyncPreferences {
    var serverURL: String {
        UserDefaults.standard.string(forKey: AppPreferenceKey.serverURL)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    var hasServerURL: Bool { !serverURL.isEmpty }

    var lastPulledVersion: Int64 {
        get { Int64(UserDefaults.standard.integer(forKey: AppPreferenceKey.lastPulledVersion)) }
        set { UserDefaults.standard.set(newValue, forKey: AppPreferenceKey.lastPulledVersion) }
    }

    var syncSecret: String? { SyncSecretStore.current }
    var hasSyncSecret: Bool { SyncSecretStore.hasSecret }
}
