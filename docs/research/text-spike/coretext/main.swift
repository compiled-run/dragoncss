// Core Text / TextKit 1 (macOS) line breaking vs Chrome. Usage: main <cases.json> <chrome-opps.json> <out.json>
import Foundation
import CoreText
import AppKit

struct Case: Codable { let id, font, file, para, text, lang: String; let size, width: Double }
struct Opp: Codable { let lang, para, font, text: String; let opps: [Int] }
let args = CommandLine.arguments
let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
let oppList = try JSONDecoder().decode([Opp].self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
var chromeOpps: [String: [Int]] = [:]; for o in oppList { chromeOpps[o.lang + "|" + o.para] = o.opps }

var descCache: [String: CTFontDescriptor] = [:]
func ctFont(_ file: String, _ size: Double) -> CTFont {
  if descCache[file] == nil {
    let url = URL(fileURLWithPath: "/tmp/text-spike/fonts/" + file) as CFURL
    let descs = CTFontManagerCreateFontDescriptorsFromURL(url) as! [CTFontDescriptor]
    // Variable fonts expose every named instance; pick the default instance (same PostScript name as the CGFont default).
    let psDefault = CGFont(CGDataProvider(url: url)!)!.postScriptName! as String
    descCache[file] = descs.first { (CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String) == psDefault } ?? descs[0]
  }
  return CTFontCreateWithFontDescriptor(descCache[file]!, CGFloat(size), nil)
}

func icuOpps(_ s: String, _ lang: String) -> [Int] {
  let u = Array(s.utf16); var st: UErrorCode = 0
  let bi = u.withUnsafeBufferPointer { ubrk_open(2 /*UBRK_LINE*/, lang, $0.baseAddress, Int32(u.count), &st) }!
  var r: [Int] = []; _ = ubrk_first(bi)
  while true { let n = ubrk_next(bi); if n < 0 || Int(n) >= u.count { break }; r.append(Int(n)) }
  ubrk_close(bi); return r
}

let SHY: UInt16 = 0x00AD
func isTrailingSpace(_ c: UInt16) -> Bool { c == 0x20 || c == 0x3000 }

struct LineOut: Codable { var start: Int; var end: Int; var width: Double }
struct EngineOut: Codable { var breaks: [Int]; var lines: [LineOut] }
struct CaseOut: Codable {
  var id: String
  var ct: EngineOut; var tk1: EngineOut; var tk1std: EngineOut
  var greedyICU: EngineOut; var greedyOracle: EngineOut
  var icuOpps: [Int]
  var nowrapWidth: Double
  var ascent, descent, leading, tk1DefaultLineHeight, hyphenWidth: Double
}

func lineWidth(_ ts: CTTypesetter, _ u: [UInt16], _ s: Int, _ e: Int) -> Double {
  var te = e; while te > s && isTrailingSpace(u[te - 1]) { te -= 1 }
  if te == s { return 0 }
  let line = CTTypesetterCreateLine(ts, CFRange(location: s, length: te - s))
  return CTLineGetTypographicBounds(line, nil, nil, nil)
}

func greedy(_ ts: CTTypesetter, _ u: [UInt16], _ opps: [Int], _ W: Double, _ hyph: Double) -> EngineOut {
  var start = 0, breaks: [Int] = [], lines: [LineOut] = []
  let all = opps.filter { $0 > 0 && $0 < u.count } + [u.count]
  while start < u.count {
    var best: Int? = nil; var bestW = 0.0
    for o in all where o > start {
      var w = lineWidth(ts, u, start, o)
      if o < u.count && u[o - 1] == SHY { w += hyph }
      // Blink: SnappedWidth ceil to LayoutUnit (1/64 px); fits if <= available + LayoutUnit::Epsilon (NGLineBreaker::AvailableWidthToFit)
      if (w * 64).rounded(.up) / 64 <= W + 1.0 / 64 { best = o; bestW = w } else { if best == nil { best = o; bestW = w }; break }
    }
    let b = best ?? u.count
    lines.append(LineOut(start: start, end: b, width: bestW)); if b < u.count { breaks.append(b) }; start = b
  }
  return EngineOut(breaks: breaks, lines: lines)
}

func textKit(_ attr: NSAttributedString, _ W: Double, _ u: [UInt16], std: Bool) -> EngineOut {
  let a = NSMutableAttributedString(attributedString: attr)
  let ps = NSMutableParagraphStyle(); ps.lineBreakStrategy = std ? .standard : []
  a.addAttribute(.paragraphStyle, value: ps, range: NSRange(location: 0, length: a.length))
  let storage = NSTextStorage(attributedString: a)
  let lm = NSLayoutManager(); storage.addLayoutManager(lm)
  let tc = NSTextContainer(size: NSSize(width: W, height: 1e7)); tc.lineFragmentPadding = 0
  lm.addTextContainer(tc); lm.ensureLayout(for: tc)
  var breaks: [Int] = [], lines: [LineOut] = []
  lm.enumerateLineFragments(forGlyphRange: NSRange(location: 0, length: lm.numberOfGlyphs)) { _, used, _, gr, _ in
    let cr = lm.characterRange(forGlyphRange: gr, actualGlyphRange: nil)
    var te = cr.location + cr.length; while te > cr.location && isTrailingSpace(u[te - 1]) { te -= 1 }
    var w = 0.0
    if te > cr.location { let g = lm.glyphRange(forCharacterRange: NSRange(location: cr.location, length: te - cr.location), actualCharacterRange: nil)
      w = lm.boundingRect(forGlyphRange: g, in: tc).width }
    lines.append(LineOut(start: cr.location, end: cr.location + cr.length, width: w))
    if cr.location > 0 { breaks.append(cr.location) }
  }
  return EngineOut(breaks: breaks, lines: lines)
}

var outs: [CaseOut] = []
for c in cases {
  let font = ctFont(c.file, c.size)
  let u = Array(c.text.utf16)
  let attr = NSAttributedString(string: c.text, attributes: [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTLanguageAttributeName as String): c.lang])
  let ts = CTTypesetterCreateWithAttributedString(attr)
  var start = 0; var ct = EngineOut(breaks: [], lines: [])
  while start < u.count {
    let n = CTTypesetterSuggestLineBreak(ts, start, c.width)
    let e = start + max(n, 1)
    ct.lines.append(LineOut(start: start, end: e, width: lineWidth(ts, u, start, e)))
    if e < u.count { ct.breaks.append(e) }; start = e
  }
  // TextKit 1 uses NSFont; CTFont is toll-free bridged to NSFont
  let nsattr = NSAttributedString(string: c.text, attributes: [.font: font as NSFont, NSAttributedString.Key(kCTLanguageAttributeName as String): c.lang])
  let tk = textKit(nsattr, c.width, u, std: false)
  let tks = textKit(nsattr, c.width, u, std: true)
  let hy = NSAttributedString(string: "\u{2010}", attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
  let hyphW = CTLineGetTypographicBounds(CTLineCreateWithAttributedString(hy), nil, nil, nil)
  let icu = icuOpps(c.text, c.lang)
  let full = CTLineGetTypographicBounds(CTLineCreateWithAttributedString(attr), nil, nil, nil)
  let lm = NSLayoutManager()
  outs.append(CaseOut(id: c.id, ct: ct, tk1: tk, tk1std: tks,
    greedyICU: greedy(ts, u, icu, c.width, hyphW), greedyOracle: greedy(ts, u, chromeOpps[c.lang + "|" + c.para]!, c.width, hyphW),
    icuOpps: icu, nowrapWidth: full,
    ascent: CTFontGetAscent(font), descent: CTFontGetDescent(font), leading: CTFontGetLeading(font),
    tk1DefaultLineHeight: lm.defaultLineHeight(for: font as NSFont), hyphenWidth: hyphW))
}
try JSONEncoder().encode(outs).write(to: URL(fileURLWithPath: args[3]))
print("coretext cases:", outs.count)
