import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var store: Store
    @State private var snapshot: LibrarySnapshot?
    @State private var busy = false
    @State private var error = ""

    var body: some View {
        NavigationStack {
            List {
                if !store.signedIn {
                    Section {
                        EmptyHint(symbol: "person.crop.circle.badge.questionmark",
                                  title: "Sign in to see your YouTube",
                                  detail: "Subscriptions, playlists, liked videos and watch later.")
                        NavigationLink {
                            AccountView()
                        } label: {
                            Label("Sign in with Google", systemImage: "person.crop.circle")
                        }
                    }
                } else if busy && snapshot == nil {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else if !error.isEmpty {
                    EmptyHint(symbol: "exclamationmark.triangle", title: "Could not load", detail: error)
                } else if let snap = snapshot {
                    if !snap.watchLater.isEmpty {
                        Section {
                            NavigationLink {
                                VideoListView(title: "Watch later", videos: snap.watchLater)
                            } label: {
                                Label("Watch later", systemImage: "clock")
                                    .badge(snap.watchLater.count)
                            }
                            if !snap.liked.isEmpty {
                                NavigationLink {
                                    VideoListView(title: "Liked videos", videos: snap.liked)
                                } label: {
                                    Label("Liked videos", systemImage: "hand.thumbsup")
                                        .badge(snap.liked.count)
                                }
                            }
                        }
                    }

                    if !snap.playlists.isEmpty {
                        Section("Your playlists") {
                            ForEach(snap.playlists) { p in
                                NavigationLink {
                                    RemotePlaylistView(playlist: p)
                                } label: {
                                    Label(p.name, systemImage: "music.note.list")
                                        .badge(p.count)
                                }
                            }
                        }
                    }

                    if !snap.subscriptions.isEmpty {
                        Section("Subscriptions") {
                            ForEach(snap.subscriptions) { ch in
                                NavigationLink {
                                    ChannelFeedView(channel: ch)
                                } label: {
                                    ChannelLabel(channel: ch)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Library")
            .refreshable { await load(force: true) }
            .task { await load(force: false) }
            .overlay { if store.sending { SendingOverlay() } }
            .animation(.default, value: store.sending)
        }
    }

    private func load(force: Bool) async {
        guard store.signedIn else { return }
        if snapshot != nil && !force { return }
        busy = true
        error = ""
        do {
            snapshot = try await API.library(store.session)
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }
}

struct ChannelLabel: View {
    let channel: ChannelRef

    var body: some View {
        HStack(spacing: 10) {
            AsyncImage(url: URL(string: channel.thumb)) { phase in
                if case .success(let img) = phase {
                    img.resizable().aspectRatio(contentMode: .fill)
                } else {
                    Circle().fill(Color(.tertiarySystemFill))
                }
            }
            .frame(width: 30, height: 30)
            .clipShape(Circle())
            Text(channel.name)
        }
    }
}

/// A plain list of videos that can be sent one at a time or all at once. Used
/// for watch later, liked, a remote playlist and a channel feed alike.
struct VideoListView: View {
    @EnvironmentObject private var store: Store
    let title: String
    let videos: [Video]

    var body: some View {
        List {
            if videos.isEmpty {
                EmptyHint(symbol: "film", title: "Empty", detail: "Nothing in here yet.")
            } else {
                Section {
                    Button {
                        Task { await store.send(videos, name: title) }
                    } label: {
                        Label("Send all \(videos.count) to glasses", systemImage: "list.and.film")
                    }
                }
                Section {
                    ForEach(videos) { v in
                        VideoRow(video: v) { Task { await store.send([v]) } }
                    }
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if store.sending { SendingOverlay() } }
        .animation(.default, value: store.sending)
    }
}

struct RemotePlaylistView: View {
    @EnvironmentObject private var store: Store
    let playlist: RemotePlaylist
    @State private var videos: [Video] = []
    @State private var busy = true
    @State private var error = ""

    var body: some View {
        Group {
            if busy {
                ProgressView()
            } else if !error.isEmpty {
                EmptyHint(symbol: "exclamationmark.triangle", title: "Could not load", detail: error)
            } else {
                VideoListView(title: playlist.name, videos: videos)
            }
        }
        .navigationTitle(playlist.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { videos = try await API.playlist(playlist.id, blob: store.session) }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

struct ChannelFeedView: View {
    @EnvironmentObject private var store: Store
    let channel: ChannelRef
    @State private var videos: [Video] = []
    @State private var busy = true
    @State private var error = ""

    var body: some View {
        Group {
            if busy {
                ProgressView()
            } else if !error.isEmpty {
                EmptyHint(symbol: "exclamationmark.triangle", title: "Could not load", detail: error)
            } else {
                VideoListView(title: channel.name, videos: videos)
            }
        }
        .navigationTitle(channel.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button {
                store.addChannel(channel)
            } label: {
                Image(systemName: store.channels.contains(where: { $0.id == channel.id })
                      ? "star.fill" : "star")
            }
            .accessibilityLabel("Keep this channel on the glasses")
        }
        .task {
            do { videos = try await API.channelFeed(channel.id).videos }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}
