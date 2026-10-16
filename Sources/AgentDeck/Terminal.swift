import AppKit

/// Terminal.app: finding a session's tab, bringing it forward, typing into it.
///
/// A tab is identified by its tty. Terminal reports one for every tab and the
/// hook reports the one claude runs on, so they meet on an exact string —
/// window and tab indexes shift as tabs move, a tty does not.
///
/// AppleScript runs through osascript, one call at a time on `queue`, so a slow
/// script never holds up the menu bar or the server. Every script checks that
/// Terminal is running first, because asking a closed Terminal anything
/// launches it.
enum Terminal {
    static let queue = DispatchQueue(label: "io.github.sauzze.agentdeck.terminal")

    enum Key: CGKeyCode {
        case returnKey = 36
        case escape = 53
        case space = 49
        case up = 126
        case down = 125
    }

    /// The ttys of every open tab: none if Terminal isn't running, nil if it
    /// could not be asked.
    static func openTTYs() -> Set<String>? {
        guard let output = run("""
            if application "Terminal" is not running then return ""
            set ttys to {}
            tell application "Terminal"
                repeat with w in windows
                    repeat with t in tabs of w
                        set end of ttys to tty of t
                    end repeat
                end repeat
            end tell
            set AppleScript's text item delimiters to linefeed
            return ttys as text
            """) else { return nil }
        return Set(output.split(separator: "\n").map(String.init))
    }

    /// The tab you are looking at, if Terminal is the active app.
    static func frontTTY() -> String? {
        let tty = run("""
            if application "Terminal" is not running then return ""
            tell application "Terminal"
                if not frontmost or (count of windows) is 0 then return ""
                return tty of selected tab of front window
            end tell
            """)
        return tty?.isEmpty == false ? tty : nil
    }

    static func focus(tty: String) -> Bool {
        withTab(tty, do: """
            set selected of t to true
            set index of w to 1
            activate
            """)
    }

    /// Types `text` and Return into the tab without bringing it forward.
    /// `do script` writes to the tab's input as characters, so the keyboard
    /// layout does not matter, and ends with the byte Enter sends.
    static func type(_ text: String, tty: String) -> Bool {
        withTab(tty, do: "do script (item 2 of argv) in t", extra: [text])
    }

    /// Brings the tab forward and presses `key`. Posting keys needs
    /// Accessibility permission.
    static func press(_ key: Key, tty: String) -> Bool {
        guard focus(tty: tty) else { return false }
        Thread.sleep(forTimeInterval: 0.12) // let the window take focus first
        for down in [true, false] {
            CGEvent(keyboardEventSource: nil, virtualKey: key.rawValue, keyDown: down)?.post(tap: .cghidEventTap)
        }
        return true
    }

    /// Runs `body` with `w` and `t` bound to the window and tab on `tty`.
    private static func withTab(_ tty: String, do body: String, extra: [String] = []) -> Bool {
        let output = run("""
            set target to item 1 of argv
            if application "Terminal" is not running then return "no"
            tell application "Terminal"
                repeat with w in windows
                    repeat with t in tabs of w
                        if tty of t is target then
                            \(body)
                            return "yes"
                        end if
                    end repeat
                end repeat
            end tell
            return "no"
            """, arguments: [tty] + extra)
        return output == "yes"
    }

    /// Runs an AppleScript, passing `arguments` as argv rather than splicing
    /// them into the source. Nil if it failed.
    private static func run(_ source: String, arguments: [String] = []) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", "on run argv\n\(source)\nend run"] + arguments
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .newlines)
    }
}
