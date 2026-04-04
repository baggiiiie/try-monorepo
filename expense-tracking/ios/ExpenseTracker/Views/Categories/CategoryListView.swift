import SwiftUI

struct CategoryListView: View {
    @StateObject private var viewModel: CategoryViewModel
    @State private var showingAddCategory = false
    @State private var editingCategory: Category?

    init(database: AppDatabase) {
        _viewModel = StateObject(wrappedValue: CategoryViewModel(database: database))
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(viewModel.categories) { cat in
                    HStack {
                        Text(cat.icon)
                            .font(.title2)
                        VStack(alignment: .leading) {
                            Text(cat.name)
                            if let budget = cat.displayBudget {
                                Text("Budget: \(budget)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { editingCategory = cat }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            viewModel.delete(cat)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle("Categories")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingAddCategory = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddCategory) {
                CategoryFormView(database: viewModel.database, category: nil)
                    .onDisappear { viewModel.refresh() }
            }
            .sheet(item: $editingCategory) { cat in
                CategoryFormView(database: viewModel.database, category: cat)
                    .onDisappear { viewModel.refresh() }
            }
            .onAppear { viewModel.refresh() }
        }
    }
}
