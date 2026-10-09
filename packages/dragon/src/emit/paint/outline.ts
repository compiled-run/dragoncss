// Outlines on the native tree (T046 §1, lower/paint/outline.ts): the case code writes a box's solid or double outline through
// dragonSetOutline, which puts a DragonOutlineView in the tree's root view. After every layout the translated paint-radius.ts
// outlineRings gives the rings at the device scale (Blink's snapped width and truncated offset, the radii outset), and the view draws
// them with an even-odd fill. The root view's outline views stay after its content in Blink's outline-phase order (each box's
// descendants' outlines, then its own; boxes in tree order), so they paint as Chrome's root stacking context paints its outline phase. The readback is every ring's outer and inner rect in
// device px from the root, from the view's live frame, or null when the view is not after the root's content.
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT, rgbaLit } from './types.ts';

const num = (v: number, what: string): string => {
  if (!Number.isFinite(v)) throw new Error(`outline ${what} ${v} is not finite`);
  const n = String(v);
  return /[.eE]/.test(n) ? n.replace(/e\+?/, 'E') : `${n}.0`;
};

const SWIFT_MEMBERS = String.raw`  /// The outline view of the box, when it has a solid or double outline; it sits in the tree's root view.
  public var dragonOutlineView: DragonOutlineView? = nil
  /// The outline write: double or solid, width and offset in css px.
  public var dragonOutlineDouble = false
  public var dragonOutlineWidth: Double = 0
  public var dragonOutlineOffset: Double = 0
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

/// Moves every outline view of the root after the root's other views, in Blink's outline-phase order: a box paints its
/// descendants' outlines before its own (BoxFragmentPainter, kDescendantOutlinesOnly then kSelfOutlineOnly), boxes in tree order.
public func dragonRaiseOutlines(_ root: UIView) {
  func visit(_ view: UIView) {
    for child in view.subviews where !(child is DragonOutlineView) { visit(child) }
    if let b = view as? DragonBoxView, let o = b.dragonOutlineView, o.superview === root { root.bringSubviewToFront(o) }
  }
  visit(root)
}

/// The outline write of a box (runtime writer): its style, width and offset in css px and colour. The first write puts the view
/// last in the tree's root view; every after-layout hook then re-applies the paint.
public func dragonSetOutline(_ t: DragonTree, _ v: DragonBoxView, _ double: Bool, _ width: Double, _ offset: Double, _ color: DragonRGBA8) {
  if !(width > 0) || !offset.isFinite { fatalError("dragon: \(v.dragonId): outline width \(width) or offset \(offset) is out of range") }
  v.dragonOutlineDouble = double
  v.dragonOutlineWidth = width
  v.dragonOutlineOffset = offset
  let o = v.dragonOutlineView ?? DragonOutlineView()
  o.color = color
  if o.superview !== t.root {
    o.removeFromSuperview()
    t.root.addSubview(o)
  }
  v.dragonOutlineView = o
  dragonAfterLayout(v, v.dragonShape, v.dragonScale)
}

/// After every layout: the rings from the translated paint-radius.ts at the device scale and the view's frame in the root view, with
/// implicit actions disabled; the root's outline views then move after any view the layout added.
public func dragonAfterLayoutOutline(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let o = v.dragonOutlineView else { return }
  guard let root = o.superview as? DragonRootView else { fatalError("dragon: \(v.dragonId): the outline view is not in the root view") }
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
  o.frame = CGRect(x: CGFloat(bx / scale), y: CGFloat(by / scale), width: CGFloat((rings[2] - bx) / scale), height: CGFloat((rings[3] - by) / scale))
  CATransaction.commit()
  dragonRaiseOutlines(root)
  o.setNeedsDisplay()
}

/// The readback of the outline module: every ring's outer and inner rect in device px from the root, from the view's live frame;
/// null when the view is not in the root view after all of the root's other views.
public func dragonAppliedOutline(_ v: DragonBoxView) -> DumpJsonObject {
  guard let o = v.dragonOutlineView else { return [] }
  guard let root = o.superview as? DragonRootView, let i = root.subviews.firstIndex(of: o), root.subviews[(i + 1)...].allSatisfy({ $0 is DragonOutlineView }) else { return [("dragonOutline.rings", .null)] }
  let s = v.dragonScale
  let x0 = dragonWholeDevicePx(Double(o.frame.minX) * s, "\(v.dragonId) outline left")
  let y0 = dragonWholeDevicePx(Double(o.frame.minY) * s, "\(v.dragonId) outline top")
  var out: [DumpJson] = []
  var k = 0
  while k + 24 <= o.rings.count {
    for j in 0..<8 { out.append(.number(o.rings[k + j] + (j % 2 == 0 ? x0 : y0))) }
    k += 24
  }
  return [("dragonOutline.rings", .array(out))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The outline view of the box, when it has a solid or double outline; it sits in the tree's root view. */
  var dragonOutlineView: DragonOutlineView? = null
  /** The outline write: double or solid, width and offset in css px. */
  var dragonOutlineDouble = false
  var dragonOutlineWidth = 0.0
  var dragonOutlineOffset = 0.0
  /** The device scale of the last layout. */
  var dragonOutlineScale = 1.0
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View
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
 * Moves every outline view of the root after the root's other views, in Blink's outline-phase order: a box paints its descendants'
 * outlines before its own (BoxFragmentPainter, kDescendantOutlinesOnly then kSelfOutlineOnly), boxes in tree order.
 */
fun dragonRaiseOutlines(root: ViewGroup) {
  fun visit(view: View) {
    if (view is ViewGroup) for (child in (0 until view.childCount).map { view.getChildAt(it) }) if (child !is DragonOutlineView) visit(child)
    val o = (view as? DragonBoxView)?.dragonOutlineView
    if (o != null && o.parent === root) root.bringChildToFront(o)
  }
  visit(root)
}

/**
 * The outline write of a box (runtime writer): its style, width and offset in css px and colour. The first write puts the view last
 * in the tree's root view; every after-layout hook then re-applies the paint.
 */
fun dragonSetOutline(t: DragonTree, v: DragonBoxView, double: Boolean, width: Double, offset: Double, color: DragonRGBA8) {
  if (!(width > 0.0) || !offset.isFinite()) throw IllegalStateException("dragon: " + v.dragonId + ": outline width " + width + " or offset " + offset + " is out of range")
  v.dragonOutlineDouble = double
  v.dragonOutlineWidth = width
  v.dragonOutlineOffset = offset
  val o = v.dragonOutlineView ?: DragonOutlineView(v.context)
  o.color = color
  if (o.parent !== t.root) {
    (o.parent as? ViewGroup)?.removeView(o)
    t.root.addView(o)
  }
  v.dragonOutlineView = o
  dragonAfterLayout(v, v.dragonShape, v.dragonOutlineScale)
}

/**
 * After every layout: the rings from the translated paint-radius.ts at the device scale and the view's frame in the root view; the
 * root's outline views then move after any view the layout added.
 */
fun dragonAfterLayoutOutline(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val o = v.dragonOutlineView ?: return
  val root = o.parent as? DragonRootView ?: throw IllegalStateException("dragon: " + v.dragonId + ": the outline view is not in the root view")
  v.dragonOutlineScale = scale
  val e = shape.edges
  val w = paintRadius_outlineWidthPx(v.dragonOutlineWidth, scale)
  val off = paintRadius_outlineOffsetPx(v.dragonOutlineOffset, scale)
  val rings = paintRadius_outlineRings(e[0] + DRAGON_OUTLINE_PLANT_DEVICE_PX, e[1], e[2] + DRAGON_OUTLINE_PLANT_DEVICE_PX, e[3], JsArray(shape.radii.toMutableList()), w, off, v.dragonOutlineDouble)
  if (rings.size < 24 || rings.size % 24 != 0) throw IllegalStateException("dragon: " + v.dragonId + ": " + rings.size + " outline ring values")
  val bx = rings[0]
  val by = rings[1]
  o.rings = DoubleArray(rings.size) { k -> if (k % 24 < 8) rings[k] - (if (k % 2 == 0) bx else by) else rings[k] }
  dragonSetFrame(o.dragonFrame, bx, by, rings[2], rings[3], v.dragonId + " outline")
  dragonRaiseOutlines(root)
  root.requestLayout()
  o.invalidate()
}

/**
 * The readback of the outline module: every ring's outer and inner rect in device px from the root, from the view's live position;
 * null when the view is not in the root view after all of the root's other views.
 */
fun dragonAppliedOutline(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val o = v.dragonOutlineView ?: return emptyList()
  val root = o.parent as? DragonRootView
  val i = root?.indexOfChild(o) ?: -1
  if (root == null || i < 0 || (i + 1 until root.childCount).any { root.getChildAt(it) !is DragonOutlineView }) return listOf(Pair("dragonOutline.rings", DumpJson.Null))
  val x0 = o.left.toDouble()
  val y0 = o.top.toDouble()
  val out = ArrayList<DumpJson>()
  var k = 0
  while (k + 24 <= o.rings.size) {
    for (j in 0 until 8) out.add(DumpJson.Num(o.rings[k + j] + (if (j % 2 == 0) x0 else y0)))
    k += 24
  }
  return listOf(Pair("dragonOutline.rings", DumpJson.Arr(out)))
}
`;

