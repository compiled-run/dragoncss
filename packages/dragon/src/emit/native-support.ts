// Support code emitted with the native output (docs/api.md 4.4; notes/T013-p3-review-p4-plan.md section 2 items 2 and 3): the
// checked conversions, the Dragon views (box, clip and TextKit 1 / StaticLayout text views), the tree that applies the translated
// engine's snapped frames at the device scale, the font-data measurer bridge with its Ahem self-check, and the dump reader. It is
// emitted source, never a hand-written file and never a runtime package. Line boxes, baselines, border widths and the text
// instance size come from the translated engine; nothing is recomputed from UIFont or FontMetrics.
import { sha256Hex } from '../digest.ts';
import type { GeneratedFile } from '../types.ts';
import type { NativeBackend, NativeProgram } from '../lower/native-program.ts';

export const NATIVE_SUPPORT_VERSION = 'dragon.native-support/1';

/** One case as the emitters see it: the program, its identity and the expected-dump digests per device DPR. */
export type EmitCase = {
  readonly id: string;
  readonly fixture: string;
  readonly direction: 'ltr' | 'rtl';
  readonly compilerDigest: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly program: NativeProgram;
  readonly expectedDigests: readonly { readonly dpr: number; readonly sha256: string }[];
};

// ---------------------------------------------------------------- Swift (UIKit)

const SWIFT_CHECKED = String.raw`import Foundation

/// The checked conversion from an engine Double to an Int32-range Int: traps on a non-finite, non-integral or out-of-range value.
public func dragonCheckedInt(_ v: Double, _ what: String) -> Int {
  if !v.isFinite || v.rounded(.towardZero) != v || v < -2147483648.0 || v > 2147483647.0 {
    fatalError("dragonCheckedInt: \(what) = \(v) is not an Int32 integer")
  }
  return Int(v)
}

/// A live position in device px that the view tree must hold exactly, because it was set from snapped ints; traps otherwise.
public func dragonWholeDevicePx(_ v: Double, _ what: String) -> Double {
  let r = v.rounded()
  if !(abs(v - r) <= 1e-6) { fatalError("dragonWholeDevicePx: \(what) = \(v) device px is not whole") }
  return r
}

/// Round half up to whole device px (Blink LayoutUnit::Round), for a live text extent the native text engine measured.
public func dragonHalfUp(_ v: Double) -> Double { (v + 0.5).rounded(.down) }
`;

const SWIFT_FONT_TABLES = String.raw`import Foundation

/// Big-endian reads of the sfnt tables the bridge supplies (head, hhea).
public func dragonU16(_ b: [UInt8], _ o: Int) -> Double {
  if o + 2 > b.count { fatalError("dragon font table: read past the end at \(o)") }
  return Double(Int(b[o]) << 8 | Int(b[o + 1]))
}
public func dragonI16(_ b: [UInt8], _ o: Int) -> Double {
  let u = dragonU16(b, o)
  return u >= 32768 ? u - 65536 : u
}

/// unitsPerEm (head 18), ascender (hhea 4), descender (hhea 6, as a positive descent) and lineGap (hhea 8), in font units.
public func dragonFontHeader(head: [UInt8], hhea: [UInt8]) -> (unitsPerEm: Double, ascent: Double, descent: Double, lineGap: Double) {
  return (dragonU16(head, 18), dragonI16(hhea, 4), -dragonI16(hhea, 6), dragonI16(hhea, 8))
}

public func dragonU32(_ b: [UInt8], _ o: Int) -> Int {
  return Int(dragonU16(b, o)) << 16 | Int(dragonU16(b, o + 2))
}

/// The glyph id of a code point from the cmap table (format 12, else format 4); 0 when it is not mapped.
public func dragonGlyph(cmap: [UInt8], _ cp: Int) -> Int {
  let n = Int(dragonU16(cmap, 2))
  var f4 = -1
  var f12 = -1
  for i in 0..<n {
    let platform = Int(dragonU16(cmap, 4 + 8 * i))
    let encoding = Int(dragonU16(cmap, 6 + 8 * i))
    let off = dragonU32(cmap, 8 + 8 * i)
    let format = Int(dragonU16(cmap, off))
    if format == 12 && (platform == 0 || (platform == 3 && encoding == 10)) { f12 = off }
    if format == 4 && (platform == 0 || (platform == 3 && encoding == 1)) && f4 < 0 { f4 = off }
  }
  if f12 >= 0 {
    let groups = dragonU32(cmap, f12 + 12)
    for g in 0..<groups {
      let at = f12 + 16 + 12 * g
      let start = dragonU32(cmap, at)
      let end = dragonU32(cmap, at + 4)
      if cp >= start && cp <= end { return dragonU32(cmap, at + 8) + cp - start }
    }
    return 0
  }
  if f4 < 0 || cp > 0xffff { return 0 }
  let segX2 = Int(dragonU16(cmap, f4 + 6))
  for k in 0..<(segX2 / 2) {
    let end = Int(dragonU16(cmap, f4 + 14 + 2 * k))
    let start = Int(dragonU16(cmap, f4 + 16 + segX2 + 2 * k))
    if cp < start || cp > end { continue }
    let delta = Int(dragonU16(cmap, f4 + 16 + 2 * segX2 + 2 * k))
    let rangeAt = f4 + 16 + 3 * segX2 + 2 * k
    let range = Int(dragonU16(cmap, rangeAt))
    if range == 0 { return (cp + delta) & 0xffff }
    let g = Int(dragonU16(cmap, rangeAt + range + 2 * (cp - start)))
    return g == 0 ? 0 : (g + delta) & 0xffff
  }
  return 0
}

/// A glyph's advance in font units from hmtx (numberOfHMetrics is hhea 34; later glyphs repeat the last advance).
public func dragonAdvance(hhea: [UInt8], hmtx: [UInt8], _ gid: Int) -> Double {
  let n = Int(dragonU16(hhea, 34))
  return dragonU16(hmtx, 4 * min(gid, n - 1))
}

/// The raw data as the translated measurer's FontData.
public func dragonFontData(unitsPerEm: Double, ascent: Double, descent: Double, lineGap: Double, advances: [Double]) -> FontData {
  return FontData(unitsPerEm, ascent, descent, lineGap, JsArray(advances))
}

/// The bridge self-check: the raw data read from the bundled font equal the Ahem constants of the translated engine.
public func dragonSelfCheck(_ d: FontData) -> [String] {
  let want = text_AHEM_FONT_DATA
  var out: [String] = []
  if d.unitsPerEm != want.unitsPerEm { out.append("unitsPerEm \(d.unitsPerEm), Ahem \(want.unitsPerEm)") }
  if d.ascent != want.ascent { out.append("ascent \(d.ascent), Ahem \(want.ascent)") }
  if d.descent != want.descent { out.append("descent \(d.descent), Ahem \(want.descent)") }
  if d.lineGap != want.lineGap { out.append("lineGap \(d.lineGap), Ahem \(want.lineGap)") }
  let cps = try! text_coveredCodePoints().items
  if d.advances.items.count != want.advances.items.count { out.append("\(d.advances.items.count) advances, Ahem \(want.advances.items.count)") }
  for (k, cp) in cps.enumerated() where k < d.advances.items.count && k < want.advances.items.count {
    if d.advances.items[k] != want.advances.items[k] { out.append("U+\(String(Int(cp), radix: 16, uppercase: true)) advance \(d.advances.items[k]), Ahem \(want.advances.items[k])") }
  }
  return out
}
`;

