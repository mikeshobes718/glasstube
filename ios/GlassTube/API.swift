import Foundation

/// Typed client for the GlassTube server. Everything the phone needs goes
/// through here except the actual send, which has to run through
/// `StreamResolver` so the file is resolved on this device's home IP.
enum API {
    static let origin = "https://glasstube.vercel.app"

    private static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.waitsForConnectivity = true
        c.timeoutIntervalForRequest = 20
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    private static func url(_ path: String, _ query: [String: String] = [:]) -> URL {
        var parts = URLComponents(string: origin + path)!
        if !query.isEmpty {
            parts.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return parts.url!
    }

    /// The server hands back a refreshed Google session in a header when the
    /// old one is close to expiring. Ignore it and the phone quietly falls out
    /// of the library a week later, so it is captured here for everyone.
    static var onSessionRotated: ((String) -> Void)?

    private static func run(_ req: URLRequest) async throws -> [String: Any] {
        do {
            let (data, response) = try await session.data(for: req)
            if let http = response as? HTTPURLResponse,
               let fresh = http.value(forHTTPHeaderField: "X-GlassTube-Session"),
               !fresh.isEmpty {
                let handler = onSessionRotated
                await MainActor.run { handler?(fresh) }
            }
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw GlassTubeError.server("The server sent something unreadable.")
            }
            return json
        } catch let e as URLError {
            throw e.code == .notConnectedToInternet || e.code == .networkConnectionLost
                ? GlassTubeError.offline
                : GlassTubeError.server(e.localizedDescription)
        }
    }

    private static func get(_ path: String, _ query: [String: String] = [:], bearer: String? = nil) async throws -> [String: Any] {
        var req = URLRequest(url: url(path, query))
        if let bearer, !bearer.isEmpty {
            req.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
        }
        return try await run(req)
    }

