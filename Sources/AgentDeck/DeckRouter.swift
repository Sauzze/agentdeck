import AppKit

/// Every URL the deck answers.
///
/// - The phone's pages and API need the token, sent as `?t=` (the page's own
///   URL, so a home-screen bookmark keeps it) or as `X-AgentDeck-Token`
///   (the Claude Code hook). They must also be addressed to an IP address or
///   a local name, which keeps out web pages using DNS rebinding.
/// - Pairing is open, but useless without a code you asked for on this Mac.
/// - The setup page has no token, so it answers only to this Mac, and its
///   actions need a header that other sites cannot send without asking first.
final class DeckRouter: Router {
    /// Sent by the setup page with every action. A custom header makes the
    /// browser ask permission first for any cross-site request, which this
    /// server never grants — so a web page you visit cannot press these buttons.
    static let setupHeader = "x-agentdeck-setup"

    private let deck: Deck

    init(deck: Deck) {
        self.deck = deck
    }

    func handle(_ request: Request, reply: @escaping (Reply) -> Void) {
        let respond = { reply(.response($0)) }

        // Fetched by iOS itself for the home-screen icon, with no token to send.
        if request.path == "/icon.png" {
            return respond(.file(Paths.web.appendingPathComponent("icon.png")))
        }

        if request.path == "/setup" || request.path.hasPrefix("/setup/") {
            guard request.isLocal else { return respond(.status(404)) }
            guard request.method == "GET" || request.headers[DeckRouter.setupHeader] == "1" else {
                return respond(.status(403))
            }
            return setup(request, respond: respond)
        }

        guard request.isAddressedDirectly else { return respond(.status(403)) }

        if request.method == "POST" && request.path == "/pair" {
            let code = (request.json["code"] as? String ?? "").filter(\.isNumber)
            guard let token = deck.access.redeem(code) else {
                let message = "That code isn't valid. Get a new one on your Mac."
                return respond(.json(["error": message], status: 403))
            }
            return respond(.json(["token": token]))
        }

        let authorised = deck.access.isValid(request.query["t"] ?? request.headers["x-agentdeck-token"])

        if request.method == "GET" && request.path == "/" {
            return respond(.file(Paths.web.appendingPathComponent(authorised ? "deck.html" : "pair.html")))
        }
        guard authorised else { return respond(.status(401)) }

        let session = request.query["session"] ?? ""
        switch (request.method, request.path) {
        case ("POST", "/hook"):
            let time = Double(request.headers["x-agentdeck-at"] ?? "") ?? Date().timeIntervalSince1970 * 1000
            deck.ingest(request.json, tty: request.headers["x-agentdeck-tty"] ?? "", at: time)
            respond(.status(204))

        case ("GET", "/events"):
            reply(.eventStream { [deck] in deck.attach($0) })

        case ("GET", "/cursor"):
            reply(.webSocket { [deck] socket in socket.onText = deck.pointer.handle })

        case ("POST", "/focus"):
            deck.focus(session, done: respond)

        case ("POST", "/act"):
            deck.perform(request.query["action"] ?? "", on: session, query: request.query, done: respond)

        default:
            respond(.status(404))
        }
    }

    // MARK: Setup page

    private func setup(_ request: Request, respond: @escaping (Response) -> Void) {
        let config = Config.shared

        switch (request.method, request.path) {
        case ("GET", "/setup"):
            if !config.hasCompletedSetup {
                config.hasCompletedSetup = true
                config.save()
            }
            respond(.file(Paths.web.appendingPathComponent("setup.html")))

        case ("GET", "/setup/state"):
            respond(.json(setupState()))

        case ("GET", "/setup/qr.png"):
            respond(Response(contentType: "image/png", body: QRCode.png(for: deck.phoneLink) ?? Data()))

        case ("POST", "/setup/pair"):
            deck.access.newCode()
            respond(.json(setupState()))

        case ("POST", "/setup/pin"):
            guard let index = keyIndex(request), let folder = request.query["folder"], !folder.isEmpty else {
                return respond(.status(400))
            }
            config.pin(folder, to: index)
            deck.refresh()
            respond(.status(204))

        case ("POST", "/setup/unpin"):
            guard let index = keyIndex(request) else { return respond(.status(400)) }
            config.unpin(index)
            deck.refresh()
            respond(.status(204))

        case ("POST", "/setup/theme"):
            config.colours = Theme.customisations(from: request.json)
            config.save()
            deck.refresh()
            respond(.status(204))

        case ("POST", "/setup/hooks"):
            do {
                if request.query["remove"] == nil {
                    try ClaudeHooks.install()
                } else {
                    try ClaudeHooks.uninstall()
                }
                respond(.json(setupState()))
            } catch {
                respond(.status(500, error.localizedDescription))
            }

        case ("POST", "/setup/accessibility"):
            Permissions.requestAccessibility()
            respond(.status(204))

        case ("POST", "/setup/login"):
            LoginItem.isEnabled = request.query["enabled"] == "1"
            respond(.json(setupState()))

        default:
            respond(.status(404))
        }
    }

    private func keyIndex(_ request: Request) -> Int? {
        guard let index = Int(request.query["key"] ?? ""), Config.shared.pins.indices.contains(index) else { return nil }
        return index
    }

    private func setupState() -> [String: Any] {
        let (keys, _) = deck.layout()
        var keyOf: [String: Int] = [:]
        for (index, key) in keys.enumerated() {
            if let session = key.session { keyOf[session.id] = index }
        }

        var phone: [String: Any] = ["address": deck.phoneAddress, "codeExpiresIn": 0]
        if let code = deck.access.activeCode {
            phone["code"] = code
            phone["codeExpiresIn"] = Int(deck.access.codeExpiry.timeIntervalSinceNow)
        }

        return [
            "checklist": [
                "hooks": ClaudeHooks.isInstalled,
                "accessibility": Permissions.hasAccessibility,
                "openAtLogin": LoginItem.isEnabled,
            ],
            "phone": phone,
            "pins": Config.shared.pins.map { pin -> Any in
                guard let pin else { return NSNull() }
                return ["folder": pin, "name": (pin as NSString).lastPathComponent]
            },
            "sessions": deck.sessions.all.map { session -> [String: Any] in
                [
                    "id": session.id, "folder": session.folder, "name": session.name,
                    "state": session.state.rawValue, "key": keyOf[session.id] ?? NSNull(),
                ]
            },
            "theme": Theme.editorJSON(),
        ]
    }
}