const SWIFT_VIEWS = String.raw`import UIKit

public struct DragonRGBA8: Equatable {
  public let r: Int, g: Int, b: Int, a: Int
  public init(_ r: Int, _ g: Int, _ b: Int, _ a: Int) { self.r = r; self.g = g; self.b = b; self.a = a }
}

/// An sRGB UIColor from RGBA8 channels.
public func dragonUIColor(_ c: DragonRGBA8) -> UIColor {
  return UIColor(red: CGFloat(c.r) / 255, green: CGFloat(c.g) / 255, blue: CGFloat(c.b) / 255, alpha: CGFloat(c.a) / 255)
}

/// RGBA8 channels read back from a live colour; nil (no colour) reads as transparent.
public func dragonColorJson(_ color: UIColor?) -> DumpJson {
  guard let color = color else { return .array([.number(0), .number(0), .number(0), .number(0)]) }
  var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
  if !color.getRed(&r, green: &g, blue: &b, alpha: &a) { fatalError("dragon: a colour that does not convert to sRGB") }
  return .array([r, g, b, a].map { DumpJson.number(Double(($0 * 255).rounded())) })
}

public func dragonRGBAJson(_ c: DragonRGBA8) -> DumpJson {
  return .array([.number(Double(c.r)), .number(Double(c.g)), .number(Double(c.b)), .number(Double(c.a))])
}

/// A laid-out node's view: its compiler id, kind and parent, and its applied values read back from the live object.
public protocol DragonNodeView: UIView {
  var dragonId: String { get }
  var dragonKind: String { get }
  var dragonParent: String? { get }
  func dragonApplied() -> DumpJsonObject
}

/// The initial containing block: the fixture root at the device origin, white like Chrome's canvas.
public final class DragonRootView: UIView {
  public init() {
    super.init(frame: .zero)
    backgroundColor = .white
    clipsToBounds = false
  }
  required init?(coder: NSCoder) { fatalError("DragonRootView is built in code") }
}

/// css-overflow-3 §3: the padding box of an overflow: hidden node; its children are clipped to its bounds.
public final class DragonClipView: UIView {
  public init() {
    super.init(frame: .zero)
    clipsToBounds = true
    backgroundColor = nil
    isOpaque = false
  }
  required init?(coder: NSCoder) { fatalError("DragonClipView is built in code") }
}

/// A box: backgroundColor is a native property; the four border sides are Dragon-owned paint.
public final class DragonBoxView: UIView, DragonNodeView {
  public let dragonId: String
  public let dragonKind: String
  public let dragonParent: String?
  /// Points, top right bottom left: the engine's device px at the device scale / scale.
  public var dragonBorderWidths: [Double] = [0, 0, 0, 0]
  public var dragonBorderStyles: [String] = ["none", "none", "none", "none"]
  public var dragonBorderColors: [DragonRGBA8] = [DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0)]
  public private(set) var dragonClipView: DragonClipView? = nil
  public init(dragonId: String, kind: String, parent: String?) {
    self.dragonId = dragonId
    self.dragonKind = kind
    self.dragonParent = parent
    super.init(frame: .zero)
    isOpaque = false
    clipsToBounds = false
    contentMode = .redraw
  }
  required init?(coder: NSCoder) { fatalError("DragonBoxView is built in code") }
  /// Overflow hidden: the children are hosted by a clip view over the padding box.
  public func dragonEnableClip() {
    let c = DragonClipView()
    addSubview(c)
    dragonClipView = c
  }
  public var dragonContainer: UIView { return dragonClipView ?? self }
  public override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    dragonDrawBorders(ctx, bounds, dragonBorderWidths.map { CGFloat($0) }, dragonBorderStyles, dragonBorderColors)
  }
  /// The device scale the frames were applied at; clip values are read back in whole device px / scale.
  public var dragonScale: Double = 1
  public func dragonApplied() -> DumpJsonObject {
    var o: DumpJsonObject = [
      ("backgroundColor", dragonColorJson(backgroundColor)),
      ("dragonBorder.widths", .array(dragonBorderWidths.map { .number($0) })),
      ("dragonBorder.styles", .array(dragonBorderStyles.map { .string($0) })),
      ("dragonBorder.colors", .array(dragonBorderColors.map(dragonRGBAJson))),
    ]
    if let c = dragonClipView {
      let s = dragonScale
      o.append(("dragonClip.frame", c.clipsToBounds ? .array([c.frame.minX, c.frame.minY, c.frame.width, c.frame.height].map { .number(dragonWholeDevicePx(Double($0) * s, "\(dragonId) clip") / s) }) : .null))
    }
    return o
  }
}

/// Dragon-owned border paint: each side is the trapezoid between the outer and inner edges (corners join on the diagonal);
/// solid fills it, double fills its outer and inner thirds, dashed strokes dashes of 3 times the width with equal gaps along its
/// middle, dotted strokes round dots of the width with gaps of the width.
public func dragonDrawBorders(_ ctx: CGContext, _ o: CGRect, _ w: [CGFloat], _ styles: [String], _ colors: [DragonRGBA8]) {
  let i = CGRect(x: o.minX + w[3], y: o.minY + w[0], width: o.width - w[3] - w[1], height: o.height - w[0] - w[2])
  let quads: [[CGPoint]] = [
    [CGPoint(x: o.minX, y: o.minY), CGPoint(x: o.maxX, y: o.minY), CGPoint(x: i.maxX, y: i.minY), CGPoint(x: i.minX, y: i.minY)],
    [CGPoint(x: o.maxX, y: o.minY), CGPoint(x: o.maxX, y: o.maxY), CGPoint(x: i.maxX, y: i.maxY), CGPoint(x: i.maxX, y: i.minY)],
    [CGPoint(x: o.maxX, y: o.maxY), CGPoint(x: o.minX, y: o.maxY), CGPoint(x: i.minX, y: i.maxY), CGPoint(x: i.maxX, y: i.maxY)],
    [CGPoint(x: o.minX, y: o.maxY), CGPoint(x: o.minX, y: o.minY), CGPoint(x: i.minX, y: i.minY), CGPoint(x: i.minX, y: i.maxY)],
  ]
  for k in 0..<4 {
    let width = w[k]
    let style = styles[k]
    if width <= 0 || style == "none" || style == "hidden" || colors[k].a == 0 { continue }
    ctx.saveGState()
    let path = CGMutablePath()
    path.addLines(between: quads[k])
    path.closeSubpath()
    ctx.addPath(path)
    ctx.clip()
    let color = dragonUIColor(colors[k]).cgColor
    ctx.setFillColor(color)
    ctx.setStrokeColor(color)
    let third = width / 3
    // The band of side k at depth d from the outer edge with thickness t.
    func band(_ d: CGFloat, _ t: CGFloat) -> CGRect {
      switch k {
      case 0: return CGRect(x: o.minX, y: o.minY + d, width: o.width, height: t)
      case 1: return CGRect(x: o.maxX - d - t, y: o.minY, width: t, height: o.height)
      case 2: return CGRect(x: o.minX, y: o.maxY - d - t, width: o.width, height: t)
      default: return CGRect(x: o.minX + d, y: o.minY, width: t, height: o.height)
      }
    }
    switch style {
    case "double":
      ctx.fill(band(0, third))
      ctx.fill(band(width - third, third))
    case "dashed", "dotted":
      let mid = band(width / 2, 0)
      let a = k == 0 || k == 2 ? CGPoint(x: mid.minX, y: mid.minY) : CGPoint(x: mid.minX, y: mid.minY)
      let b = k == 0 || k == 2 ? CGPoint(x: mid.maxX, y: mid.minY) : CGPoint(x: mid.minX, y: mid.maxY)
      ctx.setLineWidth(width)
      if style == "dashed" {
        ctx.setLineCap(.butt)
        ctx.setLineDash(phase: 0, lengths: [3 * width, 3 * width])
      } else {
        ctx.setLineCap(.round)
        ctx.setLineDash(phase: 0, lengths: [0, 2 * width])
      }
      ctx.strokeLineSegments(between: [a, b])
    default:
      ctx.fill(o)
    }
    ctx.restoreGState()
  }
}

/// One engine line of a text node: the engine's line text (its visible characters), the line box and baseline in points relative
/// to the text container origin, the line-left in points relative to the view, and its UTF-16 offsets in the node's text.
public struct DragonLineSpec {
  public let text: String
  public let top: CGFloat
  public let bottom: CGFloat
  public let baseline: CGFloat
  public let left: CGFloat
  public let start: Int
  public let end: Int
}

/// A text node: TextKit 1 (NSTextStorage, NSLayoutManager, NSTextContainer, built explicitly, never TextKit 2). The engine owns
/// the line breaks (decisions.md, Text strategy): the storage holds the engine's lines separated by U+2028 in an unbounded
/// container, so TextKit never chooses a break. Glyph shaping and drawing are native; the per-line hook sets each line fragment's
/// line box, baseline and line-left from the engine's data.
public final class DragonTextView: UIView, DragonNodeView, NSLayoutManagerDelegate {
  public let dragonId: String
  public let dragonKind: String
  public let dragonParent: String?
  public let textStorage = NSTextStorage()
  public let layoutManager = NSLayoutManager()
  public let textContainer = NSTextContainer(size: .zero)
  public private(set) var dragonText = ""
  public private(set) var dragonFamily = ""
  public private(set) var dragonCssSize: Double = 0
  public private(set) var dragonColor = DragonRGBA8(0, 0, 0, 255)
  private var specs: [DragonLineSpec] = []
  private var lineIndex: [Int: Int] = [:]
  /// The text container's origin in the view: the first line box's top relative to the content-area top of the node.
  public private(set) var originY: CGFloat = 0
  public init(dragonId: String, kind: String, parent: String?) {
    self.dragonId = dragonId
    self.dragonKind = kind
    self.dragonParent = parent
    super.init(frame: .zero)
    isOpaque = false
    backgroundColor = nil
    clipsToBounds = false
    contentMode = .redraw
    layoutManager.usesFontLeading = false
    layoutManager.delegate = self
    textContainer.lineFragmentPadding = 0
    textContainer.lineBreakMode = .byClipping
    textContainer.maximumNumberOfLines = 0
    layoutManager.addTextContainer(textContainer)
    textStorage.addLayoutManager(layoutManager)
  }
  required init?(coder: NSCoder) { fatalError("DragonTextView is built in code") }

  /// The text run from the program: text, font family and CSS size, colour.
  public func dragonSetText(_ text: String, family: String, cssSize: Double, color: DragonRGBA8) {
    dragonText = text
    dragonFamily = family
    dragonCssSize = cssSize
    dragonColor = color
  }

  /// The engine's data at the device scale: the instance font and the engine's lines.
  public func dragonConfigure(font: UIFont, lines: [DragonLineSpec], originY: CGFloat) {
    self.specs = lines
    self.originY = originY
    self.lineIndex = [:]
    let p = NSMutableParagraphStyle()
    p.alignment = .left
    p.baseWritingDirection = .leftToRight
    p.lineBreakMode = .byClipping
    p.hyphenationFactor = 0
    p.lineBreakStrategy = []
    p.lineSpacing = 0
    p.paragraphSpacing = 0
    textContainer.size = CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
    let joined = lines.map { $0.text }.joined(separator: "\u{2028}")
    textStorage.setAttributedString(NSAttributedString(string: joined, attributes: [.font: font, .foregroundColor: dragonUIColor(dragonColor), .paragraphStyle: p]))
    layoutManager.ensureLayout(for: textContainer)
    setNeedsDisplay()
  }

  // The per-line hook (TextKit 1): line k's fragment takes the engine's line box, baseline and line-left.
  public func layoutManager(_ layoutManager: NSLayoutManager, shouldSetLineFragmentRect lineFragmentRect: UnsafeMutablePointer<CGRect>, lineFragmentUsedRect: UnsafeMutablePointer<CGRect>, baselineOffset: UnsafeMutablePointer<CGFloat>, in textContainer: NSTextContainer, forGlyphRange glyphRange: NSRange) -> Bool {
    let k: Int
    if let known = lineIndex[glyphRange.location] { k = known } else { k = lineIndex.count; lineIndex[glyphRange.location] = k }
    if k >= specs.count { return false }
    let s = specs[k]
    let dx = s.left - lineFragmentRect.pointee.minX
    lineFragmentRect.pointee = CGRect(x: s.left, y: s.top, width: lineFragmentRect.pointee.width, height: s.bottom - s.top)
    lineFragmentUsedRect.pointee = CGRect(x: lineFragmentUsedRect.pointee.minX + dx, y: s.top, width: lineFragmentUsedRect.pointee.width, height: s.bottom - s.top)
    baselineOffset.pointee = s.baseline - s.top
    return true
  }

  public override func draw(_ rect: CGRect) {
    let range = layoutManager.glyphRange(for: textContainer)
    layoutManager.drawGlyphs(forGlyphRange: range, at: CGPoint(x: 0, y: originY))
  }

  public func dragonApplied() -> DumpJsonObject {
    let n = textStorage.length
    let font = n > 0 ? textStorage.attribute(.font, at: 0, effectiveRange: nil) as? UIFont : nil
    let color = n > 0 ? textStorage.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor : nil
    return [
      ("font", font.map { DumpJson.object([("name", .string($0.fontName)), ("pointSize", .number(Double($0.pointSize)))]) } ?? .null),
      ("foregroundColor", dragonColorJson(color)),
    ]
  }

  /// Every line read back from the live layout manager, in points relative to the view: line box top, baseline, and the left and
  /// right of the line's glyphs; the offsets are the engine's (it owns the breaks), after checking the fragment holds its text.
  public func dragonReadLines() -> [(top: Double, baseline: Double, left: Double, right: Double, start: Int, end: Int)] {
    layoutManager.ensureLayout(for: textContainer)
    let ns = textStorage.string as NSString
    var out: [(top: Double, baseline: Double, left: Double, right: Double, start: Int, end: Int)] = []
    var k = 0
    layoutManager.enumerateLineFragments(forGlyphRange: layoutManager.glyphRange(for: textContainer)) { rect, _, _, glyphs, _ in
      let chars = self.layoutManager.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
      var length = chars.length
      if length > 0 && ns.character(at: chars.location + length - 1) == 0x2028 { length -= 1 }
      if k >= self.specs.count { fatalError("dragon: \(self.dragonId) has a native line \(k) the engine does not have") }
      let spec = self.specs[k]
      if ns.substring(with: NSRange(location: chars.location, length: length)) != spec.text { fatalError("dragon: \(self.dragonId) line \(k) holds a different text than the engine's line") }
      let visible = self.layoutManager.glyphRange(forCharacterRange: NSRange(location: chars.location, length: length), actualCharacterRange: nil)
      let bounds = self.layoutManager.boundingRect(forGlyphRange: visible, in: self.textContainer)
      let baseline = rect.minY + self.layoutManager.location(forGlyphAt: glyphs.location).y
      out.append((top: Double(rect.minY + self.originY), baseline: Double(baseline + self.originY), left: Double(bounds.minX), right: Double(bounds.maxX), start: spec.start, end: spec.end))
      k += 1
    }
    if k != specs.count { fatalError("dragon: \(dragonId) has \(k) native lines, the engine \(specs.count)") }
    return out
  }
}
`;

