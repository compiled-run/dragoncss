// Support code emitted with the native output (docs/api.md 4.4; notes/T013-p3-review-p4-plan.md section 2 items 2 and 3): the
// checked conversions, the Dragon views (box, clip and the text view that places every glyph itself), the tree that applies the translated
// engine's snapped frames at the device scale, the font-data measurer bridge with its Ahem self-check, and the dump reader. It is
// emitted source, never a hand-written file and never a runtime package. Line boxes, baselines, border widths and the text
// instance size come from the translated engine; nothing is recomputed from UIFont or FontMetrics.
import { sha256Hex } from '../digest.ts';
import type { GeneratedFile } from '../types.ts';
import type { FontSpec } from '@dragon/layout';
import type { NativeBackend, NativeProgram } from '../lower/native-program.ts';
import type { PaintPlantName } from './paint/registry.ts';
import { nativePaints, PAINT_STAGES, paintPlants, soleHook, stagePainters } from './paint/registry.ts';
import { runtimeSupportFiles } from './runtime/index.ts';

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

/// The metrics font-relative units read, in font units (T005's rule): glyph x's glyf yMax (loca format from head 50), OS/2
/// sCapHeight (OS/2 88, version 2 or later) and the hmtx advance of glyph 0; 0 where the font has none.
public func dragonMetricUnits(head: [UInt8], hhea: [UInt8], hmtx: [UInt8], cmap: [UInt8], os2: [UInt8], loca: [UInt8], glyf: [UInt8]) -> (xHeight: Double, capHeight: Double, zeroAdvance: Double) {
  let x = dragonGlyph(cmap: cmap, 0x78)
  let long = dragonI16(head, 50) != 0
  let at = long ? dragonU32(loca, 4 * x) : Int(dragonU16(loca, 2 * x)) * 2
  let next = long ? dragonU32(loca, 4 * x + 4) : Int(dragonU16(loca, 2 * x + 2)) * 2
  let xHeight = x == 0 || next == at ? 0 : dragonI16(glyf, at + 8)
  let capHeight = dragonU16(os2, 0) >= 2 ? dragonI16(os2, 88) : 0
  let zero = dragonGlyph(cmap: cmap, 0x30)
  return (xHeight, capHeight, zero == 0 ? 0 : dragonAdvance(hhea: hhea, hmtx: hmtx, zero))
}

/// The raw data as the translated measurer's FontData.
public func dragonFontData(unitsPerEm: Double, ascent: Double, descent: Double, lineGap: Double, advances: [Double], xHeight: Double, capHeight: Double, zeroAdvance: Double) -> FontData {
  return FontData(unitsPerEm, ascent, descent, lineGap, JsArray(advances), xHeight, capHeight, zeroAdvance)
}

/// The bridge self-check: the raw data read from the bundled font equal the Ahem constants of the translated engine.
public func dragonSelfCheck(_ d: FontData) -> [String] {
  let want = text_AHEM_FONT_DATA
  var out: [String] = []
  if d.unitsPerEm != want.unitsPerEm { out.append("unitsPerEm \(d.unitsPerEm), Ahem \(want.unitsPerEm)") }
  if d.ascent != want.ascent { out.append("ascent \(d.ascent), Ahem \(want.ascent)") }
  if d.descent != want.descent { out.append("descent \(d.descent), Ahem \(want.descent)") }
  if d.lineGap != want.lineGap { out.append("lineGap \(d.lineGap), Ahem \(want.lineGap)") }
  if d.xHeight != want.xHeight { out.append("xHeight \(d.xHeight), Ahem \(want.xHeight)") }
  if d.capHeight != want.capHeight { out.append("capHeight \(d.capHeight), Ahem \(want.capHeight)") }
  if d.zeroAdvance != want.zeroAdvance { out.append("zeroAdvance \(d.zeroAdvance), Ahem \(want.zeroAdvance)") }
  let cps = try! text_coveredCodePoints().items
  if d.advances.items.count != want.advances.items.count { out.append("\(d.advances.items.count) advances, Ahem \(want.advances.items.count)") }
  for (k, cp) in cps.enumerated() where k < d.advances.items.count && k < want.advances.items.count {
    if d.advances.items[k] != want.advances.items[k] { out.append("U+\(String(Int(cp), radix: 16, uppercase: true)) advance \(d.advances.items[k]), Ahem \(want.advances.items[k])") }
  }
  return out
}
`;

const swiftViews = (): string => String.raw`import UIKit

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

/// The box geometry every paint stage and after-layout hook receives: the snapped border-box edges (left, top, right, bottom) and
/// the border widths (top, right, bottom, left) in device px, the eight corner radii in device px (horizontal then vertical,
/// top-left first), zero until the radius module fills them (PNT1), and the layout border-box size (width, height) in device px
/// before snapping, which percentage radii resolve against. lu is the unsnapped absolute border box (x, y, width, height) and padding
/// the padding widths (top, right, bottom, left), both in LU at the device scale, which Blink's background geometry reads (BG2).
/// rootX is where the root scroller's scrolling contents start on the x axis, in page LU (0, or negative at Chrome's scroll
/// origin in a right-to-left document overflowing to the left), which starts the cc tiles of the root layer (BG2 R4).
public struct DragonBoxShape {
  public var edges: [Double]
  public var borders: [Double]
  public var radii: [Double]
  public var size: [Double]
  public var lu: [Double]
  public var padding: [Double]
  public var rootX: Double
  public init(edges: [Double], borders: [Double], radii: [Double] = [0, 0, 0, 0, 0, 0, 0, 0], size: [Double] = [0, 0], lu: [Double] = [0, 0, 0, 0], padding: [Double] = [0, 0, 0, 0], rootX: Double = 0) {
    self.edges = edges; self.borders = borders; self.radii = radii; self.size = size; self.lu = lu; self.padding = padding; self.rootX = rootX
  }
}

/// A box: backgroundColor is a native property; every other paint is a paint module's (Support/Paint), drawn in CSS stage order.
public final class DragonBoxView: UIView, DragonNodeView {
  public let dragonId: String
  public let dragonKind: String
  public let dragonParent: String?
  /// The shape of the last layout, passed to every paint stage.
  public var dragonShape = DragonBoxShape(edges: [0, 0, 0, 0], borders: [0, 0, 0, 0])
  /// REPL-a: a replaced box's content box, destination rect and drawn part in device px relative to the box ([x, y, width,
  /// height]), from the translated engine after layout (paint.ts replacedPaint); nil for a box that is not replaced.
  public var dragonReplacedContent: [Double]? = nil
  public var dragonReplacedDest: [Double]? = nil
  public var dragonReplacedDrawn: [Double]? = nil
${boxMembers('uikit')}  public init(dragonId: String, kind: String, parent: String?) {
    self.dragonId = dragonId
    self.dragonKind = kind
    self.dragonParent = parent
    super.init(frame: .zero)
    isOpaque = false
    clipsToBounds = false
    contentMode = .redraw
  }
  required init?(coder: NSCoder) { fatalError("DragonBoxView is built in code") }
  public var dragonContainer: UIView { return dragonClipView ?? self }
  public override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    dragonPaintBox(self, ctx, dragonShape)
  }
  /// The device scale the frames were applied at; clip values are read back in whole device px / scale.
  public var dragonScale: Double = 1
  public func dragonApplied() -> DumpJsonObject {
    return dragonPaintApplied(self)
  }
}

/// One engine line of a text node, as Dragon places it: the line text and its glyph ids, each glyph's origin in device px from the
/// view's left (the engine's advances), the run's left and width in LU (1/64 device px) from the view's left, the line box top and
/// the baseline in device px from the view's top, and the line's UTF-16 offsets in the node's text.
public struct DragonLineSpec {
  public let text: String
  public let glyphs: [CGGlyph]
  public let xs: [Double]
  public let xLU: Double
  public let widthLU: Double
  public let top: Double
  public let baseline: Double
  public let start: Int
  public let end: Int
}

/// Device px added to every glyph x; 0 except in the glyph-offset-1 raster plant build (P5), which proves the pixel lane sees ink.
public let dragonGlyphPlantDevicePx: Double = 0
/// Device px added to every glyph baseline (down); 0 except in the glyph-offset-y-1 raster plant build (T093).
public let dragonGlyphPlantYDevicePx: Double = 0
/// 1 in the single-run-baseline plant build (INL1a): every line of a text view takes its first line's baseline offset.
public let dragonSingleRunBaselinePlant: Double = 0

/// The layer a text view's glyphs are drawn in. A UIView's own backing store holds only its bounds, so ink outside the node
/// frame (a rounded ascent, overflowing text) would be lost; this layer's frame is the bounds grown to the lines' ink.
public final class DragonGlyphLayer: CALayer {
  weak var owner: DragonTextView?
  public override init() {
    super.init()
    needsDisplayOnBoundsChange = true
    actions = ["bounds": NSNull(), "position": NSNull(), "frame": NSNull(), "contents": NSNull()]
  }
  public override init(layer: Any) { super.init(layer: layer) }
  required init?(coder: NSCoder) { fatalError("DragonGlyphLayer is built in code") }
  public override func draw(in ctx: CGContext) {
    ctx.translateBy(x: -frame.minX, y: -frame.minY)
    owner?.dragonDrawGlyphs(in: ctx)
  }
}

/// A text node: Dragon owns the line breaks and places every glyph at the engine's advances (PM ruling, option ii); Core Text
/// only rasterises (CTFontDrawGlyphs). The text is exposed to accessibility through accessibilityLabel.
public final class DragonTextView: UIView, DragonNodeView {
  public let dragonId: String
  public let dragonKind: String
  public let dragonParent: String?
  public private(set) var dragonText = ""
  public private(set) var dragonFamily = ""
  public private(set) var dragonColor = DragonRGBA8(0, 0, 0, 255)
  public private(set) var dragonTextColor: UIColor? = nil
  public private(set) var dragonFont: UIFont? = nil
  public private(set) var specs: [DragonLineSpec] = []
  private var scale: Double = 1
  private let glyphLayer = DragonGlyphLayer()
  public init(dragonId: String, kind: String, parent: String?) {
    self.dragonId = dragonId
    self.dragonKind = kind
    self.dragonParent = parent
    super.init(frame: .zero)
    isOpaque = false
    backgroundColor = nil
    clipsToBounds = false
    isAccessibilityElement = true
    accessibilityTraits = .staticText
    glyphLayer.owner = self
    glyphLayer.isOpaque = false
    layer.addSublayer(glyphLayer)
  }
  required init?(coder: NSCoder) { fatalError("DragonTextView is built in code") }

  /// The text run from the program: text, font family and colour; the size comes from the engine at the device scale.
  public func dragonSetText(_ text: String, family: String, color: DragonRGBA8) {
    dragonText = text
    dragonFamily = family
    dragonColor = color
    dragonTextColor = dragonUIColor(color)
    accessibilityLabel = text
  }

  /// The engine's data at the device scale: the instance font and the placed lines.
  public func dragonConfigure(font: UIFont, lines: [DragonLineSpec], scale: Double) {
    dragonFont = font
    specs = lines
    self.scale = scale
    glyphLayer.contentsScale = CGFloat(scale)
    setNeedsLayout()
    glyphLayer.setNeedsDisplay()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    glyphLayer.frame = dragonInkFrame()
    glyphLayer.setNeedsDisplay()
  }

  /// The bounds grown to every line's ink (the font's bounding box at each glyph origin) plus 2 device px of antialiasing, with
  /// edges on whole device px so the glyph origins keep their fractional positions.
  func dragonInkFrame() -> CGRect {
    var r = bounds
    if let font = dragonFont {
      let box = CTFontGetBoundingBox(font as CTFont)
      for l in specs where !l.glyphs.isEmpty {
        guard let lo = l.xs.min(), let hi = l.xs.max() else { continue }
        let y = CGFloat((l.baseline + dragonGlyphPlantYDevicePx) / scale)
        let x0 = CGFloat((lo + dragonGlyphPlantDevicePx) / scale) + box.minX
        let x1 = CGFloat((hi + dragonGlyphPlantDevicePx) / scale) + box.maxX
        r = r.union(CGRect(x: x0, y: y - box.maxY, width: x1 - x0, height: box.height))
      }
    }
    let s = CGFloat(scale)
    let pad: CGFloat = 2
    let left = (floor(r.minX * s) - pad) / s
    let top = (floor(r.minY * s) - pad) / s
    return CGRect(x: left, y: top, width: (ceil(r.maxX * s) + pad) / s - left, height: (ceil(r.maxY * s) + pad) / s - top)
  }

