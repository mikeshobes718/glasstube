import AuthenticationServices
import SwiftUI
import UIKit
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
        if url.path.contains("phone") {
            config.userContentController.addUserScript(
                WKUserScript(
                    source: Coordinator.streamPushScript,
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: true
                )
            )
        }

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
        if url.path.contains("phone") {
            context.coordinator.bindSessionRotation()
        }
        if !url.path.contains("phone") {
            view.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
        }
        context.coordinator.loadApp(url)
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
            context.coordinator.loadApp(url)
            return
        }
        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            context.coordinator.failCount = 0
            if let dest = context.coordinator.loadedURL {
                context.coordinator.loadApp(dest)
            } else {
                uiView.reload()
            }
        }
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "glasstube")
        YouTubePage.shared.detach(from: uiView)
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

        static let streamPushScript = """
        (function () {
          if (window.__gtAttach) return;
          window.__gtAttach = 1;
          function vid(raw) {
            var s = String(raw || '');
            var m = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || s.match(/youtu\\.be\\/([a-zA-Z0-9_-]{11})/);
            if (m) return m[1];
            if (/^[a-zA-Z0-9_-]{11}$/.test(s) && s.indexOf('http') !== 0) return s;
            return '';
          }
          function need(body) {
            var out = [];
            if (body.videos && body.videos.length) {
              for (var i = 0; i < body.videos.length && i < 8; i++) {
                var row = body.videos[i] || {};
                if (row.u) continue;
                var id = vid(row.id || row.url || '');
                if (id) out.push({ i: i, id: id });
              }
            } else if (body.url) {
              var id = vid(body.url);
              if (id) out.push({ i: -1, id: id });
            }
            return out;
          }
          function ask(id) {
            return new Promise(function (resolve) {
              var done = false;
              function finish(u) {
                if (done) return;
                done = true;
                window.removeEventListener('glasstubeStream', on);
                resolve(u || '');
              }
              function on(e) {
                var d = e && e.detail;
                if (d && d.id && d.id !== id) return;
                finish(d && d.u ? String(d.u) : '');
              }
              window.addEventListener('glasstubeStream', on);
              setTimeout(function () { finish(''); }, 90000);
              try { window.webkit.messageHandlers.glasstube.postMessage({ type: 'stream', id: id, s: String(localStorage.getItem('glasstube.phone.google') || '') }); }
              catch (err) { finish(''); }
            });
          }
          var orig = window.fetch;
          window.fetch = function (input, init) {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            if (window.__gtPushNative) {
              return orig.apply(this, arguments);
            }
            if (!init || !init.body || String(url).indexOf('/api/push') === -1) {
              return orig.apply(this, arguments);
            }
            var body;
            try { body = JSON.parse(init.body); } catch (e) { return orig.apply(this, arguments); }
            var jobs = need(body);
            if (!jobs.length) return orig.apply(this, arguments);
            return jobs.reduce(function (p, item) {
              return p.then(function () {
                return ask(item.id).then(function (u) {
                  if (!u || (u.indexOf('https://') !== 0 && u.indexOf('http://') !== 0)) return;
                  if (item.i >= 0) {
                    body.videos[item.i] = Object.assign({}, body.videos[item.i], { id: item.id, u: u });
                  } else {
                    body.videos = [{ id: item.id, u: u, url: body.url }];
                  }
                });
              });
            }, Promise.resolve()).then(function () {
              return orig.call(window, input, Object.assign({}, init, { body: JSON.stringify(body) }));
            });
          };
        })();
        """

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

        private let appReferer = "https://glasstube.vercel.app/"

        private func isAppHost(_ url: URL) -> Bool {
            let host = (url.host ?? "").lowercased()
            return host == "glasstube.vercel.app" || host.hasSuffix(".glasstube.vercel.app")
        }

        func loadApp(_ url: URL) {
            var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
            req.setValue(appReferer, forHTTPHeaderField: "Referer")
            webView?.load(req)
        }

        private func reloadApp() {
            guard let dest = loadedURL else { return }
            loadApp(dest)
        }

        func injectSession(_ blob: String) {
            let escaped = blob
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
            let js = "try{localStorage.setItem('glasstube.phone.google','\(escaped)');}catch(e){}location.replace('/phone?v=6');"
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
                        if let dest = URL(string: "https://glasstube.vercel.app/phone?v=6&autherr=\(safe)") {
                            self.loadApp(dest)
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

        private static func sessionBlob(_ body: [String: Any]?) -> String? {
            if let s = body?["s"] as? String, !s.isEmpty { return s }
            if let nested = body?["body"] as? [String: Any], let s = nested["s"] as? String, !s.isEmpty {
                return s
            }
            return nil
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "glasstube" else { return }
            let body = message.body as? [String: Any]
            let type = body?["type"] as? String
            if type == "google-auth" {
                DispatchQueue.main.async { self.startGoogleAuth() }
                return
            }
            if type == "copy" {
                let text = String(body?["text"] as? String ?? "")
                DispatchQueue.main.async {
                    UIPasteboard.general.string = text.isEmpty ? "No errors yet." : text
                    self.emitJS("glasstubeCopied", ["ok": true])
                }
                return
            }
            if type == "push" {
                var payload = body?["body"] as? [String: Any] ?? [:]
                let blob = Self.sessionBlob(body)
                DispatchQueue.global(qos: .userInitiated).async {
                    StreamResolver.attachStreams(&payload, session: blob)
                    let result = StreamResolver.postPush(payload)
                    DispatchQueue.main.async { self.emitJS("glasstubePushResult", result) }
                }
                return
            }
            if type == "stream" {
                let id = String(body?["id"] as? String ?? "")
                let blob = Self.sessionBlob(body)
                DispatchQueue.global(qos: .userInitiated).async {
                    let url = StreamResolver.url(for: id, session: blob) ?? ""
                    DispatchQueue.main.async {
                        self.emitJS("glasstubeStream", ["u": url, "id": id])
                    }
                }
            }
        }

        private func emitJS(_ name: String, _ obj: [String: Any]) {
            guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
            let b64 = data.base64EncodedString()
            let js = "window.dispatchEvent(new CustomEvent('\(name)',{detail:JSON.parse(atob('\(b64)'))}))"
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }

        func bindSessionRotation() {
            StreamResolver.onSession = { [weak self] blob in
                DispatchQueue.main.async {
                    self?.emitJS("glasstubeSession", ["s": blob])
                }
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
            let host = (dest.host ?? "").lowercased()
            if host.contains("googlevideo.com") || host.contains("ytimg.com") {
                decisionHandler(.allow)
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

extension Notification.Name {
    static let gtUnlock = Notification.Name("glasstube.needYtUnlock")
    static let gtUnlockDone = Notification.Name("glasstube.ytUnlockDone")
}

struct GoogleHit {
    let status: Int
    let type: String
    let contentRange: String
    let length: String
    let body: Data
    let err: String
}

final class YouTubePage: NSObject, WKNavigationDelegate, WKUIDelegate {
    static let shared = YouTubePage()
    private var web: WKWebView?
    private var pendingId = ""
    private var unlockBox: FinishBox?
    private var silentBox: FinishBox?
    private var huntTimer: Timer?
    private var huntArmed = false
    private var playerTries = 0
    private var watchBounces = 0
    private var userSkipped = false
    private var signInAsked = false
    private(set) var lastReferer = "https://m.youtube.com/"

    var pageReferer: String {
        let href = web?.url?.absoluteString ?? ""
        if href.contains("youtube.com") { return href }
        if lastReferer.contains("youtube.com") { return lastReferer }
        if pendingId.count == 11 {
            return "https://m.youtube.com/watch?v=\(pendingId)"
        }
        return lastReferer
    }

    private static let hookJS = """
    (function(){
      if (window.__gtHook) return;
      window.__gtHook = 1;
      window.__gtFile = '';
      function save(u) {
        u = String(u || '');
        if (u.indexOf('googlevideo.com') === -1) return;
        if (u.indexOf('videoplayback') === -1) return;
        if (u.length < 100) return;
        if (!/[?&]itag=(18|22)(?:&|$)/.test(u)) return;
        window.__gtFile = u;
      }
      var open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(m, u) {
        try { save(u); } catch (e) {}
        return open.apply(this, arguments);
      };
      var origFetch = window.fetch;
      window.__gtFetch = origFetch.bind(window);
      window.fetch = function(u, o) {
        try { save(typeof u === 'string' ? u : (u && u.url)); } catch (e) {}
        return origFetch.apply(this, arguments);
      };
      document.addEventListener('click', function(e) {
        var n = e.target;
        var text = '';
        try {
          while (n && !text) {
            text = String((n.getAttribute && n.getAttribute('aria-label')) || n.textContent || '');
            n = n.parentElement;
          }
        } catch (err) {}
        if (/watch in youtube app/i.test(text)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);
    })();
    """

    private static let fetchJS = """
    try {
      const headers = { Accept: '*/*' };
      if (range) headers.Range = range;
      const fetchFn = window.__gtFetch || fetch;
      const r = await fetchFn(url, {
        method: 'GET',
        headers,
        credentials: withCookies ? 'include' : 'omit',
        mode: 'cors',
        cache: 'no-store'
      });
      const buf = await r.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const max = 262144;
      const slice = bytes.length > max ? bytes.subarray(0, max) : bytes;
      let raw = '';
      const step = 32768;
      for (let i = 0; i < slice.length; i += step) {
        raw += String.fromCharCode.apply(null, slice.subarray(i, Math.min(i + step, slice.length)));
      }
      return {
        status: r.status,
        type: r.headers.get('content-type') || '',
        cr: r.headers.get('content-range') || '',
        cl: r.headers.get('content-length') || '',
        b64: btoa(raw),
        err: bytes.length > max ? 'too big' : ''
      };
    } catch (e) {
      return {
        status: 0,
        type: '',
        cr: '',
        cl: '',
        b64: '',
        err: String(e && e.message ? e.message : e)
      };
    }
    """

    private func huntScript(id: String) -> String {
        let want = id.filter { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
        return """
        (function(){
          var want = '\(want)';
          var details = (window.ytInitialPlayerResponse || {}).videoDetails || {};
          if (details.videoId && details.videoId !== want) return '';
          function ok(u) {
            u = String(u || '');
            if (u.indexOf('blob:') === 0) return '';
            if (u.indexOf('googlevideo.com') === -1) return '';
            if (u.indexOf('videoplayback') === -1) return '';
            if (u.length < 100) return '';
            if (!/[?&]itag=(18|22)(?:&|$)/.test(u)) return '';
            return u;
          }
          try {
            var v = document.querySelector('video');
            if (v) {
              v.muted = true;
              v.playsInline = true;
              v.play().catch(function(){});
            }
          } catch (e) {}
          var dismissed = false;
          var nodes = document.querySelectorAll('button, a, yt-icon-button, [role="button"], [aria-label]');
          for (var d = 0; d < nodes.length; d++) {
            var el = nodes[d];
            var label = String(el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
            var text = String(el.textContent || '').replace(/\\s+/g, ' ').trim();
            if (/watch in youtube app/i.test(text) || /watch in youtube app/i.test(label)) continue;
            if (/^Close$/i.test(label) || /^Close dialog$/i.test(label)) {
              el.click();
              dismissed = true;
              break;
            }
          }
          if (!dismissed) {
            var titles = document.querySelectorAll('h1, h2, yt-formatted-string, span, p');
            for (var t = 0; t < titles.length; t++) {
              if (!/get the best experience/i.test(titles[t].textContent || '')) continue;
              var box = titles[t].closest('[role="dialog"], ytm-modal-with-title-and-button-renderer, ytm-bottom-sheet-renderer, ytm-promoted-sparkles-web-renderer, tp-yt-paper-dialog');
              if (!box) box = titles[t].parentElement;
              var closer = box && box.querySelector('[aria-label="Close"], [aria-label="Close dialog"], button[aria-label*="Close"]');
              if (closer) { closer.click(); } else if (box) { box.remove(); }
              break;
            }
          }
          var btns = document.querySelectorAll('button, yt-button-shape');
          for (var b = 0; b < btns.length; b++) {
            var t = String(btns[b].getAttribute('aria-label') || btns[b].textContent || '').replace(/\\s+/g, ' ').trim();
            if (/^(Accept all|I agree|Accept all cookies)$/i.test(t)) {
              btns[b].click();
              break;
            }
          }
          var vids = document.getElementsByTagName('video');
          var paused = true;
          for (var k = 0; k < vids.length; k++) {
            if (!vids[k].paused) paused = false;
            var s = ok(vids[k].currentSrc || vids[k].src);
            if (s && vids[k].readyState >= 2) return 'video ' + s;
          }
          if (paused) {
            var play = document.querySelector('.ytp-large-play-button, button[aria-label="Play"], button[aria-label="Play video"]');
            if (play) play.click();
          }
          var hooked = ok(window.__gtFile);
          if (hooked) return 'hook ' + hooked;
          var pr = window.ytInitialPlayerResponse || {};
          var sd = pr.streamingData || {};
          var all = [].concat(sd.formats || [], sd.adaptiveFormats || []);
          for (var y = 0; y < all.length; y++) {
            var yt = ok(all[y] && all[y].url);
            if (yt) return 'ytipr ' + yt;
          }
          var hits = performance.getEntriesByType('resource') || [];
          for (var i = 0; i < hits.length; i++) {
            var n = ok(hits[i].name);
            if (n) return 'perf ' + n;
          }
          for (var m = 0; m < vids.length; m++) {
            var src = ok(vids[m].currentSrc || vids[m].src);
            if (src) return 'video ' + src;
          }
          return '';
        })()
        """
    }

    func googleBytes(url: String, range: String?, cookies: Bool, done: @escaping (GoogleHit?) -> Void) {
        guard let web else {
            StreamResolver.log("relay js no web")
            done(nil)
            return
        }
        Task { @MainActor in
            do {
                let raw = try await web.callAsyncJavaScript(
                    Self.fetchJS,
                    arguments: [
                        "url": url,
                        "range": range ?? "",
                        "withCookies": cookies,
                    ],
                    in: nil,
                    contentWorld: .page
                )
                done(Self.parseHit(raw))
            } catch {
                StreamResolver.log("relay js fail \(error.localizedDescription)")
                done(nil)
            }
        }
    }

    static func waitGoogle(url: String, range: String?, cookies: Bool) -> GoogleHit? {
        if Thread.isMainThread {
            StreamResolver.log("relay js skip main thread")
            return nil
        }
        let sem = DispatchSemaphore(value: 0)
        var hit: GoogleHit?
        DispatchQueue.main.async {
            shared.googleBytes(url: url, range: range, cookies: cookies) { result in
                hit = result
                sem.signal()
            }
        }
        _ = sem.wait(timeout: .now() + 30)
        return hit
    }

    private static func parseHit(_ raw: Any?) -> GoogleHit? {
        let row = (raw as? [String: Any]) ?? (raw as? NSDictionary as? [String: Any]) ?? [:]
        let status = intVal(row["status"])
        let type = String(row["type"] as? String ?? "")
        let cr = String(row["cr"] as? String ?? "")
        let cl = String(row["cl"] as? String ?? "")
        let err = String(row["err"] as? String ?? "")
        let b64 = String(row["b64"] as? String ?? "")
        let body = Data(base64Encoded: b64) ?? Data()
        return GoogleHit(status: status, type: type, contentRange: cr, length: cl, body: body, err: err)
    }

    private static func intVal(_ raw: Any?) -> Int {
        if let n = raw as? NSNumber { return n.intValue }
        if let i = raw as? Int { return i }
        if let d = raw as? Double { return Int(d) }
        if let s = raw as? String { return Int(s) ?? 0 }
        return 0
    }

    func silentUnlock(id: String) -> String? {
        guard unlockBox == nil else { return nil }
        StreamResolver.log("silent unlock start id=\(id)")
        let box = FinishBox()
        DispatchQueue.main.async {
            self.ensureHiddenWeb()
            self.huntArmed = false
            self.playerTries = 0
            self.watchBounces = 0
            self.silentBox = box
            self.pendingId = id
            self.loadWatch(id)
            self.startHunt()
        }
        _ = box.wait(seconds: 30)
        if box.value == nil {
            StreamResolver.log("silent unlock timeout id=\(id)")
        }
        DispatchQueue.main.async {
            if self.silentBox != nil {
                self.silentBox = nil
                self.stopHunt()
            }
        }
        return box.value
    }

    func unlockAndWait(id: String) -> String? {
        StreamResolver.log("unlock start id=\(id)")
        let box = FinishBox()
        DispatchQueue.main.async {
            self.huntArmed = false
            self.playerTries = 0
            self.watchBounces = 0
            self.userSkipped = false
            self.signInAsked = false
            self.unlockBox = box
            self.pendingId = id
            NotificationCenter.default.post(name: .gtUnlock, object: nil, userInfo: ["id": id])
        }
        _ = box.wait(seconds: 180)
        if box.value == nil, !StreamResolver.wasSkip() {
            StreamResolver.log("unlock timeout id=\(id)")
        }
        DispatchQueue.main.async {
            self.stopHunt()
            if self.unlockBox != nil {
                self.unlockBox = nil
                NotificationCenter.default.post(name: .gtUnlockDone, object: nil)
            }
        }
        return box.value
    }

    func completeUnlock(_ url: String?) {
        let apply = {
            let box = self.unlockBox ?? self.silentBox
            guard let box else { return }
            let silent = self.unlockBox == nil
            if let url {
                if !StreamResolver.isPlayableFile(url) {
                    StreamResolver.log("unlock skip url itag=\(StreamResolver.itag(url)) len=\(url.count)")
                    return
                }
            }
            if let href = self.web?.url?.absoluteString, href.contains("youtube.com") {
                self.lastReferer = href
            }
            StreamResolver.log("unlock done id=\(self.pendingId) itag=\(StreamResolver.itag(url)) len=\(url?.count ?? 0)")
            box.complete(url)
            self.unlockBox = nil
            self.silentBox = nil
            self.stopHunt()
            if url == nil, !silent {
                NotificationCenter.default.post(name: .gtUnlockDone, object: nil)
            }
        }
        let run = {
            guard self.unlockBox != nil || self.silentBox != nil else { return }
            self.huntArmed = false
            self.stopHunt()
            if url != nil, self.web != nil {
                let flag = FinishBox()
                let finish = {
                    if flag.tryComplete() { apply() }
                }
                self.web?.evaluateJavaScript(
                    "document.querySelectorAll('video').forEach(function(v){try{v.pause()}catch(e){}})"
                ) { _, _ in finish() }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { finish() }
            } else {
                apply()
            }
        }
        if Thread.isMainThread {
            run()
        } else {
            DispatchQueue.main.async(execute: run)
        }
    }

    private func makeWeb() -> WKWebView {
        if let web { return web }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(
            WKUserScript(source: Self.hookJS, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        )
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.allowsBackForwardNavigationGestures = true
        wv.scrollView.keyboardDismissMode = .interactive
        wv.scrollView.bounces = true
        wv.isOpaque = true
        wv.backgroundColor = .white
        wv.scrollView.backgroundColor = .white
        wv.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
        if #available(iOS 16.4, *) {
            wv.isInspectable = true
        }
        web = wv
        return wv
    }

    func ensureHiddenWeb() {
        let wv = makeWeb()
        guard wv.superview == nil else { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.flatMap(\.windows).first
        guard let window else { return }
        wv.frame = CGRect(x: 0, y: 0, width: 8, height: 8)
        wv.alpha = 0.02
        wv.isUserInteractionEnabled = false
        window.addSubview(wv)
        StreamResolver.log("silent web attached")
    }

    func makeVisibleWeb(id: String) -> WKWebView {
        pendingId = id
        huntArmed = false
        playerTries = 0
        let wv = makeWeb()
        loadWatch(id)
        startHunt()
        return wv
    }

    func prepareIfUnlocking(id: String) {
        guard unlockBox != nil else { return }
        let href = web?.url?.absoluteString ?? ""
        if pendingId != id || !href.contains(id) {
            pendingId = id
            huntArmed = false
            loadWatch(id)
        }
        startHunt()
    }

    static func stripHuntPrefix(_ raw: String) -> String {
        for prefix in ["hook ", "video ", "perf ", "ytipr ", "ytapi "] {
            if raw.hasPrefix(prefix) {
                return String(raw.dropFirst(prefix.count))
            }
        }
        return raw
    }

    func skipUnlock() {
        userSkipped = true
        StreamResolver.markSkip()
        StreamResolver.log("unlock skip id=\(pendingId)")
        completeUnlock(nil)
    }

    func startGoogleSignIn() {
        let id = pendingId
        guard !id.isEmpty else { return }
        signInAsked = true
        let next = "https://www.youtube.com/watch?v=\(id)&noapp=1"
        var parts = URLComponents(string: "https://accounts.google.com/ServiceLogin")!
        parts.queryItems = [
            URLQueryItem(name: "service", value: "youtube"),
            URLQueryItem(name: "continue", value: next),
            URLQueryItem(name: "hl", value: "en"),
            URLQueryItem(name: "passive", value: "false"),
        ]
        guard let dest = parts.url else { return }
        StreamResolver.log("unlock sign-in id=\(id)")
        huntArmed = false
        web?.load(URLRequest(url: dest))
    }

    private func loadWatch(_ id: String) {
        guard let dest = URL(string: "https://www.youtube.com/watch?v=\(id)&noapp=1") else { return }
        web?.load(URLRequest(url: dest))
    }

    func isSignedIn() -> Bool {
        guard let host = web?.url?.host?.lowercased(), host.contains("youtube.com") else { return false }
        return signInAsked || !(web?.url?.absoluteString.contains("accounts.google.com") ?? true)
    }

    private func startHunt() {
        huntTimer?.invalidate()
        huntTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.huntOnce()
        }
        huntOnce()
    }

    private func stopHunt() {
        huntTimer?.invalidate()
        huntTimer = nil
    }

    private static let pagePlayerJS = """
    try {
      var cfg = (window.ytcfg && window.ytcfg.data_) || {};
      var key = cfg.INNERTUBE_API_KEY || '';
      var ctx = cfg.INNERTUBE_CONTEXT || null;
      if (!key || !ctx || !ctx.client) return 'noctx';
      var headers = { 'content-type': 'application/json' };
      var m = document.cookie.match(/SAPISID=([^;]+)/);
      if (m && m[1]) {
        var ts = Math.floor(Date.now() / 1000);
        var origin = location.protocol + '//' + location.host;
        var buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(ts + ' ' + m[1] + ' ' + origin));
        var bytes = new Uint8Array(buf);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) hex += ('0' + bytes[i].toString(16)).slice(-2);
        headers.authorization = 'SAPISIDHASH ' + ts + '_' + hex;
        headers['x-goog-authuser'] = '0';
      }
      var r = await (window.__gtFetch || fetch)(
        '/youtubei/v1/player?key=' + encodeURIComponent(key) + '&prettyPrint=false',
        {
          method: 'POST',
          headers: headers,
          credentials: 'include',
          body: JSON.stringify({
            videoId: vid,
            contentCheckOk: true,
            racyCheckOk: true,
            context: ctx,
          }),
        }
      );
      var j = await r.json();
      var play = (j && j.playabilityStatus && j.playabilityStatus.status) || '';
      var stream = (j && j.streamingData) || {};
      var list = [].concat(stream.formats || [], stream.adaptiveFormats || []);
      var best = '';
      var bestH = -1;
      for (var i = 0; i < list.length; i++) {
        var f = list[i] || {};
        var u = String(f.url || '');
        if (u.indexOf('googlevideo.com') === -1) continue;
        if (u.indexOf('videoplayback') === -1) continue;
        if (!/[?&]itag=(18|22)(?:&|$)/.test(u)) continue;
        if (u.length < 100) continue;
        var h = Number(f.height || 0) || 0;
        if (!best || h > bestH) { best = u; bestH = h; }
      }
      if (best) return best;
      return 'none play=' + play + ' n=' + list.length;
    } catch (e) {
      return 'err ' + String(e && e.message ? e.message : e);
    }
    """

    private static let androidPlayerJS = """
    try {
      const r = await (window.__gtFetch || fetch)(
        'https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w&prettyPrint=false',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-youtube-client-name': '3',
            'x-youtube-client-version': '20.10.38',
          },
          credentials: 'omit',
          body: JSON.stringify({
            videoId: vid,
            contentCheckOk: true,
            racyCheckOk: true,
            context: {
              client: {
                clientName: 'ANDROID',
                clientVersion: '20.10.38',
                hl: 'en',
                gl: 'US',
              },
            },
          }),
        }
      );
      const j = await r.json();
      const stream = (j && j.streamingData) || {};
      const list = [].concat(stream.formats || [], stream.adaptiveFormats || []);
      for (let i = 0; i < list.length; i++) {
        const u = String((list[i] && list[i].url) || '');
        if (u.indexOf('googlevideo.com') !== -1 && /[?&]itag=(18|22)(?:&|$)/.test(u) && u.length >= 100) {
          return u;
        }
      }
      return '';
    } catch (e) {
      return '';
    }
    """

    private func huntOnce() {
        guard huntArmed else { return }
        guard !pendingId.isEmpty else { return }
        guard let host = web?.url?.host?.lowercased(), host.contains("youtube.com") else { return }
        web?.evaluateJavaScript(huntScript(id: pendingId)) { [weak self] result, _ in
            guard let self else { return }
            if let raw = result as? String {
                let href = Self.stripHuntPrefix(raw)
                if StreamResolver.isPlayableFile(href) {
                    let src = raw.split(separator: " ", maxSplits: 1).first.map(String.init) ?? "?"
                    StreamResolver.log("hunt \(src) itag=\(StreamResolver.itag(href)) pot=\(href.contains("pot=")) len=\(href.count)")
                    self.completeUnlock(href)
                }
            }
        }
        if playerTries < 4 {
            playerTries += 1
            let viaPage = playerTries <= 3
            let id = pendingId
            guard let web else { return }
            Task { @MainActor in
                do {
                    let raw = try await web.callAsyncJavaScript(
                        viaPage ? Self.pagePlayerJS : Self.androidPlayerJS,
                        arguments: ["vid": id],
                        in: nil,
                        contentWorld: .page
                    )
                    let href = String(raw as? String ?? "")
                    if StreamResolver.isPlayableFile(href) {
                        StreamResolver.log("hunt \(viaPage ? "ytpage" : "ytapi") itag=\(StreamResolver.itag(href)) pot=\(href.contains("pot=")) len=\(href.count)")
                        self.completeUnlock(href)
                    } else if self.playerTries >= 4, !href.isEmpty {
                        StreamResolver.log("player empty id=\(id) \(href.prefix(100))")
                    }
                } catch {
                    StreamResolver.log("player fail \(error.localizedDescription)")
                }
            }
        }
    }

    func detach(from host: WKWebView) {
        guard web?.superview === host else { return }
        stopHunt()
        web?.navigationDelegate = nil
        web?.uiDelegate = nil
        web?.removeFromSuperview()
        web = nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let dest = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let href = dest.absoluteString
        if huntArmed, StreamResolver.isPlayableFile(href) {
            StreamResolver.log("hunt nav itag=\(StreamResolver.itag(href)) pot=\(href.contains("pot=")) len=\(href.count)")
            completeUnlock(href)
        }
        if Self.isYouTubeAppHandoff(dest) {
            StreamResolver.log("unlock blocked app \(dest.host ?? schemeOf(dest))")
            decisionHandler(.cancel)
            return
        }
        let scheme = (dest.scheme ?? "").lowercased()
        if scheme == "http" || scheme == "https" || scheme == "about" || scheme == "blob" {
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
                webView.load(URLRequest(url: url))
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
            return
        }
        StreamResolver.log("unlock blocked scheme \(scheme)")
        decisionHandler(.cancel)
    }

    private func schemeOf(_ url: URL) -> String {
        url.scheme ?? url.absoluteString
    }

    private static func isYouTubeAppHandoff(_ url: URL) -> Bool {
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "youtube" || scheme == "vnd.youtube" || scheme == "googleyoutube" { return true }
        if scheme == "itms" || scheme == "itms-apps" || scheme == "itms-appss" { return true }
        let host = (url.host ?? "").lowercased()
        if host.contains("apps.apple.com") || host.contains("itunes.apple.com") { return true }
        let href = url.absoluteString.lowercased()
        if href.contains("vnd.youtube") { return true }
        if href.contains("youtube.com/redirect") { return true }
        return false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let host = webView.url?.host ?? ""
        let href = webView.url?.absoluteString ?? ""
        StreamResolver.log("unlock page \(host)")
        guard unlockBox != nil || silentBox != nil, !pendingId.isEmpty else {
            huntOnce()
            return
        }
        if host.contains("accounts.google.com") || host.contains("google.com") && href.contains("signin") {
            return
        }
        if host.contains("youtube.com") {
            lastReferer = href
            if !href.contains(pendingId), watchBounces < 3 {
                watchBounces += 1
                StreamResolver.log("unlock bounce to watch id=\(pendingId) n=\(watchBounces)")
                loadWatch(pendingId)
                return
            }
            huntArmed = true
        }
        huntOnce()
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme != "about" {
            StreamResolver.log("unlock popup \(url.host ?? url.absoluteString)")
            webView.load(URLRequest(url: url))
        }
        return nil
    }
}

struct YouTubeUnlockWeb: UIViewRepresentable {
    let videoId: String

    func makeUIView(context: Context) -> WKWebView {
        YouTubePage.shared.makeVisibleWeb(id: videoId)
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        YouTubePage.shared.prepareIfUnlocking(id: videoId)
    }
}

struct YouTubeUnlockScreen: View {
    let videoId: String
    @State private var copyHint = ""

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
            HStack {
                Button("Cancel send") {
                    YouTubePage.shared.skipUnlock()
                }
                .foregroundStyle(Color(red: 0.04, green: 0.37, blue: 0.83))
                Spacer()
                Text("YouTube")
                    .font(.headline)
                Spacer()
                Button("Copy errors") {
                    let dump = StreamResolver.debugDump()
                    UIPasteboard.general.string = dump.isEmpty ? "No GlassTube errors yet." : dump
                    copyHint = "Copied. Paste it in chat."
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                        copyHint = ""
                    }
                }
                .foregroundStyle(Color(red: 0.04, green: 0.37, blue: 0.83))
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 8)
            Text("This is a YouTube watch login, not the YouTube account card. After Sign in, stay here and wait. Tap Play if you see it. Do not tap Cancel. If YouTube says Watch in YouTube app, tap X.")
                .font(.footnote)
                .foregroundStyle(Color(white: 0.35))
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
            Button("Sign in with Google") {
                YouTubePage.shared.startGoogleSignIn()
            }
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Color(red: 0.04, green: 0.37, blue: 0.83))
            .foregroundStyle(.white)
            .clipShape(Capsule())
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
            YouTubeUnlockWeb(videoId: videoId)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if !copyHint.isEmpty {
                Text(copyHint)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.black.opacity(0.92))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .padding(.horizontal, 12)
                    .padding(.bottom, 28)
            }
        }
        .background(Color.white)
    }
}

private final class FinishBox {
    private let lock = NSLock()
    private let sem = DispatchSemaphore(value: 0)
    private var done = false
    private(set) var value: String?

    func complete(_ raw: String?) {
        lock.lock()
        defer { lock.unlock() }
        if done { return }
        done = true
        value = raw
        sem.signal()
    }

    func tryComplete() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }

    func wait(seconds: TimeInterval) -> DispatchTimeoutResult {
        return sem.wait(timeout: .now() + seconds)
    }
}

