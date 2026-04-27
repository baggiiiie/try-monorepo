import Foundation

enum RecurringExpenseSchedule {
    static func nextRunTimestamp(
        after previousRunDate: Date?,
        frequency: RecurringFrequency,
        dayOfMonth: Int?,
        startDate: Date,
        calendar: Calendar = .current
    ) -> Int64 {
        let date = nextRunDateValue(
            after: previousRunDate,
            frequency: frequency,
            dayOfMonth: dayOfMonth,
            startDate: startDate,
            calendar: calendar
        )
        return AppDateFormatter.unixTimestamp(from: date)
    }

    static func nextRunDate(
        after previousRunDate: Date?,
        frequency: RecurringFrequency,
        dayOfMonth: Int?,
        startDate: Date,
        calendar: Calendar = .current
    ) -> Date {
        nextRunDateValue(
            after: previousRunDate,
            frequency: frequency,
            dayOfMonth: dayOfMonth,
            startDate: startDate,
            calendar: calendar
        )
    }

    private static func nextRunDateValue(
        after previousRunDate: Date?,
        frequency: RecurringFrequency,
        dayOfMonth: Int?,
        startDate: Date,
        calendar: Calendar
    ) -> Date {
        let normalizedStartDate = calendar.startOfDay(for: startDate)

        guard let previousRunDate else {
            if frequency == .monthly {
                return firstMonthlyRunDate(onOrAfter: normalizedStartDate, dayOfMonth: dayOfMonth, calendar: calendar)
            }

            return normalizedStartDate
        }

        switch frequency {
        case .weekly:
            return calendar.date(byAdding: .weekOfYear, value: 1, to: calendar.startOfDay(for: previousRunDate)) ?? normalizedStartDate
        case .monthly:
            return nextMonthlyRunDate(after: previousRunDate, dayOfMonth: dayOfMonth, calendar: calendar)
        case .yearly:
            return calendar.date(byAdding: .year, value: 1, to: calendar.startOfDay(for: previousRunDate)) ?? normalizedStartDate
        }
    }

    private static func nextMonthlyRunDate(after previousRunDate: Date, dayOfMonth: Int?, calendar: Calendar) -> Date {
        let previousStart = calendar.startOfDay(for: previousRunDate)
        let targetDay = max(1, min(dayOfMonth ?? calendar.component(.day, from: previousStart), 31))
        guard let nextMonth = calendar.date(byAdding: .month, value: 1, to: previousStart) else {
            return previousStart
        }

        let components = calendar.dateComponents([.year, .month], from: nextMonth)
        let daysInMonth = calendar.range(of: .day, in: .month, for: nextMonth)?.count ?? targetDay

        var nextComponents = DateComponents()
        nextComponents.year = components.year
        nextComponents.month = components.month
        nextComponents.day = min(targetDay, daysInMonth)
        return calendar.date(from: nextComponents) ?? nextMonth
    }

    private static func firstMonthlyRunDate(onOrAfter startDate: Date, dayOfMonth: Int?, calendar: Calendar) -> Date {
        let targetDay = max(1, min(dayOfMonth ?? calendar.component(.day, from: startDate), 31))
        let currentMonthCandidate = monthlyRunDate(inMonthOf: startDate, targetDay: targetDay, calendar: calendar)

        if currentMonthCandidate >= startDate {
            return currentMonthCandidate
        }

        guard let nextMonth = calendar.date(byAdding: .month, value: 1, to: startDate) else {
            return startDate
        }
        return monthlyRunDate(inMonthOf: nextMonth, targetDay: targetDay, calendar: calendar)
    }

    private static func monthlyRunDate(inMonthOf date: Date, targetDay: Int, calendar: Calendar) -> Date {
        let components = calendar.dateComponents([.year, .month], from: date)
        let daysInMonth = calendar.range(of: .day, in: .month, for: date)?.count ?? targetDay

        var runComponents = DateComponents()
        runComponents.year = components.year
        runComponents.month = components.month
        runComponents.day = min(targetDay, daysInMonth)
        return calendar.date(from: runComponents) ?? calendar.startOfDay(for: date)
    }
}
