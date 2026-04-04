import Foundation
import GRDB

@MainActor
class CategoryViewModel: ObservableObject {
    let database: AppDatabase
    @Published var categories: [Category] = []

    init(database: AppDatabase) {
        self.database = database
        refresh()
    }

    func refresh() {
        do {
            categories = try database.dbQueue.read { db in
                try Category
                    .filter(Category.Columns.deletedAt == nil)
                    .order(Category.Columns.name)
                    .fetchAll(db)
            }
        } catch {
            print("Error loading categories: \(error)")
        }
    }

    func delete(_ category: Category) {
        do {
            try database.dbQueue.write { db in
                var cat = category
                cat.deletedAt = Int64(Date().timeIntervalSince1970)
                cat.updatedAt = cat.deletedAt!
                try cat.update(db)
            }
            refresh()
        } catch {
            print("Error deleting category: \(error)")
        }
    }
}
