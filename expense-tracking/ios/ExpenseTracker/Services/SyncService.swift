import Foundation
import GRDB

@MainActor
class SyncService: ObservableObject {
    @Published var isSyncing = false
    @Published var lastSyncError: String?
    @Published var lastSyncTime: Date?

    private let database: AppDatabase

    private var serverURL: String {
        UserDefaults.standard.string(forKey: "serverURL") ?? ""
    }

    private var lastPullAt: Int64 {
        get { Int64(UserDefaults.standard.integer(forKey: "lastPullAt")) }
        set { UserDefaults.standard.set(newValue, forKey: "lastPullAt") }
    }

    init(database: AppDatabase) {
        self.database = database
    }

    func sync() async {
        guard !isSyncing else { return }
        guard !serverURL.isEmpty else {
            lastSyncError = "Server URL not configured"
            return
        }

        isSyncing = true
        lastSyncError = nil

        do {
            try await push()
            try await pull()
            lastSyncTime = Date()
        } catch {
            lastSyncError = error.localizedDescription
        }

        isSyncing = false
    }

    // MARK: - Push

    private func push() async throws {
        let (expenses, categories) = try database.dbQueue.read { db in
            let expenses = try Expense
                .filter(Expense.Columns.syncStatus == "pending_push")
                .fetchAll(db)
            let categories = try Category
                .filter(Category.Columns.syncStatus == "pending_push")
                .fetchAll(db)
            return (expenses, categories)
        }

        if expenses.isEmpty && categories.isEmpty { return }

        let pushExpenses = expenses.map { e in
            PushExpense(
                clientId: e.clientId,
                amount: e.amount,
                currency: e.currency,
                categoryId: e.categoryId,
                description: e.description,
                merchant: e.merchant,
                date: e.date,
                source: e.source,
                updatedAt: e.updatedAt,
                deletedAt: e.deletedAt
            )
        }

        let pushCategories = categories.map { c in
            PushCategory(
                id: c.id,
                clientId: c.clientId,
                name: c.name,
                icon: c.icon,
                budget: c.budget,
                updatedAt: c.updatedAt,
                deletedAt: c.deletedAt
            )
        }

        let requestBody = PushRequest(
            expenses: pushExpenses,
            categories: pushCategories
        )

        let url = URL(string: "\(serverURL)/api/sync/push")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        request.httpBody = try encoder.encode(requestBody)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw SyncError.serverError(statusCode: statusCode)
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let pushResponse = try decoder.decode(PushResponse.self, from: data)

        try database.dbQueue.write { db in
            // Update categories first — cascade ID changes to expense.category_id
            for serverCategory in pushResponse.categories {
                guard let local = try Category
                    .filter(Category.Columns.clientId == serverCategory.clientId)
                    .fetchOne(db) else { continue }

                if local.id != serverCategory.id {
                    // Update FK references before changing the PK
                    try db.execute(
                        sql: "UPDATE expenses SET category_id = ? WHERE category_id = ?",
                        arguments: [serverCategory.id, local.id]
                    )
                    try db.execute(
                        sql: "UPDATE categories SET id = ?, updated_at = ?, sync_status = 'synced' WHERE client_id = ?",
                        arguments: [serverCategory.id, serverCategory.updatedAt, serverCategory.clientId]
                    )
                } else {
                    try db.execute(
                        sql: "UPDATE categories SET updated_at = ?, sync_status = 'synced' WHERE client_id = ?",
                        arguments: [serverCategory.updatedAt, serverCategory.clientId]
                    )
                }
            }

            for serverExpense in pushResponse.expenses {
                guard let local = try Expense
                    .filter(Expense.Columns.clientId == serverExpense.clientId)
                    .fetchOne(db) else { continue }

                if local.id != serverExpense.id {
                    try db.execute(
                        sql: "UPDATE expenses SET id = ?, category_id = ?, updated_at = ?, sync_status = 'synced' WHERE client_id = ?",
                        arguments: [serverExpense.id, serverExpense.categoryId, serverExpense.updatedAt, serverExpense.clientId]
                    )
                } else {
                    try db.execute(
                        sql: "UPDATE expenses SET category_id = ?, updated_at = ?, sync_status = 'synced' WHERE client_id = ?",
                        arguments: [serverExpense.categoryId, serverExpense.updatedAt, serverExpense.clientId]
                    )
                }
            }
        }
    }

