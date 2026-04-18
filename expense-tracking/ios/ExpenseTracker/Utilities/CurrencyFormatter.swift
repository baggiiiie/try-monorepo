import Foundation

enum MoneyFormatter {
    static func decimalString(fromCents cents: Int64) -> String {
        String(format: "%.2f", Double(cents) / 100.0)
    }

    static func cents(fromDecimalString text: String) -> Int64? {
        let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let amount = Double(trimmedText) else { return nil }
        return Int64(amount * 100)
    }
}

enum CurrencyFormatter {
    private static var formattersByCurrency: [String: NumberFormatter] = [:]
    private static let lock = NSLock()

    static func format(cents: Int64, currency: String = "SGD") -> String {
        let formatter = formatter(for: currency)
        let amount = NSNumber(value: Double(cents) / 100.0)
        return formatter.string(from: amount) ?? "\(currency) \(MoneyFormatter.decimalString(fromCents: cents))"
    }

    private static func formatter(for currency: String) -> NumberFormatter {
        lock.lock()
        defer { lock.unlock() }

        if let formatter = formattersByCurrency[currency] {
            return formatter
        }

        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formattersByCurrency[currency] = formatter
        return formatter
    }
}

enum AppDateFormatter {
    static func date(fromUnixTimestamp timestamp: Int64) -> Date {
        Date(timeIntervalSince1970: TimeInterval(timestamp))
    }

    static func unixTimestamp(from date: Date) -> Int64 {
        Int64(date.timeIntervalSince1970)
    }

    static func mediumDateString(from date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }

    static func relativeExpenseDateString(from date: Date, calendar: Calendar = .current) -> String {
        let suffix = date.formatted(.dateTime.day().month(.abbreviated))

        if calendar.isDateInToday(date) {
            return "Today, \(suffix)"
        }

        if calendar.isDateInYesterday(date) {
            return "Yesterday, \(suffix)"
        }

        if calendar.isDateInTomorrow(date) {
            return "Tomorrow, \(suffix)"
        }

        return date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }

    static func shortTimeString(from date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    static func dayKey(from date: Date, calendar: Calendar = .current) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            components.year ?? 0,
            components.month ?? 0,
            components.day ?? 0
        )
    }

    static func date(fromDayKey dayKey: String, calendar: Calendar = .current) -> Date? {
        let parts = dayKey.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }

        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        return calendar.date(from: components)
    }
}
