// Gradient background layers (BG2, notes/T074-bg2-spec.md): Dragon-owned paint on the box view. The case code writes the layers
// through the public writer; after every layout the translated paint-gradient.ts plans the background at the device scale (Blink's
// tile geometry on the unsnapped border box, the cc tiles of the box's composited layer) and rasterises the colour and every layer
// into one premultiplied device-pixel bitmap (R1, R6). The background-layers stage draws it 1:1 with no filtering (R11), clipped
// to the radius module's rounded border box; uploads never convert (CGImage premultipliedLast, copyPixelsFromBuffer).
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
  return `GradientImage(${g.radial}, ${g.repeating}, ${str(lang, g.direction)}, ${num(g.angleDeg)}, ${num(g.slope)}, ${str(lang, g.sideX)}, ${str(lang, g.sideY)}, ${g.circle}, ${str(lang, g.extent)}, ${lengthPct(lang, g.radiusX)}, ${lengthPct(lang, g.radiusY)}, ${lengthPct(lang, g.centerX)}, ${lengthPct(lang, g.centerY)}, ${arr(lang, 'CssStop', stops)})`;
}

/** A translated BackgroundLayer constructor call. */
function layer(lang: Lang, l: LoweredLayer): string {
  const g = l.geometry;
  const size = (c: { unit: string; value: number }): string => `SizeComponent(${str(lang, c.unit)}, ${num(c.value)})`;
  const geometry = `LayerGeometry(${str(lang, g.sizeKind)}, ${size(g.sizeX)}, ${size(g.sizeY)}, ${lengthPct(lang, g.positionX)}, ${lengthPct(lang, g.positionY)}, ${str(lang, g.repeatX)}, ${str(lang, g.repeatY)}, ${str(lang, g.origin)}, ${str(lang, g.clip)})`;
  return `BackgroundLayer(${geometry}, ${gradientImage(lang, l.gradient)})`;
}

/** The float32 bits of a slope, as the readback reports them. */
export function slopeBits(v: number): string {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, v);
  return view.getUint32(0).toString(16).padStart(8, '0');
}

const SWIFT_MEMBERS = String.raw`  /// The gradient layers the case code wrote (BG2) and the raster of the last layout.
  public var dragonGradientLayers: DragonGradientLayers? = nil { didSet { dragonGradientRaster = nil; setNeedsDisplay() } }
  public var dragonGradientRaster: DragonGradientRaster? = nil
`;