const SWIFT_BRIDGE = String.raw`import UIKit
import CoreText
import CryptoKit

/// The measurer bridge (R4): raw data read from the bundled Ahem's tables through Core Text (head, hhea, cmap, hmtx), fed to the translated font-data measurer with
/// the darwin-arm64 platform rules. It never uses the platform's rounded line metrics.
public final class DragonBridge {
  public static let shared = DragonBridge()
  public let postScriptName: String
  public let fontSha256: String
  public let data: FontData
  public let selfCheck: [String]
  public let measurer: TextMeasurer
  private let descriptor: CTFontDescriptor
  private init() {
    guard let url = Bundle.main.url(forResource: "Ahem", withExtension: "ttf") else { fatalError("dragon bridge: Ahem.ttf is not bundled") }
    guard let bytes = try? Data(contentsOf: url) else { fatalError("dragon bridge: Ahem.ttf cannot be read") }
    fontSha256 = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    var error: Unmanaged<CFError>?
    if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) { fatalError("dragon bridge: CTFontManagerRegisterFontsForURL failed: \(String(describing: error?.takeRetainedValue()))") }
    guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor], let first = descriptors.first else { fatalError("dragon bridge: no font in Ahem.ttf") }
    descriptor = first
    let probe = CTFontCreateWithFontDescriptor(descriptor, 16, nil)
    guard let headData = CTFontCopyTable(probe, CTFontTableTag(kCTFontTableHead), []) as Data?, let hheaData = CTFontCopyTable(probe, CTFontTableTag(kCTFontTableHhea), []) as Data? else { fatalError("dragon bridge: head or hhea is missing") }
    let header = dragonFontHeader(head: [UInt8](headData), hhea: [UInt8](hheaData))
    // Advances in font units: the font at size = unitsPerEm advances each glyph by its units.
    let font = CTFontCreateWithFontDescriptor(descriptor, CGFloat(header.unitsPerEm), nil)
    postScriptName = CTFontCopyPostScriptName(font) as String
    // Advances in integer font units from the font's own cmap and hmtx (PM ruling, option a): the units Chrome's HarfBuzz scales
    // by size / unitsPerEm. Core Text typesetting is only an evidence probe (record()).
    guard let cmapData = CTFontCopyTable(probe, CTFontTableTag(kCTFontTableCmap), []) as Data?, let hmtxData = CTFontCopyTable(probe, CTFontTableTag(kCTFontTableHmtx), []) as Data? else { fatalError("dragon bridge: cmap or hmtx is missing") }
    let cmap = [UInt8](cmapData)
    let hmtx = [UInt8](hmtxData)
    let hhea = [UInt8](hheaData)
    var advances: [Double] = []
    for cp in try! text_coveredCodePoints().items {
      let gid = dragonGlyph(cmap: cmap, Int(cp))
      advances.append(gid == 0 ? -1 : dragonAdvance(hhea: hhea, hmtx: hmtx, gid))
    }
    data = dragonFontData(unitsPerEm: header.unitsPerEm, ascent: header.ascent, descent: header.descent, lineGap: header.lineGap, advances: advances)
    selfCheck = dragonSelfCheck(data)
    measurer = try! text_fontDataMeasurer(data, AhemRuleFaults(false, false))
  }
  /// The registered Ahem at a point size.
  public func font(pointSize: CGFloat) -> UIFont {
    guard let f = UIFont(name: postScriptName, size: pointSize) else { fatalError("dragon bridge: UIFont(name: \(postScriptName)) is nil") }
    return f
  }
  /// The self-check record written beside the dumps.
  public func record(platform: String) -> String {
    var w = DumpJsonWriter()
    w.beginObject()
    w.key("platform"); w.string(platform, nonEmpty: true, path: "bridge.platform")
    w.key("ruleKey"); w.string("darwin-arm64", nonEmpty: true, path: "bridge.ruleKey")
    w.key("postScriptName"); w.string(postScriptName, nonEmpty: true, path: "bridge.postScriptName")
    w.key("fontSha256"); w.string(fontSha256, nonEmpty: true, path: "bridge.fontSha256")
    w.key("unitsPerEm"); w.number(data.unitsPerEm, path: "bridge.unitsPerEm")
    w.key("ascent"); w.number(data.ascent, path: "bridge.ascent")
    w.key("descent"); w.number(data.descent, path: "bridge.descent")
    w.key("lineGap"); w.number(data.lineGap, path: "bridge.lineGap")
    w.key("advances"); w.array(data.advances.items, length: nil, path: "bridge.advances") { x, w in w.number(x, path: "bridge.advances[]") }
    w.key("probe"); w.array([10.0, 26.25, 100.0, 256.0, 257.0, 512.0, 1000.0, 2048.0], length: nil, path: "bridge.probe") { size, w in
      // Evidence only, never an input: the typeset advance of U+0058 at other point sizes, in font units.
      let f = CTFontCreateWithFontDescriptor(descriptor, CGFloat(size), nil)
      let attributed = NSAttributedString(string: "X", attributes: [NSAttributedString.Key(kCTFontAttributeName as String): f])
      let line = CTTypesetterCreateLine(CTTypesetterCreateWithAttributedString(attributed), CFRange(location: 0, length: 0))
      w.beginObject()
      w.key("textSize"); w.number(size, path: "bridge.probe.textSize")
      w.key("advanceUnits"); w.number(Double(CTLineGetTypographicBounds(line, nil, nil, nil)) * data.unitsPerEm / size, path: "bridge.probe.advanceUnits")
      w.endObject()
    }
    w.key("selfCheck"); w.string(selfCheck.isEmpty ? "pass" : "fail", nonEmpty: true, path: "bridge.selfCheck")
    w.key("mismatches"); w.array(selfCheck, length: nil, path: "bridge.mismatches") { x, w in w.string(x, nonEmpty: true, path: "bridge.mismatches[]") }
    w.endObject()
    return w.text
  }
}
`;

