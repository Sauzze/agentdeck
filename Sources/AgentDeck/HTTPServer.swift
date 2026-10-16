import CryptoKit
import Foundation
import Network

/// A small HTTP/1.1 server: enough for a handful of pages, a JSON API, one
/// Server-Sent Events stream per phone, and one WebSocket for the cursor.
/// Everything runs on the main queue.
final class HTTPServer {
    private let port: UInt16
    private let router: Router
    private var listener: NWListener?
    var onFailure: (Error) -> Void = { _ in }

    init(port: UInt16, router: Router) {
        self.port = port
        self.router = router
    }

    func start() throws {
        let listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
        listener.newConnectionHandler = { [router] connection in
            HTTPConnection(connection, router: router).start()
        }
        listener.stateUpdateHandler = { [weak self] state in
            if case .failed(let error) = state { self?.onFailure(error) }
        }
        listener.start(queue: .main)
        self.listener = listener
    }
}

struct Request {
    let method: String
    let path: String
    let query: [String: String]
    let headers: [String: String] // names lowercased
    let body: Data
    /// Sent from this Mac to a local name: see `HTTPConnection.isLocal`.
    let isLocal: Bool
    /// Addressed to an IP address or a local name, as a phone on the network
    /// would. A web page using DNS rebinding arrives under its own domain.
    let isAddressedDirectly: Bool

    var json: [String: Any] {
        (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
    }
}

struct Response {
    var status = 200
    var contentType = "text/plain; charset=utf-8"
    var body = Data()

    static func status(_ code: Int, _ message: String = "") -> Response {
        Response(status: code, body: Data(message.utf8))
    }

    static func json(_ object: Any, status: Int = 200) -> Response {
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
        return Response(status: status, contentType: "application/json", body: data)
    }

    static func file(_ url: URL) -> Response {
        guard let data = try? Data(contentsOf: url) else { return .status(404) }
        let type = url.pathExtension == "png" ? "image/png" : "text/html; charset=utf-8"
        return Response(contentType: type, body: data)
    }

    fileprivate static let reasons = [
        200: "OK", 204: "No Content", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
        404: "Not Found", 409: "Conflict", 500: "Internal Server Error",
    ]
}

/// How a request is answered: a plain response, or the connection is kept
/// and handed over as an event stream or a WebSocket.
enum Reply {
    case response(Response)
    case eventStream((EventStream) -> Void)
    case webSocket((WebSocket) -> Void)
}

protocol Router: AnyObject {
    func handle(_ request: Request, reply: @escaping (Reply) -> Void)
}

// MARK: - Connections

private final class HTTPConnection {
    /// Longer than any real request takes to arrive; a client that sends
    /// less in this time is holding a socket open for nothing.
    static let requestTimeout: TimeInterval = 10
    static let maxRequestSize = 1 << 20

    private let connection: NWConnection
    private let router: Router
    private var buffer = Data()
    private var answered = false

    init(_ connection: NWConnection, router: Router) {
        self.connection = connection
        self.router = router
    }

    func start() {
        connection.start(queue: .main)
        DispatchQueue.main.asyncAfter(deadline: .now() + HTTPConnection.requestTimeout) { [self] in
            if !answered { connection.cancel() }
        }
        receive()
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [self] data, _, isComplete, error in
            if let data { buffer.append(data) }
            guard buffer.count <= HTTPConnection.maxRequestSize else { return connection.cancel() }
            if let request = parse() {
                answered = true
                route(request)
            } else if isComplete || error != nil {
                connection.cancel()
            } else {
                receive()
            }
        }
    }

    /// A complete request from the buffer, or nil if more has to arrive.
    private func parse() -> Request? {
        guard let end = buffer.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        var lines = String(decoding: buffer[..<end.lowerBound], as: UTF8.self).components(separatedBy: "\r\n")
        let requestLine = lines.removeFirst().split(separator: " ")
        guard requestLine.count >= 2 else {
            connection.cancel()
            return nil
        }

        var headers: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[line[..<colon].lowercased()] = value
        }

        let length = headers["content-length"].map { Int($0) ?? -1 } ?? 0
        guard length >= 0, length <= HTTPConnection.maxRequestSize else {
            connection.cancel()
            return nil
        }
        guard buffer.count - end.upperBound >= length else { return nil }
        let body = buffer.subdata(in: end.upperBound..<end.upperBound + length)

        let components = URLComponents(string: "http://deck" + requestLine[1])
        var query: [String: String] = [:]
        for item in components?.queryItems ?? [] { query[item.name] = item.value ?? "" }

        let host = (headers["host"] ?? "").replacingOccurrences(of: #":\d+$"#, with: "", options: .regularExpression)
        return Request(method: String(requestLine[0]), path: components?.path ?? "/", query: query,
                       headers: headers, body: body,
                       isLocal: isLoopback && ["localhost", "127.0.0.1", "[::1]"].contains(host),
                       isAddressedDirectly: HTTPConnection.isDirectAddress(host))
    }

    private var isLoopback: Bool {
        guard case .hostPort(let address, _) = connection.endpoint else { return false }
        switch address {
        case .ipv4(let ip): return ip.isLoopback
        case .ipv6(let ip): return ip.isLoopback || (ip.asIPv4?.isLoopback ?? false)
        default: return false
        }
    }

