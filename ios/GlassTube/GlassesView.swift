import SwiftUI

/// The glasses tab. Pairing status and settings are native; the preview itself
/// is a WKWebView because the HUD genuinely is a 600x600 web page - showing
/// anything else here would be a mock-up pretending to be the real thing.
struct GlassesView: View {
    @EnvironmentObject private var store: Store
    @State private var reloadToken = 0
    @State private var showPair = false
    @State private var showPreview = false
    @State private var note = ""

    private var hudURL: URL { URL(string: API.origin + "/")! }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Label(store.paired ? "Paired" : "Not paired",
                              systemImage: store.paired ? "checkmark.seal.fill" : "exclamationmark.circle")
                        .foregroundStyle(store.paired ? .green : .orange)
                        Spacer()
                        if store.paired && !store.code.isEmpty {
                            Text(store.code)
                                .font(.system(.footnote, design: .monospaced).weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                    Button {
                        showPair = true
                    } label: {
                        Label(store.paired ? "Pairing details" : "Pair with glasses",
                              systemImage: "eyeglasses")
                    }
                } header: {
                    Text("Connection")
                } footer: {
                    Text(store.paired
                         ? "You only type a code again if you move the glasses to a different phone."
                         : "Open GlassTube on the glasses and choose From iPhone to see the code.")
                }

                Section {
                    Button {
                        Haptics.tap()
                        Task { note = await store.sendSignInToGlasses() }
                    } label: {
                        Label("Send sign-in to glasses", systemImage: "person.badge.key")
                    }
                    .disabled(!store.canSend || !store.signedIn)
                } header: {
                    Text("Library on the glasses")
                } footer: {
                    Text(note.isEmpty
                         ? "Lets the glasses open your subscriptions and playlists on their own. Only do it on glasses you own."
                         : note)
                }

                Section {
                    Button {
                        showPreview = true
                    } label: {
                        Label("Open HUD preview", systemImage: "rectangle.on.rectangle")
                    }
                } header: {
                    Text("Preview")
                } footer: {
                    Text("The same 600x600 screen the glasses draw. For checking a change, not for watching while you walk.")
                }

            }
            .navigationTitle("Glasses")
            .gtSoftScrollEdges()
            .sheet(isPresented: $showPair) { PairView() }
            .sheet(isPresented: $showPreview) {
                NavigationStack {
                    HudPreview(url: hudURL, reloadToken: reloadToken)
                        .navigationTitle("HUD preview")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Button("Done") { showPreview = false }
                            }
                            ToolbarItem(placement: .topBarTrailing) {
                                Button {
                                    reloadToken += 1
                                } label: { Image(systemName: "arrow.clockwise") }
                            }
                        }
                }
            }
        }
    }
}

/// The web HUD framed as a device, so it reads as a preview of the glasses
/// rather than a browser someone forgot to style.
struct HudPreview: View {
    @Environment(\.gtAccent) private var accent
    let url: URL
    let reloadToken: Int

    var body: some View {
        VStack(spacing: 14) {
            GeometryReader { geo in
                let side = min(geo.size.width - 32, geo.size.height)
                WebScreen(url: url, reloadToken: reloadToken)
                    .frame(width: side, height: side)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .strokeBorder(accent.opacity(0.45), lineWidth: 2)
                    )
                    .shadow(color: accent.opacity(0.22), radius: 18)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Text("Arrow keys and Return drive it here, the same way the Neural Band does on the glasses.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
                .padding(.bottom, 8)
        }
        .background(Color(.systemGroupedBackground))
    }
}

struct DiagnosticsView: View {
    @EnvironmentObject private var store: Store
    @State private var log = ""

    var body: some View {
        List {
            Section("Last send") {
                if let o = store.outcome {
                    LabeledContent("Result", value: o.ok ? "sent" : "failed")
                    LabeledContent("Video file", value: o.hasFile ? "yes" : "no")
                    if !o.itag.isEmpty { LabeledContent("Format", value: "itag " + o.itag) }
                    Text(o.message).font(.footnote).foregroundStyle(.secondary)
                } else {
                    Text("Nothing sent yet this session.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }

            Section("Pairing") {
                LabeledContent("Code", value: store.code.isEmpty ? "none" : store.code)
                LabeledContent("Durable link", value: store.link.isEmpty ? "no" : "yes")
                LabeledContent("Google session", value: store.signedIn ? "yes" : "no")
            }

            Section {
                Text(log.isEmpty ? "Resolver log is empty." : log)
                    .font(.system(.caption2, design: .monospaced))
                    .textSelection(.enabled)
            } header: {
                Text("Resolver log")
            } footer: {
                Text("What happened the last time this phone tried to fetch a video file from YouTube.")
            }

            Section {
                Button {
                    UIPasteboard.general.string = log.isEmpty ? "No log yet." : log
                } label: {
                    Label("Copy log", systemImage: "doc.on.doc")
                }
                Button {
                    log = StreamResolver.debugDump()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
            }
        }
        .navigationTitle("Diagnostics")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { log = StreamResolver.debugDump() }
    }
}