const SWIFT_TREE = String.raw`import UIKit
import CryptoKit

/// One compiled case in the app: its identity, the engine input as typed constructor calls, and the view-building function.
public struct DragonCase {
  public let id: String
  public let fixture: String
  public let direction: String
  public let compilerDigest: String
  public let viewport: (width: Double, height: Double)
  public let expectedDigests: [Double: String]
  public let input: (Double) -> LayoutInput
  public let build: (DragonTree) -> Void
  public init(id: String, fixture: String, direction: String, compilerDigest: String, viewport: (width: Double, height: Double), expectedDigests: [Double: String], input: @escaping (Double) -> LayoutInput, build: @escaping (DragonTree) -> Void) {
    self.id = id; self.fixture = fixture; self.direction = direction; self.compilerDigest = compilerDigest; self.viewport = viewport
    self.expectedDigests = expectedDigests; self.input = input; self.build = build
  }
  /// The digest of the expected dump at a device scale; an unknown scale fails loudly.
  public func expectedDigest(scale: Double) -> String {
    guard let d = expectedDigests[scale] else { fatalError("dragon: case \(id) has no expected dump at scale \(scale) (known: \(expectedDigests.keys.sorted()))") }
    return d
  }
}

/// The native tree of one case: builds the views, applies the translated engine's snapped frames at the device scale, and reads
/// the dump back from the live tree.
public final class DragonTree {
  public let root = DragonRootView()
  private var views: [String: DragonNodeView] = [:]
  private var order: [String] = []
  private var parents: [String: String?] = [:]
  private var textMetrics: [String: (halfLeading: Double, ascent: Double, descent: Double)] = [:]
  public init() {}

  public func boxNode(_ id: String, parent: String?, kind: String) -> DragonBoxView {
    let v = DragonBoxView(dragonId: id, kind: kind, parent: parent)
    views[id] = v
    return v
  }
  public func textNode(_ id: String, parent: String?, kind: String) -> DragonTextView {
    let v = DragonTextView(dragonId: id, kind: kind, parent: parent)
    views[id] = v
    return v
  }

  private static func isLine(_ r: LayoutRect) -> Bool {
    guard let p = r.parent else { return false }
    return r.id.description.hasPrefix(p.description + ":line")
  }

  /// Runs the translated engine at the device scale, snaps with the translated snapEdges and sets every frame relative to its
  /// native parent as CGFloat(edge - parentEdge) / scale. No Auto Layout.
  public func apply(_ input: LayoutInput, measurer: TextMeasurer, scale: Double, fontFor: (Double) -> UIFont) throws {
    let result = try layout_layout(input, measurer)
    if let refused = result as? LayoutResult_unsupported { fatalError("dragon: the engine refused the case: \(refused.unsupported.code) at \(refused.unsupported.nodeId): \(refused.unsupported.detail)") }
    guard let ok = result as? LayoutResult_ok else { fatalError("dragon: the engine gave no result") }
    let boxes = ok.boxes.items
    let snapped = try snap_snapEdges(ok.boxes).items
    let abs = try layout_absoluteRects(ok.boxes)
    let zoomed = try layout_zoomInput(input, block_NO_ENGINE_FAULTS)
    var zBoxes: [String: LayoutBox] = [:]
    var zParent: [String: String] = [:]
    func walk(_ b: LayoutBox) {
      zBoxes[b.id.description] = b
      for c in b.children.items {
        if let cb = c as? LayoutBox { zParent[cb.id.description] = b.id.description; walk(cb) }
        else if let t = c as? TextLeaf { zParent[t.id.description] = b.id.description }
      }
    }
    walk(zoomed.root)
    let lu = units_LU_PER_PX
    let s = scale
    let cg = CGFloat(scale)
    root.frame = CGRect(x: 0, y: 0, width: CGFloat(input.viewport.width), height: CGFloat(input.viewport.height))
    var edges: [String: [Double]] = [:]
    var borders: [String: [Double]] = [:]
    var rects: [String: LayoutRect] = [:]
    for (i, r) in boxes.enumerated() {
      if DragonTree.isLine(r) { continue }
      let id = r.id.description
      let e = snapped[i]
      guard let v = views[id] else { fatalError("dragon: the engine laid out \(id), which the program did not build") }
      edges[id] = [e.left, e.top, e.right, e.bottom]
      rects[id] = r
      order.append(id)
      parents[id] = r.parent?.description
      var container: UIView = root
      var origin = [0.0, 0.0]
      if let p = r.parent?.description {
        guard let pv = views[p] as? DragonBoxView, let pe = edges[p], let pb = borders[p] else { fatalError("dragon: \(id) has no placed parent box \(p)") }
        container = pv.dragonContainer
        origin = pv.dragonClipView == nil ? [pe[0], pe[1]] : [pe[0] + pb[3], pe[1] + pb[0]]
      }
      container.addSubview(v)
      v.frame = CGRect(x: CGFloat(e.left - origin[0]) / cg, y: CGFloat(e.top - origin[1]) / cg, width: CGFloat(e.right - e.left) / cg, height: CGFloat(e.bottom - e.top) / cg)
      if let bv = v as? DragonBoxView {
        guard let z = zBoxes[id] else { fatalError("dragon: no zoomed box \(id)") }
        let be = try box_resolveBorder(z.style, zoomed.devicePixelRatio)
        let px = [be.top / lu, be.right / lu, be.bottom / lu, be.left / lu]
        borders[id] = px
        bv.dragonBorderWidths = px.map { $0 / s }
        bv.dragonScale = s
        if let c = bv.dragonClipView {
          c.frame = CGRect(x: CGFloat(px[3]) / cg, y: CGFloat(px[0]) / cg, width: CGFloat(e.right - e.left - px[3] - px[1]) / cg, height: CGFloat(e.bottom - e.top - px[0] - px[2]) / cg)
        }
        bv.setNeedsDisplay()
      }
    }
    // Content widths in LU, for the text breaking width: the border box minus borders and paddings (percentages of the parent's).
    var contentCache: [String: Double] = [:]
    func contentWidth(_ id: String) throws -> Double {
      if let c = contentCache[id] { return c }
      guard let z = zBoxes[id], let r = rects[id] else { fatalError("dragon: no box \(id)") }
      let cb = try zParent[id].map { try contentWidth($0) } ?? units_fromCssPx(zoomed.viewport.width)
      let pad = try box_resolvePadding(z.style, cb)
      let bor = try box_resolveBorder(z.style, zoomed.devicePixelRatio)
      let w = r.width - bor.left - bor.right - pad.left - pad.right
      contentCache[id] = w
      return w
    }
    for id in order {
      guard let tv = views[id] as? DragonTextView else { continue }
      guard let pId = zParent[id], let p = zBoxes[pId], let e = edges[id] else { fatalError("dragon: text \(id) has no container") }
      let leaves = p.children.items.compactMap { $0 as? TextLeaf }
      guard let li = leaves.firstIndex(where: { $0.id.description == id }) else { fatalError("dragon: no leaf \(id)") }
      let scalars = Array(leaves[li].text.description.unicodeScalars)
      func utf16(_ cp: Int) -> Int { return scalars[0..<cp].reduce(0) { $0 + $1.utf16.count } }
      // The engine's own line metrics and line breaks: inline.ts buildRun and breakLines, translated, over the zoomed context.
      let ctx = Ctx(measurer, zoomed.devicePixelRatio, block_NO_ENGINE_FAULTS)
      let run = try inline_buildRun(ctx, p, JsArray(leaves))
      let engineLines = try inline_breakLines(ctx, run, try contentWidth(pId)).items
      let chars = run.chars.items
      let pieces = boxes.enumerated().filter { DragonTree.isLine($0.element) && $0.element.parent?.description == id }
      textMetrics[id] = (run.halfLeading / lu, run.ascent / lu, run.descent / lu)
      var specs: [DragonLineSpec] = []
      var lineTop0 = 0.0
      for line in engineLines {
        let mine = (Int(line.start)..<Int(line.visibleEnd)).filter { Int(chars[$0].leaf) == li }
        guard let first = mine.first, let last = mine.last else { continue }
        let k = specs.count
        if k >= pieces.count { fatalError("dragon: \(id): the engine's breaks give more lines than its layout (\(pieces.count))") }
        let (i, r) = pieces[k]
        let width = try inline_width(ctx, run, Double(first), Double(last + 1))
        if width != r.width { fatalError("dragon: \(id) line \(k): the engine's break gives width \(width) LU, its layout \(r.width) LU") }
        let throughEnd = (Int(line.start)..<Int(line.end)).filter { Int(chars[$0].leaf) == li }.last ?? last
        guard let a = abs.get(r.id) else { fatalError("dragon: no absolute rect for \(r.id)") }
        let top = try units_snapEdge(a.y - run.halfLeading)
        let bottom = try units_snapEdge(a.y - run.halfLeading + run.lineHeight)
        let baseline = snapped[i].top + run.ascent / lu
        if specs.isEmpty { lineTop0 = top }
        specs.append(DragonLineSpec(text: mine.map { chars[$0].ch.description }.joined(), top: CGFloat(top - lineTop0) / cg, bottom: CGFloat(bottom - lineTop0) / cg, baseline: CGFloat(baseline - lineTop0) / cg, left: CGFloat(snapped[i].left - e[0]) / cg, start: utf16(Int(chars[first].at)), end: utf16(Int(chars[throughEnd].at) + 1)))
      }
      if specs.count != pieces.count { fatalError("dragon: \(id): the engine's breaks give \(specs.count) lines, its layout \(pieces.count)") }
      let size = try units_platformFontSize(units_zoomFontSize(tv.dragonCssSize, s))
      tv.dragonConfigure(font: fontFor(size / s), lines: specs, originY: CGFloat(lineTop0 - e[1]) / cg)
    }
  }

  /// The dump read back from the live tree: frames via convert(bounds, to: root), applied values from the live objects.
  public func dump(_ c: DragonCase, scale: Double, device: DumpDevice, pixels: DumpPixels, timing: DumpTiming) -> Dump {
    let s = scale
    var nodes: [DumpNodes] = []
    for id in order {
      guard let v = views[id] else { continue }
      let r = v.convert(v.bounds, to: root)
      let l = dragonWholeDevicePx(Double(r.minX) * s, "\(id) left")
      let t = dragonWholeDevicePx(Double(r.minY) * s, "\(id) top")
      let rr = dragonWholeDevicePx(Double(r.maxX) * s, "\(id) right")
      let b = dragonWholeDevicePx(Double(r.maxY) * s, "\(id) bottom")
      var lines: [DumpNodesLines] = []
      if let tv = v as? DragonTextView, let m = textMetrics[id] {
        for x in tv.dragonReadLines() {
          let lineTop = dragonWholeDevicePx((Double(r.minY) + x.top) * s, "\(id) line top")
          let top = lineTop + m.halfLeading
          let bottom = top + m.ascent + m.descent
          let left = dragonHalfUp((Double(r.minX) + x.left) * s)
          let right = dragonHalfUp((Double(r.minX) + x.right) * s)
          let baseline = (Double(r.minY) + x.baseline) * s
          lines.append(DumpNodesLines(frame: DumpNodesLinesFrame(x: left / s, y: top / s, width: (right - left) / s, height: (bottom - top) / s), deviceEdges: DumpNodesLinesDeviceEdges(left: left, top: top, right: right, bottom: bottom), baseline: (baseline - top) / s, start: Double(x.start), end: Double(x.end)))
        }
      }
      nodes.append(DumpNodes(id: id, parent: parents[id] ?? nil, kind: v.dragonKind, native: String(describing: type(of: v)), frame: DumpNodesFrame(x: l / s, y: t / s, width: (rr - l) / s, height: (b - t) / s), deviceEdges: DumpNodesDeviceEdges(left: l, top: t, right: rr, bottom: b), applied: v.dragonApplied(), lines: lines))
    }
    return Dump(lane: "ios-sim", case: DumpCase(id: c.id, fixture: c.fixture, dpr: s, viewport: DumpCaseViewport(width: c.viewport.width, height: c.viewport.height), direction: c.direction, compilerDigest: c.compilerDigest, expectedDigest: c.expectedDigest(scale: s)), device: device, nodes: nodes, pixels: pixels, timing: timing)
  }
}

/// The compositor capture: drawHierarchy(afterScreenUpdates: true) of the fixture root into a declared sRGB RGBA8 CGContext
/// (layer.render is banned); the sha256 of the buffer and the pixels at the host-supplied points.
public func dragonCapture(_ view: UIView, scale: Double, points: [(x: Int, y: Int, rule: String)]) -> DumpPixels {
  let w = dragonCheckedInt(dragonWholeDevicePx(Double(view.bounds.width) * scale, "capture width"), "capture width")
  let h = dragonCheckedInt(dragonWholeDevicePx(Double(view.bounds.height) * scale, "capture height"), "capture height")
  var buf = [UInt8](repeating: 0, count: w * h * 4)
  guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { fatalError("dragon: no sRGB colour space") }
  buf.withUnsafeMutableBytes { raw in
    guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fatalError("dragon: no RGBA8 context") }
    ctx.translateBy(x: 0, y: CGFloat(h))
    ctx.scaleBy(x: CGFloat(scale), y: -CGFloat(scale))
    UIGraphicsPushContext(ctx)
    if !view.drawHierarchy(in: view.bounds, afterScreenUpdates: true) { fatalError("dragon: drawHierarchy failed") }
    UIGraphicsPopContext()
  }
  let sha = SHA256.hash(data: Data(buf)).map { String(format: "%02x", $0) }.joined()
  let samples = points.map { p -> DumpPixelsSamples in
    let i = (p.y * w + p.x) * 4
    return DumpPixelsSamples(x: Double(p.x), y: Double(p.y), rgba: [Double(buf[i]), Double(buf[i + 1]), Double(buf[i + 2]), Double(buf[i + 3])], rule: p.rule)
  }
  return DumpPixels(capture: "drawHierarchy", width: Double(w), height: Double(h), sha256: sha, samples: samples)
}
`;

// ---------------------------------------------------------------- Kotlin (Android Views)

const KOTLIN_CHECKED = String.raw`package dev.dragon.views

/** The checked conversion from an engine Double to an Int: traps on a non-finite, non-integral or out-of-Int32 value. */
fun dragonCheckedInt(v: Double, what: String): Int {
  if (!v.isFinite() || kotlin.math.truncate(v) != v || v < -2147483648.0 || v > 2147483647.0) {
    throw IllegalStateException("dragonCheckedInt: " + what + " = " + v + " is not an Int32 integer")
  }
  return v.toInt()
}

/** Round half up to whole device px (Blink LayoutUnit::Round), for a live text extent the native text engine measured. */
fun dragonHalfUp(v: Double): Double = kotlin.math.floor(v + 0.5)
`;

