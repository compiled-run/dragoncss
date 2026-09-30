// The four border sides: Dragon-owned paint on the box view (the border stage). Widths come from the engine at the device scale
// through the after-layout hook; styles and colours are written by the case code through the view's public setters.
import type { PaintEmitter } from './types.ts';
import { keywordLit, NO_NATIVE_PAINT, rgbaLit } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// Points, top right bottom left: the engine's device px at the device scale / scale.
  public var dragonBorderWidths: [Double] = [0, 0, 0, 0] { didSet { setNeedsDisplay() } }
  public var dragonBorderStyles: [String] = ["none", "none", "none", "none"] { didSet { setNeedsDisplay() } }
  public var dragonBorderColors: [DragonRGBA8] = [DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0)] { didSet { setNeedsDisplay() } }
`;

const SWIFT = String.raw`import UIKit

/// The border stage: the four sides over the box's bounds, between the rounded border-box and padding-edge paths when the radius
/// module rounds the box.
public func dragonPaintBorderStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  if let outer = dragonRoundedPath(v, shape, inner: false), let inner = dragonRoundedPath(v, shape, inner: true) {
    let r = dragonRadiusShape(v, shape) ?? [Double](repeating: 0, count: 16)
    dragonDrawRoundedBorders(ctx, v.bounds, outer, inner, r[8..<16].map { CGFloat($0 / v.dragonScale) }, v.dragonBorderWidths.map { CGFloat($0) }, v.dragonBorderStyles, v.dragonBorderColors)
    return
  }
  dragonDrawBorders(ctx, v.bounds, v.dragonBorderWidths.map { CGFloat($0) }, v.dragonBorderStyles, v.dragonBorderColors)
}

/// Blink BoxBorderPainter FindIntersection: where line p1-p2 meets line d1-d2; p2 when they are parallel.
public func dragonIntersect(_ p1: CGPoint, _ p2: CGPoint, _ d1: CGPoint, _ d2: CGPoint) -> CGPoint {
  let px = p2.x - p1.x, py = p2.y - p1.y, dx = d2.x - d1.x, dy = d2.y - d1.y
  let denom = px * dy - py * dx
  if denom == 0 { return p2 }
  let t = ((d1.x - p1.x) * dy - (d1.y - p1.y) * dx) / denom
  return CGPoint(x: p1.x + t * px, y: p1.y + t * py)
}

/// Blink ClipBorderSidePolygon's edge quad of side k (top, right, bottom, left): outer corner, inner corner, inner corner, outer
/// corner, each inner corner moved along its corner diagonal to the chord of a rounded inner corner (ir: the eight padding-edge
/// radii in points, horizontal then vertical, top-left first), so a side owns its corner of the ring up to that chord.
public func dragonBorderEdgeQuad(_ k: Int, _ o: CGRect, _ i: CGRect, _ ir: [CGFloat]) -> [CGPoint] {
  let round = { (c: Int) -> Bool in ir[c] > 0 && ir[c + 4] > 0 }
  func P(_ x: CGFloat, _ y: CGFloat) -> CGPoint { return CGPoint(x: x, y: y) }
  var e: [CGPoint]
  switch k {
  case 0:
    e = [P(o.minX, o.minY), P(i.minX, i.minY), P(i.maxX, i.minY), P(o.maxX, o.minY)]
    if round(0) { e[1] = dragonIntersect(e[0], e[1], P(e[1].x + ir[0], e[1].y), P(e[1].x, e[1].y + ir[4])) }
    if round(1) { e[2] = dragonIntersect(e[3], e[2], P(e[2].x - ir[1], e[2].y), P(e[2].x, e[2].y + ir[5])) }
  case 1:
    e = [P(o.maxX, o.minY), P(i.maxX, i.minY), P(i.maxX, i.maxY), P(o.maxX, o.maxY)]
    if round(1) { e[1] = dragonIntersect(e[0], e[1], P(e[1].x - ir[1], e[1].y), P(e[1].x, e[1].y + ir[5])) }
    if round(2) { e[2] = dragonIntersect(e[3], e[2], P(e[2].x - ir[2], e[2].y), P(e[2].x, e[2].y - ir[6])) }
  case 2:
    e = [P(o.maxX, o.maxY), P(i.maxX, i.maxY), P(i.minX, i.maxY), P(o.minX, o.maxY)]
    if round(2) { e[1] = dragonIntersect(e[0], e[1], P(e[1].x - ir[2], e[1].y), P(e[1].x, e[1].y - ir[6])) }
    if round(3) { e[2] = dragonIntersect(e[3], e[2], P(e[2].x + ir[3], e[2].y), P(e[2].x, e[2].y - ir[7])) }
  default:
    e = [P(o.minX, o.maxY), P(i.minX, i.maxY), P(i.minX, i.minY), P(o.minX, o.minY)]
    if round(3) { e[1] = dragonIntersect(e[0], e[1], P(e[1].x + ir[3], e[1].y), P(e[1].x, e[1].y - ir[7])) }
    if round(0) { e[2] = dragonIntersect(e[3], e[2], P(e[2].x + ir[0], e[2].y), P(e[2].x, e[2].y + ir[4])) }
  }
  return e
}

