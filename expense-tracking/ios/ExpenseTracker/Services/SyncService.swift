import Foundation
import GRDB

@MainActor
final class SyncService: ObservableObject {
    @Published var isSyncing = false
    @Published var lastSyncError: String?
    @Published var lastSyncTime: Date?

    private let syncRepository: SyncRepository
    private let preferences: SyncPreferences
    private let apiClient: SyncAPIClient

    init(database: AppDatabase) {
        self.syncRepository = SyncRepository(dbQueue: database.dbQueue)
        self.preferences = SyncPreferences()
        self.apiClient = SyncAPIClient(preferences: preferences)
    }

    func sync() async {
        guard !isSyncing else { return }
        guard preferences.hasServerURL else {
            lastSyncError = "Server URL not configured"
            return
        }
        guard preferences.hasSyncSecret else {
            lastSyncError = "Sync secret not configured. Run `expense secret show` on the server and paste the value into Settings."
            return
        }

        isSyncing = true
        lastSyncError = nil

        defer {
            isSyncing = false
        }

        do {
            try await pushPendingChanges()
            try await pullLatestChanges()
            lastSyncTime = Date()
        } catch {
            lastSyncError = error.localizedDescription
        }
    }

    private func pushPendingChanges() async throws {
        let pendingChanges = try fetchPendingChanges()
        guard pendingChanges.hasChanges else { return }

        let response = try await apiClient.push(request: pendingChanges.request)
        try applyPushResponse(response)
    }

    private func pullLatestChanges() async throws {
        let response = try await apiClient.pull(since: preferences.lastPullAt)
        try applyPullResponse(response)
        preferences.lastPullAt = response.serverTime
    }

    private func fetchPendingChanges() throws -> PendingPushChanges {
        try syncRepository.fetchPendingPushChanges()
    }

    private func applyPushResponse(_ response: PushResponse) throws {
        try syncRepository.applyPushResponse(response)
    }

    private func applyPullResponse(_ response: PullResponse) throws {
        try syncRepository.applyPullResponse(response)
    }
}

private final class SyncPreferences {
    var serverURL: String {
        UserDefaults.standard.string(forKey: AppPreferenceKey.serverURL)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    var hasServerURL: Bool {
        !serverURL.isEmpty
    }

    var lastPullAt: Int64 {
        get { Int64(UserDefaults.standard.integer(forKey: AppPreferenceKey.lastPullAt)) }
        set { UserDefaults.standard.set(newValue, forKey: AppPreferenceKey.lastPullAt) }
    }

    var syncSecret: String? {
        SyncSecretStore.current
    }

    var hasSyncSecret: Bool {
        SyncSecretStore.hasSecret
    }
}

private struct SyncRepository {
    let dbQueue: DatabaseQueue

    func fetchPendingPushChanges() throws -> PendingPushChanges {
        try dbQueue.read { db in
            let expenses = try Expense
                .filter(Expense.Columns.syncStatus == RecordSyncStatus.pendingPush.rawValue)
                .fetchAll(db)
            let categories = try Category
                .filter(Category.Columns.syncStatus == RecordSyncStatus.pendingPush.rawValue)
                .fetchAll(db)
            return PendingPushChanges(expenses: expenses, categories: categories)
        }
    }

    func applyPushResponse(_ response: PushResponse) throws {
        try dbQueue.write { db in
            try db.execute(sql: "PRAGMA defer_foreign_keys = ON")
            try markPushedCategoriesAsSynced(response.categories, in: db)
            try markPushedExpensesAsSynced(response.expenses, in: db)
        }
    }

    func applyPullResponse(_ response: PullResponse) throws {
        try dbQueue.write { db in
            try db.execute(sql: "PRAGMA defer_foreign_keys = ON")
            for category in response.categories {
                try upsertCategory(category, in: db)
            }

            for expense in response.expenses {
                try upsertExpense(expense, in: db)
            }
        }
    }

