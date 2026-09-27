// Host templates: the SwiftPM manifest and the harness entry points. They call the translated harness; they are not translated.

export function swiftPackage(): string {
  return `import PackageDescription

let package = Package(
  name: "DragonLayout",
  platforms: [.iOS(.v15), .macOS(.v13)],
  products: [.library(name: "DragonLayout", targets: ["DragonLayout"])],
  targets: [
    .target(name: "DragonLayout", path: "Sources/DragonLayout"),
    .executableTarget(name: "DragonLayoutHarness", dependencies: ["DragonLayout"], path: "Sources/DragonLayoutHarness"),
  ]
)
`;
}

export function swiftMain(): string {
  return `import Foundation

// usage: harness engine|units|library|snap <cases.jsonl> <results.jsonl>
let args = CommandLine.arguments
guard args.count == 4, ["engine", "units", "library", "snap"].contains(args[1]) else {
  FileHandle.standardError.write("usage: harness engine|units|library|snap IN OUT\\n".data(using: .utf8)!)
  exit(2)
}
let data = FileManager.default.contents(atPath: args[2])!
var out: [UInt8] = []
var cases = 0
let started = Date()
for slice in data.split(separator: UInt8(ascii: "\\n"), omittingEmptySubsequences: true) {
  let line = JsString(String(decoding: slice, as: UTF8.self))
  var result: JsString
  do {
    switch args[1] {
    case "units": result = try harness_runUnitsCase(line)
    case "library": result = try harness_runLibraryCase(line)
    case "snap": result = try harness_runSnapCase(line)
    default: result = try harness_runEngineCase(line)
    }
  } catch {
    result = JsString("[\\"uncaught\\"]")
  }
  out.append(contentsOf: Array(result.description.utf8))
  out.append(UInt8(ascii: "\\n"))
  cases += 1
}
FileManager.default.createFile(atPath: args[3], contents: Data(out))
FileHandle.standardError.write("cases \\(cases) seconds \\(Date().timeIntervalSince(started))\\n".data(using: .utf8)!)
`;
}

export function kotlinMain(): string {
  return `package dev.dragon.layout

import java.io.File

// usage: harness engine|units|library|snap <cases.jsonl> <results.jsonl>
fun main(args: Array<String>) {
  if (args.size != 3 || args[0] !in listOf("engine", "units", "library", "snap")) {
    System.err.println("usage: harness engine|units|library|snap IN OUT")
    kotlin.system.exitProcess(2)
  }
  val lines = File(args[1]).readText(Charsets.UTF_8).split('\\n').filter { it.isNotEmpty() }
  val started = System.nanoTime()
  val out = StringBuilder()
  for (line in lines) {
    val result = try {
      when (args[0]) {
        "units" -> harness_runUnitsCase(line)
        "library" -> harness_runLibraryCase(line)
        "snap" -> harness_runSnapCase(line)
        else -> harness_runEngineCase(line)
      }
    } catch (e: Throwable) {
      "[\\"uncaught\\"]"
    }
    out.append(result).append('\\n')
  }
  File(args[2]).writeText(out.toString(), Charsets.UTF_8)
  System.err.println("cases \${lines.size} seconds \${(System.nanoTime() - started) / 1e9}")
}
`;
}
