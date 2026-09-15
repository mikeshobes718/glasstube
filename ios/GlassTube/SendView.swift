import SwiftUI

struct SendView: View {
    @EnvironmentObject private var store: Store
    @State private var pasted = ""
    @State private var showPair = false
    @FocusState private var linkFocused: Bool

    var body: some View {
        NavigationStack {
            List {
                if !store.paired {
                    Section {
                        PairPrompt { showPair = true }
                    }
                }

                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "link")
                            .foregroundStyle(.secondary)
                        TextField("Paste a YouTube link", text: $pasted)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .submitLabel(.send)
                            .focused($linkFocused)
                            .onSubmit(sendPasted)
                        if !pasted.isEmpty {
                            Button {
                                pasted = ""
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.tertiary)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    SendButton(
                        disabled: pasted.trimmingCharacters(in: .whitespaces).isEmpty || !store.canSend,
                        action: sendPasted
                    )
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))

                    PasteboardSuggestion { link in
                        pasted = link
                    }
                } header: {
                    Text("Send a video")
                } footer: {
                    Text("Share a video to GlassTube from YouTube and it lands here too.")
                }

                if let outcome = store.outcome {
                    Section { OutcomeBanner(outcome: outcome) }
                }

                if !store.recents.isEmpty {
                    Section("Recently sent") {
                        ForEach(store.recents.prefix(8)) { v in
                            VideoRow(video: v) { Task { await store.send([v]) } }
                        }
                        .onDelete { idx in store.recents.remove(atOffsets: idx) }
                        if store.recents.count > 1 {
                            Button {
                                Task { await store.send(Array(store.recents.prefix(12)), name: "Recents") }
                            } label: {
                                Label("Play recents as a list", systemImage: "list.and.film")
                            }
                        }
                    }
                }

                Section("Your lists") {
                    NavigationLink {
                        SavedView()
                    } label: {
                        Label("Saved videos", systemImage: "bookmark")
                            .badge(store.saved.count)
                    }
                    NavigationLink {
                        ListsView()
                    } label: {
                        Label("Playlists", systemImage: "music.note.list")
                            .badge(store.lists.count)
                    }
                    NavigationLink {
                        ChannelsView()
                    } label: {
                        Label("Channels", systemImage: "antenna.radiowaves.left.and.right")
                            .badge(store.channels.count)
                    }
                }
            }
            .navigationTitle("GlassTube")
            .gtSoftScrollEdges()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    PairBadge { showPair = true }
                }
            }
            .sheet(isPresented: $showPair) { PairView() }
            .overlay { if store.sending { SendingOverlay() } }
            .animation(.default, value: store.sending)
        }
    }

    private func sendPasted() {
        let text = pasted
        linkFocused = false
        Task {
            await store.send(link: text)
            if store.outcome?.ok == true { pasted = "" }
        }
    }
}

/// Offers whatever YouTube link is already on the clipboard, without reading
/// the clipboard behind the user's back - iOS shows its own consent button.
struct PasteboardSuggestion: View {
    let onPick: (String) -> Void

    var body: some View {
        PasteButton(payloadType: String.self) { items in
            guard let text = items.first else { return }
            if text.contains("youtu.be") || text.contains("youtube.com") {
                Task { @MainActor in onPick(text) }
            }
        }
        .labelStyle(.titleAndIcon)
        .buttonBorderShape(.capsule)
    }
}

struct PairBadge: View {
    @EnvironmentObject private var store: Store
    let tap: () -> Void

    var body: some View {
        Button {
            Haptics.tap()
            tap()
        } label: {
            HStack(spacing: 5) {
                Circle()
                    .fill(store.paired ? Color.green : Color.orange)
                    .frame(width: 7, height: 7)
                Text(store.paired ? "Paired" : "Pair")
                    .font(.caption.weight(.semibold))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .gtGlass(Capsule(), interactive: true)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(store.paired ? "Paired with glasses" : "Not paired")
    }
}

/// The one button the whole app exists for. Glass-prominent where the OS has
/// it, so it picks up the same material as the tab bar above it.
struct SendButton: View {
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Label("Send to glasses", systemImage: "eyeglasses")
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
        }
        .modifier(ProminentGlass())
        .disabled(disabled)
    }
}

private struct ProminentGlass: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.buttonStyle(.glassProminent)
        } else {
            content.buttonStyle(.borderedProminent)
        }
    }
}

struct PairPrompt: View {
    @Environment(\.gtAccent) private var accent
    let tap: () -> Void

    var body: some View {
        Button(action: tap) {
            HStack(spacing: 12) {
                Image(systemName: "eyeglasses")
                    .font(.title2)
                    .foregroundStyle(accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pair with your glasses").font(.subheadline.weight(.semibold))
                    Text("Open GlassTube on the glasses, then type the code once.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
            }
        }
        .buttonStyle(.plain)
    }
}

struct SavedView: View {
    @EnvironmentObject private var store: Store

    var body: some View {
        List {
            if store.saved.isEmpty {
                EmptyHint(symbol: "bookmark",
                          title: "Nothing saved",
                          detail: "Swipe right on any video to keep it here.")
            } else {
                ForEach(store.saved) { v in
                    VideoRow(video: v) { Task { await store.send([v]) } }
                }
                .onDelete { store.saved.remove(atOffsets: $0) }
            }
        }
        .navigationTitle("Saved")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if !store.saved.isEmpty { EditButton() } }
    }
}
