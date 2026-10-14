// Text decorations on the native tree (TDEC-b, lower/paint/text-decoration.ts): the case code writes a container box's decorated
// texts through dragonSetTextDecorations. The tree's text pass hands each text view's engine geometry to the after-text hook
// (native-support.ts DragonTextGeometry): per line the piece's absolute left, width and top in zoomed px, the text's and the
// decorating fonts' ascent and size. The hook runs the translated text-decoration.ts decorationRects over the same inputs as the
// decoration capture (parity/src/decoration-capture.ts predictDecorations), with lengths in css px times the device scale, and puts
// one DragonDecorationView per rect in the text view's superview: under and overlines just beneath the text view, a line-through
// just above it (text_fragment_painter.cc:550-557). A view covers whole device rows and columns; it fills each column with the
// coverage Skia's antifilldot8 gives a rect's fractional ends (the translated columnAlpha). TDEC-d: an under or overline with
// skip-ink auto leaves out the columns the translated skipInkClips gives over each Ahem glyph's ink box at its pen x (the text pass's
// glyph pens and code points); the compiler refuses skip-ink auto on a real face. DragonTextView is not edited.
// The readback is, per decorated text, the decorations as written and whether every rect view sits on its side of the text view.
import type { DecorationLengthValue, TextDecorationEntry } from '../../lower/paint/text-decoration.ts';
import type { JsonValue } from '../expected-dump.ts';
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT, rgbaLit } from './types.ts';

type Lang = 'swift' | 'kotlin';

/** A Swift or Kotlin string literal (node ids are compiler addresses; anything outside printable ASCII is escaped). */
function strLit(lang: Lang, s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (lang === 'kotlin' && ch === '$') out += '\\$';
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (lang === 'swift') out += `\\u{${cp.toString(16)}}`;
    else if (cp < 0x10000) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += `\\u${ch.charCodeAt(0).toString(16)}\\u${ch.charCodeAt(1).toString(16)}`;
  }
  return `${out}"`;
}

const num = (v: number, what: string): string => {
  if (!Number.isFinite(v)) throw new Error(`text-decoration ${what} ${v} is not finite`);
  const n = String(v);
  return /[.eE]/.test(n) ? n.replace(/e\+?/, 'E') : `${n}.0`;
};

const lengthValue = (l: DecorationLengthValue): number => (l.kind === 'auto' ? 0 : l.value);

function lengthLit(l: DecorationLengthValue, what: string): string {
  return `DragonDecorationLength(${strLit('swift', l.kind)}, ${num(lengthValue(l), what)})`;
}

function entryLit(lang: Lang, e: TextDecorationEntry): string {
  const box = e.box === null ? (lang === 'swift' ? 'nil' : 'null') : strLit(lang, e.box);
  const lines = e.lines.map((l) => strLit(lang, l)).join(', ');
  const what = `${e.text} decoration`;
  if (lang === 'swift') return `DragonTextDecorationSpec(${strLit(lang, e.text)}, ${box}, [${lines}], ${rgbaLit(e.color)}, ${lengthLit(e.thickness, `${what} thickness`)}, ${lengthLit(e.underlineOffset, `${what} offset`)}, ${e.skipInk})`;
  return `DragonTextDecorationSpec(${strLit(lang, e.text)}, ${box}, listOf(${lines}), ${rgbaLit(e.color)}, ${lengthLit(e.thickness, `${what} thickness`)}, ${lengthLit(e.underlineOffset, `${what} offset`)}, ${e.skipInk})`;
}

/** The readback of one entry: what the device reads back from its stored spec, and its view order (always in order). */
export function appliedEntry(e: TextDecorationEntry): JsonValue {
  return {
    text: e.text,
    box: e.box,
    lines: [...e.lines],
    color: [e.color.r, e.color.g, e.color.b, e.color.alpha],
    thickness: [e.thickness.kind, lengthValue(e.thickness)],
    offset: [e.underlineOffset.kind, lengthValue(e.underlineOffset)],
    skipInk: e.skipInk,
    ordered: true,
  };
}

