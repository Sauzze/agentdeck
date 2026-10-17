import AppKit

/// The deck itself: the sessions, how they sit on the six keys, what the
/// phone's controls do to them, and the live feed of all that to phones.
final class Deck {
    static let port: UInt16 = 7710
    static var setupURL: URL { URL(string: "http://localhost:\(port)/setup")! }

    /// How often to look for a green key's tab coming to the front.
    private static let seenCheckInterval: TimeInterval = 1.5
    /// How often to look for tabs that closed without their session ending.
    private static let closedTabCheckInterval: TimeInterval = 10
    /// How often to ping idle event streams so they stay open.
    private static let pingInterval: TimeInterval = 20
    /// Claude stops listening by itself after two minutes.
    private static let voiceLimit: TimeInterval = 120
    /// Without Accessibility, posted keys vanish without a trace. The phone
    /// says so instead, since every update turns the permission off.
    private static let noKeyboard = "Keyboard access is off. Turn it on in setup, on your Mac."

    let access = Access()
    let sessions = Sessions()
    /// Called on every change, for the menu bar.
    var onChange: () -> Void = {}

    /// Each open stream, with the phone that opened it, so unpairing a phone
    /// can hang up on it at once.
    private var streams: [ObjectIdentifier: (phone: String, stream: EventStream)] = [:]
    /// The key each session was given, so it keeps it.
    private var keyOf: [String: Int] = [:]
    /// The tab recording started in, and when. One Mac, one microphone.
    private var micPress: (tty: String, at: Date)?
    private var checkingFront = false
    private var checkingTabs = false
    /// Ttys Terminal reported last time. Only these can be found closed:
    /// sessions in other terminal apps never appear here and are left alone.
    private var terminalTTYs = Set<String>()

    init() {
        sessions.onChange = { [weak self] in self?.changed() }

        Timer.scheduledTimer(withTimeInterval: Deck.seenCheckInterval, repeats: true) { [weak self] _ in
            self?.checkFrontTab()
        }
        Timer.scheduledTimer(withTimeInterval: Deck.closedTabCheckInterval, repeats: true) { [weak self] _ in
            self?.pruneClosedTabs()
        }
        Timer.scheduledTimer(withTimeInterval: Deck.pingInterval, repeats: true) { [weak self] _ in
            self?.streams.values.forEach { $0.stream.ping() }
        }
    }

    // MARK: Addresses

    /// What a phone on the same network opens to pair.
    var phoneAddress: String { "http://\(LocalNetwork.address() ?? "localhost"):\(Deck.port)" }

    /// What the QR code opens: the pairing page with `code` filled in.
    func pairingLink(for code: String) -> String { "\(phoneAddress)/?pair=\(code)" }

    // MARK: Hook events

    /// `reported` is the agent the hook script was set up for; see
    /// `Agent.of(_:reportedAs:)` for why that isn't always the sender.
    func ingest(_ event: [String: Any], reportedAs reported: String, tty: String, startedIn: String, at time: Double) {
        let agent = Agent.of(event, reportedAs: reported)
        guard let event = agent.canonical(event) else { return }
        sessions.apply(event, agent: agent, tty: tty.isEmpty ? tab(for: event, of: agent) : tty,
                       startedIn: startedIn, at: time)
    }

    /// Codex runs its hooks in a shared background service, so its events
    /// arrive with no tty. Its tab is the one running Codex in the session's
    /// folder, when exactly one does and no other session holds it already.
    /// A session the deck knows keeps the tab it was found in.
    private func tab(for event: [String: Any], of agent: Agent) -> String {
        guard let id = event["session_id"] as? String, sessions[id] == nil,
              let name = agent.processName, let folder = event["cwd"] as? String else { return "" }
        return Processes.tty(of: name, in: folder, excluding: Set(sessions.all.map(\.tty))) ?? ""
    }

