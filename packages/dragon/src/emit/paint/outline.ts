// Outlines on the native tree (T046 §1, lower/paint/outline.ts): the case code writes a box's solid or double outline through
// dragonSetOutline with its host. After every layout the translated paint-radius.ts outlineRings gives the rings at the device
// scale (Blink's snapped width and truncated offset, the radii outset), and a DragonOutlineView in the host's container (the box's
// own view when it is its paint root, the host's clip view or the host otherwise) draws them with an even-odd fill; the stacking
// sort, which runs whenever a view joins a container, puts it after the host's flow children and foreground and before its layer
// items, in tree order. The readback is the live host and the rings in device px
// from the root (the view's live position plus its rings).
import { nativeString } from './stacking.ts';
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT, rgbaLit } from './types.ts';

const num = (v: number, what: string): string => {
  if (!Number.isFinite(v)) throw new Error(`outline ${what} ${v} is not finite`);
  const n = String(v);
  return /[.eE]/.test(n) ? n.replace(/e\+?/, 'E') : `${n}.0`;
};
const int = (v: number, what: string): string => {
  if (!Number.isInteger(v) || v < 0) throw new Error(`outline ${what} ${v} is not a non-negative integer`);
  return String(v);
};

const SWIFT_MEMBERS = String.raw`  /// The outline view of the box, when it has a solid or double outline; it sits in the host's container.
  public var dragonOutlineView: DragonOutlineView? = nil
  /// The outline write: host id, tree rank, double or solid, width and offset in css px.
  public var dragonOutlineHost = ""
  public var dragonOutlineDouble = false
  public var dragonOutlineWidth: Double = 0
  public var dragonOutlineOffset: Double = 0
  public weak var dragonOutlineTree: DragonTree? = nil
`;

