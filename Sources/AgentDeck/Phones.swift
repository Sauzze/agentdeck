import CryptoKit
import Foundation

/// A phone you paired, as phones.json keeps it.
struct PairedPhone: Codable {
    let id: String
    let name: String
    let pairedAt: Date
    var lastSeen: Date
    /// SHA-256 of the phone's key, in hex. The key itself is never stored.
    let keyHash: String
}

/// Every paired phone. Each has its own key, so one can be revoked and the
/// others keep working. The phone keeps its key in the deck's URL; this Mac
/// keeps only a hash of it, so the file can't be used to pose as a phone.
final class Phones {
    /// How out of date `lastSeen` may get before a request updates it.
    /// Saving on every request would rewrite the file many times a second.
    private static let seenResolution: TimeInterval = 60

    private(set) var all: [PairedPhone]

    init() {
        all = Phones.load()
    }

    /// Adds a phone and returns its key: the only time the key exists here.
    func pair(name: String) -> String {
        let key = randomKey()
        let now = Date()
        all.append(PairedPhone(id: UUID().uuidString, name: name, pairedAt: now, lastSeen: now,
                               keyHash: Phones.hash(key)))
        save()
        return key
    }

    /// The phone holding `key`, if any.
    func phone(withKey key: String?) -> PairedPhone? {
        guard let key else { return nil }
        let hash = Phones.hash(key)
        return all.first { constantTimeEqual($0.keyHash, hash) }
    }

    func markSeen(_ id: String) {
        guard let index = all.firstIndex(where: { $0.id == id }),
              -all[index].lastSeen.timeIntervalSinceNow >= Phones.seenResolution else { return }
        all[index].lastSeen = Date()
        save()
    }

    func remove(_ id: String) {
        all.removeAll { $0.id == id }
        save()
    }

    func removeAll() {
        all = []
        save()
    }

    /// What the setup page calls a phone. The User-Agent is all there is to
    /// go on, and a broad name is all it can honestly give.
    static func name(forUserAgent userAgent: String) -> String {
        // Agent Office pairs like a phone. Its app is named with a space, so
        // the system may write it either way.
        if userAgent.contains("AgentOffice") || userAgent.contains("Agent%20Office") { return "Agent Office" }
        if userAgent.contains("iPhone") { return "iPhone" }
        if userAgent.contains("iPad") { return "iPad" }
        if userAgent.contains("Android") { return "Android phone" }
        return "Phone"
    }

    private static func hash(_ key: String) -> String {
        SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func load() -> [PairedPhone] {
        guard let data = try? Data(contentsOf: Paths.phones) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([PairedPhone].self, from: data)) ?? []
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(all) else { return }
        FileManager.default.createFile(atPath: Paths.phones.path, contents: data,
                                       attributes: [.posixPermissions: 0o600])
    }
}
