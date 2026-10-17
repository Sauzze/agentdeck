import AppKit

/// What the screen saver says instead of showing the office, and what to do
/// about it.
enum Notice {
    case notPaired, unpaired, appClosed
    /// The preview in System Settings, paired and connected: the office
    /// itself only shows full screen.
    case ready

    var title: String {
        switch self {
        case .notPaired: return "Pair the screen saver"
        case .unpaired: return "Pair again in Options"
        case .appClosed: return "Open SauzzeDeck Pro to see your office"
        case .ready: return "Agent Office"
        }
    }

    var detail: String {
        switch self {
        case .notPaired: return "In System Settings → Screen Saver, click Options and enter a code from the setup page."
        case .unpaired: return "The screen saver was unpaired on the setup page. In System Settings → Screen Saver, click Options and enter a new code."
        case .appClosed: return "Your agents appear here as soon as it's running."
        case .ready: return "Your agents at their desks, live."
        }
    }
}

/// A notice, in the deck's colours: calm enough to be left on screen.
final class NoticeView: NSView {
    /// The deck's own, from the pairing page.
    static let body = NSColor(srgbRed: 0x0e / 255, green: 0x0e / 255, blue: 0x0e / 255, alpha: 1)
    private static let ink = NSColor(srgbRed: 0xec / 255, green: 0xec / 255, blue: 0xec / 255, alpha: 1)
    private static let dim = NSColor(srgbRed: 0x8a / 255, green: 0x8a / 255, blue: 0x8a / 255, alpha: 1)
    /// How wide the detail may run on a full screen, to keep it readable.
    private static let widest: CGFloat = 520

    private let title = NSTextField(labelWithString: "")
    private let detail = NSTextField(wrappingLabelWithString: "")

    init(frame: NSRect, isPreview: Bool) {
        super.init(frame: frame)
        title.font = .systemFont(ofSize: isPreview ? 12 : 28, weight: .semibold)
        detail.font = .systemFont(ofSize: isPreview ? 9 : 17)
        title.textColor = NoticeView.ink
        detail.textColor = NoticeView.dim
        for label in [title, detail] {
            label.alignment = .center
            label.isSelectable = false
        }

        let stack = NSStackView(views: [title, detail])
        stack.orientation = .vertical
        stack.spacing = isPreview ? 4 : 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        let margin: CGFloat = isPreview ? 12 : 48
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: NoticeView.widest),
            stack.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, constant: -2 * margin),
            title.widthAnchor.constraint(lessThanOrEqualTo: stack.widthAnchor),
            detail.widthAnchor.constraint(lessThanOrEqualTo: stack.widthAnchor),
        ])
    }

    required init?(coder: NSCoder) { nil }

    /// Says `notice`, or nothing while there is nothing to say yet.
    func show(_ notice: Notice?) {
        title.stringValue = notice?.title ?? ""
        detail.stringValue = notice?.detail ?? ""
    }

    override func draw(_ dirtyRect: NSRect) {
        NoticeView.body.setFill()
        dirtyRect.fill()
    }
}
