// opacity on the box view (T046 §1): the case code writes the computed opacity through dragonSetOpacity, which takes Chrome's
// paint alpha byte from it with the translated paint.ts opacityAlpha8 and sets UIView.alpha or View.setAlpha to byte / 255; both
// platforms composite the view's subtree as a group. The readback is the live
// alpha, a float32 on both (CALayer.opacity backs UIView.alpha; View alpha is a Float).
// PNT1-opacity-b: a group the compiler pre-composites (lower/paint/effects.ts opacity-group) is written through
// dragonSetOpacityGroup instead. The view keeps alpha 1 and gets a DragonGroupView overlay as its last child, which shows Q:
// the group's layer (the platform's own rendering of the group, the overlay hidden) over a software backdrop (white, then each
// listed painter's square opaque fill and solid border sides, or an earlier group's Q), blitted per cc raster tile with the
// translated paint-group.ts groupComposite. Q covers the group's extent at whole device px with nearest filtering. Any box layout
// or paint change marks every overlay stale; each recomputes once in its next layout (iOS) or pre-draw (Android) pass. The
// overlay is not interactive, hidden from accessibility, never a dump node and sorted after every other child.
// PNT1-filter: a group with a colour-matrix filter is written through dragonSetFilterGroup with its functions as (code, amount)
// pairs; its overlay builds the matrices once (paint-group.ts groupFilterMatrices) and composites every pixel with
// groupFilterComposite instead (the filter, then the opacity; a filtered layer never folds).
import { COLOR_MATRIX_FILTERS } from '../../css/properties/filter.ts';
import type { FilterFunction } from '../../css/properties/filter.ts';
import type { EffectsWrite } from '../../lower/paint/effects.ts';
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';
import { nativeString } from './stacking.ts';

const opacityLit = (v: number): string => {
  if (!Number.isFinite(v) || v < 0 || v >= 1) throw new Error(`opacity ${v} is not in [0, 1)`);
  const n = String(v);
  return /[.eE]/.test(n) ? n.replace(/e\+?/, 'E') : `${n}.0`;
};

/** A finite non-negative amount as a Swift or Kotlin Double literal. */
const amountLit = (v: number): string => {
  if (!Number.isFinite(v) || v < 0) throw new Error(`filter amount ${v} is not finite and non-negative`);
  const n = String(v);
  return /[.eE]/.test(n) ? n.replace(/e\+?/, 'E') : `${n}.0`;
};

/** A filter list as the flat (code, amount) pairs the runtime takes: the code is the function's index in COLOR_MATRIX_FILTERS. */
export function filterPairs(fns: readonly FilterFunction[]): number[] {
  return fns.flatMap((f) => [COLOR_MATRIX_FILTERS.indexOf(f.name), f.amount]);
}

const pairsLit = (lang: 'swift' | 'kotlin', fns: readonly FilterFunction[]): string => {
  const xs = filterPairs(fns).map(amountLit).join(', ');
  return lang === 'swift' ? `[${xs}]` : `listOf<Double>(${xs})`;
};

const SWIFT_MEMBERS = String.raw`  /// Chrome's paint alpha byte of the box's opacity; 255 is opaque.
  public var dragonAlpha8: Int = 255
  /// PNT1-opacity-b: the overlay showing this pre-composited group's composite; nil for a box that is no such group.
  public var dragonGroup: DragonGroupView? = nil
  /// S2: a group nested in a pre-composited group, which that group's overlay composites in software; and the computed opacity.
  public var dragonNestedGroup = false
  public var dragonOpacity: Double = 1
`;

