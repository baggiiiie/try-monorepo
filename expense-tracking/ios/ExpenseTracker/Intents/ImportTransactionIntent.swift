import AppIntents
import Foundation

struct ImportTransactionIntent: AppIntent {
    static var title: LocalizedStringResource = "Import Transaction"
    static var description: IntentDescription = "Import an Apple Pay transaction as a pending expense."

    @Parameter(title: "Amount")
    var amount: Double?

    @Parameter(title: "Merchant")
    var merchant: String?

    @Parameter(title: "Card")
    var cardName: String?

    @Parameter(title: "Name")
    var transactionName: String?

    func perform() async throws -> some IntentResult {
        let db = AppDatabase.shared

        let suggestion = WalletSuggestion(
            id: UUID().uuidString,
            financekitTxId: nil,
            amount: amount.map { Int64(round($0 * 100)) },
            currency: "SGD",
            merchant: merchant ?? "Unknown",
            cardName: cardName,
            transactionName: transactionName,
            date: Int64(Date().timeIntervalSince1970),
            source: ExpenseSource.shortcut.rawValue,
            status: WalletSuggestionStatus.pending.rawValue,
            linkedExpenseId: nil,
            createdAt: Int64(Date().timeIntervalSince1970)
        )

        try await db.dbQueue.write { dbConn in
            try suggestion.insert(dbConn)
        }

        return .result()
    }
}
