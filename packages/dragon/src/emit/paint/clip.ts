// css-overflow-3 §3: overflow hidden hosts the box's children in a Dragon clip view over its padding box (the container factory
// makes it; the after-layout hook sets its frame from the engine's border widths at the device scale).
// css-masking-1 §5.1: a clip rect() that is empty at every size hides the box view (isHidden, View.INVISIBLE), and with it every
// view inside it, through the one runtime writer dragonClipRectEmpty; the readback is 1 when the box view is hidden. A hidden or
// invisible view leaves the accessibility tree, so analysis refuses the write where the subtree has text (the only native
// accessibility elements), which Chrome keeps there (analysis/paint-values/clip.ts).
// css-masking-1 §6.1: clip-path: inset() stores its edges through dragonSetClipPath; after every layout the clip rect is the snapped
// border box inset by each edge (px times the scale, plus its percentage of the layout width or height), in device px (clipPathRect).
// UIKit masks the box view's layer with an opaque layer over the rect; Android clips the canvas of the box view's draw, around its own
// paint and its children's. Neither touches the views' visibility or accessibility: text a clip-path or a gradient mask hides stays
// in the accessibility tree, as in Chrome's, which the clip-text readback proves (dragonClipText.exposed: the labels of the text
// views inside the box view that VoiceOver or TalkBack reaches, in preorder).
// circle(), ellipse() and polygon() store their lengths through dragonSetClipShape; after every layout the shape's geometry is
// computed against the layout size of the border box in device px (clipShapeGeometry): each coordinate is px times the scale plus its
// percentage of the width or height, or the width or height less px times the scale from the right or bottom; a circle radius
// percentage is of the normalized diagonal, closest-side and farthest-side the nearest and farthest side from the centre. UIKit
// masks the box view's layer with a CAShapeLayer filling that path, antialiased as Chrome's path clip is; Android clips the canvas
// of the box view's draw to it, whose edge antialiasing depends on the device's renderer, so its edge pixels may differ from Chrome's.
import type { ClipShape, InsetEdge, ShapeCoord, ShapeLength, ShapeRadius } from '../../css/properties/clip-path.ts';
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// The view the children are hosted in over the padding box: a DragonClipView, or the scroll module's DragonScrollView.
  public private(set) var dragonClipView: UIView? = nil
  /// Overflow hidden: the children are hosted by a clip view over the padding box.
  public func dragonEnableClip() {
    let c = dragonMakeContainer()
    addSubview(c)
    dragonClipView = c
  }
  /// Whether a clip rect() that is empty at every size hides the box (MASK-CLIP); set only by dragonClipRectEmpty.
  public var dragonClipRectEmpty = false
  /// clip-path: inset() (MASK-CLIP): the four edges (top, right, bottom, left) as px, percent pairs; empty without one.
  public var dragonClipPathInsets: [Double] = []
  /// The clip-path rect (left, top, right, bottom) in device px relative to the box, from the last layout; empty without one.
  public var dragonClipPathRect: [Double] = []
  /// clip-path: circle(), ellipse() or polygon() (MASK-CLIP): the shape (0 circle, 1 ellipse, 2 polygon), or -1 without one.
  public var dragonClipShapeKind = -1
  /// The shape's writer values (dragonSetClipShape).
  public var dragonClipShapeValues: [Double] = []
  /// The shape's geometry in device px relative to the box, from the last layout (dragonClipShapeGeometry); empty without one.
  public var dragonClipShapeGeometry: [Double] = []
  /// Whether the box has text under a clip-path or a gradient mask, whose accessibility the readback reports (dragonClipText).
  public var dragonClipText = false
`;

const SWIFT = String.raw`import UIKit

/// Whether the clip rect writer ignores the write; false except in the clip-rect-ignored plant build.
public let dragonClipRectPlantIgnored = false

/// The empty clip rect write of a box (runtime writer): the box view is hidden, and with it every view inside it.
public func dragonClipRectEmpty(_ v: DragonBoxView) {
  if dragonClipRectPlantIgnored { return }
  CATransaction.begin()
  CATransaction.setDisableActions(true)
  v.dragonClipRectEmpty = true
  v.isHidden = true
  CATransaction.commit()
}

/// Whether the clip-path writer ignores the write; false except in the clip-path-ignored plant build.
public let dragonClipPathPlantIgnored = false