  /// Draws the lines in view coordinates (the glyph layer translates its context to them).
  func dragonDrawGlyphs(in ctx: CGContext) {
    guard let font = dragonFont, let color = dragonTextColor else { return }
    let ct = font as CTFont
    // Glyphs at the engine's fractional x: Core Graphics otherwise floors each glyph origin to a whole device px (T093 addendum F3).
    ctx.setAllowsFontSubpixelPositioning(true)
    ctx.setShouldSubpixelPositionFonts(true)
    ctx.setShouldSubpixelQuantizeFonts(false)
    ctx.setFillColor(color.cgColor)
    for l in specs where !l.glyphs.isEmpty {
      ctx.saveGState()
      ctx.textMatrix = .identity
      ctx.translateBy(x: 0, y: CGFloat((l.baseline + dragonGlyphPlantYDevicePx) / scale))
      ctx.scaleBy(x: 1, y: -1)
      let positions = l.xs.map { CGPoint(x: CGFloat(($0 + dragonGlyphPlantDevicePx) / scale), y: 0) }
      CTFontDrawGlyphs(ct, l.glyphs, positions, l.glyphs.count, ctx)
      ctx.restoreGState()
    }
  }

  public func dragonApplied() -> DumpJsonObject {
    return [
      ("font", dragonFont.map { DumpJson.object([("name", .string($0.fontName)), ("pointSize", .number(Double($0.pointSize)))]) } ?? .null),
      ("foregroundColor", dragonColorJson(dragonTextColor)),
    ]
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
  private let cmapTable: [UInt8]
  private let hheaTable: [UInt8]
  private let hmtxTable: [UInt8]
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
    cmapTable = cmap
    hheaTable = hhea
    hmtxTable = hmtx
    var advances: [Double] = []
    for cp in try! text_coveredCodePoints().items {
      let gid = dragonGlyph(cmap: cmap, Int(cp))
      advances.append(gid == 0 ? -1 : dragonAdvance(hhea: hhea, hmtx: hmtx, gid))
    }
    guard let os2Data = CTFontCopyTable(probe, CTFontTableTag(kCTFontTableOS2), []) as Data?, let locaData = CTFontCopyTable(probe, CTFontTableTag(kCTFontTableLoca), []) as Data?, let glyfData = CTFontCopyTable(probe, CTFontTableTag(kCTFontTableGlyf), []) as Data? else { fatalError("dragon bridge: OS/2, loca or glyf is missing") }
    let units = dragonMetricUnits(head: [UInt8](headData), hhea: hhea, hmtx: hmtx, cmap: cmap, os2: [UInt8](os2Data), loca: [UInt8](locaData), glyf: [UInt8](glyfData))
    data = dragonFontData(unitsPerEm: header.unitsPerEm, ascent: header.ascent, descent: header.descent, lineGap: header.lineGap, advances: advances, xHeight: units.xHeight, capHeight: units.capHeight, zeroAdvance: units.zeroAdvance)
    selfCheck = dragonSelfCheck(data)
    measurer = try! text_fontDataMeasurer(data, AhemRuleFaults(false, false))
  }
  /// The glyph id of a code point (cmap); 0 when the font does not map it.
  public func glyph(_ cp: Int) -> Int { return dragonGlyph(cmap: cmapTable, cp) }
  /// A glyph's advance in font units (hmtx).
  public func advanceUnits(_ gid: Int) -> Double { return dragonAdvance(hhea: hheaTable, hmtx: hmtxTable, gid) }
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
  /// Per text view: each line's half-leading (its content top below the line top, INL1a: it differs by line), and the view's
  /// one ascent and descent.
  private var textMetrics: [String: (halfLeadings: [Double], ascent: Double, descent: Double)] = [:]
  /// Each inline box's fragments (INL1a): edges relative to the box's own snapped edges, and the line's baseline from the fragment top.
  private var inlineLines: [String: [(edges: [Double], baseline: Double)]] = [:]
  private var hosts: [String: String] = [:]
  private var companions: [String: [UIView]] = [:]
  public init() {}

