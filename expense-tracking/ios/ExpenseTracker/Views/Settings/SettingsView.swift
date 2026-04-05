import SwiftUI

struct SettingsView: View {
    @ObservedObject var syncService: SyncService
    @AppStorage("serverURL") private var serverURL = ""
    @AppStorage("currency") private var currency = "SGD"
    @AppStorage("timezone") private var timezone = "Asia/Singapore"

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Server URL", text: $serverURL)
                        .textContentType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
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
                    .disabled(syncService.isSyncing || serverURL.isEmpty)

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

                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}
