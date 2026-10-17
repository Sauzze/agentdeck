import CoreGraphics
import Foundation

/// How the phone's deck is laid out, as set up on the setup page: how many
/// session keys, whether the office shows in their place and how it's
/// furnished, whether the dial and stick show, and the rows of buttons under
/// them. It is checked before it's kept: the phone draws it, and its
/// buttons type into sessions. The Windows and Linux app's layout.go matches.
struct Layout: Codable, Equatable {
    var keys = KeyCount.auto
    /// The Agent Office in place of the keys: a desk for each, in the same order.
    var office = false
    var room = Room()
    var dial = true
    var stick = true
    var rows: [ButtonRow] = []

    static let maxRows = 4
    static let maxPerRow = 4

    /// Today's deck: a key per session, the dial and stick, then ✓ ✕ and
    /// the mic over esc, send and /clear.
    static let standard = Layout(rows: [
        ButtonRow(tall: true, buttons: ["accept", "reject", "mic"].map { Button(id: $0) }),
        ButtonRow(tall: false, buttons: ["esc", "send", "clear"].map { Button(id: $0) }),
    ])

    init(keys: KeyCount = .auto, office: Bool = false, room: Room = Room(), dial: Bool = true, stick: Bool = true, rows: [ButtonRow] = []) {
        self.keys = keys
        self.office = office
        self.room = room
        self.dial = dial
        self.stick = stick
        self.rows = rows
    }

    /// What's left out is the default: Auto keys, no office, a standard
    /// room, the dial and the stick showing, no buttons. A value of the wrong
    /// kind refuses the layout, except in the room, which only changes how
    /// the office looks.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        keys = try c.decodeIfPresent(KeyCount.self, forKey: .keys) ?? .auto
        office = try c.decodeIfPresent(Bool.self, forKey: .office) ?? false
        room = (try? c.decodeIfPresent(Room.self, forKey: .room)) ?? Room()
        dial = try c.decodeIfPresent(Bool.self, forKey: .dial) ?? true
        stick = try c.decodeIfPresent(Bool.self, forKey: .stick) ?? true
        rows = try c.decodeIfPresent([ButtonRow].self, forKey: .rows) ?? []
    }

    /// A layout sent by the setup page or found in a profile's file, checked.
    static func parse(_ data: Data) -> Layout? {
        (try? JSONDecoder().decode(Layout.self, from: data))?.checked
    }

    /// What the deck can draw and press: known buttons, each of the deck's
    /// own once, within the limits.
    var checked: Layout {
        var seen = Set<String>()
        let kept = rows.prefix(Layout.maxRows).compactMap { row -> ButtonRow? in
            var buttons: [Button] = []
            for case let button? in row.buttons.map(\.checked)
            where !seen.contains(button.id) && buttons.count < Layout.maxPerRow {
                seen.insert(button.id)
                buttons.append(button)
            }
            return buttons.isEmpty ? nil : ButtonRow(tall: row.tall, buttons: buttons)
        }
        return Layout(keys: keys, office: office, room: room, dial: dial, stick: stick, rows: kept)
    }

    /// The button made in setup with `id`, if the layout has it.
    func madeButton(_ id: String) -> Button? {
        rows.lazy.flatMap(\.buttons).first { $0.id == id && !Button.builtIn.contains($0.id) }
    }

    /// As JSON's own types, for a reply built with JSONSerialization.
    var jsonObject: Any {
        (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(self))) ?? [:]
    }
}

/// How the office is furnished: the microphone or a megaphone, what each of
/// the back wall's five places holds, the floor, the walls' paint, the
/// lounge's carpet and the piece in its corner, whether the sky keeps the
/// computer's time or it's always day, its pet, whether the windows follow
/// the seasons, and how loud it is. office.js draws it, with the same
/// choices. Anything unknown, or of the wrong kind, is as standard: it only
/// changes how the room looks.
struct Room: Codable, Equatable {
    var mic = "mic"
    var wall = Room.standardWall
    var floor = "wood"
    var paint = "slate"
    var lounge = "navy"
    var corner = "arcade"
    var sky = "live"
    var pet = "none"
    var season = "calendar"
    var sound = "off"

