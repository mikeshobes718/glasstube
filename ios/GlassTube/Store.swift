import Foundation
import Security
import SwiftUI

/// Small Keychain wrapper. The Google session is a refresh token, so it does
/// not belong in UserDefaults next to the recents list.
enum Keychain {
    private static let account = "glasstube.google.session"

    static func read() -> String {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.mikeshobes.glasstube",
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    static func write(_ value: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.mikeshobes.glasstube",
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty, let data = value.data(using: .utf8) else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}

@MainActor
final class Store: ObservableObject {
    // pairing
    @Published private(set) var code = ""
    @Published private(set) var link = ""
    @Published var paired = false
    @Published var pairBusy = false
    @Published var pairNote = ""

    // account
    @Published var session = "" { didSet { Keychain.write(session) } }
    @Published var account: Account?

    // local catalogue
    @Published var recents: [Video] = [] { didSet { save(recents, "recents") } }
    @Published var saved: [Video] = [] { didSet { save(saved, "saved") } }
    @Published var lists: [NamedList] = [] { didSet { save(lists, "lists") } }
    @Published var channels: [ChannelRef] = [] { didSet { save(channels, "channels") } }

    // last send
    @Published var sending = false
    @Published var outcome: SendOutcome?

    private let defaults = UserDefaults.standard
    private var reconnectTask: Task<Void, Never>?

    var signedIn: Bool { !session.isEmpty }
    var key: String { link.isEmpty ? code : link }
    var canSend: Bool { !key.isEmpty && paired }

    init() {
        code = defaults.string(forKey: "glasstube.code") ?? ""
        link = defaults.string(forKey: "glasstube.link") ?? ""
        session = Keychain.read()
        recents = load("recents")
        saved = load("saved")
        lists = load("lists")
        channels = load("channels")
        if channels.isEmpty { channels = Store.starterChannels }
        API.onSessionRotated = { [weak self] fresh in
            guard let self, fresh != self.session else { return }
            self.session = fresh
        }
        // A stored link means this phone already paired. Show it as connected
        // and let reconnect() quietly correct us if the glasses moved on.
        paired = !link.isEmpty
    }

    static let starterChannels: [ChannelRef] = [
        ChannelRef(id: "UCAuUUnT6oDeKwE6v1NGQxug", name: "TED"),
        ChannelRef(id: "UCHnyfMqiRRG1u-2MsSQLbXA", name: "Veritasium"),
        ChannelRef(id: "UCsXVk37bltHxD1rDPwtNM8Q", name: "Kurzgesagt"),
        ChannelRef(id: "UCBJycsmduvYEL83R_U4JriQ", name: "MKBHD"),
    ]

    // MARK: persistence

    private func save<T: Codable>(_ value: T, _ name: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        defaults.set(data, forKey: "glasstube." + name)
    }

    private func load<T: Codable>(_ name: String) -> [T] {
        guard let data = defaults.data(forKey: "glasstube." + name),
              let list = try? JSONDecoder().decode([T].self, from: data) else { return [] }
        return list
    }

    // MARK: pairing

    func mintNote(_ text: String) { pairNote = text }

    func connect(_ typed: String) async {
        let want = typed.uppercased().filter { $0.isLetter || $0.isNumber }
        guard want.count == 6 else {
            pairNote = "Codes are six characters."
            return
        }
        pairBusy = true
        defer { pairBusy = false }
        do {
            let pair = try await API.touch(want)
            apply(pair)
            pairNote = "Connected. This phone stays linked from now on."
            await pushChannelsQuietly()
        } catch {
            pairNote = error.localizedDescription
        }
    }

    /// Called on launch and every time the app comes forward. A failure with a
    /// link in hand is almost always the network, so it retries quietly rather
    /// than dumping the user back on the keypad.
    func reconnect() {
        guard !key.isEmpty else { return }
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self else { return }
            for attempt in 0..<5 {
                if Task.isCancelled { return }
                do {
                    let pair = try await API.touch(self.key)
                    await MainActor.run { self.apply(pair) }
                    return
                } catch let e as GlassTubeError {
                    if case .server(let m) = e,
                       m.localizedCaseInsensitiveContains("expired") ||
                       m.localizedCaseInsensitiveContains("not active") {
                        await MainActor.run { self.unpair(note: "The glasses were re-paired. Type the new code once.") }
                        return
                    }
                } catch { /* keep trying */ }
                try? await Task.sleep(nanoseconds: UInt64(2_000_000_000 << attempt))
            }
        }
    }

    private func apply(_ pair: API.Pair) {
        if !pair.code.isEmpty {
            code = pair.code
            defaults.set(code, forKey: "glasstube.code")
        }
        if !pair.token.isEmpty {
            link = pair.token
            defaults.set(link, forKey: "glasstube.link")
        }
        paired = true
    }

    func unpair(note: String = "") {
        reconnectTask?.cancel()
        code = ""
        link = ""
        paired = false
        pairNote = note
        defaults.removeObject(forKey: "glasstube.code")
        defaults.removeObject(forKey: "glasstube.link")
    }

    // MARK: account

    func refreshAccount() async {
        guard signedIn else {
            account = nil
            return
        }
        account = try? await API.me(session)
        if account == nil { session = "" }
    }

    func signOut() {
        let k = key
        let hadLink = !k.isEmpty
        session = ""
        account = nil
        if hadLink {
            Task { try? await API.pushSession(k, session: "") }
        }
    }

    func sendSignInToGlasses() async -> String {
        guard signedIn else { return "Sign in with Google first." }
        guard canSend else { return "Pair with the glasses first." }
        do {
            try await API.pushSession(key, session: session)
            return "Glasses signed in. Search and Library work on them now."
        } catch {
            return error.localizedDescription
        }
    }

    private func pushChannelsQuietly() async {
        guard canSend else { return }
        try? await API.pushChannels(key, channels)
    }

    func syncChannels() {
        Task { await pushChannelsQuietly() }
    }

    // MARK: sending

    func remember(_ videos: [Video]) {
        var next = recents
        for v in videos.reversed() {
            next.removeAll { $0.id == v.id }
            next.insert(v, at: 0)
        }
        recents = Array(next.prefix(30))
    }

    /// The one path that matters. `StreamResolver` resolves the file on this
    /// phone's own IP - the glasses cannot, and neither can the server - then
    /// the push carries it over.
    func send(_ videos: [Video], name: String = "") async {
        guard canSend else {
            outcome = .failure("Pair with the glasses first.")
            return
        }
        guard !videos.isEmpty else { return }
        sending = true
        outcome = nil
        defer { sending = false }

        var payload: [String: Any] = [
            "code": key,
            "videos": videos.map(\.payload),
        ]
        if !name.isEmpty { payload["name"] = name }
        let blob = session

        let result = await withCheckedContinuation { (cont: CheckedContinuation<[String: Any], Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                var body = payload
                StreamResolver.attachStreams(&body, session: blob.isEmpty ? nil : blob)
                cont.resume(returning: StreamResolver.postPush(body))
            }
        }

        let ok = result["ok"] as? Bool ?? false
        let hasFile = result["hasFile"] as? Bool ?? false
        var note: String
        if !ok {
            note = String(result["error"] as? String ?? "Send failed.")
        } else if hasFile {
            note = videos.count > 1
                ? "Sent \(videos.count) videos. Playing on your glasses."
                : "Playing on your glasses."
        } else {
            note = String(result["fileError"] as? String ??
                "Sent, but no video file. The glasses will try their own routes.")
        }
        outcome = SendOutcome(ok: ok,
                              message: note,
                              hasFile: hasFile,
                              itag: String(result["itag"] as? String ?? ""),
                              detail: String(result["debug"] as? String ?? ""))
        if ok { remember(videos) }
    }

    func send(link raw: String) async {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sending = true
        let found = try? await API.lookup(text)
        sending = false
        guard let found else {
            outcome = .failure("That does not look like a YouTube link.")
            return
        }
        await send([found])
    }

    // MARK: lists

    func toggleSaved(_ v: Video) {
        if let i = saved.firstIndex(where: { $0.id == v.id }) { saved.remove(at: i) }
        else { saved.insert(v, at: 0) }
    }

    func isSaved(_ v: Video) -> Bool { saved.contains { $0.id == v.id } }

    func addToList(_ v: Video, listID: String) {
        guard let i = lists.firstIndex(where: { $0.id == listID }) else { return }
        guard !lists[i].videos.contains(where: { $0.id == v.id }) else { return }
        lists[i].videos.append(v)
    }

    func newList(_ name: String) {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        lists.insert(NamedList(name: clean), at: 0)
    }

    /// Clears what this phone has collected, and nothing else. Pairing and the
    /// Google session are deliberately untouched - losing those means retyping
    /// a code and signing in again, which is not what "reset local data" means
    /// to anyone reading the button.
    func resetLocal() {
        recents = []
        saved = []
        lists = []
        channels = Store.starterChannels
    }

    func addChannel(_ ch: ChannelRef) {
        guard !channels.contains(where: { $0.id == ch.id }) else { return }
        channels.append(ch)
        syncChannels()
    }
}