/// The clip-path write of a box (runtime writer): its inset() edges; the after-layout hook masks the box view to their rect.
public func dragonSetClipPath(_ v: DragonBoxView, _ insets: [Double]) {
  if dragonClipPathPlantIgnored { return }
  if insets.count != 8 { fatalError("dragon: \(v.dragonId): \(insets.count) clip-path inset values, not 8") }
  v.dragonClipPathInsets = insets
}

/// The clip-path rect of a box in device px relative to it (left, top, right, bottom); zero when the insets leave nothing.
public func dragonClipPathRectOf(_ insets: [Double], _ shape: DragonBoxShape, _ scale: Double) -> [Double] {
  let e = shape.edges
  let edge = { (k: Int, size: Double) -> Double in insets[2 * k] * scale + insets[2 * k + 1] / 100 * size }
  let l = edge(3, shape.size[0]), t = edge(0, shape.size[1])
  let r = e[2] - e[0] - edge(1, shape.size[0]), b = e[3] - e[1] - edge(2, shape.size[1])
  return r <= l || b <= t ? [0, 0, 0, 0] : [l, t, r, b]
}

/// The clip-path shape write of a box (runtime writer): its kind (0 circle, 1 ellipse, 2 polygon) and lengths; the after-layout hook
/// masks the box view to its path.
public func dragonSetClipShape(_ v: DragonBoxView, _ kind: Int, _ values: [Double]) {
  if dragonClipPathPlantIgnored { return }
  let ok = kind == 0 ? values.count == 9 : kind == 1 ? values.count == 12 : kind == 2 && values.count >= 5 && (values.count - 1) % 4 == 0
  if !ok { fatalError("dragon: \(v.dragonId): clip-path shape \(kind) with \(values.count) values") }
  v.dragonClipShapeKind = kind
  v.dragonClipShapeValues = values
}

/// The geometry of a clip-path shape in device px relative to the box: circle [cx, cy, r], ellipse [cx, cy, rx, ry], polygon
/// [evenodd, x0, y0, ...].
public func dragonClipShapeGeometry(_ kind: Int, _ s: [Double], _ size: [Double], _ scale: Double) -> [Double] {
  let w = size[0], h = size[1]
  let coord = { (i: Int, extent: Double) -> Double in s[i] == 1 ? extent - s[i + 1] * scale : s[i + 1] * scale + s[i + 2] / 100 * extent }
  let side = { (far: Bool, c: Double, extent: Double) -> Double in far ? max(abs(c), abs(extent - c)) : min(abs(c), abs(extent - c)) }
  if kind == 2 {
    var out: [Double] = [s[0]]
    var i = 1
    while i < s.count {
      out.append(s[i] * scale + s[i + 1] / 100 * w)
      out.append(s[i + 2] * scale + s[i + 3] / 100 * h)
      i += 4
    }
    return out
  }
  let cx = coord(0, w), cy = coord(3, h)
  if kind == 0 {
    let diagonal = (w * w + h * h).squareRoot() / 2.0.squareRoot()
    let length = s[7] * scale + s[8] / 100 * diagonal
    let farthest = max(side(true, cx, w), side(true, cy, h))
    let closest = min(side(false, cx, w), side(false, cy, h))
    let r = s[6] == 0 ? length : s[6] == 2 ? farthest : closest
    return [cx, cy, r]
  }
  let rx = s[6] == 0 ? s[7] * scale + s[8] / 100 * w : side(s[6] == 2, cx, w)
  let ry = s[9] == 0 ? s[10] * scale + s[11] / 100 * h : side(s[9] == 2, cy, h)
  return [cx, cy, rx, ry]
}

/// The path of a clip-path shape's geometry, in points.
func dragonClipShapePath(_ kind: Int, _ g: [Double], _ scale: Double) -> CGPath {
  let cg = CGFloat(scale)
  let path = CGMutablePath()
  if kind == 2 {
    var i = 1
    while i + 1 < g.count {
      let p = CGPoint(x: CGFloat(g[i]) / cg, y: CGFloat(g[i + 1]) / cg)
      if i == 1 { path.move(to: p) } else { path.addLine(to: p) }
      i += 2
    }
    path.closeSubpath()
    return path
  }
  let rx = g[2], ry = kind == 0 ? g[2] : g[3]
  path.addEllipse(in: CGRect(x: CGFloat(g[0] - rx) / cg, y: CGFloat(g[1] - ry) / cg, width: CGFloat(2 * rx) / cg, height: CGFloat(2 * ry) / cg))
  return path
}

