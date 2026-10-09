import UIKit
import UniformTypeIdentifiers

/// "GlassTube" in the share sheet. It does no sending itself: resolving the
/// file needs the app's signed-in web view, its unlock screen and the LAN
/// relay, none of which can live in an extension. So it only finds the link
/// and hands it to the app as `glasstube://send?url=`, which the app already
/// sends straight to the glasses.
final class ShareViewController: UIViewController {
    private var handled = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !handled else { return }
        handled = true
        Task { await handOff() }
    }

    private func handOff() async {
        guard let link = await sharedLink(),
              let target = URL(string: "glasstube://send?url=" + Self.encode(link)) else {
            finish(message: "GlassTube could not find a video link in that.")
            return
        }
        if openApp(target) {
            extensionContext?.completeRequest(returningItems: nil)
        } else {
            // Opening the app is not a public API for extensions, so if a
            // future iOS closes the door, leave the link somewhere useful.
            UIPasteboard.general.string = link
            finish(message: "Link copied. Open GlassTube and tap Paste.")
        }
    }

    /// The YouTube app shares a URL, some apps share text with the URL inside
    /// it, and a few share both. A YouTube link wins over anything else.
    private func sharedLink() async -> String? {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        var found: [String] = []
        for p in providers {
            if p.hasItemConformingToTypeIdentifier(UTType.url.identifier),
               let url = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                found.append(url.absoluteString)
            }
            if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
               let text = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                found.append(contentsOf: Self.links(in: text))
            }
        }
        return found.first(where: Self.isYouTube) ?? found.first
    }

    private static func links(in text: String) -> [String] {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return detector.matches(in: text, range: range).compactMap { $0.url?.absoluteString }
    }

    private static func isYouTube(_ s: String) -> Bool {
        s.contains("youtube.com") || s.contains("youtu.be")
    }

    /// Strict, because a watch link carries its own `&` and `=`.
    private static func encode(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    /// Walks the responder chain to the host's UIApplication, the only way an
    /// extension can open its own app from the share sheet.
    private func openApp(_ url: URL) -> Bool {
        let selector = NSSelectorFromString("openURL:options:completionHandler:")
        var responder: UIResponder? = self
        while let r = responder {
            if r is UIApplication, r.responds(to: selector) {
                typealias Open = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
                let open = unsafeBitCast(r.method(for: selector), to: Open.self)
                open(r, selector, url as NSURL, NSDictionary(), nil)
                return true
            }
            responder = r.next
        }
        return false
    }

    private func finish(message: String) {
        let alert = UIAlertController(title: "GlassTube", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
            self?.extensionContext?.completeRequest(returningItems: nil)
        })
        present(alert, animated: true)
    }
}
