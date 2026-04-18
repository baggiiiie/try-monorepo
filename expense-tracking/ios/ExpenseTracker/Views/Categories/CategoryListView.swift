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
                    HStack {
                        Image(systemName: cat.displayIcon)
                            .font(.title2)
                            .frame(width: 28)
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
