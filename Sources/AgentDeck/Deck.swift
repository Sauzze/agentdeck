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

    func ingest(_ event: [String: Any], tty: String, at time: Double) {
        sessions.apply(event, tty: tty, at: time)
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
    /// reserved when none is. Every other session gets the first free key and
    /// keeps it until it ends, so keys don't shuffle as sessions come and go.
    /// Sessions beyond six have no key until one frees up.
    func layout() -> (keys: [Key], overflow: [Session]) {
        var keys = Config.shared.pins.map { Key(pin: $0, session: nil) }
        var remaining = sessions.all
        let live = Set(remaining.map(\.id))
        keyOf = keyOf.filter { live.contains($0.key) }

        func place(_ session: Session, at index: Int) {
            keys[index].session = session
            keyOf[session.id] = index
            remaining.removeAll { $0.id == session.id }
        }

        for i in keys.indices {
            guard let pin = keys[i].pin else { continue }
            let candidates = remaining.filter { $0.folder == pin }
            if let match = candidates.first(where: { keyOf[$0.id] == i }) ?? candidates.first { place(match, at: i) }
        }
        for session in remaining {
            if let i = keyOf[session.id], keys[i].pin == nil, keys[i].session == nil { place(session, at: i) }
        }
        for session in remaining {
            guard let free = keys.indices.first(where: { keys[$0].pin == nil && keys[$0].session == nil }) else { break }
            place(session, at: free)
        }
        return (keys, remaining)
    }

    /// What the phone draws: the keys, and the theme. No ttys or paths.
    func snapshotJSON() -> Data {
        let (keys, overflow) = layout()
        let state: [String: Any] = [
            "keys": keys.map { key -> [String: Any] in
                var entry: [String: Any] = ["pin": key.pin.map { ($0 as NSString).lastPathComponent } ?? NSNull()]
                if let s = key.session {
                    entry["session"] = [
                        "id": s.id, "name": s.name, "state": s.state.rawValue,
                        "effort": s.pendingEffort.isEmpty ? s.effort : s.pendingEffort,
                        "pending": !s.pendingEffort.isEmpty,
                    ]
                }
                return entry
            },
            "overflow": overflow.count,
            "theme": Theme.current(),
            "scroll": Config.shared.scrollEnabled,
        ]
        return (try? JSONSerialization.data(withJSONObject: state)) ?? Data()
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
        guard let session = sessions[id], !session.tty.isEmpty else { return done(.status(404, "Session not found")) }
        let tty = session.tty

        // Accept and send are both Return, reject and esc both Escape. They are
        // separate controls on the phone because they mean different things.
        switch action {
        case "accept", "send": press(.returnKey, tty: tty, done: done)
        case "reject", "esc": press(.escape, tty: tty, done: done)
        case "up": press(.up, tty: tty, done: done)
        case "down": press(.down, tty: tty, done: done)
        case "scroll":
            guard Config.shared.scrollEnabled else {
                return done(.status(403, "Scrolling is off. Turn it on in setup, on your Mac."))
            }
            if query["to"] == "bottom" { return inTab(tty, done: done) { Terminal.scrollToBottom(tty: tty) } }
            guard let lines = Int(query["lines"] ?? "") else { return done(.status(400, "Unknown amount")) }
            inTab(tty, done: done) { Terminal.scroll(lines: lines, tty: tty) }
        case "mic": pressMic(session, done: done)
        case "clear":
            guard !session.isBusy else { return done(.status(409, "Busy — clear it when Claude is done")) }
            onTerminal(done) { Terminal.type("/clear", tty: tty) }
        case "effort":
            guard let level = query["level"], Deck.effortLevels.contains(level) else { return done(.status(400, "Unknown level")) }
            session.pendingEffort = level == session.effort ? "" : level
            let queued = !session.pendingEffort.isEmpty && session.isBusy
            changed()
            done(.status(queued ? 202 : 204))
        default:
            done(.status(400, "Unknown action"))
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
        press(.space, tty: session.tty, done: done)
    }

    private func releaseMic(done: @escaping (Response) -> Void) {
        defer { micPress = nil }
        // After the limit Claude has stopped by itself, and a Space would
        // start it again.
        guard let started = micPress, Date().timeIntervalSince(started.at) < Deck.voiceLimit else {
            return done(.status(204))
        }
        press(.space, tty: started.tty, done: done)
    }

    private func press(_ key: Terminal.Key, tty: String, done: @escaping (Response) -> Void) {
        inTab(tty, done: done) { Terminal.press(key, tty: tty) }
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