/// After every layout: the clip view over the padding box, in points relative to the box; the clip-path mask over its rect or shape.
public func dragonAfterLayoutClip(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  let cg = CGFloat(scale)
  if !v.dragonClipPathInsets.isEmpty {
    let r = dragonClipPathRectOf(v.dragonClipPathInsets, shape, scale)
    v.dragonClipPathRect = r
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let m = v.layer.mask ?? CALayer()
    m.backgroundColor = UIColor.black.cgColor
    m.frame = CGRect(x: CGFloat(r[0]) / cg, y: CGFloat(r[1]) / cg, width: CGFloat(r[2] - r[0]) / cg, height: CGFloat(r[3] - r[1]) / cg)
    v.layer.mask = m
    CATransaction.commit()
  }
  if v.dragonClipShapeKind >= 0 {
    let g = dragonClipShapeGeometry(v.dragonClipShapeKind, v.dragonClipShapeValues, shape.size, scale)
    v.dragonClipShapeGeometry = g
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let m = (v.layer.mask as? CAShapeLayer) ?? CAShapeLayer()
    let e = shape.edges
    m.frame = CGRect(x: 0, y: 0, width: CGFloat(e[2] - e[0]) / cg, height: CGFloat(e[3] - e[1]) / cg)
    m.fillColor = UIColor.black.cgColor
    m.fillRule = v.dragonClipShapeKind == 2 && g[0] == 1 ? .evenOdd : .nonZero
    m.path = dragonClipShapePath(v.dragonClipShapeKind, g, scale)
    v.layer.mask = m
    CATransaction.commit()
  }
  guard let c = v.dragonClipView else { return }
  let e = shape.edges
  let px = shape.borders
  c.frame = CGRect(x: CGFloat(px[3]) / cg, y: CGFloat(px[0]) / cg, width: CGFloat(e[2] - e[0] - px[3] - px[1]) / cg, height: CGFloat(e[3] - e[1] - px[0] - px[2]) / cg)
}

/// The readback of the clip module: the clip frame in whole device px / scale, or null when it does not clip.
/// The empty clip rect's readback is 1 when the box view is hidden, or 0.
/// The clip-text write of a box (runtime writer): it marks the box whose text views' accessibility the readback reports.
public func dragonClipText(_ v: DragonBoxView) {
  v.dragonClipText = true
}

/// Whether VoiceOver reaches a text view: an accessibility element labelled with its text, with a non-empty frame in a window, not
/// hidden or transparent, and under no ancestor that is hidden, transparent, hides its accessibility elements or is one itself.
func dragonTextExposed(_ t: DragonTextView) -> Bool {
  if !t.isAccessibilityElement || t.accessibilityLabel != t.dragonText || t.isHidden || t.alpha < 0.01 || t.accessibilityElementsHidden || t.window == nil { return false }
  if t.bounds.width <= 0 || t.bounds.height <= 0 { return false }
  var p = t.superview
  while let a = p {
    if a.isHidden || a.alpha < 0.01 || a.accessibilityElementsHidden || a.isAccessibilityElement { return false }
    p = a.superview
  }
  return true
}

/// The labels of the text views inside a box view that VoiceOver reaches, in subview preorder.
func dragonExposedTexts(_ v: UIView) -> [DumpJson] {
  var out: [DumpJson] = []
  for c in v.subviews {
    if let t = c as? DragonTextView {
      if dragonTextExposed(t) { out.append(.string(t.dragonText)) }
    } else {
      out.append(contentsOf: dragonExposedTexts(c))
    }
  }
  return out
}