const SWIFT_MEMBERS = String.raw`  /// TDEC-b: the decorations of the texts of this box's inline formatting context, as written.
  public var dragonTextDecorations: [DragonTextDecorationSpec] = []
  /// The rect views of each decorated text, placed in the text view's superview by the last text pass or write.
  public var dragonDecorationViews: [String: [DragonDecorationView]] = [:]
  /// The engine geometry of each text of this box at the last text pass.
  public var dragonDecorationGeometry: [String: DragonTextGeometry] = [:]
  /// The text views of this box's texts at the last text pass.
  public var dragonDecoratedTextViews: [String: DragonTextView] = [:]
`;

const SWIFT = String.raw`import UIKit

/// A decoration thickness or underline offset as written: "auto", "px" (css px at zoom 1) or "percent" of the font size.
public struct DragonDecorationLength {
  public let kind: String
  public let value: Double
  public init(_ kind: String, _ value: Double) { self.kind = kind; self.value = value }
}

/// One applied decoration of one text: the decorating inline box (nil for the container's strut font), lines, colour, lengths
/// and whether skip-ink is auto (TDEC-d: an under or overline then leaves out the glyphs' dilated ink).
public struct DragonTextDecorationSpec {
  public let text: String
  public let box: String?
  public let lines: [String]
  public let color: DragonRGBA8
  public let thickness: DragonDecorationLength
  public let offset: DragonDecorationLength
  public let skipInk: Bool
  public init(_ text: String, _ box: String?, _ lines: [String], _ color: DragonRGBA8, _ thickness: DragonDecorationLength, _ offset: DragonDecorationLength, _ skipInk: Bool) {
    self.text = text; self.box = box; self.lines = lines; self.color = color; self.thickness = thickness; self.offset = offset; self.skipInk = skipInk
  }
}

/// One decoration rect: whole device rows, its frame whole device columns from floor(left) to ceil(right); each column is filled
/// with the coverage Skia's antifilldot8 gives it (the translated columnAlpha: 256 for a covered column), but for the skip-ink
/// clips (the translated columnClipped).
public final class DragonDecorationView: UIView {
  public var text = ""
  public var beforeText = true
  /// The rect's left and right in device px relative to the view, and its rows.
  public var left: Double = 0
  public var right: Double = 0
  public var rows: Double = 1
  /// TDEC-d: the skip-ink clips as [start, end) column pairs relative to the view (the translated skipInkClips), empty for none.
  public var clips: [Double] = []
  public var color = DragonRGBA8(0, 0, 0, 0)
  public var scaleFactor: Double = 1
  public init() {
    super.init(frame: .zero)
    isOpaque = false
    backgroundColor = nil
    clipsToBounds = true
    isUserInteractionEnabled = false
    contentMode = .redraw
  }
  required init?(coder: NSCoder) { fatalError("DragonDecorationView is built in code") }
  public override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let s = scaleFactor
    ctx.setShouldAntialias(false)
    let clipped = JsArray(clips)
    var x = 0.0
    while x < right.rounded(.up) {
      let cov: Double
      do { cov = try textDecoration_columnClipped(x, clipped) ? 0 : textDecoration_columnAlpha(x, left, right, rows) } catch { fatalError("dragon: \(text): columnAlpha failed: \(error)") }
      if cov > 0 {
        // A covered column takes the colour's alpha; a partial one Skia's truncated (alpha x (coverage + 1)) >> 8 (SkAlphaMul).
        let a = cov >= 256 ? Double(color.a) : (Double(color.a) * (cov + 1) / 256).rounded(.down)
        ctx.setFillColor(UIColor(red: CGFloat(color.r) / 255, green: CGFloat(color.g) / 255, blue: CGFloat(color.b) / 255, alpha: CGFloat(a / 255)).cgColor)
        ctx.fill(CGRect(x: x / s, y: 0, width: 1 / s, height: rows / s))
      }
      x += 1
    }
  }
}

/// The decorations of a container box's texts (runtime writer); the views are placed again from the last text pass's geometry.
public func dragonSetTextDecorations(_ t: DragonTree, _ v: DragonBoxView, _ specs: [DragonTextDecorationSpec]) {
  v.dragonTextDecorations = specs
  for id in Array(v.dragonDecoratedTextViews.keys).sorted() { dragonPlaceTextDecorations(v, id) }
}

/// A written length at the device scale, as the translated decorationRects takes it.
func dragonDecorationLength(_ l: DragonDecorationLength, _ scale: Double) -> any U_DecorationLength_auto_DecorationLength_percent_DecorationLength_px {
  switch l.kind {
  case "auto": return DecorationLength_auto(JsString("auto"))
  case "px": return DecorationLength_px(JsString("px"), l.value * scale)
  case "percent": return DecorationLength_percent(JsString("percent"), l.value)
  default: fatalError("dragon: a decoration length of kind \(l.kind)")
  }
}

/// The after-text hook: keeps the text's engine geometry and places its decoration views.
public func dragonAfterTextDecoration(_ v: DragonBoxView, _ tv: DragonTextView, _ g: DragonTextGeometry) {
  v.dragonDecorationGeometry[g.id] = g
  v.dragonDecoratedTextViews[g.id] = tv
  dragonPlaceTextDecorations(v, g.id)
}

/// Replaces a text's decoration views: decorationRects per decoration and line, under and overlines just beneath the text view in
/// its superview, line-throughs just above it, each in Blink's order.
public func dragonPlaceTextDecorations(_ v: DragonBoxView, _ id: String) {
  for o in v.dragonDecorationViews[id] ?? [] { o.removeFromSuperview() }
  v.dragonDecorationViews[id] = nil
  let specs = v.dragonTextDecorations.filter { $0.text == id }
  guard !specs.isEmpty, let g = v.dragonDecorationGeometry[id], let tv = v.dragonDecoratedTextViews[id] else { return }
  guard let host = tv.superview else { fatalError("dragon: \(id): a decorated text view is not in the tree") }
  let s = g.scale
  func font(_ m: [Double]) -> DecorationFont { return DecorationFont(m[0], m[1], m[2], 0) }
  let textFont = font(g.textFont)
  // The text view's frame in its superview, in device px, against its absolute edges: whole device px, rounded so a frame
  // origin times the scale that lands an ulp off an integer does not move a clip or an end column.
  let dx = (Double(tv.frame.minX) * s - g.origin[0]).rounded()
  let dy = (Double(tv.frame.minY) * s - g.origin[1]).rounded()
  let faults = DecorationFaults(false, false, false, false, false, false, false, false, false)
  var below: [DragonDecorationView] = []
  var above: [DragonDecorationView] = []
  for d in specs {
    let boxFont: DecorationFont
    if let b = d.box {
      guard let m = g.boxFonts[b] else { fatalError("dragon: \(id): no font for the decorating box \(b)") }
      boxFont = font(m)
    } else {
      boxFont = font(g.strutFont)
    }
    for (k, line) in g.lines.enumerated() {
      let textTop = line[2]
      let baseline = textTop + textFont.ascent
      let rects: [DecorationRect]
      do {
        let input = DecorationInput(JsArray(d.lines.map { JsString($0) }), dragonDecorationLength(d.thickness, s), dragonDecorationLength(d.offset, s), boxFont, textFont, line[0], line[1], textTop, baseline - boxFont.ascent)
        rects = try textDecoration_decorationRects(input, faults).items
      } catch {
        fatalError("dragon: \(id): text-decoration decorationRects failed: \(error)")
      }
      for r in rects {
        let o = DragonDecorationView()
        let x0 = (r.left + dx).rounded(.down)
        let x1 = (r.right + dx).rounded(.up)
        if d.skipInk && r.line.description != "line-through" {
          // TDEC-d: the compiler accepts skip-ink auto on Ahem only, one glyph per code point.
          if g.cps[k].count != g.pens[k].count { fatalError("dragon: \(id) line \(k): \(g.cps[k].count) code points and \(g.pens[k].count) glyphs") }
          do {
            let ink = try textDecoration_ahemLineInk(JsArray(g.cps[k]), JsArray(g.pens[k]), textFont.size, baseline)
            o.clips = try textDecoration_skipInkClips(r, ink, faults).items.map { $0 + dx - x0 }
          } catch {
            fatalError("dragon: \(id): text-decoration skipInkClips failed: \(error)")
          }
        }
        o.text = id
        o.beforeText = r.beforeText
        o.left = r.left + dx - x0
        o.right = r.right + dx - x0
        o.rows = r.height
        o.color = d.color
        o.scaleFactor = s
        o.frame = CGRect(x: CGFloat(x0 / s), y: CGFloat((r.top + dy) / s), width: CGFloat((x1 - x0) / s), height: CGFloat(r.height / s))
        if r.beforeText { below.append(o) } else { above.append(o) }
      }
    }
  }
  CATransaction.begin()
  CATransaction.setDisableActions(true)
  for o in below { host.insertSubview(o, belowSubview: tv) }
  for o in above.reversed() { host.insertSubview(o, aboveSubview: tv) }
  CATransaction.commit()
  for o in below + above { o.setNeedsDisplay() }
  v.dragonDecorationViews[id] = below + above
}

/// The readback of the text-decoration module: per decorated text its decorations as stored, and whether every rect view sits in
/// the text view's superview on its side (under and overlines beneath, line-throughs above).
public func dragonAppliedTextDecoration(_ v: DragonBoxView) -> DumpJsonObject {
  if v.dragonTextDecorations.isEmpty { return [] }
  var out: [DumpJson] = []
  for d in v.dragonTextDecorations {
    var ordered = true
    if let tv = v.dragonDecoratedTextViews[d.text], let host = tv.superview, let ti = host.subviews.firstIndex(of: tv) {
      for o in v.dragonDecorationViews[d.text] ?? [] {
        guard o.superview === host, let i = host.subviews.firstIndex(of: o) else { ordered = false; continue }
        if o.beforeText != (i < ti) { ordered = false }
      }
    } else {
      ordered = false
    }
    out.append(.object([
      ("text", .string(d.text)),
      ("box", d.box.map { DumpJson.string($0) } ?? .null),
      ("lines", .array(d.lines.map { DumpJson.string($0) })),
      ("color", dragonRGBAJson(d.color)),
      ("thickness", .array([.string(d.thickness.kind), .number(d.thickness.value)])),
      ("offset", .array([.string(d.offset.kind), .number(d.offset.value)])),
      ("skipInk", .bool(d.skipInk)),
      ("ordered", .bool(ordered)),
    ]))
  }
  return [("dragonTextDecoration", .array(out))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** TDEC-b: the decorations of the texts of this box's inline formatting context, as written. */
  var dragonTextDecorations: List<DragonTextDecorationSpec> = emptyList()
  /** The rect views of each decorated text, placed in the text view's parent by the last text pass or write. */
  val dragonDecorationViews = HashMap<String, List<DragonDecorationView>>()
  /** The engine geometry of each text of this box at the last text pass. */
  val dragonDecorationGeometry = HashMap<String, DragonTextGeometry>()
  /** The text views of this box's texts at the last text pass. */
  val dragonDecoratedTextViews = HashMap<String, DragonTextView>()
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.ViewGroup
import dev.dragon.dump.DumpJson
import dev.dragon.layout.DecorationFaults
import dev.dragon.layout.DecorationFont
import dev.dragon.layout.DecorationInput
import dev.dragon.layout.DecorationLength_auto
import dev.dragon.layout.DecorationLength_percent
import dev.dragon.layout.DecorationLength_px
import dev.dragon.layout.JsArray
import dev.dragon.layout.U_DecorationLength_auto_DecorationLength_percent_DecorationLength_px
import dev.dragon.layout.textDecoration_ahemLineInk
import dev.dragon.layout.textDecoration_columnAlpha
import dev.dragon.layout.textDecoration_columnClipped
import dev.dragon.layout.textDecoration_decorationRects
import dev.dragon.layout.textDecoration_skipInkClips

/** A decoration thickness or underline offset as written: "auto", "px" (css px at zoom 1) or "percent" of the font size. */
class DragonDecorationLength(val kind: String, val value: Double)

/**
 * One applied decoration of one text: the decorating inline box (null for the container's strut font), lines, colour, lengths and
 * whether skip-ink is auto (TDEC-d: an under or overline then leaves out the glyphs' dilated ink).
 */
class DragonTextDecorationSpec(val text: String, val box: String?, val lines: List<String>, val color: DragonRGBA8, val thickness: DragonDecorationLength, val offset: DragonDecorationLength, val skipInk: Boolean)

/**
 * One decoration rect: whole device rows, its frame whole device columns from floor(left) to ceil(right); each column is filled with
 * the coverage Skia's antifilldot8 gives it (the translated columnAlpha: 256 for a covered column), but for the skip-ink clips (the
 * translated columnClipped).
 */
class DragonDecorationView(ctx: Context) : DragonGroup(ctx) {
  var text = ""
  var beforeText = true
  /** The rect's left and right in device px relative to the view, and its rows. */
  var left0 = 0.0
  var right0 = 0.0
  var rows = 1.0
  /** TDEC-d: the skip-ink clips as [start, end) column pairs relative to the view (the translated skipInkClips), empty for none. */
  var clips: List<Double> = emptyList()
  var color = DragonRGBA8(0, 0, 0, 0)
  private val paint = Paint()
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    paint.isAntiAlias = false
    paint.style = Paint.Style.FILL
    val clipped = ArrayList(clips)
    var x = 0.0
    while (x < kotlin.math.ceil(right0)) {
      val cov = if (textDecoration_columnClipped(x, clipped)) 0.0 else textDecoration_columnAlpha(x, left0, right0, rows)
      if (cov > 0.0) {
        // A covered column takes the colour's alpha; a partial one Skia's truncated (alpha x (coverage + 1)) >> 8 (SkAlphaMul).
        val a = if (cov >= 256.0) color.a else kotlin.math.floor(color.a * (cov + 1.0) / 256.0).toInt()
        paint.color = (a shl 24) or (color.r shl 16) or (color.g shl 8) or color.b
        canvas.drawRect(x.toFloat(), 0f, (x + 1.0).toFloat(), rows.toFloat(), paint)
      }
      x += 1.0
    }
  }
}

/** The decorations of a container box's texts (runtime writer); the views are placed again from the last text pass's geometry. */
fun dragonSetTextDecorations(t: DragonTree, v: DragonBoxView, specs: List<DragonTextDecorationSpec>) {
  v.dragonTextDecorations = specs
  for (id in v.dragonDecoratedTextViews.keys.sorted()) dragonPlaceTextDecorations(v, id)
}

/** A written length at the device scale, as the translated decorationRects takes it. */
fun dragonDecorationLength(l: DragonDecorationLength, scale: Double): U_DecorationLength_auto_DecorationLength_percent_DecorationLength_px = when (l.kind) {
  "auto" -> DecorationLength_auto("auto")
  "px" -> DecorationLength_px("px", l.value * scale)
  "percent" -> DecorationLength_percent("percent", l.value)
  else -> throw IllegalStateException("dragon: a decoration length of kind " + l.kind)
}

/** The after-text hook: keeps the text's engine geometry and places its decoration views. */
fun dragonAfterTextDecoration(v: DragonBoxView, tv: DragonTextView, g: DragonTextGeometry) {
  v.dragonDecorationGeometry[g.id] = g
  v.dragonDecoratedTextViews[g.id] = tv
  dragonPlaceTextDecorations(v, g.id)
}

/**
 * Replaces a text's decoration views: decorationRects per decoration and line, under and overlines just beneath the text view in its
 * parent, line-throughs just above it, each in Blink's order.
 */
fun dragonPlaceTextDecorations(v: DragonBoxView, id: String) {
  val host0 = v.dragonDecoratedTextViews[id]?.parent as? ViewGroup
  for (o in v.dragonDecorationViews[id] ?: emptyList()) (o.parent as? ViewGroup)?.removeView(o)
  v.dragonDecorationViews.remove(id)
  val specs = v.dragonTextDecorations.filter { it.text == id }
  val g = v.dragonDecorationGeometry[id]
  val tv = v.dragonDecoratedTextViews[id]
  if (specs.isEmpty() || g == null || tv == null) return
  val host = host0 ?: throw IllegalStateException("dragon: " + id + ": a decorated text view is not in the tree")
  fun font(m: DoubleArray): DecorationFont = DecorationFont(m[0], m[1], m[2], 0.0)
  val textFont = font(g.textFont)
  // The text view's frame in its parent, in device px, against its absolute edges.
  val dx = tv.dragonFrame[0].toDouble() - g.origin[0]
  val dy = tv.dragonFrame[1].toDouble() - g.origin[1]
  val faults = DecorationFaults(false, false, false, false, false, false, false, false, false)
  val below = ArrayList<DragonDecorationView>()
  val above = ArrayList<DragonDecorationView>()
  for (d in specs) {
    val boxFont = if (d.box != null) font(g.boxFonts[d.box] ?: throw IllegalStateException("dragon: " + id + ": no font for the decorating box " + d.box)) else font(g.strutFont)
    for ((k, line) in g.lines.withIndex()) {
      val textTop = line[2]
      val baseline = textTop + textFont.ascent
      val input = DecorationInput(JsArray(d.lines), dragonDecorationLength(d.thickness, g.scale), dragonDecorationLength(d.offset, g.scale), boxFont, textFont, line[0], line[1], textTop, baseline - boxFont.ascent)
      for (r in textDecoration_decorationRects(input, faults)) {
        val o = DragonDecorationView(v.context)
        val x0 = kotlin.math.floor(r.left + dx)
        val x1 = kotlin.math.ceil(r.right + dx)
        if (d.skipInk && r.line != "line-through") {
          // TDEC-d: the compiler accepts skip-ink auto on Ahem only, one glyph per code point.
          val cps = g.cps[k]
          val pens = g.pens[k]
          if (cps.size != pens.size) throw IllegalStateException("dragon: " + id + " line " + k + ": " + cps.size + " code points and " + pens.size + " glyphs")
          val ink = textDecoration_ahemLineInk(ArrayList(cps.toList()), ArrayList(pens.toList()), textFont.size, baseline)
          o.clips = textDecoration_skipInkClips(r, ink, faults).map { it + dx - x0 }
        }
        o.text = id
        o.beforeText = r.beforeText
        o.left0 = r.left + dx - x0
        o.right0 = r.right + dx - x0
        o.rows = r.height
        o.color = d.color
        dragonSetFrame(o.dragonFrame, x0, r.top + dy, x1, r.top + dy + r.height, id + " decoration")
        if (r.beforeText) below.add(o) else above.add(o)
      }
    }
  }
  for (o in below) host.addView(o, host.indexOfChild(tv))
  for (o in above.reversed()) host.addView(o, host.indexOfChild(tv) + 1)
  host.requestLayout()
  for (o in below + above) o.invalidate()
  v.dragonDecorationViews[id] = below + above
}

/**
 * The readback of the text-decoration module: per decorated text its decorations as stored, and whether every rect view sits in the
 * text view's parent on its side (under and overlines beneath, line-throughs above).
 */
fun dragonAppliedTextDecoration(v: DragonBoxView): List<Pair<String, DumpJson>> {
  if (v.dragonTextDecorations.isEmpty()) return emptyList()
  val out = ArrayList<DumpJson>()
  for (d in v.dragonTextDecorations) {
    var ordered = true
    val tv = v.dragonDecoratedTextViews[d.text]
    val host = tv?.parent as? ViewGroup
    if (tv == null || host == null) ordered = false else {
      val ti = host.indexOfChild(tv)
      for (o in v.dragonDecorationViews[d.text] ?: emptyList()) {
        val i = if (o.parent === host) host.indexOfChild(o) else -1
        if (i < 0 || o.beforeText != (i < ti)) ordered = false
      }
    }
    out.add(DumpJson.Obj(listOf(
      Pair("text", DumpJson.Str(d.text)),
      Pair("box", if (d.box == null) DumpJson.Null else DumpJson.Str(d.box)),
      Pair("lines", DumpJson.Arr(d.lines.map { DumpJson.Str(it) })),
      Pair("color", dragonRGBAJson(d.color)),
      Pair("thickness", DumpJson.Arr(listOf(DumpJson.Str(d.thickness.kind), DumpJson.Num(d.thickness.value)))),
      Pair("offset", DumpJson.Arr(listOf(DumpJson.Str(d.offset.kind), DumpJson.Num(d.offset.value)))),
      Pair("skipInk", DumpJson.Bool(d.skipInk)),
      Pair("ordered", DumpJson.Bool(ordered)),
    )))
  }
  return listOf(Pair("dragonTextDecoration", DumpJson.Arr(out)))
}
`;