    private func markPushedCategoriesAsSynced(_ categories: [PullCategory], in db: Database) throws {
        for serverCategory in categories {
            guard let localCategory = try Category
                .filter(Category.Columns.clientId == serverCategory.clientId)
                .fetchOne(db) else {
                continue
            }

            if localCategory.id != serverCategory.id {
                try updateExpenseCategoryReferences(from: localCategory.id, to: serverCategory.id, in: db)
                try db.execute(
                    sql: "UPDATE categories SET id = ?, updated_at = ?, sync_status = ? WHERE client_id = ?",
                    arguments: [
                        serverCategory.id,
                        serverCategory.updatedAt,
                        RecordSyncStatus.synced.rawValue,
                        serverCategory.clientId,
                    ]
                )
            } else {
                try db.execute(
                    sql: "UPDATE categories SET updated_at = ?, sync_status = ? WHERE client_id = ?",
                    arguments: [
                        serverCategory.updatedAt,
                        RecordSyncStatus.synced.rawValue,
                        serverCategory.clientId,
                    ]
                )
            }
        }
    }

    private func markPushedExpensesAsSynced(_ expenses: [PullExpense], in db: Database) throws {
        for serverExpense in expenses {
            guard let localExpense = try Expense
                .filter(Expense.Columns.clientId == serverExpense.clientId)
                .fetchOne(db) else {
                continue
            }

            if localExpense.id != serverExpense.id {
                try db.execute(
                    sql: "UPDATE expenses SET id = ?, category_id = ?, updated_at = ?, sync_status = ? WHERE client_id = ?",
                    arguments: [
                        serverExpense.id,
                        serverExpense.categoryId,
                        serverExpense.updatedAt,
                        RecordSyncStatus.synced.rawValue,
                        serverExpense.clientId,
                    ]
                )
            } else {
                try db.execute(
                    sql: "UPDATE expenses SET category_id = ?, updated_at = ?, sync_status = ? WHERE client_id = ?",
                    arguments: [
                        serverExpense.categoryId,
                        serverExpense.updatedAt,
                        RecordSyncStatus.synced.rawValue,
                        serverExpense.clientId,
                    ]
                )
            }
        }
    }

    private func upsertCategory(_ serverCategory: PullCategory, in db: Database) throws {
        let localCategory = try Category
            .filter(Category.Columns.clientId == serverCategory.clientId)
            .fetchOne(db)

        if let localCategory {
            if localCategory.id != serverCategory.id {
                try updateExpenseCategoryReferences(from: localCategory.id, to: serverCategory.id, in: db)
            }

            try db.execute(
                sql: """
                    UPDATE categories
                    SET id = ?, name = ?, icon = ?, budget = ?,
                        created_at = ?, updated_at = ?, deleted_at = ?, sync_status = ?
                    WHERE client_id = ?
                    """,
                arguments: [
                    serverCategory.id,
                    serverCategory.name,
                    serverCategory.icon,
                    serverCategory.budget,
                    serverCategory.createdAt,
                    serverCategory.updatedAt,
                    serverCategory.deletedAt,
                    RecordSyncStatus.synced.rawValue,
                    serverCategory.clientId,
                ]
            )
            return
        }

        let category = Category(
            id: serverCategory.id,
            clientId: serverCategory.clientId,
            name: serverCategory.name,
            icon: serverCategory.icon,
            budget: serverCategory.budget,
            createdAt: serverCategory.createdAt,
            updatedAt: serverCategory.updatedAt,
            deletedAt: serverCategory.deletedAt,
            syncStatus: RecordSyncStatus.synced.rawValue
        )
        try category.insert(db)
    }

    private func upsertExpense(_ serverExpense: PullExpense, in db: Database) throws {
        let localExpense = try Expense
            .filter(Expense.Columns.clientId == serverExpense.clientId)
            .fetchOne(db)

        if localExpense != nil {
            try db.execute(
                sql: """
                    UPDATE expenses
                    SET id = ?, amount = ?, currency = ?, category_id = ?,
                        description = ?, merchant = ?, date = ?, source = ?,
                        created_at = ?, updated_at = ?, deleted_at = ?, sync_status = ?
                    WHERE client_id = ?
                    """,
                arguments: [
                    serverExpense.id,
                    serverExpense.amount,
                    serverExpense.currency,
                    serverExpense.categoryId,
                    serverExpense.description,
                    serverExpense.merchant,
                    serverExpense.date,
                    serverExpense.source,
                    serverExpense.createdAt,
                    serverExpense.updatedAt,
                    serverExpense.deletedAt,
                    RecordSyncStatus.synced.rawValue,
                    serverExpense.clientId,
                ]
            )
            return
        }

        let expense = Expense(
            id: serverExpense.id,
            clientId: serverExpense.clientId,
            amount: serverExpense.amount,
            currency: serverExpense.currency,
            categoryId: serverExpense.categoryId,
            description: serverExpense.description,
            merchant: serverExpense.merchant,
            date: serverExpense.date,
            source: serverExpense.source,
            createdAt: serverExpense.createdAt,
            updatedAt: serverExpense.updatedAt,
            deletedAt: serverExpense.deletedAt,
            syncStatus: RecordSyncStatus.synced.rawValue
        )
        try expense.insert(db)
    }