const SWIFT = String.raw`import UIKit

/// Device px every outline ring is shifted right; 0 except in the outline-offset-1 raster plant build.
public let dragonOutlinePlantDevicePx: Double = 0

/// An outline's view: its rings in device px relative to the view (24 numbers each: outer rect, inner rect, outer and inner radii),
/// filled even-odd in the outline colour. Its frame is the first ring's outer rect.
public final class DragonOutlineView: UIView {
  public var rings: [Double] = []
  public var color = DragonRGBA8(0, 0, 0, 0)
  public var scaleFactor: Double = 1
  public var rank = 0
  public init() {
    super.init(frame: .zero)
    isOpaque = false
    backgroundColor = nil
    clipsToBounds = false
    isUserInteractionEnabled = false
    contentMode = .redraw
  }
  required init?(coder: NSCoder) { fatalError("DragonOutlineView is built in code") }
  public override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let s = scaleFactor
    let r = rings
    ctx.setFillColor(dragonUIColor(color).cgColor)
    var k = 0
    while k + 24 <= r.count {
      let path = CGMutablePath()
      path.addPath(dragonRRectPath(CGRect(x: r[k] / s, y: r[k + 1] / s, width: (r[k + 2] - r[k]) / s, height: (r[k + 3] - r[k + 1]) / s), Array(r[(k + 8)..<(k + 16)]), s))
      path.addPath(dragonRRectPath(CGRect(x: r[k + 4] / s, y: r[k + 5] / s, width: (r[k + 6] - r[k + 4]) / s, height: (r[k + 7] - r[k + 5]) / s), Array(r[(k + 16)..<(k + 24)]), s))
      ctx.addPath(path)
      ctx.fillPath(using: .evenOdd)
      k += 24
    }
  }
}

/// The outline write of a box (runtime writer): its host, rank, style, width and offset in css px and colour; every after-layout
/// hook then re-applies the paint.
public func dragonSetOutline(_ t: DragonTree, _ v: DragonBoxView, _ host: String, _ rank: Int, _ double: Bool, _ width: Double, _ offset: Double, _ color: DragonRGBA8) {
  if !(width > 0) || !offset.isFinite || rank < 0 { fatalError("dragon: \(v.dragonId): outline width \(width), offset \(offset) or rank \(rank) is out of range") }
  v.dragonOutlineHost = host
  v.dragonOutlineDouble = double
  v.dragonOutlineWidth = width
  v.dragonOutlineOffset = offset
  v.dragonOutlineTree = t
  let o = v.dragonOutlineView ?? DragonOutlineView()
  o.rank = rank
  o.color = color
  v.dragonOutlineView = o
  dragonAfterLayout(v, v.dragonShape, v.dragonScale)
}

/// The container an outline paints in: the box's own view when the box is its host, else the host's container (its clip view
/// when it clips), and that container's origin in device px from the root.
private func dragonOutlineContainer(_ v: DragonBoxView) -> (UIView, Double, Double)? {
  if v.dragonOutlineHost == v.dragonId { return (v, v.dragonShape.edges[0], v.dragonShape.edges[1]) }
  guard let h = v.dragonOutlineTree?.node(v.dragonOutlineHost) as? DragonBoxView else { return nil }
  let e = h.dragonShape.edges
  if let c = h.dragonClipView { return (c, e[0] + h.dragonShape.borders[3], e[1] + h.dragonShape.borders[0]) }
  return (h, e[0], e[1])
}

/// After every layout: the rings from the translated paint-radius.ts at the device scale, the view's frame in its container (placed
/// there and sorted the first time), with implicit actions disabled.
public func dragonAfterLayoutOutline(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let o = v.dragonOutlineView else { return }
  guard let placed = dragonOutlineContainer(v) else { fatalError("dragon: \(v.dragonId): the outline host \(v.dragonOutlineHost) is not placed") }
  let (container, ox, oy) = placed
  let e = v.dragonShape.edges
  let rings: [Double]
  do {
    let w = try paintRadius_outlineWidthPx(v.dragonOutlineWidth, scale)
    let off = try paintRadius_outlineOffsetPx(v.dragonOutlineOffset, scale)
    rings = try paintRadius_outlineRings(e[0] + dragonOutlinePlantDevicePx, e[1], e[2] + dragonOutlinePlantDevicePx, e[3], JsArray(v.dragonShape.radii), w, off, v.dragonOutlineDouble).items
  } catch {
    fatalError("dragon: \(v.dragonId): paint-radius outlineRings failed: \(error)")
  }
  if rings.count < 24 || rings.count % 24 != 0 { fatalError("dragon: \(v.dragonId): \(rings.count) outline ring values") }
  let bx = rings[0]
  let by = rings[1]
  var local: [Double] = []
  for (k, x) in rings.enumerated() { local.append((k % 24) < 8 ? x - ((k % 2) == 0 ? bx : by) : x) }
  CATransaction.begin()
  CATransaction.setDisableActions(true)
  o.rings = local
  o.scaleFactor = scale
  o.frame = CGRect(x: CGFloat((bx - ox) / scale), y: CGFloat((by - oy) / scale), width: CGFloat((rings[2] - bx) / scale), height: CGFloat((rings[3] - by) / scale))
  if o.superview !== container {
    o.removeFromSuperview()
    container.addSubview(o)
  }
  CATransaction.commit()
  dragonSortPaintOrder(container)
  o.setNeedsDisplay()
}

/// The readback of the outline module: the live host (the box owning the view's container) and every ring's outer and inner rect
/// in device px from the root, from the view's live position.
public func dragonAppliedOutline(_ v: DragonBoxView) -> DumpJsonObject {
  guard let o = v.dragonOutlineView else { return [] }
  guard let c = o.superview, let host = (c as? DragonBoxView) ?? (c.superview as? DragonBoxView) else { return [("dragonOutline.rings", .null)] }
  let at = o.convert(CGPoint.zero, to: v)
  let s = v.dragonScale
  let x0 = v.dragonShape.edges[0] + Double(at.x) * s
  let y0 = v.dragonShape.edges[1] + Double(at.y) * s
  var out: [DumpJson] = [.string(host.dragonId)]
  var k = 0
  while k + 24 <= o.rings.count {
    for j in 0..<8 { out.append(.number(o.rings[k + j] + (j % 2 == 0 ? x0 : y0))) }
    k += 24
  }
  return [("dragonOutline.rings", .array(out))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The outline view of the box, when it has a solid or double outline; it sits in the host's container. */
  var dragonOutlineView: DragonOutlineView? = null
  /** The outline write: host id, double or solid, width and offset in css px. */
  var dragonOutlineHost = ""
  var dragonOutlineDouble = false
  var dragonOutlineWidth = 0.0
  var dragonOutlineOffset = 0.0
  var dragonOutlineTree: DragonTree? = null
  /** The device scale of the last layout. */
  var dragonOutlineScale = 1.0
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.ViewGroup
import dev.dragon.dump.DumpJson
import dev.dragon.layout.JsArray
import dev.dragon.layout.paintRadius_outlineOffsetPx
import dev.dragon.layout.paintRadius_outlineRings
import dev.dragon.layout.paintRadius_outlineWidthPx

/** Device px every outline ring is shifted right; 0 except in the outline-offset-1 raster plant build. */
const val DRAGON_OUTLINE_PLANT_DEVICE_PX = 0.0

/**
 * An outline's view: its rings in device px relative to the view (24 numbers each: outer rect, inner rect, outer and inner radii),
 * filled even-odd in the outline colour. Its frame is the first ring's outer rect.
 */
class DragonOutlineView(ctx: Context) : DragonGroup(ctx) {
  var rings = DoubleArray(0)
  var color = DragonRGBA8(0, 0, 0, 0)
  var rank = 0
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    paint.style = Paint.Style.FILL
    paint.color = dragonArgb(color)
    var k = 0
    while (k + 24 <= rings.size) {
      val path = Path()
      path.fillType = Path.FillType.EVEN_ODD
      path.addPath(dragonRRectPath(RectF(rings[k].toFloat(), rings[k + 1].toFloat(), rings[k + 2].toFloat(), rings[k + 3].toFloat()), rings, k + 8))
      path.addPath(dragonRRectPath(RectF(rings[k + 4].toFloat(), rings[k + 5].toFloat(), rings[k + 6].toFloat(), rings[k + 7].toFloat()), rings, k + 16))
      canvas.drawPath(path, paint)
      k += 24
    }
  }
}

/**
 * The outline write of a box (runtime writer): its host, rank, style, width and offset in css px and colour; every after-layout
 * hook then re-applies the paint.
 */
fun dragonSetOutline(t: DragonTree, v: DragonBoxView, host: String, rank: Int, double: Boolean, width: Double, offset: Double, color: DragonRGBA8) {
  if (!(width > 0.0) || !offset.isFinite() || rank < 0) throw IllegalStateException("dragon: " + v.dragonId + ": outline width " + width + ", offset " + offset + " or rank " + rank + " is out of range")
  v.dragonOutlineHost = host
  v.dragonOutlineDouble = double
  v.dragonOutlineWidth = width
  v.dragonOutlineOffset = offset
  v.dragonOutlineTree = t
  val o = v.dragonOutlineView ?: DragonOutlineView(v.context)
  o.rank = rank
  o.color = color
  v.dragonOutlineView = o
  dragonAfterLayout(v, v.dragonShape, v.dragonOutlineScale)
}

/**
 * The container an outline paints in: the box's own view when the box is its host, else the host's container (its clip view when
 * it clips), and that container's origin in device px from the root.
 */
private fun dragonOutlineContainer(v: DragonBoxView): Triple<ViewGroup, Double, Double>? {
  if (v.dragonOutlineHost == v.dragonId) return Triple(v, v.dragonShape.edges[0], v.dragonShape.edges[1])
  val h = v.dragonOutlineTree?.node(v.dragonOutlineHost) as? DragonBoxView ?: return null
  val e = h.dragonShape.edges
  val c = h.dragonClipView
  if (c != null) return Triple(c, e[0] + h.dragonShape.borders[3], e[1] + h.dragonShape.borders[0])
  return Triple(h, e[0], e[1])
}

/**
 * After every layout: the rings from the translated paint-radius.ts at the device scale, the view's frame in its container (placed
 * there and sorted the first time).
 */
fun dragonAfterLayoutOutline(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val o = v.dragonOutlineView ?: return
  v.dragonOutlineScale = scale
  val (container, ox, oy) = dragonOutlineContainer(v) ?: throw IllegalStateException("dragon: " + v.dragonId + ": the outline host " + v.dragonOutlineHost + " is not placed")
  val e = shape.edges
  val w = paintRadius_outlineWidthPx(v.dragonOutlineWidth, scale)
  val off = paintRadius_outlineOffsetPx(v.dragonOutlineOffset, scale)
  val rings = paintRadius_outlineRings(e[0] + DRAGON_OUTLINE_PLANT_DEVICE_PX, e[1], e[2] + DRAGON_OUTLINE_PLANT_DEVICE_PX, e[3], JsArray(shape.radii.toMutableList()), w, off, v.dragonOutlineDouble)
  if (rings.size < 24 || rings.size % 24 != 0) throw IllegalStateException("dragon: " + v.dragonId + ": " + rings.size + " outline ring values")
  val bx = rings[0]
  val by = rings[1]
  o.rings = DoubleArray(rings.size) { k -> if (k % 24 < 8) rings[k] - (if (k % 2 == 0) bx else by) else rings[k] }
  dragonSetFrame(o.dragonFrame, bx - ox, by - oy, rings[2] - ox, rings[3] - oy, v.dragonId + " outline")
  if (o.parent !== container) {
    (o.parent as? ViewGroup)?.removeView(o)
    container.addView(o)
  }
  dragonSortPaintOrder(container)
  container.requestLayout()
  o.invalidate()
}

/**
 * The readback of the outline module: the live host (the box owning the view's container) and every ring's outer and inner rect in
 * device px from the root, from the view's live position.
 */
fun dragonAppliedOutline(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val o = v.dragonOutlineView ?: return emptyList()
  val c = o.parent as? ViewGroup
  val host = (c as? DragonBoxView) ?: (c?.parent as? DragonBoxView)
  if (c == null || host == null) return listOf(Pair("dragonOutline.rings", DumpJson.Null))
  val oa = IntArray(2)
  val va = IntArray(2)
  o.getLocationInWindow(oa)
  v.getLocationInWindow(va)
  val x0 = v.dragonShape.edges[0] + (oa[0] - va[0])
  val y0 = v.dragonShape.edges[1] + (oa[1] - va[1])
  val out = ArrayList<DumpJson>()
  out.add(DumpJson.Str(host.dragonId))
  var k = 0
  while (k + 24 <= o.rings.size) {
    for (j in 0 until 8) out.add(DumpJson.Num(o.rings[k + j] + (if (j % 2 == 0) x0 else y0)))
    k += 24
  }
  return listOf(Pair("dragonOutline.rings", DumpJson.Arr(out)))
}
`;

