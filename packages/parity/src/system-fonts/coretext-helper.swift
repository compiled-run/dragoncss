// Dragon's build-time Core Text helper (packages/parity/src/system-fonts/coretext.ts): reads one JSON request per line on stdin
// and writes one JSON reply per line. It shapes with the Mac's own system font as iOS builds it, so Dragon lays text out with the
// advances the device draws with; it never writes a font file.
import AppKit
import CoreText
import Foundation

struct Fail: Error { let message: String }

var registered: [String: CGFont] = [:]

func weightOf(_ w: Double) -> NSFont.Weight { NSFont.Weight(rawValue: CGFloat(w)) }

func font(_ spec: [String: Any], _ size: Double) throws -> CTFont {
	switch spec["kind"] as? String {
	case "system":
		guard let w = spec["weight"] as? Double else { throw Fail(message: "a system face needs a weight") }
		let base = NSFont.systemFont(ofSize: CGFloat(size), weight: weightOf(w))
		guard let design = spec["design"] as? String, design != "default" else { return base as CTFont }
		let key: NSFontDescriptor.SystemDesign
		switch design {
		case "serif": key = .serif
		case "monospaced": key = .monospaced
		case "rounded": key = .rounded
		default: throw Fail(message: "unknown system design \(design)")
		}
		guard let d = base.fontDescriptor.withDesign(key), let f = NSFont(descriptor: d, size: CGFloat(size)) else { throw Fail(message: "no system font of design \(design)") }
		return f as CTFont
	case "name":
		guard let name = spec["postScriptName"] as? String else { throw Fail(message: "a named face needs a postScriptName") }
		let f = CTFontCreateWithName(name as CFString, CGFloat(size), nil)
		let got = CTFontCopyPostScriptName(f) as String
		if got != name { throw Fail(message: "Core Text has no font \(name) (it gave \(got))") }
		return f
	case "data":
		guard let key = spec["sha256"] as? String, let cg = registered[key] else { throw Fail(message: "no registered font \(String(describing: spec["sha256"]))") }
		return CTFontCreateWithGraphicsFont(cg, CGFloat(size), nil, nil)
	case "cascade":
		guard let base = spec["base"] as? [String: Any], let text = spec["text"] as? String, let name = spec["postScriptName"] as? String else { throw Fail(message: "a cascade face needs base, text and postScriptName") }
		let f = CTFontCreateForString(try font(base, size), text as CFString, CFRange(location: 0, length: text.utf16.count))
		let got = CTFontCopyPostScriptName(f) as String
		if got != name { throw Fail(message: "Core Text's cascade draws \(text) in \(got), not \(name)") }
		return f
	default:
		throw Fail(message: "unknown face kind \(String(describing: spec["kind"]))")
	}
}

/// An author font file the build measures, kept by its SHA-256 for later data faces.
func register(_ r: [String: Any]) throws {
	guard let key = r["sha256"] as? String, let b64 = r["bytes"] as? String, let data = Data(base64Encoded: b64),
		let provider = CGDataProvider(data: data as CFData), let cg = CGFont(provider) else { throw Fail(message: "register needs sha256 and the base64 bytes of a font Core Text reads") }
	registered[key] = cg
}

/// One face of a font file (a collection's by PostScript name), kept under key for later data faces: an iOS runtime's own font.
func registerFile(_ r: [String: Any]) throws {
	guard let key = r["key"] as? String, let path = r["path"] as? String, let name = r["postScriptName"] as? String else { throw Fail(message: "registerFile needs key, path and postScriptName") }
	let descriptors = (CTFontManagerCreateFontDescriptorsFromURL(URL(fileURLWithPath: path) as CFURL) as? [CTFontDescriptor]) ?? []
	guard let d = descriptors.first(where: { (CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String) == name }) else { throw Fail(message: "\(path) has no face \(name)") }
	registered[key] = CTFontCopyGraphicsFont(CTFontCreateWithFontDescriptor(d, 12, nil), nil)
}

func table(_ f: CTFont, _ tag: String) -> Data? {
	let t = tag.utf8.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
	return CTFontCopyTable(f, CTFontTableTag(t), []) as Data?
}

func i16(_ d: Data, _ at: Int) -> Int { Int(Int16(bitPattern: UInt16(d[d.startIndex + at]) << 8 | UInt16(d[d.startIndex + at + 1]))) }

func glyph(_ f: CTFont, _ ch: UniChar) -> CGGlyph {
	var c = ch
	var g: CGGlyph = 0
	return CTFontGetGlyphsForCharacters(f, &c, &g, 1) ? g : 0
}

func advance(_ f: CTFont, _ g: CGGlyph) -> Double {
	var gg = g
	return CTFontGetAdvancesForGlyphs(f, .horizontal, &gg, nil, 1)
}