    private static func post(_ path: String, _ body: [String: Any]) async throws -> [String: Any] {
        var req = URLRequest(url: url(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return try await run(req)
    }

    private static func fail(_ json: [String: Any]) -> String {
        String(json["error"] as? String ?? "Something went wrong.")
    }

    // MARK: pairing

    struct Pair {
        var code: String
        var token: String
        var paired: Bool
    }

    static func newPair() async throws -> Pair {
        let j = try await post("/api/pair", [:])
        guard j["ok"] as? Bool == true, let code = j["code"] as? String else {
            throw GlassTubeError.server(fail(j))
        }
        return Pair(code: code, token: j["token"] as? String ?? "", paired: false)
    }

    /// Doubles as "claim this code" and "we are still here". The server hands
    /// back the durable link token, which is what keeps this phone paired
    /// after the six character code has expired.
    static func touch(_ key: String) async throws -> Pair {
        let j = try await post("/api/pair", ["code": key, "touch": true])
        guard j["ok"] as? Bool == true else { throw GlassTubeError.server(fail(j)) }
        return Pair(code: j["code"] as? String ?? key,
                    token: j["token"] as? String ?? "",
                    paired: true)
    }

    static func pushSession(_ key: String, session blob: String) async throws {
        let j = try await post("/api/push", ["code": key, "kind": "session", "session": blob])
        guard j["ok"] as? Bool == true else { throw GlassTubeError.server(fail(j)) }
    }

    static func pushChannels(_ key: String, _ channels: [ChannelRef]) async throws {
        _ = try await post("/api/push", [
            "code": key,
            "channels": channels.map { ["id": $0.id, "name": $0.name] },
        ])
    }

    // MARK: catalogue

    private static func videos(from any: Any?) -> [Video] {
        guard let rows = any as? [[String: Any]] else { return [] }
        return rows.compactMap { row in
            guard let id = row["id"] as? String, !id.isEmpty else { return nil }
            return Video(
                id: id,
                title: row["title"] as? String ?? "YouTube video",
                channel: row["channel"] as? String ?? "",
                thumb: row["thumb"] as? String ?? "",
                duration: row["duration"] as? String ?? "",
                meta: row["meta"] as? String ?? ""
            )
        }
    }

    static func search(_ q: String) async throws -> [Video] {
        let j = try await get("/api/search", ["q": q, "limit": "24"])
        guard j["ok"] as? Bool == true else { throw GlassTubeError.server(fail(j)) }
        return videos(from: j["videos"])
    }

    /// Takes a channel id, a /channel/ link or an @handle; the server resolves
    /// handles and echoes back the real id, which is what gets stored.
    static func channelFeed(_ ref: String, limit: Int = 8) async throws -> (id: String, name: String, videos: [Video]) {
        let j = try await get("/api/feed", ["channel": ref, "limit": String(limit)])
        guard j["ok"] as? Bool == true else { throw GlassTubeError.server(fail(j)) }
        return (j["id"] as? String ?? ref,
                j["name"] as? String ?? "Channel",
                videos(from: j["videos"]))
    }

    /// Resolves whatever the user pasted - link, @handle, channel or playlist -
    /// into something with a title, so the send list never shows a bare id.
    static func lookup(_ raw: String) async throws -> Video? {
        let j = try await get("/api/oembed", ["url": raw])
        guard j["ok"] as? Bool == true, let id = j["id"] as? String else { return nil }
        return Video(id: id,
                     title: j["title"] as? String ?? "YouTube video",
                     channel: j["channel"] as? String ?? "",
                     thumb: j["thumb"] as? String ?? "")
    }

    // MARK: signed-in library

    static func me(_ blob: String) async throws -> Account? {
        let j = try await get("/api/auth/me", [:], bearer: blob)
        guard j["ok"] as? Bool == true, let me = j["me"] as? [String: Any] else { return nil }
        return Account(name: me["name"] as? String ?? "",
                       email: me["email"] as? String ?? "",
                       picture: me["picture"] as? String ?? "")
    }

    static func library(_ blob: String) async throws -> LibrarySnapshot {
        let j = try await get("/api/yt/library", [:], bearer: blob)
        guard j["ok"] as? Bool == true else { throw GlassTubeError.server(fail(j)) }
        var snap = LibrarySnapshot()
        if let me = j["me"] as? [String: Any] {
            snap.me = Account(name: me["name"] as? String ?? "",
                              email: me["email"] as? String ?? "",
                              picture: me["picture"] as? String ?? "")
        }
        snap.watchLater = videos(from: j["watchLater"])
        snap.liked = videos(from: j["likes"])
        snap.uploads = videos(from: j["uploads"])
        snap.playlists = ((j["playlists"] as? [[String: Any]]) ?? []).compactMap {
            guard let id = $0["id"] as? String else { return nil }
            return RemotePlaylist(id: id,
                                  name: $0["name"] as? String ?? "Playlist",
                                  count: $0["count"] as? Int ?? 0)
        }
        snap.subscriptions = ((j["subscriptions"] as? [[String: Any]]) ?? []).compactMap {
            guard let id = $0["id"] as? String else { return nil }
            return ChannelRef(id: id,
                              name: $0["name"] as? String ?? "Channel",
                              thumb: $0["thumb"] as? String ?? "")
        }
        return snap
    }

    static func playlist(_ id: String, blob: String) async throws -> [Video] {
        let j = try await get("/api/yt/playlist", ["id": id], bearer: blob)
        guard j["ok"] as? Bool == true else { throw GlassTubeError.server(fail(j)) }
        return videos(from: j["videos"])
    }

    /// The signed-in search. Better metadata than the scrape, but it needs a
    /// Google session, so the public one stays the default.
    static func searchSignedIn(_ q: String, blob: String) async throws -> [Video] {
        let j = try await get("/api/yt/search", ["q": q], bearer: blob)
        guard j["ok"] as? Bool == true else { throw GlassTubeError.server(fail(j)) }
        return videos(from: j["videos"])
    }
}
