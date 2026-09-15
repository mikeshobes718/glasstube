import Foundation

/// One YouTube video as the phone and the glasses both understand it.
///
/// `u` and `r` are deliberately absent here: they are resolved per send and
/// never persisted, because Google signs an expiry and an IP into the file URL
/// and a stored one is stale before anyone taps it again.
struct Video: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    var channel: String
    var thumb: String
    var duration: String
    var meta: String

    init(id: String,
         title: String = "YouTube video",
         channel: String = "",
         thumb: String = "",
         duration: String = "",
         meta: String = "") {
        self.id = id
        self.title = title
        self.channel = channel
        self.thumb = thumb.isEmpty ? "https://i.ytimg.com/vi/\(id)/mqdefault.jpg" : thumb
        self.duration = duration
        self.meta = meta
    }

    var watchURL: String { "https://youtu.be/\(id)" }

    var subtitle: String {
        [channel, meta].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var payload: [String: Any] {
        var row: [String: Any] = ["id": id, "title": title, "channel": channel, "thumb": thumb]
        if !duration.isEmpty { row["duration"] = duration }
        if !meta.isEmpty { row["meta"] = meta }
        return row
    }
}

struct ChannelRef: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var thumb: String = ""
}

struct NamedList: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString
    var name: String
    var videos: [Video] = []
}

struct RemotePlaylist: Identifiable, Hashable {
    var id: String
    var name: String
    var count: Int
}

struct Account: Codable, Equatable {
    var name: String
    var email: String
    var picture: String
}

struct LibrarySnapshot {
    var me: Account?
    var watchLater: [Video] = []
    var liked: [Video] = []
    var uploads: [Video] = []
    var playlists: [RemotePlaylist] = []
    var subscriptions: [ChannelRef] = []
}

/// What came back from a send. `hasFile` is the one that matters: without it
/// the glasses have nothing but their own fallback routes to try.
struct SendOutcome {
    var ok: Bool
    var message: String
    var hasFile: Bool
    var itag: String
    var detail: String

    static func failure(_ text: String) -> SendOutcome {
        SendOutcome(ok: false, message: text, hasFile: false, itag: "", detail: "")
    }
}

enum GlassTubeError: LocalizedError {
    case server(String)
    case offline

    var errorDescription: String? {
        switch self {
        case .server(let m): return m
        case .offline: return "No internet."
        }
    }
}
