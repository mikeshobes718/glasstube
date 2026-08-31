import Darwin
import Foundation
import Network
import UIKit

final class MediaRelay {
    static let shared = MediaRelay()
    private let port: NWEndpoint.Port = 8787
    private let lock = NSLock()
    private var files: [String: URL] = [:]
    private var sizes: [String: Int] = [:]
    private var referers: [String: String] = [:]
    private var listener: NWListener?
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.httpAdditionalHeaders = ["Accept-Encoding": "identity"]
        return URLSession(configuration: config)
    }()
    private let ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
    private let sliceBytes = 262144

    func publish(id: String, google: String) -> String? {
        publishResult(id: id, google: google).local
    }

    func publishResult(id: String, google: String) -> (local: String?, probeOk: Bool) {
        guard let dest = URL(string: google) else { return (nil, false) }
        start()
        guard let ip = Self.wifiIPv4() else {
            StreamResolver.log("relay no wifi ip")
            return (nil, false)
        }
        let referer = YouTubePage.shared.lastReferer
        lock.lock()
        files[id] = dest
        referers[id] = referer
        lock.unlock()
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = true }
        let local = "http://\(ip):\(port.rawValue)/s/\(id)"
        StreamResolver.log("relay \(id) \(local)")
        let hit = pull(id: id, dest: dest, range: "bytes=0-1023")
        let code = hit?.status ?? 0
        let mime = hit?.type ?? ""
        StreamResolver.log("relay probe \(id) http=\(code) mime=\(mime) bytes=\(hit?.body.count ?? 0) via=\(hit?.err.isEmpty == true ? "ok" : (hit?.err ?? "none"))")
        let ok = hit?.status == 200 || hit?.status == 206
        if ok {
            StreamResolver.keepFile(id, google)
        }
        return (local, ok)
    }

    private func start() {
        lock.lock()
        if listener != nil {
            lock.unlock()
            return
        }
        lock.unlock()
        do {
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            let listen = try NWListener(using: params, on: port)
            listener = listen
            listen.newConnectionHandler = { [weak self] conn in
                conn.start(queue: .global(qos: .userInitiated))
                self?.serve(conn)
            }
            listen.start(queue: .global(qos: .userInitiated))
            StreamResolver.log("relay listen \(port.rawValue)")
        } catch {
            StreamResolver.log("relay listen fail \(error.localizedDescription)")
        }
    }

    private func file(for id: String) -> URL? {
        lock.lock()
        defer { lock.unlock() }
        return files[id]
    }

    private func size(for id: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return sizes[id] ?? 0
    }

    private func referer(for id: String) -> String {
        lock.lock()
        defer { lock.unlock() }
        return referers[id] ?? YouTubePage.shared.lastReferer
    }

    private func rememberSize(_ id: String, _ hit: GoogleHit) {
        let cr = hit.contentRange
        guard let slash = cr.lastIndex(of: "/"),
              let n = Int(cr[cr.index(after: slash)...]),
              n > 0
        else { return }
        lock.lock()
        sizes[id] = n
        lock.unlock()
    }

    private func pull(id: String, dest: URL, range: String?) -> GoogleHit? {
        let href = dest.absoluteString
        let omit = YouTubePage.waitGoogle(url: href, range: range, cookies: false)
        if let hit = omit, hit.status == 200 || hit.status == 206 {
            rememberSize(id, hit)
            StreamResolver.log("relay via=js cookies=0 http=\(hit.status) mime=\(hit.type) bytes=\(hit.body.count) range=\(range ?? "-")")
            return GoogleHit(status: hit.status, type: hit.type, contentRange: hit.contentRange, length: hit.length, body: hit.body, err: "")
        }
        if let miss = omit, !miss.err.isEmpty {
            StreamResolver.log("relay js omit \(miss.err) http=\(miss.status)")
        } else if let miss = omit {
            StreamResolver.log("relay js omit http=\(miss.status) mime=\(miss.type)")
        }
        let include = YouTubePage.waitGoogle(url: href, range: range, cookies: true)
        if let hit = include, hit.status == 200 || hit.status == 206 {
            rememberSize(id, hit)
            StreamResolver.log("relay via=js cookies=1 http=\(hit.status) mime=\(hit.type) bytes=\(hit.body.count) range=\(range ?? "-")")
            return GoogleHit(status: hit.status, type: hit.type, contentRange: hit.contentRange, length: hit.length, body: hit.body, err: "")
        }
        if let miss = include, !miss.err.isEmpty {
            StreamResolver.log("relay js cookies \(miss.err) http=\(miss.status)")
        } else if let miss = include {
            StreamResolver.log("relay js cookies http=\(miss.status) mime=\(miss.type)")
        }
        return urlPull(id: id, dest: dest, range: range)
    }

    private func urlPull(id: String, dest: URL, range: String?) -> GoogleHit? {
        var req = URLRequest(url: dest)
        req.httpShouldHandleCookies = false
        req.setValue(ua, forHTTPHeaderField: "User-Agent")
        req.setValue("*/*", forHTTPHeaderField: "Accept")
        req.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let ref = referer(for: id)
        req.setValue(ref, forHTTPHeaderField: "Referer")
        if let origin = URL(string: ref), let host = origin.host, let scheme = origin.scheme {
            req.setValue("\(scheme)://\(host)", forHTTPHeaderField: "Origin")
        }
        if let range, !range.isEmpty {
            req.setValue(range, forHTTPHeaderField: "Range")
        }
        let sem = DispatchSemaphore(value: 0)
        var hit: GoogleHit?
        session.dataTask(with: req) { data, resp, err in
            let http = resp as? HTTPURLResponse
            let code = http?.statusCode ?? 0
            let mime = http?.value(forHTTPHeaderField: "Content-Type") ?? ""
            let cr = http?.value(forHTTPHeaderField: "Content-Range") ?? ""
            let cl = http?.value(forHTTPHeaderField: "Content-Length") ?? ""
            let body = data ?? Data()
            let text = String(data: body.prefix(80), encoding: .utf8) ?? ""
            StreamResolver.log("relay via=url http=\(code) mime=\(mime) bytes=\(body.count) \(text)")
            hit = GoogleHit(
                status: code,
                type: mime,
                contentRange: cr,
                length: cl,
                body: body,
                err: err?.localizedDescription ?? ""
            )
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 20)
        if let hit, hit.status == 200 || hit.status == 206 {
            rememberSize(id, hit)
            return GoogleHit(status: hit.status, type: hit.type, contentRange: hit.contentRange, length: hit.length, body: hit.body, err: "")
        }
        return hit
    }

    private func parseRange(_ raw: String?, total: Int) -> (Int, Int) {
        guard let raw, !raw.isEmpty else {
            return (0, total > 0 ? min(total - 1, sliceBytes - 1) : 1023)
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let spec = trimmed.lowercased().hasPrefix("bytes=") ? String(trimmed.dropFirst(6)) : trimmed
        let parts = spec.split(separator: "-", maxSplits: 1).map { String($0) }
        let start = Int(parts.first ?? "0") ?? 0
        if parts.count < 2 || parts[1].isEmpty {
            let end = total > 0 ? total - 1 : start + sliceBytes - 1
            return (start, max(start, end))
        }
        let end = Int(parts[1]) ?? start
        return (start, max(start, end))
    }

    private func serve(_ conn: NWConnection) {
        var buf = Data()
        func read() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 32 * 1024) { [weak self] data, _, done, err in
                guard let self else { return }
                if let data { buf.append(data) }
                if let split = buf.range(of: Data("\r\n\r\n".utf8)) {
                    let head = String(data: buf.subdata(in: buf.startIndex..<split.lowerBound), encoding: .utf8) ?? ""
                    self.handle(conn, raw: head)
                    return
                }
                if done || err != nil {
                    conn.cancel()
                    return
                }
                read()
            }
        }
        read()
    }

    private func handle(_ conn: NWConnection, raw: String) {
        let lines = raw.split(whereSeparator: { $0 == "\n" }).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let first = lines.first ?? ""
        let parts = first.split(separator: " ")
        let path = parts.count > 1 ? String(parts[1]) : "/"
        var range: String?
        for line in lines {
            if line.lowercased().hasPrefix("range:") {
                range = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            }
        }
        if path.hasPrefix("/p/") {
            let id = String(path.dropFirst(3)).split(separator: "?").first.map(String.init) ?? ""
            reply(conn, status: 200, type: "text/html; charset=utf-8", headers: [:], body: Data(playPage(id).utf8))
            return
        }
        if path.hasPrefix("/s/") {
            let id = String(path.dropFirst(3)).split(separator: "?").first.map(String.init) ?? ""
            guard let dest = file(for: id) else {
                reply(conn, status: 404, type: "text/plain", headers: [:], body: Data("no file".utf8))
                return
            }
            proxy(conn, id: id, dest: dest, range: range)
            return
        }
        reply(conn, status: 404, type: "text/plain", headers: [:], body: Data("nope".utf8))
    }

    private func playPage(_ id: String) -> String {
        let safe = id.filter { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
        return """
        <!doctype html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=600, height=600, initial-scale=1, user-scalable=no">
        <style>
        html,body{margin:0;background:#000;width:600px;height:600px;overflow:hidden}
        video{width:600px;height:600px;object-fit:contain;background:#000}
        </style>
        </head>
        <body>
        <video id="v" autoplay muted playsinline src="/s/\(safe)"></video>
        <script>
        var v=document.getElementById('v');
        var fails=0;
        function back(){ location.replace('https://glasstube.vercel.app/'); }
        v.addEventListener('ended', back);
        v.addEventListener('error', function(){
          fails++;
          if (fails < 2) { v.load(); v.play().catch(function(){}); return; }
          back();
        });
        v.play().catch(function(){});
        </script>
        </body>
        </html>
        """
    }

    private func reply(_ conn: NWConnection, status: Int, type: String, headers: [String: String], body: Data) {
        var head = "HTTP/1.1 \(status) \(HTTPURLResponse.localizedString(forStatusCode: status))\r\n"
        head += "Content-Type: \(type)\r\n"
        head += "Content-Length: \(body.count)\r\n"
        for (key, value) in headers {
            head += "\(key): \(value)\r\n"
        }
        head += "Accept-Ranges: bytes\r\n"
        head += "Connection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(body)
        conn.send(content: out, contentContext: .defaultMessage, isComplete: true, completion: .contentProcessed { _ in
            conn.cancel()
        })
    }

    private func proxy(_ conn: NWConnection, id: String, dest: URL, range: String?) {
        Task.detached { [weak self] in
            guard let self else { return }
            var total = self.size(for: id)
            var start = 0
            var end = 0
            if total <= 0 {
                let probeRange = range ?? "bytes=0-1023"
                guard let first = self.pull(id: id, dest: dest, range: probeRange),
                      first.status == 200 || first.status == 206
                else {
                    StreamResolver.log("relay fetch \(id) fail range=\(range ?? "-")")
                    self.reply(conn, status: 502, type: "text/plain", headers: [:], body: Data("no file".utf8))
                    return
                }
                total = self.size(for: id)
                let parsed = self.parseRange(range, total: total)
                start = parsed.0
                end = parsed.1
                if first.body.count >= (end - start + 1) || range == probeRange {
                    StreamResolver.log("relay fetch \(id) http=\(first.status) range=\(range ?? "-")")
                    var extra: [String: String] = [:]
                    if !first.contentRange.isEmpty { extra["Content-Range"] = first.contentRange }
                    self.reply(conn, status: first.status, type: first.type.isEmpty ? "video/mp4" : first.type, headers: extra, body: first.body)
                    return
                }
            } else {
                let parsed = self.parseRange(range, total: total)
                start = parsed.0
                end = parsed.1
            }
            if total <= 0 { total = end + 1 }
            end = min(end, max(start, total - 1))
            var body = Data()
            var status = 206
            var type = "video/mp4"
            var i = start
            while i <= end {
                let cap = total > 0 ? total - 1 : i + self.sliceBytes - 1
                let fetchEnd = min(max(i + 1023, min(i + self.sliceBytes - 1, end)), cap)
                guard let hit = self.pull(id: id, dest: dest, range: "bytes=\(i)-\(fetchEnd)"),
                      hit.status == 200 || hit.status == 206
                else {
                    StreamResolver.log("relay fetch \(id) fail slice \(i)-\(fetchEnd)")
                    if body.isEmpty {
                        self.reply(conn, status: 502, type: "text/plain", headers: [:], body: Data("no file".utf8))
                    } else {
                        conn.cancel()
                    }
                    return
                }
                status = hit.status
                if !hit.type.isEmpty { type = hit.type }
                let need = min(end, fetchEnd) - i + 1
                if hit.body.count >= need {
                    body.append(hit.body.prefix(need))
                } else {
                    body.append(hit.body)
                }
                i = i + need
            }
            StreamResolver.log("relay fetch \(id) http=\(status) range=\(range ?? "-") bytes=\(body.count)")
            var extra: [String: String] = [:]
            extra["Content-Range"] = "bytes \(start)-\(end)/\(total)"
            self.reply(conn, status: status, type: type, headers: extra, body: body)
        }
    }

    private static func wifiIPv4() -> String? {
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0 else { return nil }
        defer { freeifaddrs(ifaddr) }
        var fallback: String?
        var ptr = ifaddr
        while let p = ptr {
            let flags = Int32(p.pointee.ifa_flags)
            if (flags & IFF_UP) == IFF_UP,
               (flags & IFF_LOOPBACK) == 0,
               let addr = p.pointee.ifa_addr,
               addr.pointee.sa_family == sa_family_t(AF_INET) {
                let name = String(cString: p.pointee.ifa_name)
                var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
                let ip = String(cString: host)
                if name.hasPrefix("en"), privateIP(ip) {
                    if name == "en0" { return ip }
                    fallback = fallback ?? ip
                }
            }
            ptr = p.pointee.ifa_next
        }
        return fallback
    }

    private static func privateIP(_ ip: String) -> Bool {
        ip.hasPrefix("192.168.") || ip.hasPrefix("10.") || ip.hasPrefix("172.")
    }
}