  /// Hosting (PNT1): node id's view is added to host's container instead of its DOM parent's; frames stay absolute from the
  /// engine and the dump stays in DOM terms.
  public func host(_ id: String, _ host: String) { hosts[id] = host }
  /// A companion view placed directly beneath node id in the same host, with the node's frame (outer shadows, PNT1).
  public func companion(_ id: String, _ view: UIView) { companions[id, default: []].append(view) }
  /// A built node's view, for the runtime writers (RT-1, RT-2, RT-11).
  public func node(_ id: String) -> DragonNodeView? { return views[id] }

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
  public func apply(_ input: LayoutInput, measurer: TextMeasurer, scale: Double, bridge: DragonBridge) throws {
    let result = try layout_layout(input, measurer)
    if let refused = result as? LayoutResult_unsupported { fatalError("dragon: the engine refused the case: \(refused.unsupported.code) at \(refused.unsupported.nodeId): \(refused.unsupported.detail)") }
    guard let ok = result as? LayoutResult_ok else { fatalError("dragon: the engine gave no result") }
    let boxes = ok.boxes.items
    let snapped = try snap_snapEdges(ok.boxes).items
    let abs = try layout_absoluteRects(ok.boxes)
    let zoomed = try layout_zoomInput(input, block_NO_ENGINE_FAULTS)
    var zBoxes: [String: LayoutBox] = [:]
    var zStyles: [String: LayoutStyle] = [:]
    var zLeaves: [(String, ReplacedLeaf)] = []
    var zParent: [String: String] = [:]
    // A text leaf's, inline box's or <br>'s container is the block container of its inline formatting context, through any
    // inline boxes.
    var inlineIds = Set<String>()
    func walkInline(_ c: any U_InlineBox_LineBreak_TextLeaf, _ container: String) {
      if let t = c as? TextLeaf { zParent[t.id.description] = container }
      else if let ib = c as? InlineBox {
        inlineIds.insert(ib.id.description)
        zParent[ib.id.description] = container
        for k in ib.children.items { walkInline(k, container) }
      } else if let br = c as? LineBreak { inlineIds.insert(br.id.description) }
    }
    func walk(_ b: LayoutBox) {
      zBoxes[b.id.description] = b
      zStyles[b.id.description] = b.style
      for c in b.children.items {
        if let cb = c as? LayoutBox { zParent[cb.id.description] = b.id.description; walk(cb) }
        else if let t = c as? TextLeaf { zParent[t.id.description] = b.id.description }
        else if let rl = c as? ReplacedLeaf { zParent[rl.id.description] = b.id.description; zStyles[rl.id.description] = rl.style; zLeaves.append((rl.id.description, rl)) }
        else if let ib = c as? InlineBox { walkInline(ib, b.id.description) }
        else if let br = c as? LineBreak { walkInline(br, b.id.description) }
      }
    }
    walk(zoomed.root)
    // OVFL-B: each scroll container's offset range in device px, from the translated engine, for the scroll module's hook.
    var scrollRanges: [String: [Double]] = [:]
    let sr = try overflow_scrollRanges(input, measurer)
    if let no = sr as? ScrollRangesResult_refused { fatalError("dragon: the engine refused the scroll ranges at \(no.nodeId): \(no.detail)") }
    guard let srOk = sr as? ScrollRangesResult_ok else { fatalError("dragon: the engine gave no scroll ranges") }
    for g in srOk.ranges.items { scrollRanges[g.id.description] = [g.minX, g.maxX, g.minY, g.maxY] }
    var scrollRefusals: [String: String] = [:]
    for g in srOk.refused.items { scrollRefusals[g.id.description] = "the engine refused its scroll range at " + g.nodeId.description + ": " + g.detail.description }
    let lu = units_LU_PER_PX
    let s = scale
    let cg = CGFloat(scale)
    // BG2 R4: the root scroller's scrolling contents start at Chrome's scroll origin. In a right-to-left document that is the left
    // edge of the content overflowing to the left: the leftmost box or line no clipping box holds (html and body never clip here,
    // as their overflow propagates to the viewport); 0 otherwise (paint-samples/gradient.ts rootScrollX on the host).
    var rootX = 0.0
    if zoomed.root.style.direction.description == "rtl" {
      var parentOf: [String: String] = [:]
      for r in boxes { if let p = r.parent { parentOf[r.id.description] = p.description } }
      func depth(_ id: String) -> Int { var d = 0; var p = parentOf[id]; while let q = p { d += 1; p = parentOf[q] }; return d }
      for r in boxes {
        var held = false
        var p = parentOf[r.id.description]
        while let q = p, !held {
          if depth(q) >= 2, let bv = views[q] as? DragonBoxView, bv.dragonClipView != nil { held = true }
          p = parentOf[q]
        }
        if !held, let a = abs.get(r.id), a.x < rootX { rootX = a.x }
      }
      // Chrome's scroll origin is a whole point (ToFlooredPoint of the overflow's offset negated): the layer starts at the ceiling.
      rootX = (rootX / lu).rounded(.up) * lu + 0
    }
    root.frame = CGRect(x: 0, y: 0, width: CGFloat(input.viewport.width), height: CGFloat(input.viewport.height))
    var edges: [String: [Double]] = [:]
    var borders: [String: [Double]] = [:]
    var rects: [String: LayoutRect] = [:]
    // Content widths in LU, for the text breaking width: the border box minus borders and paddings (percentages of the parent's).
    var contentCache: [String: Double] = [:]
    // BG2: an absolutely positioned box's containing block width (CSS2 §10.1), the padding box of its nearest positioned ancestor
    // or the initial containing block (layout.ts containingBlock); nil for an in-flow box.
    func absoluteBasis(_ id: String) throws -> Double? {
      guard let z = zStyles[id] else { fatalError("dragon: no zoomed box \(id)") }
      if z.position.description != "absolute" { return nil }
      var at = zParent[id]
      while let a = at, let st = zStyles[a], st.position.description == "static" { at = zParent[a] }
      guard let a = at else { return units_fromCssPx(zoomed.viewport.width) }
      guard let st = zStyles[a], let r = rects[a] else { fatalError("dragon: the containing block \(a) of \(id) is not placed") }
      let bor = try box_resolveBorder(st, zoomed.devicePixelRatio)
      return r.width - bor.left - bor.right
    }
    // What a box's percentage paddings resolve against, as the engine does: its absoluteBasis, or its parent's content width.
    func contentWidth(_ id: String) throws -> Double {
      if let c = contentCache[id] { return c }
      guard let z = zBoxes[id], let r = rects[id] else { fatalError("dragon: no box \(id)") }
      let pad = try box_resolvePadding(z.style, try paddingBasis(id))
      let bor = try box_resolveBorder(z.style, zoomed.devicePixelRatio)
      let w = r.width - bor.left - bor.right - pad.left - pad.right
      contentCache[id] = w
      return w
    }
    func paddingBasis(_ id: String) throws -> Double {
      if let b = try absoluteBasis(id) { return b }
      return try zParent[id].map { try contentWidth($0) } ?? units_fromCssPx(zoomed.viewport.width)
    }
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
        let h = hosts[id] ?? p
        guard let pv = views[h] as? DragonBoxView, let pe = edges[h], let pb = borders[h] else { fatalError("dragon: \(id) has no placed parent box \(h)") }
        container = pv.dragonContainer
        origin = pv.dragonClipView == nil ? [pe[0], pe[1]] : [pe[0] + pb[3], pe[1] + pb[0]]
      }
      let frame = CGRect(x: CGFloat(e.left - origin[0]) / cg, y: CGFloat(e.top - origin[1]) / cg, width: CGFloat(e.right - e.left) / cg, height: CGFloat(e.bottom - e.top) / cg)
      for c in companions[id] ?? [] {
        container.addSubview(c)
        c.frame = frame
      }
      container.addSubview(v)
      v.frame = frame
      if let bv = v as? DragonBoxView {
        // An inline box or <br> view is unpainted and has no borders (the compiler refuses inline box borders until INL1b) and no
        // paddings a background reads (the compiler refuses gradients on inline boxes).
        let px: [Double]
        let padding: [Double]
        if inlineIds.contains(id) { px = [0, 0, 0, 0]; padding = [0, 0, 0, 0] } else {
          guard let zs = zStyles[id] else { fatalError("dragon: no zoomed box \(id)") }
          let be = try box_resolveBorder(zs, zoomed.devicePixelRatio)
          px = [be.top / lu, be.right / lu, be.bottom / lu, be.left / lu]
          // BG2: the paddings (percentages of the containing block's content width), in LU.
          let pad = try box_resolvePadding(zs, try paddingBasis(id))
          padding = [pad.top, pad.right, pad.bottom, pad.left]
        }
        borders[id] = px
        bv.dragonScale = s
        // BG2: the unsnapped border box in LU.
        guard let a = abs.get(r.id) else { fatalError("dragon: no absolute rect for \(id)") }
        bv.dragonShape = DragonBoxShape(edges: [e.left, e.top, e.right, e.bottom], borders: px, size: [r.width / lu, r.height / lu], lu: [a.x, a.y, a.width, a.height], padding: padding, rootX: rootX)
        bv.dragonScrollRange = scrollRanges[id]
        bv.dragonScrollRefusal = scrollRefusals[id]
        dragonAfterLayout(bv, bv.dragonShape, s)
        bv.setNeedsDisplay()
      }
    }
    // REPL-a: each replaced box's paint rects from its content box (border box less borders and padding against the parent's
    // content width), through the translated engine; the paint modules read them in their after-layout hooks and stages.
    for (id, leaf) in zLeaves {
      guard let bv = views[id] as? DragonBoxView, let e = edges[id], let a = abs.get(leaf.id), let pId = zParent[id] else { fatalError("dragon: replaced \(id) is not placed") }
      let pad = try box_resolvePadding(leaf.style, try contentWidth(pId))
      let bor = try box_resolveBorder(leaf.style, zoomed.devicePixelRatio)
      let content = ObjectRect(a.x + bor.left + pad.left, a.y + bor.top + pad.top, max(0, a.width - bor.left - bor.right - pad.left - pad.right), max(0, a.height - bor.top - bor.bottom - pad.top - pad.bottom))
      let p = try paint_replacedPaint(leaf, content)
      func rel(_ r: PixelRect) -> [Double] { return [r.x - e[0], r.y - e[1], r.width, r.height] }
      bv.dragonReplacedContent = rel(p.content)
      bv.dragonReplacedDest = rel(p.dest)
      bv.dragonReplacedDrawn = p.drawn.map(rel)
      dragonAfterLayout(bv, bv.dragonShape, s)
      bv.setNeedsDisplay()
    }
    for id in order {
      guard let tv = views[id] as? DragonTextView else { continue }
      guard let pId = zParent[id], let p = zBoxes[pId], let e = edges[id] else { fatalError("dragon: text \(id) has no container") }
      // The engine's own lines: inline.ts placeLines (buildIfc, then placeIfcLines), translated, over the zoomed context. Each
      // line gives this leaf's piece; a piece's leaf index is into the same formatting context's leaves.
      let ctx = Ctx(measurer, zoomed.devicePixelRatio, block_NO_ENGINE_FAULTS, grid_NO_GRID_FAULTS)
      let ifc = try inline_buildIfc(ctx, p)
      let leaves = ifc.leaves.items
      guard let li = leaves.firstIndex(where: { $0.id.description == id }) else { fatalError("dragon: no leaf \(id)") }
      let scalars = Array(leaves[li].text.description.unicodeScalars)
      func utf16(_ cp: Int) -> Int { return scalars[0..<cp].reduce(0) { $0 + $1.utf16.count } }
      let placed = try inline_placeIfcLines(ctx, p, ifc, try contentWidth(pId)).items
      let pieces = boxes.enumerated().filter { DragonTree.isLine($0.element) && $0.element.parent?.description == id }
      // The instance size of the leaf's computed font size in the resolved input (environment.ts), at the device scale.
      let size = try units_platformFontSize(leaves[li].font.size)
      var specs: [DragonLineSpec] = []
      var viewMetrics: (halfLeadings: [Double], ascent: Double, descent: Double)? = nil
      var firstBaselineOffset: Double? = nil
      for line in placed {
        guard let piece = line.pieces.items.first(where: { Int($0.leaf) == li }) else { continue }
        // One font per text view: every line's ascent and descent are the view's; its content top below the line top is the line's.
        let halfLeading = (piece.top - line.top) / lu
        if let m = viewMetrics, m.ascent != piece.ascent / lu || m.descent != piece.descent / lu { fatalError("dragon: \(id): line ascent \(piece.ascent / lu) and descent \(piece.descent / lu) differ from the text view's \(m.ascent) and \(m.descent)") }
        viewMetrics = ((viewMetrics?.halfLeadings ?? []) + [halfLeading], piece.ascent / lu, piece.descent / lu)
        let k = specs.count
        if k >= pieces.count { fatalError("dragon: \(id): the engine's breaks give more lines than its layout (\(pieces.count))") }
        let (i, r) = pieces[k]
        if piece.width != r.width { fatalError("dragon: \(id) line \(k): the engine's break gives width \(piece.width) LU, its layout \(r.width) LU") }
        guard let a = abs.get(r.id) else { fatalError("dragon: no absolute rect for \(r.id)") }
        let top = try units_snapEdge(a.y - (piece.top - line.top))
        var baseline = snapped[i].top + piece.ascent / lu
        // The single-run-baseline plant: every line takes the first line's baseline below its line top.
        if let f = firstBaselineOffset, dragonSingleRunBaselinePlant != 0 { baseline = top + f } else if firstBaselineOffset == nil { firstBaselineOffset = baseline - top }
        // Dragon places every glyph: the pen starts at the engine's run left and advances by the engine's per-glyph advance
        // (the instance size times the font-unit advance / unitsPerEm, summed in float as textAdvanceAt does).
        let xLU = a.x - e[0] * lu
        let shown = Array(scalars[Int(piece.start)..<Int(piece.visibleEnd)])
        var glyphs: [CGGlyph] = []
        var xs: [Double] = []
        var pen: Float = 0
        for sc in shown {
          let gid = bridge.glyph(Int(sc.value))
          glyphs.append(CGGlyph(gid))
          xs.append(xLU / lu + Double(pen))
          pen = pen + Float(size * bridge.advanceUnits(gid) / bridge.data.unitsPerEm)
        }
        specs.append(DragonLineSpec(text: shown.map { String($0) }.joined(), glyphs: glyphs, xs: xs, xLU: xLU, widthLU: piece.width, top: top - e[1], baseline: baseline - e[1], start: utf16(Int(piece.start)), end: utf16(Int(piece.end))))
      }
      if specs.count != pieces.count { fatalError("dragon: \(id): the engine's breaks give \(specs.count) lines, its layout \(pieces.count)") }
      textMetrics[id] = viewMetrics
      tv.dragonConfigure(font: bridge.font(pointSize: CGFloat(size / s)), lines: specs, scale: s)
    }
    // Each inline box's fragments, one per line it is on (the engine's "<box>:line<j>"), with that line's baseline.
    inlineLines = [:]
    var fragments: [String: [Int]] = [:]
    for (i, r) in boxes.enumerated() where DragonTree.isLine(r) {
      if let p = r.parent?.description, inlineIds.contains(p) { fragments[p, default: []].append(i) }
    }
    for (bId, idx) in fragments {
      guard let pId = zParent[bId], let p = zBoxes[pId], let be = edges[bId] else { fatalError("dragon: inline box \(bId) has no container") }
      let ctx = Ctx(measurer, zoomed.devicePixelRatio, block_NO_ENGINE_FAULTS, grid_NO_GRID_FAULTS)
      let ifc = try inline_buildIfc(ctx, p)
      guard let b = ifc.boxes.items.firstIndex(where: { $0.id.description == bId }) else { fatalError("dragon: no inline box \(bId) in \(pId)") }
      var offsets: [Double] = []
      let placedLines = try inline_placeIfcLines(ctx, p, ifc, try contentWidth(pId)).items
      for line in placedLines {
        for (k, x) in line.boxes.items.enumerated() where Int(x) == b { offsets.append(line.baseline - line.boxRects.items[k].y) }
      }
      // A context with no line box gives each inline box one empty fragment at the content start (inline.ts collectFragments),
      // on no line, so its baseline is its own top.
      if placedLines.isEmpty { offsets = [0] }
      if offsets.count != idx.count { fatalError("dragon: \(bId): the engine's lines give \(offsets.count) fragments, its layout \(idx.count)") }
      inlineLines[bId] = zip(idx, offsets).map { (i, o) in (edges: [snapped[i].left - be[0], snapped[i].top - be[1], snapped[i].right - be[0], snapped[i].bottom - be[1]], baseline: o / lu) }
    }
  }

  /// The dump read back from the live tree: frames via dragonLayoutRect (transforms ignored), applied values from the live objects.
  public func dump(_ c: DragonCase, scale: Double, device: DumpDevice, pixels: DumpPixels, timing: DumpTiming) -> Dump {
    let s = scale
    var nodes: [DumpNodes] = []
    for id in order {
      guard let v = views[id] else { continue }
      let r = dragonLayoutRect(v, in: root)
      let l = dragonWholeDevicePx(Double(r.minX) * s, "\(id) left")
      let t = dragonWholeDevicePx(Double(r.minY) * s, "\(id) top")
      let rr = dragonWholeDevicePx(Double(r.maxX) * s, "\(id) right")
      let b = dragonWholeDevicePx(Double(r.maxY) * s, "\(id) bottom")
      var lines: [DumpNodesLines] = []
      if let tv = v as? DragonTextView, !tv.specs.isEmpty {
        guard let m = textMetrics[id] else { fatalError("dragon: \(id): a text view with lines has no line metrics") }
        // Each line as Dragon placed it in the live view: the run from the view's live position, snapped with the one snap rule.
        if m.halfLeadings.count != tv.specs.count { fatalError("dragon: \(id): \(m.halfLeadings.count) line metrics for \(tv.specs.count) lines") }
        for (k, x) in tv.specs.enumerated() {
          let top = t + x.top + m.halfLeadings[k]
          let bottom = top + m.ascent + m.descent
          let left = try! units_snapEdge(l * units_LU_PER_PX + x.xLU)
          let right = try! units_snapEdge(l * units_LU_PER_PX + x.xLU + x.widthLU)
          let baseline = t + x.baseline
          lines.append(DumpNodesLines(frame: DumpNodesLinesFrame(x: left / s, y: top / s, width: (right - left) / s, height: (bottom - top) / s), deviceEdges: DumpNodesLinesDeviceEdges(left: left, top: top, right: right, bottom: bottom), baseline: (baseline - top) / s, start: Double(x.start), end: Double(x.end)))
        }
      } else if let frags = inlineLines[id] {
        // An inline box's lines are its fragments, placed from the box view's live position; it has no text, so offsets 0 to 0.
        for f in frags {
          let e = [l + f.edges[0], t + f.edges[1], l + f.edges[2], t + f.edges[3]]
          lines.append(DumpNodesLines(frame: DumpNodesLinesFrame(x: e[0] / s, y: e[1] / s, width: (e[2] - e[0]) / s, height: (e[3] - e[1]) / s), deviceEdges: DumpNodesLinesDeviceEdges(left: e[0], top: e[1], right: e[2], bottom: e[3]), baseline: f.baseline / s, start: 0, end: 0))
        }
      }
      nodes.append(DumpNodes(id: id, parent: parents[id] ?? nil, kind: v.dragonKind, native: String(describing: type(of: v)), frame: DumpNodesFrame(x: l / s, y: t / s, width: (rr - l) / s, height: (b - t) / s), deviceEdges: DumpNodesDeviceEdges(left: l, top: t, right: rr, bottom: b), applied: v.dragonApplied(), lines: lines))
    }
    return Dump(lane: "ios-sim", case: DumpCase(id: c.id, fixture: c.fixture, dpr: s, viewport: DumpCaseViewport(width: c.viewport.width, height: c.viewport.height), direction: c.direction, compilerDigest: c.compilerDigest, expectedDigest: c.expectedDigest(scale: s)), device: device, nodes: nodes, pixels: pixels, timing: timing)
  }
}