    /// Each part's choices; the first is the standard one.
    static let choices = [
        "mic": ["mic", "megaphone"],
        "floor": ["wood", "tiles", "concrete", "carpet"],
        "paint": ["slate", "sage", "clay", "cream"],
        "lounge": ["navy", "teal", "plum", "sand"],
        "corner": ["arcade", "vending", "foosball", "fishtank", "books", "none"],
        "sky": ["live", "day"],
        "pet": ["none", "cat", "dog", "lizard", "monkey"],
        "season": ["calendar", "off"],
        "sound": ["off", "quiet", "normal"],
    ]
    static let wallChoices = ["window", "whiteboard", "pinboard", "poster", "shelf", "plant", "bare"]
    static let standardWall = ["window", "whiteboard", "window", "pinboard", "window"]

    init() {}

    init(from decoder: Decoder) throws {
        let c = try? decoder.container(keyedBy: CodingKeys.self)
        func choice(_ key: CodingKeys) -> String? {
            let given = (try? c?.decodeIfPresent(String.self, forKey: key)) ?? nil
            return given.flatMap { Room.choices[key.stringValue]?.contains($0) == true ? $0 : nil }
        }
        mic = choice(.mic) ?? mic
        floor = choice(.floor) ?? floor
        paint = choice(.paint) ?? paint
        lounge = choice(.lounge) ?? lounge
        corner = choice(.corner) ?? corner
        sky = choice(.sky) ?? sky
        pet = choice(.pet) ?? pet
        season = choice(.season) ?? season
        sound = choice(.sound) ?? sound
        let given = ((try? c?.decodeIfPresent([Loose].self, forKey: .wall)) ?? nil) ?? []
        wall = Room.standardWall.enumerated().map { i, standard in
            i < given.count ? given[i].text.flatMap { Room.wallChoices.contains($0) ? $0 : nil } ?? standard : standard
        }
    }

    /// One of the wall's places as given: text, or nothing for any other kind of value.
    private struct Loose: Decodable {
        let text: String?
        init(from decoder: Decoder) throws { text = try? decoder.singleValueContainer().decode(String.self) }
    }
}

/// How many session keys the deck shows: Auto, one for each running session,
/// or always 3, 6 or 9. In JSON, Auto is "auto".
enum KeyCount: Codable, Equatable {
    case auto
    case fixed(Int)

    /// The most keys there can be, in a 3×3.
    static let most = 9
    static let fixedCounts = [3, 6, 9]

    /// Anything but a fixed count reads as Auto.
    init(from decoder: Decoder) throws {
        let count = try? decoder.singleValueContainer().decode(Int.self)
        self = count.map { KeyCount.fixedCounts.contains($0) ? .fixed($0) : .auto } ?? .auto
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .auto: try c.encode("auto")
        case .fixed(let count): try c.encode(count)
        }
    }
}

/// A row of buttons, tall or short, sharing its width by weight.
struct ButtonRow: Codable, Equatable {
    var tall = false
    var buttons: [Button] = []

    init(tall: Bool, buttons: [Button]) {
        self.tall = tall
        self.buttons = buttons
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tall = try c.decodeIfPresent(Bool.self, forKey: .tall) ?? false
        buttons = try c.decodeIfPresent([Button].self, forKey: .buttons) ?? []
    }
}

/// One of the deck's own buttons, named by what it does, or one made in
/// setup, which types a command or presses a key. The phone names a made
/// button only by its id, so it can't have anything typed that wasn't set
/// up here.
struct Button: Codable, Equatable {
    var id: String
    var width = 1
    var label: String?
    var text: String?
    var key: String?
    /// Refused while the agent is busy, as /clear is.
    var whenFree: Bool?
    /// Asks for a second tap, as /clear does.
    var confirm: Bool?
    /// The agents it is for; none means every agent.
    var agents: [String]?

