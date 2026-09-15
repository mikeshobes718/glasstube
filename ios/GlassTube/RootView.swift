import SwiftUI

struct RootView: View {
    @StateObject private var store = Store()
    @StateObject private var theme = Theme()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var systemScheme
    @State private var tab = Tab.initial
    @State private var unlockId: String?

    enum Tab: Hashable {
        case send, search, library, glasses, settings

        /// Debug builds can launch straight onto a tab, so screenshots and
        /// manual checks do not depend on tapping through the UI first.
        static var initial: Tab {
            #if DEBUG
            switch ProcessInfo.processInfo.environment["GT_TAB"] {
            case "search": return .search
            case "library": return .library
            case "glasses": return .glasses
            case "settings": return .settings
            default: return .send
            }
            #else
            return .send
            #endif
        }
    }

    /// The scheme the app is actually rendering in, which is what the accent
    /// needs to pick its variant - not the phone's scheme when the user has
    /// overridden it.
    private var activeScheme: ColorScheme {
        theme.mode.scheme ?? systemScheme
    }

    private var accent: Color {
        theme.accent.color(activeScheme)
    }

    var body: some View {
        TabView(selection: $tab) {
            SendView()
                .tabItem { Label("Send", systemImage: "paperplane") }
                .tag(Tab.send)
            SearchView()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(Tab.search)
            LibraryView()
                .tabItem { Label("Library", systemImage: "rectangle.stack") }
                .tag(Tab.library)
            GlassesView()
                .tabItem { Label("Glasses", systemImage: "eyeglasses") }
                .tag(Tab.glasses)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(Tab.settings)
        }
        .gtTabBarMinimize()
        .tint(accent)
        .environment(\.gtAccent, accent)
        .environmentObject(store)
        .environmentObject(theme)
        .preferredColorScheme(theme.mode.scheme)
        // The resolver sometimes has to show YouTube's own sign-in page to get
        // a file. It takes over the screen because tapping through it is the
        // whole point; nothing else is interactive until it is done.
        .fullScreenCover(item: Binding(
            get: { unlockId.map(UnlockRequest.init) },
            set: { if $0 == nil { unlockId = nil } }
        )) { req in
            YouTubeUnlockScreen(videoId: req.id)
        }
        .onReceive(NotificationCenter.default.publisher(for: .gtUnlock)) { note in
            if let id = note.userInfo?["id"] as? String, !id.isEmpty { unlockId = id }
        }
        .onReceive(NotificationCenter.default.publisher(for: .gtUnlockDone)) { _ in
            unlockId = nil
        }
        .task {
            Haptics.enabled = theme.haptics
            StreamResolver.dataSaver = theme.dataSaver
            store.reconnect()
            await store.refreshAccount()
            #if DEBUG
            // Lets the whole resolve-and-push path be exercised from a launch
            // argument, which a deep link cannot do under the simulator's own
            // "Open in..." prompt.
            if let seed = ProcessInfo.processInfo.environment["GT_SEND"], !seed.isEmpty {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                await store.send(link: seed)
            }
            #endif
        }
        .onChange(of: theme.haptics) { _, on in Haptics.enabled = on }
        .onChange(of: theme.dataSaver) { _, on in StreamResolver.dataSaver = on }
        .onChange(of: scenePhase) { _, phase in
            // Coming back from the background is exactly when the pair used to
            // be lost, so re-establish it every time rather than on launch only.
            if phase == .active { store.reconnect() }
        }
        .onOpenURL { incoming in
            if incoming.scheme == "glasstube", incoming.host == "oauth" { return }
            if let raw = watchURL(from: incoming) {
                tab = .send
                Task { await store.send(link: raw) }
            }
        }
    }
}

private struct UnlockRequest: Identifiable {
    let id: String
}

func watchURL(from url: URL) -> String? {
    let s = url.absoluteString
    if url.scheme == "glasstube" {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        if let found = items?.first(where: { $0.name == "url" || $0.name == "v" })?.value,
           !found.isEmpty {
            return found
        }
        return nil
    }
    if s.contains("youtube.com") || s.contains("youtu.be") { return s }
    return nil
}