const SWIFT = String.raw`import UIKit

/// A box's gradient background (BG2), as the case code writes it: the colour, the colour's clip, which border sides hide the
/// background ("always", "never", or "double": below 3 device px), the gradient layers, top first, and its layer origin.
public final class DragonGradientLayers {
  public let color: StopColor
  public let colorClip: String
  public let obscures: [String]
  public let layers: [BackgroundLayer]
  public let lastIsBottom: Bool
  public let layerX: Double
  public let layerY: Double
  public init(color: StopColor, colorClip: String, obscures: [String], layers: [BackgroundLayer], lastIsBottom: Bool, layerX: Double, layerY: Double) {
    self.color = color; self.colorClip = colorClip; self.obscures = obscures; self.layers = layers; self.lastIsBottom = lastIsBottom
    self.layerX = layerX; self.layerY = layerY
  }
}

/// The raster of one layout: premultiplied sRGB over the snapped border box in device px from its left and top, and whether
/// every layer drew one tile of a modelled shader (paint-gradient.ts BackgroundPlan.modelled).
public struct DragonGradientRaster {
  public let image: CGImage?
  public let left: Int
  public let top: Int
  public let modelled: Bool
}

/// Device px the raster is drawn right of the border box: 0 except in the gradient-offset-1 raster plant build.
public let dragonGradientPlantDevicePx: Double = 0
/// The upload's alpha: premultiplied, except in the gradient-unpremultiplied-upload plant build.
public let dragonGradientPlantAlpha = CGImageAlphaInfo.premultipliedLast

/// The writer (RT-1, RT-11): the case code and runtime writes set a box's gradient layers through it.
public func dragonSetBackgroundLayers(_ v: DragonBoxView, _ p: DragonGradientLayers) {
  v.dragonGradientLayers = p
  dragonAfterLayoutGradient(v, v.dragonShape, v.dragonScale)
}

/// After every layout: plan the background on the unsnapped border box at the device scale and rasterise it row by row with
/// the translated paint-gradient.ts, into a premultiplied RGBA8 image uploaded as it is.
public func dragonAfterLayoutGradient(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let p = v.dragonGradientLayers else { return }
  if shape.lu[2] <= 0 || shape.lu[3] <= 0 { v.dragonGradientRaster = nil; return }
  do {
    let lu = units_LU_PER_PX
    let obscures = (0..<4).map { k in p.obscures[k] == "always" || (p.obscures[k] == "double" && shape.borders[k] < 3) }
    let box = BackgroundBox(shape.lu[0], shape.lu[1], shape.lu[2], shape.lu[3], JsArray(shape.borders.map { $0 * lu }), JsArray(shape.padding), JsArray(obscures))
    let paint = BackgroundPaint(box, p.color, JsString(p.colorClip), JsArray(p.layers), p.lastIsBottom, scale, try paintGradient_referenceTileSize(scale), p.layerX, p.layerY)
    let faults = try paintGradient_gradientFaults(JsString("none"))
    let plan = try paintGradient_planBackground(paint, faults)
    let left = dragonCheckedInt(plan.left, "\(v.dragonId) gradient left")
    let top = dragonCheckedInt(plan.top, "\(v.dragonId) gradient top")
    let w = dragonCheckedInt(plan.right, "\(v.dragonId) gradient right") - left
    let h = dragonCheckedInt(plan.bottom, "\(v.dragonId) gradient bottom") - top
    guard w > 0 && h > 0 else { v.dragonGradientRaster = DragonGradientRaster(image: nil, left: left, top: top, modelled: plan.modelled); return }
    var bytes = [UInt8](repeating: 0, count: w * h * 4)
    for y in 0..<h {
      let row = try paintGradient_backgroundRow(plan, Double(top + y), faults).items
      if row.count != w * 4 { fatalError("dragon: the gradient row of \(v.dragonId) has \(row.count) values, not \(w * 4)") }
      for i in 0..<row.count {
        let c = row[i]
        if !(c >= 0 && c <= 255) || c.rounded(.towardZero) != c { fatalError("dragon: gradient channel \(c) of \(v.dragonId) is not a byte") }
        bytes[y * w * 4 + i] = UInt8(c)
      }
    }
    guard let space = CGColorSpace(name: CGColorSpace.sRGB), let provider = CGDataProvider(data: Data(bytes) as CFData) else { fatalError("dragon: no sRGB space or data provider for the gradient of \(v.dragonId)") }
    guard let image = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4, space: space, bitmapInfo: CGBitmapInfo(rawValue: dragonGradientPlantAlpha.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { fatalError("dragon: the gradient raster of \(v.dragonId) is not a CGImage") }
    v.dragonGradientRaster = DragonGradientRaster(image: image, left: left, top: top, modelled: plan.modelled)
  } catch {
    fatalError("dragon: the gradient raster of \(v.dragonId) threw: \(error)")
  }
  v.setNeedsDisplay()
}

/// The background-layers stage: the raster at its device-px offset in the view, one image pixel per device pixel, clipped to the
/// rounded border box when the radius module rounds it.
public func dragonPaintGradientStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  guard let r = v.dragonGradientRaster, let image = r.image else { return }
  let s = CGFloat(v.dragonScale)
  let rect = CGRect(x: (CGFloat(Double(r.left) - shape.edges[0]) + CGFloat(dragonGradientPlantDevicePx)) / s, y: CGFloat(Double(r.top) - shape.edges[1]) / s, width: CGFloat(image.width) / s, height: CGFloat(image.height) / s)
  ctx.saveGState()
  if let path = dragonRoundedPath(v, shape, inner: false) {
    ctx.addPath(path)
    ctx.clip()
  }
  ctx.interpolationQuality = .none
  // UIKit's context is flipped; CGContext.draw puts an image's first row at the bottom of its rect.
  ctx.translateBy(x: 0, y: rect.minY + rect.height)
  ctx.scaleBy(x: 1, y: -1)
  ctx.draw(image, in: CGRect(x: rect.minX, y: 0, width: rect.width, height: rect.height))
  ctx.restoreGState()
}

/// The readback of the gradient module: the layer count, each layer's kind and linear slope bits, the layer origin, and whether the
/// device drew every layer as one tile of a modelled shader.
public func dragonAppliedGradient(_ v: DragonBoxView) -> DumpJsonObject {
  guard let p = v.dragonGradientLayers else { return [] }
  var kinds: [DumpJson] = []
  var slopes: [DumpJson] = []
  for l in p.layers {
    kinds.append(.string((l.image.repeating ? "repeating-" : "") + (l.image.radial ? "radial" : "linear")))
    slopes.append(.string(String(format: "%08x", Float(l.image.slope).bitPattern)))
  }
  return [("dragonBackgroundLayers", .object([
    ("layers", .number(Double(p.layers.count))),
    ("kinds", .array(kinds)),
    ("slopes", .array(slopes)),
    ("origin", .array([.number(p.layerX), .number(p.layerY)])),
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
import dev.dragon.layout.JsArray
import dev.dragon.layout.StopColor
import dev.dragon.layout.paintGradient_backgroundRow
import dev.dragon.layout.paintGradient_gradientFaults
import dev.dragon.layout.paintGradient_planBackground
import dev.dragon.layout.paintGradient_referenceTileSize
import dev.dragon.layout.units_LU_PER_PX
import java.nio.ByteBuffer

/**
 * A box's gradient background (BG2), as the case code writes it: the colour, the colour's clip, which border sides hide the
 * background ("always", "never", or "double": below 3 device px), the gradient layers, top first, and its layer origin.
 */
class DragonGradientLayers(val color: StopColor, val colorClip: String, val obscures: Array<String>, val layers: List<BackgroundLayer>, val lastIsBottom: Boolean, val layerX: Double, val layerY: Double)

/** The raster of one layout over the snapped border box, its device-px left and top, and whether every layer drew one tile. */
class DragonGradientRaster(val bitmap: Bitmap?, val left: Int, val top: Int, val modelled: Boolean)

/** Device px the raster is drawn right of the border box: 0 except in the gradient-offset-1 raster plant build. */
const val DRAGON_GRADIENT_PLANT_DEVICE_PX = 0.0
/** Whether the upload goes through setPixels (which reads unpremultiplied ARGB): false except in the gradient-unpremultiplied-upload plant build. */
const val DRAGON_GRADIENT_PLANT_SET_PIXELS = false

/** The writer (RT-1, RT-11): the case code and runtime writes set a box's gradient layers through it. */
fun dragonSetBackgroundLayers(v: DragonBoxView, p: DragonGradientLayers) {
  v.dragonGradientLayers = p
  dragonAfterLayoutGradient(v, v.dragonShape, v.dragonGradientScale)
}

/**
 * After every layout: plan the background on the unsnapped border box at the device scale and rasterise it row by row with the
 * translated paint-gradient.ts, into a premultiplied RGBA8 bitmap uploaded as it is (copyPixelsFromBuffer does not convert).
 */
fun dragonAfterLayoutGradient(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val p = v.dragonGradientLayers ?: return
  v.dragonGradientScale = scale
  if (shape.lu[2] <= 0.0 || shape.lu[3] <= 0.0) {
    v.dragonGradientRaster = null
    return
  }
  val obscures = (0 until 4).map { k -> p.obscures[k] == "always" || (p.obscures[k] == "double" && shape.borders[k] < 3.0) }
  val box = BackgroundBox(shape.lu[0], shape.lu[1], shape.lu[2], shape.lu[3], JsArray(shape.borders.map { it * units_LU_PER_PX }.toMutableList()), JsArray(shape.padding.toMutableList()), JsArray(obscures.toMutableList()))
  val paint = BackgroundPaint(box, p.color, p.colorClip, JsArray(p.layers.toMutableList()), p.lastIsBottom, scale, paintGradient_referenceTileSize(scale), p.layerX, p.layerY)
  val faults = paintGradient_gradientFaults("none")
  val plan = paintGradient_planBackground(paint, faults)
  val left = dragonCheckedInt(plan.left, v.dragonId + " gradient left")
  val top = dragonCheckedInt(plan.top, v.dragonId + " gradient top")
  val w = dragonCheckedInt(plan.right, v.dragonId + " gradient right") - left
  val h = dragonCheckedInt(plan.bottom, v.dragonId + " gradient bottom") - top
  if (w <= 0 || h <= 0) {
    v.dragonGradientRaster = DragonGradientRaster(null, left, top, plan.modelled)
    return
  }
  val bytes = ByteArray(w * h * 4)
  for (y in 0 until h) {
    val row = paintGradient_backgroundRow(plan, (top + y).toDouble(), faults)
    if (row.size != w * 4) throw IllegalStateException("dragon: the gradient row of " + v.dragonId + " has " + row.size + " values, not " + (w * 4))
    for (i in 0 until row.size) {
      val c = row[i]
      if (!(c >= 0.0 && c <= 255.0) || kotlin.math.truncate(c) != c) throw IllegalStateException("dragon: gradient channel " + c + " of " + v.dragonId + " is not a byte")
      bytes[y * w * 4 + i] = c.toInt().toByte()
    }
  }
  val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
  if (DRAGON_GRADIENT_PLANT_SET_PIXELS) {
    val argb = IntArray(w * h) { k -> ((bytes[k * 4 + 3].toInt() and 255) shl 24) or ((bytes[k * 4].toInt() and 255) shl 16) or ((bytes[k * 4 + 1].toInt() and 255) shl 8) or (bytes[k * 4 + 2].toInt() and 255) }
    bitmap.setPixels(argb, 0, w, 0, 0, w, h)
  } else {
    bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(bytes))
  }
  v.dragonGradientRaster = DragonGradientRaster(bitmap, left, top, plan.modelled)
  v.invalidate()
}

/** The background-layers stage: the raster at its device-px offset, one bitmap pixel per device pixel with a null Paint, clipped to the rounded box. */
fun dragonPaintGradientStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  val r = v.dragonGradientRaster ?: return
  val b = r.bitmap ?: return
  val save = canvas.save()
  val path = dragonRoundedPath(v, shape, false)
  if (path != null) canvas.clipPath(path)
  canvas.drawBitmap(b, (r.left - shape.edges[0] + DRAGON_GRADIENT_PLANT_DEVICE_PX).toFloat(), (r.top - shape.edges[1]).toFloat(), null)
  canvas.restoreToCount(save)
}

/**
 * The readback of the gradient module: the layer count, each layer's kind and linear slope bits, the layer origin, and whether the
 * device drew every layer as one tile of a modelled shader.
 */
fun dragonAppliedGradient(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val p = v.dragonGradientLayers ?: return listOf()
  val kinds = p.layers.map { l -> DumpJson.Str((if (l.image.repeating) "repeating-" else "") + (if (l.image.radial) "radial" else "linear")) }
  val slopes = p.layers.map { l -> DumpJson.Str(String.format("%08x", java.lang.Float.floatToRawIntBits(l.image.slope.toFloat()))) }
  return listOf(Pair("dragonBackgroundLayers", DumpJson.Obj(listOf(
    Pair("layers", DumpJson.Num(p.layers.size.toDouble())),
    Pair("kinds", DumpJson.Arr(kinds)),
    Pair("slopes", DumpJson.Arr(slopes)),
    Pair("origin", DumpJson.Arr(listOf(DumpJson.Num(p.layerX), DumpJson.Num(p.layerY)))),
    Pair("modelled", DumpJson.Bool(v.dragonGradientRaster?.modelled ?: false)),
  ))))
}
`;

