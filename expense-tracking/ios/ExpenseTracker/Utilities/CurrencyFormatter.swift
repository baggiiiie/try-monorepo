import Foundation

struct CurrencyFormatter {
    static func format(cents: Int64, currency: String = "SGD") -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        return formatter.string(from: NSNumber(value: Double(cents) / 100.0))
            ?? "\(currency) \(String(format: "%.2f", Double(cents) / 100.0))"
    }
}
