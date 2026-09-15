import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var store: Store
    @State private var query = ""
    @State private var results: [Video] = []
    @State private var busy = false
    @State private var error = ""
    @State private var recent: [String] = UserDefaults.standard.stringArray(forKey: "glasstube.queries") ?? []
    @State private var task: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                if busy && results.isEmpty {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else if !error.isEmpty {
                    EmptyHint(symbol: "wifi.exclamationmark", title: "Search failed", detail: error)
                } else if results.isEmpty {
                    if recent.isEmpty {
                        EmptyHint(symbol: "magnifyingglass",
                                  title: "Search YouTube",
                                  detail: "Find something, then send it straight to your glasses.")
                    } else {
                        Section("Recent searches") {
                            ForEach(recent, id: \.self) { q in
                                Button {
                                    query = q
                                    run(q)
                                } label: {
                                    Label(q, systemImage: "clock.arrow.circlepath")
                                        .foregroundStyle(.primary)
                                }
                            }
                            .onDelete { idx in
                                recent.remove(atOffsets: idx)
                                UserDefaults.standard.set(recent, forKey: "glasstube.queries")
                            }
                        }
                    }
                } else {
                    Section {
                        Button {
                            Task { await store.send(results, name: "Search: " + query) }
                        } label: {
                            Label("Send all \(results.count) to glasses", systemImage: "list.and.film")
                        }
                    }
                    Section("Results") {
                        ForEach(results) { v in
                            VideoRow(video: v) { Task { await store.send([v]) } }
                        }
                    }
                }
            }
            .navigationTitle("Search")
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search YouTube")
            .onSubmit(of: .search) { run(query) }
            .onChange(of: query) { _, now in
                if now.trimmingCharacters(in: .whitespaces).isEmpty {
                    task?.cancel()
                    results = []
                    error = ""
                }
            }
            .overlay { if store.sending { SendingOverlay() } }
            .animation(.default, value: store.sending)
            .task {
                #if DEBUG
                if let seed = ProcessInfo.processInfo.environment["GT_QUERY"], !seed.isEmpty {
                    query = seed
                    run(seed)
                }
                #endif
            }
        }
    }

    private func run(_ raw: String) {
        let q = raw.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        task?.cancel()
        busy = true
        error = ""
        task = Task {
            do {
                // The signed-in search has better metadata, but the public one
                // is the guarantee, so fall back rather than fail.
                var hits: [Video] = []
                if store.signedIn {
                    hits = (try? await API.searchSignedIn(q, blob: store.session)) ?? []
                }
                if hits.isEmpty {
                    hits = try await API.search(q)
                }
                if Task.isCancelled { return }
                results = hits
                if hits.isEmpty { error = "Nothing found for that." }
                remember(q)
            } catch {
                if !Task.isCancelled { self.error = error.localizedDescription }
            }
            busy = false
        }
    }

    private func remember(_ q: String) {
        var next = recent.filter { $0.caseInsensitiveCompare(q) != .orderedSame }
        next.insert(q, at: 0)
        recent = Array(next.prefix(10))
        UserDefaults.standard.set(recent, forKey: "glasstube.queries")
    }
}