/// The face at a size: its names, units per em, Core Text's metrics at the size, and its hhea and OS/2 values in font units.
func describe(_ spec: [String: Any], _ size: Double) throws -> [String: Any] {
	let f = try font(spec, size)
	let upem = Double(CTFontGetUnitsPerEm(f))
	let hhea = table(f, "hhea")
	let os2 = table(f, "OS/2")
	let x = glyph(f, 0x78)
	let zero = glyph(f, 0x30)
	let ellipsis = glyph(f, 0x2026)
	var xg = x
	var rect = CGRect.zero
	CTFontGetBoundingRectsForGlyphs(f, .horizontal, &xg, &rect, 1)
	let url = CTFontCopyAttribute(f, kCTFontURLAttribute) as? URL
	var variation: [String: Double] = [:]
	if let v = CTFontCopyVariation(f) as? [NSNumber: NSNumber] {
		for (k, value) in v {
			let t = k.uint32Value
			let tag = String(bytes: [UInt8(t >> 24), UInt8((t >> 16) & 255), UInt8((t >> 8) & 255), UInt8(t & 255)], encoding: .ascii) ?? "?"
			variation[tag] = value.doubleValue
		}
	}
	return [
		"postScriptName": CTFontCopyPostScriptName(f) as String,
		"familyName": CTFontCopyFamilyName(f) as String,
		"file": url?.path ?? NSNull(),
		"variation": variation,
		"size": Double(CTFontGetSize(f)),
		"unitsPerEm": upem,
		"ascent": Double(CTFontGetAscent(f)),
		"descent": Double(CTFontGetDescent(f)),
		"leading": Double(CTFontGetLeading(f)),
		"xHeight": Double(CTFontGetXHeight(f)),
		"capHeight": Double(CTFontGetCapHeight(f)),
		"xTop": Double(rect.maxY),
		"zeroAdvance": zero == 0 ? -1 : advance(f, zero),
		"ellipsisAdvance": ellipsis == 0 ? -1 : advance(f, ellipsis),
		"hhea": hhea.map { ["ascender": i16($0, 4), "descender": i16($0, 6), "lineGap": i16($0, 8)] } ?? NSNull(),
		"os2": os2.map { ["sCapHeight": $0.count >= 90 ? i16($0, 88) : 0, "sxHeight": $0.count >= 88 ? i16($0, 86) : 0] } ?? NSNull(),
	]
}

/// text[start, end) shaped by Core Text with the whole text as context (one typesetter, one line of the range), as HarfBuzz's
/// output: glyph id, UTF-16 cluster, x and y advance, x and y offset in 16.16, flags 0. A space's advance is the font's own
/// space advance, dropping kerning Core Text put on the space (docs/system-fonts.md "Spaces" says what Safari evidence backs it). A run
/// Core Text draws in another font (its cascade) comes back as glyph 0, .notdef, for the engine's font fallback.
func shape(_ r: [String: Any]) throws -> [String: Any] {
	guard let spec = r["face"] as? [String: Any], let size = r["size"] as? Double, let text = r["text"] as? String,
		let start = r["start"] as? Int, let end = r["end"] as? Int else { throw Fail(message: "a shape request is { face, size, text, start, end, features }") }
	let f0 = try font(spec, size)
	var settings: [[String: Any]] = []
	for feature in (r["features"] as? [[String: Any]]) ?? [] {
		guard let tag = feature["tag"] as? String, let value = feature["value"] as? Int else { throw Fail(message: "a bad feature") }
		if (feature["start"] as? Int ?? 0) > start || (feature["end"] as? Int ?? Int.max) < end { throw Fail(message: "feature \(tag) covers part of the range, which the helper does not apply") }
		settings.append([kCTFontOpenTypeFeatureTag as String: tag, kCTFontOpenTypeFeatureValue as String: value])
	}
	let f = settings.isEmpty ? f0 : CTFontCreateCopyWithAttributes(f0, 0, nil, CTFontDescriptorCreateWithAttributes([kCTFontFeatureSettingsAttribute: settings] as CFDictionary))
	var attributes: [NSAttributedString.Key: Any] = [.init(kCTFontAttributeName as String): f]
	if let language = r["language"] as? String { attributes[.init(kCTLanguageAttributeName as String)] = language }
	let s = NSAttributedString(string: text, attributes: attributes)
	let units = Array(text.utf16)
	if start < 0 || end > units.count || start > end { throw Fail(message: "range \(start)..<\(end) is outside the text") }
	let typesetter = CTTypesetterCreateWithAttributedString(s)
	let line = CTTypesetterCreateLine(typesetter, CFRange(location: start, length: end - start))
	var out: [Int] = []
	let want = CTFontCopyPostScriptName(f) as String
	let space = glyph(f, 0x20)
	let spaceAdvance = space == 0 ? 0 : advance(f, space)
	var pen = 0.0
	for run in CTLineGetGlyphRuns(line) as! [CTRun] {
		let n = CTRunGetGlyphCount(run)
		let runAttributes = CTRunGetAttributes(run) as! [String: Any]
		let used = runAttributes[kCTFontAttributeName as String] as! CTFont
		let name = CTFontCopyPostScriptName(used) as String
		if CTRunGetStatus(run).contains(.rightToLeft) { throw Fail(message: "a right-to-left run, which the helper does not shape") }
		if name != want {
			// A run in another font is the face's .notdef to the engine, as HarfBuzz gives it; the engine asks for its fallback.
			var indices = [CFIndex](repeating: 0, count: n)
			CTRunGetStringIndices(run, CFRange(), &indices)
			for k in 0..<n { out += [0, indices[k], 0, 0, 0, 0, 0] }
			pen += CTRunGetTypographicBounds(run, CFRange(), nil, nil, nil)
			continue
		}
		var glyphs = [CGGlyph](repeating: 0, count: n)
		var positions = [CGPoint](repeating: .zero, count: n)
		var advances = [CGSize](repeating: .zero, count: n)
		var indices = [CFIndex](repeating: 0, count: n)
		CTRunGetGlyphs(run, CFRange(), &glyphs)
		CTRunGetPositions(run, CFRange(), &positions)
		CTRunGetAdvances(run, CFRange(), &advances)
		CTRunGetStringIndices(run, CFRange(), &indices)
		for k in 0..<n {
			let isSpace = indices[k] < units.count && units[indices[k]] == 0x20 && glyphs[k] == space
			let width = isSpace ? spaceAdvance : Double(advances[k].width)
			out += [Int(glyphs[k]), indices[k], Int((width * 65536).rounded()), Int((Double(advances[k].height) * 65536).rounded()),
				Int(((Double(positions[k].x) - pen) * 65536).rounded()), Int((Double(positions[k].y) * 65536).rounded()), 0]
			pen += Double(advances[k].width)
		}
	}
	return ["glyphs": out, "width": CTLineGetTypographicBounds(line, nil, nil, nil)]
}

