import AppKit

/// AgentDeck's menu bar item: a small grid of six keys, with the number of
/// sessions waiting on you beside it.
final class StatusMenu: NSObject, NSMenuDelegate {
    private let deck: Deck
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var error: String?

    init(deck: Deck) {
        self.deck = deck
        super.init()
        item.button?.image = StatusMenu.icon
        item.button?.imagePosition = .imageLeading
        item.menu = NSMenu()
        item.menu?.delegate = self
        deck.onChange = { [weak self] in self?.updateTitle() }
    }

    func showPortInUse() {
        error = "Port \(Deck.port) is in use. Is AgentDeck already running?"
        item.button?.image = NSImage(systemSymbolName: "exclamationmark.triangle", accessibilityDescription: error)
        item.button?.title = ""
    }

    private func updateTitle() {
        guard error == nil else { return }
        let waiting = deck.sessions.all.filter { $0.state == .asking }.count
        item.button?.title = waiting > 0 ? " \(waiting)" : ""
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()

        if let error {
            menu.addItem(withTitle: error, action: nil, keyEquivalent: "")
        } else {
            let count = deck.sessions.all.count
            menu.addItem(withTitle: count == 1 ? "1 Claude session" : "\(count) Claude sessions", action: nil, keyEquivalent: "")
        }
        menu.addItem(.separator())
        add(to: menu, "Open Setup…", #selector(openSetup))
        add(to: menu, "Pair a Phone…", #selector(pairPhone))
        add(to: menu, "Copy Phone Link", #selector(copyLink))
        menu.addItem(.separator())
        let login = add(to: menu, "Open at Login", #selector(toggleLogin))
        login.state = LoginItem.isEnabled ? .on : .off
        menu.addItem(.separator())
        add(to: menu, "Quit AgentDeck", #selector(quit), key: "q")
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

    @objc private func copyLink() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(deck.phoneLink, forType: .string)
    }

    @objc private func toggleLogin() { LoginItem.isEnabled.toggle() }

    @objc private func quit() { NSApp.terminate(nil) }

    /// Six rounded keys, 3 × 2, drawn as a template so it follows the menu bar's colour.
    private static let icon: NSImage = {
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