const KOTLIN_FONT_TABLES = String.raw`package dev.dragon.views

import dev.dragon.layout.FontData
import dev.dragon.layout.text_AHEM_FONT_DATA
import dev.dragon.layout.text_coveredCodePoints

/** Big-endian reads of the sfnt tables the bridge supplies (head, hhea). */
fun dragonU16(b: ByteArray, o: Int): Double {
  if (o + 2 > b.size) throw IllegalStateException("dragon font table: read past the end at " + o)
  return (((b[o].toInt() and 0xff) shl 8) or (b[o + 1].toInt() and 0xff)).toDouble()
}
fun dragonI16(b: ByteArray, o: Int): Double {
  val u = dragonU16(b, o)
  return if (u >= 32768.0) u - 65536.0 else u
}

/** A table of an sfnt buffer, found in its table directory. */
fun dragonSfntTable(font: ByteArray, tag: String): ByteArray {
  val n = dragonU16(font, 4).toInt()
  for (i in 0 until n) {
    val at = 12 + 16 * i
    val t = String(font, at, 4, Charsets.US_ASCII)
    if (t == tag) {
      val off = ((font[at + 8].toInt() and 0xff) shl 24) or ((font[at + 9].toInt() and 0xff) shl 16) or ((font[at + 10].toInt() and 0xff) shl 8) or (font[at + 11].toInt() and 0xff)
      val len = ((font[at + 12].toInt() and 0xff) shl 24) or ((font[at + 13].toInt() and 0xff) shl 16) or ((font[at + 14].toInt() and 0xff) shl 8) or (font[at + 15].toInt() and 0xff)
      return font.copyOfRange(off, off + len)
    }
  }
  throw IllegalStateException("dragon font table: no " + tag + " table")
}

/** unitsPerEm (head 18), ascender (hhea 4), descender (hhea 6, as a positive descent) and lineGap (hhea 8), in font units. */
fun dragonFontHeader(head: ByteArray, hhea: ByteArray): DoubleArray = doubleArrayOf(dragonU16(head, 18), dragonI16(hhea, 4), -dragonI16(hhea, 6), dragonI16(hhea, 8))

private fun u16(b: ByteArray, o: Int): Int = dragonU16(b, o).toInt()
private fun u32(b: ByteArray, o: Int): Int = (u16(b, o) shl 16) or u16(b, o + 2)

/** The glyph id of a code point from the cmap table (format 12, else format 4); 0 when it is not mapped. */
fun dragonGlyph(cmap: ByteArray, cp: Int): Int {
  val n = u16(cmap, 2)
  var f4 = -1
  var f12 = -1
  for (i in 0 until n) {
    val platform = u16(cmap, 4 + 8 * i)
    val encoding = u16(cmap, 6 + 8 * i)
    val off = u32(cmap, 8 + 8 * i)
    val format = u16(cmap, off)
    if (format == 12 && (platform == 0 || (platform == 3 && encoding == 10))) f12 = off
    if (format == 4 && (platform == 0 || (platform == 3 && encoding == 1)) && f4 < 0) f4 = off
  }
  if (f12 >= 0) {
    val groups = u32(cmap, f12 + 12)
    for (g in 0 until groups) {
      val at = f12 + 16 + 12 * g
      val start = u32(cmap, at)
      val end = u32(cmap, at + 4)
      if (cp in start..end) return u32(cmap, at + 8) + cp - start
    }
    return 0
  }
  if (f4 < 0 || cp > 0xffff) return 0
  val segX2 = u16(cmap, f4 + 6)
  for (k in 0 until segX2 / 2) {
    val end = u16(cmap, f4 + 14 + 2 * k)
    val start = u16(cmap, f4 + 16 + segX2 + 2 * k)
    if (cp < start || cp > end) continue
    val delta = u16(cmap, f4 + 16 + 2 * segX2 + 2 * k)
    val rangeAt = f4 + 16 + 3 * segX2 + 2 * k
    val range = u16(cmap, rangeAt)
    if (range == 0) return (cp + delta) and 0xffff
    val g = u16(cmap, rangeAt + range + 2 * (cp - start))
    return if (g == 0) 0 else (g + delta) and 0xffff
  }
  return 0
}

/** A glyph's advance in font units from hmtx (numberOfHMetrics is hhea 34; later glyphs repeat the last advance). */
fun dragonAdvance(hhea: ByteArray, hmtx: ByteArray, gid: Int): Double = dragonU16(hmtx, 4 * minOf(gid, u16(hhea, 34) - 1))

/** The raw data as the translated measurer's FontData. */
fun dragonFontData(unitsPerEm: Double, ascent: Double, descent: Double, lineGap: Double, advances: List<Double>): FontData = FontData(unitsPerEm, ascent, descent, lineGap, ArrayList(advances))

/** The bridge self-check: the raw data read from the bundled font equal the Ahem constants of the translated engine. */
fun dragonSelfCheck(d: FontData): List<String> {
  val want = text_AHEM_FONT_DATA
  val out = ArrayList<String>()
  if (d.unitsPerEm != want.unitsPerEm) out.add("unitsPerEm " + d.unitsPerEm + ", Ahem " + want.unitsPerEm)
  if (d.ascent != want.ascent) out.add("ascent " + d.ascent + ", Ahem " + want.ascent)
  if (d.descent != want.descent) out.add("descent " + d.descent + ", Ahem " + want.descent)
  if (d.lineGap != want.lineGap) out.add("lineGap " + d.lineGap + ", Ahem " + want.lineGap)
  val cps = text_coveredCodePoints()
  if (d.advances.size != want.advances.size) out.add("" + d.advances.size + " advances, Ahem " + want.advances.size)
  for (k in cps.indices) {
    if (k >= d.advances.size || k >= want.advances.size) break
    if (d.advances[k] != want.advances[k]) out.add("U+" + Integer.toHexString(cps[k].toInt()).uppercase() + " advance " + d.advances[k] + ", Ahem " + want.advances[k])
  }
  return out
}
`;

