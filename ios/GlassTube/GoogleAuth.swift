import AuthenticationServices
import UIKit

/// Google sign-in, native. The server does the OAuth dance and hands back a
/// sealed session on the glasstube:// callback, so nothing here ever touches a
/// client secret.
@MainActor
final class GoogleAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = GoogleAuth()
    private var live: ASWebAuthenticationSession?

    func start() async -> Result<String, Error> {
        guard let url = URL(string: API.origin + "/api/auth/google?n=ios") else {
            return .failure(GlassTubeError.server("Google login is not configured."))
        }
        return await withCheckedContinuation { cont in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: "glasstube"
            ) { callback, error in
                if let error {
                    let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    cont.resume(returning: .failure(cancelled
                        ? GlassTubeError.server("")
                        : error))
                    return
                }
                let items = callback.flatMap {
                    URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems
                }
                if let err = items?.first(where: { $0.name == "err" })?.value, !err.isEmpty {
                    cont.resume(returning: .failure(GlassTubeError.server(err)))
                    return
                }
                guard let blob = items?.first(where: { $0.name == "s" })?.value, !blob.isEmpty else {
                    cont.resume(returning: .failure(GlassTubeError.server("Google did not return a session.")))
                    return
                }
                cont.resume(returning: .success(blob))
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            live = session
            session.start()
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
    }
}
