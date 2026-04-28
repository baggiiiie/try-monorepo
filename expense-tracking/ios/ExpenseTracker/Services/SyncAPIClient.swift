import Foundation

// MARK: - Errors

/// All errors surfaced by the sync subsystem. UI code switches on these to
/// decide how (or whether) to display the failure.
enum SyncError: LocalizedError, Equatable {
    /// Required configuration (URL or secret) is missing. User-actionable.
    case notConfigured(reason: String)
    /// The device or network is unreachable. Typically rendered as a soft
    /// "offline" indicator rather than a hard error.
    case offline(description: String)
    /// The request was deliberately cancelled (`SyncService.cancel()` or a
    /// rare propagated cancellation). Never user-visible.
    case cancelled
    /// The configured `serverURL` could not be parsed.
    case invalidServerURL
    /// The transport completed but the response wasn't an HTTP response.
    case invalidResponse(requestID: String?)
    /// The response body could not be decoded into the expected DTO.
    case decodingFailed(requestID: String?)
    /// The server returned a non-2xx status.
    case server(status: Int, message: String?, requestID: String?)
    /// Anything we didn't classify above.
    case unexpected(description: String)

    var errorDescription: String? {
        switch self {
        case .notConfigured(let reason):
            return reason
        case .offline(let description):
            return description
        case .cancelled:
            return "Sync was cancelled"
        case .invalidServerURL:
            return "Invalid server URL"
        case .invalidResponse(let requestID):
            return Self.appendingClientRequestID("The server response was invalid", requestID: requestID)
        case .decodingFailed(let requestID):
            return Self.appendingServerRequestID("The server response could not be decoded", requestID: requestID)
        case .server(let status, let message, let requestID):
            return Self.appendingServerRequestID(message ?? "Server returned status \(status)", requestID: requestID)
        case .unexpected(let description):
            return description
        }
    }

    /// Whether this error should be surfaced to the user. `.cancelled` should
    /// be silent because cancellation is always either user-initiated or an
    /// expected side effect of configuration changes.
    var isUserVisible: Bool {
        if case .cancelled = self { return false }
        return true
    }

    private static func appendingServerRequestID(_ message: String, requestID: String?) -> String {
        guard let requestID, !requestID.isEmpty else { return message }
        return "\(message) (server request id: \(requestID))"
    }

    private static func appendingClientRequestID(_ message: String, requestID: String?) -> String {
        guard let requestID, !requestID.isEmpty else { return message }
        return "\(message) (client request id: \(requestID))"
    }
}

// MARK: - HTTP client

/// Performs the network half of synchronization. Pure transport: no UI state,
/// no DB access. Errors are normalized into `SyncError` so callers don't need
/// to think about `URLError` codes.
struct SyncAPIClient {
    let preferences: SyncPreferences
    var session: URLSession = .shared

    func push(request: PushRequest) async throws -> PushResponse {
        let url = try endpoint(path: "/api/sync/push")
        let requestID = Self.newRequestID()
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

        let requestID = Self.newRequestID()
        var request = URLRequest(url: url)
        applyObservabilityHeaders(to: &request, requestID: requestID)
        return try await perform(request, requestID: requestID, responseType: PullResponse.self)
    }

    // MARK: Internals

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

    private func perform<Response: Decodable>(
        _ request: URLRequest,
        requestID: String,
        responseType: Response.Type
    ) async throws -> Response {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let urlError as URLError {
            throw Self.classify(urlError)
        } catch is CancellationError {
            throw SyncError.cancelled
        } catch {
            throw SyncError.unexpected(description: error.localizedDescription)
        }

        try validate(response: response, data: data, fallbackRequestID: requestID)

        do {
            return try Self.jsonDecoder.decode(Response.self, from: data)
        } catch {
            throw SyncError.decodingFailed(requestID: Self.responseRequestID(from: response) ?? requestID)
        }
    }