const KOTLIN_VIEWS = String.raw`package dev.dragon.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.ColorDrawable
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import android.text.style.LineHeightSpan
import android.view.View
import android.view.ViewGroup
import dev.dragon.dump.DumpJson

class DragonRGBA8(val r: Int, val g: Int, val b: Int, val a: Int)

/** ARGB from RGBA8 channels. */
fun dragonArgb(c: DragonRGBA8): Int = (c.a shl 24) or (c.r shl 16) or (c.g shl 8) or c.b

fun dragonColorJson(argb: Int): DumpJson = DumpJson.Arr(listOf(DumpJson.Num(((argb shr 16) and 0xff).toDouble()), DumpJson.Num(((argb shr 8) and 0xff).toDouble()), DumpJson.Num((argb and 0xff).toDouble()), DumpJson.Num(((argb ushr 24) and 0xff).toDouble())))

fun dragonRGBAJson(c: DragonRGBA8): DumpJson = DumpJson.Arr(listOf(DumpJson.Num(c.r.toDouble()), DumpJson.Num(c.g.toDouble()), DumpJson.Num(c.b.toDouble()), DumpJson.Num(c.a.toDouble())))

/** A laid-out node's view: its compiler id, kind and parent, and its applied values read back from the live object. */
interface DragonNodeView {
  val dragonId: String
  val dragonKind: String
  val dragonParent: String?
  fun dragonApplied(): List<Pair<String, DumpJson>>
}

/** A Dragon ViewGroup: onMeasure and onLayout only apply the frames stored from the engine (ints relative to this group). */
open class DragonGroup(ctx: Context) : ViewGroup(ctx) {
  /** This view's frame in its native parent: left, top, right, bottom in device px. */
  val dragonFrame = IntArray(4)
  init {
    clipChildren = false
    clipToPadding = false
    setWillNotDraw(false)
  }
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    for (i in 0 until childCount) {
      val c = getChildAt(i)
      val f = dragonFrameOf(c)
      c.measure(MeasureSpec.makeMeasureSpec(f[2] - f[0], MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(f[3] - f[1], MeasureSpec.EXACTLY))
    }
    setMeasuredDimension(dragonFrame[2] - dragonFrame[0], dragonFrame[3] - dragonFrame[1])
  }
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    for (i in 0 until childCount) {
      val c = getChildAt(i)
      val f = dragonFrameOf(c)
      c.layout(f[0], f[1], f[2], f[3])
    }
  }
}

fun dragonFrameOf(v: View): IntArray = when (v) {
  is DragonGroup -> v.dragonFrame
  is DragonTextView -> v.dragonFrame
  else -> throw IllegalStateException("dragon: " + v.javaClass.name + " is not a Dragon view")
}

/** The initial containing block: the fixture root at the device origin, white like Chrome's canvas. */
class DragonRootView(ctx: Context) : DragonGroup(ctx) {
  init { background = ColorDrawable(0xffffffff.toInt()) }
}

/** css-overflow-3 §3: the padding box of an overflow: hidden node; its children are clipped to its bounds (clipBounds). */
class DragonClipView(ctx: Context) : DragonGroup(ctx) {
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    clipBounds = Rect(0, 0, r - l, b - t)
    super.onLayout(changed, l, t, r, b)
  }
}

/** A box: the background is a native ColorDrawable; the four border sides are Dragon-owned paint. */
class DragonBoxView(ctx: Context, override val dragonId: String, override val dragonKind: String, override val dragonParent: String?) : DragonGroup(ctx), DragonNodeView {
  /** Whole device px, top right bottom left, from the engine at the device scale. */
  var dragonBorderWidths = intArrayOf(0, 0, 0, 0)
  var dragonBorderStyles = arrayOf("none", "none", "none", "none")
  var dragonBorderColors = arrayOf(DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0))
  var dragonClipView: DragonClipView? = null
    private set
  /** Overflow hidden: the children are hosted by a clip view over the padding box. */
  fun dragonEnableClip() {
    val c = DragonClipView(context)
    addView(c)
    dragonClipView = c
  }
  val dragonContainer: ViewGroup get() = dragonClipView ?: this
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    dragonDrawBorders(canvas, width.toFloat(), height.toFloat(), dragonBorderWidths, dragonBorderStyles, dragonBorderColors)
  }
  override fun dragonApplied(): List<Pair<String, DumpJson>> {
    val bg = background
    val out = arrayListOf<Pair<String, DumpJson>>(
      Pair("background.color", if (bg is ColorDrawable) dragonColorJson(bg.color) else DumpJson.Null),
      Pair("dragonBorder.widthsPx", DumpJson.Arr(dragonBorderWidths.map { DumpJson.Num(it.toDouble()) })),
      Pair("dragonBorder.styles", DumpJson.Arr(dragonBorderStyles.map { DumpJson.Str(it) })),
      Pair("dragonBorder.colors", DumpJson.Arr(dragonBorderColors.map { dragonRGBAJson(it) })),
    )
    val c = dragonClipView
    if (c != null) {
      val b = c.clipBounds
      out.add(Pair("dragonClip.clipBounds", if (b == null || b.left != 0 || b.top != 0 || b.right != c.width || b.bottom != c.height) DumpJson.Null else DumpJson.Arr(listOf(c.left, c.top, c.right, c.bottom).map { DumpJson.Num(it.toDouble()) })))
    }
    return out
  }
}

/**
 * Dragon-owned border paint: each side is the trapezoid between the outer and inner edges (corners join on the diagonal); solid
 * fills it, double fills its outer and inner thirds, dashed strokes dashes of 3 times the width with equal gaps along its middle,
 * dotted strokes round dots of the width with gaps of the width.
 */
fun dragonDrawBorders(canvas: Canvas, w: Float, h: Float, widths: IntArray, styles: Array<String>, colors: Array<DragonRGBA8>) {
  val t = widths[0].toFloat()
  val r = widths[1].toFloat()
  val b = widths[2].toFloat()
  val l = widths[3].toFloat()
  val quads = arrayOf(
    floatArrayOf(0f, 0f, w, 0f, w - r, t, l, t),
    floatArrayOf(w, 0f, w, h, w - r, h - b, w - r, t),
    floatArrayOf(w, h, 0f, h, l, h - b, w - r, h - b),
    floatArrayOf(0f, h, 0f, 0f, l, t, l, h - b),
  )
  for (k in 0 until 4) {
    val width = widths[k].toFloat()
    val style = styles[k]
    if (width <= 0f || style == "none" || style == "hidden" || colors[k].a == 0) continue
    canvas.save()
    val q = quads[k]
    val path = Path()
    path.moveTo(q[0], q[1]); path.lineTo(q[2], q[3]); path.lineTo(q[4], q[5]); path.lineTo(q[6], q[7]); path.close()
    canvas.clipPath(path)
    val paint = Paint()
    paint.isAntiAlias = true
    paint.color = dragonArgb(colors[k])
    val third = width / 3f
    fun band(d: Float, th: Float): RectF = when (k) {
      0 -> RectF(0f, d, w, d + th)
      1 -> RectF(w - d - th, 0f, w - d, h)
      2 -> RectF(0f, h - d - th, w, h - d)
      else -> RectF(d, 0f, d + th, h)
    }
    when (style) {
      "double" -> {
        paint.style = Paint.Style.FILL
        canvas.drawRect(band(0f, third), paint)
        canvas.drawRect(band(width - third, third), paint)
      }
      "dashed", "dotted" -> {
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = width
        val m = band(width / 2f, 0f)
        if (style == "dashed") {
          paint.strokeCap = Paint.Cap.BUTT
          paint.pathEffect = DashPathEffect(floatArrayOf(3f * width, 3f * width), 0f)
        } else {
          paint.strokeCap = Paint.Cap.ROUND
          paint.pathEffect = DashPathEffect(floatArrayOf(0.001f, 2f * width), 0f)
        }
        val line = Path()
        if (k == 0 || k == 2) { line.moveTo(m.left, m.top); line.lineTo(m.right, m.top) } else { line.moveTo(m.left, m.top); line.lineTo(m.left, m.bottom) }
        canvas.drawPath(line, paint)
      }
      else -> {
        paint.style = Paint.Style.FILL
        canvas.drawRect(0f, 0f, w, h, paint)
      }
    }
    canvas.restore()
  }
}

/**
 * One engine line of a text node: the engine's line text (its visible characters), the line box and baseline in device px relative
 * to the layout origin, the line-left relative to the view, and its UTF-16 offsets in the node's text.
 */
class DragonLineSpec(val text: String, val top: Int, val bottom: Int, val baseline: Int, val left: Double, val start: Int, val end: Int)

/**
 * A text node: a StaticLayout (BREAK_STRATEGY_SIMPLE, HYPHENATION_FREQUENCY_NONE, no include pad, no fallback line spacing). The
 * engine owns the line breaks (decisions.md, Text strategy): the layout holds the engine's lines, each its own paragraph, in an
 * unbounded width, so StaticLayout never chooses a break. A LineHeightSpan over the whole text sets each line's box and baseline
 * from the engine's data, and each line is drawn at the engine's line-left. Advances use a linear (unhinted) paint.
 */
class DragonTextView(ctx: Context, override val dragonId: String, override val dragonKind: String, override val dragonParent: String?) : View(ctx), DragonNodeView {
  val dragonFrame = IntArray(4)
  val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
  var dragonText = ""
    private set
  var dragonFamily = ""
    private set
  var dragonCssSize = 0.0
    private set
  var dragonColor = DragonRGBA8(0, 0, 0, 255)
    private set
  var layout: StaticLayout? = null
    private set
  private var joined = ""
  private var specs: List<DragonLineSpec> = emptyList()
  private val lineIndex = HashMap<Int, Int>()
  /** The layout origin in the view: the first line box's top relative to the content-area top of the node, device px. */
  var originY = 0
    private set
  /** Per native line: the shift from the native line-left to the engine's. */
  private var shifts = DoubleArray(0)

  /** The text run from the program: text, font family and CSS size, colour. */
  fun dragonSetText(text: String, family: String, cssSize: Double, color: DragonRGBA8) {
    dragonText = text
    dragonFamily = family
    dragonCssSize = cssSize
    dragonColor = color
  }

  private inner class EngineLines : LineHeightSpan {
    override fun chooseHeight(text: CharSequence, start: Int, end: Int, spanstartv: Int, lineHeight: Int, fm: Paint.FontMetricsInt) {
      val k = lineIndex.getOrPut(start) { lineIndex.size }
      if (k >= specs.size) return
      val s = specs[k]
      fm.ascent = s.top - s.baseline
      fm.top = fm.ascent
      fm.descent = s.bottom - s.baseline
      fm.bottom = fm.descent
    }
  }

  /** The engine's data at the device scale: the instance text size and the engine's lines. */
  fun dragonConfigure(typeface: android.graphics.Typeface, textSize: Float, lines: List<DragonLineSpec>, originY: Int) {
    specs = lines
    this.originY = originY
    lineIndex.clear()
    paint.typeface = typeface
    paint.textSize = textSize
    paint.color = dragonArgb(dragonColor)
    joined = lines.joinToString("\n") { it.text }
    val sp = SpannableString(joined)
    sp.setSpan(EngineLines(), 0, joined.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
    val l = StaticLayout.Builder.obtain(sp, 0, sp.length, paint, 1 shl 24)
      .setAlignment(Layout.Alignment.ALIGN_NORMAL)
      .setTextDirection(TextDirectionHeuristics.LTR)
      .setBreakStrategy(Layout.BREAK_STRATEGY_SIMPLE)
      .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
      .setIncludePad(false)
      .setUseLineSpacingFromFallbacks(false)
      .setLineSpacing(0f, 1f)
      .build()
    layout = l
    if (l.lineCount != specs.size) throw IllegalStateException("dragon: " + dragonId + " has " + l.lineCount + " native lines, the engine " + specs.size)
    shifts = DoubleArray(l.lineCount)
    for (j in 0 until l.lineCount) shifts[j] = specs[j].left - l.getLineLeft(j).toDouble()
    invalidate()
  }

  private fun lineTextEnd(l: Layout, j: Int): Int {
    val e = l.getLineEnd(j)
    return if (e > l.getLineStart(j) && joined[e - 1] == '\n') e - 1 else e
  }

  override fun onDraw(canvas: Canvas) {
    val l = layout ?: return
    for (j in 0 until l.lineCount) {
      canvas.save()
      canvas.clipRect(-1e6f, (originY + l.getLineTop(j)).toFloat(), 1e6f, (originY + l.getLineBottom(j)).toFloat())
      canvas.translate(shifts[j].toFloat(), originY.toFloat())
      l.draw(canvas)
      canvas.restore()
    }
  }

  override fun dragonApplied(): List<Pair<String, DumpJson>> {
    val face = paint.typeface
    return listOf(
      Pair("textPaint.typeface", if (face != null && face === DragonBridge.shared(context).typeface) DumpJson.Obj(listOf(Pair("typeface", DumpJson.Str("dragon:" + dragonFamily)), Pair("textSize", DumpJson.Num(paint.textSize.toDouble())))) else DumpJson.Null),
      Pair("textPaint.color", dragonColorJson(paint.color)),
    )
  }

  /**
   * Every line read back from the live layout, in device px relative to the view: line box top, baseline, and the left and right
   * of the line's glyphs (a linear run advance); the offsets are the engine's, after checking the line holds its text.
   */
  fun dragonReadLines(): List<DoubleArray> {
    val l = layout ?: return emptyList()
    val out = ArrayList<DoubleArray>()
    for (j in 0 until l.lineCount) {
      val start = l.getLineStart(j)
      val end = lineTextEnd(l, j)
      val spec = specs[j]
      if (joined.substring(start, end) != spec.text) throw IllegalStateException("dragon: " + dragonId + " line " + j + " holds a different text than the engine's line")
      val left = shifts[j] + l.getLineLeft(j)
      val right = left + paint.getRunAdvance(joined, start, end, start, end, false, end)
      out.add(doubleArrayOf((originY + l.getLineTop(j)).toDouble(), (originY + l.getLineBaseline(j)).toDouble(), left, right, spec.start.toDouble(), spec.end.toDouble()))
    }
    return out
  }
}
`;

const KOTLIN_BRIDGE = String.raw`package dev.dragon.views

import android.content.Context
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import dev.dragon.dump.DumpJsonWriter
import dev.dragon.layout.AhemRuleFaults
import dev.dragon.layout.FontData
import dev.dragon.layout.TextMeasurer
import dev.dragon.layout.text_coveredCodePoints
import dev.dragon.layout.text_fontDataMeasurer
import java.security.MessageDigest

/**
 * The measurer bridge (R4): raw data read from the bundled Ahem's tables in the android.graphics.fonts.Font (API 29) buffer (head, hhea, cmap, hmtx), fed to the
 * translated font-data measurer with the darwin-arm64 platform rules. It never uses the platform's rounded line metrics.
 */
class DragonBridge private constructor(ctx: Context) {
  val fontSha256: String
  val data: FontData
  val selfCheck: List<String>
  val measurer: TextMeasurer
  /** The Ahem typeface under the Dragon id dragon:Ahem. */
  val typeface: Typeface
  init {
    val bytes = ctx.assets.open("fonts/Ahem.ttf").use { it.readBytes() }
    fontSha256 = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { String.format("%02x", it.toInt() and 0xff) }
    val font = Font.Builder(ctx.assets, "fonts/Ahem.ttf").build()
    val buffer = font.buffer
    val raw = ByteArray(buffer.remaining())
    buffer.duplicate().get(raw)
    val header = dragonFontHeader(dragonSfntTable(raw, "head"), dragonSfntTable(raw, "hhea"))
    typeface = Typeface.CustomFallbackBuilder(FontFamily.Builder(font).build()).build()
    // Advances in font units: the font at textSize = unitsPerEm advances each glyph by its units.
    // Advances in integer font units from the font's own cmap and hmtx (PM ruling, option a): the units Chrome's HarfBuzz scales
    // by size / unitsPerEm. Paint.getRunAdvance is only an evidence probe (record()).
    val cmap = dragonSfntTable(raw, "cmap")
    val hmtx = dragonSfntTable(raw, "hmtx")
    val hhea = dragonSfntTable(raw, "hhea")
    val advances = ArrayList<Double>()
    for (cp in text_coveredCodePoints()) {
      val gid = dragonGlyph(cmap, cp.toInt())
      advances.add(if (gid == 0) -1.0 else dragonAdvance(hhea, hmtx, gid))
    }
    data = dragonFontData(header[0], header[1], header[2], header[3], advances)
    selfCheck = dragonSelfCheck(data)
    measurer = text_fontDataMeasurer(data, AhemRuleFaults(false, false))
  }
  /** The self-check record written beside the dumps. */
  fun record(platform: String): String {
    val w = DumpJsonWriter()
    w.beginObject()
    w.key("platform"); w.string(platform, true, "bridge.platform")
    w.key("ruleKey"); w.string("darwin-arm64", true, "bridge.ruleKey")
    w.key("postScriptName"); w.string("dragon:Ahem", true, "bridge.postScriptName")
    w.key("fontSha256"); w.string(fontSha256, true, "bridge.fontSha256")
    w.key("unitsPerEm"); w.number(data.unitsPerEm, "bridge.unitsPerEm")
    w.key("ascent"); w.number(data.ascent, "bridge.ascent")
    w.key("descent"); w.number(data.descent, "bridge.descent")
    w.key("lineGap"); w.number(data.lineGap, "bridge.lineGap")
    w.key("advances"); w.array(data.advances, null, "bridge.advances") { x -> w.number(x, "bridge.advances[]") }
    w.key("probe"); w.array(PROBE_SIZES, null, "bridge.probe") { size ->
      // Evidence only, never an input: the run advance of U+0058 at other text sizes, in font units.
      val p = Paint(Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
      p.typeface = typeface
      p.textSize = size.toFloat()
      w.beginObject()
      w.key("textSize"); w.number(size, "bridge.probe.textSize")
      w.key("advanceUnits"); w.number(p.getRunAdvance("X", 0, 1, 0, 1, false, 1).toDouble() * data.unitsPerEm / size, "bridge.probe.advanceUnits")
      w.endObject()
    }
    w.key("selfCheck"); w.string(if (selfCheck.isEmpty()) "pass" else "fail", true, "bridge.selfCheck")
    w.key("mismatches"); w.array(selfCheck, null, "bridge.mismatches") { x -> w.string(x, true, "bridge.mismatches[]") }
    w.endObject()
    return w.text.toString()
  }
  companion object {
    /** Text sizes of the evidence-only advance probe written beside the self-check. */
    val PROBE_SIZES = listOf(10.0, 26.25, 100.0, 256.0, 257.0, 512.0, 1000.0, 2048.0)
    @Volatile private var instance: DragonBridge? = null
    fun shared(ctx: Context): DragonBridge = instance ?: synchronized(this) { instance ?: DragonBridge(ctx.applicationContext).also { instance = it } }
  }
}
`;

