// FORM-b select S3 (lower/paint/control.ts): DragonTree.apply stores each select's arrow from the translated paint.ts menuListArrows
// after every layout; the background-layers stage strokes it in device px with the svg module's path and stroke helpers.
// FORM-checkbox: the same stage draws a themed checkbox from the translated controls.ts checkboxMarks of the view's device px size.
import type { Rgba8 } from '../../css/color.ts';
import type { ControlWrite } from '../../lower/paint/control.ts';
import type { JsonValue } from '../expected-dump.ts';
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT, rgbaLit } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// FORM-b: a menulist-button select's arrow colour as written (nil for no arrow), and its verb-coded open path in device px from
  /// the view and stroke width in device px, set by DragonTree.apply after each layout.
  public var dragonSelectArrowColor: DragonRGBA8? = nil
  public var dragonSelectArrowPath: [Double] = []
  public var dragonSelectArrowStroke: Double = 0
  /// FORM-checkbox: the checkbox's colours (unchecked background and border, checked background, fill and check; nil for no
  /// checkbox), its checkedness, and whether the host has set it (dirty checkedness).
  public var dragonCheckboxColors: [DragonRGBA8]? = nil
  public var dragonCheckboxChecked = false
  public var dragonCheckboxDirty = false
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

/// The checkbox write (runtime writer): its colours, and the checked attribute's state, which applies until the host sets one.
public func dragonSetCheckbox(_ v: DragonBoxView, _ checked: Bool, _ colors: [DragonRGBA8]) {
  v.dragonCheckboxColors = colors
  if !v.dragonCheckboxDirty { v.dragonCheckboxChecked = checked }
  v.setNeedsDisplay()
}

/// The host's checkedness of a checkbox view (a toggle on a tap, or the app's state): it redraws, and the checked attribute of a
/// later write no longer changes it.
public func dragonSetCheckboxChecked(_ v: DragonBoxView, _ checked: Bool) {
  v.dragonCheckboxDirty = true
  v.dragonCheckboxChecked = checked
  v.setNeedsDisplay()
}

/// A checkbox's drawing in device px: Chrome's theme marks for the view's size.
func dragonPaintCheckbox(_ v: DragonBoxView, _ ctx: CGContext) {
  guard let c = v.dragonCheckboxColors, c.count == 5 else { return }
  let s = v.dragonScale
  guard let m = try? controls_checkboxMarks(Double(v.bounds.width) * s, Double(v.bounds.height) * s, s) else { return }
  ctx.saveGState()
  ctx.scaleBy(x: CGFloat(1 / s), y: CGFloat(1 / s))
  ctx.setShouldAntialias(true)
  let square = CGRect(x: m.x, y: m.y, width: m.side, height: m.side)
  let roundRect = { (r: CGRect, radius: Double) -> CGPath in
    let k = CGFloat(min(radius, Double(min(r.width, r.height)) / 2))
    return CGPath(roundedRect: r, cornerWidth: k, cornerHeight: k, transform: nil)
  }
  if m.plain {
    ctx.setFillColor(dragonUIColor(v.dragonCheckboxChecked ? c[3] : c[1]).cgColor)
    ctx.fill(square)
    ctx.restoreGState()
    return
  }
  let bi = CGFloat(m.backgroundInset)
  ctx.addPath(roundRect(square.insetBy(dx: bi, dy: bi), m.radius))
  ctx.setFillColor(dragonUIColor(v.dragonCheckboxChecked ? c[2] : c[0]).cgColor)
  ctx.fillPath()
  if v.dragonCheckboxChecked {
    ctx.addPath(roundRect(square, m.radius))
    ctx.setFillColor(dragonUIColor(c[3]).cgColor)
    ctx.fillPath()
    let p = m.check.items
    ctx.move(to: CGPoint(x: p[0], y: p[1]))
    ctx.addLine(to: CGPoint(x: p[2], y: p[3]))
    ctx.addLine(to: CGPoint(x: p[4], y: p[5]))
    ctx.setLineWidth(CGFloat(m.checkWidth))
    ctx.setLineCap(.butt)
    ctx.setLineJoin(.miter)
    ctx.setMiterLimit(4)
    ctx.setStrokeColor(dragonUIColor(c[4]).cgColor)
    ctx.strokePath()
  } else {
    let i = CGFloat(m.borderInset)
    ctx.addPath(roundRect(square.insetBy(dx: i, dy: i), m.radius))
    ctx.setLineWidth(CGFloat(m.borderWidth))
    ctx.setStrokeColor(dragonUIColor(c[1]).cgColor)
    ctx.strokePath()
  }
  ctx.restoreGState()
}

