import Foundation

/// The deck's colours. Every colour on the phone is one of these or mixed from
/// them, so these twelve are the whole theme.
enum Theme {
    struct Colour {
        let name: String   // the CSS variable, without its leading dashes
        let label: String
        let group: String
        let standard: String
    }

    static let colours: [Colour] = [
        Colour(name: "body", label: "Background", group: "Interface", standard: "#0e0e0e"),
        Colour(name: "cap", label: "Keys", group: "Interface", standard: "#1f1f1f"),
        Colour(name: "cap-top", label: "Key highlight", group: "Interface", standard: "#262626"),
        Colour(name: "edge", label: "Borders", group: "Interface", standard: "#2c2c2c"),
        Colour(name: "ink", label: "Text", group: "Interface", standard: "#ececec"),
        Colour(name: "dim", label: "Secondary text", group: "Interface", standard: "#6f6f6f"),
        Colour(name: "faint", label: "Unlit", group: "Interface", standard: "#3a3a3a"),
        Colour(name: "idle", label: "Idle", group: "States", standard: "#f2f2f2"),
        Colour(name: "thinking", label: "Working", group: "States", standard: "#3b82f6"),
        Colour(name: "asking", label: "Waiting on you", group: "States", standard: "#ff8a1f"),
        Colour(name: "unread", label: "Done, unread", group: "States", standard: "#22c55e"),
        Colour(name: "error", label: "Error", group: "States", standard: "#ef4444"),
    ]

    static let standard = Dictionary(uniqueKeysWithValues: colours.map { ($0.name, $0.standard) })

    static let presets: [(name: String, colours: [String: String])] = [
        ("Default", standard),
        ("Midnight", [
            "body": "#050505", "cap": "#141414", "cap-top": "#1b1b1b", "edge": "#262626",
            "ink": "#f5f5f5", "dim": "#7c7c7c", "faint": "#333333",
            "idle": "#ffffff", "thinking": "#2f6bff", "asking": "#ff4fa3", "unread": "#2bd96b", "error": "#ff3b30",
        ]),
        ("High contrast", [
            "body": "#000000", "cap": "#111111", "cap-top": "#1a1a1a", "edge": "#5a5a5a",
            "ink": "#ffffff", "dim": "#b0b0b0", "faint": "#4d4d4d",
            "idle": "#ffffff", "thinking": "#4da3ff", "asking": "#ffb000", "unread": "#00e676", "error": "#ff1744",
        ]),
        ("Light", [
            "body": "#e9e9ec", "cap": "#f7f7f8", "cap-top": "#ffffff", "edge": "#c9c9cf",
            "ink": "#1c1c1e", "dim": "#6e6e73", "faint": "#c7c7cc",
            "idle": "#8e8e93", "thinking": "#007aff", "asking": "#ff9500", "unread": "#34c759", "error": "#ff3b30",
        ]),
    ]

    /// Every colour, with the saved ones over the defaults.
    static func current() -> [String: String] {
        standard.merging(Config.shared.colours) { _, saved in saved }
    }

    /// Keeps known names with #rrggbb values that differ from the default.
    static func customisations(from input: [String: Any]) -> [String: String] {
        var result: [String: String] = [:]
        for (name, value) in input {
            guard let hex = (value as? String)?.lowercased(),
                  let standardValue = standard[name],
                  hex.range(of: "^#[0-9a-f]{6}$", options: .regularExpression) != nil,
                  hex != standardValue else { continue }
            result[name] = hex
        }
        return result
    }

    /// The editor's view of the theme, for the setup page.
    static func editorJSON() -> [String: Any] {
        [
            "colours": current(),
            "tokens": colours.map { [$0.name, $0.label, $0.group] },
            "presets": presets.map { ["name": $0.name, "colours": $0.colours] },
        ]
    }
}
