import SwiftUI

/// 16:9 thumbnail with the duration burned into the corner, the way every
/// video app on this phone draws one.
struct Thumb: View {
    let video: Video
    var width: CGFloat = 132

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            AsyncImage(url: URL(string: video.thumb)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                default:
                    Rectangle().fill(Color(.tertiarySystemFill))
                        .overlay(Image(systemName: "play.rectangle")
                            .foregroundStyle(.tertiary))
                }
            }
            .frame(width: width, height: width * 9 / 16)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            if !video.duration.isEmpty {
                Text(video.duration)
                    .font(.caption2.weight(.bold))
                    .monospacedDigit()
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(.black.opacity(0.82), in: RoundedRectangle(cornerRadius: 6))
                    .foregroundStyle(.white)
                    .padding(5)
            }
        }
        .frame(width: width, height: width * 9 / 16)
    }
}

/// One video in a list. Tapping sends it; everything else lives behind swipe
/// actions and a context menu, so the row itself stays a single clear verb.
struct VideoRow: View {
    @EnvironmentObject private var store: Store
    let video: Video
    var onSend: () -> Void

    var body: some View {
        Button(action: onSend) {
            HStack(spacing: 12) {
                Thumb(video: video)
                VStack(alignment: .leading, spacing: 3) {
                    Text(video.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if !video.subtitle.isEmpty {
                        Text(video.subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button {
                store.toggleSaved(video)
                Haptics.tap()
            } label: {
                Label(store.isSaved(video) ? "Unsave" : "Save",
                      systemImage: store.isSaved(video) ? "bookmark.slash" : "bookmark")
            }
            .tint(.indigo)
        }
        .contextMenu {
            Button { onSend() } label: { Label("Send to glasses", systemImage: "eyeglasses") }
            Button { store.toggleSaved(video) } label: {
                Label(store.isSaved(video) ? "Remove from saved" : "Save", systemImage: "bookmark")
            }
            if !store.lists.isEmpty {
                Menu {
                    ForEach(store.lists) { list in
                        Button(list.name) { store.addToList(video, listID: list.id) }
                    }
                } label: { Label("Add to playlist", systemImage: "text.badge.plus") }
            }
            ShareLink(item: URL(string: video.watchURL)!) {
                Label("Share link", systemImage: "square.and.arrow.up")
            }
        }
    }
}

/// The banner that says what happened to the last send. It is the only place
/// the app admits the phone failed to get a file, so it does not hide.
struct OutcomeBanner: View {
    let outcome: SendOutcome

    private var tone: Color {
        if !outcome.ok { return .red }
        return outcome.hasFile ? .green : .orange
    }

    private var symbol: String {
        if !outcome.ok { return "exclamationmark.triangle.fill" }
        return outcome.hasFile ? "checkmark.circle.fill" : "exclamationmark.circle.fill"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(tone)
                .font(.headline)
            Text(outcome.message)
                .font(.footnote)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .gtGlass(RoundedRectangle(cornerRadius: 14, style: .continuous), tint: tone.opacity(0.28))
    }
}

struct EmptyHint: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.largeTitle)
                .foregroundStyle(.tertiary)
            Text(title).font(.headline)
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
    }
}

/// A send that shows it is working. Sends can take several seconds because the
/// phone is resolving a real file, and a dead button reads as a broken app.
struct SendingOverlay: View {
    var body: some View {
        ZStack {
            Color.black.opacity(0.25).ignoresSafeArea()
            VStack(spacing: 12) {
                ProgressView().controlSize(.large)
                Text("Getting the video…")
                    .font(.subheadline.weight(.medium))
                Text("Your phone fetches the file, then hands it to the glasses.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(24)
            .frame(maxWidth: 280)
            .gtGlass(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .transition(.opacity)
    }
}