/// The background-layers stage of the control module: a select's arrow, or a checkbox.
public func dragonPaintControlStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  dragonPaintSelectArrowStage(v, ctx, shape)
  dragonPaintCheckbox(v, ctx)
}

/// The readback of the control module: the arrow's path, stroke width and colour, and a checkbox's state and colours.
public func dragonAppliedSelectArrow(_ v: DragonBoxView) -> DumpJsonObject {
  if let c = v.dragonCheckboxColors {
    return [("dragonCheckbox", .object([("checked", .bool(v.dragonCheckboxChecked)), ("colors", .array(c.map { dragonRGBAJson($0) }))]))]
  }
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
  /** FORM-checkbox: the checkbox's five colours (null for no checkbox), its checkedness, and whether the host has set it. */
  var dragonCheckboxColors: List<DragonRGBA8>? = null
  var dragonCheckboxChecked = false
  var dragonCheckboxDirty = false
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.Canvas
import android.graphics.Paint
import dev.dragon.dump.DumpJson
import dev.dragon.layout.MenuListArrow
import dev.dragon.layout.SvgLine
import dev.dragon.layout.SvgMove
import dev.dragon.layout.controls_checkboxMarks

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

/** The checkbox write (runtime writer): its colours, and the checked attribute's state, which applies until the host sets one. */
fun dragonSetCheckbox(v: DragonBoxView, checked: Boolean, colors: List<DragonRGBA8>) {
  v.dragonCheckboxColors = colors
  if (!v.dragonCheckboxDirty) v.dragonCheckboxChecked = checked
  v.invalidate()
}

/** The host's checkedness of a checkbox view: it redraws, and the checked attribute of a later write no longer changes it. */
fun dragonSetCheckboxChecked(v: DragonBoxView, checked: Boolean) {
  v.dragonCheckboxDirty = true
  v.dragonCheckboxChecked = checked
  v.invalidate()
}

/** A checkbox's drawing in device px: Chrome's theme marks for the view's size. */
fun dragonPaintCheckbox(v: DragonBoxView, canvas: Canvas) {
  val c = v.dragonCheckboxColors ?: return
  if (c.size != 5) return
  val m = controls_checkboxMarks(v.width.toDouble(), v.height.toDouble(), v.resources.displayMetrics.density.toDouble())
  val square = android.graphics.RectF(m.x.toFloat(), m.y.toFloat(), (m.x + m.side).toFloat(), (m.y + m.side).toFloat())
  val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  if (m.plain) {
    paint.color = dragonArgb(if (v.dragonCheckboxChecked) c[3] else c[1])
    canvas.drawRect(square, paint)
    return
  }
  val r = m.radius.toFloat()
  val bi = m.backgroundInset.toFloat()
  paint.color = dragonArgb(if (v.dragonCheckboxChecked) c[2] else c[0])
  canvas.drawRoundRect(android.graphics.RectF(square.left + bi, square.top + bi, square.right - bi, square.bottom - bi), r, r, paint)
  if (v.dragonCheckboxChecked) {
    paint.color = dragonArgb(c[3])
    canvas.drawRoundRect(square, r, r, paint)
    val p = m.check
    val path = android.graphics.Path()
    path.moveTo(p[0].toFloat(), p[1].toFloat())
    path.lineTo(p[2].toFloat(), p[3].toFloat())
    path.lineTo(p[4].toFloat(), p[5].toFloat())
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = m.checkWidth.toFloat()
    paint.strokeCap = Paint.Cap.BUTT
    paint.strokeJoin = Paint.Join.MITER
    paint.strokeMiter = 4f
    paint.color = dragonArgb(c[4])
    canvas.drawPath(path, paint)
  } else {
    val i = m.borderInset.toFloat()
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = m.borderWidth.toFloat()
    paint.color = dragonArgb(c[1])
    canvas.drawRoundRect(android.graphics.RectF(square.left + i, square.top + i, square.right - i, square.bottom - i), r, r, paint)
  }
}

/** The background-layers stage of the control module: a select's arrow, or a checkbox. */
fun dragonPaintControlStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  dragonPaintSelectArrowStage(v, canvas, shape)
  dragonPaintCheckbox(v, canvas)
}