export const TEXT_DECORATION_EMITTER: PaintEmitter<'text-decoration', 'decoration-above-text' | 'decoration-snap-css-px' | 'decoration-alpha-ignored'> = {
  name: 'text-decoration',
  kinds: ['text-decoration'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetTextDecorations(t, ${v}, [${w.entries.map((e) => entryLit('swift', e)).join(', ')}])`],
    'android-views': (v, _n, w) => [`  dragonSetTextDecorations(t, ${v}, listOf(${w.entries.map((e) => entryLit('kotlin', e)).join(', ')}))`],
  },
  applied: (_e, _b, w) => w.entries.map(appliedEntry),
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, applied: 'dragonAppliedTextDecoration', afterText: 'dragonAfterTextDecoration' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, applied: 'dragonAppliedTextDecoration', afterText: 'dragonAfterTextDecoration' },
  },
  // The raster plants of notes/T148J-tdec.md TDEC-b, each caught by the decoration points (parity paint-samples/text-decoration.ts):
  // decorationViewAboveText puts the under and overline views above the text view, so they cover the glyphs they cross;
  // deviceSnapInCssPx places each rect view's top at a whole css px instead of its snapped device row; decorationColourIgnoresAlpha
  // paints every covered column opaque.
  plants: [
    {
      name: 'decoration-above-text',
      replace: {
        uikit: ['  for o in below { host.insertSubview(o, belowSubview: tv) }\n', '  for o in below { host.insertSubview(o, aboveSubview: tv) }\n'],
        'android-views': ['  for (o in below) host.addView(o, host.indexOfChild(tv))\n', '  for (o in below) host.addView(o, host.indexOfChild(tv) + 1)\n'],
      },
    },
    {
      name: 'decoration-snap-css-px',
      replace: {
        uikit: ['y: CGFloat((r.top + dy) / s), width', 'y: CGFloat(((r.top + dy) / s).rounded()), width'],
        'android-views': [
          'dragonSetFrame(o.dragonFrame, x0, r.top + dy, x1, r.top + dy + r.height, id + " decoration")',
          'dragonSetFrame(o.dragonFrame, x0, kotlin.math.floor(kotlin.math.round((r.top + dy) / g.scale) * g.scale), x1, kotlin.math.floor(kotlin.math.round((r.top + dy) / g.scale) * g.scale) + r.height, id + " decoration")',
        ],
      },
    },
    {
      name: 'decoration-alpha-ignored',
      replace: {
        uikit: ['let a = cov >= 256 ? Double(color.a) :', 'let a = cov >= 256 ? 255.0 :'],
        'android-views': ['val a = if (cov >= 256.0) color.a else', 'val a = if (cov >= 256.0) 255 else'],
      },
    },
  ],
};
