import Foundation

/// What a session is doing, as the keys show it.
enum SessionState: String {
    case idle      // white: nothing running, or finished and already seen
    case thinking  // blue: a turn is running
    case asking    // orange: waiting on you — a permission prompt or a question
    case unread    // green: finished, not looked at yet
    case error     // red: the turn ended on an API error
}

final class Session {
    let id: String
    let agent: Agent
    /// Where the agent is now: it moves as the agent changes folders.
    var folder: String
    /// The project the session belongs to, settled when it starts: see
    /// `Sessions.project(startedIn:)`. Keys show its name and pins match it,
    /// so neither changes as the agent moves into a subfolder.
    var project: String
    var tty = ""
    var state = SessionState.idle
    var effort = ""
    /// An effort change waiting for the session to be free.
    var pendingEffort = ""
    var startedAt: Double
    var lastEventAt: Double = 0

    /// Claude Code's subagents still running, oldest first.
    var subagents: [Subagent] = []
    /// Subagents seen stopping this turn. Hooks can arrive out of order, and
    /// a start that comes in after its stop must not bring the helper back.
    var stoppedSubagents: Set<String> = []
    /// The tool running, by name, and its call's id: with tools run side by
    /// side, only the end of the one shown clears it.
    var tool = ""
    var toolUseID = ""
    /// What that tool call is doing, in a few words: see `Activity`.
    var toolActivity = ""
    /// The tool a permission prompt is asking about.
    var waitingFor = ""
    /// When ☢ Max was last pressed for this session, in ms. Only the button
    /// sets it, never the dial, so the office knows which one was used.
    var maxPressedAt: Double?
    var compacting = false
    var turnStartedAt: Double?
    /// Why the last turn failed, as Claude Code names it: "rate_limit",
    /// "overloaded"… Kept while the session shows the error.
    var errorKind = ""
    /// The model Claude Code is running, such as "claude-opus-5-5", which
    /// the office dresses its agent for. Empty until it's known.
    var model = ""
    /// Claude Code's transcript of the conversation, which names the model
    /// of each reply.
    var transcript = ""

    struct Subagent {
        let id: String
        let type: String
        /// Its own model, from its own transcript, once it has replied.
        var model = ""
        /// When its transcript was last read for that model.
        var lookedForModelAt: Date?
    }

    init(id: String, agent: Agent, folder: String, project: String, startedAt: Double) {
        self.id = id
        self.agent = agent
        self.folder = folder
        self.project = project
        self.startedAt = startedAt
    }

    var name: String { Session.lastPart(of: folder) }
    var projectName: String { Session.lastPart(of: project) }

    private static func lastPart(of path: String) -> String {
        let last = (path as NSString).lastPathComponent
        return last.isEmpty ? path : last
    }

    /// Typing into a busy session would land in the middle of its turn.
    var isBusy: Bool { state == .thinking || state == .asking }

    /// What the agent is doing right now, in a few words, or nil when it's
    /// doing nothing.
    var activity: String? {
        if compacting { return "Compacting the conversation" }
        switch state {
        case .thinking:
            return toolActivity.isEmpty ? "Thinking" : toolActivity
        case .asking:
            if !waitingFor.isEmpty { return Activity.cut("Waiting for you: \(waitingFor)") }
            return toolActivity.isEmpty ? "Waiting for you" : toolActivity
        default:
            return nil
        }
    }

    func clearTool() {
        tool = ""
        toolUseID = ""
        toolActivity = ""
        waitingFor = ""
    }

    /// A turn is over: nothing runs any more, except subagents of the types
    /// still working in the background.
    func endTurn(keepingSubagentsOf types: [String] = []) {
        clearTool()
        compacting = false
        turnStartedAt = nil
        var left = types
        subagents = subagents.filter { subagent in
            guard let i = left.firstIndex(of: subagent.type) else { return false }
            left.remove(at: i)
            return true
        }
    }
}