    private func validate(response: URLResponse, data: Data, fallbackRequestID: String) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SyncError.invalidResponse(requestID: fallbackRequestID)
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let responseRequestID = Self.responseRequestID(from: httpResponse) ?? fallbackRequestID
            let errorMessage = try? Self.jsonDecoder.decode(ServerErrorResponse.self, from: data)
            throw SyncError.server(
                status: httpResponse.statusCode,
                message: errorMessage?.error,
                requestID: errorMessage?.requestID ?? responseRequestID
            )
        }
    }

    private static func classify(_ error: URLError) -> SyncError {
        switch error.code {
        case .cancelled:
            return .cancelled
        case .notConnectedToInternet,
             .networkConnectionLost,
             .timedOut,
             .cannotFindHost,
             .cannotConnectToHost,
             .dnsLookupFailed,
             .internationalRoamingOff,
             .callIsActive,
             .dataNotAllowed:
            return .offline(description: error.localizedDescription)
        default:
            return .unexpected(description: error.localizedDescription)
        }
    }

    private static func responseRequestID(from response: URLResponse) -> String? {
        guard let httpResponse = response as? HTTPURLResponse else { return nil }
        return httpResponse.value(forHTTPHeaderField: SyncHeader.requestID)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func newRequestID() -> String {
        UUID().uuidString.lowercased()
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

// MARK: - HTTP headers / build

enum SyncHeader {
    static let requestID = "X-Request-ID"
    static let clientBuild = "X-Client-Build"
}

enum AppBuild {
    static let version: String = {
        let bundle = Bundle.main
        if let explicitBuild = bundle.object(forInfoDictionaryKey: "AppBuildVersion") as? String,
           !explicitBuild.isEmpty {
            return explicitBuild
        }
        let marketingVersion = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let bundleVersion = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        switch (marketingVersion, bundleVersion) {
        case (.some(let marketing), .some(let bundle)) where !marketing.isEmpty && !bundle.isEmpty:
            return "\(marketing)-\(bundle)"
        case (.some(let marketing), _) where !marketing.isEmpty:
            return marketing
        case (_, .some(let bundle)) where !bundle.isEmpty:
            return bundle
        default:
            return "dev"
        }
    }()
}

// MARK: - Wire DTOs

struct ServerErrorResponse: Codable {
    let error: String
    let requestID: String?
}

struct PushRequest: Codable {
    let expenses: [PushExpense]
    let categories: [PushCategory]
    let recurringExpenses: [PushRecurringExpense]
}

struct PushExpense: Codable {
    let id: String
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

struct PushCategory: Codable {
    let id: String
    let name: String
    let icon: String
    let budget: Int64?
    let updatedAt: Int64
    let deletedAt: Int64?
}

struct PushRecurringExpense: Codable {
    let id: String
    let amount: Int64
    let currency: String
    let categoryId: String
    let description: String
    let merchant: String
    let frequency: String
    let dayOfMonth: Int?
    let startDate: Int64
    let endDate: Int64?
    let nextRunDate: Int64
    let lastRunDate: Int64?
    let updatedAt: Int64
    let deletedAt: Int64?
}

struct PushResponse: Codable {
    let expenses: [PullExpense]
    let categories: [PullCategory]
    let recurringExpenses: [PullRecurringExpense]
}

struct PullResponse: Codable {
    let expenses: [PullExpense]
    let categories: [PullCategory]
    let recurringExpenses: [PullRecurringExpense]
    let serverTime: Int64
}

struct PullExpense: Codable {
    let id: String
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

struct PullCategory: Codable {
    let id: String
    let name: String
    let icon: String
    let budget: Int64?
    let createdAt: Int64
    let updatedAt: Int64
    let deletedAt: Int64?
}

struct PullRecurringExpense: Codable {
    let id: String
    let amount: Int64
    let currency: String
    let categoryId: String
    let description: String
    let merchant: String
    let frequency: String
    let dayOfMonth: Int?
    let startDate: Int64
    let endDate: Int64?
    let nextRunDate: Int64
    let lastRunDate: Int64?
    let createdAt: Int64
    let updatedAt: Int64
    let deletedAt: Int64?
}

extension PushExpense {
    init(_ expense: Expense) {
        self.init(
            id: expense.id,
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

extension PushCategory {
    init(_ category: Category) {
        self.init(
            id: category.id,
            name: category.name,
            icon: category.icon,
            budget: category.budget,
            updatedAt: category.updatedAt,
            deletedAt: category.deletedAt
        )
    }
}

extension PushRecurringExpense {
    init(_ recurringExpense: RecurringExpense) {
        self.init(
            id: recurringExpense.id,
            amount: recurringExpense.amount,
            currency: recurringExpense.currency,
            categoryId: recurringExpense.categoryId,
            description: recurringExpense.description,
            merchant: recurringExpense.merchant,
            frequency: recurringExpense.frequency,
            dayOfMonth: recurringExpense.dayOfMonth,
            startDate: recurringExpense.startDate,
            endDate: recurringExpense.endDate,
            nextRunDate: recurringExpense.nextRunDate,
            lastRunDate: recurringExpense.lastRunDate,
            updatedAt: recurringExpense.updatedAt,
            deletedAt: recurringExpense.deletedAt
        )
    }
}
