import CoreGraphics
import Foundation

/// The Mac's mouse, driven from the stick in cursor mode.
///
/// The phone streams one line per animation frame:
///
///     m <dx> <dy>   move by that many points
///     s <dx> <dy>   scroll by that many pixels
///     c             click
///     r             right-click
///
/// Posting mouse events needs Accessibility permission.
final class Pointer {
    private let source = CGEventSource(stateID: .hidSystemState)
    private var lastClick = Date.distantPast
    private var lastClickAt = CGPoint.zero
    private var clickCount: Int64 = 1

    /// The furthest one message may move or scroll. A frame of real finger
    /// movement is far less; anything beyond is clamped, not obeyed.
    private static let maxStep = 2000.0

    func handle(_ line: String) {
        let parts = line.split(separator: " ")
        guard let command = parts.first else { return }
        let numbers = parts.dropFirst()
            .compactMap { Double($0) }
            .filter(\.isFinite)
            .map { min(max($0, -Pointer.maxStep), Pointer.maxStep) }
        switch (command, numbers.count) {
        case ("m", 2): move(by: numbers[0], numbers[1])
        case ("s", 2): scroll(by: numbers[0], numbers[1])
        case ("c", 0): click()
        case ("r", 0): rightClick()
        default: break
        }
    }

    private var location: CGPoint { CGEvent(source: nil)?.location ?? .zero }

    private func move(by dx: Double, _ dy: Double) {
        let from = location
        post(.mouseMoved, at: clamped(CGPoint(x: from.x + dx, y: from.y + dy), from: from))
    }

    private func scroll(by dx: Double, _ dy: Double) {
        CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2,
                wheel1: Int32(dy.rounded()), wheel2: Int32(dx.rounded()), wheel3: 0)?
            .post(tap: .cghidEventTap)
    }

    private func click() {
        let point = location
        // macOS reads double-clicks from the click count on the event, so it
        // is counted here, against the user's own double-click speed.
        let interval = UserDefaults.standard.object(forKey: "com.apple.mouse.doubleClickThreshold") as? Double ?? 0.5
        let near = abs(point.x - lastClickAt.x) < 6 && abs(point.y - lastClickAt.y) < 6
        clickCount = Date().timeIntervalSince(lastClick) < interval && near ? clickCount + 1 : 1
        lastClick = Date()
        lastClickAt = point
        post(.leftMouseDown, at: point, clicks: clickCount)
        post(.leftMouseUp, at: point, clicks: clickCount)
    }

    private func rightClick() {
        let point = location
        post(.rightMouseDown, at: point, button: .right)
        post(.rightMouseUp, at: point, button: .right)
    }

    private func post(_ type: CGEventType, at point: CGPoint, button: CGMouseButton = .left, clicks: Int64 = 1) {
        let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button)
        event?.setIntegerValueField(.mouseEventClickState, value: clicks)
        event?.post(tap: .cghidEventTap)
    }

    /// Lets the cursor cross from one display to another but never leave them all.
    private func clamped(_ point: CGPoint, from origin: CGPoint) -> CGPoint {
        var count: UInt32 = 0
        CGGetActiveDisplayList(0, nil, &count)
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        CGGetActiveDisplayList(count, &ids, &count)
        let screens = ids.map(CGDisplayBounds)

        if screens.contains(where: { $0.contains(point) }) { return point }
        let home = screens.first(where: { $0.contains(origin) }) ?? screens.first ?? .zero
        return CGPoint(x: min(max(point.x, home.minX), home.maxX - 1),
                       y: min(max(point.y, home.minY), home.maxY - 1))
    }
}