/// A view's layout rect in root's coordinates with every layer transform ignored (PNT2): the dump's frames are the engine's
/// untransformed boxes, and a transform is paint, proven by the pixel lane and Chrome's content quads. Without transforms it equals
/// convert(bounds, to: root).
public func dragonLayoutRect(_ v: UIView, in root: UIView) -> CGRect {
  var x = v.center.x - v.bounds.width * v.layer.anchorPoint.x
  var y = v.center.y - v.bounds.height * v.layer.anchorPoint.y
  var s = v.superview
  while let sv = s, sv !== root {
    x += sv.center.x - sv.bounds.width * sv.layer.anchorPoint.x - sv.bounds.origin.x
    y += sv.center.y - sv.bounds.height * sv.layer.anchorPoint.y - sv.bounds.origin.y
    s = sv.superview
  }
  if s !== root { fatalError("dragon: a dumped view is not inside the root") }
  return CGRect(x: x - root.bounds.origin.x, y: y - root.bounds.origin.y, width: v.bounds.width, height: v.bounds.height)
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
    if p.x < 0 || p.y < 0 || p.x >= w || p.y >= h { fatalError("dragon: sample point \(p.x),\(p.y) (\(p.rule)) is outside the \(w)x\(h) capture") }
    let i = (p.y * w + p.x) * 4
    return DumpPixelsSamples(x: Double(p.x), y: Double(p.y), rgba: [Double(buf[i]), Double(buf[i + 1]), Double(buf[i + 2]), Double(buf[i + 3])], rule: p.rule)
  }
  return DumpPixels(capture: "drawHierarchy", width: Double(w), height: Double(h), sha256: sha, samples: samples)
}

/// The host's run file (the P5 points protocol), tab separated: "case <id>" lines name the cases in order, "point <id> <x> <y>
/// <rule>" lines are a case's generated sample points in device px, and "hold 1" makes the app wait after each case until the host
/// has taken its OS screenshot (the host then writes release-<id> into DRAGON_OUT).
public struct DragonRun {
  public var ids: [String] = []
  public var points: [String: [(x: Int, y: Int, rule: String)]] = [:]
  public var hold = false
  public init() {}
}

public func dragonReadRun(_ path: String) -> DragonRun? {
  guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
  var r = DragonRun()
  for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
    let f = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
    if f[0] == "case" && f.count == 2 { r.ids.append(f[1]); continue }
    if f[0] == "hold" && f.count == 2 { r.hold = f[1] == "1"; continue }
    guard f[0] == "point", f.count == 5, let x = Int(f[2]), let y = Int(f[3]) else { fatalError("dragon: bad run file line: \(line)") }
    r.points[f[1], default: []].append((x: x, y: y, rule: f[4]))
  }
  return r
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

/** The whole device px covering a rect given as x, y, width, height in device px: left, top, right, bottom. */
fun dragonCoveringPx(r: DoubleArray): IntArray = intArrayOf(kotlin.math.floor(r[0]).toInt(), kotlin.math.floor(r[1]).toInt(), kotlin.math.ceil(r[0] + r[2]).toInt(), kotlin.math.ceil(r[1] + r[3]).toInt())
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

/**
 * The metrics font-relative units read, in font units (T005's rule): glyph x's glyf yMax (loca format from head 50), OS/2
 * sCapHeight (OS/2 88, version 2 or later) and the hmtx advance of glyph 0; 0 where the font has none.
 */
fun dragonMetricUnits(head: ByteArray, hhea: ByteArray, hmtx: ByteArray, cmap: ByteArray, os2: ByteArray, loca: ByteArray, glyf: ByteArray): DoubleArray {
  val x = dragonGlyph(cmap, 0x78)
  val long = dragonI16(head, 50) != 0.0
  val at = if (long) u32(loca, 4 * x) else u16(loca, 2 * x) * 2
  val next = if (long) u32(loca, 4 * x + 4) else u16(loca, 2 * x + 2) * 2
  val xHeight = if (x == 0 || next == at) 0.0 else dragonI16(glyf, at + 8)
  val capHeight = if (dragonU16(os2, 0) >= 2.0) dragonI16(os2, 88) else 0.0
  val zero = dragonGlyph(cmap, 0x30)
  return doubleArrayOf(xHeight, capHeight, if (zero == 0) 0.0 else dragonAdvance(hhea, hmtx, zero))
}

/** The raw data as the translated measurer's FontData. */
fun dragonFontData(unitsPerEm: Double, ascent: Double, descent: Double, lineGap: Double, advances: List<Double>, xHeight: Double, capHeight: Double, zeroAdvance: Double): FontData = FontData(unitsPerEm, ascent, descent, lineGap, ArrayList(advances), xHeight, capHeight, zeroAdvance)

/** The bridge self-check: the raw data read from the bundled font equal the Ahem constants of the translated engine. */
fun dragonSelfCheck(d: FontData): List<String> {
  val want = text_AHEM_FONT_DATA
  val out = ArrayList<String>()
  if (d.unitsPerEm != want.unitsPerEm) out.add("unitsPerEm " + d.unitsPerEm + ", Ahem " + want.unitsPerEm)
  if (d.ascent != want.ascent) out.add("ascent " + d.ascent + ", Ahem " + want.ascent)
  if (d.descent != want.descent) out.add("descent " + d.descent + ", Ahem " + want.descent)
  if (d.lineGap != want.lineGap) out.add("lineGap " + d.lineGap + ", Ahem " + want.lineGap)
  if (d.xHeight != want.xHeight) out.add("xHeight " + d.xHeight + ", Ahem " + want.xHeight)
  if (d.capHeight != want.capHeight) out.add("capHeight " + d.capHeight + ", Ahem " + want.capHeight)
  if (d.zeroAdvance != want.zeroAdvance) out.add("zeroAdvance " + d.zeroAdvance + ", Ahem " + want.zeroAdvance)
  val cps = text_coveredCodePoints()
  if (d.advances.size != want.advances.size) out.add("" + d.advances.size + " advances, Ahem " + want.advances.size)
  for (k in cps.indices) {
    if (k >= d.advances.size || k >= want.advances.size) break
    if (d.advances[k] != want.advances[k]) out.add("U+" + Integer.toHexString(cps[k].toInt()).uppercase() + " advance " + d.advances[k] + ", Ahem " + want.advances[k])
  }
  return out
}
`;

const kotlinViews = (): string => String.raw`package dev.dragon.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.text.TextPaint
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
open class DragonClipView(ctx: Context) : DragonGroup(ctx) {
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    clipBounds = Rect(0, 0, r - l, b - t)
    super.onLayout(changed, l, t, r, b)
  }
}

/**
 * The box geometry every paint stage and after-layout hook receives: the snapped border-box edges (left, top, right, bottom) and
 * the border widths (top, right, bottom, left) in device px, the eight corner radii in device px (horizontal then vertical,
 * top-left first), zero until the radius module fills them (PNT1), and the layout border-box size (width, height) in device px
 * before snapping, which percentage radii resolve against.
 */
class DragonBoxShape(val edges: DoubleArray, val borders: DoubleArray, val radii: DoubleArray = DoubleArray(8), val size: DoubleArray = DoubleArray(2), val lu: DoubleArray = DoubleArray(4), val padding: DoubleArray = DoubleArray(4), val rootX: Double = 0.0)

/** A box: the background is a native ColorDrawable; every other paint is a paint module's (views/paint), drawn in CSS stage order. */
class DragonBoxView(ctx: Context, override val dragonId: String, override val dragonKind: String, override val dragonParent: String?) : DragonGroup(ctx), DragonNodeView {
  /** The shape of the last layout, passed to every paint stage. */
  var dragonShape = DragonBoxShape(DoubleArray(4), DoubleArray(4))
  /**
   * REPL-a: a replaced box's content box, destination rect and drawn part in device px relative to the box (x, y, width, height),
   * from the translated engine after layout (paint.ts replacedPaint); null for a box that is not replaced.
   */
  var dragonReplacedContent: DoubleArray? = null
  var dragonReplacedDest: DoubleArray? = null
  var dragonReplacedDrawn: DoubleArray? = null
${boxMembers('android-views')}  val dragonContainer: ViewGroup get() = dragonClipView ?: this
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    dragonPaintBox(this, canvas, dragonShape)
  }
  override fun dragonApplied(): List<Pair<String, DumpJson>> = dragonPaintApplied(this)
}

/**
 * One engine line of a text node, as Dragon places it: the line text and its glyph ids, each glyph's origin in device px from the
 * view's left (the engine's advances), the run's left and width in LU (1/64 device px) from the view's left, the line box top and
 * baseline in device px from the view's top, and the UTF-16 offsets of the line in the node's text.
 */
class DragonLineSpec(val text: String, val glyphs: IntArray, val xs: DoubleArray, val xLU: Double, val widthLU: Double, val top: Int, val baseline: Int, val start: Int, val end: Int)

/** Device px added to every glyph x; 0 except in the glyph-offset-1 raster plant build (P5), which proves the pixel lane sees ink. */
const val DRAGON_GLYPH_PLANT_DEVICE_PX = 0.0
/** Device px added to every glyph baseline (down); 0 except in the glyph-offset-y-1 raster plant build (T093). */
const val DRAGON_GLYPH_PLANT_Y_DEVICE_PX = 0.0
/** 1 in the single-run-baseline plant build (INL1a): every line of a text view takes its first line's baseline offset. */
const val DRAGON_SINGLE_RUN_BASELINE_PLANT = 0.0

/**
 * A text node: Dragon owns the line breaks and places every glyph at the engine's advances (PM ruling, option ii); the platform only
 * rasterises, with Canvas.drawGlyphs (API 31, the Android floor). The text is exposed to accessibility through contentDescription.
 */
