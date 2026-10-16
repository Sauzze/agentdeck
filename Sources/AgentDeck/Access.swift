import Foundation
import Security

/// Who may use the deck: the phones you paired, and the Claude Code hook.
///
/// Each phone has a key of its own, handed over once when it pairs: see
/// `Phones`. Nobody types it. To pair, you ask for a code on the Mac; the
/// phone opens the deck's address and enters it, or scans it, and gets a new
/// key in return.
///
/// A code exists only after you ask for one, lasts five minutes and works
/// once. Five wrong tries lock out the address they came from until the
/// next code, and twenty in all withdraw the code. Outside that window there
/// is nothing to guess.
///
/// The hook has a separate key, kept in a header file next to its script so
/// curl reads it from there rather than from its command line, where `ps`
/// would show it. It opens `/hook` and nothing else, and no phone's key
/// opens `/hook`.
final class Access {
    static let codeLifetime: TimeInterval = 5 * 60
    /// Wrong codes one address may try before it is locked out.
    static let maxAttemptsPerAddress = 5
    /// Wrong codes from everywhere before the code is withdrawn: the backstop
    /// for a device that keeps changing its address.
    static let maxAttempts = 20
    static let hookHeaderName = "X-AgentDeck-Token"

    let phones = Phones()
    let hookKey: String
    private(set) var code: String?
    private(set) var codeExpiry = Date.distantPast
    /// Wrong codes since the current one was issued, by address.
    private var misses: [String: Int] = [:]
    private var totalMisses = 0

    init() {
        // 1.0 shared one key between the phone and the hook. It is retired
        // rather than reused: the hook gets a fresh key and phones pair again.
        try? FileManager.default.removeItem(at: Paths.legacyToken)
        hookKey = Access.loadHookKey() ?? Access.createHookKey()
    }

    func isHookKey(_ candidate: String?) -> Bool {
        guard let candidate else { return false }
        return constantTimeEqual(candidate, hookKey)
    }

    /// A fresh pairing code, replacing any earlier one and lifting lockouts.
    @discardableResult
    func newCode() -> String {
        let fresh = String(format: "%06d", Int.random(in: 0..<1_000_000))
        code = fresh
        codeExpiry = Date().addingTimeInterval(Access.codeLifetime)
        misses = [:]
        totalMisses = 0
        return fresh
    }

    /// The current code, or nil if none was asked for or it has run out.
    var activeCode: String? {
        guard let code, Date() < codeExpiry else { return nil }
        return code
    }

    /// A key for a newly paired phone, if `attempt` is the active code and
    /// `address` is not locked out. The code is spent on success.
    func redeem(_ attempt: String, from address: String, userAgent: String) -> String? {
        guard let active = activeCode, misses[address, default: 0] < Access.maxAttemptsPerAddress else { return nil }
        if constantTimeEqual(attempt, active) {
            code = nil
            return phones.pair(name: Phones.name(forUserAgent: userAgent))
        }
        misses[address, default: 0] += 1
        totalMisses += 1
        if totalMisses >= Access.maxAttempts { code = nil }
        return nil
    }

    private static func loadHookKey() -> String? {
        guard let saved = try? String(contentsOf: Paths.hookHeader, encoding: .utf8) else { return nil }
        let prefix = "\(hookHeaderName): "
        let line = saved.trimmingCharacters(in: .whitespacesAndNewlines)
        guard line.hasPrefix(prefix), line.count > prefix.count else { return nil }
        return String(line.dropFirst(prefix.count))
    }

    private static func createHookKey() -> String {
        let key = randomKey()
        FileManager.default.createFile(atPath: Paths.hookHeader.path,
                                       contents: Data("\(hookHeaderName): \(key)\n".utf8),
                                       attributes: [.posixPermissions: 0o600])
        return key
    }
}

/// 32 random bytes, base64url-encoded so they travel in a URL unescaped.
func randomKey() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
        fatalError("No secure random source available")
    }
    return Data(bytes).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

/// Compares without stopping at the first difference, so response timing
/// says nothing about how much of a guess was right.
func constantTimeEqual(_ a: String, _ b: String) -> Bool {
    let x = Array(a.utf8), y = Array(b.utf8)
    guard x.count == y.count else { return false }
    var difference: UInt8 = 0
    for i in x.indices { difference |= x[i] ^ y[i] }
    return difference == 0
}
