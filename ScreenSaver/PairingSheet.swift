import AppKit

/// The screen saver's Options: where it pairs with SauzzeDeck Pro, with a
/// code from the setup page, as a phone does.
@MainActor
final class PairingSheet: NSObject, NSTextFieldDelegate {
    private static let codeLength = 6
    private static let width: CGFloat = 380
    private static let margin: CGFloat = 20

    private let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: PairingSheet.width, height: 0),
                                  styleMask: [.titled], backing: .buffered, defer: true)
    private let code = NSTextField()
    private let status = NSTextField(wrappingLabelWithString: "")
    private let pairButton = NSButton(title: "Pair", target: nil, action: nil)
    private var pairing: Task<Void, Never>?

    override init() {
        super.init()
        let heading = NSTextField(labelWithString: "Pair the screen saver")
        heading.font = .boldSystemFont(ofSize: NSFont.systemFontSize + 2)
        let help = NSTextField(wrappingLabelWithString:
            "Click SauzzeDeck Pro in the menu bar, choose Pair a Phone…, and enter the code it shows.")
        code.font = .monospacedSystemFont(ofSize: 24, weight: .semibold)
        code.alignment = .center
        code.placeholderString = "000000"
        code.delegate = self
        status.textColor = .secondaryLabelColor
        pairButton.target = self
        pairButton.action = #selector(pair)
        pairButton.keyEquivalent = "\r"
        pairButton.isEnabled = false
        let done = NSButton(title: "Done", target: self, action: #selector(close))
        done.keyEquivalent = "\u{1b}"
        let buttons = NSStackView()
        buttons.setViews([done, pairButton], in: .trailing)

        let stack = NSStackView(views: [heading, help, code, status, buttons])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.setCustomSpacing(20, after: status)
        let margin = PairingSheet.margin
        stack.edgeInsets = NSEdgeInsets(top: margin, left: margin, bottom: margin, right: margin)
        window.contentView = stack
        stack.widthAnchor.constraint(equalToConstant: PairingSheet.width).isActive = true
        for view in [help, code, status, buttons] {
            view.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -2 * margin).isActive = true
        }
    }

    /// The sheet, saying whether the screen saver is paired now.
    func open() -> NSWindow {
        code.stringValue = ""
        pairButton.isEnabled = false
        status.stringValue = ""
        if let key = Pairing.key {
            Task {
                switch await Pairing.check(key) {
                case .paired: status.stringValue = "Paired. Your office shows while the screen saver runs."
                case .unpaired: status.stringValue = "Unpaired on the setup page. Pair again with a new code."
                case .unreachable: status.stringValue = "Paired. Open SauzzeDeck Pro to see your office."
                }
            }
        } else {
            status.stringValue = "Not paired yet."
        }
        window.makeFirstResponder(code)
        return window
    }

    func controlTextDidChange(_ notification: Notification) {
        code.stringValue = String(code.stringValue.filter(\.isNumber).prefix(PairingSheet.codeLength))
        pairButton.isEnabled = pairing == nil && code.stringValue.count == PairingSheet.codeLength
    }

    @objc private func pair() {
        guard pairing == nil else { return }
        pairButton.isEnabled = false
        let attempt = code.stringValue
        pairing = Task {
            do {
                try await Pairing.pair(code: attempt)
                status.stringValue = "Paired. Your office shows the next time the screen saver starts."
            } catch {
                status.stringValue = error.localizedDescription
            }
            code.stringValue = ""
            pairing = nil
        }
    }

    @objc private func close() {
        if let parent = window.sheetParent {
            parent.endSheet(window)
        } else {
            window.close()
        }
    }
}
