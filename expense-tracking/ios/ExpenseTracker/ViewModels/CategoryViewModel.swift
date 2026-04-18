import Foundation

@MainActor
final class CategoryViewModel: ObservableObject {
    @Published var categories: [Category] = []

    private let categoryRepository: CategoryRepository

    init(database: AppDatabase) {
        self.categoryRepository = database.categoryRepository
        refresh()
    }

    func refresh() {
        do {
            categories = try categoryRepository.fetchActive()
        } catch {
            print("Error loading categories: \(error)")
        }
    }

    func delete(_ category: Category) {
        do {
            try categoryRepository.softDelete(category)
            refresh()
        } catch {
            print("Error deleting category: \(error)")
        }
    }
}
