import SwiftUI

struct SettingsView: View {
    @ObservedObject var syncService: SyncService
    @AppStorage(AppPreferenceKey.serverURL) private var serverURL = ""
    @AppStorage(AppPreferenceKey.currency) private var currency = "SGD"
    @AppStorage(AppPreferenceKey.timezone) private var timezone = "Asia/Singapore"

    @State private var hasSyncSecret: Bool = SyncSecretStore.hasSecret
    @State private var syncSecretInput: String = ""
    @State private var showSecretField: Bool = !SyncSecretStore.hasSecret

    var body: some View {
        NavigationStack {
            Form {
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
                                }
                            }
                            .disabled(syncSecretInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

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
                            if syncService.isSyncing {
                                ProgressView()
                            }
                        }
                    }
                    .disabled(syncService.isSyncing || serverURL.isEmpty || !hasSyncSecret)

                    if let lastSync = syncService.lastSyncTime {
                        HStack {
                            Text("Last Synced")
                            Spacer()
                            Text(lastSync, style: .relative)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let error = syncService.lastSyncError {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                            Text(error)
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
                        ApplePaySetupView()
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
}
