import Foundation

/// Where each coding agent is told to run the hook script.
///
/// User-level, so every session on this Mac reports to the deck, whatever
/// folder it starts in. Only agents with a settings folder are connected; one
/// installed later is picked up by connecting again.
///
/// Claude Code, Codex and Gemini CLI read hooks from a settings file they
/// share with everything else: the deck's entries are added to it, the rest
/// is kept as it was, and the file is backed up to `<file>.agentdeck.bak`
/// before each change. The entries are recognised by the path of the hook
/// script, so connecting twice changes nothing and disconnecting takes out
/// only those. Grok and OpenCode load whole files from a folder, so the deck
/// has one of its own there.
enum Hooks {
    /// The deck's entries in an agent's hook settings, in the layout Claude
    /// Code set and the others follow: event → matcher groups → handlers.
    private struct Entries {
        let file: URL
        let events: [String]
        let handler: [String: Any]
        /// The file holds nothing but these entries.
        var isOwnFile = false
    }

    /// Quoted, because Application Support has a space in it. Grok's entries
    /// match Claude Code's to the letter: Grok also reads Claude Code's
    /// hooks, and runs a handler it finds twice only once.
    private static func command(for agent: Agent) -> String {
        let script = "\"\(Paths.hookScript.path)\""
        return agent == .claude || agent == .grok ? script : "\(script) \(agent.rawValue)"
    }

    private static func entries(for agent: Agent) -> Entries? {
        let command = command(for: agent)
        switch agent {
        case .claude:
            return Entries(file: Paths.claudeSettings, events: [
                "SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse",
                "PostToolUseFailure", "Notification", "Stop", "StopFailure", "SessionEnd",
            ], handler: ["type": "command", "command": command, "async": true])
        case .codex:
            return Entries(file: Paths.codexHooks, events: [
                "SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse",
                "Stop", "Interrupt", "SessionEnd",
            ], handler: ["type": "command", "command": command, "async": true, "timeout": 5])
        case .gemini:
            // Gemini CLI waits for its hooks, and counts their timeout in milliseconds.
            return Entries(file: Paths.geminiSettings, events: [
                "SessionStart", "BeforeAgent", "BeforeTool", "AfterTool", "Notification", "AfterAgent",
                "SessionEnd",
            ], handler: ["type": "command", "command": command, "name": "sauzzedeck-pro", "timeout": 5000])
        case .grok:
            return Entries(file: Paths.grokHooks, events: [
                "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
                "Notification", "Stop", "StopFailure", "StopCancelled", "SessionEnd",
            ], handler: ["type": "command", "command": command], isOwnFile: true)
        case .opencode:
            return nil // a plugin: see `writePlugin()`
        }
    }

    private static func settingsFolder(of agent: Agent) -> URL {
        let path = [
            .claude: ".claude", .codex: ".codex", .gemini: ".gemini", .opencode: ".config/opencode", .grok: ".grok",
        ][agent]!
        return Paths.home.appendingPathComponent(path, isDirectory: true)
    }

    /// Agents with a settings folder on this Mac.
    static var found: [Agent] {
        Agent.allCases.filter { FileManager.default.fileExists(atPath: settingsFolder(of: $0).path) }
    }

    static func isConnected(_ agent: Agent) -> Bool {
        guard let entries = entries(for: agent) else {
            return FileManager.default.fileExists(atPath: Paths.openCodePlugin.path)
        }
        guard let hooks = (try? read(entries.file))?["hooks"] as? [String: Any] else { return false }
        return entries.events.allSatisfy { event in
            ((hooks[event] as? [[String: Any]]) ?? []).contains { group in
                ((group["hooks"] as? [[String: Any]]) ?? []).contains(where: isOurs)
            }
        }
    }

    /// Every agent found is connected.
    static var isConnected: Bool {
        let agents = found
        return !agents.isEmpty && agents.allSatisfy(isConnected)
    }

