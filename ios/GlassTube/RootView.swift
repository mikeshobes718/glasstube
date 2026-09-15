import SwiftUI

struct RootView: View {
    @StateObject private var store = Store()
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = Tab.initial
    @State private var unlockId: String?
    @State private var pendingLink: String?

    enum Tab: Hashable {
        case send, search, library, glasses

        /// Debug builds can launch straight onto a tab, so screenshots and
        /// manual checks do not depend on tapping through the UI first.
        static var initial: Tab {
            #if DEBUG
            switch ProcessInfo.processInfo.environment["GT_TAB"] {
            case "search": return .search
            case "library": return .library
            case "glasses": return .glasses
            default: return .send
            }
            #else
            return .send
            #endif
        }
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
        }
        .tint(.gtAccent)
        .environmentObject(store)
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