class DragonTextView(ctx: Context, override val dragonId: String, override val dragonKind: String, override val dragonParent: String?) : View(ctx), DragonNodeView {
  val dragonFrame = IntArray(4)
  val paint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG)
  var dragonText = ""
    private set
  var dragonFamily = ""
    private set
  var dragonColor = DragonRGBA8(0, 0, 0, 255)
    private set
  var specs: List<DragonLineSpec> = emptyList()
    private set
  private var font: android.graphics.fonts.Font? = null

  /** The text run from the program: text, font family and colour; the size comes from the engine at the device scale. */
  fun dragonSetText(text: String, family: String, color: DragonRGBA8) {
    dragonText = text
    dragonFamily = family
    dragonColor = color
    contentDescription = text
  }

  /** The engine's data at the device scale: the instance text size and the placed lines. */
  fun dragonConfigure(bridge: DragonBridge, textSize: Float, lines: List<DragonLineSpec>) {
    specs = lines
    font = bridge.font
    paint.typeface = bridge.typeface
    paint.textSize = textSize
    paint.color = dragonArgb(dragonColor)
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    val f = font ?: return
    for (l in specs) {
      if (l.glyphs.isEmpty()) continue
      val y = (l.baseline + DRAGON_GLYPH_PLANT_Y_DEVICE_PX).toFloat()
      val positions = FloatArray(2 * l.glyphs.size)
      for (k in l.glyphs.indices) {
        positions[2 * k] = (l.xs[k] + DRAGON_GLYPH_PLANT_DEVICE_PX).toFloat()
        positions[2 * k + 1] = y
      }
      canvas.drawGlyphs(l.glyphs, 0, positions, 0, l.glyphs.size, f, paint)
    }
  }

  override fun dragonApplied(): List<Pair<String, DumpJson>> {
    val face = paint.typeface
    return listOf(
      Pair("textPaint.typeface", if (face != null && face === DragonBridge.shared(context).typeface) DumpJson.Obj(listOf(Pair("typeface", DumpJson.Str("dragon:" + dragonFamily)), Pair("textSize", DumpJson.Num(paint.textSize.toDouble())))) else DumpJson.Null),
      Pair("textPaint.color", dragonColorJson(paint.color)),
    )
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
 * The measurer bridge (R4): raw data read from the bundled Ahem's tables in the android.graphics.fonts.Font buffer (head, hhea, cmap, hmtx), fed to the
 * translated font-data measurer with the darwin-arm64 platform rules. It never uses the platform's rounded line metrics.
 */
class DragonBridge private constructor(ctx: Context) {
  val fontSha256: String
  val data: FontData
  val selfCheck: List<String>
  val measurer: TextMeasurer
  /** The Ahem typeface under the Dragon id dragon:Ahem, and its Font (the drawGlyphs font). */
  val typeface: Typeface
  val font: Font
  private val cmapTable: ByteArray
  private val hheaTable: ByteArray
  private val hmtxTable: ByteArray
  init {
    val bytes = ctx.assets.open("fonts/Ahem.ttf").use { it.readBytes() }
    fontSha256 = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { String.format("%02x", it.toInt() and 0xff) }
    font = Font.Builder(ctx.assets, "fonts/Ahem.ttf").build()
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
    cmapTable = cmap
    hheaTable = hhea
    hmtxTable = hmtx
    val advances = ArrayList<Double>()
    for (cp in text_coveredCodePoints()) {
      val gid = dragonGlyph(cmap, cp.toInt())
      advances.add(if (gid == 0) -1.0 else dragonAdvance(hhea, hmtx, gid))
    }
    val units = dragonMetricUnits(dragonSfntTable(raw, "head"), hhea, hmtx, cmap, dragonSfntTable(raw, "OS/2"), dragonSfntTable(raw, "loca"), dragonSfntTable(raw, "glyf"))
    data = dragonFontData(header[0], header[1], header[2], header[3], advances, units[0], units[1], units[2])
    selfCheck = dragonSelfCheck(data)
    measurer = text_fontDataMeasurer(data, AhemRuleFaults(false, false))
  }
  /** The glyph id of a code point (cmap); 0 when the font does not map it. */
  fun glyph(cp: Int): Int = dragonGlyph(cmapTable, cp)
  /** A glyph's advance in font units (hmtx). */
  fun advanceUnits(gid: Int): Double = dragonAdvance(hheaTable, hmtxTable, gid)
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
import dev.dragon.dump.DumpPixelsSamples
import dev.dragon.dump.DumpTiming
import dev.dragon.layout.Ctx
import dev.dragon.layout.LayoutBox
import dev.dragon.layout.LayoutInput
import dev.dragon.layout.LayoutRect
import dev.dragon.layout.LayoutResult_ok
import dev.dragon.layout.LayoutStyle
import dev.dragon.layout.ObjectRect
import dev.dragon.layout.PixelRect
import dev.dragon.layout.ReplacedLeaf
import dev.dragon.layout.paint_replacedPaint
import dev.dragon.layout.TextLeaf
import dev.dragon.layout.TextMeasurer
import dev.dragon.layout.block_NO_ENGINE_FAULTS
import dev.dragon.layout.box_resolveBorder
import dev.dragon.layout.box_resolvePadding
import dev.dragon.layout.InlineBox
import dev.dragon.layout.LineBreak
import dev.dragon.layout.U_InlineBox_LineBreak_TextLeaf
import dev.dragon.layout.inline_buildIfc
import dev.dragon.layout.inline_placeIfcLines
import dev.dragon.layout.grid_NO_GRID_FAULTS
import dev.dragon.layout.layout_absoluteRects
import dev.dragon.layout.layout_layout
import dev.dragon.layout.layout_zoomInput
import dev.dragon.layout.overflow_scrollRanges
import dev.dragon.layout.ScrollRangesResult_ok
import dev.dragon.layout.ScrollRangesResult_refused
import dev.dragon.layout.snap_snapEdges
import dev.dragon.layout.units_LU_PER_PX
import dev.dragon.layout.units_fromCssPx
import dev.dragon.layout.units_platformFontSize
import dev.dragon.layout.units_snapEdge

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
  /** Per text view: the ascent, the descent, then each line's half-leading (its content top below the line top; INL1a). */
  private val textMetrics = HashMap<String, DoubleArray>()
  private val hosts = HashMap<String, String>()
  private val companions = HashMap<String, ArrayList<android.view.View>>()

  /**
   * Hosting (PNT1): node id's view is added to host's container instead of its DOM parent's; frames stay absolute from the
   * engine and the dump stays in DOM terms.
   */
  fun host(id: String, host: String) { hosts[id] = host }
  /** A companion view placed directly beneath node id in the same host, with the node's frame (outer shadows, PNT1). */
  fun companion(id: String, view: android.view.View) { companions.getOrPut(id) { ArrayList() }.add(view) }
  /** A built node's view, for the runtime writers (RT-1, RT-2, RT-11). */
  fun node(id: String): DragonNodeView? = views[id]

  /** Each inline box's fragments (INL1a): left, top, right, bottom relative to the box's snapped edges, and the baseline from the top. */
  private val inlineLines = HashMap<String, List<DoubleArray>>()

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

  private fun setFrame(f: IntArray, l: Double, t: Double, r: Double, b: Double, what: String) = dragonSetFrame(f, l, t, r, b, what)

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
    val zStyles = HashMap<String, LayoutStyle>()
    val zLeaves = ArrayList<ReplacedLeaf>()
    val zParent = HashMap<String, String>()
    // A text leaf's, inline box's or <br>'s container is the block container of its inline formatting context, through any
    // inline boxes.
    val inlineIds = HashSet<String>()
    fun walkInline(c: U_InlineBox_LineBreak_TextLeaf, container: String) {
      if (c is TextLeaf) zParent[c.id] = container
      else if (c is InlineBox) {
        inlineIds.add(c.id)
        zParent[c.id] = container
        for (k in c.children) walkInline(k, container)
      } else if (c is LineBreak) inlineIds.add(c.id)
    }
    fun walk(b: LayoutBox) {
      zBoxes[b.id] = b
      zStyles[b.id] = b.style
      for (c in b.children) {
        if (c is LayoutBox) { zParent[c.id] = b.id; walk(c) } else if (c is TextLeaf) zParent[c.id] = b.id
        else if (c is ReplacedLeaf) { zParent[c.id] = b.id; zStyles[c.id] = c.style; zLeaves.add(c) }
        else if (c is InlineBox) walkInline(c, b.id)
        else if (c is LineBreak) walkInline(c, b.id)
      }
    }
    walk(zoomed.root)
    // OVFL-B: each scroll container's offset range in device px, from the translated engine, for the scroll module's hook.
    val scrollRanges = HashMap<String, IntArray>()
    val sr = overflow_scrollRanges(input, measurer)
    val srNo = sr as? ScrollRangesResult_refused
    if (srNo != null) throw IllegalStateException("dragon: the engine refused the scroll ranges at " + srNo.nodeId + ": " + srNo.detail)
    val srOk = sr as? ScrollRangesResult_ok ?: throw IllegalStateException("dragon: the engine gave no scroll ranges")
    for (g in srOk.ranges) scrollRanges[g.id] = intArrayOf(dragonCheckedInt(g.minX, g.id + " scroll minX"), dragonCheckedInt(g.maxX, g.id + " scroll maxX"), dragonCheckedInt(g.minY, g.id + " scroll minY"), dragonCheckedInt(g.maxY, g.id + " scroll maxY"))
    val scrollRefusals = HashMap<String, String>()
    for (g in srOk.refused) scrollRefusals[g.id] = "the engine refused its scroll range at " + g.nodeId + ": " + g.detail
    val lu = units_LU_PER_PX
    // BG2 R4: the root scroller's scrolling contents start at Chrome's scroll origin. In a right-to-left document that is the left
    // edge of the content overflowing to the left: the leftmost box or line no clipping box holds (html and body never clip here,
    // as their overflow propagates to the viewport); 0 otherwise (paint-samples/gradient.ts rootScrollX on the host).
    var rootX = 0.0
    if (zoomed.root.style.direction == "rtl") {
      val parentOf = HashMap<String, String>()
      for (r in boxes) { val p = r.parent; if (p != null) parentOf[r.id] = p }
      fun depth(id: String): Int { var d = 0; var p = parentOf[id]; while (p != null) { d++; p = parentOf[p] }; return d }
      for (r in boxes) {
        var held = false
        var p = parentOf[r.id]
        while (p != null && !held) {
          val bv = views[p] as? DragonBoxView
          if (depth(p) >= 2 && bv != null && bv.dragonClipView != null) held = true
          p = parentOf[p]
        }
        val a = abs.get(r.id)
        if (!held && a != null && a.x < rootX) rootX = a.x
      }
      // Chrome's scroll origin is a whole point (ToFlooredPoint of the overflow's offset negated): the layer starts at the ceiling.
      rootX = kotlin.math.ceil(rootX / lu) * lu + 0.0
    }
    setFrame(root.dragonFrame, 0.0, 0.0, kotlin.math.ceil(input.viewport.width * scale), kotlin.math.ceil(input.viewport.height * scale), "root")
    val edges = HashMap<String, DoubleArray>()
    val borders = HashMap<String, DoubleArray>()
    val rects = HashMap<String, LayoutRect>()
    val contentCache = HashMap<String, Double>()
    // BG2: an absolutely positioned box's containing block width (CSS2 §10.1), the padding box of its nearest positioned ancestor
    // or the initial containing block (layout.ts containingBlock); null for an in-flow box.
    fun absoluteBasis(id: String): Double? {
      val z = zStyles[id] ?: throw IllegalStateException("dragon: no zoomed box " + id)
      if (z.position != "absolute") return null
      var at = zParent[id]
      while (at != null && zStyles[at]?.position == "static") at = zParent[at]
      if (at == null) return units_fromCssPx(zoomed.viewport.width)
      val st = zStyles[at] ?: throw IllegalStateException("dragon: no zoomed box " + at)
      val r = rects[at] ?: throw IllegalStateException("dragon: the containing block " + at + " of " + id + " is not placed")
      val bor = box_resolveBorder(st, zoomed.devicePixelRatio)
      return r.width - bor.left - bor.right
    }
    // What a box's percentage paddings resolve against, as the engine does: its absoluteBasis, or its parent's content width.
    fun contentWidth(id: String): Double {
      val cached = contentCache[id]
      if (cached != null) return cached
      val z = zBoxes[id] ?: throw IllegalStateException("dragon: no box " + id)
      val r = rects[id] ?: throw IllegalStateException("dragon: no rect " + id)
      val parent = zParent[id]
      val cb = absoluteBasis(id) ?: if (parent != null) contentWidth(parent) else units_fromCssPx(zoomed.viewport.width)
      val pad = box_resolvePadding(z.style, cb)
      val bor = box_resolveBorder(z.style, zoomed.devicePixelRatio)
      val w = r.width - bor.left - bor.right - pad.left - pad.right
      contentCache[id] = w
      return w
    }
    fun paddingBasis(id: String): Double {
      val p = zParent[id]
      return absoluteBasis(id) ?: if (p != null) contentWidth(p) else units_fromCssPx(zoomed.viewport.width)
    }
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
        val h = hosts[id] ?: p
        val pv = views[h] as? DragonBoxView ?: throw IllegalStateException("dragon: " + id + " has no parent box " + h)
        val pe = edges[h] ?: throw IllegalStateException("dragon: parent " + h + " is not placed")
        val pb = borders[h] ?: throw IllegalStateException("dragon: parent " + h + " has no borders")
        container = pv.dragonContainer
        ox = if (pv.dragonClipView == null) pe[0] else pe[0] + pb[3]
        oy = if (pv.dragonClipView == null) pe[1] else pe[1] + pb[0]
      }
      for (c in companions[id] ?: emptyList<android.view.View>()) {
        container.addView(c)
        setFrame(dragonFrameOf(c), e.left - ox, e.top - oy, e.right - ox, e.bottom - oy, id + " companion")
      }
      container.addView(v as android.view.View)
      setFrame(dragonFrameOf(v), e.left - ox, e.top - oy, e.right - ox, e.bottom - oy, id)
      if (v is DragonBoxView) {
        // An inline box or <br> view is unpainted and has no borders (the compiler refuses inline box borders until INL1b) and no
        // paddings a background reads (the compiler refuses gradients on inline boxes).
        val inline = inlineIds.contains(id)
        val zs = if (inline) null else zStyles[id] ?: throw IllegalStateException("dragon: no zoomed box " + id)
        val px = if (zs == null) doubleArrayOf(0.0, 0.0, 0.0, 0.0) else {
          val be = box_resolveBorder(zs, zoomed.devicePixelRatio)
          doubleArrayOf(be.top / lu, be.right / lu, be.bottom / lu, be.left / lu)
        }
        borders[id] = px
        // BG2: the unsnapped border box and the paddings (percentages of the containing block's content width), in LU.
        val a = abs.get(r.id) ?: throw IllegalStateException("dragon: no absolute rect for " + id)
        val padding = if (zs == null) DoubleArray(4) else { val pad = box_resolvePadding(zs, paddingBasis(id)); doubleArrayOf(pad.top, pad.right, pad.bottom, pad.left) }
        v.dragonShape = DragonBoxShape(doubleArrayOf(e.left, e.top, e.right, e.bottom), px, DoubleArray(8), doubleArrayOf(r.width / lu, r.height / lu), doubleArrayOf(a.x, a.y, a.width, a.height), padding, rootX)
        v.dragonScrollRange = scrollRanges[id]
        v.dragonScrollRefusal = scrollRefusals[id]
        dragonAfterLayout(v, v.dragonShape, scale)
        v.invalidate()
      }
    }
    // REPL-a: each replaced box's paint rects from its content box (border box less borders and padding against the parent's
    // content width), through the translated engine; the paint modules read them in their after-layout hooks and stages.
    for (leaf in zLeaves) {
      val id = leaf.id
      val bv = views[id] as? DragonBoxView ?: throw IllegalStateException("dragon: replaced " + id + " has no box view")
      val e = edges[id] ?: throw IllegalStateException("dragon: replaced " + id + " is not placed")
      val a = abs.get(id) ?: throw IllegalStateException("dragon: no absolute rect for " + id)
      val pId = zParent[id] ?: throw IllegalStateException("dragon: replaced " + id + " has no parent")
      val pad = box_resolvePadding(leaf.style, contentWidth(pId))
      val bor = box_resolveBorder(leaf.style, zoomed.devicePixelRatio)
      val content = ObjectRect(a.x + bor.left + pad.left, a.y + bor.top + pad.top, maxOf(0.0, a.width - bor.left - bor.right - pad.left - pad.right), maxOf(0.0, a.height - bor.top - bor.bottom - pad.top - pad.bottom))
      val p = paint_replacedPaint(leaf, content)
      fun rel(r: PixelRect): DoubleArray = doubleArrayOf(r.x - e[0], r.y - e[1], r.width, r.height)
      bv.dragonReplacedContent = rel(p.content)
      bv.dragonReplacedDest = rel(p.dest)
      bv.dragonReplacedDrawn = p.drawn?.let { rel(it) }
      dragonAfterLayout(bv, bv.dragonShape, scale)
      bv.invalidate()
    }
    for (id in order) {
      val tv = views[id] as? DragonTextView ?: continue
      val pId = zParent[id] ?: throw IllegalStateException("dragon: text " + id + " has no container")
      val p = zBoxes[pId] ?: throw IllegalStateException("dragon: no container " + pId)
      val e = edges[id] ?: throw IllegalStateException("dragon: text " + id + " is not placed")
      // The engine's own lines: inline.ts placeLines (buildIfc, then placeIfcLines), translated, over the zoomed context. Each
      // line gives this leaf's piece; a piece's leaf index is into the same formatting context's leaves.
      val ctx = Ctx(measurer, zoomed.devicePixelRatio, block_NO_ENGINE_FAULTS, grid_NO_GRID_FAULTS)
      val ifc = inline_buildIfc(ctx, p)
      val leaves = ifc.leaves
      val li = leaves.indexOfFirst { it.id == id }
      if (li < 0) throw IllegalStateException("dragon: no leaf " + id)
      val leafText = leaves[li].text
      fun utf16(cp: Int): Int = leafText.offsetByCodePoints(0, cp)
      val placed = inline_placeIfcLines(ctx, p, ifc, contentWidth(pId))
      val pieces = boxes.indices.filter { isLine(boxes[it]) && boxes[it].parent == id }
      // The instance size of the leaf's computed font size in the resolved input (environment.ts), at the device scale.
      val size = units_platformFontSize(leaves[li].font.size)
      val specs = ArrayList<DragonLineSpec>()
      var viewMetrics: DoubleArray? = null
      var firstBaselineOffset: Double? = null
      for (line in placed) {
        val piece = line.pieces.firstOrNull { it.leaf.toInt() == li } ?: continue
        // One font per text view: every line's ascent and descent are the view's; its content top below the line top is the line's.
        val known = viewMetrics
        if (known != null && (known[0] != piece.ascent / lu || known[1] != piece.descent / lu)) throw IllegalStateException("dragon: " + id + ": line ascent " + (piece.ascent / lu) + " and descent " + (piece.descent / lu) + " differ from the text view's " + known[0] + " and " + known[1])
        viewMetrics = (known ?: doubleArrayOf(piece.ascent / lu, piece.descent / lu)) + doubleArrayOf((piece.top - line.top) / lu)
        val k = specs.size
        if (k >= pieces.size) throw IllegalStateException("dragon: " + id + ": the engine's breaks give more lines than its layout (" + pieces.size + ")")
        val i = pieces[k]
        val r = boxes[i]
        if (piece.width != r.width) throw IllegalStateException("dragon: " + id + " line " + k + ": the engine's break gives width " + piece.width + " LU, its layout " + r.width + " LU")
        val a = abs.get(r.id) ?: throw IllegalStateException("dragon: no absolute rect for " + r.id)
        val top = units_snapEdge(a.y - (piece.top - line.top))
        var baseline = snapped[i].top + piece.ascent / lu
        // The single-run-baseline plant: every line takes the first line's baseline below its line top.
        val f = firstBaselineOffset
        if (f != null && DRAGON_SINGLE_RUN_BASELINE_PLANT != 0.0) baseline = top + f else if (f == null) firstBaselineOffset = baseline - top
        // Dragon places every glyph: the pen starts at the engine's run left and advances by the engine's per-glyph advance
        // (the instance size times the font-unit advance / unitsPerEm, summed in float as textAdvanceAt does).
        val xLU = a.x - e[0] * lu
        val from = utf16(piece.start.toInt())
        val text = leafText.substring(from, utf16(piece.visibleEnd.toInt()))
        val cps = text.codePoints().toArray()
        val glyphs = IntArray(cps.size)
        val xs = DoubleArray(cps.size)
        var pen = 0f
        for ((n, cp) in cps.withIndex()) {
          val gid = bridge.glyph(cp)
          glyphs[n] = gid
          xs[n] = xLU / lu + pen.toDouble()
          pen = pen + (size * bridge.advanceUnits(gid) / bridge.data.unitsPerEm).toFloat()
        }
        specs.add(DragonLineSpec(text, glyphs, xs, xLU, piece.width, dragonCheckedInt(top - e[1], id + " line top"), dragonCheckedInt(baseline - e[1], id + " baseline"), from, utf16(piece.end.toInt())))
      }
      if (specs.size != pieces.size) throw IllegalStateException("dragon: " + id + ": the engine's breaks give " + specs.size + " lines, its layout " + pieces.size)
      val vm = viewMetrics
      if (vm != null) textMetrics[id] = vm else textMetrics.remove(id)
      tv.dragonConfigure(bridge, size.toFloat(), specs)
    }
    // Each inline box's fragments, one per line it is on (the engine's "<box>:line<j>"), with that line's baseline.
    inlineLines.clear()
    val fragments = LinkedHashMap<String, ArrayList<Int>>()
    for (i in boxes.indices) {
      val r = boxes[i]
      val p = r.parent
      if (isLine(r) && p != null && inlineIds.contains(p)) fragments.getOrPut(p) { ArrayList() }.add(i)
    }
    for ((bId, idx) in fragments) {
      val pId = zParent[bId] ?: throw IllegalStateException("dragon: inline box " + bId + " has no container")
      val p = zBoxes[pId] ?: throw IllegalStateException("dragon: no container " + pId)
      val be = edges[bId] ?: throw IllegalStateException("dragon: inline box " + bId + " is not placed")
      val ctx = Ctx(measurer, zoomed.devicePixelRatio, block_NO_ENGINE_FAULTS, grid_NO_GRID_FAULTS)
      val ifc = inline_buildIfc(ctx, p)
      val b = ifc.boxes.indexOfFirst { it.id == bId }
      if (b < 0) throw IllegalStateException("dragon: no inline box " + bId + " in " + pId)
      val offsets = ArrayList<Double>()
      val placedLines = inline_placeIfcLines(ctx, p, ifc, contentWidth(pId))
      for (line in placedLines) {
        for (k in line.boxes.indices) if (line.boxes[k].toInt() == b) offsets.add(line.baseline - line.boxRects[k].y)
      }
      // A context with no line box gives each inline box one empty fragment at the content start (inline.ts collectFragments),
      // on no line, so its baseline is its own top.
      if (placedLines.isEmpty()) offsets.add(0.0)
      if (offsets.size != idx.size) throw IllegalStateException("dragon: " + bId + ": the engine's lines give " + offsets.size + " fragments, its layout " + idx.size)
      inlineLines[bId] = idx.indices.map { j -> val e = snapped[idx[j]]; doubleArrayOf(e.left - be[0], e.top - be[1], e.right - be[0], e.bottom - be[1], offsets[j] / lu) }
    }
  }

  /** The dump read back from the live tree: frames from the layout positions up to the root (dragonLayoutOffset), divided by density. */
  fun dump(c: DragonCase, scale: Double, device: DumpDevice, pixels: DumpPixels, timing: DumpTiming): Dump {
    val s = scale
    val nodes = ArrayList<DumpNodes>()
    for (id in order) {
      val v = views[id] ?: continue
      val view = v as android.view.View
      val at = dragonLayoutOffset(view, root)
      val l = at[0].toDouble()
      val t = at[1].toDouble()
      val rr = l + view.width
      val b = t + view.height
      val lines = ArrayList<DumpNodesLines>()
      if (v is DragonTextView && v.specs.isNotEmpty()) {
        val m = textMetrics[id] ?: throw IllegalStateException("dragon: " + id + ": a text view with lines has no line metrics")
        // Each line as Dragon placed it in the live view: the run from the view's live position, snapped with the one snap rule.
        if (m.size != 2 + v.specs.size) throw IllegalStateException("dragon: " + id + ": " + (m.size - 2) + " line metrics for " + v.specs.size + " lines")
        for ((k, x) in v.specs.withIndex()) {
          val top = t + x.top + m[2 + k]
          val bottom = top + m[0] + m[1]
          val left = units_snapEdge(l * units_LU_PER_PX + x.xLU)
          val right = units_snapEdge(l * units_LU_PER_PX + x.xLU + x.widthLU)
          val baseline = t + x.baseline
          lines.add(DumpNodesLines(DumpNodesLinesFrame(left / s, top / s, (right - left) / s, (bottom - top) / s), DumpNodesLinesDeviceEdges(left, top, right, bottom), (baseline - top) / s, x.start.toDouble(), x.end.toDouble()))
        }
      } else {
        // An inline box's lines are its fragments, placed from the box view's live position; it has no text, so offsets 0 to 0.
        for (f in inlineLines[id] ?: emptyList()) {
          val e = doubleArrayOf(l + f[0], t + f[1], l + f[2], t + f[3])
          lines.add(DumpNodesLines(DumpNodesLinesFrame(e[0] / s, e[1] / s, (e[2] - e[0]) / s, (e[3] - e[1]) / s), DumpNodesLinesDeviceEdges(e[0], e[1], e[2], e[3]), f[4] / s, 0.0, 0.0))
        }
      }
      nodes.add(DumpNodes(id, parents[id], v.dragonKind, view.javaClass.name, DumpNodesFrame(l / s, t / s, (rr - l) / s, (b - t) / s), DumpNodesDeviceEdges(l, t, rr, b), v.dragonApplied(), lines))
    }
    return Dump("android-emu", DumpCase(c.id, c.fixture, s, DumpCaseViewport(c.viewportWidth, c.viewportHeight), c.direction, c.compilerDigest, c.expectedDigest(s)), device, nodes, pixels, timing)
  }
}