/// The one font Core Text draws all of text[start, end) in, when that is not the face's own (its cascade), with the font file's path;
/// none when the face draws some of it or Core Text splits it between fonts.
func fallback(_ r: [String: Any]) throws -> [String: Any] {
	guard let spec = r["face"] as? [String: Any], let size = r["size"] as? Double, let text = r["text"] as? String,
		let start = r["start"] as? Int, let end = r["end"] as? Int else { throw Fail(message: "a fallback request is { face, size, text, start, end }") }
	let f = try font(spec, size)
	var attributes: [NSAttributedString.Key: Any] = [.init(kCTFontAttributeName as String): f]
	if let language = r["language"] as? String { attributes[.init(kCTLanguageAttributeName as String)] = language }
	let units = text.utf16.count
	if start < 0 || end > units || start >= end { throw Fail(message: "range \(start)..<\(end) is outside the text") }
	let typesetter = CTTypesetterCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
	let line = CTTypesetterCreateLine(typesetter, CFRange(location: start, length: end - start))
	let want = CTFontCopyPostScriptName(f) as String
	var used: CTFont? = nil
	for run in CTLineGetGlyphRuns(line) as! [CTRun] {
		let g = (CTRunGetAttributes(run) as! [String: Any])[kCTFontAttributeName as String] as! CTFont
		let name = CTFontCopyPostScriptName(g) as String
		if name == want { return ["postScriptName": "", "path": ""] }
		if let u = used, (CTFontCopyPostScriptName(u) as String) != name { return ["postScriptName": "", "path": ""] }
		used = g
	}
	guard let u = used, let url = CTFontCopyAttribute(u, kCTFontURLAttribute) as? URL else { return ["postScriptName": "", "path": ""] }
	return ["postScriptName": CTFontCopyPostScriptName(u) as String, "path": url.path]
}

setvbuf(stdout, nil, _IOLBF, 0)
while let line = readLine(strippingNewline: true) {
	var reply: [String: Any]
	do {
		guard let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { throw Fail(message: "a request is a JSON object") }
		switch request["op"] as? String {
		case "describe":
			guard let spec = request["face"] as? [String: Any], let size = request["size"] as? Double else { throw Fail(message: "describe needs face and size") }
			reply = ["ok": true, "face": try describe(spec, size)]
		case "register":
			try register(request)
			reply = ["ok": true]
		case "registerFile":
			try registerFile(request)
			reply = ["ok": true]
		case "fallback":
			reply = ["ok": true] .merging(try fallback(request)) { a, _ in a }
		case "shape":
			reply = ["ok": true] .merging(try shape(request)) { a, _ in a }
		default:
			throw Fail(message: "unknown op")
		}
	} catch let e as Fail {
		reply = ["ok": false, "error": e.message]
	} catch {
		reply = ["ok": false, "error": "\(error)"]
	}
	let data = try! JSONSerialization.data(withJSONObject: reply)
	FileHandle.standardOutput.write(data)
	FileHandle.standardOutput.write(Data("\n".utf8))
}