/// Every agent session reporting in, kept current from its hook events, in
/// Claude Code's words: see `Agent.canonical(_:)`.
///
/// Hooks only say what just happened, so a session's state is whatever the
/// last meaningful event implied. Hooks also run in the background, so two
/// events a few milliseconds apart can arrive in either order; each carries
/// the time it was raised, and an event older than the last one applied is
/// ignored. The same goes for a session that has ended: its stragglers must
/// not bring it back.
final class Sessions {
    private var byID: [String: Session] = [:]
    /// When each ended or replaced session ended. A resumed session raises
    /// events after that time and is welcome back; a late one does not.
    private var endedAt: [String: Double] = [:]
    var onChange: () -> Void = {}

    /// Oldest first, so a session keeps its place as others come and go.
    var all: [Session] { byID.values.sorted { $0.startedAt < $1.startedAt } }

    subscript(id: String) -> Session? { byID[id] }

    func contains(_ state: SessionState) -> Bool { byID.values.contains { $0.state == state } }

    /// `startedIn` is the folder the agent was started in, when the hook
    /// knows it: an event's cwd is wherever the agent is now.
    func apply(_ event: [String: Any], agent: Agent, tty: String, startedIn: String, at time: Double) {
        guard let id = event["session_id"] as? String, let name = event["hook_event_name"] as? String else { return }
        let folder = event["cwd"] as? String ?? ""

        if let end = endedAt[id], time <= end { return }
        if name == "SessionEnd" {
            end(id, at: time)
            onChange()
            return
        }

        // A session the deck can't find a Terminal tab for would be a key
        // that lights up but can't be controlled.
        guard byID[id] != nil || !tty.isEmpty else { return }
        let session = byID[id] ?? adopt(id: id, agent: agent, folder: folder, startedIn: startedIn, tty: tty, at: time)
        // Subagents come and go by id, so the order their events arrive in
        // doesn't matter.
        let tracked = trackSubagents(name, event, of: session)
        let dressed = dressSubagent(event, of: session)
        let subagentsChanged = tracked || dressed
        guard time >= session.lastEventAt else {
            if subagentsChanged { onChange() }
            return
        }
        session.lastEventAt = time
        if !folder.isEmpty { session.folder = folder }
        if !tty.isEmpty { session.tty = tty }
        if let effort = event["effort"] as? [String: Any], let level = effort["level"] as? String {
            session.effort = level
        }
        followModel(name, event, of: session)
        follow(name, event, in: session, at: time)
        if let next = transition(for: name, event: event) {
            session.state = next
            if next != .error { session.errorKind = "" }
        }
        onChange()
    }

    /// A new session. One tab runs one agent, so a new session on a tty that
    /// already has one is that agent after /clear, or a fresh one in the same
    /// tab: it replaces the old session and inherits its place on the deck,
    /// and its project when the hook doesn't say.
    private func adopt(id: String, agent: Agent, folder: String, startedIn: String, tty: String, at time: Double) -> Session {
        let previous = tty.isEmpty ? nil : byID.values.first(where: { $0.tty == tty })
        let project = startedIn.isEmpty ? previous?.project ?? Sessions.project(startedIn: folder)
                                        : Sessions.project(startedIn: startedIn)
        let session = Session(id: id, agent: agent, folder: folder, project: project, startedAt: time)
        if let previous {
            session.startedAt = previous.startedAt
            session.effort = previous.effort
            session.model = previous.model
            end(previous.id, at: time)
        }
        byID[id] = session
        return session
    }

    /// The project of a session started in `folder`: the top folder of the
    /// git repository holding it, or the folder itself. The home folder is
    /// never a project's top, even when it holds a repository of its own.
    static func project(startedIn folder: String) -> String {
        let home = Paths.home.standardizedFileURL.path
        var url = URL(fileURLWithPath: folder).standardizedFileURL
        while url.path != home && url.path != "/" {
            if FileManager.default.fileExists(atPath: url.appendingPathComponent(".git").path) { return url.path }
            url.deleteLastPathComponent()
        }
        return folder
    }