    /// Connects every agent found. One whose settings can't be read is left
    /// alone, and named in the error once the others are done. Claude Code's
    /// voice input is turned on in tap mode — which the mic key needs —
    /// unless voice is already set up some other way.
    static func connect() throws {
        let agents = found
        guard !agents.isEmpty else { throw HookError.noAgents }
        try updateFiles()
        var unreadable: [URL] = []
        for agent in agents {
            guard let entries = entries(for: agent) else {
                try writePlugin()
                continue
            }
            do {
                var settings = entries.isOwnFile ? [:] : try read(entries.file)
                var hooks = withoutOurs(settings["hooks"] as? [String: Any] ?? [:])
                for event in entries.events {
                    hooks[event] = (hooks[event] as? [[String: Any]] ?? []) + [["hooks": [entries.handler]]]
                }
                settings["hooks"] = hooks
                if agent == .claude && settings["voice"] == nil {
                    settings["voice"] = ["enabled": true, "mode": "tap"]
                }
                try write(settings, to: entries.file, backup: !entries.isOwnFile)
            } catch HookError.unreadableSettings {
                unreadable.append(entries.file)
            }
        }
        if !unreadable.isEmpty { throw HookError.unreadableSettings(unreadable) }
    }

    static func disconnect() throws {
        for agent in Agent.allCases {
            guard let entries = entries(for: agent) else {
                try? FileManager.default.removeItem(at: Paths.openCodePlugin)
                continue
            }
            if entries.isOwnFile {
                try? FileManager.default.removeItem(at: entries.file)
                continue
            }
            guard FileManager.default.fileExists(atPath: entries.file.path) else { continue }
            var settings = try read(entries.file)
            let hooks = withoutOurs(settings["hooks"] as? [String: Any] ?? [:])
            settings["hooks"] = hooks.isEmpty ? nil : hooks
            try write(settings, to: entries.file, backup: true)
        }
    }

    /// The hook script, copied out of the app with the deck's port filled in,
    /// to a path that stays put when the app is moved or updated, and
    /// OpenCode's plugin, which runs it. Rewritten at every launch, so an
    /// updated app brings them up to date too.
    static func updateFiles() throws {
        let template = try String(contentsOf: Paths.bundledHookScript, encoding: .utf8)
        let script = template.replacingOccurrences(of: "{{PORT}}", with: String(Deck.port))
        try script.write(to: Paths.hookScript, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: Paths.hookScript.path)
        if FileManager.default.fileExists(atPath: Paths.openCodePlugin.path) { try writePlugin() }
    }

    private static func writePlugin() throws {
        let template = try String(contentsOf: Paths.bundledOpenCodePlugin, encoding: .utf8)
        let command = try JSONSerialization.data(withJSONObject: [Paths.hookScript.path, Agent.opencode.rawValue],
                                                 options: .withoutEscapingSlashes)
        let plugin = template.replacingOccurrences(of: #"["{{COMMAND}}"]"#, with: String(decoding: command, as: UTF8.self))
        try FileManager.default.createDirectory(at: Paths.openCodePlugin.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try plugin.write(to: Paths.openCodePlugin, atomically: true, encoding: .utf8)
    }

    private static func isOurs(_ hook: [String: Any]) -> Bool {
        (hook["command"] as? String)?.contains(Paths.hookScript.path) ?? false
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

    private static func read(_ file: URL) throws -> [String: Any] {
        guard let data = try? Data(contentsOf: file) else { return [:] }
        guard let settings = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw HookError.unreadableSettings([file])
        }
        return settings
    }

    private static func write(_ settings: [String: Any], to file: URL, backup: Bool) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if backup && fm.fileExists(atPath: file.path) {
            let copy = file.appendingPathExtension("agentdeck.bak")
            try? fm.removeItem(at: copy)
            try? fm.copyItem(at: file, to: copy)
        }
        let options: JSONSerialization.WritingOptions = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let data = try JSONSerialization.data(withJSONObject: settings, options: options)
        try data.write(to: file, options: .atomic)
    }

    enum HookError: LocalizedError {
        case noAgents
        case unreadableSettings([URL])

        var errorDescription: String? {
            switch self {
            case .noAgents:
                return "No coding agent found on this Mac. Install one, open it once, then connect again."
            case .unreadableSettings(let files):
                let names = files.map { $0.path.replacingOccurrences(of: Paths.home.path, with: "~") }
                return "\(names.joined(separator: " and ")) isn't valid JSON. Fix it, then try again."
            }
        }
    }
}