    // MARK: - Pull

    private func pull() async throws {
        var components = URLComponents(string: "\(serverURL)/api/sync/pull")!
        components.queryItems = [URLQueryItem(name: "since", value: String(lastPullAt))]

        let (data, response) = try await URLSession.shared.data(from: components.url!)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw SyncError.serverError(statusCode: statusCode)
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let pullResponse = try decoder.decode(PullResponse.self, from: data)

        try database.dbQueue.write { db in
            // Upsert categories first so FK references resolve for expenses
            for serverCategory in pullResponse.categories {
                let local = try Category
                    .filter(Category.Columns.clientId == serverCategory.clientId)
                    .fetchOne(db)

                if let local {
                    // Update FK references if the PK changed
                    if local.id != serverCategory.id {
                        try db.execute(
                            sql: "UPDATE expenses SET category_id = ? WHERE category_id = ?",
                            arguments: [serverCategory.id, local.id]
                        )
                    }
                    // Server wins on pull — overwrite all fields via raw SQL
                    try db.execute(
                        sql: """
                            UPDATE categories
                            SET id = ?, name = ?, icon = ?, budget = ?,
                                created_at = ?, updated_at = ?, deleted_at = ?, sync_status = 'synced'
                            WHERE client_id = ?
                            """,
                        arguments: [
                            serverCategory.id, serverCategory.name, serverCategory.icon,
                            serverCategory.budget, serverCategory.createdAt,
                            serverCategory.updatedAt, serverCategory.deletedAt,
                            serverCategory.clientId
                        ]
                    )
                } else {
                    var category = Category(
                        id: serverCategory.id,
                        clientId: serverCategory.clientId,
                        name: serverCategory.name,
                        icon: serverCategory.icon,
                        budget: serverCategory.budget,
                        createdAt: serverCategory.createdAt,
                        updatedAt: serverCategory.updatedAt,
                        deletedAt: serverCategory.deletedAt,
                        syncStatus: "synced"
                    )
                    try category.insert(db)
                }
            }

            for serverExpense in pullResponse.expenses {
                let local = try Expense
                    .filter(Expense.Columns.clientId == serverExpense.clientId)
                    .fetchOne(db)

                if local != nil {
                    // Server wins on pull — overwrite all fields via raw SQL
                    try db.execute(
                        sql: """
                            UPDATE expenses
                            SET id = ?, amount = ?, currency = ?, category_id = ?,
                                description = ?, merchant = ?, date = ?, source = ?,
                                created_at = ?, updated_at = ?, deleted_at = ?, sync_status = 'synced'
                            WHERE client_id = ?
                            """,
                        arguments: [
                            serverExpense.id, serverExpense.amount, serverExpense.currency,
                            serverExpense.categoryId, serverExpense.description,
                            serverExpense.merchant, serverExpense.date, serverExpense.source,
                            serverExpense.createdAt, serverExpense.updatedAt,
                            serverExpense.deletedAt, serverExpense.clientId
                        ]
                    )
                } else {
                    var expense = Expense(
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
                        syncStatus: "synced"
                    )
                    try expense.insert(db)
                }
            }
        }

        lastPullAt = pullResponse.serverTime
    }
}

// MARK: - Error

enum SyncError: LocalizedError {
    case serverError(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .serverError(let statusCode):
            return "Server returned status \(statusCode)"
        }
    }
}

// MARK: - Push DTOs

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

// MARK: - Push Response DTOs

private struct PushResponse: Codable {
    let expenses: [PullExpense]
    let categories: [PullCategory]
    let serverTime: Int64
}

// MARK: - Pull Response DTOs

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
    let category: String
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
