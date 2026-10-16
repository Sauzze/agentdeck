import Foundation

/// What you set on the setup page: which project is pinned to which key, the
/// deck's colours, its logo and whether the stick scrolls. Saved as JSON in
/// Application Support.
final class Config: Codable {
    static let keyCount = 6
    static let shared = Config.load()

    /// A project folder per key, or nil for a key that takes any session.
    var pins: [String?] = Array(repeating: nil, count: Config.keyCount)
    /// Only the colours that differ from the default theme.
    var colours: [String: String] = [:]
    var logo = Logo.sauzze
    /// Whether the stick scrolls Terminal. Off until you turn it on, so a
    /// newly paired phone can do no more than the deck's buttons do.
    var scrollEnabled = false
    var hasCompletedSetup = false

    private enum CodingKeys: String, CodingKey { case pins, colours, logo, scrollEnabled, hasCompletedSetup }

    init() {}

    /// Field by field, so a file from an older or newer version still loads.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pins = try c.decodeIfPresent([String?].self, forKey: .pins) ?? pins
        colours = try c.decodeIfPresent([String: String].self, forKey: .colours) ?? colours
        logo = (try? c.decodeIfPresent(Logo.self, forKey: .logo)) ?? logo
        scrollEnabled = try c.decodeIfPresent(Bool.self, forKey: .scrollEnabled) ?? false
        hasCompletedSetup = try c.decodeIfPresent(Bool.self, forKey: .hasCompletedSetup) ?? false
    }

    private static func load() -> Config {
        guard let data = try? Data(contentsOf: Paths.config),
              let config = try? JSONDecoder().decode(Config.self, from: data) else { return Config() }
        if config.pins.count != keyCount {
            config.pins = Array((config.pins + Array(repeating: nil, count: keyCount)).prefix(keyCount))
        }
        return config
    }

    func save() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(self) else { return }
        try? data.write(to: Paths.config, options: .atomic)
    }

    /// Pin `folder` to key `index`, taking it off any other key it was on.
    func pin(_ folder: String, to index: Int) {
        pins = pins.map { $0 == folder ? nil : $0 }
        pins[index] = folder
        save()
    }

    func unpin(_ index: Int) {
        pins[index] = nil
        save()
    }
}

/// The deck's logo: the Sauzze mark, or the six keys it started out with.
/// It shows on the phone's Home Screen, on the setup page and in the menu bar.
enum Logo: String, Codable, CaseIterable {
    case sauzze, keys

    var icon: URL { Paths.web.appendingPathComponent("icon-\(rawValue).png") }
}
