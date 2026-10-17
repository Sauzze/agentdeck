import AppKit

/// Terminal.app: finding a session's tab, bringing it forward, typing into it.
///
/// A tab is identified by its tty. Terminal reports one for every tab and the
/// hook reports the one the agent runs on, so they meet on an exact string —
/// window and tab indexes shift as tabs move, a tty does not.
///
/// AppleScript runs through osascript, one call at a time on `queue`, so a slow
/// script never holds up the menu bar or the server. Every script checks that
/// Terminal is running first, because asking a closed Terminal anything
/// launches it.
enum Terminal {
    static let queue = DispatchQueue(label: "io.github.sauzze.agentdeck.terminal")
    private static let bundleID = "com.apple.Terminal"

    enum Key: CGKeyCode {
        case returnKey = 36
        case escape = 53
        case space = 49
        case up = 126
        case down = 125
        case pageUp = 116
        case pageDown = 121
        case end = 119
        case c = 8
        case tab = 48
    }

    /// A key, with its modifiers, pressed `times` times in a row.
    struct Keystroke {
        let key: Key
        var modifiers: CGEventFlags = []
        var times = 1
    }

    /// The most lines one request may scroll. A notch of the phone's wheel
    /// is a few; anything beyond is clamped, not obeyed.
    static let maxScroll = 200

    /// How long Terminal may take to come to the front. It usually needs about
    /// 200 ms, more on a busy Mac; past this, the press is given up.
    private static let activationTimeout: TimeInterval = 1.5
    /// A moment more once it is in front, for its window to become key.
    private static let settle: TimeInterval = 0.05
    /// Notches arriving within this long of the last scroll of the same tab
    /// belong to one turn of the wheel, and the tab is still in front.
    private static let scrollGesture: TimeInterval = 1
    /// The tab the last scroll went to, and when. Only touched on `queue`.
    private static var lastScroll: (tty: String, at: Date)?

    /// The ttys of every open tab: none if Terminal isn't running, nil if it
    /// could not be asked. Asked for all at once: windows walked one by one
    /// shift under the walk as one opens, closes or comes to the front, and a
    /// window skipped would look closed.
    static func openTTYs() -> Set<String>? {
        guard let output = run("""
            if application "Terminal" is not running then return ""
            tell application "Terminal" to set byWindow to tty of every tab of every window
            set ttys to {}
            repeat with tabsOfWindow in byWindow
                repeat with t in tabsOfWindow
                    set end of ttys to contents of t
                end repeat
            end repeat
            set AppleScript's text item delimiters to linefeed
            return ttys as text
            """) else { return nil }
        return Set(output.split(separator: "\n").map(String.init))
    }

    /// Whether a process called `name` is running on `tty`, in any terminal
    /// app: nil if that couldn't be looked at. A tab that has closed takes its
    /// processes with it.
    static func isRunning(_ name: String, on tty: String) -> Bool? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-t", (tty as NSString).lastPathComponent, "-o", "comm="]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        // No such tty any more is an answer too: nothing runs on it.
        return String(decoding: data, as: UTF8.self).split(separator: "\n")
            .contains { ($0.trimmingCharacters(in: .whitespaces) as NSString).lastPathComponent == name }
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

    /// Brings the tab forward and presses `key`, `times` times. Posting keys
    /// needs Accessibility permission.
    static func press(_ key: Key, modifiers: CGEventFlags = [], times: Int = 1, tty: String) -> Bool {
        guard focus(tty: tty), waitUntilFrontmost() else { return false }
        post(key, modifiers: modifiers, times: times)
        return true
    }

    /// Scrolls the tab's window by `lines`, up when negative, with the View
    /// menu's Line Up and Line Down (⌥⌘Page Up, ⌥⌘Page Down). They move
    /// Terminal's view of the scrollback, so the agent itself receives nothing.
    ///
    /// Only a turn's first notch brings the tab forward. Doing it for every
    /// notch would make the wheel lag; a tab you switch to in the meantime
    /// by hand gets the rest of that turn.
    static func scroll(lines: Int, tty: String) -> Bool {
        let count = min(abs(lines), maxScroll)
        guard count > 0 else { return true }
        let key: Key = lines < 0 ? .pageUp : .pageDown
        let modifiers: CGEventFlags = [.maskCommand, .maskAlternate]
        if let last = lastScroll, last.tty == tty, Date().timeIntervalSince(last.at) < scrollGesture, isFrontmost {
            post(key, modifiers: modifiers, times: count)
        } else {
            guard press(key, modifiers: modifiers, times: count, tty: tty) else { return false }
        }
        lastScroll = (tty, Date())
        return true
    }

    /// The View menu's Scroll to Bottom (⌘End): back to where the agent is.
    static func scrollToBottom(tty: String) -> Bool {
        press(.end, modifiers: .maskCommand, tty: tty)
    }

    /// Opens a new window in `folder`, running `command`. The folder goes
    /// through `quoted form of`, so any name is taken as it is; the command
    /// is one of the agents' own names.
    static func open(_ command: String, in folder: String) -> Bool {
        run("""
            tell application "Terminal"
                activate
                do script "cd " & quoted form of (item 1 of argv) & " && " & (item 2 of argv)
            end tell
            return "yes"
            """, arguments: [folder, command]) == "yes"
    }