const SWIFT = String.raw`import UIKit
import CoreText

/// Whether the opacity writer ignores the alpha; false except in the alpha-ignored plant build.
public let dragonAlphaPlantIgnored = false

/// The opacity write of a box (runtime writer): the computed opacity, shown as UIView.alpha = Chrome's alpha byte / 255 (group
/// opacity).
public func dragonSetOpacity(_ v: DragonBoxView, _ opacity: Double) {
  if !(opacity >= 0 && opacity <= 1) { fatalError("dragon: \(v.dragonId): opacity \(opacity) is not in [0, 1]") }
  let raw: Double
  do { raw = try paint_opacityAlpha8(opacity) } catch { fatalError("dragon: \(v.dragonId): paint_opacityAlpha8 failed: \(error)") }
  let alpha8 = dragonCheckedInt(raw, "\(v.dragonId) alpha byte")
  v.dragonAlpha8 = alpha8
  if dragonAlphaPlantIgnored { return }
  v.alpha = CGFloat(Double(alpha8) / 255)
}

/// The readback of the effects module: the live alpha, when the box has an opacity below 1; for a pre-composited group, the
/// live alpha (1), the alpha byte its overlay composites with and its backdrop box.
public func dragonAppliedEffects(_ v: DragonBoxView) -> DumpJsonObject {
  if let g = v.dragonGroup {
    let head: [DumpJson] = [.number(Double(v.alpha)), .number(Double(g.dragonAlpha8)), g.dragonBackdrop.map { DumpJson.string($0) } ?? .null]
    if g.dragonFilter.isEmpty { return [("dragonGroup", .array(head))] }
    return [("dragonFilterGroup", .array(head + g.dragonFilter.map { DumpJson.number($0) }))]
  }
  if v.dragonNestedGroup { return [("dragonNestedGroup", .array([.number(Double(v.alpha)), .number(Double(v.dragonAlpha8))]))] }
  if v.dragonAlpha8 == 255 { return [] }
  return [("alpha", .number(Double(v.alpha)))]
}

// ---------------------------------------------------------------- pre-composited groups (PNT1-opacity-b)

/// The live overlays and how deep a composite is running (a composite's own changes mark nothing stale).
public enum DragonGroups {
  public static let all = NSHashTable<DragonGroupView>.weakObjects()
  public static var computing = 0
}

/// A box's layout or paint changed: every overlay's composite is stale (DragonBoxView.setNeedsDisplay calls this).
public func dragonGroupsChanged() {
  if DragonGroups.computing > 0 { return }
  for g in DragonGroups.all.allObjects { g.dragonMarkDirty() }
}

/// The group write of a box (runtime writer): the computed opacity, its backdrop box (nil for the canvas) and the painters before it
/// there in paint order. The view keeps alpha 1; the overlay shows Chrome's composite.
public func dragonSetOpacityGroup(_ t: DragonTree, _ v: DragonBoxView, _ opacity: Double, _ backdrop: String?, _ painters: [String]) {
  if !(opacity > 0 && opacity < 1) { fatalError("dragon: \(v.dragonId): group opacity \(opacity) is not in (0, 1)") }
  let raw: Double
  do { raw = try paint_opacityAlpha8(opacity) } catch { fatalError("dragon: \(v.dragonId): paint_opacityAlpha8 failed: \(error)") }
  let alpha8 = dragonCheckedInt(raw, "\(v.dragonId) alpha byte")
  v.dragonAlpha8 = alpha8
  v.dragonOpacity = opacity
  v.alpha = 1
  if v.dragonGroup != nil { fatalError("dragon: \(v.dragonId): a second group write") }
  let g = DragonGroupView(tree: t, group: v, alpha8: dragonAlphaPlantIgnored ? 255 : alpha8, backdrop: backdrop, painters: painters)
  v.dragonGroup = g
  v.dragonContainer.addSubview(g)
}

/// PNT1-filter: the group write of a box with a colour-matrix filter (runtime writer): its computed opacity (1 for none), the
/// filter as (code, amount) pairs, its backdrop box and painters. The overlay applies the filter to the layer, then the opacity.
public func dragonSetFilterGroup(_ t: DragonTree, _ v: DragonBoxView, _ opacity: Double, _ filter: [Double], _ backdrop: String?, _ painters: [String]) {
  if !(opacity > 0 && opacity <= 1) { fatalError("dragon: \(v.dragonId): filter group opacity \(opacity) is not in (0, 1]") }
  if filter.isEmpty { fatalError("dragon: \(v.dragonId): a filter group with no filter function") }
  let raw: Double
  do { raw = try paint_opacityAlpha8(opacity) } catch { fatalError("dragon: \(v.dragonId): paint_opacityAlpha8 failed: \(error)") }
  let alpha8 = dragonCheckedInt(raw, "\(v.dragonId) alpha byte")
  let matrices: JsArray<Double>
  do { matrices = try paintGroup_groupFilterMatrices(JsArray(filter)) } catch { fatalError("dragon: \(v.dragonId): paintGroup_groupFilterMatrices failed: \(error)") }
  v.dragonAlpha8 = alpha8
  v.dragonOpacity = opacity
  v.alpha = 1
  if v.dragonGroup != nil { fatalError("dragon: \(v.dragonId): a second group write") }
  let g = DragonGroupView(tree: t, group: v, alpha8: dragonAlphaPlantIgnored ? 255 : alpha8, backdrop: backdrop, painters: painters, filter: filter, matrices: matrices)
  v.dragonGroup = g
  v.dragonContainer.addSubview(g)
}

/// S2: the write of a group nested in a pre-composited group (runtime writer): its computed opacity. The view keeps alpha 1; the
/// outer group's overlay composites it into the outer group's layer in software.
public func dragonSetNestedGroup(_ v: DragonBoxView, _ opacity: Double) {
  if !(opacity > 0 && opacity < 1) { fatalError("dragon: \(v.dragonId): nested group opacity \(opacity) is not in (0, 1)") }
  let raw: Double
  do { raw = try paint_opacityAlpha8(opacity) } catch { fatalError("dragon: \(v.dragonId): paint_opacityAlpha8 failed: \(error)") }
  v.dragonAlpha8 = dragonCheckedInt(raw, "\(v.dragonId) alpha byte")
  v.dragonOpacity = opacity
  v.dragonNestedGroup = true
  v.alpha = 1
}

/// The shown border sides of a box: a width above 0 and a style that draws.
func dragonGroupSides(_ b: DragonBoxView) -> [Bool] {
  return (0..<4).map { b.dragonShape.borders[$0] > 0 && b.dragonBorderStyles[$0] != "none" && b.dragonBorderStyles[$0] != "hidden" }
}

/// S2: whether a box paints a translucent colour (a background or a shown side of alpha 1 to 254).
func dragonGroupTranslucent(_ b: DragonBoxView) -> Bool {
  let c = b.dragonBackgroundColor
  if c.a > 0 && c.a < 255 { return true }
  let shown = dragonGroupSides(b)
  return (0..<4).contains { shown[$0] && b.dragonBorderColors[$0].a > 0 && b.dragonBorderColors[$0].a < 255 }
}

/// S2: the frame a group's software layer is built in: the root, the extent in root device px and its size, the device scale,
/// the sRGB space and the cc tiles.
struct DragonGroupFrame {
  let root: UIView
  let ext: [Int]
  let w: Int
  let h: Int
  let s: Double
  let space: CGColorSpace
  let tileSize: Double
  let originX: Double
}

/// A device px rect [left, top, right, bottom] of a view's layout rect in root's coordinates; its edges are whole device px.
func dragonGroupEdges(_ r: CGRect, _ s: Double) -> [Int] {
  return [Double(r.minX) * s, Double(r.minY) * s, Double(r.maxX) * s, Double(r.maxY) * s].map { Int(dragonWholeDevicePx($0, "a group view edge")) }
}

/// A fractional rect (a text view's glyph ink) widened to whole device px, the pixels it can touch.
func dragonGroupOuterEdges(_ r: CGRect, _ s: Double) -> [Int] {
  let l = (Double(r.minX) * s).rounded(.down), t = (Double(r.minY) * s).rounded(.down)
  let rr = (Double(r.maxX) * s).rounded(.up), b = (Double(r.maxY) * s).rounded(.up)
  return [Int(l), Int(t), Int(rr), Int(b)]
}

/// The draw ops of a group member box's display item (Blink box_border_painter.cc PaintBorderFastPath): its background fill, then
/// one op for four solid sides in one colour (the compiler admits no other border in a group) or one FillRect per side.
func dragonGroupBoxOps(_ fillsBg: Bool, _ sides: Int) -> Int {
  return (fillsBg ? 1 : 0) + (sides == 4 ? 1 : sides)
}

/// A text line's glyph ink in root device px [left, top, right, bottom], bounded as DragonTextView.dragonInkFrame bounds it (the
/// font's bounding box at the first and last glyph origins, sheared, and grown by the fake-bold stroke's miter reach), at whole
/// device px; ox, oy is the text view's origin in root device px. Nil for a line with no glyphs.
func dragonGroupLineInk(_ tv: DragonTextView, _ font: UIFont, _ l: DragonLineSpec, _ ox: Double, _ oy: Double, _ s: Double) -> [Double]? {
  let upright = CTFontGetBoundingBox(font as CTFont)
  let k = tv.dragonGlyphShear
  let minY = Double(upright.minY), maxY = Double(upright.maxY)
  let left = Double(upright.minX) + min(k * minY, k * maxY)
  let right = Double(upright.maxX) + max(k * minY, k * maxY)
  let base = oy + l.baseline + dragonGlyphPlantYDevicePx
  var out: [Double]? = nil
  // em scales the font's box (in points) to device px at the run's size.
  func ink(_ xs: [Double], _ em: Double, _ sizeDevicePx: Double) {
    guard let lo = xs.min(), let hi = xs.max() else { return }
    let h = 2 * tv.dragonBoldStroke(sizeDevicePx)
    let r = [ox + lo + dragonGlyphPlantDevicePx + left * em - h, base - maxY * em - h, ox + hi + dragonGlyphPlantDevicePx + right * em + h, base - minY * em + h]
    if let o = out { out = [min(o[0], r[0]), min(o[1], r[1]), max(o[2], r[2]), max(o[3], r[3])] } else { out = r }
  }
  ink(l.xs, s, Double(font.pointSize) * s)
  ink(l.ellipsisXs, l.ellipsisSize / Double(font.pointSize), l.ellipsisSize)
  guard let o = out else { return nil }
  return [o[0].rounded(.down), o[1].rounded(.down), o[2].rounded(.up), o[3].rounded(.up)]
}

/// Every layer's pending drawing done, so render(in:) sees this frame's contents.
func dragonDisplayTree(_ l: CALayer) {
  l.displayIfNeeded()
  for s in l.sublayers ?? [] { dragonDisplayTree(s) }
}

/// A pre-composited group's overlay: the last child of the group's view, showing the composite Q in a bitmap sublayer placed at
/// the group's extent, which may reach outside the group's box.
public final class DragonGroupView: UIView {
  public weak var dragonTree: DragonTree?
  public weak var dragonGroupBox: DragonBoxView?
  public let dragonAlpha8: Int
  public let dragonBackdrop: String?
  public let dragonPainters: [String]
  /// PNT1-filter: the group's colour-matrix filter as (code, amount) pairs, and its matrices; empty and nil for an opacity group.
  public let dragonFilter: [Double]
  let dragonMatrices: JsArray<Double>?
  public let bitmapLayer = CALayer()
  var dragonDirty = true
  /// The last composite, premultiplied sRGB RGBA8, and its rect [left, top, right, bottom] in page device px.
  public private(set) var dragonQ: [UInt8] = []
  public private(set) var dragonQRect: [Int] = [0, 0, 0, 0]
  public init(tree: DragonTree, group: DragonBoxView, alpha8: Int, backdrop: String?, painters: [String], filter: [Double] = [], matrices: JsArray<Double>? = nil) {
    dragonTree = tree
    dragonGroupBox = group
    dragonAlpha8 = alpha8
    dragonBackdrop = backdrop
    dragonPainters = painters
    dragonFilter = filter
    dragonMatrices = matrices
    super.init(frame: .zero)
    isOpaque = false
    backgroundColor = nil
    clipsToBounds = false
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    bitmapLayer.magnificationFilter = .nearest
    bitmapLayer.minificationFilter = .nearest
    bitmapLayer.actions = ["bounds": NSNull(), "position": NSNull(), "frame": NSNull(), "contents": NSNull()]
    layer.addSublayer(bitmapLayer)
    DragonGroups.all.add(self)
  }
  required init?(coder: NSCoder) { fatalError("DragonGroupView is built in code") }

  func dragonMarkDirty() {
    dragonDirty = true
    setNeedsLayout()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    dragonComputeIfNeeded()
  }

  /// Recomputes Q when stale (an earlier group's Q is computed first when this one's backdrop needs it).
  public func dragonComputeIfNeeded() {
    if !dragonDirty { return }
    guard let g = dragonGroupBox, let t = dragonTree, let host = superview else { return }
    dragonDirty = false
    DragonGroups.computing += 1
    defer { DragonGroups.computing -= 1 }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    if host.subviews.last !== self { host.bringSubviewToFront(self) }
    let s = g.dragonScale
    let root = t.root
    // The extent: the group's box and every view inside it (a text view's glyph ink), clamped to the root.
    var ext = dragonGroupEdges(dragonLayoutRect(g, in: root), s)
    var texts: [DragonTextView] = []
    var boxes: [DragonBoxView] = [g]
    func grow(_ v: UIView) {
      for c in v.subviews where c !== self {
        let e: [Int]
        if let tv = c as? DragonTextView {
          tv.layoutIfNeeded()
          texts.append(tv)
          let r = dragonLayoutRect(tv, in: root)
          let ink = tv.dragonInkFrame()
          e = dragonGroupOuterEdges(CGRect(x: r.minX + ink.minX, y: r.minY + ink.minY, width: ink.width, height: ink.height), s)
        } else {
          e = dragonGroupEdges(dragonLayoutRect(c, in: root), s)
          if let b = c as? DragonBoxView { boxes.append(b) }
        }
        ext = [min(ext[0], e[0]), min(ext[1], e[1]), max(ext[2], e[2]), max(ext[3], e[3])]
        grow(c)
      }
    }
    grow(g)
    let rootEdges = dragonGroupEdges(root.bounds, s)
    ext = [max(ext[0], rootEdges[0]), max(ext[1], rootEdges[1]), min(ext[2], rootEdges[2]), min(ext[3], rootEdges[3])]
    let w = ext[2] - ext[0]
    let h = ext[3] - ext[1]
    frame = host.bounds
    if w <= 0 || h <= 0 {
      dragonQ = []
      dragonQRect = [0, 0, 0, 0]
      bitmapLayer.contents = nil
      return
    }
    guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { fatalError("dragon: no sRGB colour space") }
    // S2: a group holding translucent paint or a nested group has its layer built in software (dragonSoftwareGroup).
    let software = dragonGroupTranslucent(g) || dragonNeedsSoftware(g)
    // The group's layer: the platform's rendering of the group's view and its subtree at the device scale, this overlay hidden.
    let gr = dragonLayoutRect(g, in: root)
    var lp = [UInt8](repeating: 0, count: w * h * 4)
    isHidden = true
    dragonDisplayTree(g.layer)
    if !software { lp.withUnsafeMutableBytes { raw in
      guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fatalError("dragon: no RGBA8 context for a group") }
      ctx.interpolationQuality = .none
      ctx.translateBy(x: 0, y: CGFloat(h))
      ctx.scaleBy(x: CGFloat(s), y: -CGFloat(s))
      ctx.translateBy(x: gr.minX - CGFloat(Double(ext[0]) / s), y: gr.minY - CGFloat(Double(ext[1]) / s))
      g.layer.render(in: ctx)
    } }
    isHidden = false
    // The backdrop: the white canvas, then each painter before the group in its backdrop box, in paint order.
    var bp = [UInt8](repeating: 255, count: w * h * 4)
    func fill(_ l: Int, _ tp: Int, _ r: Int, _ b: Int, _ c: DragonRGBA8) {
      let x0 = max(l, ext[0]), y0 = max(tp, ext[1]), x1 = min(r, ext[2]), y1 = min(b, ext[3])
      if x0 >= x1 || y0 >= y1 { return }
      for y in y0..<y1 {
        var i = ((y - ext[1]) * w + (x0 - ext[0])) * 4
        for _ in x0..<x1 {
          bp[i] = UInt8(c.r); bp[i + 1] = UInt8(c.g); bp[i + 2] = UInt8(c.b); bp[i + 3] = 255
          i += 4
        }
      }
    }
    for id in dragonPainters {
      guard let p = t.node(id) as? DragonBoxView else { fatalError("dragon: \(g.dragonId): backdrop painter \(id) is not a built box") }
      if let pg = p.dragonGroup {
        pg.dragonComputeIfNeeded()
        let q = pg.dragonQRect
        let qw = q[2] - q[0]
        let x0 = max(q[0], ext[0]), y0 = max(q[1], ext[1]), x1 = min(q[2], ext[2]), y1 = min(q[3], ext[3])
        if x0 >= x1 || y0 >= y1 { continue }
        for y in y0..<y1 {
          for x in x0..<x1 {
            let i = ((y - ext[1]) * w + (x - ext[0])) * 4
            let j = ((y - q[1]) * qw + (x - q[0])) * 4
            for k in 0..<4 { bp[i + k] = pg.dragonQ[j + k] }
          }
        }
        continue
      }
      if !p.dragonVisible { continue }
      let e = p.dragonShape.edges.map { dragonCheckedInt($0, "\(id) backdrop edge") }
      let c = p.dragonBackgroundColor
      if c.a == 255 { fill(e[0], e[1], e[2], e[3], c) } else if c.a != 0 { fatalError("dragon: \(id): a translucent backdrop fill, which the compiler refuses under a group") }
      let bw = p.dragonShape.borders.map { dragonCheckedInt($0, "\(id) backdrop border") }
      for k in 0..<4 where bw[k] > 0 && p.dragonBorderStyles[k] != "none" && p.dragonBorderStyles[k] != "hidden" {
        let bc = p.dragonBorderColors[k]
        if p.dragonBorderStyles[k] != "solid" || (bc.a != 0 && bc.a != 255) { fatalError("dragon: \(id): a backdrop border side that is not solid and opaque, which the compiler refuses under a group") }
        if bc.a == 0 { continue }
        switch k {
        case 0: fill(e[0], e[1], e[2], e[1] + bw[0], bc)
        case 1: fill(e[2] - bw[1], e[1], e[2], e[3], bc)
        case 2: fill(e[0], e[3] - bw[2], e[2], e[3], bc)
        default: fill(e[0], e[1], e[0] + bw[3], e[3], bc)
        }
      }
    }
    let tileSize: Double
    do { tileSize = try paintGroup_groupTileSize(s) } catch { fatalError("dragon: \(g.dragonId): paint-group tile size failed: \(error)") }
    // The root layer's tiles start at the root scroller's origin (BG2 R4).
    let originX = g.dragonShape.rootX / units_LU_PER_PX
    var q: [UInt8]
    if software {
      q = bp
      let f = DragonGroupFrame(root: root, ext: ext, w: w, h: h, s: s, space: space, tileSize: tileSize, originX: originX)
      dragonSoftwareGroup(&q, g, f, dragonAlpha8, dragonAlphaPlantIgnored ? 1 : g.dragonOpacity, dragonMatrices)
    } else {
    // The group's display items for the per-tile fold: each painting box (it folds when it is one draw op: dragonGroupBoxOps) and
    // each text line's ink (a DrawTextBlob, which cc never folds).
    var draws: [Double] = []
    for b in boxes where b.dragonVisible {
      let fillsBg = b.dragonBackgroundColor.a > 0
      let sides = (0..<4).filter { b.dragonShape.borders[$0] > 0 && b.dragonBorderStyles[$0] != "none" && b.dragonBorderStyles[$0] != "hidden" }.count
      let ops = dragonGroupBoxOps(fillsBg, sides)
      if ops == 0 { continue }
      draws += b.dragonShape.edges + [ops == 1 ? 1 : 0]
    }
    for tv in texts where !tv.isHidden {
      guard let font = tv.dragonFont else { continue }
      let r = dragonLayoutRect(tv, in: root)
      // A text item's visual rect is its ink overflow, which always holds the fragment's run box (Blink ink_overflow.cc clamps the
      // outsets to zero or more), so cc's rtree puts it in every tile the run box touches: the fold item is the ink with the run box.
      let ascent = Double(CTFontGetAscent(font as CTFont)) * s
      let descent = Double(CTFontGetDescent(font as CTFont)) * s
      for l in tv.specs where !l.glyphs.isEmpty {
        guard let ink = dragonGroupLineInk(tv, font, l, Double(r.minX) * s, Double(r.minY) * s, s) else { continue }
        let x0 = Double(r.minX) * s + l.xLU / units_LU_PER_PX
        let base = Double(r.minY) * s + l.baseline
        draws += [min(ink[0], x0.rounded(.down)), min(ink[1], (base - ascent).rounded(.down)), max(ink[2], (x0 + l.widthLU / units_LU_PER_PX).rounded(.up)), max(ink[3], (base + descent).rounded(.up)), 0]
      }
    }
    let jsDraws = JsArray(draws)
    var foldCache: [Int: Bool] = [:]
    func folds(_ x: Int, _ y: Int) -> Bool {
      do {
        let ix = try paintGroup_groupTileIndex(Double(x) - originX, tileSize)
        let iy = try paintGroup_groupTileIndex(Double(y), tileSize)
        let key = dragonCheckedInt(ix, "group tile x") * 65536 + dragonCheckedInt(iy, "group tile y")
        if let f = foldCache[key] { return f }
        let sx = try paintGroup_groupTileSpan(ix, tileSize).items
        let sy = try paintGroup_groupTileSpan(iy, tileSize).items
        let f = try paintGroup_groupTileFolds(jsDraws, sx[0] + originX, sy[0], sx[1] + originX, sy[1])
        foldCache[key] = f
        return f
      } catch { fatalError("dragon: \(g.dragonId): paint-group tiles failed: \(error)") }
    }
    q = [UInt8](repeating: 0, count: w * h * 4)
    let a8 = Double(dragonAlpha8)
    do {
      for y in 0..<h {
        for x in 0..<w {
          let i = (y * w + x) * 4
          let packed: Double
          if let m = dragonMatrices {
            packed = try paintGroup_groupFilterComposite(Double(lp[i]), Double(lp[i + 1]), Double(lp[i + 2]), Double(lp[i + 3]), Double(bp[i]), Double(bp[i + 1]), Double(bp[i + 2]), Double(bp[i + 3]), m, a8)
          } else {
            packed = try paintGroup_groupComposite(Double(lp[i]), Double(lp[i + 1]), Double(lp[i + 2]), Double(lp[i + 3]), Double(bp[i]), Double(bp[i + 1]), Double(bp[i + 2]), Double(bp[i + 3]), a8, folds(ext[0] + x, ext[1] + y))
          }
          let v = Int(packed)
          q[i] = UInt8(v & 0xff); q[i + 1] = UInt8((v >> 8) & 0xff); q[i + 2] = UInt8((v >> 16) & 0xff); q[i + 3] = UInt8((v >> 24) & 0xff)
        }
      }
    } catch { fatalError("dragon: \(g.dragonId): paint-group composite failed: \(error)") }
    }
    dragonQ = q
    dragonQRect = ext
    guard let provider = CGDataProvider(data: Data(q) as CFData) else { fatalError("dragon: no data provider for a group") }
    bitmapLayer.contents = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4, space: space, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    bitmapLayer.contentsScale = CGFloat(s)
    let hr = dragonLayoutRect(host, in: root)
    bitmapLayer.frame = CGRect(x: CGFloat(Double(ext[0]) / s) - hr.minX, y: CGFloat(Double(ext[1]) / s) - hr.minY, width: CGFloat(Double(w) / s), height: CGFloat(Double(h) / s))
  }

  // ---------------------------------------------------------------- S2: the layer built in software

  /// Whether a view's subtree holds a nested group or translucent paint, so the group's layer is built in software.
  func dragonNeedsSoftware(_ v: UIView) -> Bool {
    for c in v.subviews where c !== self {
      if let b = c as? DragonBoxView, b.dragonNestedGroup || dragonGroupTranslucent(b) { return true }
      if dragonNeedsSoftware(c) { return true }
    }
    return false
  }

  /// One solid colour blitted at full coverage onto pixel i of a layer (paint-group.ts groupFill).
  func dragonSoftwareBlend(_ buf: inout [UInt8], _ i: Int, _ c: DragonRGBA8, _ alpha: Double) {
    let packed: Double
    do { packed = try paintGroup_groupFill(Double(buf[i]), Double(buf[i + 1]), Double(buf[i + 2]), Double(buf[i + 3]), Double(c.r), Double(c.g), Double(c.b), alpha) } catch { fatalError("dragon: paint-group fill failed: \(error)") }
    let v = Int(packed)
    buf[i] = UInt8(v & 0xff); buf[i + 1] = UInt8((v >> 8) & 0xff); buf[i + 2] = UInt8((v >> 16) & 0xff); buf[i + 3] = UInt8((v >> 24) & 0xff)
  }

  /// A box's own paint into a layer: its background over the border box, then its solid sides, each pixel once (one op of one
  /// colour: the compiler admits translucent sides only on all four sides or one, in one colour).
  func dragonSoftwareBox(_ buf: inout [UInt8], _ b: DragonBoxView, _ f: DragonGroupFrame) {
    if !b.dragonVisible { return }
    let e = b.dragonShape.edges.map { dragonCheckedInt($0, "\(b.dragonId) group edge") }
    let bw = b.dragonShape.borders.map { dragonCheckedInt($0, "\(b.dragonId) group border") }
    let shown = dragonGroupSides(b)
    for k in 0..<4 where shown[k] && b.dragonBorderStyles[k] != "solid" { fatalError("dragon: \(b.dragonId): a group border side that is not solid, which the compiler refuses") }
    let x0 = max(e[0], f.ext[0]), y0 = max(e[1], f.ext[1]), x1 = min(e[2], f.ext[2]), y1 = min(e[3], f.ext[3])
    if x0 >= x1 || y0 >= y1 { return }
    let c = b.dragonBackgroundColor
    for y in y0..<y1 {
      for x in x0..<x1 {
        let i = ((y - f.ext[1]) * f.w + (x - f.ext[0])) * 4
        if c.a > 0 { dragonSoftwareBlend(&buf, i, c, Double(c.a)) }
        var side = -1
        if shown[0] && y < e[1] + bw[0] { side = 0 } else if shown[1] && x >= e[2] - bw[1] { side = 1 } else if shown[2] && y >= e[3] - bw[2] { side = 2 } else if shown[3] && x < e[0] + bw[3] { side = 3 }
        if side >= 0 && b.dragonBorderColors[side].a > 0 { dragonSoftwareBlend(&buf, i, b.dragonBorderColors[side], Double(b.dragonBorderColors[side].a)) }
      }
    }
  }

  /// A text view drawn by the platform into a layer, over what the layer holds, as the platform draws it in the group's render.
  func dragonSoftwareText(_ buf: inout [UInt8], _ tv: DragonTextView, _ f: DragonGroupFrame) {
    let r = dragonLayoutRect(tv, in: f.root)
    buf.withUnsafeMutableBytes { raw in
      guard let ctx = CGContext(data: raw.baseAddress, width: f.w, height: f.h, bitsPerComponent: 8, bytesPerRow: f.w * 4, space: f.space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fatalError("dragon: no RGBA8 context for a group's text") }
      ctx.interpolationQuality = .none
      ctx.translateBy(x: 0, y: CGFloat(f.h))
      ctx.scaleBy(x: CGFloat(f.s), y: -CGFloat(f.s))
      ctx.translateBy(x: r.minX - CGFloat(Double(f.ext[0]) / f.s), y: r.minY - CGFloat(Double(f.ext[1]) / f.s))
      tv.layer.render(in: ctx)
    }
  }

  /// A view's children painted into a layer in paint order (the view order): boxes and their subtrees, nested groups composited.
  func dragonSoftwareChildren(_ buf: inout [UInt8], _ v: UIView, _ f: DragonGroupFrame) {
    for c in v.subviews where c !== self && !(c is DragonGroupView) && !c.isHidden {
      if let tv = c as? DragonTextView {
        dragonSoftwareText(&buf, tv, f)
      } else if let b = c as? DragonBoxView {
        if b.dragonNestedGroup {
          dragonSoftwareGroup(&buf, b, f, dragonAlphaPlantIgnored ? 255 : b.dragonAlpha8, dragonAlphaPlantIgnored ? 1 : b.dragonOpacity, nil)
        } else {
          dragonSoftwareBox(&buf, b, f)
          dragonSoftwareChildren(&buf, b, f)
        }
      } else {
        dragonSoftwareChildren(&buf, c, f)
      }
    }
  }

  /// A group's display items for its per-tile fold (paint-group.ts groupTileFoldIndex), with each item's one colour: its painting
  /// boxes (a box of one op folds), its text lines' ink, and every item of a group nested in it, which never folds this group.
  func dragonSoftwareDraws(_ v: UIView, _ nested: Bool, _ f: DragonGroupFrame, _ draws: inout [Double], _ colours: inout [DragonRGBA8]) {
    if let b = v as? DragonBoxView, b.dragonVisible {
      let shown = dragonGroupSides(b)
      let sides = shown.filter { $0 }.count
      let fillsBg = b.dragonBackgroundColor.a > 0
      let ops = dragonGroupBoxOps(fillsBg, sides)
      if ops > 0 {
        draws += b.dragonShape.edges + [ops == 1 && !nested ? 1 : 0]
        colours.append(fillsBg ? b.dragonBackgroundColor : b.dragonBorderColors[shown.firstIndex(of: true) ?? 0])
      }
    }
    for c in v.subviews where c !== self && !(c is DragonGroupView) && !c.isHidden {
      if let tv = c as? DragonTextView {
        guard let font = tv.dragonFont else { continue }
        let r = dragonLayoutRect(tv, in: f.root)
        for l in tv.specs where !l.glyphs.isEmpty {
          if let ink = dragonGroupLineInk(tv, font, l, Double(r.minX) * f.s, Double(r.minY) * f.s, f.s) {
            draws += ink + [0]
            colours.append(tv.dragonColor)
          }
        }
      } else {
        dragonSoftwareDraws(c, nested || ((c as? DragonBoxView)?.dragonNestedGroup ?? false), f, &draws, &colours)
      }
    }
  }

  /// Group b composited onto dst (premultiplied RGBA8 over the extent) as Chrome's raster does: its layer built from its draw list,
  /// then, per cc raster tile, its one op drawn at the folded alpha (groupFoldAlpha, groupFill) or the layer blitted at its alpha
  /// byte (groupComposite); with a colour-matrix filter, the filter and then the alpha (groupFilterComposite), never folded.
  func dragonSoftwareGroup(_ dst: inout [UInt8], _ b: DragonBoxView, _ f: DragonGroupFrame, _ alpha8: Int, _ opacity: Double, _ matrices: JsArray<Double>?) {
    var l = [UInt8](repeating: 0, count: f.w * f.h * 4)
    dragonSoftwareBox(&l, b, f)
    dragonSoftwareChildren(&l, b, f)
    var draws: [Double] = []
    var colours: [DragonRGBA8] = []
    dragonSoftwareDraws(b, false, f, &draws, &colours)
    let jsDraws = JsArray(draws)
    var foldCache: [Int: Int] = [:]
    let a8 = Double(alpha8)
    do {
      func foldIndex(_ x: Int, _ y: Int) throws -> Int {
        let ix = try paintGroup_groupTileIndex(Double(x) - f.originX, f.tileSize)
        let iy = try paintGroup_groupTileIndex(Double(y), f.tileSize)
        let key = dragonCheckedInt(ix, "group tile x") * 65536 + dragonCheckedInt(iy, "group tile y")
        if let k = foldCache[key] { return k }
        let sx = try paintGroup_groupTileSpan(ix, f.tileSize).items
        let sy = try paintGroup_groupTileSpan(iy, f.tileSize).items
        let raw = try paintGroup_groupTileFoldIndex(jsDraws, sx[0] + f.originX, sy[0], sx[1] + f.originX, sy[1])
        let k = dragonCheckedInt(raw, "group fold item")
        foldCache[key] = k
        return k
      }
      for y in 0..<f.h {
        for x in 0..<f.w {
          let i = (y * f.w + x) * 4
          let packed: Double
          if let m = matrices {
            packed = try paintGroup_groupFilterComposite(Double(l[i]), Double(l[i + 1]), Double(l[i + 2]), Double(l[i + 3]), Double(dst[i]), Double(dst[i + 1]), Double(dst[i + 2]), Double(dst[i + 3]), m, a8)
          } else {
            let k = try foldIndex(f.ext[0] + x, f.ext[1] + y)
            if k >= 0 {
              // The tile's one op: where the layer is clear it drew nothing.
              if l[i + 3] == 0 { continue }
              let c = colours[k]
              let fa = try paintGroup_groupFoldAlpha(Double(c.a), opacity)
              packed = try paintGroup_groupFill(Double(dst[i]), Double(dst[i + 1]), Double(dst[i + 2]), Double(dst[i + 3]), Double(c.r), Double(c.g), Double(c.b), fa)
            } else {
              packed = try paintGroup_groupComposite(Double(l[i]), Double(l[i + 1]), Double(l[i + 2]), Double(l[i + 3]), Double(dst[i]), Double(dst[i + 1]), Double(dst[i + 2]), Double(dst[i + 3]), a8, false)
            }
          }
          let v = Int(packed)
          dst[i] = UInt8(v & 0xff); dst[i + 1] = UInt8((v >> 8) & 0xff); dst[i + 2] = UInt8((v >> 16) & 0xff); dst[i + 3] = UInt8((v >> 24) & 0xff)
        }
      }
    } catch { fatalError("dragon: \(b.dragonId): paint-group software composite failed: \(error)") }
  }
}
`;