    /// Claude Code's subagents, which the office shows at their agent's desk.
    private func trackSubagents(_ name: String, _ event: [String: Any], of session: Session) -> Bool {
        guard name == "SubagentStart" || name == "SubagentStop", let id = event["agent_id"] as? String else { return false }
        if name == "SubagentStop" {
            session.stoppedSubagents.insert(id)
            let before = session.subagents.count
            session.subagents.removeAll { $0.id == id }
            return session.subagents.count != before
        }
        guard !session.stoppedSubagents.contains(id), !session.subagents.contains(where: { $0.id == id }) else { return false }
        session.subagents.append(.init(id: id, type: event["agent_type"] as? String ?? ""))
        return true
    }

    /// The model the session runs. Claude Code names it when the session
    /// starts, though not always, and a /model can change it, so each turn's
    /// end also reads it from the latest reply in the transcript.
    private func followModel(_ name: String, _ event: [String: Any], of session: Session) {
        guard event["agent_id"] == nil else { return }
        if let path = event["transcript_path"] as? String, !path.isEmpty { session.transcript = path }
        if let model = event["model"] as? String, !model.isEmpty {
            session.model = model
        } else if name == "Stop" || (name == "SessionStart" && session.model.isEmpty),
                  let model = Transcripts.lastModel(in: session.transcript) {
            session.model = model
        }
    }

    /// How often a subagent's transcript may be read for its model: a busy
    /// subagent raises several events a second, and each would read the file.
    private static let modelLookInterval: TimeInterval = 1

    /// A subagent's model, which no hook names: it's in the first reply of the
    /// subagent's own transcript, kept beside its agent's. Looked for with its
    /// events until found, at most once a second.
    private func dressSubagent(_ event: [String: Any], of session: Session) -> Bool {
        guard let id = event["agent_id"] as? String, !session.transcript.isEmpty,
              let i = session.subagents.firstIndex(where: { $0.id == id }), session.subagents[i].model.isEmpty else { return false }
        let now = Date()
        if let last = session.subagents[i].lookedForModelAt, now.timeIntervalSince(last) < Sessions.modelLookInterval { return false }
        session.subagents[i].lookedForModelAt = now
        let folder = (session.transcript as NSString).deletingPathExtension
        guard let model = Transcripts.firstModel(in: "\(folder)/subagents/agent-\(id).jsonl") else { return false }
        session.subagents[i].model = model
        return true
    }

    /// What the office shows besides the state: the tool running and what
    /// it's doing, a compaction, when the turn started and why it failed.
    private func follow(_ name: String, _ event: [String: Any], in session: Session, at time: Double) {
        // A subagent's tools are its own: its agent is still on the call
        // that started it.
        let isAgentsOwn = event["agent_id"] == nil
        switch name {
        case "UserPromptSubmit":
            session.turnStartedAt = time
            session.stoppedSubagents = []
            session.clearTool()
            // A compaction that never said it ended is over by now.
            session.compacting = false
        case "PreToolUse" where isAgentsOwn:
            let tool = event["tool_name"] as? String ?? ""
            session.tool = tool
            session.toolUseID = event["tool_use_id"] as? String ?? ""
            session.toolActivity = Activity.of(tool: tool, input: event["tool_input"] as? [String: Any] ?? [:])
            session.waitingFor = ""
        case "PostToolUse", "PostToolUseFailure":
            session.waitingFor = ""
            let call = event["tool_use_id"] as? String ?? ""
            if isAgentsOwn && (call.isEmpty || session.toolUseID.isEmpty || call == session.toolUseID) {
                session.clearTool()
            }
        case "PermissionRequest":
            session.waitingFor = event["tool_name"] as? String ?? ""
        case "PreCompact":
            session.compacting = true
        case "PostCompact":
            session.compacting = false
        case "SessionStart":
            let source = event["source"] as? String
            if source == "compact" { session.compacting = false }
            if source == "startup" || source == "clear" { session.endTurn() }
        case "Stop":
            // Subagents sent to the background outlive the turn.
            let background = (event["background_tasks"] as? [[String: Any]] ?? [])
                .filter { $0["type"] as? String == "subagent" }
                .compactMap { $0["agent_type"] as? String }
            session.endTurn(keepingSubagentsOf: background)
        case "StopFailure":
            session.endTurn()
            session.errorKind = event["error"] as? String ?? ""
        case "Interrupt":
            session.endTurn()
        default:
            break
        }
    }

