// Gradient background layers (BG2): Dragon-owned paint on the box view. The case code writes the layers through the public
// writer; after every layout the translated paint-gradient.ts plans the background at the device scale (Blink's tile geometry
// on the unsnapped border box) and rasterises the colour and every layer into one device-pixel bitmap, which the
// background-layers stage draws over the native background colour, pixel for pixel (notes/T046-paint-spec.md §1).
import type { LoweredGradient, LoweredLayer } from '../../lower/paint/gradient.ts';
import type { PaintEmitter } from './types.ts';
import { keywordLit, NO_NATIVE_PAINT } from './types.ts';

type Lang = 'swift' | 'kotlin';

/** A Double literal that reads back as the same double in Swift and Kotlin (native-support.ts doubleLit). */
function num(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`non-finite number ${v} in a gradient`);
  if (Object.is(v, -0)) return '-0.0';
  const s = String(v);
  return /[.e]/.test(s) ? s.replace(/e\+?/, 'E') : `${s}.0`;
}

const str = (lang: Lang, k: string): string => (lang === 'swift' ? `JsString(${keywordLit(k)})` : keywordLit(k));
const arr = (lang: Lang, type: string, items: readonly string[]): string => (lang === 'swift' ? `JsArray<${type}>([${items.join(', ')}])` : `jsArrayOf<${type}>(${items.join(', ')})`);
const color = (c: { r: number; g: number; b: number; alpha: number }): string => `StopColor(${num(c.r)}, ${num(c.g)}, ${num(c.b)}, ${num(c.alpha)})`;
const lengthPct = (lang: Lang, v: { unit: string; value: number }): string => `LengthPct(${str(lang, v.unit)}, ${num(v.value)})`;

/** A translated GradientImage constructor call. */
function gradientImage(lang: Lang, g: LoweredGradient): string {
  const stops = g.stops.map((s) => `CssStop(${color(s.color)}, ${str(lang, s.unit)}, ${num(s.value)})`);
  return `GradientImage(${g.radial}, ${g.repeating}, ${str(lang, g.direction)}, ${num(g.angleDeg)}, ${str(lang, g.sideX)}, ${str(lang, g.sideY)}, ${g.circle}, ${str(lang, g.extent)}, ${lengthPct(lang, g.radiusX)}, ${lengthPct(lang, g.radiusY)}, ${lengthPct(lang, g.centerX)}, ${lengthPct(lang, g.centerY)}, ${arr(lang, 'CssStop', stops)})`;
}

/** A translated BackgroundLayer constructor call. */
function layer(lang: Lang, l: LoweredLayer): string {
  const g = l.geometry;
  const size = (c: { unit: string; value: number }): string => `SizeComponent(${str(lang, c.unit)}, ${num(c.value)})`;
  const geometry = `LayerGeometry(${str(lang, g.sizeKind)}, ${size(g.sizeX)}, ${size(g.sizeY)}, ${lengthPct(lang, g.positionX)}, ${lengthPct(lang, g.positionY)}, ${str(lang, g.repeatX)}, ${str(lang, g.repeatY)}, ${str(lang, g.origin)}, ${str(lang, g.clip)})`;
  return `BackgroundLayer(${geometry}, ${gradientImage(lang, l.gradient)})`;
}

const SWIFT_MEMBERS = String.raw`  /// The gradient layers the case code wrote (BG2) and the raster of the last layout.
  public var dragonGradientLayers: DragonGradientLayers? = nil { didSet { dragonGradientRaster = nil; setNeedsDisplay() } }
  public var dragonGradientRaster: DragonGradientRaster? = nil
`;

