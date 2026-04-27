import Foundation
import GRDB

struct CategoryRepository {
    let dbQueue: DatabaseQueue

    func fetchActive() throws -> [Category] {
        try dbQueue.read { db in
            try Category
                .filter(Category.Columns.deletedAt == nil)
                .order(Category.Columns.name)
                .fetchAll(db)
        }
    }

    func save(_ draft: CategoryDraft, editing existingCategory: Category?) throws {
        let now = Int64(Date().timeIntervalSince1970)

        try dbQueue.write { db in
            if var existingCategory {
                existingCategory.name = draft.name
                existingCategory.icon = draft.icon
                existingCategory.budget = draft.budget
                existingCategory.updatedAt = now
                existingCategory.syncStatus = RecordSyncStatus.pendingPush.rawValue
                try existingCategory.update(db)
                return
            }

            let category = Category(
                id: UUID().uuidString,
                name: draft.name,
                icon: draft.icon,
                budget: draft.budget,
                createdAt: now,
                updatedAt: now,
                deletedAt: nil,
                syncStatus: RecordSyncStatus.pendingPush.rawValue
            )
            try category.insert(db)
        }
    }

    func softDelete(_ category: Category) throws {
        let deletedAt = Int64(Date().timeIntervalSince1970)

        try dbQueue.write { db in
            var category = category
            category.deletedAt = deletedAt
            category.updatedAt = deletedAt
            category.syncStatus = RecordSyncStatus.pendingPush.rawValue
            try category.update(db)
        }
    }
}
