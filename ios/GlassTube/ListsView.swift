import SwiftUI

/// Playlists the user builds on the phone, as opposed to the ones YouTube
/// already knows about.
struct ListsView: View {
    @EnvironmentObject private var store: Store
    @State private var newName = ""
    @State private var adding = false

    var body: some View {
        List {
            if store.lists.isEmpty && !adding {
                EmptyHint(symbol: "music.note.list",
                          title: "No playlists yet",
                          detail: "Build a list here, then send the whole thing to your glasses.")
            }
            if adding {
                Section {
                    TextField("Playlist name", text: $newName)
                        .onSubmit(commit)
                    HStack {
                        Button("Cancel") { adding = false; newName = "" }
                        Spacer()
                        Button("Create", action: commit)
                            .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            ForEach(store.lists) { list in
                NavigationLink {
                    ListDetailView(listID: list.id)
                } label: {
                    Label(list.name, systemImage: "music.note.list")
                        .badge(list.videos.count)
                }
            }
            .onDelete { store.lists.remove(atOffsets: $0) }
            .onMove { from, to in store.lists.move(fromOffsets: from, toOffset: to) }
        }
        .navigationTitle("Playlists")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    adding = true
                } label: { Image(systemName: "plus") }
            }
            ToolbarItem(placement: .topBarLeading) {
                if !store.lists.isEmpty { EditButton() }
            }
        }
    }

    private func commit() {
        store.newList(newName)
        newName = ""
        adding = false
    }
}

struct ListDetailView: View {
    @EnvironmentObject private var store: Store
    let listID: String

    private var list: NamedList? { store.lists.first { $0.id == listID } }

    var body: some View {
        List {
            if let list {
                if list.videos.isEmpty {
                    EmptyHint(symbol: "plus.circle",
                              title: "Empty playlist",
                              detail: "Long-press any video and choose Add to playlist.")
                } else {
                    Section {
                        Button {
                            Task { await store.send(list.videos, name: list.name) }
                        } label: {
                            Label("Send all \(list.videos.count) to glasses", systemImage: "list.and.film")
                        }
                    }
                    Section {
                        ForEach(list.videos) { v in
                            VideoRow(video: v) { Task { await store.send([v]) } }
                        }
                        .onDelete { idx in
                            guard let i = store.lists.firstIndex(where: { $0.id == listID }) else { return }
                            store.lists[i].videos.remove(atOffsets: idx)
                        }
                        .onMove { from, to in
                            guard let i = store.lists.firstIndex(where: { $0.id == listID }) else { return }
                            store.lists[i].videos.move(fromOffsets: from, toOffset: to)
                        }
                    } footer: {
                        Text("Drag to reorder. The glasses play them in this order.")
                    }
                }
            }
        }
        .navigationTitle(list?.name ?? "Playlist")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if !(list?.videos.isEmpty ?? true) { EditButton() } }
        .overlay { if store.sending { SendingOverlay() } }
        .animation(.default, value: store.sending)
    }
}

/// Channels kept on the glasses. These sync across on pair and on edit, so the
/// Channels screen on the HUD matches what is here.
struct ChannelsView: View {
    @EnvironmentObject private var store: Store
    @State private var pasted = ""
    @State private var busy = false
    @State private var note = ""

    var body: some View {
        List {
            Section {
                HStack {
                    TextField("youtube.com/@name or channel link", text: $pasted)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit(add)
                    if busy { ProgressView() }
                }
                Button("Add channel", action: add)
                    .disabled(pasted.trimmingCharacters(in: .whitespaces).isEmpty || busy)
            } header: {
                Text("Add")
            } footer: {
                Text(note.isEmpty
                     ? "These appear under Channels on the glasses."
                     : note)
            }

            Section("On your glasses") {
                ForEach(store.channels) { ch in
                    NavigationLink {
                        ChannelFeedView(channel: ch)
                    } label: {
                        ChannelLabel(channel: ch)
                    }
                }
                .onDelete { idx in
                    store.channels.remove(atOffsets: idx)
                    store.syncChannels()
                }
                .onMove { from, to in
                    store.channels.move(fromOffsets: from, toOffset: to)
                    store.syncChannels()
                }
            }
        }
        .navigationTitle("Channels")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { EditButton() }
    }

    private func add() {
        let raw = pasted.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return }
        busy = true
        note = ""
        Task {
            do {
                let feed = try await API.channelFeed(raw, limit: 1)
                store.addChannel(ChannelRef(id: feed.id, name: feed.name))
                note = "Added \(feed.name)."
                pasted = ""
            } catch {
                note = error.localizedDescription
            }
            busy = false
        }
    }
}
