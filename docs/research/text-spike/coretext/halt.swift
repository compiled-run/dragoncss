// Apply OpenType 'halt' to exactly the characters Chrome trims; compare nowrap width.
import Foundation; import CoreText
struct T: Codable { let text: String; let trimmed: [Int]; let total: Double; let totalAll: Double }
let d = try JSONDecoder().decode([String: T].self, from: Data(contentsOf: URL(fileURLWithPath: "/tmp/text-spike/out/tst.json")))
let desc = (CTFontManagerCreateFontDescriptorsFromURL(URL(fileURLWithPath: "/tmp/text-spike/fonts/NotoSansJP-Regular.otf") as CFURL) as! [CTFontDescriptor])[0]
let font = CTFontCreateWithFontDescriptor(desc, 16, nil)
let halt = CTFontCreateCopyWithAttributes(font, 16, nil, CTFontDescriptorCreateWithAttributes([kCTFontFeatureSettingsAttribute: [[kCTFontOpenTypeFeatureTag: "halt", kCTFontOpenTypeFeatureValue: 1]]] as CFDictionary))
for (k, t) in d.sorted(by: { $0.key < $1.key }) {
  let a = NSMutableAttributedString(string: t.text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
  let plain = CTLineGetTypographicBounds(CTLineCreateWithAttributedString(a), nil, nil, nil)
  for i in t.trimmed { a.addAttribute(NSAttributedString.Key(kCTFontAttributeName as String), value: halt, range: NSRange(location: i, length: 1)) }
  let w = CTLineGetTypographicBounds(CTLineCreateWithAttributedString(a), nil, nil, nil)
  print(k, "chrome(normal)", t.total, "CT+halt", String(format: "%.3f", w), "delta", String(format: "%.3f", w - t.total), "| chrome(space-all)", t.totalAll, "CT plain", String(format: "%.3f", plain))
}