    /// An IP address, localhost, or a Bonjour name — never someone's domain.
    private static func isDirectAddress(_ host: String) -> Bool {
        host == "localhost" || host.hasSuffix(".local") || host.hasPrefix("[")
            || host.range(of: #"^\d{1,3}(\.\d{1,3}){3}$"#, options: .regularExpression) != nil
    }

    private func route(_ request: Request) {
        router.handle(request) { [self] reply in
            switch reply {
            case .response(let response):
                send(response)
            case .eventStream(let attach):
                attach(EventStream(connection))
            case .webSocket(let attach):
                guard let key = request.headers["sec-websocket-key"] else { return send(.status(400)) }
                attach(WebSocket(connection, key: key))
            }
        }
    }

    private func send(_ response: Response) {
        let reason = Response.reasons[response.status] ?? ""
        let head = "HTTP/1.1 \(response.status) \(reason)\r\n"
            + "Content-Type: \(response.contentType)\r\n"
            + "Content-Length: \(response.body.count)\r\n"
            + "Cache-Control: no-store\r\n"
            + "Connection: close\r\n\r\n"
        connection.send(content: Data(head.utf8) + response.body, completion: .contentProcessed { [connection] _ in
            connection.cancel()
        })
    }
}

// MARK: - Server-Sent Events

/// A connection kept open to push the deck's state as it changes.
final class EventStream {
    private let connection: NWConnection
    var onClose: () -> Void = {}

    fileprivate init(_ connection: NWConnection) {
        self.connection = connection
        write("HTTP/1.1 200 OK\r\n"
            + "Content-Type: text/event-stream\r\n"
            + "Cache-Control: no-store\r\n"
            + "Connection: keep-alive\r\n\r\n")
        watchForClose()
    }

    func send(_ json: Data) {
        write("data: " + String(decoding: json, as: UTF8.self) + "\n\n")
    }

    /// A comment line, so Safari and anything in between keep an idle stream open.
    func ping() { write(": ping\n\n") }

    private func write(_ text: String) {
        connection.send(content: Data(text.utf8), completion: .contentProcessed { _ in })
    }

    private func watchForClose() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1024) { [weak self] _, _, isComplete, error in
            guard let self else { return }
            if isComplete || error != nil {
                connection.cancel()
                onClose()
            } else {
                watchForClose()
            }
        }
    }
}

// MARK: - WebSocket

/// Just enough WebSocket for the cursor: short text messages from the phone,
/// many a second. A request per move would queue up and the cursor would lag
/// the finger; one open socket does not. Server side only, text frames only,
/// no fragmentation — the phone never sends anything long enough to split.
final class WebSocket {
    private static let handshakeGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11" // RFC 6455, section 1.3
    private static let maxControlPayload = 125 // RFC 6455, section 5.5
    private static let maxBuffered = 1 << 16

    private let connection: NWConnection
    private var buffer = Data()
    var onText: (String) -> Void = { _ in }

    fileprivate init(_ connection: NWConnection, key: String) {
        self.connection = connection
        let digest = Insecure.SHA1.hash(data: Data((key + WebSocket.handshakeGUID).utf8))
        let head = "HTTP/1.1 101 Switching Protocols\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Accept: \(Data(digest).base64EncodedString())\r\n\r\n"
        connection.send(content: Data(head.utf8), completion: .contentProcessed { _ in })
        receive()
    }

    /// The pending receive holds the socket strongly: nothing else does, and it
    /// should live exactly as long as the connection keeps delivering.
    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [self] data, _, isComplete, error in
            if let data { buffer.append(data) }
            while let frame = nextFrame() {
                let isControl = frame.opcode & 0x8 != 0
                if isControl && frame.payload.count > WebSocket.maxControlPayload { return close() }
                switch frame.opcode {
                case 0x1:
                    onText(String(decoding: frame.payload, as: UTF8.self))
                case 0x8:
                    return close()
                case 0x9:
                    let pong = Data([0x8A, UInt8(frame.payload.count)]) + frame.payload
                    connection.send(content: pong, completion: .contentProcessed { _ in })
                default:
                    break
                }
            }
            if isComplete || error != nil || buffer.count > WebSocket.maxBuffered {
                connection.cancel()
            } else {
                receive()
            }
        }
    }

    /// Answers the phone's close frame, then hangs up.
    private func close() {
        connection.send(content: Data([0x88, 0]), completion: .contentProcessed { [connection] _ in
            connection.cancel()
        })
    }

    /// The next whole frame at the front of the buffer, unmasked.
    private func nextFrame() -> (opcode: UInt8, payload: Data)? {
        let bytes = [UInt8](buffer.prefix(14))
        guard bytes.count >= 2 else { return nil }
        let opcode = bytes[0] & 0x0F
        let masked = bytes[1] & 0x80 != 0
        var length = Int(bytes[1] & 0x7F)
        var offset = 2
        if length == 126 {
            guard bytes.count >= 4 else { return nil }
            length = Int(bytes[2]) << 8 | Int(bytes[3])
            offset = 4
        } else if length == 127 {
            connection.cancel() // far beyond anything the cursor sends
            return nil
        }
        let maskOffset = offset
        if masked { offset += 4 }
        guard buffer.count >= offset + length else { return nil }

        let start = buffer.startIndex
        var payload = Data(buffer[(start + offset)..<(start + offset + length)])
        if masked {
            let mask = [UInt8](buffer[(start + maskOffset)..<(start + maskOffset + 4)])
            for i in 0..<payload.count { payload[i] ^= mask[i % 4] }
        }
        buffer.removeFirst(offset + length)
        return (opcode, payload)
    }
}
