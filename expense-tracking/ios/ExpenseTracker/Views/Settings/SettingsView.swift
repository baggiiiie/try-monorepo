import SwiftUI

struct SettingsView: View {
    let database: AppDatabase
    @ObservedObject var syncService: SyncService
    @AppStorage(AppPreferenceKey.serverURL) private var serverURL = ""
    @AppStorage(AppPreferenceKey.currency) private var currency = "SGD"
    @AppStorage(AppPreferenceKey.timezone) private var timezone = "Asia/Singapore"

    @State private var hasSyncSecret: Bool = SyncSecretStore.hasSecret
    @State private var syncSecretInput: String = ""
    @State private var showSecretField: Bool = !SyncSecretStore.hasSecret

    private var trimmedServerURL: String {
        serverURL.trimmedForValidation
    }

    var body: some View {
        Form {
            Section {
                NavigationLink {
                    CategoryListView(database: database)
                } label: {
                    Label("Categories", systemImage: "tag")
                }
                NavigationLink {
                    RecurringExpensesView(database: database)
                } label: {
                    Label("Recurring", systemImage: "repeat")
                }
            }

        Section("Server") {
                TextField("Server URL", text: $serverURL)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)

                HStack {
                    Text("Sync Secret")
                    Spacer()
                    Text(hasSyncSecret ? "•••• set" : "not set")
                        .foregroundStyle(hasSyncSecret ? Color.secondary : Color.red)
                }

                if showSecretField {
                    SecureField("Paste secret from server", text: $syncSecretInput)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)

                    HStack {
                        Button("Save Secret") {
                            if SyncSecretStore.set(syncSecretInput) {
                                syncSecretInput = ""
                                hasSyncSecret = SyncSecretStore.hasSecret
                                showSecretField = false
                                // New credentials available: trigger a sync now.
                                Task { await syncService.sync() }
                            }
                        }
                        .disabled(syncSecretInput.trimmedForValidation.isEmpty)

                        Spacer()

                        if hasSyncSecret {
                            Button("Cancel", role: .cancel) {
                                syncSecretInput = ""
                                showSecretField = false
                            }
                        }
                    }
                } else {
                    Button("Replace Secret") {
                        showSecretField = true
                    }
                    if hasSyncSecret {
                        Button("Clear Secret", role: .destructive) {
                            // Any in-flight sync is using the secret we're about
                            // to remove, so cancel it deliberately.
                            syncService.cancel()
                            SyncSecretStore.clear()
                            hasSyncSecret = SyncSecretStore.hasSecret
                            showSecretField = true
                        }
                    }
                }
            }

            Section("Sync") {
                Button {
                    Task { await syncService.sync() }
                } label: {
                    HStack {
                        Text("Sync Now")
                        Spacer()
                        if syncService.status == .syncing {
                            ProgressView()
                        }
                    }
                }
                .disabled(syncService.status == .syncing || trimmedServerURL.isEmpty || !hasSyncSecret)

                if let lastSync = syncService.lastSucceededAt {
                    HStack {
                        Text("Last Synced")
                        Spacer()
                        Text(lastSync, style: .relative)
                            .foregroundStyle(.secondary)
                    }
                }

                if case .failed(let error) = syncService.status,
                   error.isUserVisible,
                   let message = error.errorDescription {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }

            Section("Preferences") {
                HStack {
                    Text("Currency")
                    Spacer()
                    TextField("", text: $currency)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 80)
                }
                HStack {
                    Text("Timezone")
                    Spacer()
                    Text(timezone)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Apple Pay Automation") {
                NavigationLink {
                    ApplePaySetupView(serverURL: trimmedServerURL)
                } label: {
                    HStack {
                        Image(systemName: "creditcard")
                        Text("Set Up Apple Pay Automation")
                    }
                }
            }

            Section("About") {
                HStack {
                    Text("Version")
                    Spacer()
                    Text("dev")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Settings")
    }
}
