import Foundation
import CoreText
import UIKit

let sizes: [CGFloat] = [12, 16, 17, 24, 28]
let strings = ["Hamburgefonstiv", "The quick brown fox jumps over the lazy dog", "Waffles, quays and fjords", "0123456789", "AVATAR Type office", "iiiii WWWWW"]

func boldCopy(_ f: CTFont) -> CTFont? {
    CTFontCreateCopyWithSymbolicTraits(f, 0, nil, .traitBold, .traitBold)
}
func designFont(_ design: UIFontDescriptor.SystemDesign, _ size: CGFloat, _ weight: UIFont.Weight) -> CTFont? {
    let base = UIFont.systemFont(ofSize: size, weight: weight)
    guard let d = base.fontDescriptor.withDesign(design) else { return nil }
    return UIFont(descriptor: d, size: size) as CTFont
}
func withVariation(_ f: CTFont, _ axis: Int, _ value: Double) -> CTFont {
    var vars = (CTFontCopyVariation(f) as? [NSNumber: NSNumber]) ?? [:]
    vars[NSNumber(value: axis)] = NSNumber(value: value)
    let d = CTFontDescriptorCreateWithAttributes([kCTFontVariationAttribute: vars] as CFDictionary)
    return CTFontCreateCopyWithAttributes(f, 0, nil, d)
}
func withFeatures(_ f: CTFont, _ feats: [(String, Int)]) -> CTFont {
    let arr = feats.map { [kCTFontOpenTypeFeatureTag: $0.0, kCTFontOpenTypeFeatureValue: $0.1] as [CFString: Any] }
    let d = CTFontDescriptorCreateWithAttributes([kCTFontFeatureSettingsAttribute: arr] as CFDictionary)
    return CTFontCreateCopyWithAttributes(f, 0, nil, d)
}
func named(_ name: String, _ size: CGFloat) -> CTFont { CTFontCreateWithName(name as CFString, size, nil) }

// candidate id -> (size, bold) -> CTFont?
typealias Maker = (CGFloat, Bool) -> CTFont?
let candidates: [(String, Maker)] = [
    ("UIFont.systemFont", { s, b in UIFont.systemFont(ofSize: s, weight: b ? .bold : .regular) as CTFont }),
    ("UIFont.systemFont(bold=semibold)", { s, b in UIFont.systemFont(ofSize: s, weight: b ? .semibold : .regular) as CTFont }),
    ("UIFont.systemFont(bold=heavy)", { s, b in UIFont.systemFont(ofSize: s, weight: b ? .heavy : .regular) as CTFont }),
    ("CTFontCreateUIFontForLanguage(.system)", { s, b in
        let f = CTFontCreateUIFontForLanguage(.system, s, nil)!
        return b ? boldCopy(f) : f }),
    ("CTFontCreateUIFontForLanguage(.emphasizedSystem)", { s, b in
        b ? CTFontCreateUIFontForLanguage(.emphasizedSystem, s, nil) : CTFontCreateUIFontForLanguage(.system, s, nil) }),
    ("systemDesign.serif", { s, b in designFont(.serif, s, b ? .bold : .regular) }),
    ("systemDesign.monospaced", { s, b in designFont(.monospaced, s, b ? .bold : .regular) }),
    ("systemDesign.rounded", { s, b in designFont(.rounded, s, b ? .bold : .regular) }),
    ("UIFont.monospacedSystemFont", { s, b in UIFont.monospacedSystemFont(ofSize: s, weight: b ? .bold : .regular) as CTFont }),
    ("systemDesign.serif(bold=semibold)", { s, b in designFont(.serif, s, b ? .semibold : .regular) }),
    ("systemDesign.serif(bold=heavy)", { s, b in designFont(.serif, s, b ? .heavy : .regular) }),
    ("systemDesign.serif(bold=wght700)", { s, b in
        guard let f = designFont(.serif, s, .regular) else { return nil }
        return b ? withVariation(f, 2003265652, 700) : f }),
    ("systemDesign.serif(boldTrait)", { s, b in
        guard let f = designFont(.serif, s, .regular) else { return nil }
        return b ? boldCopy(f) : f }),
    ("Helvetica", { s, b in let f = named("Helvetica", s); return b ? boldCopy(f) : f }),
    ("Helvetica Neue", { s, b in let f = named("HelveticaNeue", s); return b ? boldCopy(f) : f }),
    ("Times New Roman", { s, b in let f = named("Times New Roman", s); return b ? boldCopy(f) : f }),
    ("Times", { s, b in let f = named("Times", s); return b ? boldCopy(f) : f }),
    ("Courier", { s, b in let f = named("Courier", s); return b ? boldCopy(f) : f }),
    ("Courier New", { s, b in let f = named("Courier New", s); return b ? boldCopy(f) : f }),
    ("Menlo", { s, b in let f = named("Menlo", s); return b ? boldCopy(f) : f }),
    ("Georgia", { s, b in let f = named("Georgia", s); return b ? boldCopy(f) : f }),
    ("Arial", { s, b in let f = named("Arial", s); return b ? boldCopy(f) : f }),
]

