import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: Store
    @EnvironmentObject private var theme: Theme
    @Environment(\.colorScheme) private var scheme
    @State private var resetting = false
    @State private var note = ""

    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }

    var body: some View {
        NavigationStack {
            List {
                appearanceSection
                playbackSection
                accountSection
                glassesSection
                diagnosticsSection
                aboutSection
            }
            .navigationTitle("Settings")
            .gtSoftScrollEdges()
            .alert("Reset local data?", isPresented: $resetting) {
                Button("Reset", role: .destructive) {
                    store.resetLocal()
                    Haptics.warning()
                    note = "Recents, saved videos and playlists cleared."
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Clears recents, saved videos, playlists and channels on this phone. Pairing and your Google account are left alone.")
            }
        }
    }

    // MARK: appearance

    private var appearanceSection: some View {
        Section {
            Picker("Appearance", selection: Binding(
                get: { theme.mode },
                set: { theme.mode = $0; Haptics.tap() }
            )) {
                ForEach(Theme.Mode.allCases) { mode in
                    Label(mode.label, systemImage: mode.symbol).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))

            AccentPicker()
        } header: {
            Text("Appearance")
        } footer: {
            Text("System follows your phone. The glasses always draw on black — their display is additive, so black is what turns into the room in front of you.")
        }
    }

    // MARK: playback

    private var playbackSection: some View {
        Section {
            Toggle(isOn: Binding(
                get: { theme.dataSaver },
                set: { theme.dataSaver = $0; Haptics.tap() }
            )) {
                Label("Data saver", systemImage: "antenna.radiowaves.left.and.right.slash")
            }
            Toggle(isOn: Binding(
                get: { theme.confirmLists },
                set: { theme.confirmLists = $0; Haptics.tap() }
            )) {
                Label("Ask before sending a list", systemImage: "questionmark.circle")
            }
            Toggle(isOn: Binding(
                get: { theme.haptics },
                set: { theme.haptics = $0; Haptics.enabled = $0; if $0 { Haptics.tap() } }
            )) {
                Label("Haptics", systemImage: "iphone.radiowaves.left.and.right")
            }
        } header: {
            Text("Playback")
        } footer: {
            Text("Data saver asks YouTube for 360p instead of the best it will give, which is usually 720p. On a 600×600 HUD the difference is hard to see and the saving is not.")
        }
    }

    // MARK: account

    private var accountSection: some View {
        Section {
            NavigationLink { AccountView() } label: {
                HStack(spacing: 12) {
                    if let me = store.account, !me.picture.isEmpty {
                        AsyncImage(url: URL(string: me.picture)) { phase in
                            if case .success(let img) = phase {
                                img.resizable().aspectRatio(contentMode: .fill)
                            } else {
                                Circle().fill(.quaternary)
                            }
                        }
                        .frame(width: 32, height: 32)
                        .clipShape(Circle())
                    } else {
                        Image(systemName: "person.crop.circle")
                            .font(.title2)
                            .foregroundStyle(.secondary)
                            .frame(width: 32)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(store.account?.name ?? "Not signed in")
                            .font(.body)
                        Text(store.account?.email ?? "Sign in for your library")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text("YouTube account")
        }
    }

    // MARK: glasses

    private var glassesSection: some View {
        Section {
            LabeledContent {
                Text(store.paired ? (store.code.isEmpty ? "Paired" : store.code) : "Not paired")
                    .font(store.code.isEmpty ? .body : .system(.body, design: .monospaced))
                    .foregroundStyle(store.paired ? Color.secondary : Color.orange)
            } label: {
                Label("Pairing", systemImage: "eyeglasses")
            }
            LabeledContent {
                Text(store.link.isEmpty ? "code only" : "durable")
                    .foregroundStyle(.secondary)
            } label: {
                Label("Link", systemImage: "link")
            }
            Button {
                store.syncChannels()
                Haptics.success()
                note = "Channels sent to the glasses."
            } label: {
                Label("Re-send channels", systemImage: "arrow.triangle.2.circlepath")
            }
            .disabled(!store.canSend)
        } header: {
            Text("Glasses")
        } footer: {
            Text(note.isEmpty
                 ? "A durable link means this phone stays paired on its own — you only type a code again when moving the glasses to a different phone."
                 : note)
        }
    }

    // MARK: diagnostics

    private var diagnosticsSection: some View {
        Section {
            NavigationLink { DiagnosticsView() } label: {
                Label("Diagnostics", systemImage: "stethoscope")
            }
            NavigationLink { RouteExplainerView() } label: {
                Label("How a video gets there", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
            }
        } header: {
            Text("Under the hood")
        }
    }

    // MARK: about

    private var aboutSection: some View {
        Section {
            LabeledContent("Version", value: appVersion)
            LabeledContent("Server", value: "glasstube.vercel.app")
            Link(destination: URL(string: API.origin)!) {
                Label("Open the HUD in a browser", systemImage: "safari")
            }
            Button(role: .destructive) {
                resetting = true
            } label: {
                Label("Reset local data", systemImage: "trash")
            }
        } header: {
            Text("About")
        } footer: {
            Text("GlassTube plays YouTube on Meta Ray-Ban Display glasses. Your phone fetches the video and hands it over; nothing about what you watch goes anywhere else.")
        }
    }
}

/// Accent swatches. They preview in the scheme you are actually in, because a
/// colour chip that lies about itself is worse than no chip.
struct AccentPicker: View {
    @EnvironmentObject private var theme: Theme
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Accent")
                .font(.subheadline)
            HStack(spacing: 14) {
                ForEach(Theme.Accent.allCases) { accent in
                    let color = accent.color(scheme)
                    let picked = theme.accent == accent
                    Button {
                        theme.accent = accent
                        Haptics.tap()
                    } label: {
                        Circle()
                            .fill(color)
                            .frame(width: 26, height: 26)
                            .overlay {
                                if picked {
                                    Circle().strokeBorder(.background, lineWidth: 2)
                                }
                            }
                            .overlay {
                                Circle()
                                    .strokeBorder(picked ? color : .clear, lineWidth: 2)
                                    .padding(-4)
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(accent.label)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.vertical, 4)
    }
}

/// The honest explanation of the play path, in the app rather than buried in a
/// README. When something fails this is the page that makes the failure make
/// sense instead of looking arbitrary.
struct RouteExplainerView: View {
    private struct Route: Identifiable {
        let id = UUID()
        let name: String
        let symbol: String
        let what: String
        let when: String
    }

    private let routes = [
        Route(name: "Phone file", symbol: "iphone",
              what: "Your phone asks YouTube for the video and hands the glasses the file itself.",
              when: "Works when the glasses and this phone share a WiFi network. Google signs the requesting IP into the link, so sharing a network is what makes it valid."),
        Route(name: "Server", symbol: "server.rack",
              what: "The glasses ask glasstube.vercel.app to fetch the video instead.",
              when: "Only for videos YouTube still serves to datacentre addresses, which is most days not many. It fails fast rather than hanging."),
        Route(name: "YouTube embed", symbol: "play.rectangle",
              what: "The ordinary YouTube player, inside the HUD.",
              when: "Whenever the owner allows embedding and the glasses' browser cooperates."),
        Route(name: "YouTube redirect", symbol: "arrow.uturn.right",
              what: "A redirect that makes YouTube itself the page.",
              when: "Last resort, for embeds that refuse the normal route."),
    ]

    var body: some View {
        List {
            Section {
                Text("The glasses try these in order and remember which one worked, so a setup that plays keeps playing without paying for the failures first.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(routes.enumerated()), id: \.element.id) { index, route in
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label {
                            Text(route.name).font(.headline)
                        } icon: {
                            Image(systemName: route.symbol)
                                .foregroundStyle(.tint)
                        }
                        Text(route.what).font(.subheadline)
                        Text(route.when)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                } header: {
                    Text("Route \(index + 1)")
                }
            }
            Section {
                Text("Your phone also publishes the video on your WiFi as a last resort. That one is plain HTTP, so it cannot play inside the HUD — taking it means leaving the GlassTube screen, which is why it is a button you press rather than something that happens to you.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } header: {
                Text("The escape hatch")
            }
        }
        .navigationTitle("Play routes")
        .navigationBarTitleDisplayMode(.inline)
    }
}
