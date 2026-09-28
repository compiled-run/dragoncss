// Core Text glyph advances per UTF-16 index for every (font, paragraph, size) of the spike corpus.
// Build: swiftc -O coretext-advances.swift -o /tmp/coretext-advances
// Usage: /tmp/coretext-advances <cases.json> <fontsDir> <out.json> (cases.json: the spike corpus, docs/research/text-spike/corpus.mjs)
import Foundation
import CoreText

struct Case: Codable { let id, font, file, para, text, lang: String; let size, width: Double }
let args = CommandLine.arguments
let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
var descCache: [String: CTFontDescriptor] = [:]
func ctFont(_ file: String, _ size: Double) -> CTFont {
  if descCache[file] == nil {
    let url = URL(fileURLWithPath: args[2] + "/" + file) as CFURL
    let descs = CTFontManagerCreateFontDescriptorsFromURL(url) as! [CTFontDescriptor]
    let psDefault = CGFont(CGDataProvider(url: url)!)!.postScriptName! as String
    descCache[file] = descs.first { (CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String) == psDefault } ?? descs[0]
  }
  return CTFontCreateWithFontDescriptor(descCache[file]!, CGFloat(size), nil)
}
struct Out: Codable { let key: String; let advances: [Double]; let hyphen: Double }
var outs: [Out] = []; var seen = Set<String>()
for c in cases {
  let key = "\(c.font)/\(c.para)/\(Int(c.size))"
  if seen.contains(key) { continue }; seen.insert(key)
  let font = ctFont(c.file, c.size)
  let attr = NSAttributedString(string: c.text, attributes: [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTLanguageAttributeName as String): c.lang])
  let line = CTTypesetterCreateLine(CTTypesetterCreateWithAttributedString(attr), CFRange(location: 0, length: 0))
  var adv = [Double](repeating: 0, count: c.text.utf16.count)
  for run in CTLineGetGlyphRuns(line) as! [CTRun] {
    let n = CTRunGetGlyphCount(run)
    var a = [CGSize](repeating: .zero, count: n); CTRunGetAdvances(run, CFRange(location: 0, length: 0), &a)
    var ix = [CFIndex](repeating: 0, count: n); CTRunGetStringIndices(run, CFRange(location: 0, length: 0), &ix)
    for g in 0..<n { adv[ix[g]] += Double(a[g].width) }
  }
  let hy = NSAttributedString(string: "\u{2010}", attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
  let hyphW = CTLineGetTypographicBounds(CTLineCreateWithAttributedString(hy), nil, nil, nil)
  outs.append(Out(key: key, advances: adv, hyphen: hyphW))
}
try JSONEncoder().encode(outs).write(to: URL(fileURLWithPath: args[3]))
print("advance sets:", outs.count)