    private func updateExpenseCategoryReferences(from oldCategoryId: String, to newCategoryId: String, in db: Database) throws {
        try db.execute(
            sql: "UPDATE expenses SET category_id = ? WHERE category_id = ?",
            arguments: [newCategoryId, oldCategoryId]
        )
    }
}

private struct PendingPushChanges {
    let expenses: [Expense]
    let categories: [Category]

    var hasChanges: Bool {
        !expenses.isEmpty || !categories.isEmpty
    }

    var request: PushRequest {
        PushRequest(
            expenses: expenses.map(PushExpense.init),
            categories: categories.map(PushCategory.init)
        )
    }
}

private enum SyncHeader {
    static let requestID = "X-Request-ID"
    static let clientBuild = "X-Client-Build"
}

private enum AppBuild {
    static var version: String {
        if let explicitBuild = Bundle.main.object(forInfoDictionaryKey: "AppBuildVersion") as? String {
            let trimmed = explicitBuild.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, !trimmed.contains("$(") {
                return trimmed
            }
        }

        let marketingVersion = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let bundleVersion = (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        switch (marketingVersion, bundleVersion) {
        case let (.some(marketingVersion), .some(bundleVersion)) where !marketingVersion.isEmpty && !bundleVersion.isEmpty:
            return "\(marketingVersion)-\(bundleVersion)"
        case let (.some(marketingVersion), _) where !marketingVersion.isEmpty:
            return marketingVersion
        case let (_, .some(bundleVersion)) where !bundleVersion.isEmpty:
            return bundleVersion
        default:
            return "dev"
        }
    }
}

private struct SyncAPIClient {
    let preferences: SyncPreferences

    func push(request: PushRequest) async throws -> PushResponse {
        let url = try endpoint(path: "/api/sync/push")
        let requestID = UUID().uuidString.lowercased()
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyObservabilityHeaders(to: &urlRequest, requestID: requestID)
        urlRequest.httpBody = try Self.jsonEncoder.encode(request)
        return try await perform(urlRequest, requestID: requestID, responseType: PushResponse.self)
    }

    func pull(since: Int64) async throws -> PullResponse {
        var components = URLComponents(url: try endpoint(path: "/api/sync/pull"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "since", value: String(since))]

        guard let url = components?.url else {
            throw SyncError.invalidServerURL
        }

        let requestID = UUID().uuidString.lowercased()
        var request = URLRequest(url: url)
        applyObservabilityHeaders(to: &request, requestID: requestID)
        return try await perform(request, requestID: requestID, responseType: PullResponse.self)
    }

    private func endpoint(path: String) throws -> URL {
        guard let baseURL = URL(string: preferences.serverURL), !preferences.serverURL.isEmpty else {
            throw SyncError.invalidServerURL
        }

        return baseURL.appending(path: path)
    }

    private func applyObservabilityHeaders(to request: inout URLRequest, requestID: String) {
        request.setValue(requestID, forHTTPHeaderField: SyncHeader.requestID)
        request.setValue(AppBuild.version, forHTTPHeaderField: SyncHeader.clientBuild)
        request.setValue("ExpenseTracker/\(AppBuild.version)", forHTTPHeaderField: "User-Agent")
        if let secret = preferences.syncSecret {
            request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        }
    }

    private func perform<Response: Decodable>(_ request: URLRequest, requestID: String, responseType: Response.Type) async throws -> Response {
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            try validate(response: response, data: data, fallbackRequestID: requestID)
            do {
                return try Self.jsonDecoder.decode(Response.self, from: data)
            } catch {
                throw SyncError.decodingFailed(requestID: responseRequestID(from: response) ?? requestID)
            }
        } catch let error as SyncError {
            throw error
        } catch {
            throw SyncError.networkFailure(
                requestID: requestID,
                description: error.localizedDescription
            )
        }
    }

