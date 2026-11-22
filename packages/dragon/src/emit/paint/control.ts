// FORM-b select S3 (lower/paint/control.ts): DragonTree.apply stores each select's arrow from the translated paint-menulist.ts menuListArrows
// after every layout; the background-layers stage strokes it in device px with the svg module's path and stroke helpers.
import type { JsonValue } from '../expected-dump.ts';
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT, rgbaLit } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// FORM-b: a menulist-button select's arrow colour as written (nil for no arrow), and its verb-coded open path in device px from
  /// the view and stroke width in device px, set by DragonTree.apply after each layout.
  public var dragonSelectArrowColor: DragonRGBA8? = nil
  public var dragonSelectArrowPath: [Double] = []
  public var dragonSelectArrowStroke: Double = 0
`;

const SWIFT = String.raw`import UIKit

/// The arrow write of a select (runtime writer): the select's used colour.
public func dragonSetSelectArrow(_ v: DragonBoxView, _ color: DragonRGBA8) {
  v.dragonSelectArrowColor = color
  v.setNeedsDisplay()
}

/// After a layout: the engine's arrow, its absolute device px points made relative to the view's snapped left and top.
public func dragonSetSelectArrowGeometry(_ v: DragonBoxView, _ a: MenuListArrow, _ left: Double, _ top: Double) {
  var p: [Double] = []
  for g in a.shape.segments.items {
    if let m = g as? SvgMove { p += [0, m.x - left, m.y - top] }
    else if let l = g as? SvgLine { p += [1, l.x - left, l.y - top] }
    else { fatalError("dragon: \(v.dragonId): a select arrow segment \(g.kind.description) is not a move or a line") }
  }
  v.dragonSelectArrowPath = p
  v.dragonSelectArrowStroke = a.strokeWidth
}

/// The background-layers stage of a select: the open arrow stroked in device px, antialiased, butt-capped and miter-joined.
public func dragonPaintSelectArrowStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  guard let c = v.dragonSelectArrowColor, !v.dragonSelectArrowPath.isEmpty else { return }
  let s = CGFloat(v.dragonScale)
  ctx.saveGState()
  ctx.scaleBy(x: 1 / s, y: 1 / s)
  ctx.setShouldAntialias(true)
  ctx.addPath(dragonSvgPath(v.dragonSelectArrowPath))
  ctx.setLineWidth(CGFloat(v.dragonSelectArrowStroke))
  ctx.setLineCap(dragonSvgLineCap("butt"))
  ctx.setLineJoin(dragonSvgLineJoin("miter"))
  ctx.setMiterLimit(4)
  ctx.setLineDash(phase: 0, lengths: [])
  ctx.setStrokeColor(dragonUIColor(c).cgColor)
  ctx.strokePath()
  ctx.restoreGState()
}

/// The readback of the control module: the arrow's path, stroke width and colour.
public func dragonAppliedSelectArrow(_ v: DragonBoxView) -> DumpJsonObject {
  guard let c = v.dragonSelectArrowColor else { return [] }
  return [("dragonSelectArrow", .object([("path", .array(v.dragonSelectArrowPath.map { .number($0) })), ("stroke", .number(v.dragonSelectArrowStroke)), ("color", dragonRGBAJson(c))]))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /**
   * FORM-b: a menulist-button select's arrow colour as written (null for no arrow), and its verb-coded open path in device px from
   * the view and stroke width in device px, set by DragonTree.apply after each layout.
   */
  var dragonSelectArrowColor: DragonRGBA8? = null
  var dragonSelectArrowPath = DoubleArray(0)
  var dragonSelectArrowStroke = 0.0
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.Canvas
import android.graphics.Paint
import dev.dragon.dump.DumpJson
import dev.dragon.layout.MenuListArrow
import dev.dragon.layout.SvgLine
import dev.dragon.layout.SvgMove

/** The arrow write of a select (runtime writer): the select's used colour. */
fun dragonSetSelectArrow(v: DragonBoxView, color: DragonRGBA8) {
  v.dragonSelectArrowColor = color
  v.invalidate()
}

/** After a layout: the engine's arrow, its absolute device px points made relative to the view's snapped left and top. */
fun dragonSetSelectArrowGeometry(v: DragonBoxView, a: MenuListArrow, left: Double, top: Double) {
  val p = ArrayList<Double>()
  for (g in a.shape.segments) {
    when (g) {
      is SvgMove -> { p.add(0.0); p.add(g.x - left); p.add(g.y - top) }
      is SvgLine -> { p.add(1.0); p.add(g.x - left); p.add(g.y - top) }
      else -> throw IllegalStateException("dragon: " + v.dragonId + ": a select arrow segment " + g.kind + " is not a move or a line")
    }
  }
  v.dragonSelectArrowPath = p.toDoubleArray()
  v.dragonSelectArrowStroke = a.strokeWidth
}

/** The background-layers stage of a select: the open arrow stroked in device px, antialiased, butt-capped and miter-joined. */
fun dragonPaintSelectArrowStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  val c = v.dragonSelectArrowColor ?: return
  if (v.dragonSelectArrowPath.isEmpty()) return
  val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  paint.style = Paint.Style.STROKE
  paint.strokeWidth = v.dragonSelectArrowStroke.toFloat()
  paint.strokeCap = dragonSvgLineCap("butt")
  paint.strokeJoin = dragonSvgLineJoin("miter")
  paint.strokeMiter = 4f
  paint.color = dragonArgb(c)
  canvas.drawPath(dragonSvgPath(v.dragonSelectArrowPath, false), paint)
}

/** The readback of the control module: the arrow's path, stroke width and colour. */
fun dragonAppliedSelectArrow(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val c = v.dragonSelectArrowColor ?: return emptyList()
  return listOf(Pair("dragonSelectArrow", DumpJson.Obj(listOf(Pair("path", DumpJson.Arr(v.dragonSelectArrowPath.map { DumpJson.Num(it) })), Pair("stroke", DumpJson.Num(v.dragonSelectArrowStroke)), Pair("color", dragonRGBAJson(c))))))
}
`;

export const CONTROL_EMITTER: PaintEmitter<'select-arrow'> = {
  name: 'control',
  kinds: ['select-arrow'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetSelectArrow(${v}, ${rgbaLit(w.color)})`],
    'android-views': (v, _n, w) => [`  dragonSetSelectArrow(${v}, ${rgbaLit(w.color)})`],
  },
  applied: (_e, _b, w, dpr, g) => {
    if (g.selectArrow === null) throw new Error(`a select-arrow write on a box the engine gives no arrow at DPR ${dpr}`);
    const path: JsonValue = [...g.selectArrow.path];
    return { path, stroke: g.selectArrow.stroke, color: [w.color.r, w.color.g, w.color.b, w.color.alpha] };
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, stages: { 'background-layers': 'dragonPaintSelectArrowStage' }, applied: 'dragonAppliedSelectArrow' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, stages: { 'background-layers': 'dragonPaintSelectArrowStage' }, applied: 'dragonAppliedSelectArrow' },
  },
  plants: [],
};
