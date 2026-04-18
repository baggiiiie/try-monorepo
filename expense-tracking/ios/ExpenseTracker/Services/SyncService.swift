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
            try markPushedCategoriesAsSynced(response.categories, in: db)
            try markPushedExpensesAsSynced(response.expenses, in: db)
        }
    }

    func applyPullResponse(_ response: PullResponse) throws {
        try dbQueue.write { db in
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

private struct SyncAPIClient {
    let preferences: SyncPreferences

    func push(request: PushRequest) async throws -> PushResponse {
        let url = try endpoint(path: "/api/sync/push")
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try Self.jsonEncoder.encode(request)
        return try await perform(urlRequest, responseType: PushResponse.self)
    }

    func pull(since: Int64) async throws -> PullResponse {
        var components = URLComponents(url: try endpoint(path: "/api/sync/pull"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "since", value: String(since))]

        guard let url = components?.url else {
            throw SyncError.invalidServerURL
        }

        let request = URLRequest(url: url)
        return try await perform(request, responseType: PullResponse.self)
    }

    private func endpoint(path: String) throws -> URL {
        guard let baseURL = URL(string: preferences.serverURL), !preferences.serverURL.isEmpty else {
            throw SyncError.invalidServerURL
        }

        return baseURL.appending(path: path)
    }

    private func perform<Response: Decodable>(_ request: URLRequest, responseType: Response.Type) async throws -> Response {
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response)
        return try Self.jsonDecoder.decode(Response.self, from: data)
    }

    private func validate(response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SyncError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw SyncError.serverError(statusCode: httpResponse.statusCode)
        }
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
    case invalidResponse
    case serverError(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .invalidServerURL:
            return "Invalid server URL"
        case .invalidResponse:
            return "The server response was invalid"
        case .serverError(let statusCode):
            return "Server returned status \(statusCode)"
        }
    }
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
