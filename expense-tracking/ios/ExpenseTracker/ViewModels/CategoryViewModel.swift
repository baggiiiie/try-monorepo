import Foundation

@MainActor
final class CategoryViewModel: ObservableObject {
    @Published var categories: [Category] = []
    @Published var defaultCategoryId: String

    private let categoryRepository: CategoryRepository

    private static let defaultCategoryKey = "defaultCategoryId"

    init(database: AppDatabase) {
        self.categoryRepository = database.categoryRepository
        self.defaultCategoryId = UserDefaults.standard.string(forKey: Self.defaultCategoryKey) ?? ""
        refresh()
    }

    func refresh() {
        do {
            categories = try categoryRepository.fetchActive()
        } catch {
            print("Error loading categories: \(error)")
        }
    }

    func setDefault(_ category: Category) {
        let newId = defaultCategoryId == category.id ? "" : category.id
        defaultCategoryId = newId
        UserDefaults.standard.set(newId.isEmpty ? nil : newId, forKey: Self.defaultCategoryKey)
    }

    func delete(_ category: Category) {
        do {
            try categoryRepository.softDelete(category)
            if defaultCategoryId == category.id {
                defaultCategoryId = ""
                UserDefaults.standard.removeObject(forKey: Self.defaultCategoryKey)
            }
            refresh()
        } catch {
            print("Error deleting category: \(error)")
        }
    }
}
