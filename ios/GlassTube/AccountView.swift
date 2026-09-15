import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var store: Store
    @State private var note = ""
    @State private var busy = false

    var body: some View {
        List {
            Section {
                if let me = store.account {
                    HStack(spacing: 12) {
                        AsyncImage(url: URL(string: me.picture)) { phase in
                            if case .success(let img) = phase {
                                img.resizable().aspectRatio(contentMode: .fill)
                            } else {
                                Circle().fill(Color(.tertiarySystemFill))
                            }
                        }
                        .frame(width: 44, height: 44)
                        .clipShape(Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(me.name).font(.subheadline.weight(.semibold))
                            Text(me.email).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Button {
                        signIn()
                    } label: {
                        HStack {
                            Label("Continue with Google", systemImage: "person.crop.circle")
                            Spacer()
                            if busy { ProgressView() }
                        }
                    }
                    .disabled(busy)
                }
            } header: {
                Text("YouTube account")
            } footer: {
                Text("Signing in unlocks your subscriptions, playlists, liked videos and watch later. Sending a video works without it.")
            }

            if store.signedIn {
                Section {
                    Button {
                        busy = true
                        Task {
                            note = await store.sendSignInToGlasses()
                            busy = false
                        }
                    } label: {
                        HStack {
                            Label("Send sign-in to glasses", systemImage: "eyeglasses")
                            Spacer()
                            if busy { ProgressView() }
                        }
                    }
                    .disabled(!store.canSend || busy)
                } footer: {
                    Text("Lets the glasses open your library on their own. This hands your Google session to the paired glasses, so only do it on glasses you own. Signing out here clears it on both.")
                }

                Section {
                    Button("Sign out", role: .destructive) {
                        store.signOut()
                        note = "Signed out here and on the glasses."
                    }
                }
            }

            if !note.isEmpty {
                Section { Text(note).font(.footnote) }
            }
        }
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.refreshAccount() }
    }

    private func signIn() {
        busy = true
        note = ""
        Task {
            switch await GoogleAuth.shared.start() {
            case .success(let blob):
                store.session = blob
                await store.refreshAccount()
                note = store.account == nil ? "Google did not return an account." : ""
            case .failure(let error):
                let text = error.localizedDescription
                note = text.isEmpty ? "" : text   // an empty message means the user just cancelled
            }
            busy = false
        }
    }
}