/// Rounded solid borders (PNT1): the ring between the border-box and padding-edge paths, filled even-odd; four sides of one colour
/// fill it once (Blink's FillDRRect), otherwise each side fills its part of the ring clipped to its Blink edge quad (the corner
/// diagonals, carried to the chords of the rounded inner corners). Rounded dashed, dotted and double sides are refused at compile
/// time (PNT1b), so meeting one here is a fault.
public func dragonDrawRoundedBorders(_ ctx: CGContext, _ o: CGRect, _ outer: CGPath, _ inner: CGPath, _ ir: [CGFloat], _ w: [CGFloat], _ styles: [String], _ colors: [DragonRGBA8]) {
  if ir.count != 8 { fatalError("dragon: \(ir.count) inner radii, not 8") }
  var visible: [Int] = []
  for k in 0..<4 {
    if w[k] <= 0 || styles[k] == "none" || styles[k] == "hidden" || colors[k].a == 0 { continue }
    if styles[k] != "solid" { fatalError("dragon: a rounded \(styles[k]) border is PNT1b, which the compiler refuses") }
    visible.append(k)
  }
  if visible.isEmpty { return }
  let ring = CGMutablePath()
  ring.addPath(outer)
  ring.addPath(inner)
  if visible.count == 4 && visible.allSatisfy({ colors[$0] == colors[0] }) {
    ctx.saveGState()
    ctx.addPath(ring)
    ctx.setFillColor(dragonUIColor(colors[0]).cgColor)
    ctx.fillPath(using: .evenOdd)
    ctx.restoreGState()
    return
  }
  let i = CGRect(x: o.minX + w[3], y: o.minY + w[0], width: o.width - w[3] - w[1], height: o.height - w[0] - w[2])
  for k in visible {
    ctx.saveGState()
    let q = CGMutablePath()
    q.addLines(between: dragonBorderEdgeQuad(k, o, i, ir))
    q.closeSubpath()
    ctx.addPath(q)
    ctx.clip()
    ctx.addPath(ring)
    ctx.setFillColor(dragonUIColor(colors[k]).cgColor)
    ctx.fillPath(using: .evenOdd)
    ctx.restoreGState()
  }
}

/// After every layout: the side widths in points from the engine's device px.
public func dragonAfterLayoutBorder(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  v.dragonBorderWidths = shape.borders.map { $0 / scale }
}

/// The readback of the border module: widths in points, styles and colours.
public func dragonAppliedBorder(_ v: DragonBoxView) -> DumpJsonObject {
  return [
    ("dragonBorder.widths", .array(v.dragonBorderWidths.map { .number($0) })),
    ("dragonBorder.styles", .array(v.dragonBorderStyles.map { .string($0) })),
    ("dragonBorder.colors", .array(v.dragonBorderColors.map(dragonRGBAJson))),
  ]
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
`;

const KOTLIN_MEMBERS = String.raw`  /** Whole device px, top right bottom left, from the engine at the device scale. */
  var dragonBorderWidths = intArrayOf(0, 0, 0, 0)
    set(value) { field = value; invalidate() }
  var dragonBorderStyles = arrayOf("none", "none", "none", "none")
    set(value) { field = value; invalidate() }
  var dragonBorderColors = arrayOf(DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0))
    set(value) { field = value; invalidate() }
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import dev.dragon.dump.DumpJson

/**
 * The border stage: the four sides over the box's size, between the rounded border-box and padding-edge paths when the radius
 * module rounds the box.
 */
