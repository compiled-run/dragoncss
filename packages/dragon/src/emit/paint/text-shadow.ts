// Text shadows on the native tree (TXT-FX, lower/paint/text-shadow.ts): the case code writes a container box's shadowed texts through
// dragonSetTextShadows. After the text pass configures a text view (the after-text hook, native-support.ts DragonTextGeometry) the
// device runs the translated paint-shadow.ts textShadowLayerOver over the line's Ahem code points, glyph pens and baseline in page
// device px, at the device scale, over the backdrop the container and its ancestors paint, and shows the layer as a bitmap in a
// DragonShadowView (the shadow module's) per line, the lines' views in line order just beneath the text view in its superview: Chrome
// paints a fragment's shadows, then its text. The compiler accepts native text shadows on undecorated Ahem text whose wrapped lines'
// shadows never reach the line above (analysis/text-shadow.ts wrapRefusal), so the text view may draw over every line's shadow. A background
// write re-places the shadows of the box and of its descendants (dragonShadowBackdropChanged), whose backdrop it changes.
// The readback is, per shadowed text, its shadows as written and whether its views sit beneath the text view.
import type { TextShadowEntry } from '../../lower/paint/text-shadow.ts';
import type { JsonValue } from '../expected-dump.ts';
import { strLit } from './text-decoration.ts';
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const num = (v: number, what: string): string => {
  if (!Number.isFinite(v)) throw new Error(`text-shadow ${what} ${v} is not finite`);
  const n = String(v);
  return /[.eE]/.test(n) ? n.replace(/e\+?/, 'E') : `${n}.0`;
};

function shadowLits(e: TextShadowEntry): string[] {
  return e.shadows.map((s) => {
    const w = `${e.text} shadow`;
    return `ShadowInput(false, ${num(s.x, w)}, ${num(s.y, w)}, ${num(s.blur, w)}, 0.0, ${num(s.color.r, w)}, ${num(s.color.g, w)}, ${num(s.color.b, w)}, ${num(s.color.alpha, w)})`;
  });
}

/** The readback of one entry: the shadows as [x, y, blur, r, g, b, a], and whether the shadow views sit beneath the text view (always). */
export function appliedTextShadow(e: TextShadowEntry): JsonValue {
  return { text: e.text, shadows: e.shadows.map((s) => [s.x, s.y, s.blur, s.color.r, s.color.g, s.color.b, s.color.alpha]), beneath: true };
}

const SWIFT_MEMBERS = String.raw`  /// TXT-FX: the shadows of the texts of this box's inline formatting context, as written.
  public var dragonTextShadows: [DragonTextShadowSpec] = []
  /// The shadow views of each shadowed text, one per line in line order, placed in the text view's superview by the last text pass or write.
  public var dragonTextShadowViews: [String: [DragonShadowView]] = [:]
  /// The engine geometry and the text view of each text of this box at the last text pass.
  public var dragonTextShadowGeometry: [String: DragonTextGeometry] = [:]
  public var dragonTextShadowTextViews: [String: DragonTextView] = [:]
`;

