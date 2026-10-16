import Foundation

/// What a Claude session is doing, as the keys show it.
enum SessionState: String {
    case idle      // white: nothing running, or finished and already seen
    case thinking  // blue: a turn is running
    case asking    // orange: waiting on you — a permission prompt or a question
    case unread    // green: finished, not looked at yet
    case error     // red: the turn ended on an API error
}

final class Session {
    let id: String
    var folder: String
    var tty = ""
    var state = SessionState.idle
    var effort = ""
    /// An effort change waiting for the session to be free.
    var pendingEffort = ""
    var startedAt: Double
    var lastEventAt: Double = 0

    init(id: String, folder: String, startedAt: Double) {
        self.id = id
        self.folder = folder
        self.startedAt = startedAt
    }

    var name: String {
        let last = (folder as NSString).lastPathComponent
        return last.isEmpty ? folder : last
    }

    /// Typing into a busy session would land in the middle of its turn.
    var isBusy: Bool { state == .thinking || state == .asking }
}

/// Every Claude session reporting in, kept current from its hook events.
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

    func apply(_ event: [String: Any], tty: String, at time: Double) {
        guard let id = event["session_id"] as? String, let name = event["hook_event_name"] as? String else { return }
        let folder = event["cwd"] as? String ?? ""

        if let end = endedAt[id], time <= end { return }
        if name == "SessionEnd" {
            end(id, at: time)
            onChange()
            return
        }

        let session = byID[id] ?? adopt(id: id, folder: folder, tty: tty, at: time)
        guard time >= session.lastEventAt else { return }
        session.lastEventAt = time
        if !folder.isEmpty { session.folder = folder }
        if !tty.isEmpty { session.tty = tty }
        if let effort = event["effort"] as? [String: Any], let level = effort["level"] as? String {
            session.effort = level
        }
        if let next = transition(for: name, event: event) { session.state = next }
        onChange()
    }

    /// A new session. One tab runs one claude, so a new session on a tty that
    /// already has one is that claude after /clear, or a fresh one in the same
    /// tab: it replaces the old session and inherits its place on the deck.
    private func adopt(id: String, folder: String, tty: String, at time: Double) -> Session {
        let session = Session(id: id, folder: folder, startedAt: time)
        if !tty.isEmpty, let previous = byID.values.first(where: { $0.tty == tty }) {
            session.startedAt = previous.startedAt
            session.effort = previous.effort
            end(previous.id, at: time)
        }
        byID[id] = session
        return session
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

    /// Drops sessions on ttys whose tab has closed. A claude killed along with
    /// its tab never sends SessionEnd.
    func prune(closedTTYs: Set<String>) {
        let gone = byID.values.filter { closedTTYs.contains($0.tty) }
        guard !gone.isEmpty else { return }
        let now = Date().timeIntervalSince1970 * 1000
        for session in gone { end(session.id, at: now) }
        onChange()
    }
}