export const OUTLINE_EMITTER: PaintEmitter<'outline', 'outline-offset-1'> = {
  name: 'outline',
  kinds: ['outline'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetOutline(t, ${v}, ${w.style === 'double' ? 'true' : 'false'}, ${num(w.width, 'width')}, ${num(w.offset, 'offset')}, ${rgbaLit(w.color)})`],
    'android-views': (v, _n, w) => [`  dragonSetOutline(t, ${v}, ${w.style === 'double' ? 'true' : 'false'}, ${num(w.width, 'width')}, ${num(w.offset, 'offset')}, ${rgbaLit(w.color)})`],
  },
  applied: (e, _b, w, dpr, g) => {
    const b = g.box;
    const radii = w.radii === null ? [0, 0, 0, 0, 0, 0, 0, 0] : e.paint.roundedShape(b.left, b.top, b.right, b.bottom, g.size[0], g.size[1], g.border, w.radii, dpr, { radiusUnclamped: false, innerRadiusNotReduced: false }).slice(0, 8);
    const rings = e.paint.outlineRings(b.left, b.top, b.right, b.bottom, radii, e.paint.outlineWidthPx(w.width, dpr), e.paint.outlineOffsetPx(w.offset, dpr), w.style === 'double');
    const out: number[] = [];
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
