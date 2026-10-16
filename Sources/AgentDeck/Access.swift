import Foundation
import Security

/// The deck's secret, and the short code that hands it to a phone.
///
/// Every request from the phone and from the Claude Code hook carries the
/// token: 32 random bytes, generated once and kept in Application Support.
/// Nobody types it. To pair, you ask for a code on the Mac; the phone opens
/// the deck's address and enters it, and gets the token in return.
///
/// A code exists only after you ask for one, lasts five minutes, works once,
/// and is withdrawn after five wrong attempts. Outside that window there is
/// nothing to guess.
final class Access {
    static let codeLifetime: TimeInterval = 5 * 60
    static let maxAttempts = 5

    let token: String
    private(set) var code: String?
    private(set) var codeExpiry = Date.distantPast
    private var failedAttempts = 0

    init() {
        token = Access.loadToken() ?? Access.createToken()
    }

    func isValid(_ candidate: String?) -> Bool {
        guard let candidate else { return false }
        return constantTimeEqual(candidate, token)
    }

    /// A fresh pairing code, replacing any earlier one.
    @discardableResult
    func newCode() -> String {
        let fresh = String(format: "%06d", Int.random(in: 0..<1_000_000))
        code = fresh
        codeExpiry = Date().addingTimeInterval(Access.codeLifetime)
        failedAttempts = 0
        return fresh
    }

    /// The current code, or nil if none was asked for or it has run out.
    var activeCode: String? {
        guard let code, Date() < codeExpiry else { return nil }
        return code
    }

    /// The token, if `attempt` is the active code. The code is spent on
    /// success, or after `maxAttempts` misses.
    func redeem(_ attempt: String) -> String? {
        guard let active = activeCode else { return nil }
        if constantTimeEqual(attempt, active) {
            code = nil
            return token
        }
        failedAttempts += 1
        if failedAttempts >= Access.maxAttempts { code = nil }
        return nil
    }

    private static func loadToken() -> String? {
        guard let saved = try? String(contentsOf: Paths.token, encoding: .utf8) else { return nil }
        let trimmed = saved.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func createToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            fatalError("No secure random source available")
        }
        let token = Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        FileManager.default.createFile(atPath: Paths.token.path, contents: Data((token + "\n").utf8),
                                       attributes: [.posixPermissions: 0o600])
        return token
    }
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