const SWIFT = String.raw`import UIKit

/// Device px added to each text shadow view's y; 0 except in the text-shadow-offset-1 raster plant build.
public let dragonTextShadowPlantDevicePx: Double = 0

/// The shadows of one text: css px at zoom 1 and sRGB RGBA8 colours, in list order.
public struct DragonTextShadowSpec {
  public let text: String
  public let shadows: [ShadowInput]
  public init(_ text: String, _ shadows: [ShadowInput]) { self.text = text; self.shadows = shadows }
}

/// The text shadows of a container box's texts (runtime writer); the views are placed again from the last text pass's geometry.
public func dragonSetTextShadows(_ t: DragonTree, _ v: DragonBoxView, _ specs: [DragonTextShadowSpec]) {
  v.dragonTextShadows = specs
  dragonReplaceTextShadows(v)
}

/// Places every shadowed text's view again (after a write or a change of the backdrop).
public func dragonReplaceTextShadows(_ v: DragonBoxView) {
  for id in Array(v.dragonTextShadowTextViews.keys).sorted() { dragonPlaceTextShadow(v, id) }
}

/// The after-text hook: keeps the text's engine geometry and places its shadow view.
public func dragonAfterTextShadow(_ v: DragonBoxView, _ tv: DragonTextView, _ g: DragonTextGeometry) {
  v.dragonTextShadowGeometry[g.id] = g
  v.dragonTextShadowTextViews[g.id] = tv
  dragonPlaceTextShadow(v, g.id)
}

/// Replaces a text's shadow views: textShadowLayerOver over each of its lines, as bitmaps in line order just beneath the text view.
public func dragonPlaceTextShadow(_ v: DragonBoxView, _ id: String) {
  for o in v.dragonTextShadowViews[id] ?? [] { o.removeFromSuperview() }
  v.dragonTextShadowViews[id] = nil
  guard let spec = v.dragonTextShadows.first(where: { $0.text == id }), let g = v.dragonTextShadowGeometry[id], let tv = v.dragonTextShadowTextViews[id] else { return }
  guard let host = tv.superview else { fatalError("dragon: \(id): a shadowed text view is not in the tree") }
  // The compiler accepts native text shadows on Ahem text (one glyph per code point); the text view draws one spec per line.
  if tv.specs.count != g.lines.count { fatalError("dragon: \(id): a shadowed text view shows \(tv.specs.count) of \(g.lines.count) lines") }
  let s = g.scale
  let backdrop = dragonShadowBackdrop(v, own: true)
  // The text view's frame in its superview, in device px, against its absolute edges (whole device px).
  let dx = (Double(tv.frame.minX) * s - g.origin[0]).rounded()
  let dy = (Double(tv.frame.minY) * s - g.origin[1]).rounded()
  let cg = CGFloat(s)
  var views: [DragonShadowView] = []
  CATransaction.begin()
  CATransaction.setDisableActions(true)
  for i in 0..<g.lines.count {
    if g.cps[i].count != g.pens[i].count { fatalError("dragon: \(id): line \(i) has \(g.cps[i].count) code points and \(g.pens[i].count) glyphs") }
    // The baseline the text view draws the line's glyphs on, in page device px.
    let baseline = tv.specs[i].baseline + g.origin[1]
    let layer: ShadowLayer
    do {
      layer = try paintShadow_textShadowLayerOver(JsArray(g.cps[i]), JsArray(g.pens[i]), g.textFont[2], baseline, JsArray(spec.shadows), s, ShadowFaults(false, false, false), JsArray(backdrop))
    } catch {
      fatalError("dragon: \(id): paint-shadow textShadowLayerOver failed on line \(i): \(error)")
    }
    let w = dragonCheckedInt(layer.right - layer.left, "\(id) line \(i) text shadow width")
    let h = dragonCheckedInt(layer.bottom - layer.top, "\(id) line \(i) text shadow height")
    if w == 0 || h == 0 { continue }
    let o = DragonShadowView()
    o.frame = CGRect(x: CGFloat(layer.left + dx) / cg, y: CGFloat(layer.top + dy + dragonTextShadowPlantDevicePx) / cg, width: CGFloat(w) / cg, height: CGFloat(h) / cg)
    o.bitmapLayer.contents = dragonShadowImage(layer.rgba.items, w, h)
    o.bitmapLayer.frame = CGRect(x: 0, y: 0, width: CGFloat(w) / cg, height: CGFloat(h) / cg)
    // Each line's view goes just beneath the text view, so later lines' shadows lie over earlier lines' (Chrome's line order).
    host.insertSubview(o, belowSubview: tv)
    views.append(o)
  }
  CATransaction.commit()
  if !views.isEmpty { v.dragonTextShadowViews[id] = views }
}

/// The readback of the text-shadow module: per shadowed text its shadows as stored, and whether its view sits beneath the text view.
public func dragonAppliedTextShadow(_ v: DragonBoxView) -> DumpJsonObject {
  if v.dragonTextShadows.isEmpty { return [] }
  var out: [DumpJson] = []
  for d in v.dragonTextShadows {
    var beneath = false
    if let tv = v.dragonTextShadowTextViews[d.text], let host = tv.superview, let ti = host.subviews.firstIndex(of: tv), let views = v.dragonTextShadowViews[d.text] {
      beneath = views.allSatisfy { o in o.superview === host && (host.subviews.firstIndex(of: o).map { $0 < ti } ?? false) }
    }
    out.append(.object([
      ("text", .string(d.text)),
      ("shadows", .array(d.shadows.map { s in .array([s.x, s.y, s.blur, s.r, s.g, s.b, s.a].map { .number($0) }) })),
      ("beneath", .bool(beneath)),
    ]))
  }
  return [("dragonTextShadow", .array(out))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** TXT-FX: the shadows of the texts of this box's inline formatting context, as written. */
  var dragonTextShadows: List<DragonTextShadowSpec> = emptyList()
  /** The shadow views of each shadowed text, one per line in line order, placed in the text view's parent by the last text pass or write. */
  val dragonTextShadowViews = HashMap<String, List<DragonShadowView>>()
  /** The engine geometry and the text view of each text of this box at the last text pass. */
  val dragonTextShadowGeometry = HashMap<String, DragonTextGeometry>()
  val dragonTextShadowTextViews = HashMap<String, DragonTextView>()
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.view.ViewGroup
import dev.dragon.dump.DumpJson
import dev.dragon.layout.ShadowFaults
import dev.dragon.layout.ShadowInput
import dev.dragon.layout.paintShadow_textShadowLayerOver

/** Device px added to each text shadow bitmap's y; 0 except in the text-shadow-offset-1 raster plant build. */
const val DRAGON_TEXT_SHADOW_PLANT_DEVICE_PX = 0

/** The shadows of one text: css px at zoom 1 and sRGB RGBA8 colours, in list order. */
class DragonTextShadowSpec(val text: String, val shadows: List<ShadowInput>)

/** The text shadows of a container box's texts (runtime writer); the views are placed again from the last text pass's geometry. */
fun dragonSetTextShadows(t: DragonTree, v: DragonBoxView, specs: List<DragonTextShadowSpec>) {
  v.dragonTextShadows = specs
  dragonReplaceTextShadows(v)
}

/** Places every shadowed text's view again (after a write or a change of the backdrop). */
fun dragonReplaceTextShadows(v: DragonBoxView) {
  for (id in v.dragonTextShadowTextViews.keys.sorted()) dragonPlaceTextShadow(v, id)
}

/** The after-text hook: keeps the text's engine geometry and places its shadow view. */
fun dragonAfterTextShadow(v: DragonBoxView, tv: DragonTextView, g: DragonTextGeometry) {
  v.dragonTextShadowGeometry[g.id] = g
  v.dragonTextShadowTextViews[g.id] = tv
  dragonPlaceTextShadow(v, g.id)
}

/** Replaces a text's shadow views: textShadowLayerOver over each of its lines, as bitmaps in line order just beneath the text view. */
fun dragonPlaceTextShadow(v: DragonBoxView, id: String) {
  val old = v.dragonTextShadowViews.remove(id)
  if (old != null) for (o in old) (o.parent as? ViewGroup)?.removeView(o)
  val spec = v.dragonTextShadows.firstOrNull { it.text == id }
  val g = v.dragonTextShadowGeometry[id]
  val tv = v.dragonTextShadowTextViews[id]
  if (spec == null || g == null || tv == null) return
  val host = tv.parent as? ViewGroup ?: throw IllegalStateException("dragon: " + id + ": a shadowed text view is not in the tree")
  // The compiler accepts native text shadows on Ahem text (one glyph per code point); the text view draws one spec per line.
  if (tv.specs.size != g.lines.size) throw IllegalStateException("dragon: " + id + ": a shadowed text view shows " + tv.specs.size + " of " + g.lines.size + " lines")
  val backdrop = dragonShadowBackdrop(v, true)
  // The text view's frame in its parent, in device px, against its absolute edges.
  val dx = tv.dragonFrame[0].toDouble() - g.origin[0]
  val dy = tv.dragonFrame[1].toDouble() - g.origin[1]
  val views = ArrayList<DragonShadowView>()
  for (i in g.lines.indices) {
    val cps = g.cps[i]
    val pens = g.pens[i]
    if (cps.size != pens.size) throw IllegalStateException("dragon: " + id + ": line " + i + " has " + cps.size + " code points and " + pens.size + " glyphs")
    // The baseline the text view draws the line's glyphs on, in page device px.
    val baseline = tv.specs[i].baseline.toDouble() + g.origin[1]
    val layer = paintShadow_textShadowLayerOver(ArrayList(cps.toList()), ArrayList(pens.toList()), g.textFont[2], baseline, ArrayList(spec.shadows), g.scale, ShadowFaults(false, false, false), ArrayList(backdrop))
    val w = dragonCheckedInt(layer.right - layer.left, id + " line " + i + " text shadow width")
    val h = dragonCheckedInt(layer.bottom - layer.top, id + " line " + i + " text shadow height")
    if (w == 0 || h == 0) continue
    val o = DragonShadowView(v.context)
    o.bitmap = dragonShadowBitmap(layer.rgba, w, h)
    o.dx = 0
    o.dy = DRAGON_TEXT_SHADOW_PLANT_DEVICE_PX
    dragonSetFrame(o.dragonFrame, layer.left + dx, layer.top + dy, layer.right + dx, layer.bottom + dy, id + " line " + i + " text shadow")
    // Each line's view goes just beneath the text view, so later lines' shadows lie over earlier lines' (Chrome's line order).
    host.addView(o, host.indexOfChild(tv))
    o.invalidate()
    views.add(o)
  }
  host.requestLayout()
  if (views.isNotEmpty()) v.dragonTextShadowViews[id] = views
}

/** The readback of the text-shadow module: per shadowed text its shadows as stored, and whether its view sits beneath the text view. */
fun dragonAppliedTextShadow(v: DragonBoxView): List<Pair<String, DumpJson>> {
  if (v.dragonTextShadows.isEmpty()) return emptyList()
  val out = ArrayList<DumpJson>()
  for (d in v.dragonTextShadows) {
    val tv = v.dragonTextShadowTextViews[d.text]
    val views = v.dragonTextShadowViews[d.text]
    val host = tv?.parent as? ViewGroup
    val beneath = tv != null && views != null && host != null && views.all { o -> o.parent === host && host.indexOfChild(o) < host.indexOfChild(tv) }
    out.add(DumpJson.Obj(listOf(
      Pair("text", DumpJson.Str(d.text)),
      Pair("shadows", DumpJson.Arr(d.shadows.map { s -> DumpJson.Arr(listOf(s.x, s.y, s.blur, s.r, s.g, s.b, s.a).map { DumpJson.Num(it) }) })),
      Pair("beneath", DumpJson.Bool(beneath)),
    )))
  }
  return listOf(Pair("dragonTextShadow", DumpJson.Arr(out)))
}
`;

