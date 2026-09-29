// Core Text ascent, descent and leading of a font file at given sizes, through the calls Skia 2ab8add5 makes on macOS:
// SkTypeface_Mac from data (CTFontManagerCreateFontDescriptorFromData, CTFontCreateWithFontDescriptor at size 0), then
// SkScalerContext_Mac's exact copy at the strike size (CTFontCopyGraphicsFont, CTFontCreateWithGraphicsFont), then
// generateFontMetrics (CTFontGetAscent, CTFontGetDescent, CTFontGetLeading).
// Usage: coretext-probe <font file> <file of sizes, one per line>. Prints "<size> <ascent> <descent> <leading>" per line,
// each a CGFloat printed as Swift's shortest round-trip decimal.
import CoreText
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: coretext-probe <font file> <sizes file>\n".data(using: .utf8)!)
  exit(2)
}
let data = try Data(contentsOf: URL(fileURLWithPath: args[1])) as CFData
guard let descriptor = CTFontManagerCreateFontDescriptorFromData(data) else {
  FileHandle.standardError.write("not a font: \(args[1])\n".data(using: .utf8)!)
  exit(1)
}
let base = CTFontCreateWithFontDescriptor(descriptor, 0, nil)
let graphicsFont = CTFontCopyGraphicsFont(base, nil)
let attributes = CTFontDescriptorCreateWithAttributes([:] as CFDictionary)
var out = ""
for line in try String(contentsOfFile: args[2], encoding: .utf8).split(separator: "\n") {
  guard let size = Double(line) else { continue }
  let font = CTFontCreateWithGraphicsFont(graphicsFont, CGFloat(size), nil, attributes)
  out += "\(line) \(CTFontGetAscent(font)) \(CTFontGetDescent(font)) \(CTFontGetLeading(font))\n"
}
FileHandle.standardOutput.write(out.data(using: .utf8)!)