    private func end(_ id: String, at time: Double) {
        byID[id] = nil
        endedAt[id] = time
        // Stragglers arrive within seconds; an hour is plenty to remember.
        let cutoff = time - 3_600_000
        endedAt = endedAt.filter { $0.value > cutoff }
    }

    private func transition(for name: String, event: [String: Any]) -> SessionState? {
        switch name {
        case "SessionStart":
            // A resume or compaction is the same conversation carrying on.
            let source = event["source"] as? String
            return source == "startup" || source == "clear" ? .idle : nil
        case "UserPromptSubmit":
            return .thinking
        case "PreToolUse":
            return event["tool_name"] as? String == "AskUserQuestion" ? .asking : .thinking
        case "PermissionRequest":
            return .asking
        case "PostToolUse", "PostToolUseFailure":
            return .thinking
        case "Notification":
            return Sessions.isWaitingOnUser(event) ? .asking : nil
        case "Stop":
            return .unread
        case "StopFailure":
            return .error
        case "Interrupt":
            return .idle
        default:
            return nil
        }
    }

    private static let waitingNotifications: Set<String> = [
        "permission_prompt", "elicitation_dialog", "elicitation_url_dialog", "agent_needs_input",
    ]

    private static func isWaitingOnUser(_ event: [String: Any]) -> Bool {
        if let type = event["notification_type"] as? String { return waitingNotifications.contains(type) }
        return (event["message"] as? String)?.localizedCaseInsensitiveContains("permission") ?? false
    }

    /// Looking at a finished session's tab turns it from green back to white.
    func markSeen(tty: String) {
        var changed = false
        for session in byID.values where session.tty == tty && session.state == .unread {
            session.state = .idle
            changed = true
        }
        if changed { onChange() }
    }

    /// Drops sessions on ttys whose tab has closed. An agent killed along
    /// with its tab never sends SessionEnd.
    func prune(closedTTYs: Set<String>) {
        let gone = byID.values.filter { closedTTYs.contains($0.tty) }
        guard !gone.isEmpty else { return }
        let now = Date().timeIntervalSince1970 * 1000
        for session in gone { end(session.id, at: now) }
        onChange()
    }
}

/// Claude Code's transcripts: a line of JSON for each message, and each reply
/// names the model that wrote it. Only that name is read, from the end of a
/// conversation or the start of a subagent's.
enum Transcripts {
    /// How much of a transcript is read: replies are short lines, but a tool's
    /// output between them can be long.
    private static let reach: UInt64 = 256 * 1024

    static func lastModel(in path: String) -> String? {
        lines(of: path, fromEnd: true).reversed().lazy.compactMap(model(of:)).first
    }

    static func firstModel(in path: String) -> String? {
        lines(of: path, fromEnd: false).lazy.compactMap(model(of:)).first
    }

    private static func lines(of path: String, fromEnd: Bool) -> [Data] {
        guard !path.isEmpty, let file = FileHandle(forReadingAtPath: path) else { return [] }
        defer { try? file.close() }
        let size = (try? file.seekToEnd()) ?? 0
        let start = fromEnd && size > reach ? size - reach : 0
        guard (try? file.seek(toOffset: start)) != nil, let data = try? file.read(upToCount: Int(reach)) else { return [] }
        var lines = data.split(separator: 0x0A)
        // A line cut off by where the reading starts or stops is no use.
        if start > 0, !lines.isEmpty { lines.removeFirst() }
        if start + UInt64(data.count) < size, !lines.isEmpty { lines.removeLast() }
        return lines.map { Data($0) }
    }

    private static func model(of line: Data) -> String? {
        guard let entry = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
              let message = entry["message"] as? [String: Any],
              let model = message["model"] as? String,
              // Claude Code's own notices, such as an API error, aren't a model's.
              !model.isEmpty, model != "<synthetic>" else { return nil }
        return model
    }
}
