// GEN-c outside list markers on the marker box view (lower/paint/list-marker.ts): the case code writes the symbol and the list
// item's colour through dragonSetListMarker. After every layout DragonTree.apply runs the translated paint-marker.ts
// markerSymbolPaint over the zoomed marker at the marker box's absolute LU origin and stores its rect (device px from the view) and
// coverage; this module's after-layout hook turns coverage times colour into a premultiplied bitmap, drawn 1:1 at that device-px
// offset. The view's frame is snapped to device px, so no pixel is resampled.
import { keywordLit, NO_NATIVE_PAINT, rgbaLit } from './types.ts';
import type { PaintEmitter } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// The list marker's symbol ("disc" or "square") and colour as written; an empty symbol for a box that is no marker.
  public var dragonMarkerSymbol = ""
  public var dragonMarkerColor = DragonRGBA8(0, 0, 0, 0)
  /// The marker's rect in device px from the view (x, y, width, height) and its coverage, from paint-marker.ts after each layout.
  public var dragonMarkerRect: [Double] = [0, 0, 0, 0]
  public var dragonMarkerCoverage: [Double] = []
  /// The coverage times the colour as a premultiplied bitmap, drawn at the background stage.
  public var dragonMarkerImage: CGImage? = nil
`;

const SWIFT = String.raw`import UIKit

/// The marker write of a marker box (runtime writer): the symbol and the list item's colour, then the bitmap for the last layout.
public func dragonSetListMarker(_ v: DragonBoxView, _ symbol: String, _ color: DragonRGBA8) {
  if symbol != "disc" && symbol != "square" { fatalError("dragon: \(v.dragonId): list marker \(symbol) is not disc or square") }
  v.dragonMarkerSymbol = symbol
  v.dragonMarkerColor = color
  dragonAfterLayoutListMarker(v, v.dragonShape, v.dragonScale)
}

/// After every layout: the marker's coverage (set by DragonTree.apply) times its colour, premultiplied with integer rounding.
public func dragonAfterLayoutListMarker(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  if v.dragonMarkerSymbol.isEmpty { return }
  let w = dragonCheckedInt(v.dragonMarkerRect[2], "\(v.dragonId) marker width")
  let h = dragonCheckedInt(v.dragonMarkerRect[3], "\(v.dragonId) marker height")
  if v.dragonMarkerCoverage.count != max(0, w) * max(0, h) { fatalError("dragon: \(v.dragonId): \(v.dragonMarkerCoverage.count) marker coverage values for a \(w)x\(h) rect") }
  let c = v.dragonMarkerColor
  var rgba = [Double](repeating: 0, count: v.dragonMarkerCoverage.count * 4)
  for (k, cov) in v.dragonMarkerCoverage.enumerated() {
    let a = (dragonCheckedInt(cov, "\(v.dragonId) marker coverage") * c.a + 127) / 255
    rgba[4 * k] = Double((c.r * a + 127) / 255)
    rgba[4 * k + 1] = Double((c.g * a + 127) / 255)
    rgba[4 * k + 2] = Double((c.b * a + 127) / 255)
    rgba[4 * k + 3] = Double(a)
  }
  v.dragonMarkerImage = dragonShadowImage(rgba, w, h)
  v.setNeedsDisplay()
}

/// The background stage of a marker box: its bitmap at its device-px rect, unfiltered.
public func dragonPaintListMarkerStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  guard let img = v.dragonMarkerImage else { return }
  let s = CGFloat(v.dragonScale)
  let r = v.dragonMarkerRect
  ctx.saveGState()
  ctx.interpolationQuality = .none
  UIImage(cgImage: img).draw(in: CGRect(x: CGFloat(r[0]) / s, y: CGFloat(r[1]) / s, width: CGFloat(r[2]) / s, height: CGFloat(r[3]) / s))
  ctx.restoreGState()
}

