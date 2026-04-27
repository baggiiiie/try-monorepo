import SwiftUI

struct CategoryListView: View {
    let database: AppDatabase
    @StateObject private var viewModel: CategoryViewModel
    @State private var showingAddCategory = false
    @State private var editingCategory: Category?

    init(database: AppDatabase) {
        self.database = database
        _viewModel = StateObject(wrappedValue: CategoryViewModel(database: database))
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(viewModel.categories) { cat in
                    CategoryRow(category: cat, isDefault: viewModel.defaultCategoryId == cat.id)
                    .contentShape(Rectangle())
                    .onTapGesture { editingCategory = cat }
                    .swipeActions(edge: .leading) {
                        Button {
                            viewModel.setDefault(cat)
                        } label: {
                            Label(
                                viewModel.defaultCategoryId == cat.id ? "Unset Default" : "Set Default",
                                systemImage: "star.fill"
                            )
                        }
                        .tint(.yellow)
                    }
                    .deleteSwipeAction {
                        HapticManager.notify(.warning)
                        viewModel.delete(cat)
                    }
                }
            }
            .emptyState(
                viewModel.categories.isEmpty,
                title: "No Categories",
                systemImage: "tag",
                description: "Tap + to create your first category"
            )
            .navigationTitle("Categories")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingAddCategory = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddCategory) {
                CategoryFormView(database: database, category: nil)
                    .onDisappear(perform: viewModel.refresh)
            }
            .sheet(item: $editingCategory) { cat in
                CategoryFormView(database: database, category: cat)
                    .onDisappear(perform: viewModel.refresh)
            }
            .onAppear { viewModel.refresh() }
        }
    }
}

private struct CategoryRow: View {
    let category: Category
    let isDefault: Bool

    var body: some View {
        HStack {
            Image(systemName: category.displayIcon)
                .font(.title2)
                .frame(width: 28)

            VStack(alignment: .leading) {
                Text(category.name)
                if let budget = category.displayBudget {
                    Text("Budget: \(budget)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if isDefault {
                Image(systemName: "star.fill")
                    .foregroundStyle(.yellow)
            }
        }
    }
}