/**
 * A view's layout position in root's coordinates with every view transform ignored (PNT2): the dump's frames are the engine's
 * untransformed boxes, and a transform is paint, proven by the pixel lane and Chrome's content quads. Without transforms it equals
 * getLocationInWindow(view) minus getLocationInWindow(root).
 */
fun dragonLayoutOffset(v: android.view.View, root: android.view.View): IntArray {
  var x = 0
  var y = 0
  var c = v
  while (c !== root) {
    val p = c.parent as? android.view.View ?: throw IllegalStateException("dragon: a dumped view is not inside the root")
    x += c.left - p.scrollX
    y += c.top - p.scrollY
    c = p
  }
  return intArrayOf(x, y)
}

/** Sets a Dragon frame (left, top, right, bottom in device px) through the checked conversion. */
fun dragonSetFrame(f: IntArray, l: Double, t: Double, r: Double, b: Double, what: String) {
  f[0] = dragonCheckedInt(l, what + " left")
  f[1] = dragonCheckedInt(t, what + " top")
  f[2] = dragonCheckedInt(r, what + " right")
  f[3] = dragonCheckedInt(b, what + " bottom")
}

/** One generated sample point of a case, in device px of the capture. */
class DragonPoint(val x: Int, val y: Int, val rule: String)

/**
 * The host's run file (the P5 points protocol), tab separated: "case <id>" lines name the cases in order, "point <id> <x> <y> <rule>"
 * lines are a case's generated sample points in device px, and "hold 1" makes the app wait after each case until the host has
 * taken its OS screenshot (the host then writes release-<id> into the files dir).
 */
class DragonRun(val ids: List<String>, val points: Map<String, List<DragonPoint>>, val hold: Boolean)