    private func validate(response: URLResponse, data: Data, fallbackRequestID: String) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SyncError.invalidResponse(requestID: fallbackRequestID)
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let responseRequestID = responseRequestID(from: httpResponse) ?? fallbackRequestID
            let errorMessage = try? Self.jsonDecoder.decode(ServerErrorResponse.self, from: data)
            throw SyncError.serverError(
                statusCode: httpResponse.statusCode,
                message: errorMessage?.error,
                requestID: errorMessage?.requestID ?? responseRequestID
            )
        }
    }

    private func responseRequestID(from response: URLResponse) -> String? {
        guard let httpResponse = response as? HTTPURLResponse else {
            return nil
        }
        return responseRequestID(from: httpResponse)
    }

    private func responseRequestID(from response: HTTPURLResponse) -> String? {
        response.value(forHTTPHeaderField: SyncHeader.requestID)?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static let jsonEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }()

    private static let jsonDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()
}

private extension PushExpense {
    init(_ expense: Expense) {
        self.init(
            clientId: expense.clientId,
            amount: expense.amount,
            currency: expense.currency,
            categoryId: expense.categoryId,
            description: expense.description,
            merchant: expense.merchant,
            date: expense.date,
            source: expense.source,
            updatedAt: expense.updatedAt,
            deletedAt: expense.deletedAt
        )
    }
}

private extension PushCategory {
    init(_ category: Category) {
        self.init(
            id: category.id,
            clientId: category.clientId,
            name: category.name,
            icon: category.icon,
            budget: category.budget,
            updatedAt: category.updatedAt,
            deletedAt: category.deletedAt
        )
    }
}

private enum SyncError: LocalizedError {
    case invalidServerURL
    case invalidResponse(requestID: String?)
    case decodingFailed(requestID: String?)
    case networkFailure(requestID: String, description: String)
    case serverError(statusCode: Int, message: String?, requestID: String?)

    var errorDescription: String? {
        switch self {
        case .invalidServerURL:
            return "Invalid server URL"
        case .invalidResponse(let requestID):
            return withClientRequestID("The server response was invalid", requestID: requestID)
        case .decodingFailed(let requestID):
            return withServerRequestID("The server response could not be decoded", requestID: requestID)
        case .networkFailure(let requestID, let description):
            return withClientRequestID(description, requestID: requestID)
        case .serverError(let statusCode, let message, let requestID):
            return withServerRequestID(message ?? "Server returned status \(statusCode)", requestID: requestID)
        }
    }

    private func withServerRequestID(_ message: String, requestID: String?) -> String {
        guard let requestID, !requestID.isEmpty else {
            return message
        }
        return "\(message) (server request id: \(requestID))"
    }

    private func withClientRequestID(_ message: String, requestID: String?) -> String {
        guard let requestID, !requestID.isEmpty else {
            return message
        }
        return "\(message) (client request id: \(requestID))"
    }
}

private struct ServerErrorResponse: Codable {
    let error: String
    let requestID: String?
}

private struct PushRequest: Codable {
    let expenses: [PushExpense]
    let categories: [PushCategory]
}

private struct PushExpense: Codable {
    let clientId: String
    let amount: Int64
    let currency: String
    let categoryId: String
    let description: String
    let merchant: String
    let date: Int64
    let source: String
    let updatedAt: Int64
    let deletedAt: Int64?
}

private struct PushCategory: Codable {
    let id: String
    let clientId: String
    let name: String
    let icon: String
    let budget: Int64?
    let updatedAt: Int64
    let deletedAt: Int64?
}

private struct PushResponse: Codable {
    let expenses: [PullExpense]
    let categories: [PullCategory]
}

private struct PullResponse: Codable {
    let expenses: [PullExpense]
    let categories: [PullCategory]
    let serverTime: Int64
}

private struct PullExpense: Codable {
    let id: String
    let clientId: String
    let amount: Int64
    let currency: String
    let categoryId: String
    let description: String
    let merchant: String
    let date: Int64
    let source: String
    let createdAt: Int64
    let updatedAt: Int64
    let deletedAt: Int64?
}

private struct PullCategory: Codable {
    let id: String
    let clientId: String
    let name: String
    let icon: String
    let budget: Int64?
    let createdAt: Int64
    let updatedAt: Int64
    let deletedAt: Int64?
}