public func dragonAppliedClip(_ v: DragonBoxView) -> DumpJsonObject {
  var out: DumpJsonObject = []
  if let c = v.dragonClipView {
    let s = v.dragonScale
    out.append(("dragonClip.frame", c.clipsToBounds ? .array([c.frame.minX, c.frame.minY, c.frame.width, c.frame.height].map { .number(dragonWholeDevicePx(Double($0) * s, "\(v.dragonId) clip") / s) }) : .null))
  }
  if v.dragonClipRectEmpty { out.append(("dragonClipRect.hidden", .number(v.isHidden ? 1 : 0))) }
  if !v.dragonClipPathInsets.isEmpty {
    let s = v.dragonScale
    let r = v.dragonClipPathRect
    out.append(("dragonClipPath.frame", v.layer.mask == nil || r.count != 4 ? .null : .array([r[0] / s, r[1] / s, (r[2] - r[0]) / s, (r[3] - r[1]) / s].map { .number($0) })))
  }
  if v.dragonClipShapeKind >= 0 {
    let s = v.dragonScale
    let g = v.dragonClipShapeGeometry
    let points = g.enumerated().map { (i, x) -> Double in v.dragonClipShapeKind == 2 && i == 0 ? x : x / s }
    out.append(("dragonClipPath.shape", (v.layer.mask as? CAShapeLayer)?.path == nil || g.isEmpty ? .null : .array(points.map { .number($0) })))
  }
  if v.dragonClipText { out.append(("dragonClipText.exposed", .array(dragonExposedTexts(v)))) }
  return out
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The view the children are hosted in over the padding box: a DragonClipView, or the scroll module's DragonScrollView. */
  var dragonClipView: DragonClipView? = null
    private set
  /** Overflow hidden: the children are hosted by a clip view over the padding box. */
  fun dragonEnableClip() {
    val c = dragonMakeContainer(context)
    addView(c)
    dragonClipView = c
  }
  /** Whether a clip rect() that is empty at every size hides the box (MASK-CLIP); set only by dragonClipRectEmpty. */
  var dragonClipRectEmpty = false
  /** clip-path: inset() (MASK-CLIP): the four edges (top, right, bottom, left) as px, percent pairs; null without one. */
  var dragonClipPathInsets: DoubleArray? = null
  /** The clip-path rect [left, top, right, bottom] in device px relative to the box, from the last layout; null without one. */
  var dragonClipPathRect: DoubleArray? = null
  /** clip-path: circle(), ellipse() or polygon() (MASK-CLIP): the shape (0 circle, 1 ellipse, 2 polygon), or -1 without one. */
  var dragonClipShapeKind = -1
  /** The shape's writer values (dragonSetClipShape). */
  var dragonClipShapeValues: DoubleArray? = null
  /** The shape's geometry in device px relative to the box, from the last layout (dragonClipShapeGeometry); null without one. */
  var dragonClipShapeGeometry: DoubleArray? = null
  /** The shape's path in device px relative to the box, from the last layout; null without one. */
  var dragonClipShapePath: android.graphics.Path? = null
  /** Whether the box has text under a clip-path or a gradient mask, whose accessibility the readback reports (dragonClipText). */
  var dragonClipText = false
  /** clip-path: the canvas is clipped around the box's own paint and its children's; the views' visibility is untouched. */
  override fun draw(canvas: Canvas) {
    val r = dragonClipPathRect
    val p = dragonClipShapePath
    // A gradient mask (gradient module) masks the whole draw: the box's own paint and every view inside it.
    if (dragonMaskLayer != null) {
      dragonDrawMasked(this, canvas, dragonShape) { super.draw(canvas) }
      return
    }
    if (r == null && p == null) {
      super.draw(canvas)
      return
    }
    val n = canvas.save()
    if (r != null) canvas.clipRect(r[0].toFloat(), r[1].toFloat(), r[2].toFloat(), r[3].toFloat())
    if (p != null) canvas.clipPath(p)
    super.draw(canvas)
    canvas.restoreToCount(n)
  }
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.view.View
import dev.dragon.dump.DumpJson

/** Whether the clip rect writer ignores the write; false except in the clip-rect-ignored plant build. */
const val DRAGON_CLIP_RECT_PLANT_IGNORED = false

/** The empty clip rect write of a box (runtime writer): the box view is invisible, and with it every view inside it. */
fun dragonClipRectEmpty(v: DragonBoxView) {
  if (DRAGON_CLIP_RECT_PLANT_IGNORED) return
  v.dragonClipRectEmpty = true
  v.visibility = View.INVISIBLE
}

/** Whether the clip-path writer ignores the write; false except in the clip-path-ignored plant build. */
const val DRAGON_CLIP_PATH_PLANT_IGNORED = false

/** The clip-path write of a box (runtime writer): its inset() edges; the after-layout hook sets the rect its draw clips to. */
fun dragonSetClipPath(v: DragonBoxView, insets: DoubleArray) {
  if (DRAGON_CLIP_PATH_PLANT_IGNORED) return
  if (insets.size != 8) throw IllegalStateException("dragon: " + v.dragonId + ": " + insets.size + " clip-path inset values, not 8")
  v.dragonClipPathInsets = insets
  v.invalidate()
}

/** The clip-path rect of a box in device px relative to it (left, top, right, bottom); zero when the insets leave nothing. */
fun dragonClipPathRectOf(insets: DoubleArray, shape: DragonBoxShape, scale: Double): DoubleArray {
  val e = shape.edges
  fun edge(k: Int, size: Double): Double = insets[2 * k] * scale + insets[2 * k + 1] / 100.0 * size
  val l = edge(3, shape.size[0])
  val t = edge(0, shape.size[1])
  val r = e[2] - e[0] - edge(1, shape.size[0])
  val b = e[3] - e[1] - edge(2, shape.size[1])
  return if (r <= l || b <= t) doubleArrayOf(0.0, 0.0, 0.0, 0.0) else doubleArrayOf(l, t, r, b)
}

/** The clip-path shape write of a box (runtime writer): its kind (0 circle, 1 ellipse, 2 polygon) and lengths; the after-layout hook */
/** sets the path its draw clips to. */
fun dragonSetClipShape(v: DragonBoxView, kind: Int, values: DoubleArray) {
  if (DRAGON_CLIP_PATH_PLANT_IGNORED) return
  val ok = if (kind == 0) values.size == 9 else if (kind == 1) values.size == 12 else kind == 2 && values.size >= 5 && (values.size - 1) % 4 == 0
  if (!ok) throw IllegalStateException("dragon: " + v.dragonId + ": clip-path shape " + kind + " with " + values.size + " values")
  v.dragonClipShapeKind = kind
  v.dragonClipShapeValues = values
  v.invalidate()
}

/** The geometry of a clip-path shape in device px relative to the box: circle [cx, cy, r], ellipse [cx, cy, rx, ry], polygon */
/** [evenodd, x0, y0, ...]. */
fun dragonClipShapeGeometry(kind: Int, s: DoubleArray, size: DoubleArray, scale: Double): DoubleArray {
  val w = size[0]
  val h = size[1]
  fun coord(i: Int, extent: Double): Double = if (s[i] == 1.0) extent - s[i + 1] * scale else s[i + 1] * scale + s[i + 2] / 100.0 * extent
  fun side(far: Boolean, c: Double, extent: Double): Double = if (far) Math.max(Math.abs(c), Math.abs(extent - c)) else Math.min(Math.abs(c), Math.abs(extent - c))
  if (kind == 2) {
    val out = DoubleArray(1 + (s.size - 1) / 2)
    out[0] = s[0]
    var i = 1
    var o = 1
    while (i < s.size) {
      out[o] = s[i] * scale + s[i + 1] / 100.0 * w
      out[o + 1] = s[i + 2] * scale + s[i + 3] / 100.0 * h
      i += 4
      o += 2
    }
    return out
  }
  val cx = coord(0, w)
  val cy = coord(3, h)
  if (kind == 0) {
    val r = if (s[6] == 0.0) s[7] * scale + s[8] / 100.0 * (Math.sqrt(w * w + h * h) / Math.sqrt(2.0)) else if (s[6] == 2.0) Math.max(side(true, cx, w), side(true, cy, h)) else Math.min(side(false, cx, w), side(false, cy, h))
    return doubleArrayOf(cx, cy, r)
  }
  val rx = if (s[6] == 0.0) s[7] * scale + s[8] / 100.0 * w else side(s[6] == 2.0, cx, w)
  val ry = if (s[9] == 0.0) s[10] * scale + s[11] / 100.0 * h else side(s[9] == 2.0, cy, h)
  return doubleArrayOf(cx, cy, rx, ry)
}

/** The path of a clip-path shape's geometry, in device px. */
fun dragonClipShapePathOf(kind: Int, g: DoubleArray): android.graphics.Path {
  val path = android.graphics.Path()
  if (kind == 2) {
    path.fillType = if (g[0] == 1.0) android.graphics.Path.FillType.EVEN_ODD else android.graphics.Path.FillType.WINDING
    var i = 1
    while (i + 1 < g.size) {
      if (i == 1) path.moveTo(g[i].toFloat(), g[i + 1].toFloat()) else path.lineTo(g[i].toFloat(), g[i + 1].toFloat())
      i += 2
    }
    path.close()
    return path
  }
  val rx = g[2]
  val ry = if (kind == 0) g[2] else g[3]
  path.addOval((g[0] - rx).toFloat(), (g[1] - ry).toFloat(), (g[0] + rx).toFloat(), (g[1] + ry).toFloat(), android.graphics.Path.Direction.CW)
  return path
}

/** After every layout: the clip view over the padding box, in device px relative to the box; the clip-path rect or shape. */
fun dragonAfterLayoutClip(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val insets = v.dragonClipPathInsets
  if (insets != null) {
    v.dragonClipPathRect = dragonClipPathRectOf(insets, shape, scale)
    v.invalidate()
  }
  val values = v.dragonClipShapeValues
  if (values != null) {
    val g = dragonClipShapeGeometry(v.dragonClipShapeKind, values, shape.size, scale)
    v.dragonClipShapeGeometry = g
    v.dragonClipShapePath = dragonClipShapePathOf(v.dragonClipShapeKind, g)
    v.invalidate()
  }
  val c = v.dragonClipView ?: return
  val e = shape.edges
  val px = shape.borders
  dragonSetFrame(c.dragonFrame, px[3], px[0], e[2] - e[0] - px[1], e[3] - e[1] - px[2], v.dragonId + " clip")
}

/** The readback of the clip module: the clip bounds in device px, or null when the clip view does not clip to its bounds. */
/** The empty clip rect's readback is 1 when the box view is invisible, or 0. */
/** The clip-text write of a box (runtime writer): it marks the box whose text views' accessibility the readback reports. */
fun dragonClipText(v: DragonBoxView) {
  v.dragonClipText = true
}

/** Whether TalkBack reaches a text view: its node is visible to the user and labelled with its text, and it is important for accessibility. */
fun dragonTextExposed(t: DragonTextView): Boolean {
  if (!t.isImportantForAccessibility || t.contentDescription?.toString() != t.dragonText) return false
  val info = t.createAccessibilityNodeInfo()
  return info.isVisibleToUser && info.contentDescription?.toString() == t.dragonText
}

/** The labels of the text views inside a box view that TalkBack reaches, in child preorder. */
fun dragonExposedTexts(v: android.view.ViewGroup): List<DumpJson> {
  val out = ArrayList<DumpJson>()
  for (i in 0 until v.childCount) {
    val c = v.getChildAt(i)
    if (c is DragonTextView) {
      if (dragonTextExposed(c)) out.add(DumpJson.Str(c.dragonText))
    } else if (c is android.view.ViewGroup) {
      out.addAll(dragonExposedTexts(c))
    }
  }
  return out
}

fun dragonAppliedClip(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val out = ArrayList<Pair<String, DumpJson>>()
  val c = v.dragonClipView
  if (c != null) {
    val b = c.clipBounds
    out.add(Pair("dragonClip.clipBounds", if (b == null || b.left != 0 || b.top != 0 || b.right != c.width || b.bottom != c.height) DumpJson.Null else DumpJson.Arr(listOf(c.left, c.top, c.right, c.bottom).map { DumpJson.Num(it.toDouble()) })))
  }
  if (v.dragonClipRectEmpty) out.add(Pair("dragonClipRect.hidden", DumpJson.Num(if (v.visibility == View.INVISIBLE) 1.0 else 0.0)))
  if (v.dragonClipPathInsets != null) {
    val r = v.dragonClipPathRect
    out.add(Pair("dragonClipPath.rect", if (r == null) DumpJson.Null else DumpJson.Arr(r.map { DumpJson.Num(it) })))
  }
  if (v.dragonClipShapeValues != null) {
    val g = v.dragonClipShapeGeometry
    out.add(Pair("dragonClipPath.shape", if (g == null || v.dragonClipShapePath == null) DumpJson.Null else DumpJson.Arr(g.map { DumpJson.Num(it) })))
  }
  if (v.dragonClipText) out.add(Pair("dragonClipText.exposed", DumpJson.Arr(dragonExposedTexts(v))))
  return out
}
`;

/** The eight writer values of inset() edges (top, right, bottom, left), each as px then percent. */
export function clipPathInsets(edges: readonly InsetEdge[]): number[] {
  if (edges.length !== 4) throw new Error(`clip-path has ${edges.length} inset edges, not 4`);
  return edges.flatMap((e) => {
    if (!Number.isFinite(e.value) || (e.unit !== 'px' && e.unit !== '%')) throw new Error(`clip-path edge ${e.value}${e.unit} is not a finite px or % value`);
    return e.unit === 'px' ? [e.value, 0] : [0, e.value];
  });
}

/**
 * The clip-path rect of a box in device px relative to its snapped border box (left, top, right, bottom), as the device computes it
 * (dragonClipPathRectOf, in the same order of operations): each edge is px times the scale plus its percentage of the layout height
 * (top, bottom) or width; [0, 0, 0, 0] when the insets leave nothing.
 */
export function clipPathRect(insets: readonly number[], box: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }, size: readonly [number, number], dpr: number): [number, number, number, number] {
  const edge = (k: number, extent: number): number => (insets[2 * k] as number) * dpr + ((insets[2 * k + 1] as number) / 100) * extent;
  const l = edge(3, size[0]);
  const t = edge(0, size[1]);
  const r = box.right - box.left - edge(1, size[0]);
  const b = box.bottom - box.top - edge(2, size[1]);
  return r <= l || b <= t ? [0, 0, 0, 0] : [l, t, r, b];
}

type Shape = Exclude<ClipShape, { readonly kind: 'inset' }>;

const lengthPair = (l: ShapeLength): [number, number] => {
  if (!Number.isFinite(l.value) || (l.unit !== 'px' && l.unit !== '%')) throw new Error(`clip-path length ${l.value}${l.unit} is not a finite px or % value`);
  return l.unit === 'px' ? [l.value, 0] : [0, l.value];
};
const centred: ShapeCoord = { from: 'start', offset: { value: 50, unit: '%' } };
const coordValues = (c: ShapeCoord): number[] => [c.from === 'end' ? 1 : 0, ...lengthPair(c.offset)];
const radiusValues = (r: ShapeRadius): number[] => (r === 'closest-side' ? [1, 0, 0] : r === 'farthest-side' ? [2, 0, 0] : [0, ...lengthPair(r)]);

/** The writer kind of a clip-path shape: 0 circle, 1 ellipse, 2 polygon. */
export const clipShapeKind = (shape: Shape): number => (shape.kind === 'circle' ? 0 : shape.kind === 'ellipse' ? 1 : 2);

/**
 * The writer values of a clip-path shape: a coordinate is [from (0 left or top, 1 right or bottom), px, percent], a radius
 * [0 length, 1 closest-side or 2 farthest-side, px, percent]; circle [cx, cy, r] (9), ellipse [cx, cy, rx, ry] (12), polygon
 * [evenodd, then x px, x percent, y px, y percent per point]. A circle or ellipse without a position is centred.
 */
export function clipShapeValues(shape: Shape): number[] {
  if (shape.kind === 'polygon') return [shape.evenodd ? 1 : 0, ...shape.points.flatMap(([x, y]) => [...lengthPair(x), ...lengthPair(y)])];
  const [x, y] = shape.at ?? [centred, centred];
  const radii = shape.kind === 'circle' ? radiusValues(shape.radius) : [...radiusValues(shape.radii[0]), ...radiusValues(shape.radii[1])];
  return [...coordValues(x), ...coordValues(y), ...radii];
}

/**
 * The geometry of a clip-path shape in device px relative to its border box, as the device computes it (dragonClipShapeGeometry,
 * in the same order of operations), against the layout size: circle [cx, cy, r], ellipse [cx, cy, rx, ry], polygon [evenodd, x0,
 * y0, ...]. A circle's percentage radius is of the normalized diagonal (css-shapes-1 §3.1); closest-side and farthest-side are the
 * nearest and farthest of the box's sides from the centre (a circle's of all four, an ellipse's of the two on its axis).
 */
export function clipShapeGeometry(kind: number, s: readonly number[], size: readonly [number, number], dpr: number): number[] {
  const [w, h] = size;
  const v = (i: number): number => s[i] as number;
  const coord = (i: number, extent: number): number => (v(i) === 1 ? extent - v(i + 1) * dpr : v(i + 1) * dpr + (v(i + 2) / 100) * extent);
  const side = (far: boolean, c: number, extent: number): number => (far ? Math.max(Math.abs(c), Math.abs(extent - c)) : Math.min(Math.abs(c), Math.abs(extent - c)));
  if (kind === 2) {
    const out = [v(0)];
    for (let i = 1; i < s.length; i += 4) out.push(v(i) * dpr + (v(i + 1) / 100) * w, v(i + 2) * dpr + (v(i + 3) / 100) * h);
    return out;
  }
  const cx = coord(0, w);
  const cy = coord(3, h);
  if (kind === 0) {
    const r = v(6) === 0 ? v(7) * dpr + (v(8) / 100) * (Math.sqrt(w * w + h * h) / Math.sqrt(2)) : v(6) === 2 ? Math.max(side(true, cx, w), side(true, cy, h)) : Math.min(side(false, cx, w), side(false, cy, h));
    return [cx, cy, r];
  }
  const rx = v(6) === 0 ? v(7) * dpr + (v(8) / 100) * w : side(v(6) === 2, cx, w);
  const ry = v(9) === 0 ? v(10) * dpr + (v(11) / 100) * h : side(v(9) === 2, cy, h);
  return [cx, cy, rx, ry];
}

const swiftNumber = (n: number): string => {
  const t = String(n);
  return /[.eE]/.test(t) ? t : `${t}.0`;
};

export const CLIP_EMITTER: PaintEmitter<'padding-box-clip' | 'clip-rect-empty' | 'clip-path-inset' | 'clip-path-shape' | 'clip-text', 'clip-rect-ignored' | 'clip-path-ignored'> = {
  name: 'clip',
  kinds: ['padding-box-clip', 'clip-rect-empty', 'clip-path-inset', 'clip-path-shape', 'clip-text'],
  lines: {
    uikit: (v, _n, w) => [
      w.kind === 'clip-text' ? `  dragonClipText(${v})`
        : w.kind === 'clip-path-shape' ? `  dragonSetClipShape(${v}, ${clipShapeKind(w.shape)}, [${clipShapeValues(w.shape).map(swiftNumber).join(', ')}])`
        : w.kind === 'clip-path-inset' ? `  dragonSetClipPath(${v}, [${clipPathInsets(w.edges).map(swiftNumber).join(', ')}])` : w.kind === 'clip-rect-empty' ? `  dragonClipRectEmpty(${v})` : `  ${v}.dragonEnableClip()`,
    ],
    'android-views': (v, _n, w) => [
      w.kind === 'clip-text' ? `  dragonClipText(${v})`
        : w.kind === 'clip-path-shape' ? `  dragonSetClipShape(${v}, ${clipShapeKind(w.shape)}, doubleArrayOf(${clipShapeValues(w.shape).map(swiftNumber).join(', ')}))`
        : w.kind === 'clip-path-inset' ? `  dragonSetClipPath(${v}, doubleArrayOf(${clipPathInsets(w.edges).map(swiftNumber).join(', ')}))` : w.kind === 'clip-rect-empty' ? `  dragonClipRectEmpty(${v})` : `  ${v}.dragonEnableClip()`,
    ],
  },
  applied: (_e, backend, w, dpr, g) => {
    // The box view hidden.
    if (w.kind === 'clip-rect-empty') return 1;
    // Every visible text leaf stays accessible.
    if (w.kind === 'clip-text') return [...w.texts];
    if (w.kind === 'clip-path-shape') {
      const kind = clipShapeKind(w.shape);
      const geometry = clipShapeGeometry(kind, clipShapeValues(w.shape), g.size, dpr);
      // UIKit reads back points; the polygon's fill rule flag stays as it is.
      return backend === 'uikit' ? geometry.map((x, i) => (kind === 2 && i === 0 ? x : x / dpr)) : geometry;
    }
    if (w.kind === 'clip-path-inset') {
      const [l, t, r, b] = clipPathRect(clipPathInsets(w.edges), g.box, g.size, dpr);
      return backend === 'uikit' ? [l / dpr, t / dpr, (r - l) / dpr, (b - t) / dpr] : [l, t, r, b];
    }
    const [bt, br, bb, bl] = g.border;
    const width = g.box.right - g.box.left;
    const height = g.box.bottom - g.box.top;
    return backend === 'uikit' ? [bl / dpr, bt / dpr, (width - bl - br) / dpr, (height - bt - bb) / dpr] : [bl, bt, width - br, height - bb];
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, afterLayout: 'dragonAfterLayoutClip', applied: 'dragonAppliedClip' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutClip', applied: 'dragonAppliedClip' },
  },
  plants: [
    {
      name: 'clip-rect-ignored',
      replace: {
        uikit: ['public let dragonClipRectPlantIgnored = false\n', 'public let dragonClipRectPlantIgnored = true\n'],
        'android-views': ['const val DRAGON_CLIP_RECT_PLANT_IGNORED = false\n', 'const val DRAGON_CLIP_RECT_PLANT_IGNORED = true\n'],
      },
    },
    {
      name: 'clip-path-ignored',
      replace: {
        uikit: ['public let dragonClipPathPlantIgnored = false\n', 'public let dragonClipPathPlantIgnored = true\n'],
        'android-views': ['const val DRAGON_CLIP_PATH_PLANT_IGNORED = false\n', 'const val DRAGON_CLIP_PATH_PLANT_IGNORED = true\n'],
      },
    },
  ],
};
