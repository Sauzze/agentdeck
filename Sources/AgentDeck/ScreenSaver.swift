import AppKit

/// The screen saver inside the app, which shows the office while the Mac is
/// idle: see ScreenSaver/. Installing it copies it where macOS looks for
/// screen savers of yours alone, and the rest happens in System Settings.
enum ScreenSaver {
    /// System Settings → Screen Saver.
    private static let settings = URL(string: "x-apple.systempreferences:com.apple.ScreenSaver-Settings.extension")!

    /// Copies it in, replacing an older copy, and opens System Settings to choose it.
    static func install() throws {
        let files = FileManager.default
        let installed = Paths.installedScreenSaver
        try files.createDirectory(at: installed.deletingLastPathComponent(), withIntermediateDirectories: true)
        if files.fileExists(atPath: installed.path) { try files.removeItem(at: installed) }
        try files.copyItem(at: Paths.bundledScreenSaver, to: installed)
        unquarantine(installed)
        NSWorkspace.shared.open(settings)
    }

    /// A downloaded app passes the download's quarantine on to anything
    /// copied out of it, and macOS won't load a screen saver that has it.
    /// This one is the app's own, which you have already let open.
    private static func unquarantine(_ bundle: URL) {
        let attribute = "com.apple.quarantine"
        removexattr(bundle.path, attribute, XATTR_NOFOLLOW)
        for case let file as URL in FileManager.default.enumerator(at: bundle, includingPropertiesForKeys: nil) ?? .init() {
            removexattr(file.path, attribute, XATTR_NOFOLLOW)
        }
    }
}
