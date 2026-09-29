// swift-tools-version:5.9
// DragonHBShaper: Swift over dragon_hb's C ABI (../include/dragon_hb.h). On macOS it links zig-out/host/libdragon_hb.a
// (`zig build host`; pass `-Xlinker -L -Xlinker <zig-out/host>`); on iOS, DragonHB.xcframework (`zig build ios`).
import PackageDescription

let package = Package(
    name: "DragonHBShaper",
    platforms: [.macOS(.v13), .iOS(.v15)],
    products: [
        .library(name: "DragonHBShaper", targets: ["DragonHBShaper"]),
        .executable(name: "dragon-hb-replay", targets: ["DragonHBReplay"]),
    ],
    targets: [
        .systemLibrary(name: "CDragonHB", path: "Sources/CDragonHB"),
        .target(name: "DragonHBShaper", dependencies: ["CDragonHB"]),
        .executableTarget(name: "DragonHBReplay", dependencies: ["DragonHBShaper"]),
    ]
)