const KOTLIN_MEMBERS = String.raw`  /** Chrome's paint alpha byte of the box's opacity; 255 is opaque. */
  var dragonAlpha8 = 255
  /** PNT1-opacity-b: the overlay showing this pre-composited group's composite; null for a box that is no such group. */
  var dragonGroup: DragonGroupView? = null
  /** S2: a group nested in a pre-composited group, which that group's overlay composites in software; and the computed opacity. */
  var dragonNestedGroup = false
  var dragonOpacity = 1.0
  /** The device scale of the last layout (the group composite's cc tile size depends on it). */
  var dragonEffectsScale = 1.0
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.text.TextPaint
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import dev.dragon.dump.DumpJson
import dev.dragon.layout.JsArray
import dev.dragon.layout.paintGroup_groupComposite
import dev.dragon.layout.paintGroup_groupFill
import dev.dragon.layout.paintGroup_groupFilterComposite
import dev.dragon.layout.paintGroup_groupFilterMatrices
import dev.dragon.layout.paintGroup_groupFoldAlpha
import dev.dragon.layout.paintGroup_groupTileFoldIndex
import dev.dragon.layout.paintGroup_groupTileFolds
import dev.dragon.layout.paintGroup_groupTileIndex
import dev.dragon.layout.paintGroup_groupTileSize
import dev.dragon.layout.paintGroup_groupTileSpan
import dev.dragon.layout.paint_opacityAlpha8
import dev.dragon.layout.units_LU_PER_PX
import java.nio.ByteBuffer

/** Whether the opacity writer ignores the alpha; false except in the alpha-ignored plant build. */
const val DRAGON_ALPHA_PLANT_IGNORED = false

/** The opacity write of a box (runtime writer): the computed opacity, shown as View.setAlpha(Chrome's alpha byte / 255f) (group opacity). */
fun dragonSetOpacity(v: DragonBoxView, opacity: Double) {
  if (!(opacity >= 0.0 && opacity <= 1.0)) throw IllegalStateException("dragon: " + v.dragonId + ": opacity " + opacity + " is not in [0, 1]")
  val alpha8 = dragonCheckedInt(paint_opacityAlpha8(opacity), v.dragonId + " alpha byte")
  v.dragonAlpha8 = alpha8
  if (DRAGON_ALPHA_PLANT_IGNORED) return
  v.alpha = alpha8 / 255f
}

/**
 * The readback of the effects module: the live alpha, when the box has an opacity below 1; for a pre-composited group, the live
 * alpha (1), the alpha byte its overlay composites with and its backdrop box.
 */
fun dragonAppliedEffects(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val g = v.dragonGroup
  if (g != null) {
    val head = listOf(DumpJson.Num(v.alpha.toDouble()), DumpJson.Num(g.dragonAlpha8.toDouble()), g.dragonBackdrop?.let { DumpJson.Str(it) } ?: DumpJson.Null)
    if (g.dragonFilter.isEmpty()) return listOf(Pair("dragonGroup", DumpJson.Arr(head)))
    return listOf(Pair("dragonFilterGroup", DumpJson.Arr(head + g.dragonFilter.map { DumpJson.Num(it) })))
  }
  if (v.dragonNestedGroup) return listOf(Pair("dragonNestedGroup", DumpJson.Arr(listOf(DumpJson.Num(v.alpha.toDouble()), DumpJson.Num(v.dragonAlpha8.toDouble())))))
  if (v.dragonAlpha8 == 255) return emptyList()
  return listOf(Pair("alpha", DumpJson.Num(v.alpha.toDouble())))
}

/** After every layout: the device scale, for a group's tiles. */
fun dragonAfterLayoutEffects(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  v.dragonEffectsScale = scale
}

// ---------------------------------------------------------------- pre-composited groups (PNT1-opacity-b)

/** The live overlays and how deep a composite is running (a composite's own changes mark nothing stale). */
object DragonGroups {
  val all = java.util.WeakHashMap<DragonGroupView, Boolean>()
  var computing = 0
}

/** A box's layout or paint changed: every overlay's composite is stale (DragonBoxView.invalidate calls this). */
fun dragonGroupsChanged() {
  if (DragonGroups.computing > 0) return
  for (g in DragonGroups.all.keys.toList()) g.dragonMarkDirty()
}

/**
 * The group write of a box (runtime writer): the computed opacity, its backdrop box (null for the canvas) and the painters before it
 * there in paint order. The view keeps alpha 1; the overlay shows Chrome's composite.
 */
fun dragonSetOpacityGroup(t: DragonTree, v: DragonBoxView, opacity: Double, backdrop: String?, painters: List<String>) {
  if (!(opacity > 0.0 && opacity < 1.0)) throw IllegalStateException("dragon: " + v.dragonId + ": group opacity " + opacity + " is not in (0, 1)")
  val alpha8 = dragonCheckedInt(paint_opacityAlpha8(opacity), v.dragonId + " alpha byte")
  v.dragonAlpha8 = alpha8
  v.dragonOpacity = opacity
  v.alpha = 1f
  if (v.dragonGroup != null) throw IllegalStateException("dragon: " + v.dragonId + ": a second group write")
  val g = DragonGroupView(v.context, t, v, if (DRAGON_ALPHA_PLANT_IGNORED) 255 else alpha8, backdrop, painters)
  v.dragonGroup = g
  v.dragonContainer.addView(g)
}

/**
 * PNT1-filter: the group write of a box with a colour-matrix filter (runtime writer): its computed opacity (1 for none), the filter
 * as (code, amount) pairs, its backdrop box and painters. The overlay applies the filter to the layer, then the opacity.
 */
fun dragonSetFilterGroup(t: DragonTree, v: DragonBoxView, opacity: Double, filter: List<Double>, backdrop: String?, painters: List<String>) {
  if (!(opacity > 0.0 && opacity <= 1.0)) throw IllegalStateException("dragon: " + v.dragonId + ": filter group opacity " + opacity + " is not in (0, 1]")
  if (filter.isEmpty()) throw IllegalStateException("dragon: " + v.dragonId + ": a filter group with no filter function")
  val alpha8 = dragonCheckedInt(paint_opacityAlpha8(opacity), v.dragonId + " alpha byte")
  val matrices = paintGroup_groupFilterMatrices(JsArray(filter))
  v.dragonAlpha8 = alpha8
  v.dragonOpacity = opacity
  v.alpha = 1f
  if (v.dragonGroup != null) throw IllegalStateException("dragon: " + v.dragonId + ": a second group write")
  val g = DragonGroupView(v.context, t, v, if (DRAGON_ALPHA_PLANT_IGNORED) 255 else alpha8, backdrop, painters, filter, matrices)
  v.dragonGroup = g
  v.dragonContainer.addView(g)
}

/**
 * S2: the write of a group nested in a pre-composited group (runtime writer): its computed opacity. The view keeps alpha 1; the
 * outer group's overlay composites it into the outer group's layer in software.
 */
fun dragonSetNestedGroup(v: DragonBoxView, opacity: Double) {
  if (!(opacity > 0.0 && opacity < 1.0)) throw IllegalStateException("dragon: " + v.dragonId + ": nested group opacity " + opacity + " is not in (0, 1)")
  v.dragonAlpha8 = dragonCheckedInt(paint_opacityAlpha8(opacity), v.dragonId + " alpha byte")
  v.dragonOpacity = opacity
  v.dragonNestedGroup = true
  v.alpha = 1f
}

/** The shown border sides of a box: a width above 0 and a style that draws. */
fun dragonGroupSides(b: DragonBoxView): BooleanArray = BooleanArray(4) { b.dragonShape.borders[it] > 0 && b.dragonBorderStyles[it] != "none" && b.dragonBorderStyles[it] != "hidden" }

/** S2: whether a box paints a translucent colour (a background or a shown side of alpha 1 to 254). */
fun dragonGroupTranslucent(b: DragonBoxView): Boolean {
  val c = b.dragonBackgroundColor
  if (c.a in 1..254) return true
  val shown = dragonGroupSides(b)
  return (0 until 4).any { shown[it] && b.dragonBorderColors[it].a in 1..254 }
}

/** S2: the frame a group's software layer is built in: the root, the extent in root device px and its size, and the cc tiles. */
class DragonGroupFrame(val root: View, val ext: IntArray, val w: Int, val h: Int, val tileSize: Double, val originX: Double)

/**
 * The draw ops of a group member box's display item (Blink box_border_painter.cc PaintBorderFastPath): its background fill, then
 * one op for four solid sides in one colour (the compiler admits no other border in a group) or one FillRect per side.
 */
fun dragonGroupBoxOps(fillsBg: Boolean, sides: Int): Int = (if (fillsBg) 1 else 0) + (if (sides == 4) 1 else sides)

/**
 * Each glyph line's ink in root device px (left, top, right, bottom) at whole device px, as the text view draws it: every glyph's
 * horizontal bounds at its origin (Font.getGlyphBounds, at the run's text size) and the font's vertical bounds (top, bottom), moved by
 * the synthetic oblique's skew (x - shear * y) and grown by the fake-bold stroke's miter reach (4 times half its width), as iOS's
 * dragonInkFrame bounds it; ox, oy is the text view's origin in root device px.
 */
fun dragonGroupLineInks(tv: DragonTextView, ox: Double, oy: Double): List<DoubleArray> {
  val f = tv.font ?: return emptyList()
  val out = ArrayList<DoubleArray>()
  val r = RectF()
  val sh = tv.dragonGlyphShear
  // One paint and one set of font metrics per text size.
  val paints = HashMap<Float, TextPaint>()
  val metrics = HashMap<Float, android.graphics.Paint.FontMetrics>()
  for (l in tv.specs) {
    if (l.glyphs.isEmpty()) continue
    val e = doubleArrayOf(Double.POSITIVE_INFINITY, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY)
    val base = oy + l.baseline + DRAGON_GLYPH_PLANT_Y_DEVICE_PX
    fun add(glyphs: IntArray, xs: DoubleArray, size: (Int) -> Float) {
      for (k in glyphs.indices) {
        val p = paints.getOrPut(size(k)) { TextPaint(tv.paint).also { it.textSize = size(k) } }
        val fm = metrics.getOrPut(p.textSize) { p.fontMetrics }
        val top = fm.top.toDouble()
        val bottom = fm.bottom.toDouble()
        val h = 2.0 * tv.dragonBoldStroke(p.textSize).toDouble()
        r.setEmpty()
        f.getGlyphBounds(glyphs[k], p, r)
        val x = ox + xs[k] + DRAGON_GLYPH_PLANT_DEVICE_PX
        e[0] = minOf(e[0], x + minOf(r.left.toDouble(), 0.0) + minOf(-sh * top, -sh * bottom) - h)
        e[1] = minOf(e[1], base + top - h)
        e[2] = maxOf(e[2], x + maxOf(r.right.toDouble(), 0.0) + maxOf(-sh * top, -sh * bottom) + h)
        e[3] = maxOf(e[3], base + bottom + h)
      }
    }
    add(l.glyphs, l.xs) { k -> if (l.sizes.isNotEmpty() && l.sizes[k] != 0.0) l.sizes[k].toFloat() else tv.paint.textSize }
    add(l.ellipsisGlyphs, l.ellipsisXs) { _ -> l.ellipsisSize.toFloat() }
    out.add(doubleArrayOf(kotlin.math.floor(e[0]), kotlin.math.floor(e[1]), kotlin.math.ceil(e[2]), kotlin.math.ceil(e[3])))
  }
  return out
}

/**
 * A pre-composited group's overlay: the last child of the group's view, framed at the group's extent (which may reach outside the
 * group's box), drawing the composite Q pixel for pixel. It draws nothing while the group is drawn into its layer.
 */
class DragonGroupView(ctx: Context, val dragonTree: DragonTree, val dragonGroupBox: DragonBoxView, val dragonAlpha8: Int, val dragonBackdrop: String?, val dragonPainters: List<String>, val dragonFilter: List<Double> = emptyList(), private val dragonMatrices: JsArray<Double>? = null) : View(ctx), ViewTreeObserver.OnPreDrawListener {
  /** This view's frame in the group's view: left, top, right, bottom in device px. */
  val dragonFrame = IntArray(4)
  var dragonDirty = true
  private var skipping = false
  private var bitmap: Bitmap? = null
  private val bitmapPaint = Paint().apply { isFilterBitmap = false; isDither = false; isAntiAlias = false }
  /** The last composite, premultiplied RGBA8, and its rect (left, top, right, bottom) in page device px. */
  var dragonQ = ByteArray(0)
    private set
  var dragonQRect = IntArray(4)
    private set
  init {
    isClickable = false
    isFocusable = false
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    setWillNotDraw(false)
    DragonGroups.all[this] = true
  }

  fun dragonMarkDirty() {
    dragonDirty = true
    invalidate()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnPreDrawListener(this)
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.removeOnPreDrawListener(this)
    super.onDetachedFromWindow()
  }

  /** Once per frame, after layout: recompute when stale; a frame that moved this view is drawn again with the new Q. */
  override fun onPreDraw(): Boolean {
    if (!dragonDirty) return true
    dragonComputeIfNeeded()
    return false
  }

  override fun draw(canvas: Canvas) {
    if (skipping) return
    super.draw(canvas)
  }

  override fun onDraw(canvas: Canvas) {
    val b = bitmap ?: return
    canvas.drawBitmap(b, 0f, 0f, bitmapPaint)
  }

  /** Recomputes Q when stale (an earlier group's Q is computed first when this one's backdrop needs it). */
  fun dragonComputeIfNeeded() {
    if (!dragonDirty) return
    val g = dragonGroupBox
    val t = dragonTree
    val host = parent as? ViewGroup ?: return
    dragonDirty = false
    DragonGroups.computing++
    try {
      dragonCompute(g, t, host)
    } finally {
      DragonGroups.computing--
    }
  }

  private fun dragonCompute(g: DragonBoxView, t: DragonTree, host: ViewGroup) {
    if (host.getChildAt(host.childCount - 1) !== this) host.bringChildToFront(this)
    val root = t.root
    val s = g.dragonEffectsScale
    fun edgesOf(v: View, l: Int, tp: Int, r: Int, b: Int): IntArray {
      val o = dragonLayoutOffset(v, root)
      return intArrayOf(o[0] + l, o[1] + tp, o[0] + r, o[1] + b)
    }
    // The extent: the group's box and every view inside it, clamped to the root.
    var ext = edgesOf(g, 0, 0, g.width, g.height)
    val texts = ArrayList<DragonTextView>()
    val boxes = arrayListOf(g)
    fun grow(v: ViewGroup) {
      for (i in 0 until v.childCount) {
        val c = v.getChildAt(i)
        if (c === this) continue
        val e = edgesOf(c, 0, 0, c.width, c.height)
        if (c is DragonTextView) texts.add(c)
        if (c is DragonBoxView) boxes.add(c)
        ext = intArrayOf(minOf(ext[0], e[0]), minOf(ext[1], e[1]), maxOf(ext[2], e[2]), maxOf(ext[3], e[3]))
        if (c is ViewGroup) grow(c)
      }
    }
    grow(g)
    // A text view draws its glyph ink past its frame: the extent takes each line's ink (dragonGroupLineInks) and 2 device px of
    // antialiasing, as iOS's dragonInkFrame does.
    val inks = HashMap<DragonTextView, List<DoubleArray>>()
    for (tv in texts) {
      val o = dragonLayoutOffset(tv, root)
      val lines = dragonGroupLineInks(tv, o[0].toDouble(), o[1].toDouble())
      inks[tv] = lines
      for (e in lines) ext = intArrayOf(minOf(ext[0], e[0].toInt() - 2), minOf(ext[1], e[1].toInt() - 2), maxOf(ext[2], e[2].toInt() + 2), maxOf(ext[3], e[3].toInt() + 2))
    }
    ext = intArrayOf(maxOf(ext[0], 0), maxOf(ext[1], 0), minOf(ext[2], root.width), minOf(ext[3], root.height))
    val w = ext[2] - ext[0]
    val h = ext[3] - ext[1]
    val ho = dragonLayoutOffset(host, root)
    dragonFrame[0] = ext[0] - ho[0]; dragonFrame[1] = ext[1] - ho[1]; dragonFrame[2] = ext[2] - ho[0]; dragonFrame[3] = ext[3] - ho[1]
    if (w <= 0 || h <= 0) {
      dragonQ = ByteArray(0)
      dragonQRect = IntArray(4)
      bitmap = null
      layout(dragonFrame[0], dragonFrame[1], dragonFrame[0], dragonFrame[1])
      invalidate()
      return
    }
    // S2: a group holding translucent paint or a nested group has its layer built in software (softwareGroup).
    val software = dragonGroupTranslucent(g) || needsSoftware(g)
    // The group's layer: the platform's rendering of the group's view and its subtree, this overlay skipped.
    val lp = ByteArray(w * h * 4)
    if (!software) {
      val layerBitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      val go = dragonLayoutOffset(g, root)
      val canvas = Canvas(layerBitmap)
      canvas.translate((go[0] - ext[0]).toFloat(), (go[1] - ext[1]).toFloat())
      skipping = true
      try { g.draw(canvas) } finally { skipping = false }
      layerBitmap.copyPixelsToBuffer(ByteBuffer.wrap(lp))
    }
    // The backdrop: the white canvas, then each painter before the group in its backdrop box, in paint order.
    val bp = ByteArray(w * h * 4) { 255.toByte() }
    fun fill(l: Int, tp: Int, r: Int, b: Int, c: DragonRGBA8) {
      val x0 = maxOf(l, ext[0]); val y0 = maxOf(tp, ext[1]); val x1 = minOf(r, ext[2]); val y1 = minOf(b, ext[3])
      for (y in y0 until y1) {
        var i = ((y - ext[1]) * w + (x0 - ext[0])) * 4
        for (x in x0 until x1) {
          bp[i] = c.r.toByte(); bp[i + 1] = c.g.toByte(); bp[i + 2] = c.b.toByte(); bp[i + 3] = 255.toByte()
          i += 4
        }
      }
    }
    for (id in dragonPainters) {
      val p = t.node(id) as? DragonBoxView ?: throw IllegalStateException("dragon: " + g.dragonId + ": backdrop painter " + id + " is not a built box")
      val pg = p.dragonGroup
      if (pg != null) {
        pg.dragonComputeIfNeeded()
        val q = pg.dragonQRect
        val qw = q[2] - q[0]
        for (y in maxOf(q[1], ext[1]) until minOf(q[3], ext[3])) {
          for (x in maxOf(q[0], ext[0]) until minOf(q[2], ext[2])) {
            val i = ((y - ext[1]) * w + (x - ext[0])) * 4
            val j = ((y - q[1]) * qw + (x - q[0])) * 4
            for (k in 0 until 4) bp[i + k] = pg.dragonQ[j + k]
          }
        }
        continue
      }
      if (!p.dragonVisible) continue
      val e = IntArray(4) { dragonCheckedInt(p.dragonShape.edges[it], id + " backdrop edge") }
      val c = p.dragonBackgroundColor
      if (c.a == 255) fill(e[0], e[1], e[2], e[3], c) else if (c.a != 0) throw IllegalStateException("dragon: " + id + ": a translucent backdrop fill, which the compiler refuses under a group")
      val bw = IntArray(4) { dragonCheckedInt(p.dragonShape.borders[it], id + " backdrop border") }
      for (k in 0 until 4) {
        val st = p.dragonBorderStyles[k]
        if (bw[k] <= 0 || st == "none" || st == "hidden") continue
        val bc = p.dragonBorderColors[k]
        if (st != "solid" || (bc.a != 0 && bc.a != 255)) throw IllegalStateException("dragon: " + id + ": a backdrop border side that is not solid and opaque, which the compiler refuses under a group")
        if (bc.a == 0) continue
        when (k) {
          0 -> fill(e[0], e[1], e[2], e[1] + bw[0], bc)
          1 -> fill(e[2] - bw[1], e[1], e[2], e[3], bc)
          2 -> fill(e[0], e[3] - bw[2], e[2], e[3], bc)
          else -> fill(e[0], e[1], e[0] + bw[3], e[3], bc)
        }
      }
    }
    val tileSize = paintGroup_groupTileSize(s)
    // The root layer's tiles start at the root scroller's origin (BG2 R4).
    val originX = g.dragonShape.rootX / units_LU_PER_PX
    val q: ByteArray
    if (software) {
      q = bp
      softwareGroup(q, g, DragonGroupFrame(root, ext, w, h, tileSize, originX), dragonAlpha8, if (DRAGON_ALPHA_PLANT_IGNORED) 1.0 else g.dragonOpacity, dragonMatrices)
    } else {
    // The group's display items for the per-tile fold: each painting box (it folds when it is one draw op: dragonGroupBoxOps) and
    // each text line's ink (a DrawTextBlob, which cc never folds).
    val draws = ArrayList<Double>()
    for (b in boxes) {
      if (!b.dragonVisible) continue
      val fillsBg = b.dragonBackgroundColor.a > 0
      val sides = (0 until 4).count { b.dragonShape.borders[it] > 0 && b.dragonBorderStyles[it] != "none" && b.dragonBorderStyles[it] != "hidden" }
      val ops = dragonGroupBoxOps(fillsBg, sides)
      if (ops == 0) continue
      for (k in 0 until 4) draws.add(b.dragonShape.edges[k])
      draws.add(if (ops == 1) 1.0 else 0.0)
    }
    // A text item's visual rect is its ink overflow, which always holds the fragment's run box (Blink ink_overflow.cc clamps the
    // outsets to zero or more), so cc's rtree puts it in every tile the run box touches: the fold item is the ink with the run box.
    for (tv in texts) {
      if (tv.visibility != View.VISIBLE) continue
      val o = dragonLayoutOffset(tv, root)
      val fm = tv.paint.fontMetrics
      val lines = tv.specs.filter { it.glyphs.isNotEmpty() }
      for ((i, e) in (inks[tv] ?: emptyList()).withIndex()) {
        val l = lines[i]
        val x0 = o[0] + l.xLU / units_LU_PER_PX
        val base = (o[1] + l.baseline).toDouble()
        draws.add(minOf(e[0], kotlin.math.floor(x0))); draws.add(minOf(e[1], kotlin.math.floor(base + fm.ascent)))
        draws.add(maxOf(e[2], kotlin.math.ceil(x0 + l.widthLU / units_LU_PER_PX))); draws.add(maxOf(e[3], kotlin.math.ceil(base + fm.descent)))
        draws.add(0.0)
      }
    }
    val jsDraws = JsArray(draws.toMutableList())
    val foldCache = HashMap<Long, Boolean>()
    fun folds(x: Int, y: Int): Boolean {
      val ix = paintGroup_groupTileIndex(x - originX, tileSize)
      val iy = paintGroup_groupTileIndex(y.toDouble(), tileSize)
      val key = dragonCheckedInt(ix, "group tile x").toLong() * 65536L + dragonCheckedInt(iy, "group tile y").toLong()
      return foldCache.getOrPut(key) {
        val sx = paintGroup_groupTileSpan(ix, tileSize)
        val sy = paintGroup_groupTileSpan(iy, tileSize)
        paintGroup_groupTileFolds(jsDraws, sx[0] + originX, sy[0], sx[1] + originX, sy[1])
      }
    }
    q = ByteArray(w * h * 4)
    val a8 = dragonAlpha8.toDouble()
    fun u(b: Byte): Double = (b.toInt() and 0xff).toDouble()
    for (y in 0 until h) {
      for (x in 0 until w) {
        val i = (y * w + x) * 4
        val m = dragonMatrices
        val v = (if (m != null) paintGroup_groupFilterComposite(u(lp[i]), u(lp[i + 1]), u(lp[i + 2]), u(lp[i + 3]), u(bp[i]), u(bp[i + 1]), u(bp[i + 2]), u(bp[i + 3]), m, a8) else paintGroup_groupComposite(u(lp[i]), u(lp[i + 1]), u(lp[i + 2]), u(lp[i + 3]), u(bp[i]), u(bp[i + 1]), u(bp[i + 2]), u(bp[i + 3]), a8, folds(ext[0] + x, ext[1] + y))).toLong()
        q[i] = (v and 0xffL).toByte(); q[i + 1] = ((v shr 8) and 0xffL).toByte(); q[i + 2] = ((v shr 16) and 0xffL).toByte(); q[i + 3] = ((v shr 24) and 0xffL).toByte()
      }
    }
    }
    dragonQ = q
    dragonQRect = ext
    val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    out.copyPixelsFromBuffer(ByteBuffer.wrap(q))
    bitmap = out
    layout(dragonFrame[0], dragonFrame[1], dragonFrame[2], dragonFrame[3])
    invalidate()
  }

  // ---------------------------------------------------------------- S2: the layer built in software

  /** Whether a view's subtree holds a nested group or translucent paint, so the group's layer is built in software. */
  private fun needsSoftware(v: ViewGroup): Boolean {
    for (i in 0 until v.childCount) {
      val c = v.getChildAt(i)
      if (c === this) continue
      if (c is DragonBoxView && (c.dragonNestedGroup || dragonGroupTranslucent(c))) return true
      if (c is ViewGroup && needsSoftware(c)) return true
    }
    return false
  }

  /** One solid colour blitted at full coverage onto pixel i of a layer (paint-group.ts groupFill). */
  private fun blend(buf: ByteArray, i: Int, c: DragonRGBA8, alpha: Double) {
    fun u(b: Byte): Double = (b.toInt() and 0xff).toDouble()
    val v = paintGroup_groupFill(u(buf[i]), u(buf[i + 1]), u(buf[i + 2]), u(buf[i + 3]), c.r.toDouble(), c.g.toDouble(), c.b.toDouble(), alpha).toLong()
    buf[i] = (v and 0xffL).toByte(); buf[i + 1] = ((v shr 8) and 0xffL).toByte(); buf[i + 2] = ((v shr 16) and 0xffL).toByte(); buf[i + 3] = ((v shr 24) and 0xffL).toByte()
  }

  /**
   * A box's own paint into a layer: its background over the border box, then its solid sides, each pixel once (one op of one colour:
   * the compiler admits translucent sides only on all four sides or one, in one colour).
   */
  private fun softwareBox(buf: ByteArray, b: DragonBoxView, f: DragonGroupFrame) {
    if (!b.dragonVisible) return
    val e = IntArray(4) { dragonCheckedInt(b.dragonShape.edges[it], b.dragonId + " group edge") }
    val bw = IntArray(4) { dragonCheckedInt(b.dragonShape.borders[it], b.dragonId + " group border") }
    val shown = dragonGroupSides(b)
    for (k in 0 until 4) if (shown[k] && b.dragonBorderStyles[k] != "solid") throw IllegalStateException("dragon: " + b.dragonId + ": a group border side that is not solid, which the compiler refuses")
    val x0 = maxOf(e[0], f.ext[0]); val y0 = maxOf(e[1], f.ext[1]); val x1 = minOf(e[2], f.ext[2]); val y1 = minOf(e[3], f.ext[3])
    val c = b.dragonBackgroundColor
    for (y in y0 until y1) {
      for (x in x0 until x1) {
        val i = ((y - f.ext[1]) * f.w + (x - f.ext[0])) * 4
        if (c.a > 0) blend(buf, i, c, c.a.toDouble())
        val side = if (shown[0] && y < e[1] + bw[0]) 0 else if (shown[1] && x >= e[2] - bw[1]) 1 else if (shown[2] && y >= e[3] - bw[2]) 2 else if (shown[3] && x < e[0] + bw[3]) 3 else -1
        if (side >= 0 && b.dragonBorderColors[side].a > 0) blend(buf, i, b.dragonBorderColors[side], b.dragonBorderColors[side].a.toDouble())
      }
    }
  }

  /** A text view drawn by the platform into a layer, over what the layer holds, as View.draw draws it in the group's render. */
  private fun softwareText(buf: ByteArray, tv: DragonTextView, f: DragonGroupFrame) {
    val bm = Bitmap.createBitmap(f.w, f.h, Bitmap.Config.ARGB_8888)
    bm.copyPixelsFromBuffer(ByteBuffer.wrap(buf))
    val canvas = Canvas(bm)
    val o = dragonLayoutOffset(tv, f.root)
    canvas.translate((o[0] - f.ext[0]).toFloat(), (o[1] - f.ext[1]).toFloat())
    tv.draw(canvas)
    bm.copyPixelsToBuffer(ByteBuffer.wrap(buf))
  }

  /** A view's children painted into a layer in paint order (the drawing order): boxes and their subtrees, nested groups composited. */
  private fun softwareChildren(buf: ByteArray, v: ViewGroup, f: DragonGroupFrame) {
    for (i in 0 until v.childCount) {
      val c = v.getChildAt(i)
      if (c === this || c is DragonGroupView || c.visibility != View.VISIBLE) continue
      if (c is DragonTextView) softwareText(buf, c, f)
      else if (c is DragonBoxView) {
        if (c.dragonNestedGroup) softwareGroup(buf, c, f, if (DRAGON_ALPHA_PLANT_IGNORED) 255 else c.dragonAlpha8, if (DRAGON_ALPHA_PLANT_IGNORED) 1.0 else c.dragonOpacity, null)
        else {
          softwareBox(buf, c, f)
          softwareChildren(buf, c, f)
        }
      } else if (c is ViewGroup) softwareChildren(buf, c, f)
    }
  }

  /**
   * A group's display items for its per-tile fold (paint-group.ts groupTileFoldIndex), with each item's one colour: its painting
   * boxes (a box of one op folds), its text lines' ink, and every item of a group nested in it, which never folds this group.
   */
  private fun softwareDraws(v: View, nested: Boolean, f: DragonGroupFrame, draws: ArrayList<Double>, colours: ArrayList<DragonRGBA8>) {
    if (v is DragonBoxView && v.dragonVisible) {
      val shown = dragonGroupSides(v)
      val fillsBg = v.dragonBackgroundColor.a > 0
      val ops = dragonGroupBoxOps(fillsBg, shown.count { it })
      if (ops > 0) {
        for (k in 0 until 4) draws.add(v.dragonShape.edges[k])
        draws.add(if (ops == 1 && !nested) 1.0 else 0.0)
        colours.add(if (fillsBg) v.dragonBackgroundColor else v.dragonBorderColors[maxOf(shown.indexOf(true), 0)])
      }
    }
    if (v !is ViewGroup) return
    for (i in 0 until v.childCount) {
      val c = v.getChildAt(i)
      if (c === this || c is DragonGroupView || c.visibility != View.VISIBLE) continue
      if (c is DragonTextView) {
        val o = dragonLayoutOffset(c, f.root)
        for (e in dragonGroupLineInks(c, o[0].toDouble(), o[1].toDouble())) {
          for (k in 0 until 4) draws.add(e[k])
          draws.add(0.0)
          colours.add(c.dragonColor)
        }
      } else softwareDraws(c, nested || (c is DragonBoxView && c.dragonNestedGroup), f, draws, colours)
    }
  }

  /**
   * Group b composited onto dst (premultiplied RGBA8 over the extent) as Chrome's raster does: its layer built from its draw list,
   * then, per cc raster tile, its one op drawn at the folded alpha (groupFoldAlpha, groupFill) or the layer blitted at its alpha byte
   * (groupComposite); with a colour-matrix filter, the filter and then the alpha (groupFilterComposite), never folded.
   */
  private fun softwareGroup(dst: ByteArray, b: DragonBoxView, f: DragonGroupFrame, alpha8: Int, opacity: Double, matrices: JsArray<Double>?) {
    val l = ByteArray(f.w * f.h * 4)
    softwareBox(l, b, f)
    softwareChildren(l, b, f)
    val draws = ArrayList<Double>()
    val colours = ArrayList<DragonRGBA8>()
    softwareDraws(b, false, f, draws, colours)
    val jsDraws = JsArray(draws.toMutableList())
    val foldCache = HashMap<Long, Int>()
    fun foldIndex(x: Int, y: Int): Int {
      val ix = paintGroup_groupTileIndex(x - f.originX, f.tileSize)
      val iy = paintGroup_groupTileIndex(y.toDouble(), f.tileSize)
      val key = dragonCheckedInt(ix, "group tile x").toLong() * 65536L + dragonCheckedInt(iy, "group tile y").toLong()
      return foldCache.getOrPut(key) {
        val sx = paintGroup_groupTileSpan(ix, f.tileSize)
        val sy = paintGroup_groupTileSpan(iy, f.tileSize)
        dragonCheckedInt(paintGroup_groupTileFoldIndex(jsDraws, sx[0] + f.originX, sy[0], sx[1] + f.originX, sy[1]), "group fold item")
      }
    }
    val a8 = alpha8.toDouble()
    fun u(x: Byte): Double = (x.toInt() and 0xff).toDouble()
    for (y in 0 until f.h) {
      for (x in 0 until f.w) {
        val i = (y * f.w + x) * 4
        val v: Long
        if (matrices != null) v = paintGroup_groupFilterComposite(u(l[i]), u(l[i + 1]), u(l[i + 2]), u(l[i + 3]), u(dst[i]), u(dst[i + 1]), u(dst[i + 2]), u(dst[i + 3]), matrices, a8).toLong()
        else {
          val k = foldIndex(f.ext[0] + x, f.ext[1] + y)
          if (k >= 0) {
            // The tile's one op: where the layer is clear it drew nothing.
            if (l[i + 3].toInt() == 0) continue
            val c = colours[k]
            v = paintGroup_groupFill(u(dst[i]), u(dst[i + 1]), u(dst[i + 2]), u(dst[i + 3]), c.r.toDouble(), c.g.toDouble(), c.b.toDouble(), paintGroup_groupFoldAlpha(c.a.toDouble(), opacity)).toLong()
          } else v = paintGroup_groupComposite(u(l[i]), u(l[i + 1]), u(l[i + 2]), u(l[i + 3]), u(dst[i]), u(dst[i + 1]), u(dst[i + 2]), u(dst[i + 3]), a8, false).toLong()
        }
        dst[i] = (v and 0xffL).toByte(); dst[i + 1] = ((v shr 8) and 0xffL).toByte(); dst[i + 2] = ((v shr 16) and 0xffL).toByte(); dst[i + 3] = ((v shr 24) and 0xffL).toByte()
      }
    }
  }
}
`;