const KOTLIN_TREE = String.raw`package dev.dragon.views

import android.content.Context
import android.graphics.drawable.ColorDrawable
import android.view.ViewGroup
import dev.dragon.dump.Dump
import dev.dragon.dump.DumpCase
import dev.dragon.dump.DumpCaseViewport
import dev.dragon.dump.DumpDevice
import dev.dragon.dump.DumpNodes
import dev.dragon.dump.DumpNodesDeviceEdges
import dev.dragon.dump.DumpNodesFrame
import dev.dragon.dump.DumpNodesLines
import dev.dragon.dump.DumpNodesLinesDeviceEdges
import dev.dragon.dump.DumpNodesLinesFrame
import dev.dragon.dump.DumpPixels
import dev.dragon.dump.DumpTiming
import dev.dragon.layout.Ctx
import dev.dragon.layout.LayoutBox
import dev.dragon.layout.LayoutInput
import dev.dragon.layout.LayoutRect
import dev.dragon.layout.LayoutResult_ok
import dev.dragon.layout.TextLeaf
import dev.dragon.layout.TextMeasurer
import dev.dragon.layout.block_NO_ENGINE_FAULTS
import dev.dragon.layout.box_resolveBorder
import dev.dragon.layout.box_resolvePadding
import dev.dragon.layout.inline_breakLines
import dev.dragon.layout.inline_buildRun
import dev.dragon.layout.inline_width
import dev.dragon.layout.layout_absoluteRects
import dev.dragon.layout.layout_layout
import dev.dragon.layout.layout_zoomInput
import dev.dragon.layout.snap_snapEdges
import dev.dragon.layout.units_LU_PER_PX
import dev.dragon.layout.units_fromCssPx
import dev.dragon.layout.units_platformFontSize
import dev.dragon.layout.units_snapEdge
import dev.dragon.layout.units_zoomFontSize

/** One compiled case in the app: its identity, the engine input as typed constructor calls, and the view-building function. */
class DragonCase(
  val id: String,
  val fixture: String,
  val direction: String,
  val compilerDigest: String,
  val viewportWidth: Double,
  val viewportHeight: Double,
  val expectedDigests: Map<Double, String>,
  val input: (Double) -> LayoutInput,
  val build: (DragonTree) -> Unit,
) {
  /** The digest of the expected dump at a device scale; an unknown scale fails loudly. */
  fun expectedDigest(scale: Double): String = expectedDigests[scale] ?: throw IllegalStateException("dragon: case " + id + " has no expected dump at scale " + scale + " (known: " + expectedDigests.keys.sorted() + ")")
}

/**
 * The native tree of one case: builds the views, applies the translated engine's snapped frames at the device scale through
 * View.layout ints from dragonCheckedInt, and reads the dump back from the live tree.
 */
class DragonTree(val context: Context) {
  val root = DragonRootView(context)
  private val views = HashMap<String, DragonNodeView>()
  private val order = ArrayList<String>()
  private val parents = HashMap<String, String?>()
  private val textMetrics = HashMap<String, DoubleArray>()

  fun boxNode(id: String, parent: String?, kind: String): DragonBoxView {
    val v = DragonBoxView(context, id, kind, parent)
    views[id] = v
    return v
  }
  fun textNode(id: String, parent: String?, kind: String): DragonTextView {
    val v = DragonTextView(context, id, kind, parent)
    views[id] = v
    return v
  }

  private fun isLine(r: LayoutRect): Boolean {
    val p = r.parent ?: return false
    return r.id.startsWith(p + ":line")
  }

  private fun setFrame(f: IntArray, l: Double, t: Double, r: Double, b: Double, what: String) {
    f[0] = dragonCheckedInt(l, what + " left")
    f[1] = dragonCheckedInt(t, what + " top")
    f[2] = dragonCheckedInt(r, what + " right")
    f[3] = dragonCheckedInt(b, what + " bottom")
  }

  /** Runs the translated engine at the device scale, snaps with the translated snapEdges and stores every frame in device px. */
  fun apply(input: LayoutInput, measurer: TextMeasurer, scale: Double, bridge: DragonBridge) {
    val result = layout_layout(input, measurer)
    val refused = result as? dev.dragon.layout.LayoutResult_unsupported
    if (refused != null) throw IllegalStateException("dragon: the engine refused the case: " + refused.unsupported.code + " at " + refused.unsupported.nodeId + ": " + refused.unsupported.detail)
    val ok = result as? LayoutResult_ok ?: throw IllegalStateException("dragon: the engine gave no result")
    val boxes = ok.boxes
    val snapped = snap_snapEdges(ok.boxes)
    val abs = layout_absoluteRects(ok.boxes)
    val zoomed = layout_zoomInput(input, block_NO_ENGINE_FAULTS)
    val zBoxes = HashMap<String, LayoutBox>()
    val zParent = HashMap<String, String>()
    fun walk(b: LayoutBox) {
      zBoxes[b.id] = b
      for (c in b.children) {
        if (c is LayoutBox) { zParent[c.id] = b.id; walk(c) } else if (c is TextLeaf) zParent[c.id] = b.id
      }
    }
    walk(zoomed.root)
    val lu = units_LU_PER_PX
    setFrame(root.dragonFrame, 0.0, 0.0, kotlin.math.ceil(input.viewport.width * scale), kotlin.math.ceil(input.viewport.height * scale), "root")
    val edges = HashMap<String, DoubleArray>()
    val borders = HashMap<String, DoubleArray>()
    val rects = HashMap<String, LayoutRect>()
    for (i in boxes.indices) {
      val r = boxes[i]
      if (isLine(r)) continue
      val id = r.id
      val e = snapped[i]
      val v = views[id] ?: throw IllegalStateException("dragon: the engine laid out " + id + ", which the program did not build")
      edges[id] = doubleArrayOf(e.left, e.top, e.right, e.bottom)
      rects[id] = r
      order.add(id)
      parents[id] = r.parent
      var container: ViewGroup = root
      var ox = 0.0
      var oy = 0.0
      val p = r.parent
      if (p != null) {
        val pv = views[p] as? DragonBoxView ?: throw IllegalStateException("dragon: " + id + " has no parent box " + p)
        val pe = edges[p] ?: throw IllegalStateException("dragon: parent " + p + " is not placed")
        val pb = borders[p] ?: throw IllegalStateException("dragon: parent " + p + " has no borders")
        container = pv.dragonContainer
        ox = if (pv.dragonClipView == null) pe[0] else pe[0] + pb[3]
        oy = if (pv.dragonClipView == null) pe[1] else pe[1] + pb[0]
      }
      container.addView(v as android.view.View)
      setFrame(dragonFrameOf(v), e.left - ox, e.top - oy, e.right - ox, e.bottom - oy, id)
      if (v is DragonBoxView) {
        val z = zBoxes[id] ?: throw IllegalStateException("dragon: no zoomed box " + id)
        val be = box_resolveBorder(z.style, zoomed.devicePixelRatio)
        val px = doubleArrayOf(be.top / lu, be.right / lu, be.bottom / lu, be.left / lu)
        borders[id] = px
        v.dragonBorderWidths = intArrayOf(dragonCheckedInt(px[0], id + " border top"), dragonCheckedInt(px[1], id + " border right"), dragonCheckedInt(px[2], id + " border bottom"), dragonCheckedInt(px[3], id + " border left"))
        val c = v.dragonClipView
        if (c != null) setFrame(c.dragonFrame, px[3], px[0], e.right - e.left - px[1], e.bottom - e.top - px[2], id + " clip")
        v.invalidate()
      }
    }
    val contentCache = HashMap<String, Double>()
    fun contentWidth(id: String): Double {
      val cached = contentCache[id]
      if (cached != null) return cached
      val z = zBoxes[id] ?: throw IllegalStateException("dragon: no box " + id)
      val r = rects[id] ?: throw IllegalStateException("dragon: no rect " + id)
      val parent = zParent[id]
      val cb = if (parent != null) contentWidth(parent) else units_fromCssPx(zoomed.viewport.width)
      val pad = box_resolvePadding(z.style, cb)
      val bor = box_resolveBorder(z.style, zoomed.devicePixelRatio)
      val w = r.width - bor.left - bor.right - pad.left - pad.right
      contentCache[id] = w
      return w
    }
    for (id in order) {
      val tv = views[id] as? DragonTextView ?: continue
      val pId = zParent[id] ?: throw IllegalStateException("dragon: text " + id + " has no container")
      val p = zBoxes[pId] ?: throw IllegalStateException("dragon: no container " + pId)
      val e = edges[id] ?: throw IllegalStateException("dragon: text " + id + " is not placed")
      val leaves = ArrayList(p.children.filterIsInstance<TextLeaf>())
      val li = leaves.indexOfFirst { it.id == id }
      if (li < 0) throw IllegalStateException("dragon: no leaf " + id)
      val leafText = leaves[li].text
      fun utf16(cp: Int): Int = leafText.offsetByCodePoints(0, cp)
      // The engine's own line metrics and line breaks: inline.ts buildRun and breakLines, translated, over the zoomed context.
      val ctx = Ctx(measurer, zoomed.devicePixelRatio, block_NO_ENGINE_FAULTS)
      val run = inline_buildRun(ctx, p, leaves)
      val engineLines = inline_breakLines(ctx, run, contentWidth(pId))
      val chars = run.chars
      val pieces = boxes.indices.filter { isLine(boxes[it]) && boxes[it].parent == id }
      textMetrics[id] = doubleArrayOf(run.halfLeading / lu, run.ascent / lu, run.descent / lu)
      val specs = ArrayList<DragonLineSpec>()
      var lineTop0 = 0.0
      for (line in engineLines) {
        val mine = (line.start.toInt() until line.visibleEnd.toInt()).filter { chars[it].leaf.toInt() == li }
        if (mine.isEmpty()) continue
        val first = mine.first()
        val last = mine.last()
        val k = specs.size
        if (k >= pieces.size) throw IllegalStateException("dragon: " + id + ": the engine's breaks give more lines than its layout (" + pieces.size + ")")
        val i = pieces[k]
        val r = boxes[i]
        val width = inline_width(ctx, run, first.toDouble(), (last + 1).toDouble())
        if (width != r.width) throw IllegalStateException("dragon: " + id + " line " + k + ": the engine's break gives width " + width + " LU, its layout " + r.width + " LU")
        val throughEnd = (line.start.toInt() until line.end.toInt()).filter { chars[it].leaf.toInt() == li }.lastOrNull() ?: last
        val a = abs.get(r.id) ?: throw IllegalStateException("dragon: no absolute rect for " + r.id)
        val top = units_snapEdge(a.y - run.halfLeading)
        val bottom = units_snapEdge(a.y - run.halfLeading + run.lineHeight)
        val baseline = snapped[i].top + run.ascent / lu
        if (specs.isEmpty()) lineTop0 = top
        specs.add(DragonLineSpec(mine.joinToString("") { chars[it].ch }, dragonCheckedInt(top - lineTop0, id + " line top"), dragonCheckedInt(bottom - lineTop0, id + " line bottom"), dragonCheckedInt(baseline - lineTop0, id + " baseline"), snapped[i].left - e[0], utf16(chars[first].at.toInt()), utf16(chars[throughEnd].at.toInt() + 1)))
      }
      if (specs.size != pieces.size) throw IllegalStateException("dragon: " + id + ": the engine's breaks give " + specs.size + " lines, its layout " + pieces.size)
      val size = units_platformFontSize(units_zoomFontSize(tv.dragonCssSize, scale))
      tv.dragonConfigure(bridge.typeface, size.toFloat(), specs, dragonCheckedInt(lineTop0 - e[1], id + " origin"))
    }
  }

  /** The dump read back from the live tree: frames from getLocationInWindow minus the root's, divided by density. */
  fun dump(c: DragonCase, scale: Double, device: DumpDevice, pixels: DumpPixels, timing: DumpTiming): Dump {
    val s = scale
    val rootAt = IntArray(2)
    root.getLocationInWindow(rootAt)
    val nodes = ArrayList<DumpNodes>()
    for (id in order) {
      val v = views[id] ?: continue
      val view = v as android.view.View
      val at = IntArray(2)
      view.getLocationInWindow(at)
      val l = (at[0] - rootAt[0]).toDouble()
      val t = (at[1] - rootAt[1]).toDouble()
      val rr = l + view.width
      val b = t + view.height
      val lines = ArrayList<DumpNodesLines>()
      val m = textMetrics[id]
      if (v is DragonTextView && m != null) {
        for (x in v.dragonReadLines()) {
          val top = t + x[0] + m[0]
          val bottom = top + m[1] + m[2]
          val left = dragonHalfUp(l + x[2])
          val right = dragonHalfUp(l + x[3])
          val baseline = t + x[1]
          lines.add(DumpNodesLines(DumpNodesLinesFrame(left / s, top / s, (right - left) / s, (bottom - top) / s), DumpNodesLinesDeviceEdges(left, top, right, bottom), (baseline - top) / s, x[4], x[5]))
        }
      }
      nodes.add(DumpNodes(id, parents[id], v.dragonKind, view.javaClass.name, DumpNodesFrame(l / s, t / s, (rr - l) / s, (b - t) / s), DumpNodesDeviceEdges(l, t, rr, b), v.dragonApplied(), lines))
    }
    return Dump("android-emu", DumpCase(c.id, c.fixture, s, DumpCaseViewport(c.viewportWidth, c.viewportHeight), c.direction, c.compilerDigest, c.expectedDigest(s)), device, nodes, pixels, timing)
  }
}

/** The background write of a box: a native ColorDrawable. */
fun dragonBackground(v: DragonBoxView, c: DragonRGBA8) {
  v.background = ColorDrawable(dragonArgb(c))
}
`;

