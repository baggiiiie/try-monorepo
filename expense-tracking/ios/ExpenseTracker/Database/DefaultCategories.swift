import Foundation

/// Default categories shared with the server. Each entry has a deterministic
/// UUIDv5 (URL namespace, "expense-tracker:default-category:<name>") so both
/// the iOS client and the server seed the same primary key for a given name
/// and never produce duplicate rows during sync. See ADR 004.
enum DefaultCategories {
    static let all: [(id: String, name: String, icon: String)] = [
        ("63734549-381d-5655-ace8-afe849c5dde5", "Bills", "doc.text"),
        ("2216ebc9-f734-5d97-a90b-463c4a3ecc69", "Entertainment", "film"),
        ("fa9fc4ac-bdb6-577f-8429-6f582a7827b4", "Food & Dining", "fork.knife"),
        ("950515de-0d1a-5ccb-bc81-868badd1a6fc", "Groceries", "cart"),
        ("375b4aa5-cb75-5f1b-b905-cde070cd073c", "Health", "cross.case"),
        ("5768cc36-cb19-599b-8af8-6dbfefc98840", "Other", "shippingbox"),
        ("7276fe9b-6a9a-5297-8935-f28f145cded6", "Shopping", "bag"),
        ("6abd2b4f-6db1-5fbc-acc4-f66b8184919d", "Transport", "car"),
    ]
}