func lineData(_ font: CTFont, _ text: String, kernZero: Bool = false) -> [String: Any] {
    var a: [NSAttributedString.Key: Any] = [kCTFontAttributeName as NSAttributedString.Key: font]
    if kernZero { a[kCTKernAttributeName as NSAttributedString.Key] = 0 }
    let attr = NSAttributedString(string: text, attributes: a)
    let line = CTLineCreateWithAttributedString(attr)
    var asc: CGFloat = 0, desc: CGFloat = 0, lead: CGFloat = 0
    let w = CTLineGetTypographicBounds(line, &asc, &desc, &lead)
    var runs: [[String: Any]] = []
    for run in (CTLineGetGlyphRuns(line) as! [CTRun]) {
        let n = CTRunGetGlyphCount(run)
        var glyphs = [CGGlyph](repeating: 0, count: n)
        var pos = [CGPoint](repeating: .zero, count: n)
        var adv = [CGSize](repeating: .zero, count: n)
        var idx = [CFIndex](repeating: 0, count: n)
        CTRunGetGlyphs(run, CFRange(location: 0, length: n), &glyphs)
        CTRunGetPositions(run, CFRange(location: 0, length: n), &pos)
        CTRunGetAdvances(run, CFRange(location: 0, length: n), &adv)
        CTRunGetStringIndices(run, CFRange(location: 0, length: n), &idx)
        let attrs = CTRunGetAttributes(run) as NSDictionary
        let rf = attrs[kCTFontAttributeName] as! CTFont
        runs.append([
            "font": CTFontCopyPostScriptName(rf) as String,
            "glyphs": glyphs.map { Int($0) },
            "x": pos.map { Double($0.x) },
            "advances": adv.map { Double($0.width) },
            "stringIndices": idx.map { Int($0) },
        ])
    }
    return ["text": text, "width": w, "lineAscent": Double(asc), "lineDescent": Double(desc), "lineLeading": Double(lead), "runs": runs]
}

