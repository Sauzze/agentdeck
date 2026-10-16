import Foundation

/// Where AgentDeck reads and writes. Its own state lives in
/// ~/Library/Application Support/AgentDeck, so the app can be moved or
/// replaced without losing the phone's pairing or the deck's layout.
enum Paths {
    static let support: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("AgentDeck", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    static let token = support.appendingPathComponent("token")
    static let config = support.appendingPathComponent("config.json")
    static let hookScript = support.appendingPathComponent("report.sh")

    static let home = FileManager.default.homeDirectoryForCurrentUser
    static let claudeSettings = home.appendingPathComponent(".claude/settings.json")
    static let claudeSettingsBackup = home.appendingPathComponent(".claude/settings.json.agentdeck.bak")
    static let launchAgent = home.appendingPathComponent("Library/LaunchAgents/\(LoginItem.label).plist")

    /// The phone and setup pages, bundled inside the app.
    static let web = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
    static let bundledHookScript = Bundle.main.resourceURL!.appendingPathComponent("report.sh")
}