    static let maxWidth = 3
    static let labelLimit = 16
    static let commandLimit = 200

    /// The deck's own buttons. Max and the steps set Claude Code's effort,
    /// as the dial does.
    static let builtIn: Set = ["accept", "reject", "mic", "esc", "send", "clear", "up", "down", "max", "efforts"]

    /// The keys a made button can press.
    static let keys: [String: Terminal.Keystroke] = [
        "enter": .init(key: .returnKey), "escape": .init(key: .escape), "tab": .init(key: .tab),
        "shift-tab": .init(key: .tab, modifiers: .maskShift), "up": .init(key: .up), "down": .init(key: .down),
        "ctrl-c": .init(key: .c, modifiers: .maskControl),
    ]

    init(id: String, width: Int = 1) {
        self.id = id
        self.width = width
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        width = try c.decodeIfPresent(Int.self, forKey: .width) ?? 1
        label = try c.decodeIfPresent(String.self, forKey: .label)
        text = try c.decodeIfPresent(String.self, forKey: .text)
        // An empty key is none at all: the button types its text.
        key = try c.decodeIfPresent(String.self, forKey: .key).flatMap { $0.isEmpty ? nil : $0 }
        whenFree = try c.decodeIfPresent(Bool.self, forKey: .whenFree)
        confirm = try c.decodeIfPresent(Bool.self, forKey: .confirm)
        agents = try c.decodeIfPresent([String].self, forKey: .agents)
    }

    var checked: Button? {
        let width = (1...Button.maxWidth).contains(width) ? width : 1
        if Button.builtIn.contains(id) { return Button(id: id, width: width) }
        guard id.range(of: "^custom-[a-z0-9]{1,16}$", options: .regularExpression) != nil else { return nil }
        // A command with a line break, or a key the deck can't press, is
        // refused whole: the editor can't make one, so it came from somewhere else.
        if let key, Button.keys[key] == nil { return nil }
        if let text, text.hasControlCharacters { return nil }

        var checked = Button(id: id, width: width)
        checked.label = label.map { $0.oneLine(Button.labelLimit) }.flatMap { $0.isEmpty ? nil : $0 }
        if let key { checked.key = key } else { checked.text = (text ?? "").oneLine(Button.commandLimit) }
        checked.whenFree = whenFree == true ? true : nil
        checked.confirm = confirm == true ? true : nil
        let known = Agent.allCases.map(\.rawValue).filter { (agents ?? []).contains($0) }
        checked.agents = known.isEmpty || known.count == Agent.allCases.count ? nil : known
        return checked
    }
}

/// A look for the deck kept under a name: a layout and its colours. Default
/// is always there, the standard deck, and can't be changed.
struct Profile: Codable, Equatable {
    var name: String
    var layout: Layout
    var colours: [String: String]

    static let defaultName = "Default"
    static let nameLimit = 24
    static let most = 20

    static let standard = Profile(name: defaultName, layout: .standard, colours: [:])

    /// A name a profile may have: one line, not empty, and not Default's.
    static func checkedName(_ name: String) -> String? {
        let name = name.oneLine(nameLimit)
        return name.isEmpty || name.caseInsensitiveCompare(defaultName) == .orderedSame ? nil : name
    }

    var jsonObject: Any {
        (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(self))) ?? [:]
    }
}

extension String {
    var hasControlCharacters: Bool {
        unicodeScalars.contains { $0.value < 0x20 || $0.value == 0x7f }
    }

    /// Without control characters or surrounding space, cut to `limit` characters.
    func oneLine(_ limit: Int) -> String {
        let kept = String(String.UnicodeScalarView(unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7f }))
        return String(kept.trimmingCharacters(in: .whitespaces).prefix(limit))
    }
}
