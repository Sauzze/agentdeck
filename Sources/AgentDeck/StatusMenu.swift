import AppKit

/// The menu bar item: the deck's logo, with the number of sessions waiting on
/// you beside it.
final class StatusMenu: NSObject, NSMenuDelegate {
    private let deck: Deck
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var error: String?

    init(deck: Deck) {
        self.deck = deck
        super.init()
        item.button?.imagePosition = .imageLeading
        item.menu = NSMenu()
        item.menu?.delegate = self
        deck.onChange = { [weak self] in self?.update() }
        update()
    }

    func showPortInUse() {
        error = "Port \(Deck.port) is in use. Is SauzzeDeck Pro already running?"
        item.button?.image = NSImage(systemSymbolName: "exclamationmark.triangle", accessibilityDescription: error)
        item.button?.title = ""
    }

    private func update() {
        guard error == nil else { return }
        item.button?.image = StatusMenu.icon(for: Config.shared.logo)
        let waiting = deck.sessions.all.filter { $0.state == .asking }.count
        item.button?.title = waiting > 0 ? " \(waiting)" : ""
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()

        if let error {
            menu.addItem(withTitle: error, action: nil, keyEquivalent: "")
        } else {
            let count = deck.sessions.all.count
            menu.addItem(withTitle: count == 1 ? "1 agent session" : "\(count) agent sessions", action: nil, keyEquivalent: "")
        }
        menu.addItem(.separator())
        add(to: menu, "Open Setup…", #selector(openSetup))
        add(to: menu, "Pair a Phone…", #selector(pairPhone))
        if !deck.access.phones.all.isEmpty {
            add(to: menu, "Unpair All Phones…", #selector(unpairAll))
        }
        menu.addItem(.separator())
        let login = add(to: menu, "Open at Login", #selector(toggleLogin))
        login.state = LoginItem.isEnabled ? .on : .off
        menu.addItem(.separator())
        add(to: menu, "Quit SauzzeDeck Pro", #selector(quit), key: "q")
    }

    @discardableResult
    private func add(to menu: NSMenu, _ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let entry = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        entry.target = self
        return entry
    }

    @objc private func openSetup() { NSWorkspace.shared.open(Deck.setupURL) }

    @objc private func pairPhone() {
        NSWorkspace.shared.open(URL(string: Deck.setupURL.absoluteString + "#pair")!)
    }

    @objc private func unpairAll() {
        let alert = NSAlert()
        alert.messageText = "Unpair all phones?"
        alert.informativeText = "They stop working straight away. To use the deck again, pair each phone with a new code."
        alert.addButton(withTitle: "Unpair All")
        alert.addButton(withTitle: "Cancel")
        // A menu bar app is never active by itself, and the alert would open behind other windows.
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn { deck.unpairAll() }
    }

    @objc private func toggleLogin() { LoginItem.isEnabled.toggle() }

    @objc private func quit() { NSApp.terminate(nil) }

    /// Both are drawn as templates, so they follow the menu bar's colour.
    private static func icon(for logo: Logo) -> NSImage {
        switch logo {
        case .sauzze: return sauzzeIcon
        case .keys: return keysIcon
        }
    }

    /// The Sauzze mark, a disc with the S cut out of it, from the mark's own
    /// geometry on a 100 × 100 grid.
    private static let sauzzeIcon: NSImage = {
        let side: CGFloat = 16
        let image = NSImage(size: NSSize(width: side, height: side), flipped: true) { _ in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            context.scaleBy(x: side / 100, y: side / 100)
            context.fillEllipse(in: CGRect(x: 0, y: 0, width: 100, height: 100))
            let s = CGMutablePath()
            s.move(to: CGPoint(x: 67, y: 32))
            s.addCurve(to: CGPoint(x: 38, y: 27), control1: CGPoint(x: 67, y: 21), control2: CGPoint(x: 47, y: 17))
            s.addCurve(to: CGPoint(x: 52, y: 51), control1: CGPoint(x: 29, y: 37), control2: CGPoint(x: 40, y: 47))
            s.addCurve(to: CGPoint(x: 63, y: 75), control1: CGPoint(x: 64, y: 55), control2: CGPoint(x: 72, y: 66))
            s.addCurve(to: CGPoint(x: 30, y: 69), control1: CGPoint(x: 54, y: 83), control2: CGPoint(x: 34, y: 79))
            context.addPath(s)
            context.setBlendMode(.clear)
            context.setLineWidth(9)
            context.setLineCap(.round)
            context.strokePath()
            return true
        }
        image.isTemplate = true
        return image
    }()

    /// Six rounded keys, 3 × 2.
    private static let keysIcon: NSImage = {
        let image = NSImage(size: NSSize(width: 18, height: 14), flipped: false) { _ in
            let side: CGFloat = 4.6, gap: CGFloat = 1.6
            let top: CGFloat = (14 - (2 * side + gap)) / 2
            for row in 0..<2 {
                for col in 0..<3 {
                    let origin = NSPoint(x: 1 + CGFloat(col) * (side + gap), y: top + CGFloat(row) * (side + gap))
                    let rect = NSRect(origin: origin, size: NSSize(width: side, height: side))
                    NSBezierPath(roundedRect: rect, xRadius: 1.2, yRadius: 1.2).fill()
                }
            }
            return true
        }
        image.isTemplate = true
        return image
    }()
}
