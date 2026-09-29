// border-radius on the box view (T046 §1): the case code writes the eight authored components through dragonSetRadii; after every
// layout the translated paint-radius.ts resolves them against the snapped border box at the device scale. The rounded outer and
// padding-edge paths (the roundedPath registration point) are what the background and border stages draw and what an overflow
// clip masks its children with: a CAShapeLayer mask on UIKit, the clip view's outline (API 33 and up) or an overlay mask (API
// 31 and 32) on Android.
import type { RadiusLengthValue } from '../../lower/paint/radius.ts';
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const lengthLit = (backend: 'swift' | 'kotlin', l: RadiusLengthValue): string => {
  if (!Number.isFinite(l.value) || l.value < 0) throw new Error(`radius component ${l.value} is not a finite non-negative number`);
  const n = String(l.value);
  return `RadiusLength(${l.percent ? 'true' : 'false'}, ${/[.eE]/.test(n) ? n : `${n}.0`})`;
};

const SWIFT_MEMBERS = String.raw`  /// The eight authored radius components (horizontal then vertical, top-left first); empty for square corners.
  public var dragonRadiusLengths: [RadiusLength] = []
`;

const SWIFT = String.raw`import UIKit

/// true only in the radius-square raster plant build: the device ignores the radii and draws square corners.
public let dragonRadiusPlantSquare: Bool = false

/// The radius write of a box (runtime writer): the eight components, then every after-layout hook re-applies the shape.
public func dragonSetRadii(_ v: DragonBoxView, _ lengths: [RadiusLength]) {
  if lengths.count != 8 { fatalError("dragon: \(v.dragonId): \(lengths.count) radius components, not 8") }
  v.dragonRadiusLengths = lengths
  dragonAfterLayout(v, v.dragonShape, v.dragonScale)
  v.setNeedsDisplay()
}

/// The rounded shape of a box at a shape: the outer radii then the padding-edge radii (device px), from the translated
/// paint-radius.ts at the box's device scale; nil when the box has no radius write.
public func dragonRadiusShape(_ v: DragonBoxView, _ shape: DragonBoxShape) -> [Double]? {
  if v.dragonRadiusLengths.isEmpty { return nil }
  let e = shape.edges
  do {
    let r = try paintRadius_roundedShape(e[0], e[1], e[2], e[3], JsArray(shape.borders), JsArray(v.dragonRadiusLengths), v.dragonScale, RadiusFaults(false, false)).items
    if r.count != 16 { fatalError("dragon: \(v.dragonId): paint-radius gave \(r.count) radii, not 16") }
    return r
  } catch {
    fatalError("dragon: \(v.dragonId): paint-radius failed: \(error)")
  }
}

/// A rounded rect path in points from a rect in points and eight radii in device px; a corner with a zero component is square.
/// Each elliptical quarter is one cubic (kappa 0.5522847498), within 0.03% of the radius of the true ellipse.
public func dragonRRectPath(_ rect: CGRect, _ radii: [Double], _ scale: Double) -> CGPath {
  let k: CGFloat = 0.5522847498
  var rx = [CGFloat](repeating: 0, count: 4)
  var ry = [CGFloat](repeating: 0, count: 4)
  for c in 0..<4 where radii[c] > 0 && radii[c + 4] > 0 {
    rx[c] = CGFloat(radii[c] / scale)
    ry[c] = CGFloat(radii[c + 4] / scale)
  }
  let l = rect.minX, t = rect.minY, r = rect.maxX, b = rect.maxY
  let p = CGMutablePath()
  p.move(to: CGPoint(x: l + rx[0], y: t))
  p.addLine(to: CGPoint(x: r - rx[1], y: t))
  p.addCurve(to: CGPoint(x: r, y: t + ry[1]), control1: CGPoint(x: r - rx[1] + k * rx[1], y: t), control2: CGPoint(x: r, y: t + ry[1] - k * ry[1]))
  p.addLine(to: CGPoint(x: r, y: b - ry[2]))
  p.addCurve(to: CGPoint(x: r - rx[2], y: b), control1: CGPoint(x: r, y: b - ry[2] + k * ry[2]), control2: CGPoint(x: r - rx[2] + k * rx[2], y: b))
  p.addLine(to: CGPoint(x: l + rx[3], y: b))
  p.addCurve(to: CGPoint(x: l, y: b - ry[3]), control1: CGPoint(x: l + rx[3] - k * rx[3], y: b), control2: CGPoint(x: l, y: b - ry[3] + k * ry[3]))
  p.addLine(to: CGPoint(x: l, y: t + ry[0]))
  p.addCurve(to: CGPoint(x: l + rx[0], y: t), control1: CGPoint(x: l, y: t + ry[0] - k * ry[0]), control2: CGPoint(x: l + rx[0] - k * rx[0], y: t))
  p.closeSubpath()
  return p
}

/// The roundedPath registration point: the border-box path (inner false) or the padding-edge path (inner true) in the view's
/// points, or nil when no corner of the border box is rounded (the stages then draw and clip the rectangle).
public func dragonRoundedPathRadius(_ v: DragonBoxView, _ shape: DragonBoxShape, _ inner: Bool) -> CGPath? {
  if dragonRadiusPlantSquare { return nil }
  guard let r = dragonRadiusShape(v, shape) else { return nil }
  if !(0..<4).contains(where: { r[$0] > 0 && r[$0 + 4] > 0 }) { return nil }
  let s = v.dragonScale
  let e = shape.edges
  let px = shape.borders
  let w = e[2] - e[0]
  let h = e[3] - e[1]
  if !inner { return dragonRRectPath(CGRect(x: 0, y: 0, width: CGFloat(w / s), height: CGFloat(h / s)), Array(r[0..<8]), s) }
  let rect = CGRect(x: CGFloat(px[3] / s), y: CGFloat(px[0] / s), width: CGFloat(max(w - px[3] - px[1], 0) / s), height: CGFloat(max(h - px[0] - px[2], 0) / s))
  return dragonRRectPath(rect, Array(r[8..<16]), s)
}

/// After every layout: the resolved radii on the shape, the background (native or rounded, background module), and the overflow
/// clip's mask (the padding-edge path in the clip view's coordinates), with implicit layer actions disabled.
public func dragonAfterLayoutRadius(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let r = dragonRadiusShape(v, shape) else { return }
  v.dragonShape.radii = Array(r[0..<8])
  dragonSyncBackground(v)
  guard let c = v.dragonClipView else { return }
  CATransaction.begin()
  CATransaction.setDisableActions(true)
  if let inner = dragonRoundedPath(v, shape, inner: true) {
    var shift = CGAffineTransform(translationX: -CGFloat(shape.borders[3] / scale), y: -CGFloat(shape.borders[0] / scale))
    let m = (c.layer.mask as? CAShapeLayer) ?? CAShapeLayer()
    m.frame = c.bounds
    m.path = inner.copy(using: &shift)
    c.layer.mask = m
  } else {
    c.layer.mask = nil
  }
  CATransaction.commit()
}

/// The readback of the radius module: the resolved outer radii in device px.
public func dragonAppliedRadius(_ v: DragonBoxView) -> DumpJsonObject {
  if v.dragonRadiusLengths.isEmpty { return [] }
  return [("dragonRadius.radiiPx", .array(v.dragonShape.radii.map { .number($0) }))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The eight authored radius components (horizontal then vertical, top-left first); empty for square corners. */
  var dragonRadiusLengths: Array<dev.dragon.layout.RadiusLength> = emptyArray()
  /** The device scale of the last layout, which fixed radius lengths are zoomed by. */
  var dragonRadiusScale = 1.0
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.View
import android.view.ViewOutlineProvider
import dev.dragon.dump.DumpJson
import dev.dragon.layout.JsArray
import dev.dragon.layout.RadiusFaults
import dev.dragon.layout.RadiusLength
import dev.dragon.layout.paintRadius_roundedShape

/** true only in the radius-square raster plant build: the device ignores the radii and draws square corners. */
const val DRAGON_RADIUS_PLANT_SQUARE = false

/** The radius write of a box (runtime writer): the eight components, then every after-layout hook re-applies the shape. */
fun dragonSetRadii(v: DragonBoxView, lengths: Array<RadiusLength>) {
  if (lengths.size != 8) throw IllegalStateException("dragon: " + v.dragonId + ": " + lengths.size + " radius components, not 8")
  v.dragonRadiusLengths = lengths
  dragonAfterLayout(v, v.dragonShape, v.dragonRadiusScale)
  v.invalidate()
}

/**
 * The rounded shape of a box at a shape: the outer radii then the padding-edge radii (device px), from the translated
 * paint-radius.ts at the box's device scale; null when the box has no radius write.
 */
fun dragonRadiusShape(v: DragonBoxView, shape: DragonBoxShape): DoubleArray? {
  if (v.dragonRadiusLengths.isEmpty()) return null
  val e = shape.edges
  val r = paintRadius_roundedShape(e[0], e[1], e[2], e[3], JsArray(shape.borders.toMutableList()), JsArray(v.dragonRadiusLengths.toMutableList()), v.dragonRadiusScale, RadiusFaults(false, false))
  if (r.size != 16) throw IllegalStateException("dragon: " + v.dragonId + ": paint-radius gave " + r.size + " radii, not 16")
  return r.toDoubleArray()
}

/** A rounded rect path in device px from a rect and eight radii in device px (horizontal then vertical, top-left first). */
fun dragonRRectPath(rect: RectF, radii: DoubleArray, from: Int): Path {
  val a = FloatArray(8)
  for (c in 0 until 4) {
    val x = radii[from + c]
    val y = radii[from + c + 4]
    if (x > 0.0 && y > 0.0) {
      a[2 * c] = x.toFloat()
      a[2 * c + 1] = y.toFloat()
    }
  }
  val p = Path()
  p.addRoundRect(rect, a, Path.Direction.CW)
  return p
}

/**
 * The roundedPath registration point: the border-box path (inner false) or the padding-edge path (inner true) in the view's
 * device px, or null when no corner of the border box is rounded (the stages then draw and clip the rectangle).
 */
fun dragonRoundedPathRadius(v: DragonBoxView, shape: DragonBoxShape, inner: Boolean): Path? {
  if (DRAGON_RADIUS_PLANT_SQUARE) return null
  val r = dragonRadiusShape(v, shape) ?: return null
  if ((0 until 4).none { r[it] > 0.0 && r[it + 4] > 0.0 }) return null
  val e = shape.edges
  val px = shape.borders
  val w = e[2] - e[0]
  val h = e[3] - e[1]
  if (!inner) return dragonRRectPath(RectF(0f, 0f, w.toFloat(), h.toFloat()), r, 0)
  return dragonRRectPath(RectF(px[3].toFloat(), px[0].toFloat(), maxOf(w - px[1], px[3]).toFloat(), maxOf(h - px[2], px[0]).toFloat()), r, 8)
}

/** API 31 and 32: masks a clip view's children outside a path (DST_OUT over the inverse path, in the view's hardware layer). */
class DragonRoundedClipMask(private val path: Path) : Drawable() {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT) }
  init { path.fillType = Path.FillType.INVERSE_WINDING }
  override fun draw(canvas: Canvas) { canvas.drawPath(path, paint) }
  override fun setAlpha(alpha: Int) {}
  override fun setColorFilter(colorFilter: ColorFilter?) {}
  @Deprecated("Drawable.getOpacity is deprecated in the platform")
  override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}

/**
 * After every layout: the device scale, the resolved radii on the shape, the background (native or rounded, background module),
 * and the overflow clip (the padding-edge path in the clip view's coordinates): the clip view's outline on API 33 and up, where
 * Outline clips to any path; an overlay mask in a hardware layer on API 31 and 32.
 */
fun dragonAfterLayoutRadius(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  if (v.dragonRadiusLengths.isEmpty()) return
  v.dragonRadiusScale = scale
  val r = dragonRadiusShape(v, shape) ?: return
  for (i in 0 until 8) shape.radii[i] = r[i]
  dragonSyncBackground(v)
  val c = v.dragonClipView ?: return
  val inner = dragonRoundedPath(v, shape, true)
  if (inner == null) {
    c.clipToOutline = false
    c.outlineProvider = ViewOutlineProvider.BACKGROUND
    c.overlay.clear()
    c.setLayerType(View.LAYER_TYPE_NONE, null)
    return
  }
  inner.offset(-shape.borders[3].toFloat(), -shape.borders[0].toFloat())
  if (Build.VERSION.SDK_INT >= 33) {
    c.outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) { outline.setPath(inner) }
    }
    c.clipToOutline = true
    c.invalidateOutline()
  } else {
    val mask = DragonRoundedClipMask(inner)
    mask.setBounds(0, 0, c.dragonFrame[2] - c.dragonFrame[0], c.dragonFrame[3] - c.dragonFrame[1])
    c.setLayerType(View.LAYER_TYPE_HARDWARE, null)
    c.overlay.clear()
    c.overlay.add(mask)
  }
}

/** The readback of the radius module: the resolved outer radii in device px. */
fun dragonAppliedRadius(v: DragonBoxView): List<Pair<String, DumpJson>> {
  if (v.dragonRadiusLengths.isEmpty()) return emptyList()
  return listOf(Pair("dragonRadius.radiiPx", DumpJson.Arr(v.dragonShape.radii.map { DumpJson.Num(it) })))
}
`;

