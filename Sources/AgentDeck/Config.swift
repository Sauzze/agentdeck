import Foundation

/// What you set on the setup page: which project is pinned to which key, the
/// deck's layout and colours, the profiles they're saved in, its logo,
/// whether the stick scrolls, and whether the office hires and fires. Saved
/// as JSON in Application Support.
final class Config: Codable {
    static let shared = Config.load()

    /// A project folder per key, or nil for a key that takes any session.
    var pins: [String?] = Array(repeating: nil, count: KeyCount.most)
    /// Only the colours that differ from the default theme.
    var colours: [String: String] = [:]
    var layout = Layout.standard
    /// Saved looks, besides Default, and the one the deck was last switched to.
    var profiles: [Profile] = []
    var activeProfile = Profile.defaultName
    var logo = Logo.sauzze
    /// Whether the stick scrolls Terminal. Off until you turn it on, so a
    /// newly paired phone can do no more than the deck's buttons do.
    var scrollEnabled = false
    /// Whether the office may hire and fire: open a new Terminal window with
    /// an agent in it, and stop an agent and close its tab. Off until you
    /// turn it on, for the same reason.
    var hiringEnabled = false
    /// The folder new hires start in, and the agent they are.
    var hireFolder = ""
    var hireAgent = Agent.claude.rawValue
    var hasCompletedSetup = false

    private enum CodingKeys: String, CodingKey {
        case pins, colours, layout, profiles, activeProfile, logo, scrollEnabled, hiringEnabled, hireFolder, hireAgent
        case hasCompletedSetup
    }

    init() {}

