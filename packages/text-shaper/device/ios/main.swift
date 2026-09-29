// iOS simulator replay (T029): compiled by scripts/replay-device.ts in one module with swift/Sources/DragonHBShaper
// against DragonHB.xcframework's simulator slice, then run with `xcrun simctl spawn`. Arguments: <transcript.json> <root>.
import Foundation

exit(replayMain(target: "swift (ios simulator, arm64)", arguments: Array(CommandLine.arguments.dropFirst())))