const strList = (lang: 'swift' | 'kotlin', xs: readonly string[]): string => (lang === 'swift' ? `[${xs.map((x) => nativeString('swift', x)).join(', ')}]` : `listOf<String>(${xs.map((x) => nativeString('kotlin', x)).join(', ')})`);
const optStr = (lang: 'swift' | 'kotlin', x: string | null): string => (x === null ? (lang === 'swift' ? 'nil' : 'null') : nativeString(lang, x));

const lineOf = (lang: 'swift' | 'kotlin', v: string, w: EffectsWrite): string => {
  if (w.kind === 'opacity') return `  dragonSetOpacity(${v}, ${opacityLit(w.opacity)})`;
  if (w.kind === 'opacity-nested') return `  dragonSetNestedGroup(${v}, ${opacityLit(w.opacity)})`;
  if (w.kind === 'opacity-group') return `  dragonSetOpacityGroup(t, ${v}, ${opacityLit(w.opacity)}, ${optStr(lang, w.backdrop)}, ${strList(lang, w.painters)})`;
  return `  dragonSetFilterGroup(t, ${v}, ${w.opacity === 1 ? '1.0' : opacityLit(w.opacity)}, ${pairsLit(lang, w.filter)}, ${optStr(lang, w.backdrop)}, ${strList(lang, w.painters)})`;
};

