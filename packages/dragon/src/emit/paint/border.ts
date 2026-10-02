// The four border sides: Dragon-owned paint on the box view (the border stage). Widths come from the engine at the device scale
// through the after-layout hook; styles and colours are written by the case code through the view's public setters. A box with a
// visible dashed or dotted side is drawn from the translated paint-dash.ts operations (Blink 145's side painter in device px).
import type { PaintEmitter } from './types.ts';
import { keywordLit, NO_NATIVE_PAINT, rgbaLit } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// Points, top right bottom left: the engine's device px at the device scale / scale.
  public var dragonBorderWidths: [Double] = [0, 0, 0, 0] { didSet { setNeedsDisplay() } }
  public var dragonBorderStyles: [String] = ["none", "none", "none", "none"] { didSet { setNeedsDisplay() } }
  public var dragonBorderColors: [DragonRGBA8] = [DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0), DragonRGBA8(0, 0, 0, 0)] { didSet { setNeedsDisplay() } }
`;

const SWIFT = String.raw`import UIKit

/// The planted dash faults: none, except in the dash-phase-1 and dash-gap-unfitted raster plant builds (P6a).
public let dragonDashFaults = DashFaults(false, false)

/// The border stage: a box with a visible dashed or dotted side is drawn by Blink's side painter (paint-dash.ts), every other box
/// by the band painter.
public func dragonPaintBorderStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  if dragonDrawBorderOps(ctx, shape, CGFloat(v.dragonScale), v.dragonBorderStyles, v.dragonBorderColors, v.dragonId) { return }
  dragonDrawBorders(ctx, v.bounds, v.dragonBorderWidths.map { CGFloat($0) }, v.dragonBorderStyles, v.dragonBorderColors)
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

/// A polygon path from x, y pairs in device px.
func dragonPolygon(_ pts: [Double]) -> CGPath {
  let path = CGMutablePath()
  path.addLines(between: stride(from: 0, to: pts.count - 1, by: 2).map { CGPoint(x: pts[$0], y: pts[$0 + 1]) })
  path.closeSubpath()
  return path
}

/// Draws the border operations of paint-dash.ts in device px (the box's absolute snapped edges) when a visible side is dashed
/// or dotted; false for every other box.
public func dragonDrawBorderOps(_ ctx: CGContext, _ shape: DragonBoxShape, _ scale: CGFloat, _ styles: [String], _ colors: [DragonRGBA8], _ id: String) -> Bool {
  let widths = JsArray<Double>(shape.borders)
  let st = JsArray<JsString>(styles.map { JsString($0) })
  let cs = JsArray<Double>(colors.flatMap { [Double($0.r), Double($0.g), Double($0.b), Double($0.a)] })
  let ops: JsArray<BorderOp>
  do {
    if !(try paintDash_borderNeedsSidePainter(widths, st, cs)) { return false }
    ops = try paintDash_borderPaintOps(shape.edges[0], shape.edges[1], shape.edges[2], shape.edges[3], widths, st, cs, dragonDashFaults)
  } catch {
    fatalError("dragon: \(id): the border side painter threw \(error)")
  }
  ctx.saveGState()
  ctx.scaleBy(x: 1 / scale, y: 1 / scale)
  ctx.translateBy(x: CGFloat(-shape.edges[0]), y: CGFloat(-shape.edges[1]))
  for o in ops.items {
    let pts = o.points.items
    switch o.op.description {
    case "begin-layer":
      ctx.saveGState()
      ctx.setAlpha(CGFloat(o.alpha))
      ctx.beginTransparencyLayer(auxiliaryInfo: nil)
    case "end-layer":
      ctx.endTransparencyLayer()
      ctx.restoreGState()
    case "save":
      ctx.saveGState()
    case "restore":
      ctx.restoreGState()
    case "clip":
      ctx.setShouldAntialias(o.antialias)
      ctx.addPath(dragonPolygon(pts))
      ctx.clip()
      ctx.setShouldAntialias(true)
    case "fill", "dot":
      let c = colors[Int(o.side)]
      ctx.setFillColor(UIColor(red: CGFloat(c.r) / 255, green: CGFloat(c.g) / 255, blue: CGFloat(c.b) / 255, alpha: CGFloat(o.alpha)).cgColor)
      ctx.setShouldAntialias(o.antialias)
      if o.op.description == "fill" {
        ctx.addPath(dragonPolygon(pts))
        ctx.fillPath()
      } else {
        ctx.fillEllipse(in: CGRect(x: pts[0] - pts[2], y: pts[1] - pts[2], width: 2 * pts[2], height: 2 * pts[2]))
      }
      ctx.setShouldAntialias(true)
    default:
      fatalError("dragon: \(id): unknown border operation \(o.op)")
    }
  }
  ctx.restoreGState()
  return true
}