export const RADIUS_EMITTER: PaintEmitter<'border-radius'> = {
  name: 'radius',
  kinds: ['border-radius'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetRadii(${v}, [${w.lengths.map((l) => lengthLit('swift', l)).join(', ')}])`],
    'android-views': (v, _n, w) => [`  dragonSetRadii(${v}, arrayOf(${w.lengths.map((l) => lengthLit('kotlin', l)).join(', ')}))`],
  },
  applied: (engine, _backend, w, dpr, g) => {
    const [bt, br, bb, bl] = g.border;
    const r = engine.paint.roundedShape(g.box.left, g.box.top, g.box.right, g.box.bottom, [bt, br, bb, bl], w.lengths, dpr, { radiusUnclamped: false, innerRadiusNotReduced: false });
    return r.slice(0, 8);
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, afterLayout: 'dragonAfterLayoutRadius', applied: 'dragonAppliedRadius', roundedPath: 'dragonRoundedPathRadius' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutRadius', applied: 'dragonAppliedRadius', roundedPath: 'dragonRoundedPathRadius' },
  },
  plants: [
    {
      name: 'radius-square',
      replace: {
        uikit: ['public let dragonRadiusPlantSquare: Bool = false\n', 'public let dragonRadiusPlantSquare: Bool = true\n'],
        'android-views': ['const val DRAGON_RADIUS_PLANT_SQUARE = false\n', 'const val DRAGON_RADIUS_PLANT_SQUARE = true\n'],
      },
    },
  ],
};
