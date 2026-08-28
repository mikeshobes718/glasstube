import AuthenticationServices
import SwiftUI
import WebKit

struct WebScreen: UIViewRepresentable {
    let url: URL
    let reloadToken: Int
    var authBlob: String = ""
    var onReady: (() -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()
        config.userContentController.add(context.coordinator, name: "glasstube")

        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.scrollView.keyboardDismissMode = .interactive
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        if #available(iOS 16.4, *) {
            view.isInspectable = true
        }
        context.coordinator.webView = view
        context.coordinator.onReady = onReady
        context.coordinator.fitHud = !url.path.contains("phone")
        context.coordinator.loadedURL = url
        view.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.onReady = onReady
        if !authBlob.isEmpty && context.coordinator.lastAuthBlob != authBlob {
            context.coordinator.lastAuthBlob = authBlob
            context.coordinator.injectSession(authBlob)
        }
        if context.coordinator.loadedURL != url {
            context.coordinator.loadedURL = url
            context.coordinator.fitHud = !url.path.contains("phone")
            context.coordinator.failCount = 0
            uiView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
            return
        }
        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            context.coordinator.failCount = 0
            uiView.reload()
        }
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "glasstube")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {
        weak var webView: WKWebView?
        var lastReloadToken = 0
        var lastAuthBlob = ""
        var fitHud = false
        var loadedURL: URL?
        var onReady: (() -> Void)?
        var failCount = 0
        var authSession: ASWebAuthenticationSession?

        private let fitScript = """
        (function () {
          var meta = document.querySelector('meta[name="viewport"]');
          if (meta) {
            meta.setAttribute('content',
              'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
          }
          var stage = document.getElementById('stage') || document.body;
          function fit() {
            var w = document.documentElement.clientWidth || window.innerWidth || 600;
            var h = document.documentElement.clientHeight || window.innerHeight || 600;
            var s = Math.min(w / 600, h / 600);
            stage.style.position = 'absolute';
            stage.style.width = '600px';
            stage.style.height = '600px';
            stage.style.left = ((w - 600 * s) / 2) + 'px';
            stage.style.top = ((h - 600 * s) / 2) + 'px';
            stage.style.transformOrigin = '0 0';
            stage.style.transform = 'scale(' + s + ')';
            stage.style.margin = '0';
          }
          fit();
          window.addEventListener('resize', fit);
          setTimeout(fit, 50);
          setTimeout(fit, 300);
        })();
        """

        private func isAppHost(_ url: URL) -> Bool {
            let host = (url.host ?? "").lowercased()
            return host == "glasstube.vercel.app" || host.hasSuffix(".glasstube.vercel.app")
        }

        private func reloadApp() {
            guard let view = webView, let dest = loadedURL else { return }
            view.load(URLRequest(url: dest, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
        }

        func injectSession(_ blob: String) {
            let escaped = blob
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
            let js = "try{localStorage.setItem('glasstube.phone.google','\(escaped)');}catch(e){}location.replace('/phone');"
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }

        func startGoogleAuth() {
            guard let start = URL(string: "https://glasstube.vercel.app/api/auth/google?n=ios") else { return }
            let session = ASWebAuthenticationSession(url: start, callbackURLScheme: "glasstube") { [weak self] callbackURL, error in
                guard let self else { return }
                if error != nil { return }
                guard let callbackURL else { return }
                let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems
                if let err = items?.first(where: { $0.name == "err" })?.value, !err.isEmpty {
                    let safe = err.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "Google%20login%20failed"
                    DispatchQueue.main.async {
                        if let dest = URL(string: "https://glasstube.vercel.app/phone?autherr=\(safe)") {
                            self.webView?.load(URLRequest(url: dest))
                        }
                    }
                    return
                }
                guard let blob = items?.first(where: { $0.name == "s" })?.value, !blob.isEmpty else { return }
                DispatchQueue.main.async { self.injectSession(blob) }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            authSession = session
            session.start()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "glasstube" else { return }
            let type = (message.body as? [String: Any])?["type"] as? String
            if type == "google-auth" {
                DispatchQueue.main.async { self.startGoogleAuth() }
            }
        }

        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            if let window = webView?.window { return window }
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }

        private func showLoadError() {
            guard let view = webView else { return }
            let html = """
            <html><head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              html,body{margin:0;background:#0b1116;color:#e8f6fb;font:17px/1.45 -apple-system,sans-serif}
              main{padding:28px 22px}
              h1{font-size:22px;color:#00d4ff;margin:0 0 10px}
              p{margin:0 0 18px;color:#b7c9d1}
            </style></head>
            <body><main>
            <h1>No internet</h1>
            <p>GlassTube will keep trying every few seconds. Leave this open, or tap Reload at the top.</p>
            </main></body></html>
            """
            view.loadHTMLString(html, baseURL: loadedURL)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            failCount = 0
            if fitHud {
                webView.evaluateJavaScript(fitScript, completionHandler: nil)
            }
            DispatchQueue.main.async { self.onReady?() }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let dest = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            if dest.scheme == "about" {
                decisionHandler(.allow)
                return
            }
            if dest.path.hasPrefix("/api/auth/google") {
                decisionHandler(.cancel)
                startGoogleAuth()
                return
            }
            if dest.scheme != "http" && dest.scheme != "https" {
                UIApplication.shared.open(dest)
                decisionHandler(.cancel)
                return
            }
            let main = navigationAction.targetFrame?.isMainFrame ?? true
            if main && !isAppHost(dest) {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            return nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            handleFail(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            handleFail(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        private func handleFail(_ error: Error) {
            let code = (error as NSError).code
            if code == NSURLErrorCancelled { return }
            failCount += 1
            DispatchQueue.main.async { self.showLoadError() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                self?.reloadApp()
            }
        }
    }
}
