// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AgentDeck",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "AgentDeck", path: "Sources/AgentDeck")
    ]
)
