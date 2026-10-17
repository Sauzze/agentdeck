import Foundation

/// Where AgentDeck reads and writes. Its own state lives in
/// ~/Library/Application Support/AgentDeck, so the app can be moved or
/// replaced without losing the paired phones or the deck's layout.
enum Paths {
    static let support: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("AgentDeck", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    static let phones = support.appendingPathComponent("phones.json")
    static let config = support.appendingPathComponent("config.json")
    /// The sessions running, and their keys, kept across a restart.
    static let sessions = support.appendingPathComponent("sessions.json")
    static let hookScript = support.appendingPathComponent("report.sh")
    /// The hook's key, as the header curl sends: see `Access`.
    static let hookHeader = support.appendingPathComponent("hook-header")
    /// 1.0's single key, shared by the phone and the hook. Deleted at launch.
    static let legacyToken = support.appendingPathComponent("token")

    static let home = FileManager.default.homeDirectoryForCurrentUser
    static let claudeSettings = home.appendingPathComponent(".claude/settings.json")
    static let codexHooks = home.appendingPathComponent(".codex/hooks.json")
    static let geminiSettings = home.appendingPathComponent(".gemini/settings.json")
    static let grokHooks = home.appendingPathComponent(".grok/hooks/sauzzedeck-pro.json")
    static let openCodePlugin = home.appendingPathComponent(".config/opencode/plugins/sauzzedeck-pro.js")
    static let launchAgent = home.appendingPathComponent("Library/LaunchAgents/\(LoginItem.label).plist")
    /// Where macOS finds screen savers installed for you alone.
    static let installedScreenSaver = home.appendingPathComponent("Library/Screen Savers/SauzzeDeck Office.saver")

    /// The phone and setup pages, bundled inside the app.
    static let web = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
    static let bundledHookScript = Bundle.main.resourceURL!.appendingPathComponent("report.sh")
    static let bundledOpenCodePlugin = Bundle.main.resourceURL!.appendingPathComponent("opencode-plugin.js")
    static let bundledScreenSaver = Bundle.main.resourceURL!.appendingPathComponent("SauzzeDeck Office.saver")
}