func segments(_ text: String) -> [String] {
    var segs: [String] = []; var cur = ""; var curSpace: Bool? = nil
    for ch in text { let sp = ch == " "; if curSpace != nil && sp != curSpace! { segs.append(cur); cur = "" }; cur.append(ch); curSpace = sp }
    if !cur.isEmpty { segs.append(cur) }
    return segs
}
func wordSplitData(_ font: CTFont, _ text: String) -> [String: Any] {
    let segs = segments(text)
    let ws = segs.map { (lineData(font, $0)["width"] as! Double) }
    return ["text": text, "width": ws.reduce(0, +), "segments": segs, "segmentWidths": ws]
}
func be16(_ d: Data, _ o: Int) -> Int { Int(Int16(bitPattern: UInt16(d[d.startIndex + o]) << 8 | UInt16(d[d.startIndex + o + 1]))) }
func ube16(_ d: Data, _ o: Int) -> Int { Int(UInt16(d[d.startIndex + o]) << 8 | UInt16(d[d.startIndex + o + 1])) }
func tables(_ f: CTFont) -> [String: Any] {
    var t: [String: Any] = [:]
    if let h = CTFontCopyTable(f, CTFontTableTag(kCTFontTableHhea), []) as Data?, h.count >= 10 {
        t["hhea"] = ["ascender": be16(h, 4), "descender": be16(h, 6), "lineGap": be16(h, 8)]
    }
    if let o = CTFontCopyTable(f, CTFontTableTag(kCTFontTableOS2), []) as Data?, o.count >= 78 {
        t["OS2"] = ["version": ube16(o, 0), "fsSelection": ube16(o, 62), "useTypoMetrics": (ube16(o, 62) & 0x80) != 0,
                    "typoAscender": be16(o, 68), "typoDescender": be16(o, 70), "typoLineGap": be16(o, 72), "winAscent": ube16(o, 74), "winDescent": ube16(o, 76)]
    }
    if let hd = CTFontCopyTable(f, CTFontTableTag(kCTFontTableHead), []) as Data?, hd.count >= 54 {
        t["head"] = ["unitsPerEm": ube16(hd, 18), "yMin": be16(hd, 38), "yMax": be16(hd, 42)]
    }
    return t
}
func fontInfo(_ f: CTFont) -> [String: Any] {
    var info: [String: Any] = [
        "postScriptName": CTFontCopyPostScriptName(f) as String,
        "familyName": CTFontCopyFamilyName(f) as String,
        "fullName": CTFontCopyFullName(f) as String,
        "pointSize": Double(CTFontGetSize(f)),
        "ascent": Double(CTFontGetAscent(f)),
        "descent": Double(CTFontGetDescent(f)),
        "leading": Double(CTFontGetLeading(f)),
        "unitsPerEm": Int(CTFontGetUnitsPerEm(f)),
        "capHeight": Double(CTFontGetCapHeight(f)),
        "xHeight": Double(CTFontGetXHeight(f)),
        "symbolicTraits": Int(CTFontGetSymbolicTraits(f).rawValue),
        "tables": tables(f),
        "uiFontLineHeight": Double((f as UIFont).lineHeight),
        "boundingBox": [Double(CTFontGetBoundingBox(f).minY), Double(CTFontGetBoundingBox(f).maxY)],
    ]
    if let traits = CTFontCopyTraits(f) as? [String: Any], let w = traits[kCTFontWeightTrait as String] as? Double { info["weightTrait"] = w }
    if let url = CTFontCopyAttribute(f, kCTFontURLAttribute) as? URL { info["url"] = url.path }
    if let vars = CTFontCopyVariation(f) as? [NSNumber: NSNumber] { info["variation"] = Dictionary(uniqueKeysWithValues: vars.map { ($0.key.stringValue, $0.value.doubleValue) }) }
    return info
}

var out: [[String: Any]] = []
for (cid, make) in candidates {
    for bold in [false, true] {
        for s in sizes {
            guard let f = make(s, bold) else { out.append(["candidate": cid, "bold": bold, "size": Double(s), "error": "nil font"]); continue }
            out.append(["candidate": cid, "bold": bold, "weight": bold ? 700 : 400, "size": Double(s), "font": fontInfo(f), "lines": strings.map { lineData(f, $0) },
                "variants": [
                    "default": strings.map { lineData(f, $0) },
                    "wordSplit": strings.map { wordSplitData(f, $0) },
                    "kernAttr0": strings.map { lineData(f, $0, kernZero: true) },
                    "kernOff": strings.map { lineData(withFeatures(f, [("kern", 0)]), $0) },
                    "ligaOff": strings.map { lineData(withFeatures(f, [("liga", 0)]), $0) },
                    "kernOff+ligaOff": strings.map { lineData(withFeatures(f, [("kern", 0), ("liga", 0)]), $0) },
                ]])
        }
    }
}
let doc: [String: Any] = ["os": UIDevice.current.systemName + " " + UIDevice.current.systemVersion, "results": out]
let data = try! JSONSerialization.data(withJSONObject: doc, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