/// The readback of the list-marker module: the symbol and the colour as written.
public func dragonAppliedListMarker(_ v: DragonBoxView) -> DumpJsonObject {
  if v.dragonMarkerSymbol.isEmpty { return [] }
  let c = v.dragonMarkerColor
  return [("dragonListMarker", .array([.string(v.dragonMarkerSymbol), .number(Double(c.r)), .number(Double(c.g)), .number(Double(c.b)), .number(Double(c.a))]))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The list marker's symbol ("disc" or "square") and colour as written; an empty symbol for a box that is no marker. */
  var dragonMarkerSymbol = ""
  var dragonMarkerColor = DragonRGBA8(0, 0, 0, 0)
  /** The marker's rect in device px from the view (x, y, width, height) and its coverage, from paint-marker.ts after each layout. */
  var dragonMarkerRect = intArrayOf(0, 0, 0, 0)
  var dragonMarkerCoverage: List<Double> = emptyList()
  /** The coverage times the colour as a premultiplied bitmap, drawn at the background stage. */
  var dragonMarkerBitmap: android.graphics.Bitmap? = null
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.Canvas
import dev.dragon.dump.DumpJson

/** The marker write of a marker box (runtime writer): the symbol and the list item's colour, then the bitmap for the last layout. */
fun dragonSetListMarker(v: DragonBoxView, symbol: String, color: DragonRGBA8) {
  if (symbol != "disc" && symbol != "square") throw IllegalStateException("dragon: " + v.dragonId + ": list marker " + symbol + " is not disc or square")
  v.dragonMarkerSymbol = symbol
  v.dragonMarkerColor = color
  dragonAfterLayoutListMarker(v, v.dragonShape, 1.0)
}

/** After every layout: the marker's coverage (set by DragonTree.apply) times its colour, premultiplied with integer rounding. */
fun dragonAfterLayoutListMarker(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  if (v.dragonMarkerSymbol.isEmpty()) return
  val w = v.dragonMarkerRect[2]
  val h = v.dragonMarkerRect[3]
  if (v.dragonMarkerCoverage.size != maxOf(0, w) * maxOf(0, h)) throw IllegalStateException("dragon: " + v.dragonId + ": " + v.dragonMarkerCoverage.size + " marker coverage values for a " + w + "x" + h + " rect")
  val c = v.dragonMarkerColor
  val rgba = ArrayList<Double>(v.dragonMarkerCoverage.size * 4)
  for (cov in v.dragonMarkerCoverage) {
    val a = (dragonCheckedInt(cov, v.dragonId + " marker coverage") * c.a + 127) / 255
    rgba.add(((c.r * a + 127) / 255).toDouble())
    rgba.add(((c.g * a + 127) / 255).toDouble())
    rgba.add(((c.b * a + 127) / 255).toDouble())
    rgba.add(a.toDouble())
  }
  v.dragonMarkerBitmap = dragonShadowBitmap(rgba, w, h)
  v.invalidate()
}

/** The background stage of a marker box: its bitmap at its device-px offset, unfiltered (1:1). */
fun dragonPaintListMarkerStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  val b = v.dragonMarkerBitmap ?: return
  canvas.drawBitmap(b, v.dragonMarkerRect[0].toFloat(), v.dragonMarkerRect[1].toFloat(), null)
}

/** The readback of the list-marker module: the symbol and the colour as written. */
fun dragonAppliedListMarker(v: DragonBoxView): List<Pair<String, DumpJson>> {
  if (v.dragonMarkerSymbol.isEmpty()) return emptyList()
  val c = v.dragonMarkerColor
  return listOf(Pair("dragonListMarker", DumpJson.Arr(listOf(DumpJson.Str(v.dragonMarkerSymbol), DumpJson.Num(c.r.toDouble()), DumpJson.Num(c.g.toDouble()), DumpJson.Num(c.b.toDouble()), DumpJson.Num(c.a.toDouble())))))
}
`;

export const LIST_MARKER_EMITTER: PaintEmitter<'list-marker'> = {
  name: 'list-marker',
  kinds: ['list-marker'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetListMarker(${v}, ${keywordLit(w.symbol)}, ${rgbaLit(w.color)})`],
    'android-views': (v, _n, w) => [`  dragonSetListMarker(${v}, ${keywordLit(w.symbol)}, ${rgbaLit(w.color)})`],
  },
  applied: (_e, _b, w) => [w.symbol, w.color.r, w.color.g, w.color.b, w.color.alpha],
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, stages: { background: 'dragonPaintListMarkerStage' }, afterLayout: 'dragonAfterLayoutListMarker', applied: 'dragonAppliedListMarker' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, stages: { background: 'dragonPaintListMarkerStage' }, afterLayout: 'dragonAfterLayoutListMarker', applied: 'dragonAppliedListMarker' },
  },
  plants: [],
};
