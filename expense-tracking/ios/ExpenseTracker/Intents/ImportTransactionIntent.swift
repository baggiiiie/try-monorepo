import AppIntents
import Foundation

struct ImportTransactionIntent: AppIntent {
    static var title: LocalizedStringResource = "Import Transaction"
    static var description: IntentDescription = "Import an Apple Pay transaction as a pending expense."

    @Parameter(title: "Amount")
    var amount: Double?

    @Parameter(title: "Merchant")
    var merchant: String?

    func perform() async throws -> some IntentResult {
        let db = AppDatabase.shared

        let suggestion = WalletSuggestion(
            id: UUID().uuidString,
            financekitTxId: nil,
            amount: amount.map { Int64(round($0 * 100)) },
            currency: "SGD",
            merchant: merchant ?? "Unknown",
            date: Int64(Date().timeIntervalSince1970),
            source: "shortcut",
            status: "pending",
            linkedExpenseId: nil,
            createdAt: Int64(Date().timeIntervalSince1970)
        )

        try await db.dbQueue.write { dbConn in
            var record = suggestion
            try record.insert(dbConn)
        }

        return .result()
    }
}
