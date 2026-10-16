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