enum StreamResolver {
    private static let lock = NSLock()
    private static var cache: [String: (url: String, exp: Date)] = [:]
    private static var lines: [String] = []
    private static var didSkip = false
    static var onSession: ((String) -> Void)?
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 12
        return URLSession(configuration: config)
    }()

    static func url(for id: String, session blob: String? = nil) -> String? {
        let trimmed = id.filter { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
        guard trimmed.count == 11 else { return nil }
        lock.lock()
        if let hit = cache[trimmed], hit.exp > Date() {
            if isPlayableFile(hit.url) {
                lock.unlock()
                log("cache \(trimmed) itag=\(itag(hit.url)) len=\(hit.url.count)")
                return hit.url
            }
            cache.removeValue(forKey: trimmed)
        }
        lock.unlock()
        let hasSess = blob.map { !$0.isEmpty } ?? false
        let found = YouTubePage.shared.silentUnlock(id: trimmed)
            ?? fetch(id: trimmed, client: "ANDROID_SDKLESS")
            ?? fetch(id: trimmed, client: "ANDROID")
            ?? fetch(id: trimmed, client: "IOS")
            ?? (hasSess ? nil : YouTubePage.shared.unlockAndWait(id: trimmed))
        let playable = isPlayableFile(found)
        log("resolve \(trimmed) ok=\(playable) sess=\(hasSess) itag=\(itag(found)) len=\(found?.count ?? 0)")
        note(["id": trimmed, "ok": playable, "len": found?.count ?? 0])
        guard playable, let found else { return nil }
        return found
    }

    static func markSkip() {
        lock.lock()
        didSkip = true
        lock.unlock()
    }

    static func wasSkip() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return didSkip
    }

    static func keepFile(_ id: String, _ url: String) {
        guard isPlayableFile(url) else { return }
        lock.lock()
        cache[id] = (url, Date().addingTimeInterval(1800))
        lock.unlock()
    }

    static func finishUnlock() {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .gtUnlockDone, object: nil)
        }
    }

    private static func urlFromPlayerJSON(_ raw: String?) -> String? {
        guard let raw, let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        let status = json["playabilityStatus"] as? [String: Any]
        let play = String(status?["status"] as? String ?? "")
        let reason = String(status?["reason"] as? String ?? "").prefix(80)
        let streaming = json["streamingData"] as? [String: Any]
        let formats = (streaming?["formats"] as? [[String: Any]] ?? [])
            + (streaming?["adaptiveFormats"] as? [[String: Any]] ?? [])
        let url = pickURL(formats)
        note(["id": "web", "kind": "stream", "play": play, "ok": url != nil, "src": "ytpage", "reason": String(reason)])
        return url
    }

    static func attachStreams(_ payload: inout [String: Any], session blob: String? = nil) {
        lock.lock()
        lines.removeAll()
        didSkip = false
        lock.unlock()
        log("attach start")
        defer { finishUnlock() }
        if var videos = payload["videos"] as? [[String: Any]] {
            let n = min(videos.count, 8)
            for i in 0..<n {
                guard let id = videoId(from: videos[i]) else { continue }
                videos[i]["id"] = id
                if let existing = videos[i]["u"] as? String, isRelayFile(existing) {
                    continue
                }
                var google = videos[i]["u"] as? String
                if !isPlayableFile(google) { google = nil }
                videos[i]["u"] = nil
                if let found = google ?? url(for: id, session: blob) {
                    let pub = MediaRelay.shared.publishResult(id: id, google: found)
                    if pub.probeOk, let local = pub.local {
                        videos[i]["u"] = local
                    } else {
                        log("relay skip \(id) probe=\(pub.probeOk) wifi=\(pub.local != nil)")
                    }
                }
            }
            payload["videos"] = videos
        } else if let raw = payload["url"] as? String, let id = videoId(from: raw) {
            if let u = url(for: id, session: blob) {
                let pub = MediaRelay.shared.publishResult(id: id, google: u)
                if pub.probeOk, let local = pub.local {
                    payload["videos"] = [["id": id, "u": local, "url": raw] as [String: Any]]
                } else {
                    log("relay skip \(id) probe=\(pub.probeOk) wifi=\(pub.local != nil)")
                }
            }
        }
        log("attach done hasFile=\(payloadHasFile(payload)) urlLen=\(payloadUrlLen(payload))")
    }

    static func postPush(_ payload: [String: Any]) -> [String: Any] {
        guard let endpoint = URL(string: "https://glasstube.vercel.app/api/push") else {
            return ["ok": false, "error": "Missing push URL", "network": true]
        }
        let hasFile = payloadHasFile(payload)
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        let sem = DispatchSemaphore(value: 0)
        var out: [String: Any] = ["ok": false, "error": "No response from GlassTube.", "network": true]
        session.dataTask(with: req) { data, resp, err in
            defer { sem.signal() }
            if err != nil {
                out = ["ok": false, "error": "No internet. Retrying...", "network": true]
                return
            }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if let data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                out = stripU(json) as? [String: Any] ?? ["ok": false, "error": "Bad server reply."]
            } else {
                out = ["ok": false, "error": "Server error \(code)", "network": code >= 500]
            }
        }.resume()
        _ = sem.wait(timeout: .now() + 20)
        out["hasFile"] = hasFile
        out["urlLen"] = payloadUrlLen(payload)
        out["itag"] = itag(payload["u"] as? String)
        if let videos = payload["videos"] as? [[String: Any]] {
            out["itag"] = itag(videos.compactMap { $0["u"] as? String }.first)
        }
        out["debug"] = debugDump()
        if !hasFile {
            out["fileError"] = wasSkip()
                ? "You cancelled YouTube. Send again, sign in, then wait for Play. Do not tap Cancel send."
                : "Sent, but YouTube blocked the file on this phone. Stay on WiFi, keep the Phone tab open, then send again."
        }
        return out
    }

    static func isPlayableFile(_ raw: String?) -> Bool {
        guard let u = raw else { return false }
        guard u.contains("googlevideo.com"), u.contains("videoplayback"), u.count >= 100 else { return false }
        return u.range(of: #"[?&]itag=(18|22)(?:&|$)"#, options: .regularExpression) != nil
    }

    static func itag(_ raw: String?) -> String {
        guard let u = raw else { return "-" }
        guard let match = u.range(of: #"[?&]itag=([0-9]+)"#, options: .regularExpression) else { return "?" }
        return String(u[match]).replacingOccurrences(of: #"[^0-9]"#, with: "", options: .regularExpression)
    }

    static func log(_ s: String) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        let line = stamp + " " + s
        lock.lock()
        lines.append(line)
        if lines.count > 60 { lines.removeFirst(lines.count - 60) }
        lock.unlock()
    }

    static func debugDump() -> String {
        lock.lock()
        defer { lock.unlock() }
        return lines.joined(separator: "\n")
    }

    private static func payloadUrlLen(_ payload: [String: Any]) -> Int {
        if let videos = payload["videos"] as? [[String: Any]] {
            return videos.compactMap { ($0["u"] as? String)?.count }.max() ?? 0
        }
        return (payload["u"] as? String)?.count ?? 0
    }

    private static func payloadHasFile(_ payload: [String: Any]) -> Bool {
        if let videos = payload["videos"] as? [[String: Any]] {
            return videos.contains { row in
                isPlayableFile(row["u"] as? String) || isRelayFile(row["u"] as? String)
            }
        }
        return isPlayableFile(payload["u"] as? String) || isRelayFile(payload["u"] as? String)
    }

    private static func isRelayFile(_ raw: String?) -> Bool {
        guard let u = raw else { return false }
        return u.hasPrefix("http://") && u.contains("/s/")
    }

    private static func videoId(from row: [String: Any]) -> String? {
        if let id = row["id"] as? String { return videoId(from: id) }
        if let url = row["url"] as? String { return videoId(from: url) }
        return nil
    }

    private static func videoId(from raw: String) -> String? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let patterns = [
            #"[?&]v=([a-zA-Z0-9_-]{11})"#,
            #"youtu\.be/([a-zA-Z0-9_-]{11})"#,
            #"/(?:shorts|embed|live)/([a-zA-Z0-9_-]{11})"#,
        ]
        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern),
               let match = regex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
               match.numberOfRanges > 1,
               let range = Range(match.range(at: 1), in: s) {
                return String(s[range])
            }
        }
        if s.range(of: #"^[a-zA-Z0-9_-]{11}$"#, options: .regularExpression) != nil {
            return s
        }
        return nil
    }

    private static func stripU(_ value: Any) -> Any {
        if let dict = value as? [String: Any] {
            var out: [String: Any] = [:]
            for (k, v) in dict where k != "u" {
                out[k] = stripU(v)
            }
            return out
        }
        if let arr = value as? [Any] {
            return arr.map { stripU($0) }
        }
        return value
    }

    private static func note(_ payload: [String: Any]) {
        guard let endpoint = URL(string: "https://glasstube.vercel.app/api/watch") else { return }
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body = payload
        body["kind"] = "stream"
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        session.dataTask(with: req) { _, _, _ in }.resume()
    }

    private static func fetch(id: String, client: String) -> String? {
        let key: String
        let ua: String
        let name: String
        let version: String
        var clientObj: [String: Any]
        if client == "IOS" {
            key = "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc"
            ua = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_5_0 like Mac OS X)"
            name = "5"
            version = "20.10.4"
            clientObj = [
                "clientName": "IOS",
                "clientVersion": version,
                "deviceMake": "Apple",
                "deviceModel": "iPhone16,2",
                "osName": "iPhone",
                "osVersion": "18.5.0",
                "hl": "en",
                "gl": "US",
            ]
        } else {
            key = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w"
            ua = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip"
            name = "3"
            version = "20.10.38"
            clientObj = [
                "clientName": "ANDROID",
                "clientVersion": version,
                "hl": "en",
                "gl": "US",
            ]
            if client != "ANDROID_SDKLESS" {
                clientObj["androidSdkVersion"] = 34
                clientObj["osName"] = "Android"
                clientObj["osVersion"] = "14"
            }
        }
        let payload: [String: Any] = [
            "videoId": id,
            "contentCheckOk": true,
            "racyCheckOk": true,
            "context": ["client": clientObj],
        ]
        guard let endpoint = URL(string: "https://www.youtube.com/youtubei/v1/player?key=\(key)&prettyPrint=false") else {
            return nil
        }
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(ua, forHTTPHeaderField: "User-Agent")
        req.setValue(name, forHTTPHeaderField: "X-YouTube-Client-Name")
        req.setValue(version, forHTTPHeaderField: "X-YouTube-Client-Version")
        req.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
        req.setValue("https://www.youtube.com/watch?v=\(id)", forHTTPHeaderField: "Referer")
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        let sem = DispatchSemaphore(value: 0)
        var result: String?
        var play = ""
        var http = 0
        session.dataTask(with: req) { data, resp, _ in
            defer { sem.signal() }
            http = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return }
            play = String((json["playabilityStatus"] as? [String: Any])?["status"] as? String ?? "")
            let streaming = json["streamingData"] as? [String: Any]
            let formats = (streaming?["formats"] as? [[String: Any]] ?? [])
                + (streaming?["adaptiveFormats"] as? [[String: Any]] ?? [])
            result = pickURL(formats)
        }.resume()
        _ = sem.wait(timeout: .now() + 10)
        log("\(client) play=\(play) http=\(http) len=\(result?.count ?? 0)")
        note(["id": id, "client": client, "play": play, "http": http, "ok": isPlayableFile(result)])
        return isPlayableFile(result) ? result : nil
    }

    private static func asInt(_ value: Any?) -> Int {
        if let n = value as? Int { return n }
        if let n = value as? NSNumber { return n.intValue }
        return 0
    }

    private static func mediaURL(_ raw: Any?) -> String? {
        if let url = raw as? String, isPlayableFile(url) {
            return url
        }
        if let cipher = raw as? String, cipher.contains("url=") {
            let parts = cipher.split(separator: "&")
            for part in parts where part.hasPrefix("url=") {
                let enc = String(part.dropFirst(4))
                if let decoded = enc.removingPercentEncoding, isPlayableFile(decoded) {
                    return decoded
                }
            }
        }
        return nil
    }

    private static func pickURL(_ formats: [[String: Any]]) -> String? {
        let progressive = formats.filter { row in
            let mime = String(describing: row["mimeType"] ?? "")
            let height = asInt(row["height"])
            return mime.contains("video/mp4") && mime.contains("mp4a") && height > 0 && height <= 720 && mediaURL(row["url"]) != nil
        }.sorted {
            asInt($0["height"]) > asInt($1["height"])
        }
        if let url = mediaURL(progressive.first?["url"]) { return url }
        if let row = formats.first(where: { asInt($0["itag"]) == 18 }),
           let url = mediaURL(row["url"]) ?? mediaURL(row["signatureCipher"]) {
            return url
        }
        for row in formats {
            if let url = mediaURL(row["url"]) { return url }
        }
        return nil
    }
}
