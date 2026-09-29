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
    dragonDrawRoundedBorders(ctx, v.bounds, outer, inner, v.dragonBorderWidths.map { CGFloat($0) }, v.dragonBorderStyles, v.dragonBorderColors)
    return
  }
  dragonDrawBorders(ctx, v.bounds, v.dragonBorderWidths.map { CGFloat($0) }, v.dragonBorderStyles, v.dragonBorderColors)
}

/// Rounded solid borders (PNT1): the ring between the border-box and padding-edge paths, filled even-odd; four sides of one colour
/// fill it once (Blink's FillDRRect), otherwise each side fills its part of the ring cut by the corner diagonals. Rounded dashed,
/// dotted and double sides are refused at compile time (PNT1b), so meeting one here is a fault.
public func dragonDrawRoundedBorders(_ ctx: CGContext, _ o: CGRect, _ outer: CGPath, _ inner: CGPath, _ w: [CGFloat], _ styles: [String], _ colors: [DragonRGBA8]) {
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
  // Each side owns the sector between the rays from its outer corners through the inner corners, extended to the box's middle
  // lines, so a rounded corner's curved band belongs to the side of its diagonal even where the other side has no width.
  let outerCorners = [CGPoint(x: o.minX, y: o.minY), CGPoint(x: o.maxX, y: o.minY), CGPoint(x: o.maxX, y: o.maxY), CGPoint(x: o.minX, y: o.maxY)]
  let innerCorners = [CGPoint(x: o.minX + w[3], y: o.minY + w[0]), CGPoint(x: o.maxX - w[1], y: o.minY + w[0]), CGPoint(x: o.maxX - w[1], y: o.maxY - w[2]), CGPoint(x: o.minX + w[3], y: o.maxY - w[2])]
  let mid = CGPoint(x: o.midX, y: o.midY)
  let ends: [CGPoint] = (0..<4).map { c in
    let p = outerCorners[c], q = innerCorners[c]
    let dx = q.x - p.x, dy = q.y - p.y
    var t = CGFloat.greatestFiniteMagnitude
    if dx != 0 { t = min(t, (mid.x - p.x) / dx) }
    if dy != 0 { t = min(t, (mid.y - p.y) / dy) }
    return t == CGFloat.greatestFiniteMagnitude ? p : CGPoint(x: p.x + dx * t, y: p.y + dy * t)
  }
  let quads: [[CGPoint]] = (0..<4).map { k in [outerCorners[k], outerCorners[(k + 1) % 4], ends[(k + 1) % 4], ends[k]] }
  for k in visible {
    ctx.saveGState()
    let q = CGMutablePath()
    q.addLines(between: quads[k])
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
    dragonDrawRoundedBorders(canvas, v.width.toFloat(), v.height.toFloat(), outer, inner, v.dragonBorderWidths, v.dragonBorderStyles, v.dragonBorderColors)
    return
  }
  dragonDrawBorders(canvas, v.width.toFloat(), v.height.toFloat(), v.dragonBorderWidths, v.dragonBorderStyles, v.dragonBorderColors)
}

/**
 * Rounded solid borders (PNT1): the ring between the border-box and padding-edge paths, filled even-odd; four sides of one colour
 * fill it once (Blink's FillDRRect), otherwise each side fills its part of the ring cut by the corner diagonals. Rounded dashed,
 * dotted and double sides are refused at compile time (PNT1b), so meeting one here is a fault.
 */
fun dragonDrawRoundedBorders(canvas: Canvas, w: Float, h: Float, outer: Path, inner: Path, widths: IntArray, styles: Array<String>, colors: Array<DragonRGBA8>) {
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
  // Each side owns the sector between the rays from its outer corners through the inner corners, extended to the box's middle
  // lines, so a rounded corner's curved band belongs to the side of its diagonal even where the other side has no width.
  val t = widths[0].toFloat()
  val r = widths[1].toFloat()
  val b = widths[2].toFloat()
  val l = widths[3].toFloat()
  val outerCorners = arrayOf(floatArrayOf(0f, 0f), floatArrayOf(w, 0f), floatArrayOf(w, h), floatArrayOf(0f, h))
  val innerCorners = arrayOf(floatArrayOf(l, t), floatArrayOf(w - r, t), floatArrayOf(w - r, h - b), floatArrayOf(l, h - b))
  val ends = Array(4) { c ->
    val p = outerCorners[c]
    val q = innerCorners[c]
    val dx = q[0] - p[0]
    val dy = q[1] - p[1]
    var s = Float.MAX_VALUE
    if (dx != 0f) s = minOf(s, (w / 2f - p[0]) / dx)
    if (dy != 0f) s = minOf(s, (h / 2f - p[1]) / dy)
    if (s == Float.MAX_VALUE) p else floatArrayOf(p[0] + dx * s, p[1] + dy * s)
  }
  val quads = Array(4) { k ->
    val a = outerCorners[k]
    val c = outerCorners[(k + 1) % 4]
    floatArrayOf(a[0], a[1], c[0], c[1], ends[(k + 1) % 4][0], ends[(k + 1) % 4][1], ends[k][0], ends[k][1])
  }
  for (k in visible) {
    canvas.save()
    val q = quads[k]
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
