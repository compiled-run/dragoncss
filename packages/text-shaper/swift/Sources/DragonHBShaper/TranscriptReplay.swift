// Replays a dragon-shape-transcript/1 (packages/text-shaper/src/transcript.ts) through the native shim and compares
// every integer. Used by the macOS host replay (DragonHBReplay) and the iOS simulator harness (device/ios).
import CryptoKit
import Foundation

public struct ReplayMismatch {
    public let call: Int
    public let op: String
    public let detail: String
}

public struct ReplayReport {
    public var calls = 0
    public var shapeCalls = 0
    public var glyphs = 0
    public var mismatches: [ReplayMismatch] = []

    public var summary: String {
        "\(calls) calls (\(shapeCalls) shape, \(glyphs) glyphs), \(mismatches.count) mismatches"
    }
}

public enum ReplayError: Error, CustomStringConvertible {
    case badTranscript(String)
    case faceHash(file: String, got: String, expected: String)

    public var description: String {
        switch self {
        case .badTranscript(let s): return "bad transcript: \(s)"
        case .faceHash(let file, let got, let expected): return "face \(file): sha256 \(got), transcript \(expected)"
        }
    }
}

private func obj(_ v: Any?, _ what: String) throws -> [String: Any] {
    guard let o = v as? [String: Any] else { throw ReplayError.badTranscript(what) }
    return o
}

private func arr(_ v: Any?, _ what: String) throws -> [Any] {
    guard let a = v as? [Any] else { throw ReplayError.badTranscript(what) }
    return a
}

private func num(_ v: Any?, _ what: String) throws -> NSNumber {
    guard let n = v as? NSNumber else { throw ReplayError.badTranscript(what) }
    return n
}

private func str(_ v: Any?, _ what: String) throws -> String {
    guard let s = v as? String else { throw ReplayError.badTranscript(what) }
    return s
}

private func int(_ v: Any?, _ what: String) throws -> Int64 { try num(v, what).int64Value }

/// A JSON number as the shim's f32 argument: parsed as a double, then rounded to f32 (as JS ToFloat32 does).
private func f32(_ v: Any?, _ what: String) throws -> Float { Float(try num(v, what).doubleValue) }

public func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

/// Face files are read from root/<face.file>; their sha256 must equal the transcript's.
public func replayTranscript(json: Data, root: URL) throws -> ReplayReport {
    let t = try obj(try JSONSerialization.jsonObject(with: json), "top level")
    guard (t["format"] as? String) == "dragon-shape-transcript/1" else { throw ReplayError.badTranscript("format") }
    let shaper = try DragonHBShaper()
    var faces: [DragonHBFace] = []
    for f in try arr(t["faces"], "faces") {
        let face = try obj(f, "face")
        let file = try str(face["file"], "face.file")
        let data = try Data(contentsOf: root.appendingPathComponent(file))
        let sha = sha256Hex(data)
        let expected = try str(face["sha256"], "face.sha256")
        guard sha == expected else { throw ReplayError.faceHash(file: file, got: sha, expected: expected) }
        faces.append(try DragonHBFace(bytes: [UInt8](data)))
    }
    var fonts: [DragonHBFont] = []
    for f in try arr(t["fonts"], "fonts") {
        let font = try obj(f, "font")
        fonts.append(try DragonHBFont(
            face: faces[Int(try int(font["face"], "font.face"))],
            size: try f32(font["size"], "font.size"),
            specifiedSize: try f32(font["specifiedSize"], "font.specifiedSize"),
            weight: try f32(font["weight"], "font.weight"),
            width: try f32(font["width"], "font.width"),
            slope: try f32(font["slope"], "font.slope"),
            opticalSizingAuto: (font["opticalSizingAuto"] as? Bool) ?? true))
    }
    let texts = try arr(t["texts"], "texts").map { Array(try str($0, "text").utf16) }
    var report = ReplayReport()
    for (i, c) in try arr(t["calls"], "calls").enumerated() {
        let call = try obj(c, "call")
        let font = fonts[Int(try int(call["font"], "call.font"))]
        report.calls += 1
        switch try str(call["op"], "call.op") {
        case "shape":
            report.shapeCalls += 1
            let features = try arr(call["features"], "features").map { f -> DragonHBFeature in
                let a = try arr(f, "feature")
                return DragonHBFeature(tag: try DragonHBShaper.tag(try str(a[0], "feature tag")), value: UInt32(try int(a[1], "feature value")),
                                       start: UInt32(try int(a[2], "feature start")), end: UInt32(try int(a[3], "feature end")))
            }
            let got = try shaper.shape(font: font, text: texts[Int(try int(call["text"], "call.text"))], start: Int(try int(call["start"], "start")),
                                       end: Int(try int(call["end"], "end")), script: try str(call["script"], "script"), rtl: (call["rtl"] as? Bool) ?? false,
                                       language: try str(call["language"], "language"), features: features)
            let expected = try arr(call["glyphs"], "glyphs").map { try int($0, "glyph int") }
            report.glyphs += got.count / DragonHBShaper.glyphStride
            if got.count != expected.count {
                report.mismatches.append(ReplayMismatch(call: i, op: "shape", detail: "length \(got.count), expected \(expected.count)"))
            } else if let at = got.indices.first(where: { Int64(got[$0]) != expected[$0] }) {
                report.mismatches.append(ReplayMismatch(call: i, op: "shape", detail: "int \(at): \(Int64(got[at])), expected \(expected[at])"))
            }
        case "nominal":
            let cp = UInt32(try int(call["codepoint"], "codepoint"))
            let got = Int64(font.nominalGlyph(cp))
            let expected = try int(call["glyph"], "glyph")
            if got != expected { report.mismatches.append(ReplayMismatch(call: i, op: "nominal", detail: "U+\(String(cp, radix: 16)): \(got), expected \(expected)")) }
        case "advance":
            let glyph = UInt32(try int(call["glyph"], "glyph"))
            let got = Int64(font.glyphAdvance(glyph))
            let expected = try int(call["advance"], "advance")
            if got != expected { report.mismatches.append(ReplayMismatch(call: i, op: "advance", detail: "glyph \(glyph): \(got), expected \(expected)")) }
        case let op:
            throw ReplayError.badTranscript("op \(op)")
        }
    }
    return report
}

/// The replay CLI body shared by the host and simulator executables: prints the report, returns the exit code.
public func replayMain(target: String, arguments: [String]) -> Int32 {
    guard arguments.count == 2 else {
        FileHandle.standardError.write("usage: <transcript.json> <repo root>\n".data(using: .utf8)!)
        return 2
    }
    do {
        let report = try replayTranscript(json: try Data(contentsOf: URL(fileURLWithPath: arguments[0])), root: URL(fileURLWithPath: arguments[1]))
        print("replay \(target): \(report.summary)")
        for m in report.mismatches.prefix(5) { print("  MISMATCH call \(m.call) \(m.op): \(m.detail)") }
        return report.mismatches.isEmpty ? 0 : 1
    } catch {
        print("replay \(target): error: \(error)")
        return 1
    }
}