const SWIFT = String.raw`import UIKit

/// A box's gradient background (BG2), as the case code writes it: the colour, the colour's clip, which border sides hide the
/// background ("always", "never", or "double": below 3 device px) and the gradient layers, top first.
public final class DragonGradientLayers {
  public let color: StopColor
  public let colorClip: String
  public let obscures: [String]
  public let layers: [BackgroundLayer]
  public let lastIsBottom: Bool
  public init(color: StopColor, colorClip: String, obscures: [String], layers: [BackgroundLayer], lastIsBottom: Bool) {
    self.color = color; self.colorClip = colorClip; self.obscures = obscures; self.layers = layers; self.lastIsBottom = lastIsBottom
  }
}

/// The raster of one layout: premultiplied sRGB over the border box in device px, and whether every layer drew one tile of a
/// modelled shader (paint-gradient.ts BackgroundPlan.modelled).
public struct DragonGradientRaster {
  public let image: CGImage?
  public let modelled: Bool
}

/// Device px the raster is drawn right of the border box: 0 except in the gradient-offset-1 raster plant build.
public let dragonGradientPlantDevicePx: Double = 0

/// The writer (RT-1, RT-11): the case code and runtime writes set a box's gradient layers through it.
public func dragonSetBackgroundLayers(_ v: DragonBoxView, _ p: DragonGradientLayers) {
  v.dragonGradientLayers = p
}

/// After every layout: plan the background on the unsnapped border box at the device scale and rasterise it row by row with
/// the translated paint-gradient.ts.
public func dragonAfterLayoutGradient(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let p = v.dragonGradientLayers else { return }
  do {
    let obscures = (0..<4).map { k in p.obscures[k] == "always" || (p.obscures[k] == "double" && shape.borders[k] < 3) }
    let box = BackgroundBox(shape.lu[0], shape.lu[1], shape.lu[2], shape.lu[3], JsArray(shape.borders.map { $0 * units_LU_PER_PX }), JsArray([0, 0, 0, 0]), JsArray(obscures))
    let paint = BackgroundPaint(box, p.color, JsString(p.colorClip), JsArray(p.layers), p.lastIsBottom, scale, try paintGradient_referenceTileSize(scale))
    let faults = try paintGradient_gradientFaults(JsString("none"))
    let plan = try paintGradient_planBackground(paint, faults)
    let left = Int(plan.left)
    let top = Int(plan.top)
    let w = Int(plan.right) - left
    let h = Int(plan.bottom) - top
    guard w > 0 && h > 0 else { v.dragonGradientRaster = DragonGradientRaster(image: nil, modelled: plan.modelled); return }
    var bytes = [UInt8](repeating: 0, count: w * h * 4)
    for y in 0..<h {
      let row = try paintGradient_backgroundRow(plan, Double(top + y), faults).items
      if row.count != w * 4 { fatalError("dragon: the gradient row of \(v.dragonId) has \(row.count) values, not \(w * 4)") }
      for i in 0..<row.count { bytes[y * w * 4 + i] = UInt8(row[i]) }
    }
    let provider = CGDataProvider(data: Data(bytes) as CFData)
    let image = provider.flatMap { CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: $0, decode: nil, shouldInterpolate: false, intent: .defaultIntent) }
    if image == nil { fatalError("dragon: the gradient raster of \(v.dragonId) is not a CGImage") }
    v.dragonGradientRaster = DragonGradientRaster(image: image, modelled: plan.modelled)
  } catch {
    fatalError("dragon: the gradient raster of \(v.dragonId) threw: \(error)")
  }
  v.setNeedsDisplay()
}

/// The background-layers stage: the raster over the box's bounds, one image pixel per device pixel.
public func dragonPaintGradientStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  guard let r = v.dragonGradientRaster, let image = r.image else { return }
  let s = CGFloat(v.dragonScale)
  let rect = CGRect(x: CGFloat(dragonGradientPlantDevicePx) / s, y: 0, width: CGFloat(image.width) / s, height: CGFloat(image.height) / s)
  ctx.saveGState()
  ctx.interpolationQuality = .none
  // UIKit's context is flipped; CGContext.draw puts an image's first row at the bottom of its rect.
  ctx.translateBy(x: 0, y: rect.height)
  ctx.scaleBy(x: 1, y: -1)
  ctx.draw(image, in: rect)
  ctx.restoreGState()
}

/// The readback of the gradient module: the layer count, the colour clip and whether the device drew every layer as one tile.
public func dragonAppliedGradient(_ v: DragonBoxView) -> DumpJsonObject {
  guard let p = v.dragonGradientLayers else { return [] }
  return [("dragonBackgroundLayers", .object([
    ("layers", .number(Double(p.layers.count))),
    ("colorClip", .string(p.colorClip)),
    ("modelled", .bool(v.dragonGradientRaster?.modelled ?? false)),
  ]))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The gradient layers the case code wrote (BG2) and the raster of the last layout. */
  var dragonGradientLayers: DragonGradientLayers? = null
    set(value) { field = value; dragonGradientRaster = null; invalidate() }
  var dragonGradientRaster: DragonGradientRaster? = null
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.Bitmap
import android.graphics.Canvas
import dev.dragon.dump.DumpJson
import dev.dragon.layout.BackgroundBox
import dev.dragon.layout.BackgroundLayer
import dev.dragon.layout.BackgroundPaint
import dev.dragon.layout.StopColor
import dev.dragon.layout.jsArrayOf
import dev.dragon.layout.paintGradient_backgroundRow
import dev.dragon.layout.paintGradient_gradientFaults
import dev.dragon.layout.paintGradient_planBackground
import dev.dragon.layout.paintGradient_referenceTileSize
import dev.dragon.layout.units_LU_PER_PX

/**
 * A box's gradient background (BG2), as the case code writes it: the colour, the colour's clip, which border sides hide the
 * background ("always", "never", or "double": below 3 device px) and the gradient layers, top first.
 */
class DragonGradientLayers(val color: StopColor, val colorClip: String, val obscures: Array<String>, val layers: List<BackgroundLayer>, val lastIsBottom: Boolean)

/** The raster of one layout over the border box in device px, and whether every layer drew one tile of a modelled shader. */
class DragonGradientRaster(val bitmap: Bitmap?, val modelled: Boolean)

/** Device px the raster is drawn right of the border box: 0 except in the gradient-offset-1 raster plant build. */
const val DRAGON_GRADIENT_PLANT_DEVICE_PX = 0.0

/** The writer (RT-1, RT-11): the case code and runtime writes set a box's gradient layers through it. */
fun dragonSetBackgroundLayers(v: DragonBoxView, p: DragonGradientLayers) {
  v.dragonGradientLayers = p
}

/**
 * After every layout: plan the background on the unsnapped border box at the device scale and rasterise it row by row with the
 * translated paint-gradient.ts. Every pixel is opaque or clear (the compiler refuses translucent stacks), so the premultiplied
 * values are the ARGB colours setPixels takes.
 */
fun dragonAfterLayoutGradient(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val p = v.dragonGradientLayers ?: return
  val obscures = (0 until 4).map { k -> p.obscures[k] == "always" || (p.obscures[k] == "double" && shape.borders[k] < 3.0) }
  val box = BackgroundBox(shape.lu[0], shape.lu[1], shape.lu[2], shape.lu[3], jsArrayOf(*shape.borders.map { it * units_LU_PER_PX }.toTypedArray()), jsArrayOf(0.0, 0.0, 0.0, 0.0), jsArrayOf(*obscures.toTypedArray()))
  val layers = jsArrayOf<BackgroundLayer>(*p.layers.toTypedArray())
  val paint = BackgroundPaint(box, p.color, p.colorClip, layers, p.lastIsBottom, scale, paintGradient_referenceTileSize(scale))
  val faults = paintGradient_gradientFaults("none")
  val plan = paintGradient_planBackground(paint, faults)
  val left = plan.left.toInt()
  val top = plan.top.toInt()
  val w = plan.right.toInt() - left
  val h = plan.bottom.toInt() - top
  if (w <= 0 || h <= 0) {
    v.dragonGradientRaster = DragonGradientRaster(null, plan.modelled)
    return
  }
  val pixels = IntArray(w * h)
  for (y in 0 until h) {
    val row = paintGradient_backgroundRow(plan, (top + y).toDouble(), faults)
    if (row.size != w * 4) throw IllegalStateException("dragon: the gradient row of " + v.dragonId + " has " + row.size + " values, not " + (w * 4))
    for (x in 0 until w) {
      val k = x * 4
      val a = row[k + 3].toInt()
      if (a != 0 && a != 255) throw IllegalStateException("dragon: the gradient raster of " + v.dragonId + " has a translucent pixel")
      pixels[y * w + x] = (a shl 24) or (row[k].toInt() shl 16) or (row[k + 1].toInt() shl 8) or row[k + 2].toInt()
    }
  }
  val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
  bitmap.setPixels(pixels, 0, w, 0, 0, w, h)
  v.dragonGradientRaster = DragonGradientRaster(bitmap, plan.modelled)
  v.invalidate()
}

/** The background-layers stage: the raster at the box's origin, one bitmap pixel per device pixel, no filtering. */
fun dragonPaintGradientStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  val b = v.dragonGradientRaster?.bitmap ?: return
  canvas.drawBitmap(b, DRAGON_GRADIENT_PLANT_DEVICE_PX.toFloat(), 0f, null)
}

/** The readback of the gradient module: the layer count, the colour clip and whether the device drew every layer as one tile. */
fun dragonAppliedGradient(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val p = v.dragonGradientLayers ?: return listOf()
  return listOf(Pair("dragonBackgroundLayers", DumpJson.Obj(listOf(
    Pair("layers", DumpJson.Num(p.layers.size.toDouble())),
    Pair("colorClip", DumpJson.Str(p.colorClip)),
    Pair("modelled", DumpJson.Bool(v.dragonGradientRaster?.modelled ?: false)),
  ))))
}
`;

