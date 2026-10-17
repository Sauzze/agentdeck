import Foundation

/// What a tool call is doing, in a few words: "Editing Deck.swift",
/// "Searching the web". The office shows it under the agent's desk.
///
/// It's built only from the parts of a call that say what it's for: a file's
/// name, a web page's host, the description the agent gave it. Never from a
/// command or a path, which can hold anything, and goes to every paired phone.
/// Each agent names its tools its own way, so they're matched in lower case,
/// under each of their names.
enum Activity {
    /// Room for "Editing ConfigurationLoader.swift", and still fits under a desk.
    static let mostCharacters = 40

    static func of(tool: String, input: [String: Any]) -> String {
        cut(line(tool: tool, input: input))
    }

    private static func line(tool: String, input: [String: Any]) -> String {
        func text(_ key: String) -> String { (input[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
        let file = fileName(input)

        if tool.hasPrefix("mcp__") {
            return "Using \(server(ofMCPTool: tool))"
        }
        switch tool.lowercased() {
        case "bash", "shell", "run_shell_command":
            if !text("description").isEmpty { return text("description") }
            return firstWord(input["command"]).map { "Running \($0)" } ?? "Running a command"
        case "edit", "multiedit", "write", "notebookedit", "replace", "write_file", "apply_patch":
            return file.isEmpty ? "Editing files" : "Editing \(file)"
        case "read", "notebookread", "read_file", "read_many_files":
            return file.isEmpty ? "Reading files" : "Reading \(file)"
        case "grep", "glob", "search_file_content":
            return text("pattern").isEmpty ? "Searching" : "Searching for \(text("pattern"))"
        case "webfetch", "web_fetch":
            return host(text("url")).map { "Reading \($0)" } ?? "Reading the web"
        case "websearch", "web_search", "google_web_search":
            return "Searching the web"
        case "task", "agent":
            return text("description").isEmpty ? "Briefing a subagent" : text("description")
        case "todowrite":
            let todos = input["todos"] as? [[String: Any]] ?? []
            let current = todos.first { $0["status"] as? String == "in_progress" }?["activeForm"] as? String
            return current ?? "Planning"
        case "askuserquestion":
            return "Asking you a question"
        default:
            return text("activeForm").isEmpty ? "Using \(tool)" : text("activeForm")
        }
    }

    /// One line, cut to fit. Counted in code points, as the Windows and
    /// Linux app counts them, so both cut in the same place.
    static func cut(_ line: String) -> String {
        let flat = line.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard flat.unicodeScalars.count > mostCharacters else { return flat }
        let kept = String(String.UnicodeScalarView(flat.unicodeScalars.prefix(mostCharacters - 1)))
        return kept.trimmingCharacters(in: .whitespaces) + "…"
    }

    private static func fileName(_ input: [String: Any]) -> String {
        for key in ["file_path", "filePath", "absolute_path", "notebook_path", "path"] {
            if let path = input[key] as? String, !path.isEmpty {
                return path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
            }
        }
        return ""
    }

    /// The program a command runs, without its arguments or its folder:
    /// `FOO=1 ./build.sh --fast` is "build.sh". Codex sends a command as a list.
    private static func firstWord(_ command: Any?) -> String? {
        let words: [String]
        if let list = command as? [String] {
            words = list
        } else if let line = command as? String {
            words = line.split(whereSeparator: \.isWhitespace).map(String.init)
        } else {
            return nil
        }
        let program = words.first { !$0.contains("=") }?
            .components(separatedBy: "/").last?
            .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        return program?.isEmpty == false ? program : nil
    }

    private static func host(_ url: String) -> String? {
        guard let host = URL(string: url)?.host, !host.isEmpty else { return nil }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// `mcp__claude_ai_Gmail__search` is "Gmail", `mcp__plugin_design_figma__…`
    /// is "figma": the server's name, without the prefixes its host adds.
    private static func server(ofMCPTool tool: String) -> String {
        var server = tool.dropFirst("mcp__".count).components(separatedBy: "__").first ?? ""
        if server.hasPrefix("claude_ai_") {
            server = String(server.dropFirst("claude_ai_".count))
        } else if server.hasPrefix("plugin_") {
            server = server.components(separatedBy: "_").last ?? server
        }
        return server.replacingOccurrences(of: "_", with: " ")
    }
}
