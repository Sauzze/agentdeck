import AppKit

@main
enum AgentDeckApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory) // menu bar only, no Dock icon
        app.run()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let deck = Deck()
    private lazy var menu = StatusMenu(deck: deck)
    private lazy var server = HTTPServer(port: Deck.port, router: DeckRouter(deck: deck))

    func applicationDidFinishLaunching(_ notification: Notification) {
        try? Hooks.refresh()
        LoginItem.refresh()
        server.onFailure = { [menu] _ in menu.showPortInUse() }
        do {
            try server.start()
        } catch {
            menu.showPortInUse()
            return
        }

        if !Config.shared.hasCompletedSetup {
            NSWorkspace.shared.open(Deck.setupURL)
        }
    }

    /// Opening the app while it runs — from Finder, Spotlight or Launchpad —
    /// would otherwise do nothing visible, since it has no windows.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        NSWorkspace.shared.open(Deck.setupURL)
        return false
    }
}