fun dragonPaintBorderStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  val outer = dragonRoundedPath(v, shape, false)
  val inner = dragonRoundedPath(v, shape, true)
  if (outer != null && inner != null) {
    val r = dragonRadiusShape(v, shape) ?: DoubleArray(16)
    dragonDrawRoundedBorders(canvas, v.width.toFloat(), v.height.toFloat(), outer, inner, FloatArray(8) { r[8 + it].toFloat() }, v.dragonBorderWidths, v.dragonBorderStyles, v.dragonBorderColors)
    return
  }
  dragonDrawBorders(canvas, v.width.toFloat(), v.height.toFloat(), v.dragonBorderWidths, v.dragonBorderStyles, v.dragonBorderColors)
}

/** Blink BoxBorderPainter FindIntersection: where line p1-p2 meets line d1-d2 (x, y pairs); p2 when they are parallel. */
fun dragonIntersect(p1x: Float, p1y: Float, p2x: Float, p2y: Float, d1x: Float, d1y: Float, d2x: Float, d2y: Float): FloatArray {
  val px = p2x - p1x
  val py = p2y - p1y
  val dx = d2x - d1x
  val dy = d2y - d1y
  val denom = px * dy - py * dx
  if (denom == 0f) return floatArrayOf(p2x, p2y)
  val t = ((d1x - p1x) * dy - (d1y - p1y) * dx) / denom
  return floatArrayOf(p1x + t * px, p1y + t * py)
}

/**
 * Blink ClipBorderSidePolygon's edge quad of side k (top, right, bottom, left) as x, y pairs: outer corner, inner corner, inner
 * corner, outer corner, each inner corner moved along its corner diagonal to the chord of a rounded inner corner (ir: the eight
 * padding-edge radii in device px, horizontal then vertical, top-left first), so a side owns its corner of the ring up to that chord.
 */
fun dragonBorderEdgeQuad(k: Int, w: Float, h: Float, t: Float, r: Float, b: Float, l: Float, ir: FloatArray): FloatArray {
  fun round(c: Int): Boolean = ir[c] > 0f && ir[c + 4] > 0f
  val e = when (k) {
    0 -> floatArrayOf(0f, 0f, l, t, w - r, t, w, 0f)
    1 -> floatArrayOf(w, 0f, w - r, t, w - r, h - b, w, h)
    2 -> floatArrayOf(w, h, w - r, h - b, l, h - b, 0f, h)
    else -> floatArrayOf(0f, h, l, h - b, l, t, 0f, 0f)
  }
  // The rounded corners at the quad's inner points 1 and 2, and the direction of each radius from that point.
  val corners = when (k) { 0 -> intArrayOf(0, 1); 1 -> intArrayOf(1, 2); 2 -> intArrayOf(2, 3); else -> intArrayOf(3, 0) }
  val sx = floatArrayOf(1f, -1f, -1f, 1f)
  val sy = floatArrayOf(1f, 1f, -1f, -1f)
  for (j in 0 until 2) {
    val c = corners[j]
    if (!round(c)) continue
    val at = if (j == 0) 2 else 4
    val from = if (j == 0) 0 else 6
    val x = e[at]
    val y = e[at + 1]
    val p = dragonIntersect(e[from], e[from + 1], x, y, x + sx[c] * ir[c], y, x, y + sy[c] * ir[c + 4])
    e[at] = p[0]
    e[at + 1] = p[1]
  }
  return e
}

/**
 * Rounded solid borders (PNT1): the ring between the border-box and padding-edge paths, filled even-odd; four sides of one colour
 * fill it once (Blink's FillDRRect), otherwise each side fills its part of the ring clipped to its Blink edge quad (the corner
 * diagonals, carried to the chords of the rounded inner corners). Rounded dashed, dotted and double sides are refused at compile
 * time (PNT1b), so meeting one here is a fault.
 */