export const GRADIENT_EMITTER: PaintEmitter<'background-layers'> = {
  name: 'gradient',
  kinds: ['background-layers'],
  lines: {
    uikit: (v, _n, w) => [
      `  dragonSetBackgroundLayers(${v}, DragonGradientLayers(color: ${color(w.color)}, colorClip: ${keywordLit(w.colorClip)}, obscures: [${w.obscures.map(keywordLit).join(', ')}], layers: [`,
      ...w.layers.map((l) => `    ${layer('swift', l)},`),
      `  ], lastIsBottom: ${w.lastIsBottom}))`,
    ],
    'android-views': (v, _n, w) => [
      `  dragonSetBackgroundLayers(${v}, DragonGradientLayers(${color(w.color)}, ${keywordLit(w.colorClip)}, arrayOf(${w.obscures.map(keywordLit).join(', ')}), listOf(`,
      ...w.layers.map((l) => `    ${layer('kotlin', l)},`),
      `  ), ${w.lastIsBottom}))`,
    ],
  },
  applied: (_e, _b, w) => ({ layers: w.layers.length, colorClip: w.colorClip, modelled: true }),
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, stages: { 'background-layers': 'dragonPaintGradientStage' }, afterLayout: 'dragonAfterLayoutGradient', applied: 'dragonAppliedGradient' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, stages: { 'background-layers': 'dragonPaintGradientStage' }, afterLayout: 'dragonAfterLayoutGradient', applied: 'dragonAppliedGradient' },
  },
  plants: [
    {
      name: 'gradient-offset-1',
      replace: {
        uikit: ['public let dragonGradientPlantDevicePx: Double = 0\n', 'public let dragonGradientPlantDevicePx: Double = 1\n'],
        'android-views': ['const val DRAGON_GRADIENT_PLANT_DEVICE_PX = 0.0\n', 'const val DRAGON_GRADIENT_PLANT_DEVICE_PX = 1.0\n'],
      },
    },
  ],
};