    private func changed() {
        applyQueuedEffort()
        let state = snapshotJSON()
        streams.values.forEach { $0.stream.send(state) }
        onChange()
    }

    // MARK: Keys

    struct Key {
        let pin: String?
        var session: Session?
    }

    /// A pinned key shows its project's session when one is running and stays
    /// reserved when none is. Every other session gets a free key. With a fixed
    /// number of keys, a session keeps its key until it ends, so keys don't
    /// shuffle as sessions come and go. With Auto, the keys grow and shrink with
    /// the sessions, and those still running keep their order when one ends.
    /// Sessions beyond the last key have none until one frees up.
    func layout() -> (keys: [Key], overflow: [Session]) {
        let config = Config.shared
        var remaining = sessions.all
        let live = Set(remaining.map(\.id))
        keyOf = keyOf.filter { live.contains($0.key) }

        var fixed: Int?
        if case .fixed(let count) = config.layout.keys { fixed = count }
        var keys = config.pins.prefix(fixed ?? KeyCount.most).map { Key(pin: $0, session: nil) }

        func place(_ session: Session, at index: Int) {
            keys[index].session = session
            keyOf[session.id] = index
            remaining.removeAll { $0.id == session.id }
        }

        for i in keys.indices {
            guard let pin = keys[i].pin else { continue }
            let candidates = remaining.filter { $0.project == pin }
            if let match = candidates.first(where: { keyOf[$0.id] == i }) ?? candidates.first { place(match, at: i) }
        }
        if fixed != nil {
            for session in remaining {
                if let i = keyOf[session.id], i < keys.count, keys[i].pin == nil, keys[i].session == nil { place(session, at: i) }
            }
        } else {
            // Every pinned key, and a free one for each other session.
            let pinned = keys.filter { $0.pin != nil }.count
            let last = (keys.lastIndex { $0.pin != nil } ?? -1) + 1
            keys = Array(keys.prefix(min(max(1, last, pinned + remaining.count), KeyCount.most)))
            // In the order their keys had, so the grid shrinks without shuffling.
            let previous = { (session: Session) in self.keyOf[session.id] ?? KeyCount.most }
            remaining = remaining.enumerated()
                .sorted { (previous($0.element), $0.offset) < (previous($1.element), $1.offset) }
                .map(\.element)
        }
        for session in remaining {
            guard let free = keys.indices.first(where: { keys[$0].pin == nil && keys[$0].session == nil }) else { break }
            place(session, at: free)
        }
        // A session left without a key forgets the one it had, or it would
        // claim it back from the session that has it now.
        for session in remaining { keyOf[session.id] = nil }
        return (keys, remaining)
    }