/** The Kotlin member that keeps the device scale for runtime writes (the Android box view stores no scale of its own). */
const KOTLIN_SCALE = '  var dragonGradientScale = 1.0\n';

export const GRADIENT_EMITTER: PaintEmitter<'background-layers'> = {
  name: 'gradient',
  kinds: ['background-layers'],
  lines: {
    uikit: (v, _n, w) => [
      `  dragonSetBackgroundLayers(${v}, DragonGradientLayers(color: ${color(w.color)}, colorClip: ${keywordLit(w.colorClip)}, obscures: [${w.obscures.map(keywordLit).join(', ')}], layers: [`,
      ...w.layers.map((l) => `    ${layer('swift', l)},`),
      `  ], lastIsBottom: ${w.lastIsBottom}, layerX: ${num(w.layerOrigin[0])}, layerY: ${num(w.layerOrigin[1])}))`,
    ],
    'android-views': (v, _n, w) => [
      `  dragonSetBackgroundLayers(${v}, DragonGradientLayers(${color(w.color)}, ${keywordLit(w.colorClip)}, arrayOf(${w.obscures.map(keywordLit).join(', ')}), listOf(`,
      ...w.layers.map((l) => `    ${layer('kotlin', l)},`),
      `  ), ${w.lastIsBottom}, ${num(w.layerOrigin[0])}, ${num(w.layerOrigin[1])}))`,
    ],
  },
  applied: (_e, _b, w) => ({
    layers: w.layers.length,
    kinds: w.layers.map((l) => `${l.gradient.repeating ? 'repeating-' : ''}${l.gradient.radial ? 'radial' : 'linear'}`),
    slopes: w.layers.map((l) => slopeBits(l.gradient.slope)),
    origin: [w.layerOrigin[0], w.layerOrigin[1]],
    modelled: true,
  }),
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, stages: { 'background-layers': 'dragonPaintGradientStage' }, afterLayout: 'dragonAfterLayoutGradient', applied: 'dragonAppliedGradient' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS + KOTLIN_SCALE, file: KOTLIN, stages: { 'background-layers': 'dragonPaintGradientStage' }, afterLayout: 'dragonAfterLayoutGradient', applied: 'dragonAppliedGradient' },
  },
  plants: [
    {
      name: 'gradient-offset-1',
      replace: {
        uikit: ['public let dragonGradientPlantDevicePx: Double = 0\n', 'public let dragonGradientPlantDevicePx: Double = 1\n'],
        'android-views': ['const val DRAGON_GRADIENT_PLANT_DEVICE_PX = 0.0\n', 'const val DRAGON_GRADIENT_PLANT_DEVICE_PX = 1.0\n'],
      },
    },
    {
      name: 'gradient-unpremultiplied-upload',
      replace: {
        uikit: ['public let dragonGradientPlantAlpha = CGImageAlphaInfo.premultipliedLast\n', 'public let dragonGradientPlantAlpha = CGImageAlphaInfo.last\n'],
        'android-views': ['const val DRAGON_GRADIENT_PLANT_SET_PIXELS = false\n', 'const val DRAGON_GRADIENT_PLANT_SET_PIXELS = true\n'],
      },
    },
  ],
};