/// The band painter for boxes without a visible dashed or dotted side: each side is the trapezoid between the outer and inner
/// edges (corners join on the diagonal); solid fills it, double fills its outer and inner thirds.
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
    ctx.setFillColor(dragonUIColor(colors[k]).cgColor)
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
      fatalError("dragon: a visible \(style) side reached the band painter")
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
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import dev.dragon.dump.DumpJson
import dev.dragon.layout.BorderOp
import dev.dragon.layout.DashFaults
import dev.dragon.layout.JsArray
import dev.dragon.layout.paintDash_borderNeedsSidePainter
import dev.dragon.layout.paintDash_borderPaintOps
import kotlin.math.roundToInt

/** The planted dash faults: none, except in the dash-phase-1 and dash-gap-unfitted raster plant builds (P6a). */
val DRAGON_DASH_FAULTS = DashFaults(false, false)

/** The border stage: a box with a visible dashed or dotted side is drawn by Blink's side painter (paint-dash.ts), every other box by the band painter. */
fun dragonPaintBorderStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  if (dragonDrawBorderOps(canvas, shape, v.dragonBorderStyles, v.dragonBorderColors, v.dragonId)) return
  dragonDrawBorders(canvas, v.width.toFloat(), v.height.toFloat(), v.dragonBorderWidths, v.dragonBorderStyles, v.dragonBorderColors)
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

/** A polygon path from x, y pairs in device px. */
fun dragonPolygon(pts: List<Double>): Path {
  val path = Path()
  path.moveTo(pts[0].toFloat(), pts[1].toFloat())
  var k = 2
  while (k + 1 < pts.size) {
    path.lineTo(pts[k].toFloat(), pts[k + 1].toFloat())
    k += 2
  }
  path.close()
  return path
}

/**
 * Draws the border operations of paint-dash.ts in device px (the box's absolute snapped edges) when a visible side is dashed or
 * dotted; false for every other box.
 */
fun dragonDrawBorderOps(canvas: Canvas, shape: DragonBoxShape, styles: Array<String>, colors: Array<DragonRGBA8>, id: String): Boolean {
  val widths = JsArray<Double>(shape.borders.toList())
  val st = JsArray<String>(styles.toList())
  val cs = JsArray<Double>(colors.flatMap { listOf(it.r.toDouble(), it.g.toDouble(), it.b.toDouble(), it.a.toDouble()) })
  val ops: JsArray<BorderOp>
  try {
    if (!paintDash_borderNeedsSidePainter(widths, st, cs)) return false
    ops = paintDash_borderPaintOps(shape.edges[0], shape.edges[1], shape.edges[2], shape.edges[3], widths, st, cs, DRAGON_DASH_FAULTS)
  } catch (e: Exception) {
    throw IllegalStateException("dragon: " + id + ": the border side painter threw " + e.message, e)
  }
  canvas.save()
  canvas.translate((-shape.edges[0]).toFloat(), (-shape.edges[1]).toFloat())
  for (o in ops) {
    val pts = o.points
    when (o.op) {
      "begin-layer" -> canvas.saveLayerAlpha(null, (o.alpha * 255.0).roundToInt())
      "end-layer", "restore" -> canvas.restore()
      "save" -> canvas.save()
      "clip" -> canvas.clipPath(dragonPolygon(pts))
      "fill", "dot" -> {
        val c = colors[o.side.toInt()]
        val paint = Paint()
        paint.isAntiAlias = o.antialias
        paint.style = Paint.Style.FILL
        paint.color = dragonArgb(DragonRGBA8(c.r, c.g, c.b, 255))
        paint.alpha = (o.alpha * 255.0).roundToInt()
        if (o.op == "fill") canvas.drawPath(dragonPolygon(pts), paint) else canvas.drawCircle(pts[0].toFloat(), pts[1].toFloat(), pts[2].toFloat(), paint)
      }
      else -> throw IllegalStateException("dragon: " + id + ": unknown border operation " + o.op)
    }
  }
  canvas.restore()
  return true
}

/**
 * The band painter for boxes without a visible dashed or dotted side: each side is the trapezoid between the outer and inner edges
 * (corners join on the diagonal); solid fills it, double fills its outer and inner thirds.
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
    paint.style = Paint.Style.FILL
    when (style) {
      "double" -> {
        canvas.drawRect(band(0f, third), paint)
        canvas.drawRect(band(width - third, third), paint)
      }
      "dashed", "dotted" -> throw IllegalStateException("dragon: a visible " + style + " side reached the band painter")
      else -> canvas.drawRect(0f, 0f, w, h, paint)
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
  plants: [
    { name: 'dash-phase-1', replace: { uikit: ['DashFaults(false, false)', 'DashFaults(true, false)'], 'android-views': ['DashFaults(false, false)', 'DashFaults(true, false)'] } },
    { name: 'dash-gap-unfitted', replace: { uikit: ['DashFaults(false, false)', 'DashFaults(false, true)'], 'android-views': ['DashFaults(false, false)', 'DashFaults(false, true)'] } },
  ],
};