fun dragonDrawRoundedBorders(canvas: Canvas, w: Float, h: Float, outer: Path, inner: Path, ir: FloatArray, widths: IntArray, styles: Array<String>, colors: Array<DragonRGBA8>) {
  if (ir.size != 8) throw IllegalStateException("dragon: " + ir.size + " inner radii, not 8")
  val visible = ArrayList<Int>()
  for (k in 0 until 4) {
    if (widths[k] <= 0 || styles[k] == "none" || styles[k] == "hidden" || colors[k].a == 0) continue
    if (styles[k] != "solid") throw IllegalStateException("dragon: a rounded " + styles[k] + " border is PNT1b, which the compiler refuses")
    visible.add(k)
  }
  if (visible.isEmpty()) return
  val ring = Path()
  ring.fillType = Path.FillType.EVEN_ODD
  ring.addPath(outer)
  ring.addPath(inner)
  val paint = Paint()
  paint.isAntiAlias = true
  paint.style = Paint.Style.FILL
  val first = colors[visible[0]]
  if (visible.size == 4 && visible.all { colors[it].r == first.r && colors[it].g == first.g && colors[it].b == first.b && colors[it].a == first.a }) {
    paint.color = dragonArgb(first)
    canvas.drawPath(ring, paint)
    return
  }
  val t = widths[0].toFloat()
  val r = widths[1].toFloat()
  val b = widths[2].toFloat()
  val l = widths[3].toFloat()
  for (k in visible) {
    canvas.save()
    val q = dragonBorderEdgeQuad(k, w, h, t, r, b, l, ir)
    val clip = Path()
    clip.moveTo(q[0], q[1]); clip.lineTo(q[2], q[3]); clip.lineTo(q[4], q[5]); clip.lineTo(q[6], q[7]); clip.close()
    canvas.clipPath(clip)
    paint.color = dragonArgb(colors[k])
    canvas.drawPath(ring, paint)
    canvas.restore()
  }
}

/** After every layout: the side widths in whole device px from the engine. */
fun dragonAfterLayoutBorder(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val px = shape.borders
  v.dragonBorderWidths = intArrayOf(dragonCheckedInt(px[0], v.dragonId + " border top"), dragonCheckedInt(px[1], v.dragonId + " border right"), dragonCheckedInt(px[2], v.dragonId + " border bottom"), dragonCheckedInt(px[3], v.dragonId + " border left"))
}

/** The readback of the border module: widths in device px, styles and colours. */
fun dragonAppliedBorder(v: DragonBoxView): List<Pair<String, DumpJson>> = listOf(
  Pair("dragonBorder.widthsPx", DumpJson.Arr(v.dragonBorderWidths.map { DumpJson.Num(it.toDouble()) })),
  Pair("dragonBorder.styles", DumpJson.Arr(v.dragonBorderStyles.map { DumpJson.Str(it) })),
  Pair("dragonBorder.colors", DumpJson.Arr(v.dragonBorderColors.map { dragonRGBAJson(it) })),
)

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
`;

export const BORDER_EMITTER: PaintEmitter<'border-widths' | 'border-styles' | 'border-colors'> = {
  name: 'border',
  kinds: ['border-widths', 'border-styles', 'border-colors'],
  lines: {
    uikit: (v, _n, w) => {
      switch (w.kind) {
        case 'border-widths':
          return [`  // ${w.key}: from the translated engine at the device scale (DragonTree.apply)`];
        case 'border-styles':
          return [`  ${v}.dragonBorderStyles = [${w.styles.map(keywordLit).join(', ')}]`];
        case 'border-colors':
          return [`  ${v}.dragonBorderColors = [${w.colors.map(rgbaLit).join(', ')}]`];
      }
    },
    'android-views': (v, _n, w) => {
      switch (w.kind) {
        case 'border-widths':
          return [`  // ${w.key}: from the translated engine at the device scale (DragonTree.apply)`];
        case 'border-styles':
          return [`  ${v}.dragonBorderStyles = arrayOf(${w.styles.map(keywordLit).join(', ')})`];
        case 'border-colors':
          return [`  ${v}.dragonBorderColors = arrayOf(${w.colors.map(rgbaLit).join(', ')})`];
      }
    },
  },
  applied: (_e, backend, w, dpr, g) => {
    const [bt, br, bb, bl] = g.border;
    switch (w.kind) {
      case 'border-widths':
        return backend === 'uikit' ? [bt / dpr, br / dpr, bb / dpr, bl / dpr] : [bt, br, bb, bl];
      case 'border-styles':
        return [...w.styles];
      case 'border-colors':
        return w.colors.map((c) => [c.r, c.g, c.b, c.alpha]);
    }
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, stages: { border: 'dragonPaintBorderStage' }, afterLayout: 'dragonAfterLayoutBorder', applied: 'dragonAppliedBorder' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, stages: { border: 'dragonPaintBorderStage' }, afterLayout: 'dragonAfterLayoutBorder', applied: 'dragonAppliedBorder' },
  },
  plants: [],
};