export const EFFECTS_EMITTER: PaintEmitter<'opacity' | 'opacity-group' | 'filter-group' | 'opacity-nested', 'alpha-ignored'> = {
  name: 'effects',
  kinds: ['opacity', 'opacity-group', 'filter-group', 'opacity-nested'],
  lines: {
    uikit: (v, _n, w) => [lineOf('swift', v, w)],
    'android-views': (v, _n, w) => [lineOf('kotlin', v, w)],
  },
  // Both read back a float32: UIView.alpha is backed by CALayer.opacity (a Float), and Android's View alpha is a Float. A group
  // reads back its live alpha (1), its alpha byte and its backdrop box; a filter group then its filter's (code, amount) pairs; a
  // nested group its live alpha (1) and its alpha byte.
  applied: (e, _b, w) => (w.kind === 'opacity' ? e.float32(e.opacityAlpha8(w.opacity) / 255) : w.kind === 'opacity-nested' ? [1, e.opacityAlpha8(w.opacity)] : w.kind === 'opacity-group' ? [1, e.opacityAlpha8(w.opacity), w.backdrop] : [1, e.opacityAlpha8(w.opacity), w.backdrop, ...filterPairs(w.filter)]),
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, applied: 'dragonAppliedEffects' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutEffects', applied: 'dragonAppliedEffects' },
  },
  plants: [
    {
      name: 'alpha-ignored',
      replace: {
        uikit: ['public let dragonAlphaPlantIgnored = false\n', 'public let dragonAlphaPlantIgnored = true\n'],
        'android-views': ['const val DRAGON_ALPHA_PLANT_IGNORED = false\n', 'const val DRAGON_ALPHA_PLANT_IGNORED = true\n'],
      },
    },
  ],
};