    /// Field by field, so a file from an older or newer version still loads.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pins = try c.decodeIfPresent([String?].self, forKey: .pins) ?? pins
        colours = try c.decodeIfPresent([String: String].self, forKey: .colours) ?? colours
        // Layouts are checked again as they load: their buttons type into sessions.
        layout = ((try? c.decodeIfPresent(Layout.self, forKey: .layout)) ?? layout).checked
        // One by one, so a profile this version can't read loses only itself.
        profiles = ((try? c.decodeIfPresent([Lossy<Profile>].self, forKey: .profiles)) ?? []).compactMap(\.value).map {
            Profile(name: $0.name, layout: $0.layout.checked, colours: $0.colours)
        }
        activeProfile = (try? c.decodeIfPresent(String.self, forKey: .activeProfile)) ?? activeProfile
        logo = (try? c.decodeIfPresent(Logo.self, forKey: .logo)) ?? logo
        scrollEnabled = try c.decodeIfPresent(Bool.self, forKey: .scrollEnabled) ?? false
        hiringEnabled = try c.decodeIfPresent(Bool.self, forKey: .hiringEnabled) ?? false
        hireFolder = try c.decodeIfPresent(String.self, forKey: .hireFolder) ?? ""
        hireAgent = (try c.decodeIfPresent(String.self, forKey: .hireAgent)).flatMap { Agent(rawValue: $0)?.rawValue } ?? hireAgent
        hasCompletedSetup = try c.decodeIfPresent(Bool.self, forKey: .hasCompletedSetup) ?? false
    }

    private static func load() -> Config {
        guard let data = try? Data(contentsOf: Paths.config),
              let config = try? JSONDecoder().decode(Config.self, from: data) else { return Config() }
        if config.pins.count != KeyCount.most {
            config.pins = Array((config.pins + Array(repeating: nil, count: KeyCount.most)).prefix(KeyCount.most))
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

    /// Puts `first` on key `b` and `second` on key `a`, each taken off any
    /// other key it was on: two desks swapped in the office. A nil project
    /// is an empty desk, whose key is left free.
    func swapPins(_ first: String?, at a: Int, with second: String?, at b: Int) {
        pins = pins.map { $0 != nil && ($0 == first || $0 == second) ? nil : $0 }
        pins[b] = first
        pins[a] = second
        save()
    }
}

/// A value decoded on its own, so one that can't be read is left out rather
/// than taking the rest of a list with it.
private struct Lossy<Value: Decodable>: Decodable {
    let value: Value?

    init(from decoder: Decoder) throws {
        value = try? Value(from: decoder)
    }
}

// MARK: Profiles

/// Why a profile couldn't be saved, renamed or added, in the setup page's words.
struct ProfileError: Error {
    let message: String

    static let name = ProfileError(message: "Give the profile a name of its own, up to 24 characters.")
    static let missing = ProfileError(message: "There's no profile by that name.")
    static let tooMany = ProfileError(message: "That's the most profiles there can be. Delete one first.")
}

extension Config {
    func profile(named name: String) -> Profile? {
        name == Profile.defaultName ? .standard : profiles.first { $0.name == name }
    }

    /// The deck no longer matches the profile it was switched to.
    var profileEdited: Bool {
        guard let active = profile(named: activeProfile) else { return true }
        return active.layout != layout || active.colours != colours
    }

    /// Puts a saved profile's layout and colours on the deck.
    func switchProfile(to name: String) throws {
        guard let chosen = profile(named: name) else { throw ProfileError.missing }
        layout = chosen.layout
        colours = chosen.colours
        activeProfile = name
        save()
    }

    /// Keeps the deck as it is under `name`, replacing a profile of that name.
    func saveProfile(as name: String) throws {
        guard let name = Profile.checkedName(name) else { throw ProfileError.name }
        let kept = Profile(name: name, layout: layout, colours: colours)
        if let i = profiles.firstIndex(where: { $0.name == name }) {
            profiles[i] = kept
        } else {
            guard profiles.count < Profile.most else { throw ProfileError.tooMany }
            profiles.append(kept)
        }
        activeProfile = name
        save()
    }

    func renameProfile(_ name: String, to newName: String) throws {
        guard let i = profiles.firstIndex(where: { $0.name == name }) else { throw ProfileError.missing }
        guard let newName = Profile.checkedName(newName) else { throw ProfileError.name }
        if newName != name && profiles.contains(where: { $0.name == newName }) {
            throw ProfileError(message: "Another profile already has that name.")
        }
        profiles[i].name = newName
        if activeProfile == name { activeProfile = newName }
        save()
    }

    /// The deck stays as it is; it just no longer matches a saved profile.
    func deleteProfile(_ name: String) {
        profiles.removeAll { $0.name == name }
        if activeProfile == name { activeProfile = Profile.defaultName }
        save()
    }

    /// A profile from a file as this deck would keep it, checked as a layout
    /// and colours made here are. The setup page shows its buttons from this,
    /// before it's added, so what you're asked about is what's kept.
    static func checkedProfile(_ data: Data) throws -> Profile {
        let file = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard let layoutObject = file["layout"] as? [String: Any],
              let layoutData = try? JSONSerialization.data(withJSONObject: layoutObject),
              let layout = Layout.parse(layoutData) else {
            throw ProfileError(message: "That isn't a profile this deck can add.")
        }
        let name = Profile.checkedName(file["name"] as? String ?? "") ?? "Imported"
        return Profile(name: name, layout: layout, colours: Theme.customisations(from: file["colours"] as? [String: Any] ?? [:]))
    }

    /// Adds a profile from a file, under a name of its own.
    func importProfile(_ data: Data) throws {
        var profile = try Config.checkedProfile(data)
        guard profiles.count < Profile.most else { throw ProfileError.tooMany }
        profile.name = unusedName(profile.name)
        profiles.append(profile)
        save()
    }

    /// `name`, or name (2), (3)… when a profile already has it.
    private func unusedName(_ name: String) -> String {
        var candidate = name
        var n = 2
        while candidate == Profile.defaultName || profiles.contains(where: { $0.name == candidate }) {
            let suffix = " (\(n))"
            candidate = name.oneLine(Profile.nameLimit - suffix.count) + suffix
            n += 1
        }
        return candidate
    }
}

/// The deck's logo: the Sauzze mark, or the six keys it started out with.
/// It shows on the phone's Home Screen, on the setup page and in the menu bar.
enum Logo: String, Codable, CaseIterable {
    case sauzze, keys

    var icon: URL { Paths.web.appendingPathComponent("icon-\(rawValue).png") }
}