fun dragonReadRun(f: java.io.File): DragonRun? {
  if (!f.exists()) return null
  val ids = ArrayList<String>()
  val points = HashMap<String, ArrayList<DragonPoint>>()
  var hold = false
  for (line in f.readText().split("\n")) {
    if (line.isEmpty()) continue
    val p = line.split("\t")
    if (p[0] == "case" && p.size == 2) ids.add(p[1])
    else if (p[0] == "hold" && p.size == 2) hold = p[1] == "1"
    else if (p[0] == "point" && p.size == 5) points.getOrPut(p[1]) { ArrayList() }.add(DragonPoint(p[2].toInt(), p[3].toInt(), p[4]))
    else throw IllegalStateException("dragon: bad run file line: " + line)
  }
  return DragonRun(ids, points, hold)
}

/** The capture's RGBA8 pixels at the generated points (a point outside the capture fails loudly). */
fun dragonSamples(rgba: ByteArray, w: Int, h: Int, points: List<DragonPoint>): List<DumpPixelsSamples> = points.map { p ->
  if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) throw IllegalStateException("dragon: sample point " + p.x + "," + p.y + " (" + p.rule + ") is outside the " + w + "x" + h + " capture")
  val i = (p.y * w + p.x) * 4
  DumpPixelsSamples(p.x.toDouble(), p.y.toDouble(), listOf(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]).map { (it.toInt() and 0xff).toDouble() }, p.rule)
}
`;

export type SupportFile = { readonly path: string; readonly text: string };

const header = (comment: string, what: string): string => `${comment} GENERATED by dragon emit/native-support.ts (${NATIVE_SUPPORT_VERSION}): ${what}. Do not edit.\n`;

/**
 * Raster plants of the support code: glyph-offset-1 draws every glyph 1 device px right of the engine's position (P5), and
 * glyph-offset-y-1 1 device px below it (T093); the paint modules add theirs.
 */
export type SupportPlant = 'glyph-offset-1' | 'glyph-offset-y-1' | PaintPlantName | 'single-run-baseline';

type PlantReplacement = { readonly name: SupportPlant; readonly replace: { readonly [B in NativeBackend]: readonly [string, string] } };

/** A glyph plant or the line plant: its constant goes from 0 to 1. */
const glyphPlant = (name: SupportPlant, uikit: string, android: string): PlantReplacement => ({
  name,
  replace: { uikit: [`${uikit}0\n`, `${uikit}1\n`], 'android-views': [`${android}0.0\n`, `${android}1.0\n`] },
});

/** Registration point (EMS): every support plant, the glyph plants first, then the paint modules' plants in registry order, then
 * the INL1a line plant (appended): every line of a text view after the first takes its first line's baseline offset. */
const PLANT_REPLACEMENTS: readonly PlantReplacement[] = [
  glyphPlant('glyph-offset-1', 'public let dragonGlyphPlantDevicePx: Double = ', 'const val DRAGON_GLYPH_PLANT_DEVICE_PX = '),
  glyphPlant('glyph-offset-y-1', 'public let dragonGlyphPlantYDevicePx: Double = ', 'const val DRAGON_GLYPH_PLANT_Y_DEVICE_PX = '),
  ...(paintPlants() as readonly PlantReplacement[]),
  glyphPlant('single-run-baseline', 'public let dragonSingleRunBaselinePlant: Double = ', 'const val DRAGON_SINGLE_RUN_BASELINE_PLANT = '),
];

export const SUPPORT_PLANTS: readonly SupportPlant[] = PLANT_REPLACEMENTS.map((p) => p.name);

/** The support files of a backend, relative to the generated source root; a plant changes only its one replacement. */
export function emitNativeSupport(backend: NativeBackend, plant: SupportPlant | null = null): GeneratedFile[] {
  const files = supportFiles(backend);
  if (plant === null) return files;
  const def = PLANT_REPLACEMENTS.find((p) => p.name === plant);
  if (def === undefined) throw new Error(`no support plant ${plant}`);
  const [from, to] = def.replace[backend];
  return applyPlant(files, from, to, `the ${plant} plant in the ${backend} support`);
}

/** Replaces a plant's one source text; throws unless it occurs exactly once across the files, so a plant changes one place. */
export function applyPlant(files: readonly GeneratedFile[], from: string, to: string, what: string): GeneratedFile[] {
  const count = files.reduce((n, f) => n + f.text.split(from).length - 1, 0);
  if (count !== 1) throw new Error(`${what}: ${JSON.stringify(from)} occurs ${count} times, not once`);
  return files.map((f) => (f.text.includes(from) ? { ...f, text: f.text.replace(from, to) } : f));
}

/** The members every paint module adds to the DragonBoxView class body, in registry order. */
function boxMembers(backend: NativeBackend): string {
  return nativePaints(backend).map((m) => m.native.boxMembers).join('');
}

/** The registration points of the paint modules (EMS): stage dispatch, after-layout hooks, readback, rounded paths and the container factory. */
function paintStagesSource(backend: NativeBackend): string {
  const paints = nativePaints(backend);
  const ios = backend === 'uikit';
  const calls = (fns: readonly string[], args: string): string => fns.map((f) => `  ${f}(${args})\n`).join('');
  const stages = PAINT_STAGES.map((st) => `  // ${st}\n${calls(stagePainters(backend, st), ios ? 'v, ctx, shape' : 'v, canvas, shape')}`).join('');
  const after = calls(paints.flatMap((m) => (m.native.afterLayout === null ? [] : [m.native.afterLayout])), 'v, shape, scale');
  const applied = paints.flatMap((m) => (m.native.applied === null ? [] : [m.native.applied]));
  const rounded = soleHook(backend, 'roundedPath');
  const container = soleHook(backend, 'container');
  if (ios) {
    return `import UIKit

/// Registration point (EMS): the box paint stages in CSS order (outer shadow, background, background layers, inset shadow, border,
/// outline); each stage calls its paint modules' painters in registry order. backgroundColor is drawn by UIKit beneath draw(_:).
public func dragonPaintBox(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
${stages}}

/// Registration point (EMS): after every layout, each paint module's hook in registry order.
public func dragonAfterLayout(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
${after}}

/// Registration point (EMS): a box's applied values, each paint module's readback in registry order.
public func dragonPaintApplied(_ v: DragonBoxView) -> DumpJsonObject {
  var o: DumpJsonObject = []
${applied.map((f) => `  o += ${f}(v)\n`).join('')}  return o
}

/// Registration point (EMS): the rounded border-box path (inner false) or padding-box path (inner true) of a shape, from the
/// radius module; nil means the stages draw and clip the rectangle.
public func dragonRoundedPath(_ v: DragonBoxView, _ shape: DragonBoxShape, inner: Bool) -> CGPath? {
  return ${rounded === null ? 'nil' : `${rounded}(v, shape, inner)`}
}

/// Registration point (EMS): the view a clipping box hosts its children in.
public func dragonMakeContainer() -> DragonClipView {
  return ${container === null ? 'DragonClipView()' : `${container}()`}
}
`;
  }
  return `package dev.dragon.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Path
import dev.dragon.dump.DumpJson

/**
 * Registration point (EMS): the box paint stages in CSS order (outer shadow, background, background layers, inset shadow, border,
 * outline); each stage calls its paint modules' painters in registry order. The ColorDrawable background is drawn beneath onDraw.
 */
fun dragonPaintBox(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
${stages}}

/** Registration point (EMS): after every layout, each paint module's hook in registry order. */
fun dragonAfterLayout(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
${after}}

/** Registration point (EMS): a box's applied values, each paint module's readback in registry order. */
fun dragonPaintApplied(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val o = ArrayList<Pair<String, DumpJson>>()
${applied.map((f) => `  o.addAll(${f}(v))\n`).join('')}  return o
}

/**
 * Registration point (EMS): the rounded border-box path (inner false) or padding-box path (inner true) of a shape, from the radius
 * module; null means the stages draw and clip the rectangle.
 */
fun dragonRoundedPath(v: DragonBoxView, shape: DragonBoxShape, inner: Boolean): Path? = ${rounded === null ? 'null' : `${rounded}(v, shape, inner)`}

/** Registration point (EMS): the view a clipping box hosts its children in. */
fun dragonMakeContainer(ctx: Context): DragonClipView = ${container === null ? 'DragonClipView(ctx)' : `${container}(ctx)`}
`;
}

