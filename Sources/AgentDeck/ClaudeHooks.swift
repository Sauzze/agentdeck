import Foundation

/// AgentDeck's entries in ~/.claude/settings.json.
///
/// User-level, so every Claude Code session on this Mac reports to the deck,
/// whatever folder it starts in. Everything else in the file is kept as it
/// was, and the file is backed up to settings.json.agentdeck.bak before each
/// change. AgentDeck's entries are
/// recognised by the path of its hook script, so installing twice changes
/// nothing and removing takes out only those.
enum ClaudeHooks {
    static let events = [
        "SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse",
        "PostToolUseFailure", "Notification", "Stop", "StopFailure", "SessionEnd",
    ]

    /// Quoted, because Application Support has a space in it.
    private static var command: String { "\"\(Paths.hookScript.path)\"" }

    private static func isOurs(_ hook: [String: Any]) -> Bool {
        (hook["command"] as? String)?.contains(Paths.hookScript.path) ?? false
    }

    static var isInstalled: Bool {
        guard let hooks = (try? readSettings())?["hooks"] as? [String: Any] else { return false }
        return events.allSatisfy { event in
            ((hooks[event] as? [[String: Any]]) ?? []).contains { group in
                ((group["hooks"] as? [[String: Any]]) ?? []).contains(where: isOurs)
            }
        }
    }

    /// Adds the hooks, and turns on Claude's voice input in tap mode — which the
    /// mic key needs — unless voice is already set up some other way.
    static func install() throws {
        try updateScript()
        var settings = try readSettings()
        var hooks = withoutOurs(settings["hooks"] as? [String: Any] ?? [:])
        for event in events {
            var groups = hooks[event] as? [[String: Any]] ?? []
            groups.append(["hooks": [["type": "command", "command": command, "async": true]]])
            hooks[event] = groups
        }
        settings["hooks"] = hooks
        if settings["voice"] == nil {
            settings["voice"] = ["enabled": true, "mode": "tap"]
        }
        try writeSettings(settings)
    }

    static func uninstall() throws {
        var settings = try readSettings()
        let hooks = withoutOurs(settings["hooks"] as? [String: Any] ?? [:])
        settings["hooks"] = hooks.isEmpty ? nil : hooks
        try writeSettings(settings)
    }

    /// The hook script, copied out of the app with the deck's port filled in,
    /// to a path that stays put when the app is moved or updated. Rewritten at
    /// every launch, so an updated app brings its script up to date too.
    static func updateScript() throws {
        let template = try String(contentsOf: Paths.bundledHookScript, encoding: .utf8)
        let script = template.replacingOccurrences(of: "{{PORT}}", with: String(Deck.port))
        try script.write(to: Paths.hookScript, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: Paths.hookScript.path)
    }

    private static func withoutOurs(_ hooks: [String: Any]) -> [String: Any] {
        var result: [String: Any] = [:]
        for (event, value) in hooks {
            let groups = (value as? [[String: Any]] ?? []).compactMap { group -> [String: Any]? in
                var group = group
                let kept = (group["hooks"] as? [[String: Any]] ?? []).filter { !isOurs($0) }
                guard !kept.isEmpty else { return nil }
                group["hooks"] = kept
                return group
            }
            if !groups.isEmpty { result[event] = groups }
        }
        return result
    }

    private static func readSettings() throws -> [String: Any] {
        guard let data = try? Data(contentsOf: Paths.claudeSettings) else { return [:] }
        guard let settings = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw HookError.unreadableSettings
        }
        return settings
    }

    private static func writeSettings(_ settings: [String: Any]) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: Paths.claudeSettings.deletingLastPathComponent(), withIntermediateDirectories: true)
        if fm.fileExists(atPath: Paths.claudeSettings.path) {
            try? fm.removeItem(at: Paths.claudeSettingsBackup)
            try? fm.copyItem(at: Paths.claudeSettings, to: Paths.claudeSettingsBackup)
        }
        let options: JSONSerialization.WritingOptions = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try JSONSerialization.data(withJSONObject: settings, options: options)
        try data.write(to: Paths.claudeSettings, options: .atomic)
    }

    enum HookError: LocalizedError {
        case unreadableSettings
        var errorDescription: String? { "~/.claude/settings.json isn't valid JSON. Fix it, then try again." }
    }
}