export const TEXT_SHADOW_EMITTER: PaintEmitter<'text-shadow', 'text-shadow-offset-1'> = {
  name: 'text-shadow',
  kinds: ['text-shadow'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetTextShadows(t, ${v}, [${w.entries.map((e) => `DragonTextShadowSpec(${strLit('swift', e.text)}, [${shadowLits(e).join(', ')}])`).join(', ')}])`],
    'android-views': (v, _n, w) => [`  dragonSetTextShadows(t, ${v}, listOf(${w.entries.map((e) => `DragonTextShadowSpec(${strLit('kotlin', e.text)}, listOf(${shadowLits(e).join(', ')}))`).join(', ')}))`],
  },
  applied: (_e, _b, w) => w.entries.map(appliedTextShadow),
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, applied: 'dragonAppliedTextShadow', afterText: 'dragonAfterTextShadow' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, applied: 'dragonAppliedTextShadow', afterText: 'dragonAfterTextShadow' },
  },
  // The raster plant: every text shadow drawn one device px lower (the clean pixels lie on the vertical blur ramps below the glyphs), caught by the text-shadow points (parity
  // paint-samples/text-shadow.ts) at every scale.
  plants: [
    {
      name: 'text-shadow-offset-1',
      replace: {
        uikit: ['public let dragonTextShadowPlantDevicePx: Double = 0\n', 'public let dragonTextShadowPlantDevicePx: Double = 1\n'],
        'android-views': ['const val DRAGON_TEXT_SHADOW_PLANT_DEVICE_PX = 0\n', 'const val DRAGON_TEXT_SHADOW_PLANT_DEVICE_PX = 1\n'],
      },
    },
  ],
};
