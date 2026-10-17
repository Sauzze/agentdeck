import ScreenSaver
import WebKit

/// The Agent Office as a screen saver: `/office`, the page a spare screen
/// shows, watched rather than used, since any input ends a screen saver.
///
/// It asks SauzzeDeck Pro whether its key still works before showing the
/// page, because the page can't tell it: a key the app no longer knows gets
/// the pairing page instead, as a 200 like the office. Until the answer is
/// yes, a notice says what to do, and the screen saver asks again every few
/// seconds.
///
/// Each display has a view of its own, and so a stream of its own.
///
/// Named for Objective-C as Info.plist's `NSPrincipalClass` names it, and
/// unlike any other screen saver's class, since they load into one process.
@objc(SauzzeDeckOfficeView)
final class OfficeSaverView: ScreenSaverView {
    /// How often to ask again while the office isn't showing.
    private static let retryInterval: TimeInterval = 5
    /// What the page's added script posts to: see `watchOnly`.
    private static let messageName = "saver"
    /// Sent when the screen saver ends, which recent macOS says here even
    /// when it doesn't stop the view.
    private static let willStop = Notification.Name("com.apple.screensaver.willstop")

    /// Added to the office: no cursor, no clicks and no status line, since
    /// nobody can use them here. The status line still says when the page
    /// loses SauzzeDeck Pro, and the screen saver takes over from there.
    private static let watchOnly = """
        const style = document.createElement('style');
        style.textContent = '* { cursor: none !important; } body { pointer-events: none; } .status, .pop-out { display: none !important; }';
        document.head.append(style);
        const status = document.getElementById('status');
        if (status) {
          new MutationObserver(() => {
            if (status.classList.contains('off')) webkit.messageHandlers.\(messageName).postMessage('off');
          }).observe(status, { attributes: true, attributeFilter: ['class'] });
        }
        """

    private let notice: NoticeView
    private var office: WKWebView?
    private var checking: Task<Void, Never>?
    private lazy var options = PairingSheet()

    override init?(frame: NSRect, isPreview: Bool) {
        notice = NoticeView(frame: NSRect(origin: .zero, size: frame.size), isPreview: isPreview)
        super.init(frame: frame, isPreview: isPreview)
        // Each tick asks again, if it needs to. The office animates itself.
        animationTimeInterval = OfficeSaverView.retryInterval
        notice.autoresizingMask = [.width, .height]
        addSubview(notice)
    }

    required init?(coder: NSCoder) { nil }

    override var hasConfigureSheet: Bool { true }

    override var configureSheet: NSWindow? { options.open() }

    override func startAnimation() {
        super.startAnimation()
        if !isPreview {
            DistributedNotificationCenter.default().addObserver(self, selector: #selector(screenSaverWillStop),
                                                                name: OfficeSaverView.willStop, object: nil)
        }
        check()
    }

    override func stopAnimation() {
        super.stopAnimation()
        checking?.cancel()
        checking = nil
        closeOffice()
        DistributedNotificationCenter.default().removeObserver(self, name: OfficeSaverView.willStop, object: nil)
    }

    override func animateOneFrame() {
        if office == nil { check() }
    }

    override func draw(_ dirtyRect: NSRect) {
        NoticeView.body.setFill()
        dirtyRect.fill()
    }

    @objc private func screenSaverWillStop() { stopAnimation() }

    /// Shows the office if SauzzeDeck Pro is running and still knows the
    /// key, and otherwise says why not.
    private func check() {
        guard checking == nil else { return }
        guard let key = Pairing.key else { return notice.show(.notPaired) }
        checking = Task { [weak self] in
            let answer = await Pairing.check(key)
            guard let self, !Task.isCancelled else { return }
            checking = nil
            switch answer {
            case .paired where isPreview: notice.show(.ready)
            case .paired: openOffice(key)
            case .unpaired: notice.show(.unpaired)
            case .unreachable: notice.show(.appClosed)
            }
        }
    }

    private func openOffice(_ key: String) {
        let configuration = WKWebViewConfiguration()
        configuration.applicationNameForUserAgent = Pairing.userAgentName
        // Silent: nothing may play without a click, and a click ends the screen saver.
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        // Nothing the page keeps is worth keeping between runs.
        configuration.websiteDataStore = .nonPersistent()
        let content = configuration.userContentController
        content.addUserScript(WKUserScript(source: OfficeSaverView.watchOnly, injectionTime: .atDocumentEnd,
                                           forMainFrameOnly: true))
        content.add(WeakMessageHandler(self), name: OfficeSaverView.messageName)

        let web = WKWebView(frame: bounds, configuration: configuration)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        // Out of sight until the room is drawn, so nothing flashes white first.
        web.isHidden = true
        addSubview(web)
        web.load(URLRequest(url: Pairing.officeURL(key)))
        office = web
    }

    /// Lets the page go, and the processes WebKit started for it.
    private func closeOffice() {
        guard let web = office else { return }
        office = nil
        web.stopLoading()
        web.navigationDelegate = nil
        web.configuration.userContentController.removeAllScriptMessageHandlers()
        web.removeFromSuperview()
        notice.show(nil)
        notice.isHidden = false
    }

    /// The office stopped working: back to asking why.
    private func lost() {
        closeOffice()
        check()
    }
}

extension OfficeSaverView: WKNavigationDelegate {
    /// The page lets go of its key when the app no longer knows it, and
    /// heads for the pairing page. The screen saver finds out for itself.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard action.targetFrame?.isMainFrame == true, !Pairing.carriesKey(action.request.url) else { return .allow }
        lost()
        return .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.isHidden = false
        notice.isHidden = true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { lost() }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        lost()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { lost() }
}

extension OfficeSaverView: WKScriptMessageHandler {
    /// The page lost SauzzeDeck Pro: see `watchOnly`.
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) { lost() }
}

/// Passes the page's messages on without keeping the view alive: the web
/// view keeps its handlers, and the view keeps the web view.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