/** The readback of the control module: the arrow's path, stroke width and colour, and a checkbox's state and colours. */
fun dragonAppliedSelectArrow(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val cb = v.dragonCheckboxColors
  if (cb != null) return listOf(Pair("dragonCheckbox", DumpJson.Obj(listOf(Pair("checked", DumpJson.Bool(v.dragonCheckboxChecked)), Pair("colors", DumpJson.Arr(cb.map { dragonRGBAJson(it) }))))))
  val c = v.dragonSelectArrowColor ?: return emptyList()
  return listOf(Pair("dragonSelectArrow", DumpJson.Obj(listOf(Pair("path", DumpJson.Arr(v.dragonSelectArrowPath.map { DumpJson.Num(it) })), Pair("stroke", DumpJson.Num(v.dragonSelectArrowStroke)), Pair("color", dragonRGBAJson(c))))))
}
`;

/** A checkbox's colours in the order its native writer stores them. */
const checkboxColorList = (w: ControlWrite & { readonly kind: 'checkbox' }): readonly Rgba8[] => [w.colors.unchecked.background, w.colors.unchecked.border, w.colors.checked.background, w.colors.checked.fill, w.colors.checked.check];

export const CONTROL_EMITTER: PaintEmitter<'select-arrow' | 'checkbox'> = {
  name: 'control',
  kinds: ['select-arrow', 'checkbox'],
  lines: {
    uikit: (v, _n, w) => (w.kind === 'checkbox' ? [`  dragonSetCheckbox(${v}, ${w.checked}, [${checkboxColorList(w).map(rgbaLit).join(', ')}])`] : [`  dragonSetSelectArrow(${v}, ${rgbaLit(w.color)})`]),
    'android-views': (v, _n, w) => (w.kind === 'checkbox' ? [`  dragonSetCheckbox(${v}, ${w.checked}, listOf(${checkboxColorList(w).map(rgbaLit).join(', ')}))`] : [`  dragonSetSelectArrow(${v}, ${rgbaLit(w.color)})`]),
  },
  applied: (_e, _b, w, dpr, g) => {
    if (w.kind === 'checkbox') return { checked: w.checked, colors: checkboxColorList(w).map((c) => [c.r, c.g, c.b, c.alpha]) };
    if (g.selectArrow === null) throw new Error(`a select-arrow write on a box the engine gives no arrow at DPR ${dpr}`);
    const path: JsonValue = [...g.selectArrow.path];
    return { path, stroke: g.selectArrow.stroke, color: [w.color.r, w.color.g, w.color.b, w.color.alpha] };
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, stages: { 'background-layers': 'dragonPaintControlStage' }, applied: 'dragonAppliedSelectArrow' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, stages: { 'background-layers': 'dragonPaintControlStage' }, applied: 'dragonAppliedSelectArrow' },
  },
  plants: [],
};