export type SupportFile = { readonly path: string; readonly text: string };

const header = (comment: string, what: string): string => `${comment} GENERATED by dragon emit/native-support.ts (${NATIVE_SUPPORT_VERSION}): ${what}. Do not edit.\n`;

/** The support files of a backend, relative to the generated source root. */
export function emitNativeSupport(backend: NativeBackend): GeneratedFile[] {
  if (backend === 'uikit') {
    return [
      { path: 'Support/DragonChecked.swift', text: header('//', 'checked conversions') + SWIFT_CHECKED },
      { path: 'Support/DragonFontTables.swift', text: header('//', 'font table reads and the bridge self-check') + SWIFT_FONT_TABLES },
      { path: 'Support/DragonViews.swift', text: header('//', 'the Dragon views and the TextKit 1 text view') + SWIFT_VIEWS },
      { path: 'Support/DragonBridge.swift', text: header('//', 'the font-data measurer bridge') + SWIFT_BRIDGE },
      { path: 'Support/DragonTree.swift', text: header('//', 'the native tree, engine application and dump readback') + SWIFT_TREE },
    ];
  }
  return [
    { path: 'kotlin/dev/dragon/views/DragonChecked.kt', text: header('//', 'checked conversions') + KOTLIN_CHECKED },
    { path: 'kotlin/dev/dragon/views/DragonFontTables.kt', text: header('//', 'font table reads and the bridge self-check') + KOTLIN_FONT_TABLES },
    { path: 'kotlin/dev/dragon/views/DragonViews.kt', text: header('//', 'the Dragon views and the StaticLayout text view') + KOTLIN_VIEWS },
    { path: 'kotlin/dev/dragon/views/DragonBridge.kt', text: header('//', 'the font-data measurer bridge') + KOTLIN_BRIDGE },
    { path: 'kotlin/dev/dragon/views/DragonTree.kt', text: header('//', 'the native tree, engine application and dump readback') + KOTLIN_TREE },
  ];
}

/** The support file paths per backend. */
export const SUPPORT_FILES: { readonly [B in NativeBackend]: readonly string[] } = {
  uikit: emitNativeSupport('uikit').map((f) => f.path),
  'android-views': emitNativeSupport('android-views').map((f) => f.path),
};

/** The checked-conversion source alone, for the host trap tests (it imports only Foundation, or nothing on Kotlin). */
export function checkedConversionSource(backend: NativeBackend): string {
  return backend === 'uikit' ? SWIFT_CHECKED : KOTLIN_CHECKED;
}

/** The digest of the emitted support code of a backend, recorded in the generated case headers. */
export function supportDigest(backend: NativeBackend): string {
  return sha256Hex(emitNativeSupport(backend).map((f) => `${f.path}\n${f.text}`).join('\n')).slice(0, 16);
}

// ---------------------------------------------------------------- shared emission helpers

export type Lang = 'swift' | 'kotlin';

/** A string literal, escaping everything outside printable ASCII (and $ in Kotlin). */
export function stringLit(lang: Lang, s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (lang === 'kotlin' && ch === '$') out += '\\$';
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (lang === 'swift') out += `\\u{${cp.toString(16)}}`;
    else if (cp < 0x10000) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += `\\u${ch.charCodeAt(0).toString(16)}\\u${ch.charCodeAt(1).toString(16)}`;
  }
  return `${out}"`;
}

/** A Double literal that reads back as the same double in Swift and Kotlin. */
export function doubleLit(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`non-finite number ${v} in an engine input`);
  if (Object.is(v, -0)) return '-0.0';
  const s = String(v);
  return /[.e]/.test(s) ? s.replace(/e\+?/, 'E') : `${s}.0`;
}

/** LayoutStyle fields in the order of the translated class's constructor (input.ts). */
export const STYLE_FIELDS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'overflowX', 'overflowY', 'direction', 'boxSizing', 'width', 'height', 'minWidth', 'minHeight',
  'maxWidth', 'maxHeight', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis', 'order',
  'justifyContent', 'alignItems', 'alignSelf', 'alignContent', 'rowGap', 'columnGap', 'textAlign',
] as const;

const VALUE_CLASSES: Readonly<Record<string, string>> = { px: 'Px', percent: 'Percent', auto: 'Auto', none: 'NoneValue', content: 'ContentValue', normal: 'NormalValue', number: 'NumberValue', 'device-px': 'DevicePx' };

/** A typed engine value as a constructor call of the translated engine. */
function engineValue(lang: Lang, v: unknown): string {
  const str = (s: string): string => (lang === 'swift' ? `JsString(${stringLit(lang, s)})` : stringLit(lang, s));
  if (typeof v === 'string') return str(v);
  if (typeof v === 'number') return doubleLit(v);
  const o = v as { kind: string; value?: number };
  const cls = VALUE_CLASSES[o.kind];
  if (cls === undefined) throw new Error(`no engine class for value kind ${o.kind}`);
  return o.value === undefined ? `${cls}(${str(o.kind)})` : `${cls}(${str(o.kind)}, ${doubleLit(o.value)})`;
}

/**
 * Functions that build a LayoutInput with the translated engine's typed constructors (no JSON, no CSS): one small function per box,
 * which builds its style, its text leaves and calls its child boxes' functions. Returns the declarations and the root call.
 */
export function inputFunctions(lang: Lang, root: import('@dragon/layout').LayoutBox, prefix: string): { readonly decls: readonly string[]; readonly root: string } {
  const decls: string[] = [];
  let n = 0;
  const str = (s: string): string => (lang === 'swift' ? `JsString(${stringLit(lang, s)})` : stringLit(lang, s));
  const visit = (b: import('@dragon/layout').LayoutBox): string => {
    const name = `${prefix}Box${n++}`;
    const kids = b.children.map((c) => (c.kind === 'box'
      ? `${visit(c)}()`
      : `TextLeaf(${str('text')}, ${str(c.id)}, ${str(c.text)}, TextFont(${str(c.font.family)}, ${doubleLit(c.font.size)}), ${engineValue(lang, c.lineHeight)}, ${str(c.whiteSpaceCollapse)}, ${str(c.textWrapMode)})`));
    const style = `LayoutStyle(${STYLE_FIELDS.map((f) => engineValue(lang, (b.style as unknown as Record<string, unknown>)[f])).join(', ')})`;
    const arr = lang === 'swift' ? `JsArray<any U_LayoutBox_TextLeaf>([${kids.join(', ')}])` : `jsArrayOf<U_LayoutBox_TextLeaf>(${kids.join(', ')})`;
    const body = `LayoutBox(${str('box')}, ${str(b.id)}, ${str(b.boxType)}, ${style}, ${arr})`;
    decls.push(lang === 'swift' ? `private func ${name}() -> LayoutBox {\n  return ${body}\n}` : `private fun ${name}(): LayoutBox =\n  ${body}`);
    return name;
  };
  const r = visit(root);
  return { decls, root: `${r}()` };
}

/** Splits statements into chunks of at most size, so no generated function grows past what the optimisers handle quickly. */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
