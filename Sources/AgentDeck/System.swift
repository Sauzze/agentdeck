import AppKit
import ApplicationServices
import CoreImage

/// Accessibility: needed to press keys and move the cursor for you.
enum Permissions {
    static var hasAccessibility: Bool { AXIsProcessTrusted() }

    /// Adds AgentDeck to the Accessibility list and opens it, so the switch is
    /// the only thing left to do.
    static func requestAccessibility() {
        let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
        NSWorkspace.shared.open(settingsPane)
    }

    private static var settingsPane: URL {
        URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
    }
}

/// How this Mac scrolls: System Settings → Trackpad (or Mouse) → Natural
/// scrolling, which is on unless it was turned off.
enum Scrolling {
    static var isNatural: Bool {
        UserDefaults.standard.object(forKey: "com.apple.swipescrolldirection") as? Bool ?? true
    }
}

/// Opening AgentDeck at login, through a LaunchAgent that runs `open` on the
/// app — the same as launching it by hand, so it can still be quit normally.
enum LoginItem {
    static let label = "io.github.sauzze.agentdeck"

    static var isEnabled: Bool {
        get { FileManager.default.fileExists(atPath: Paths.launchAgent.path) }
        set { newValue ? enable() : disable() }
    }

    /// Points the LaunchAgent at this copy of the app. An update can move or
    /// rename it, and the agent would go on opening the old path.
    static func refresh() {
        if isEnabled { enable() }
    }

    private static func enable() {
        let plist: [String: Any] = [
            "Label": label,
            "ProgramArguments": ["/usr/bin/open", "-a", Bundle.main.bundlePath],
            "RunAtLoad": true,
        ]
        try? FileManager.default.createDirectory(at: Paths.launchAgent.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try? PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try? data?.write(to: Paths.launchAgent, options: .atomic)
    }

    private static func disable() {
        try? FileManager.default.removeItem(at: Paths.launchAgent)
    }
}

/// The address a phone on the same network can reach this Mac at.
enum LocalNetwork {
    static func address() -> String? {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return nil }
        defer { freeifaddrs(list) }

        var candidates: [(name: String, address: String)] = []
        for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let entry = pointer.pointee
            let flags = Int32(entry.ifa_flags)
            guard let addr = entry.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET),
                  flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
            candidates.append((String(cString: entry.ifa_name), String(cString: host)))
        }
        // Wi-Fi and Ethernet are en*; VPN tunnels and bridges are not reachable from the phone.
        return (candidates.first { $0.name.hasPrefix("en") } ?? candidates.first)?.address
    }
}

enum QRCode {
    static func image(for text: String, scale: CGFloat = 8) -> CGImage? {
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(Data(text.utf8), forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) else { return nil }
        return CIContext().createCGImage(output, from: output.extent)
    }

    static func png(for text: String) -> Data? {
        guard let image = image(for: text) else { return nil }
        return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    }
}

/// Processes on this Mac, read straight from the kernel.
enum Processes {
    /// What `e_tdev` holds for a process with no terminal: NODEV.
    private static let noTerminal = UInt32.max

    /// The terminal of the one process called `name` running in `folder`,
    /// leaving out those on `taken`. Nil when none or several match: a guess
    /// would put a session on the wrong key.
    static func tty(of name: String, in folder: String, excluding taken: Set<String>) -> String? {
        // The kernel reports a process's folder with every link resolved.
        // realpath does the same; Foundation's resolving drops /private.
        guard let resolved = realpath(folder, nil) else { return nil }
        let wanted = String(cString: resolved)
        free(resolved)
        var pids = [pid_t](repeating: 0, count: 8192)
        let count = Int(proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size)))
        var matches: Set<String> = []
        for pid in pids.prefix(max(count, 0)) where pid > 0 {
            guard let info = bsdInfo(pid), string(info.pbi_comm) == name,
                  info.e_tdev != noTerminal, workingDirectory(of: pid) == wanted,
                  let device = devname(dev_t(bitPattern: info.e_tdev), S_IFCHR) else { continue }
            let tty = "/dev/" + String(cString: device)
            if !taken.contains(tty) { matches.insert(tty) }
        }
        return matches.count == 1 ? matches.first : nil
    }

    private static func bsdInfo(_ pid: pid_t) -> proc_bsdinfo? {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size ? info : nil
    }

    private static func workingDirectory(of pid: pid_t) -> String? {
        var info = proc_vnodepathinfo()
        let size = Int32(MemoryLayout<proc_vnodepathinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &info, size) == size else { return nil }
        return string(info.pvi_cdir.vip_path)
    }

    /// A C string held in a fixed-size array, which Swift sees as a tuple.
    private static func string<Characters>(_ characters: Characters) -> String {
        withUnsafeBytes(of: characters) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }
}
