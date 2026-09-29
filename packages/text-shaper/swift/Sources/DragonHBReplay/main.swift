// Host replay: dragon-hb-replay <transcript.json> <repo root>. Exit 0 only with 0 mismatches.
import DragonHBShaper
import Foundation

exit(replayMain(target: "swift (aarch64-macos)", arguments: Array(CommandLine.arguments.dropFirst())))
