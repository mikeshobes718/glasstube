import SwiftUI

/// Appearance settings, kept apart from Store because they are about how the
/// app looks rather than what it knows.
///
/// Everything here is semantic. The old build hardcoded .preferredColorScheme(.dark)
/// and then assumed dark everywhere underneath, which is why light mode was not
/// a switch away - half the colours were literal. These tokens resolve per
/// scheme so a light build is designed rather than inverted.
@MainActor
final class Theme: ObservableObject {
    enum Mode: String, CaseIterable, Identifiable {
        case system, light, dark
        var id: String { rawValue }

        var label: String {
            switch self {
            case .system: return "System"
            case .light: return "Light"
            case .dark: return "Dark"
            }
        }

        var symbol: String {
            switch self {
            case .system: return "circle.lefthalf.filled"
            case .light: return "sun.max"
            case .dark: return "moon"
            }
        }

        var scheme: ColorScheme? {
            switch self {
            case .system: return nil
            case .light: return .light
            case .dark: return .dark
            }
        }
    }

    enum Accent: String, CaseIterable, Identifiable {
        case glass, red, violet, green, orange, mono
        var id: String { rawValue }

        var label: String {
            switch self {
            case .glass: return "Glass"
            case .red: return "Player"
            case .violet: return "Violet"
            case .green: return "Signal"
            case .orange: return "Ember"
            case .mono: return "Mono"
            }
        }

        /// Tuned per scheme. A colour bright enough to carry a dark UI is
        /// usually too pale on white, which is where most "we added light
        /// mode" apps come apart.
        func color(_ scheme: ColorScheme) -> Color {
            let dark = scheme == .dark
            switch self {
            case .glass:  return dark ? Color(red: 0.22, green: 0.80, blue: 1.00)
                                      : Color(red: 0.00, green: 0.48, blue: 0.75)
            case .red:    return dark ? Color(red: 1.00, green: 0.26, blue: 0.26)
                                      : Color(red: 0.84, green: 0.05, blue: 0.05)
            case .violet: return dark ? Color(red: 0.70, green: 0.55, blue: 1.00)
                                      : Color(red: 0.42, green: 0.25, blue: 0.85)
            case .green:  return dark ? Color(red: 0.30, green: 0.88, blue: 0.60)
                                      : Color(red: 0.00, green: 0.55, blue: 0.33)
            case .orange: return dark ? Color(red: 1.00, green: 0.60, blue: 0.25)
                                      : Color(red: 0.80, green: 0.40, blue: 0.02)
            case .mono:   return dark ? Color(white: 0.92) : Color(white: 0.12)
            }
        }
    }

    @AppStorage("glasstube.appearance") private var modeRaw = Mode.system.rawValue
    @AppStorage("glasstube.accent") private var accentRaw = Accent.glass.rawValue
    @AppStorage("glasstube.haptics") var haptics = true
    @AppStorage("glasstube.dataSaver") var dataSaver = false
    @AppStorage("glasstube.confirmLists") var confirmLists = false

    var mode: Mode {
        get { Mode(rawValue: modeRaw) ?? .system }
        set { objectWillChange.send(); modeRaw = newValue.rawValue }
    }

    var accent: Accent {
        get { Accent(rawValue: accentRaw) ?? .glass }
        set { objectWillChange.send(); accentRaw = newValue.rawValue }
    }
}

/// Reads the accent through the environment's colour scheme, so every call
/// site gets the variant that belongs to whatever the app is currently in.
private struct AccentKey: EnvironmentKey {
    static let defaultValue = Color(red: 0.22, green: 0.80, blue: 1.00)
}

extension EnvironmentValues {
    var gtAccent: Color {
        get { self[AccentKey.self] }
        set { self[AccentKey.self] = newValue }
    }
}

extension View {
    /// Liquid Glass where the OS has it. Kept in one place so the fallback for
    /// anything older is a single edit rather than a hunt.
    @ViewBuilder
    func gtGlass(_ shape: some Shape, tint: Color? = nil, interactive: Bool = false) -> some View {
        if #available(iOS 26.0, *) {
            // Building the Glass value inside the ViewBuilder branch is not
            // allowed - statements are not views - so it is assembled here.
            self.glassEffect(Glass.gt(tint: tint, interactive: interactive), in: shape)
        } else {
            self.background(.ultraThinMaterial, in: shape)
        }
    }

    @ViewBuilder
    func gtSoftScrollEdges() -> some View {
        if #available(iOS 26.0, *) {
            self.scrollEdgeEffectStyle(.soft, for: .all)
        } else {
            self
        }
    }

    @ViewBuilder
    func gtTabBarMinimize() -> some View {
        if #available(iOS 26.0, *) {
            self.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            self
        }
    }
}

@available(iOS 26.0, *)
extension Glass {
    static func gt(tint: Color?, interactive: Bool) -> Glass {
        var glass = Glass.regular
        if let tint { glass = glass.tint(tint) }
        if interactive { glass = glass.interactive() }
        return glass
    }
}

/// One place that decides what a tap feels like, so turning haptics off in
/// Settings actually turns all of them off.
@MainActor
enum Haptics {
    static var enabled = true

    static func tap() {
        guard enabled else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func success() {
        guard enabled else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func warning() {
        guard enabled else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
}