    /// What the phone draws: the keys, the theme and the layout. No ttys or paths.
    func snapshotJSON() -> Data {
        let (keys, overflow) = layout()
        let state: [String: Any] = [
            "keys": keys.map { key -> [String: Any] in
                var entry: [String: Any] = ["pin": key.pin.map { ($0 as NSString).lastPathComponent } ?? NSNull()]
                if let s = key.session {
                    entry["session"] = [
                        "id": s.id, "name": s.name, "project": s.projectName, "state": s.state.rawValue,
                        "effort": s.pendingEffort.isEmpty ? s.effort : s.pendingEffort,
                        "pending": !s.pendingEffort.isEmpty,
                        "agent": s.agent.rawValue, "agentName": s.agent.name,
                        "dial": s.agent.hasEffortDial, "mic": s.agent.hasVoice,
                        "activity": s.activity ?? NSNull(),
                        "tool": s.tool.isEmpty ? NSNull() : s.tool,
                        "subagents": s.subagents.map { ["id": $0.id, "type": $0.type] },
                        "maxPressedAt": s.maxPressedAt.map { Int64($0) } ?? NSNull(),
                        "compacting": s.compacting,
                        "turnStartedAt": s.turnStartedAt.map { Int64($0) } ?? NSNull(),
                        "errorKind": s.errorKind.isEmpty ? NSNull() : s.errorKind,
                    ]
                }
                return entry
            },
            "overflow": overflow.count,
            // The Mac's clock, so the office can count turns on the phone's,
            // whichever of the two is right.
            "now": Int64(Date().timeIntervalSince1970 * 1000),
            "theme": Theme.current(),
            "scroll": Config.shared.scrollEnabled,
            // What the office's held desks offer: firing, and hiring once there's a folder to hire into.
            "hiring": [
                "fire": Config.shared.hiringEnabled,
                "hire": Config.shared.hiringEnabled && Deck.folder(Config.shared.hireFolder) != nil,
            ],
            "layout": Config.shared.layout.jsonObject,
        ]
        // Keys in order: unsorted, the same layout can come out differently
        // each time, and the phone would take it for a new one.
        return (try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys])) ?? Data()
    }

    func attach(_ stream: EventStream, phone: String) {
        let id = ObjectIdentifier(stream)
        streams[id] = (phone, stream)
        stream.onClose = { [weak self] in self?.streams[id] = nil }
        stream.send(snapshotJSON())
    }

    /// Re-sends the state, for changes the sessions do not see (the setup page's).
    func refresh() { changed() }

    // MARK: Phones

    func isConnected(_ phone: String) -> Bool {
        streams.values.contains { $0.phone == phone }
    }

    /// Forgets a phone and hangs up on it now, rather than at its next request.
    func unpair(_ phone: String) {
        access.phones.remove(phone)
        streams.values.filter { $0.phone == phone }.forEach { $0.stream.close() }
    }

    func unpairAll() {
        access.phones.removeAll()
        streams.values.forEach { $0.stream.close() }
    }

    // MARK: Controls

    static let effortLevels = ["low", "medium", "high", "xhigh", "max"]

    /// Runs one of the phone's controls on a session. Keys bring its tab
    /// forward, since they need it focused; typed commands do not.
    func perform(_ action: String, on id: String, query: [String: String], done: @escaping (Response) -> Void) {
        // Releasing the mic stops recording where it started, whatever is
        // selected now — and even if that session has since gone.
        if action == "mic" && query["phase"] != "down" { return releaseMic(done: done) }
        // A new hire has no session yet.
        if action == "hire" { return hire(done: done) }
        guard let session = sessions[id], !session.tty.isEmpty else { return done(.status(404, "Session not found")) }
        let tty = session.tty

        // Accept and send are both Return. They are separate controls on the
        // phone because they mean different things, as do reject and esc,
        // which are often both Escape but not in every agent.
        let agent = session.agent
        switch action {
        case "accept", "send": press(.init(key: .returnKey), tty: tty, done: done)
        case "reject": press(agent.reject, tty: tty, done: done)
        case "esc": press(agent.interrupt, tty: tty, done: done)
        case "up": press(.init(key: .up), tty: tty, done: done)
        case "down": press(.init(key: .down), tty: tty, done: done)
        case "scroll":
            guard Config.shared.scrollEnabled else {
                return done(.status(403, "Scrolling is off. Turn it on in setup, on your Mac."))
            }
            guard Permissions.hasAccessibility else { return done(.status(403, Deck.noKeyboard)) }
            if query["to"] == "bottom" { return inTab(tty, done: done) { Terminal.scrollToBottom(tty: tty) } }
            guard let lines = Int(query["lines"] ?? "") else { return done(.status(400, "Unknown amount")) }
            // The phone counts the way natural scrolling does. With it turned
            // off on the Mac, the wheel turns the other way, as everything else does.
            let direction = Scrolling.isNatural ? 1 : -1
            inTab(tty, done: done) { Terminal.scroll(lines: lines * direction, tty: tty) }
        case "mic":
            guard agent.hasVoice else { return done(.status(400, "\(agent.name) has no voice input")) }
            pressMic(session, done: done)
        case "fire":
            guard Config.shared.hiringEnabled else { return done(.status(403, Deck.hiringOff)) }
            onTerminal(done) { Terminal.close(tty: tty) }
        case "clear":
            guard !session.isBusy else { return done(.status(409, "Busy — clear it when \(agent.name) is done")) }
            onTerminal(done) { Terminal.type(agent.newConversation, tty: tty) }
        case "button":
            guard let button = Config.shared.layout.madeButton(query["button"] ?? "") else {
                return done(.status(404, "That button has gone. Your phone will catch up in a moment."))
            }
            if let agents = button.agents, !agents.contains(agent.rawValue) {
                return done(.status(400, "This button isn't for \(agent.name)"))
            }
            if button.whenFree == true && session.isBusy {
                return done(.status(409, "Busy — try again when \(agent.name) is done"))
            }
            if let key = button.key, let keystroke = Button.keys[key] { return press(keystroke, tty: tty, done: done) }
            guard let text = button.text, !text.isEmpty else {
                return done(.status(400, "This button types nothing yet. Set it up in setup, on your Mac."))
            }
            onTerminal(done) { Terminal.type(text, tty: tty) }
        case "effort":
            guard agent.hasEffortDial else { return done(.status(400, "\(agent.name) has no effort setting")) }
            guard let level = query["level"], Deck.effortLevels.contains(level) else { return done(.status(400, "Unknown level")) }
            // ☢ Max says so, where the dial reaching max doesn't: the office
            // only sends its agent to the button for a press.
            if query["source"] == "max" && level == "max" { session.maxPressedAt = Date().timeIntervalSince1970 * 1000 }
            session.pendingEffort = level == session.effort ? "" : level
            let queued = !session.pendingEffort.isEmpty && session.isBusy
            changed()
            done(.status(queued ? 202 : 204))
        default:
            done(.status(400, "Unknown action"))
        }
    }

    static let hiringOff = "Hiring and firing are off. Turn them on in setup, on your Mac."

    /// A new Terminal window in the folder set up for new hires, with the
    /// agent set up for them at work in it. Its hooks bring it to the deck,
    /// and the office, as for any session.
    private func hire(done: @escaping (Response) -> Void) {
        let config = Config.shared
        guard config.hiringEnabled else { return done(.status(403, Deck.hiringOff)) }
        guard let folder = Deck.folder(config.hireFolder) else {
            return done(.status(409, "Choose a folder for new hires in setup, on your Mac."))
        }
        let agent = Agent(rawValue: config.hireAgent) ?? .claude
        Terminal.queue.async {
            let ok = Terminal.open(agent.rawValue, in: folder)
            DispatchQueue.main.async { done(ok ? .status(204) : .status(500, "Terminal didn't open")) }
        }
    }

    /// `path` as a folder that's there, with ~ for home, or nil.
    static func folder(_ path: String) -> String? {
        let expanded = (path.trimmingCharacters(in: .whitespaces) as NSString).expandingTildeInPath
        var isFolder: ObjCBool = false
        guard expanded.hasPrefix("/"), FileManager.default.fileExists(atPath: expanded, isDirectory: &isFolder),
              isFolder.boolValue else { return nil }
        return (expanded as NSString).standardizingPath
    }

    /// Asks for the new hires' folder with the Mac's own panel, from the setup page.
    func chooseHireFolder(then done: @escaping () -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        panel.message = "New hires from the office start their work in this folder."
        if let current = Deck.folder(Config.shared.hireFolder) { panel.directoryURL = URL(fileURLWithPath: current) }
        NSApp.activate(ignoringOtherApps: true)
        panel.begin { response in
            if response == .OK, let url = panel.url {
                Config.shared.hireFolder = url.path
                Config.shared.save()
                self.refresh()
            }
            done()
        }
    }

    /// Push to talk through Claude's own /voice, in tap mode: Space starts
    /// listening, Space again stops and sends. Hold mode cannot be used — it
    /// detects a held key by its key-repeat, and a posted key never repeats.
    ///
    /// Every start is matched by exactly one stop. A second press while
    /// recording, or a release with nothing recording, is ignored: an extra
    /// Space would flip Claude's state and leave the two out of step.
    private func pressMic(_ session: Session, done: @escaping (Response) -> Void) {
        if let current = micPress, Date().timeIntervalSince(current.at) < Deck.voiceLimit {
            return done(.status(204))
        }
        micPress = (session.tty, Date())
        press(.init(key: .space), tty: session.tty) { [weak self] response in
            // Nothing started, so the release must not send a Space either.
            if response.status >= 400 { self?.micPress = nil }
            done(response)
        }
    }

    private func releaseMic(done: @escaping (Response) -> Void) {
        defer { micPress = nil }
        // After the limit Claude has stopped by itself, and a Space would
        // start it again.
        guard let started = micPress, Date().timeIntervalSince(started.at) < Deck.voiceLimit else {
            return done(.status(204))
        }
        press(.init(key: .space), tty: started.tty, done: done)
    }

    private func press(_ keystroke: Terminal.Keystroke, tty: String, done: @escaping (Response) -> Void) {
        guard Permissions.hasAccessibility else { return done(.status(403, Deck.noKeyboard)) }
        inTab(tty, done: done) {
            Terminal.press(keystroke.key, modifiers: keystroke.modifiers, times: keystroke.times, tty: tty)
        }
    }

    /// Runs `work`, which brings the tab on `tty` forward. A tab you have
    /// been shown counts as seen.
    private func inTab(_ tty: String, done: @escaping (Response) -> Void, _ work: @escaping () -> Bool) {
        onTerminal(done) {
            let reached = work()
            if reached { DispatchQueue.main.async { self.sessions.markSeen(tty: tty) } }
            return reached
        }
    }

    private func onTerminal(_ done: @escaping (Response) -> Void, _ work: @escaping () -> Bool) {
        Terminal.queue.async {
            let ok = work()
            DispatchQueue.main.async { done(ok ? .status(204) : .status(404, "Terminal tab not found")) }
        }
    }

    func focus(_ id: String, done: @escaping (Response) -> Void) {
        guard let tty = sessions[id]?.tty, !tty.isEmpty else { return done(.status(404)) }
        inTab(tty, done: done) { Terminal.focus(tty: tty) }
    }

    /// Typed into a running turn, /effort would be queued as a message, so it
    /// waits for the session to be free. No hook reports a slash command, so
    /// the new level is assumed; the next event's effort field corrects it.
    private func applyQueuedEffort() {
        for session in sessions.all where !session.pendingEffort.isEmpty && !session.isBusy {
            let level = session.pendingEffort
            let tty = session.tty
            session.pendingEffort = ""
            Terminal.queue.async {
                guard Terminal.type("/effort \(level)", tty: tty) else { return }
                DispatchQueue.main.async {
                    session.effort = level
                    self.changed()
                }
            }
        }
    }

    // MARK: Housekeeping

    /// Green means "finished, not looked at". While anything is green, watch
    /// for its tab coming to the front.
    private func checkFrontTab() {
        guard sessions.contains(.unread), !checkingFront else { return }
        checkingFront = true
        Terminal.queue.async {
            let tty = Terminal.frontTTY()
            DispatchQueue.main.async {
                self.checkingFront = false
                if let tty { self.sessions.markSeen(tty: tty) }
            }
        }
    }

    private func pruneClosedTabs() {
        guard !sessions.all.isEmpty, !checkingTabs else { return }
        checkingTabs = true
        Terminal.queue.async {
            let open = Terminal.openTTYs()
            DispatchQueue.main.async {
                self.checkingTabs = false
                guard let open else { return } // unknown is not the same as none
                self.sessions.prune(closedTTYs: self.terminalTTYs.subtracting(open))
                self.terminalTTYs = open
            }
        }
    }
}
