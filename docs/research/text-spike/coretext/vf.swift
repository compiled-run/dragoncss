import CoreText; import Foundation
let url = URL(fileURLWithPath: "/tmp/text-spike/fonts/Inter-VF.ttf") as CFURL
let d = CTFontManagerCreateFontDescriptorsFromURL(url) as! [CTFontDescriptor]
for x in d.prefix(4) { let f = CTFontCreateWithFontDescriptor(x, 24, nil); print(CTFontCopyPostScriptName(f), CTFontCopyVariation(f) as Any) }
let cg = CGFont(CGDataProvider(url: url)!)!; let f = CTFontCreateWithGraphicsFont(cg, 24, nil, nil)
print("graphicsfont:", CTFontCopyPostScriptName(f), CTFontCopyVariation(f) as Any)