/** Registration point (EMS, RT-13 style): the support files of a backend, then the paint stages file, then one file per paint module that has native code. */
function supportFiles(backend: NativeBackend): GeneratedFile[] {
  const paint = nativePaints(backend).flatMap((m) => (m.native.file === null ? [] : [{ name: m.name, stem: m.stem, text: m.native.file }]));
  if (backend === 'uikit') {
    return [
      { path: 'Support/DragonChecked.swift', text: header('//', 'checked conversions') + SWIFT_CHECKED },
      { path: 'Support/DragonFontTables.swift', text: header('//', 'font table reads and the bridge self-check') + SWIFT_FONT_TABLES },
      { path: 'Support/DragonViews.swift', text: header('//', 'the Dragon views and the glyph-placing text view') + swiftViews() },
      { path: 'Support/DragonBridge.swift', text: header('//', 'the font-data measurer bridge') + SWIFT_BRIDGE },
      { path: 'Support/DragonTree.swift', text: header('//', 'the native tree, engine application and dump readback') + SWIFT_TREE },
      { path: 'Support/DragonPaintStages.swift', text: header('//', 'the paint registration points') + paintStagesSource(backend) },
      ...paint.map((m) => ({ path: `Support/Paint/${m.stem}.swift`, text: header('//', `the ${m.name} paint module`) + m.text })),
      ...runtimeSupportFiles(backend, (what) => header('//', what)),
    ];
  }
  return [
    { path: 'kotlin/dev/dragon/views/DragonChecked.kt', text: header('//', 'checked conversions') + KOTLIN_CHECKED },
    { path: 'kotlin/dev/dragon/views/DragonFontTables.kt', text: header('//', 'font table reads and the bridge self-check') + KOTLIN_FONT_TABLES },
    { path: 'kotlin/dev/dragon/views/DragonViews.kt', text: header('//', 'the Dragon views and the glyph-placing text view') + kotlinViews() },
    { path: 'kotlin/dev/dragon/views/DragonBridge.kt', text: header('//', 'the font-data measurer bridge') + KOTLIN_BRIDGE },
    { path: 'kotlin/dev/dragon/views/DragonTree.kt', text: header('//', 'the native tree, engine application and dump readback') + KOTLIN_TREE },
    { path: 'kotlin/dev/dragon/views/DragonPaintStages.kt', text: header('//', 'the paint registration points') + paintStagesSource(backend) },
    // Paint module files sit under views/paint and keep package dev.dragon.views, so the case code needs no new import.
    ...paint.map((m) => ({ path: `kotlin/dev/dragon/views/paint/${m.stem}.kt`, text: header('//', `the ${m.name} paint module`) + m.text })),
    ...runtimeSupportFiles(backend, (what) => header('//', what)),
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
  'justifyContent', 'alignItems', 'alignSelf', 'alignContent', 'rowGap', 'columnGap', 'textAlign', 'aspectRatio', 'verticalAlign', 'grid', 'gridItem',
] as const;

const VALUE_CLASSES: Readonly<Record<string, string>> = {
  px: 'Px', percent: 'Percent', auto: 'Auto', none: 'NoneValue', content: 'ContentValue', normal: 'NormalValue', number: 'NumberValue', 'device-px': 'DevicePx',
  fr: 'Fr', 'min-content': 'MinContent', 'max-content': 'MaxContent',
};

/** The translated engine's union type of TrackSize (grid.ts input), the element type of a track-size array. */
const TRACK_SIZE_UNION = 'U_TrackSize_breadth_TrackSize_fitContent_TrackSize_minmax';

/** A typed array of the translated engine: JsArray in Swift, jsArrayOf in Kotlin. */
function engineArray(lang: Lang, elem: string, union: boolean, items: readonly string[]): string {
  return lang === 'swift' ? `JsArray<${union ? 'any ' : ''}${elem}>([${items.join(', ')}])` : `jsArrayOf<${elem}>(${items.join(', ')})`;
}

type TrackSizeInput = import('@dragon/layout').TrackSize;
type GridSpanInput = import('@dragon/layout').GridSpan;

function trackSizeValue(lang: Lang, t: TrackSizeInput, str: (s: string) => string): string {
  if (t.kind === 'breadth') return `TrackSize_breadth(${str('breadth')}, ${engineValue(lang, t.breadth)})`;
  if (t.kind === 'minmax') return `TrackSize_minmax(${str('minmax')}, ${engineValue(lang, t.min)}, ${engineValue(lang, t.max)})`;
  return `TrackSize_fitContent(${str('fit-content')}, ${engineValue(lang, t.limit)})`;
}

function gridSpanValue(lang: Lang, s: GridSpanInput, str: (s: string) => string): string {
  return s.kind === 'definite' ? `GridSpan_definite(${str('definite')}, ${doubleLit(s.start)}, ${doubleLit(s.end)})` : `GridSpan_auto(${str('auto')}, ${doubleLit(s.span)})`;
}

/** The grid and gridItem fields of a LayoutStyle (css-grid-2; input.ts GridContainerStyle and GridItemStyle), or null. */
function gridValue(lang: Lang, field: 'grid' | 'gridItem', v: unknown, str: (s: string) => string): string {
  if (v === undefined) throw new Error(`LayoutStyle.${field} is missing; it is null where unused`);
  if (v === null) return lang === 'swift' ? 'nil' : 'null';
  if (field === 'gridItem') {
    const g = v as import('@dragon/layout').GridItemStyle;
    return `GridItemStyle(${gridSpanValue(lang, g.column, str)}, ${gridSpanValue(lang, g.row, str)}, ${str(g.justifySelf)})`;
  }
  const g = v as import('@dragon/layout').GridContainerStyle;
  const sizes = (ts: readonly TrackSizeInput[]): string => engineArray(lang, TRACK_SIZE_UNION, true, ts.map((t) => trackSizeValue(lang, t, str)));
  const reps = (rs: readonly import('@dragon/layout').TrackRepeater[]): string => engineArray(lang, 'TrackRepeater', false, rs.map((r) => `TrackRepeater(${doubleLit(r.count)}, ${sizes(r.sizes)})`));
  return `GridContainerStyle(${[
    reps(g.templateColumns), reps(g.templateRows), sizes(g.autoColumns), sizes(g.autoRows), doubleLit(g.explicitColumnCount), doubleLit(g.explicitRowCount),
    str(g.autoFlow), g.dense ? 'true' : 'false', str(g.justifyItems),
  ].join(', ')})`;
}

/** The translated union of CalcExpr (V2 of the value model): the element type of a calculation's operand list. */
const CALC_UNION = 'U_CalcClamp_CalcInvert_CalcMax_CalcMin_CalcProduct_CalcSum_EmLength_EnvLength_FontCalc_FontMetricLength_FontPercent_LineHeightLength_NumberValue_Percent_PixelsAndPercent_Px_RootFontLength_ViewportLength';

const CALC_LISTS: Readonly<Record<string, string>> = { sum: 'CalcSum', product: 'CalcProduct', min: 'CalcMin', max: 'CalcMax' };

/** The translated classes of the AspectRatioValue members with parts (input.ts); auto is the shared Auto class. */
const RATIO_CLASSES: Readonly<Record<string, string>> = { ratio: 'AspectRatioValue_ratio', 'auto-ratio': 'AspectRatioValue_autoRatio' };

/** A LengthCalc or a CalcExpr node that is not a plain value, as a constructor call; null for any other value. */
function calcValue(lang: Lang, o: Record<string, unknown>): string | null {
  const str = (s: string): string => (lang === 'swift' ? `JsString(${stringLit(lang, s)})` : stringLit(lang, s));
  const kind = o['kind'] as string;
  const e = (x: unknown): string => engineValue(lang, x);
  const list = CALC_LISTS[kind];
  if (list !== undefined) {
    const terms = (o['terms'] as unknown[]).map(e);
    return `${list}(${str(kind)}, ${lang === 'swift' ? `JsArray<any ${CALC_UNION}>([${terms.join(', ')}])` : `jsArrayOf<${CALC_UNION}>(${terms.join(', ')})`})`;
  }
  switch (kind) {
    case 'calc':
      return `LengthCalc(${str(kind)}, ${e(o['expr'])}, ${str(o['range'] as string)})`;
    case 'viewport':
      return `ViewportLength(${str(kind)}, ${doubleLit(o['value'] as number)}, ${str(o['axis'] as string)}, ${str(o['size'] as string)})`;
    case 'em':
      return `EmLength(${str(kind)}, ${doubleLit(o['value'] as number)}, ${e(o['fontSize'])})`;
    case 'rem':
      return `RootFontLength(${str(kind)}, ${doubleLit(o['value'] as number)})`;
    case 'font-metric':
      return `FontMetricLength(${str(kind)}, ${doubleLit(o['value'] as number)}, ${str(o['metric'] as string)}, ${fontSpecValue(lang, o['font'] as FontSpec)})`;
    case 'lh':
      return `LineHeightLength(${str(kind)}, ${doubleLit(o['value'] as number)}, ${fontSpecValue(lang, o['font'] as FontSpec)}, ${lineHeightValue(lang, o['lineHeight'])})`;
    case 'env':
      return `EnvLength(${str(kind)}, ${doubleLit(o['value'] as number)}, ${str(o['side'] as string)})`;
    case 'font-percent':
      return `FontPercent(${str(kind)}, ${doubleLit(o['value'] as number)}, ${e(o['parent'])})`;
    case 'font-calc':
      return `FontCalc(${str(kind)}, ${e(o['expr'])}, ${e(o['parent'])})`;
    case 'invert':
      return `CalcInvert(${str(kind)}, ${e(o['term'])})`;
    case 'clamp':
      return `CalcClamp(${str(kind)}, ${e(o['min'])}, ${e(o['value'])}, ${e(o['max'])})`;
    case 'pixels-and-percent':
      return `PixelsAndPercent(${str(kind)}, ${doubleLit(o['pixels'] as number)}, ${doubleLit(o['percent'] as number)}, ${String(o['explicitPixels'])}, ${String(o['explicitPercent'])})`;
    default:
      return null;
  }
}

/** A typed engine value as a constructor call of the translated engine. */
function engineValue(lang: Lang, v: unknown): string {
  const str = (s: string): string => (lang === 'swift' ? `JsString(${stringLit(lang, s)})` : stringLit(lang, s));
  if (typeof v === 'string') return str(v);
  if (typeof v === 'number') return doubleLit(v);
  const calc = calcValue(lang, v as Record<string, unknown>);
  if (calc !== null) return calc;
  const r = v as { kind: string; width?: number; height?: number };
  const ratio = RATIO_CLASSES[r.kind];
  if (ratio !== undefined) {
    if (typeof r.width !== 'number' || typeof r.height !== 'number') throw new Error(`aspect ratio ${JSON.stringify(v)} lacks its parts`);
    return `${ratio}(${str(r.kind)}, ${doubleLit(r.width)}, ${doubleLit(r.height)})`;
  }
  const o = v as { kind: string; value?: number | string };
  if (o.kind === 'keyword') return `VerticalAlignKeywordValue(${str('keyword')}, ${str(o.value as string)})`;
  const cls = VALUE_CLASSES[o.kind];
  if (cls === undefined) throw new Error(`no engine class for value kind ${o.kind}`);
  return o.value === undefined ? `${cls}(${str(o.kind)})` : `${cls}(${str(o.kind)}, ${doubleLit(o.value as number)})`;
}

/** A line height as a constructor call: a calculated one is the engine's LineHeightCalc, whose range is non-negative. */
function lineHeightValue(lang: Lang, v: unknown): string {
  const o = v as { kind: string; expr?: unknown };
  if (o.kind !== 'calc') return engineValue(lang, v);
  const str = (x: string): string => (lang === 'swift' ? `JsString(${stringLit(lang, x)})` : stringLit(lang, x));
  return `LineHeightCalc(${str('calc')}, ${engineValue(lang, o.expr)}, ${str('non-negative')})`;
}

/** A text run's font as a constructor call: family, the reference computed size, the specified size expression, absolute or not. */
function fontSpecValue(lang: Lang, f: FontSpec): string {
  const str = (x: string): string => (lang === 'swift' ? `JsString(${stringLit(lang, x)})` : stringLit(lang, x));
  return `FontSpec(${str(f.family)}, ${doubleLit(f.size)}, ${engineValue(lang, f.specifiedSize)}, ${String(f.absoluteSize)})`;
}

/**
 * The environment arguments of a case's LayoutInput, as explicit literals of the reference environment (V2a; hosts read the real
 * environment in V2b): every viewport unit reads the case viewport, no safe area, and the program's root font size.
 */
export function environmentArgs(viewport: { readonly width: number; readonly height: number }, rootFontSize: number): string {
  const v = `Viewport(${doubleLit(viewport.width)}, ${doubleLit(viewport.height)})`;
  return `ViewportUnitSizes(${v}, ${v}, ${v}), SafeAreaInsets(0.0, 0.0, 0.0, 0.0), ${doubleLit(rootFontSize)}`;
}

/**
 * Functions that build a LayoutInput with the translated engine's typed constructors (no JSON, no CSS): one small function per box,
 * which builds its style, its text leaves and calls its child boxes' functions. Returns the declarations and the root call.
 */
export function inputFunctions(lang: Lang, root: import('@dragon/layout').LayoutBox, prefix: string): { readonly decls: readonly string[]; readonly root: string } {
  const decls: string[] = [];
  let n = 0;
  const str = (s: string): string => (lang === 'swift' ? `JsString(${stringLit(lang, s)})` : stringLit(lang, s));
  const fieldValue = (st: import('@dragon/layout').LayoutStyle, f: (typeof STYLE_FIELDS)[number]): string => {
    const v = (st as unknown as Record<string, unknown>)[f];
    return f === 'grid' || f === 'gridItem' ? gridValue(lang, f, v, str) : engineValue(lang, v);
  };
  const styleOf = (st: import('@dragon/layout').LayoutStyle): string => `LayoutStyle(${STYLE_FIELDS.map((f) => fieldValue(st, f)).join(', ')})`;
  // A replaced leaf (input.ts ReplacedLeaf): its natural size is NaturalSizeValue_image or NaturalSizeValue_none.
  const replaced = (c: import('@dragon/layout').ReplacedLeaf): string => {
    const natural = c.natural.kind === 'image' ? `NaturalSizeValue_image(${str('image')}, ${doubleLit(c.natural.width)}, ${doubleLit(c.natural.height)})` : `NaturalSizeValue_none(${str('none')})`;
    return `ReplacedLeaf(${str('replaced')}, ${str(c.id)}, ${styleOf(c.style)}, ${natural}, ${doubleLit(c.defaultWidth)}, ${doubleLit(c.defaultHeight)}, ${str(c.objectFit)}, ${engineValue(lang, c.objectPositionX)}, ${engineValue(lang, c.objectPositionY)})`;
  };
  const list = (union: string, items: readonly string[]): string => (lang === 'swift' ? `JsArray<any ${union}>([${items.join(', ')}])` : `jsArrayOf<${union}>(${items.join(', ')})`);
  const inline = (c: import('@dragon/layout').InlineChild): string => {
    if (c.kind === 'text') return `TextLeaf(${str('text')}, ${str(c.id)}, ${str(c.text)}, ${fontSpecValue(lang, c.font)}, ${lineHeightValue(lang, c.lineHeight)}, ${str(c.whiteSpaceCollapse)}, ${str(c.textWrapMode)})`;
    if (c.kind === 'br') return `LineBreak(${str('br')}, ${str(c.id)}, ${fontSpecValue(lang, c.font)}, ${lineHeightValue(lang, c.lineHeight)})`;
    return `InlineBox(${str('inline')}, ${str(c.id)}, ${styleOf(c.style)}, ${fontSpecValue(lang, c.font)}, ${lineHeightValue(lang, c.lineHeight)}, ${list('U_InlineBox_LineBreak_TextLeaf', c.children.map(inline))})`;
  };
  const visit = (b: import('@dragon/layout').LayoutBox): string => {
    const name = `${prefix}Box${n++}`;
    const kids = b.children.map((c) => (c.kind === 'box' ? `${visit(c)}()` : c.kind === 'replaced' ? replaced(c) : inline(c)));
    const strut = b.strut === null ? (lang === 'swift' ? 'nil' : 'null') : `LineStrut(${fontSpecValue(lang, b.strut.font)}, ${lineHeightValue(lang, b.strut.lineHeight)})`;
    const body = `LayoutBox(${str('box')}, ${str(b.id)}, ${str(b.boxType)}, ${styleOf(b.style)}, ${strut}, ${list('U_InlineBox_LayoutBox_LineBreak_ReplacedLeaf_TextLeaf', kids)})`;
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
