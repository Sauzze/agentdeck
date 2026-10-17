import Foundation
import ScreenSaver

/// The screen saver's pairing with SauzzeDeck Pro on this Mac: the key it was
/// given, kept in the screen saver's own defaults, and the requests that use it.
enum Pairing {
    /// SauzzeDeck Pro on this Mac. The port is the app's `Deck.port`.
    private static let base = URL(string: "http://localhost:7710")!
    /// Long enough for a busy Mac, short enough that no answer doesn't keep
    /// the message from showing.
    private static let timeout: TimeInterval = 3
    private static let keyName = "key"
    private static let bundle = Bundle(for: OfficeSaverView.self)
    private static let session = URLSession(configuration: .ephemeral)

    /// Ends the User-Agent, so the setup page can list the screen saver by
    /// name under Paired phones: see the app's `Phones.name(forUserAgent:)`.
    static let userAgentName =
        "SauzzeDeckScreenSaver/\(bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")"

    enum Answer { case paired, unpaired, unreachable }

    static var key: String? {
        get { defaults?.string(forKey: keyName) }
        set {
            defaults?.set(newValue, forKey: keyName)
            defaults?.synchronize()
        }
    }

    /// The office, on a screen of its own, with the key it needs.
    static func officeURL(_ key: String) -> URL {
        var components = URLComponents(url: base.appendingPathComponent("office"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "t", value: key)]
        return components.url!
    }

    /// Whether `url` carries a key. The page drops its own once the app no
    /// longer knows it.
    static func carriesKey(_ url: URL?) -> Bool {
        guard let url, let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return false }
        return items.contains { $0.name == "t" && !($0.value ?? "").isEmpty }
    }

    /// Whether SauzzeDeck Pro is running and still knows `key`. It asks for
    /// the office's stream, which needs a key and changes nothing, and hangs
    /// up as soon as the answer starts.
    static func check(_ key: String) async -> Answer {
        var request = request(path: "events")
        request.setValue(key, forHTTPHeaderField: "X-AgentDeck-Token")
        guard let (bytes, response) = try? await session.bytes(for: request) else { return .unreachable }
        bytes.task.cancel()
        switch (response as? HTTPURLResponse)?.statusCode {
        case 200: return .paired
        case 401: return .unpaired
        default: return .unreachable
        }
    }

    /// Pairs with a code from the setup page and keeps the new key. Throws
    /// with what to tell you if that doesn't work.
    static func pair(code: String) async throws {
        var request = request(path: "pair")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code])
        guard let (data, _) = try? await session.data(for: request) else {
            throw PairingError("Couldn't reach SauzzeDeck Pro. Is it running?")
        }
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: String] ?? [:]
        guard let fresh = body["key"] else {
            throw PairingError(body["error"] ?? "SauzzeDeck Pro didn't pair the screen saver. Try a new code.")
        }
        key = fresh
    }

    /// Kept by macOS for this screen saver alone, wherever its host keeps them.
    private static var defaults: ScreenSaverDefaults? {
        ScreenSaverDefaults(forModuleWithName: bundle.bundleIdentifier ?? "")
    }

    private static func request(path: String) -> URLRequest {
        var request = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: timeout)
        request.setValue(userAgentName, forHTTPHeaderField: "User-Agent")
        return request
    }
}

struct PairingError: LocalizedError {
    let errorDescription: String?

    init(_ message: String) {
        errorDescription = message
    }
}
