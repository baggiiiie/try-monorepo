import Foundation

struct AppPreferences: Codable {
    var currency: String = "SGD"
    var timezone: String = "Asia/Singapore"
    var dateFormat: String = "yyyy-MM-dd"
    var serverURL: String = ""

    static let defaultPreferences = AppPreferences()

    enum CodingKeys: String, CodingKey {
        case currency
        case timezone
        case dateFormat = "date_format"
        case serverURL = "server_url"
    }
}