export const OUTLINE_EMITTER: PaintEmitter<'outline'> = {
  name: 'outline',
  kinds: ['outline'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetOutline(t, ${v}, ${nativeString('swift', w.host)}, ${int(w.rank, 'rank')}, ${w.style === 'double' ? 'true' : 'false'}, ${num(w.width, 'width')}, ${num(w.offset, 'offset')}, ${rgbaLit(w.color)})`],
    'android-views': (v, _n, w) => [`  dragonSetOutline(t, ${v}, ${nativeString('kotlin', w.host)}, ${int(w.rank, 'rank')}, ${w.style === 'double' ? 'true' : 'false'}, ${num(w.width, 'width')}, ${num(w.offset, 'offset')}, ${rgbaLit(w.color)})`],
  },
  applied: (e, _b, w, dpr, g) => {
    const b = g.box;
    const radii = w.radii === null ? [0, 0, 0, 0, 0, 0, 0, 0] : e.paint.roundedShape(b.left, b.top, b.right, b.bottom, g.size[0], g.size[1], g.border, w.radii, dpr, { radiusUnclamped: false, innerRadiusNotReduced: false }).slice(0, 8);
    const rings = e.paint.outlineRings(b.left, b.top, b.right, b.bottom, radii, e.paint.outlineWidthPx(w.width, dpr), e.paint.outlineOffsetPx(w.offset, dpr), w.style === 'double');
    const out: (string | number)[] = [w.host];
    for (let k = 0; k + 24 <= rings.length; k += 24) for (let j = 0; j < 8; j++) out.push(rings[k + j] as number);
    return out;
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, afterLayout: 'dragonAfterLayoutOutline', applied: 'dragonAppliedOutline' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutOutline', applied: 'dragonAppliedOutline' },
  },
  plants: [
    {
      name: 'outline-offset-1',
      replace: {
        uikit: ['public let dragonOutlinePlantDevicePx: Double = 0\n', 'public let dragonOutlinePlantDevicePx: Double = 1\n'],
        'android-views': ['const val DRAGON_OUTLINE_PLANT_DEVICE_PX = 0.0\n', 'const val DRAGON_OUTLINE_PLANT_DEVICE_PX = 1.0\n'],
      },
    },
  ],
};
