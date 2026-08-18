import SwiftUI

enum GlassPage: String, CaseIterable, Identifiable {
    case phone
    case hud

    var id: String { rawValue }

    var title: String {
        switch self {
        case .phone: return "Phone"
        case .hud: return "Glasses"
        }
    }

    var hint: String {
        switch self {
        case .phone: return "Pair once, then paste a YouTube link"
        case .hud: return "Same screen the glasses show. For testing, not watching while you walk."
        }
    }
}

struct RootView: View {
    @State private var page: GlassPage = .phone
    @State private var pendingWatch: String?
    @State private var reloadToken: [GlassPage: Int] = [.phone: 0, .hud: 0]
    @State private var ready: [GlassPage: Bool] = [.phone: false, .hud: false]

    private var phoneURL: URL {
        var parts = URLComponents(string: "https://glasstube.vercel.app/phone")!
        if let raw = pendingWatch, !raw.isEmpty {
            parts.queryItems = [URLQueryItem(name: "url", value: raw)]
        }
        return parts.url!
    }

    private var hudURL: URL {
        URL(string: "https://glasstube.vercel.app/")!
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image("LaunchIcon")
                    .resizable()
                    .frame(width: 28, height: 28)
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                Text("GlassTube")
                    .font(.headline)
                    .foregroundStyle(Color(red: 0, green: 0.83, blue: 1))
                Picker("Page", selection: $page) {
                    ForEach(GlassPage.allCases) { item in
                        Text(item.title).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                Button {
                    ready[page] = false
                    reloadToken[page, default: 0] += 1
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.body.weight(.semibold))
                }
                .accessibilityLabel("Reload")
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 4)
            .background(Color.black)

            Text(page.hint)
                .font(.footnote)
                .foregroundStyle(Color(white: 0.72))
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.black)

            ZStack {
                WebScreen(url: phoneURL, reloadToken: reloadToken[.phone, default: 0]) {
                    ready[.phone] = true
                }
                .opacity(page == .phone ? 1 : 0)
                .allowsHitTesting(page == .phone)
                WebScreen(url: hudURL, reloadToken: reloadToken[.hud, default: 0]) {
                    ready[.hud] = true
                }
                .opacity(page == .hud ? 1 : 0)
                .allowsHitTesting(page == .hud)

                if ready[page] != true {
                    BrandSplash()
                }
            }
        }
        .background(Color.black.ignoresSafeArea())
        .onOpenURL { incoming in
            if let watch = watchURL(from: incoming) {
                pendingWatch = watch
                page = .phone
                ready[.phone] = false
                reloadToken[.phone, default: 0] += 1
            }
        }
    }
}

struct BrandSplash: View {
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 16) {
                Image("LaunchIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 128, height: 128)
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                Text("GlassTube")
                    .font(.title.weight(.bold))
                    .foregroundStyle(Color(red: 0, green: 0.83, blue: 1))
            }
        }
    }
}

func watchURL(from url: URL) -> String? {
    let s = url.absoluteString
    if url.scheme == "glasstube" {
        if let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems {
            if let found = items.first(where: { $0.name == "url" || $0.name == "v" })?.value, !found.isEmpty {
                return found
            }
        }
        return nil
    }
    if s.contains("youtube.com") || s.contains("youtu.be") {
        return s
    }
    return nil
}