    /// What firing came to: see `fire(tty:agent:)`.
    enum Fired {
        /// The agent has stopped, and its tab is closed, or left as the
        /// terminal keeps it.
        case fired
        /// Something else is in the tab's foreground, or the agent would not
        /// stop: the tab is left as it was.
        case notStopped
        /// No Terminal tab is on that tty.
        case gone
    }

    /// Stops the agent in the tab on `tty`, then closes the tab. Only the
    /// agent is stopped: a tab whose foreground job is something else, such as
    /// a server started after the agent ended, is left alone. With only the
    /// shell left, the agent has ended already and the tab just closes.
    ///
    /// The agent's job is asked to end, then made to, and the tab is closed
    /// only once none of it is left, so Terminal closes it without asking.
    static func fire(tty: String, agent: Agent) -> Fired {
        // Unknown is not the same as none: nothing is touched.
        guard let open = openTTYs() else { return .notStopped }
        // A tab in another terminal app can't be closed from here, so its
        // agent is not stopped either.
        guard open.contains(tty) else { return .gone }
        switch foreground(tty: tty) {
        case nil:
            return .notStopped
        case .job(let job, let names)?:
            guard names.contains(agent.foregroundName), stop(job) else { return .notStopped }
            // The agent has gone, and if another job has taken its place, the
            // tab is that job's now.
            if case .job? = foreground(tty: tty) { return .fired }
        case .shell?:
            break
        }
        closeTab(tty: tty)
        return .fired
    }

    /// Closes the tab on `tty`, which only its shell is left in. Terminal
    /// counts each tab of a window as a window of its own, which `close`
    /// closes alone; it can't close a tab. A tab it counts among others is
    /// sent `exit 0` instead: the shell ends, cleanly whatever the agent
    /// ended with, and the profile's "When the shell exits" closes the tab
    /// or keeps it as [Process completed].
    private static func closeTab(tty: String) {
        _ = withTab(tty, do: """
            if (count of tabs of w) is 1 then
                close w
            else
                do script "exit 0" in t
            end if
            """)
    }

    /// How long a job is given to end when asked, then when made to.
    private static let stopGrace: [(signal: Int32, wait: TimeInterval)] = [(SIGTERM, 3), (SIGKILL, 1)]

    /// Stops the process group `job`, and whether none of it is left.
    private static func stop(_ job: pid_t) -> Bool {
        let isGone = { kill(-job, 0) == -1 && errno == ESRCH }
        for (signal, wait) in stopGrace {
            kill(-job, signal)
            let deadline = Date().addingTimeInterval(wait)
            while Date() < deadline {
                if isGone() { return true }
                Thread.sleep(forTimeInterval: 0.1)
            }
        }
        return isGone()
    }

    /// What runs in the foreground of a tab.
    private enum Foreground {
        /// Nothing but the shell, or not even that once the shell has ended.
        case shell
        /// A job: its process group, and the names of the processes in it.
        case job(pid_t, names: Set<String>)
    }

    /// The foreground of the tab on `tty`, or nil if `ps` couldn't be asked.
    /// Terminal starts each tab's shell under `login`, and a job is any
    /// process group in front of that shell.
    private static func foreground(tty: String) -> Foreground? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-t", (tty as NSString).lastPathComponent, "-o", "pid=,ppid=,pgid=,tpgid=,comm="]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let rows = String(decoding: data, as: UTF8.self).split(separator: "\n").compactMap { line -> (pid: Int32, ppid: Int32, pgid: Int32, tpgid: Int32, name: String)? in
            let fields = line.split(separator: " ", maxSplits: 4, omittingEmptySubsequences: true)
            guard fields.count == 5, let pid = Int32(fields[0]), let ppid = Int32(fields[1]), let pgid = Int32(fields[2]),
                  let tpgid = Int32(fields[3]) else { return nil }
            return (pid, ppid, pgid, tpgid, (String(fields[4]) as NSString).lastPathComponent)
        }
        // Nothing left at all: the shell has ended too.
        guard let tpgid = rows.first?.tpgid else { return .shell }
        let logins = Set(rows.filter { $0.name == "login" }.map(\.pid))
        // A tab with no shell of Terminal's own, such as a profile running a
        // command of its own, can't be told apart from what runs in it.
        guard let shell = rows.first(where: { logins.contains($0.ppid) }) else { return nil }
        guard tpgid > 0, tpgid != shell.pgid else { return .shell }
        return .job(tpgid, names: Set(rows.filter { $0.pgid == tpgid }.map(\.name)))
    }

    /// Keys go to whichever app is in front, so they wait until that is
    /// Terminal. Posted any sooner, they land in the app you were using:
    /// Space in Finder opens Quick Look.
    private static func waitUntilFrontmost() -> Bool {
        let deadline = Date().addingTimeInterval(activationTimeout)
        while !isFrontmost {
            guard Date() < deadline else { return false }
            Thread.sleep(forTimeInterval: 0.01)
        }
        Thread.sleep(forTimeInterval: settle)
        return true
    }

    private static var isFrontmost: Bool {
        NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundleID
    }

    private static func post(_ key: Key, modifiers: CGEventFlags, times: Int) {
        for _ in 0..<times {
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: nil, virtualKey: key.rawValue, keyDown: down)
                if !modifiers.isEmpty { event?.flags = modifiers }
                event?.post(tap: .cghidEventTap)
            }
        }
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
