// Gradient background layers (BG2, notes/T074-bg2-spec.md): Dragon-owned paint on the box view. The case code writes the layers
// through the public writer; after every layout the translated paint-gradient.ts plans the background at the device scale (Blink's
// tile geometry on the unsnapped border box, the cc tiles of the box's composited layer) and rasterises the colour and every layer
// into one premultiplied device-pixel bitmap (R1, R6). The background-layers stage draws it 1:1 with no filtering (R11), clipped
// to the radius module's rounded border box; uploads never convert (CGImage premultipliedLast, copyPixelsFromBuffer).
// A gradient mask (MASK-CLIP) rasterises its one layer over transparent the same way, after every layout; on iOS the strips are
// the contents of the view layer's mask, one image pixel per device pixel, and on Android the view's draw runs in a saveLayer
// clipped to the raster, which the strips then mask with PorterDuff DST_IN. Both keep Chrome's DstIn: the masked pixel is the
// box's pixel times the raster's alpha byte / 255, composited over the backdrop (packages/parity/test/mask-gradient.test.ts).
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
  /// The gradient mask the case code wrote (MASK-CLIP) and the raster of the last layout.
  public var dragonMaskLayer: DragonMaskLayer? = nil
  public var dragonMaskRaster: DragonGradientRaster? = nil
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

/// A box's gradient mask (MASK-CLIP), as the case code writes it: its one layer (border-box, size auto, repeating) and the origin
/// of the composited layer it rasters in.
public final class DragonMaskLayer {
  public let layer: BackgroundLayer
  public let layerX: Double
  public let layerY: Double
  public init(layer: BackgroundLayer, layerX: Double, layerY: Double) {
    self.layer = layer; self.layerX = layerX; self.layerY = layerY
  }
}

/// The raster of one layout: premultiplied sRGB over the snapped border box in device px from its left and top, in strips top to
/// bottom (each image and its top in page device px), and whether every layer drew one tile of a modelled shader
/// (paint-gradient.ts BackgroundPlan.modelled).
public struct DragonGradientRaster {
  public let strips: [(image: CGImage, top: Int)]
  public let left: Int
  public let top: Int
  public let modelled: Bool
}

/// The most bytes one strip of a raster holds, so a tall box never needs one image (or one buffer) the size of its whole border box.
public let dragonGradientStripBytes = 1 << 24

/// Device px the raster is drawn right of the border box: 0 except in the gradient-offset-1 raster plant build.
public let dragonGradientPlantDevicePx: Double = 0
/// The upload's alpha: premultiplied, except in the gradient-unpremultiplied-upload plant build.
public let dragonGradientPlantAlpha = CGImageAlphaInfo.premultipliedLast

/// The writer (RT-1, RT-11): the case code and runtime writes set a box's gradient layers through it.
public func dragonSetBackgroundLayers(_ v: DragonBoxView, _ p: DragonGradientLayers) {
  v.dragonGradientLayers = p
  dragonAfterLayoutGradient(v, v.dragonShape, v.dragonScale)
}

/// Whether the mask writer ignores the write; false except in the mask-ignored plant build.
public let dragonMaskPlantIgnored = false

/// The mask writer (RT-1, RT-11): the case code sets a box's gradient mask through it.
public func dragonSetMaskLayer(_ v: DragonBoxView, _ p: DragonMaskLayer) {
  if dragonMaskPlantIgnored { return }
  v.dragonMaskLayer = p
  dragonAfterLayoutGradient(v, v.dragonShape, v.dragonScale)
}

/// After every layout: the background layers' raster and the mask's.
public func dragonAfterLayoutGradient(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  dragonAfterLayoutBackgroundLayers(v, shape, scale)
  dragonAfterLayoutMask(v, shape, scale)
}

/// The box geometry the engine plans a fill layer on: the unsnapped border box in LU, the device-px borders as LU and the paddings.
func dragonBackgroundBox(_ shape: DragonBoxShape, _ obscures: [Bool]) -> BackgroundBox {
  let lu = units_LU_PER_PX
  return BackgroundBox(shape.lu[0], shape.lu[1], shape.lu[2], shape.lu[3], JsArray(shape.borders.map { $0 * lu }), JsArray(shape.padding), JsArray(obscures))
}

/// Plan the background on the unsnapped border box at the device scale and rasterise it row by row with the translated
/// paint-gradient.ts, into a premultiplied RGBA8 image uploaded as it is.
public func dragonAfterLayoutBackgroundLayers(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let p = v.dragonGradientLayers else { return }
  if shape.lu[2] <= 0 || shape.lu[3] <= 0 { v.dragonGradientRaster = nil; return }
  do {
    let obscures = (0..<4).map { k in p.obscures[k] == "always" || (p.obscures[k] == "double" && shape.borders[k] < 3) }
    let paint = BackgroundPaint(dragonBackgroundBox(shape, obscures), p.color, JsString(p.colorClip), JsArray(p.layers), p.lastIsBottom, scale, try paintGradient_referenceTileSize(scale), p.layerX + shape.rootX / units_LU_PER_PX, p.layerY)
    v.dragonGradientRaster = try dragonRasterBackground(v, paint)
  } catch {
    fatalError("dragon: the gradient raster of \(v.dragonId) threw: \(error)")
  }
  v.setNeedsDisplay()
}

/// Rasterise the mask's layer over transparent, as the background layers, and make its strips the contents of the view layer's
/// mask at their device-px offsets (nearest filtering): the box view and every view inside it keep the raster's alpha, and
/// nothing outside the raster shows. A box with no area masks everything.
public func dragonAfterLayoutMask(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let p = v.dragonMaskLayer else { return }
  var raster: DragonGradientRaster? = nil
  if shape.lu[2] > 0 && shape.lu[3] > 0 {
    do {
      let paint = BackgroundPaint(dragonBackgroundBox(shape, [false, false, false, false]), StopColor(0.0, 0.0, 0.0, 0.0), JsString("border-box"), JsArray([p.layer]), true, scale, try paintGradient_referenceTileSize(scale), p.layerX + shape.rootX / units_LU_PER_PX, p.layerY)
      raster = try dragonRasterBackground(v, paint)
    } catch {
      fatalError("dragon: the mask raster of \(v.dragonId) threw: \(error)")
    }
  }
  v.dragonMaskRaster = raster
  let s = CGFloat(scale)
  CATransaction.begin()
  CATransaction.setDisableActions(true)
  let m = CALayer()
  m.frame = v.bounds
  if let r = raster {
    for strip in r.strips {
      let l = CALayer()
      l.contents = strip.image
      l.contentsScale = s
      l.magnificationFilter = .nearest
      l.minificationFilter = .nearest
      l.frame = CGRect(x: CGFloat(Double(r.left) - shape.edges[0]) / s, y: CGFloat(Double(strip.top) - shape.edges[1]) / s, width: CGFloat(strip.image.width) / s, height: CGFloat(strip.image.height) / s)
      m.addSublayer(l)
    }
  }
  v.layer.mask = m
  CATransaction.commit()
}

/// One fill-layer raster: the plan of a paint, rasterised row by row into premultiplied RGBA8 strips uploaded as they are.
func dragonRasterBackground(_ v: DragonBoxView, _ paint: BackgroundPaint) throws -> DragonGradientRaster {
  do {
    let faults = try paintGradient_gradientFaults(JsString("none"))
    let plan = try paintGradient_planBackground(paint, faults)
    // The checks refuse every background the plan does not model, so one here is a compiler fault, never an empty draw.
    if !plan.modelled { fatalError("dragon: the background plan of \(v.dragonId) is not modelled (layer origin \(paint.layerX), \(paint.layerY))") }
    let left = dragonCheckedInt(plan.left, "\(v.dragonId) gradient left")
    let top = dragonCheckedInt(plan.top, "\(v.dragonId) gradient top")
    let w = dragonCheckedInt(plan.right, "\(v.dragonId) gradient right") - left
    let h = dragonCheckedInt(plan.bottom, "\(v.dragonId) gradient bottom") - top
    guard w > 0 && h > 0 else { return DragonGradientRaster(strips: [], left: left, top: top, modelled: plan.modelled) }
    guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { fatalError("dragon: no sRGB space for the gradient of \(v.dragonId)") }
    let rows = max(1, dragonGradientStripBytes / (w * 4))
    var strips: [(image: CGImage, top: Int)] = []
    var y0 = 0
    while y0 < h {
      let sh = min(rows, h - y0)
      var bytes = [UInt8](repeating: 0, count: w * sh * 4)
      for y in 0..<sh {
        let row = try paintGradient_backgroundRow(plan, Double(top + y0 + y), faults).items
        if row.count != w * 4 { fatalError("dragon: the gradient row of \(v.dragonId) has \(row.count) values, not \(w * 4)") }
        for i in 0..<row.count {
          let c = row[i]
          if !(c >= 0 && c <= 255) || c.rounded(.towardZero) != c { fatalError("dragon: gradient channel \(c) of \(v.dragonId) is not a byte") }
          bytes[y * w * 4 + i] = UInt8(c)
        }
      }
      guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { fatalError("dragon: no data provider for the gradient of \(v.dragonId)") }
      guard let image = CGImage(width: w, height: sh, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4, space: space, bitmapInfo: CGBitmapInfo(rawValue: dragonGradientPlantAlpha.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { fatalError("dragon: the gradient raster of \(v.dragonId) is not a CGImage") }
      strips.append((image: image, top: top + y0))
      y0 += sh
    }
    return DragonGradientRaster(strips: strips, left: left, top: top, modelled: plan.modelled)
  }
}

/// The background-layers stage: the raster at its device-px offset in the view, one image pixel per device pixel, clipped to the
/// rounded border box when the radius module rounds it.
public func dragonPaintGradientStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  guard let r = v.dragonGradientRaster, !r.strips.isEmpty else { return }
  let s = CGFloat(v.dragonScale)
  ctx.saveGState()
  if let path = dragonRoundedPath(v, shape, inner: false) {
    ctx.addPath(path)
    ctx.clip()
  }
  ctx.interpolationQuality = .none
  for strip in r.strips {
    let rect = CGRect(x: (CGFloat(Double(r.left) - shape.edges[0]) + CGFloat(dragonGradientPlantDevicePx)) / s, y: CGFloat(Double(strip.top) - shape.edges[1]) / s, width: CGFloat(strip.image.width) / s, height: CGFloat(strip.image.height) / s)
    ctx.saveGState()
    // UIKit's context is flipped; CGContext.draw puts an image's first row at the bottom of its rect.
    ctx.translateBy(x: 0, y: rect.minY + rect.height)
    ctx.scaleBy(x: 1, y: -1)
    ctx.draw(strip.image, in: CGRect(x: rect.minX, y: 0, width: rect.width, height: rect.height))
    ctx.restoreGState()
  }
  ctx.restoreGState()
}

/// The readback of the gradient module: the layer count, each layer's kind and linear slope bits, the layer origin, and whether the
/// device drew every layer as one tile of a modelled shader; for a mask, its layer's kind and slope bits, its layer origin, whether
/// its raster is modelled, and whether the view layer has a mask.
public func dragonAppliedGradient(_ v: DragonBoxView) -> DumpJsonObject {
  var out: DumpJsonObject = []
  let kind = { (l: BackgroundLayer) -> DumpJson in .string((l.image.repeating ? "repeating-" : "") + (l.image.radial ? "radial" : "linear")) }
  let slope = { (l: BackgroundLayer) -> DumpJson in .string(String(format: "%08x", Float(l.image.slope).bitPattern)) }
  if let p = v.dragonGradientLayers {
    out.append(("dragonBackgroundLayers", .object([
      ("layers", .number(Double(p.layers.count))),
      ("kinds", .array(p.layers.map(kind))),
      ("slopes", .array(p.layers.map(slope))),
      ("origin", .array([.number(p.layerX), .number(p.layerY)])),
      ("modelled", .bool(v.dragonGradientRaster?.modelled ?? false)),
    ])))
  }
  if let m = v.dragonMaskLayer {
    out.append(("dragonMaskLayer", .object([
      ("kind", kind(m.layer)),
      ("slope", slope(m.layer)),
      ("origin", .array([.number(m.layerX), .number(m.layerY)])),
      ("modelled", .bool(v.dragonMaskRaster?.modelled ?? false)),
      ("masked", .bool(v.layer.mask != nil)),
    ])))
  }
  return out
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The gradient layers the case code wrote (BG2) and the raster of the last layout. */
  var dragonGradientLayers: DragonGradientLayers? = null
    set(value) { field = value; dragonGradientRaster = null; invalidate() }
  var dragonGradientRaster: DragonGradientRaster? = null
  /** The gradient mask the case code wrote (MASK-CLIP) and the raster of the last layout. */
  var dragonMaskLayer: DragonMaskLayer? = null
    set(value) { field = value; dragonMaskRaster = null; invalidate() }
  var dragonMaskRaster: DragonGradientRaster? = null
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
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

/** A box's gradient mask (MASK-CLIP), as the case code writes it: its one layer (border-box, size auto, repeating) and its layer origin. */
class DragonMaskLayer(val layer: BackgroundLayer, val layerX: Double, val layerY: Double)

/**
 * The raster of one layout over the snapped border box, in strips top to bottom (each bitmap and its top in page device px), its
 * device-px left and top, and whether every layer drew one tile.
 */
class DragonGradientRaster(val strips: List<Pair<Bitmap, Int>>, val left: Int, val top: Int, val modelled: Boolean)

/** The most bytes one strip of a raster holds, so a tall box never needs one bitmap (or one buffer) the size of its whole border box. */
const val DRAGON_GRADIENT_STRIP_BYTES = 1 shl 24

/** Device px the raster is drawn right of the border box: 0 except in the gradient-offset-1 raster plant build. */
const val DRAGON_GRADIENT_PLANT_DEVICE_PX = 0.0
/** Whether the upload goes through setPixels (which reads unpremultiplied ARGB): false except in the gradient-unpremultiplied-upload plant build. */
const val DRAGON_GRADIENT_PLANT_SET_PIXELS = false

/** The writer (RT-1, RT-11): the case code and runtime writes set a box's gradient layers through it. */
fun dragonSetBackgroundLayers(v: DragonBoxView, p: DragonGradientLayers) {
  v.dragonGradientLayers = p
  dragonAfterLayoutGradient(v, v.dragonShape, v.dragonGradientScale)
}

/** Whether the mask writer ignores the write; false except in the mask-ignored plant build. */
const val DRAGON_MASK_PLANT_IGNORED = false

/** The mask writer (RT-1, RT-11): the case code sets a box's gradient mask through it. */
fun dragonSetMaskLayer(v: DragonBoxView, p: DragonMaskLayer) {
  if (DRAGON_MASK_PLANT_IGNORED) return
  v.dragonMaskLayer = p
  dragonAfterLayoutGradient(v, v.dragonShape, v.dragonGradientScale)
}

/** After every layout: the background layers' raster and the mask's. */
fun dragonAfterLayoutGradient(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  v.dragonGradientScale = scale
  dragonAfterLayoutBackgroundLayers(v, shape, scale)
  dragonAfterLayoutMask(v, shape, scale)
}

/** The box geometry the engine plans a fill layer on: the unsnapped border box in LU, the device-px borders as LU and the paddings. */
fun dragonBackgroundBox(shape: DragonBoxShape, obscures: List<Boolean>): BackgroundBox =
  BackgroundBox(shape.lu[0], shape.lu[1], shape.lu[2], shape.lu[3], JsArray(shape.borders.map { it * units_LU_PER_PX }.toMutableList()), JsArray(shape.padding.toMutableList()), JsArray(obscures.toMutableList()))

/**
 * Plan the background on the unsnapped border box at the device scale and rasterise it row by row with the translated
 * paint-gradient.ts, into a premultiplied RGBA8 bitmap uploaded as it is (copyPixelsFromBuffer does not convert).
 */
fun dragonAfterLayoutBackgroundLayers(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val p = v.dragonGradientLayers ?: return
  if (shape.lu[2] <= 0.0 || shape.lu[3] <= 0.0) {
    v.dragonGradientRaster = null
    return
  }
  val obscures = (0 until 4).map { k -> p.obscures[k] == "always" || (p.obscures[k] == "double" && shape.borders[k] < 3.0) }
  val paint = BackgroundPaint(dragonBackgroundBox(shape, obscures), p.color, p.colorClip, JsArray(p.layers.toMutableList()), p.lastIsBottom, scale, paintGradient_referenceTileSize(scale), p.layerX + shape.rootX / units_LU_PER_PX, p.layerY)
  v.dragonGradientRaster = dragonRasterBackground(v, paint)
  v.invalidate()
}

/** Rasterise the mask's layer over transparent, as the background layers; the view's draw masks itself with it (dragonDrawMasked). */
fun dragonAfterLayoutMask(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val p = v.dragonMaskLayer ?: return
  v.dragonMaskRaster = if (shape.lu[2] <= 0.0 || shape.lu[3] <= 0.0) null else {
    val paint = BackgroundPaint(dragonBackgroundBox(shape, listOf(false, false, false, false)), StopColor(0.0, 0.0, 0.0, 0.0), "border-box", JsArray(mutableListOf(p.layer)), true, scale, paintGradient_referenceTileSize(scale), p.layerX + shape.rootX / units_LU_PER_PX, p.layerY)
    dragonRasterBackground(v, paint)
  }
  v.invalidate()
}

/** The DST_IN paint the mask strips are drawn with: the layer under them keeps its pixels times the strip's alpha. */
private val DRAGON_MASK_PAINT = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN) }

/**
 * A masked view's draw (the clip module's draw override calls it): the view's own draw into a saveLayer clipped to the mask's
 * raster, then the raster's strips over it 1:1 with DST_IN, so the box and every view inside it keep the raster's alpha and nothing
 * outside the raster shows. Before the first layout, and for a box with no area, nothing is drawn.
 */
fun dragonDrawMasked(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape, draw: () -> Unit) {
  val r = v.dragonMaskRaster ?: return
  if (r.strips.isEmpty()) return
  val left = (r.left - shape.edges[0]).toFloat()
  val top = (r.top - shape.edges[1]).toFloat()
  val right = left + r.strips[0].first.width
  val bottom = top + r.strips.sumOf { it.first.height }
  val n = canvas.save()
  canvas.clipRect(left, top, right, bottom)
  canvas.saveLayer(left, top, right, bottom, null)
  draw()
  for ((b, y) in r.strips) canvas.drawBitmap(b, left, (y - shape.edges[1]).toFloat(), DRAGON_MASK_PAINT)
  canvas.restoreToCount(n)
}

/** One fill-layer raster: the plan of a paint, rasterised row by row into premultiplied RGBA8 strips uploaded as they are. */
fun dragonRasterBackground(v: DragonBoxView, paint: BackgroundPaint): DragonGradientRaster {
  val faults = paintGradient_gradientFaults("none")
  val plan = paintGradient_planBackground(paint, faults)
  // The checks refuse every background the plan does not model, so one here is a compiler fault, never an empty draw.
  if (!plan.modelled) throw IllegalStateException("dragon: the background plan of " + v.dragonId + " is not modelled (layer origin " + paint.layerX + ", " + paint.layerY + ")")
  val left = dragonCheckedInt(plan.left, v.dragonId + " gradient left")
  val top = dragonCheckedInt(plan.top, v.dragonId + " gradient top")
  val w = dragonCheckedInt(plan.right, v.dragonId + " gradient right") - left
  val h = dragonCheckedInt(plan.bottom, v.dragonId + " gradient bottom") - top
  if (w <= 0 || h <= 0) return DragonGradientRaster(listOf(), left, top, plan.modelled)
  val rows = maxOf(1, DRAGON_GRADIENT_STRIP_BYTES / (w * 4))
  val strips = ArrayList<Pair<Bitmap, Int>>()
  var y0 = 0
  while (y0 < h) {
    val sh = minOf(rows, h - y0)
    val bytes = ByteArray(w * sh * 4)
    for (y in 0 until sh) {
      val row = paintGradient_backgroundRow(plan, (top + y0 + y).toDouble(), faults)
      if (row.size != w * 4) throw IllegalStateException("dragon: the gradient row of " + v.dragonId + " has " + row.size + " values, not " + (w * 4))
      for (i in 0 until row.size) {
        val c = row[i]
        if (!(c >= 0.0 && c <= 255.0) || kotlin.math.truncate(c) != c) throw IllegalStateException("dragon: gradient channel " + c + " of " + v.dragonId + " is not a byte")
        bytes[y * w * 4 + i] = c.toInt().toByte()
      }
    }
    val bitmap = Bitmap.createBitmap(w, sh, Bitmap.Config.ARGB_8888)
    if (DRAGON_GRADIENT_PLANT_SET_PIXELS) {
      val argb = IntArray(w * sh) { k -> ((bytes[k * 4 + 3].toInt() and 255) shl 24) or ((bytes[k * 4].toInt() and 255) shl 16) or ((bytes[k * 4 + 1].toInt() and 255) shl 8) or (bytes[k * 4 + 2].toInt() and 255) }
      bitmap.setPixels(argb, 0, w, 0, 0, w, sh)
    } else {
      bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(bytes))
    }
    strips.add(Pair(bitmap, top + y0))
    y0 += sh
  }
  return DragonGradientRaster(strips, left, top, plan.modelled)
}

/** The background-layers stage: the raster at its device-px offset, one bitmap pixel per device pixel with a null Paint, clipped to the rounded box. */
fun dragonPaintGradientStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  val r = v.dragonGradientRaster ?: return
  if (r.strips.isEmpty()) return
  val save = canvas.save()
  val path = dragonRoundedPath(v, shape, false)
  if (path != null) canvas.clipPath(path)
  for ((b, top) in r.strips) canvas.drawBitmap(b, (r.left - shape.edges[0] + DRAGON_GRADIENT_PLANT_DEVICE_PX).toFloat(), (top - shape.edges[1]).toFloat(), null)
  canvas.restoreToCount(save)
}

/**
 * The readback of the gradient module: the layer count, each layer's kind and linear slope bits, the layer origin, and whether the
 * device drew every layer as one tile of a modelled shader; for a mask, its layer's kind and slope bits, its layer origin, whether
 * its raster is modelled, and whether the draw has a raster to mask with.
 */
fun dragonAppliedGradient(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val out = ArrayList<Pair<String, DumpJson>>()
  fun kind(l: BackgroundLayer): DumpJson = DumpJson.Str((if (l.image.repeating) "repeating-" else "") + (if (l.image.radial) "radial" else "linear"))
  fun slope(l: BackgroundLayer): DumpJson = DumpJson.Str(String.format("%08x", java.lang.Float.floatToRawIntBits(l.image.slope.toFloat())))
  val p = v.dragonGradientLayers
  if (p != null) {
    out.add(Pair("dragonBackgroundLayers", DumpJson.Obj(listOf(
      Pair("layers", DumpJson.Num(p.layers.size.toDouble())),
      Pair("kinds", DumpJson.Arr(p.layers.map { kind(it) })),
      Pair("slopes", DumpJson.Arr(p.layers.map { slope(it) })),
      Pair("origin", DumpJson.Arr(listOf(DumpJson.Num(p.layerX), DumpJson.Num(p.layerY)))),
      Pair("modelled", DumpJson.Bool(v.dragonGradientRaster?.modelled ?: false)),
    ))))
  }
  val m = v.dragonMaskLayer
  if (m != null) {
    out.add(Pair("dragonMaskLayer", DumpJson.Obj(listOf(
      Pair("kind", kind(m.layer)),
      Pair("slope", slope(m.layer)),
      Pair("origin", DumpJson.Arr(listOf(DumpJson.Num(m.layerX), DumpJson.Num(m.layerY)))),
      Pair("modelled", DumpJson.Bool(v.dragonMaskRaster?.modelled ?: false)),
      Pair("masked", DumpJson.Bool(v.dragonMaskRaster != null)),
    ))))
  }
  return out
}
`;

/** The Kotlin member that keeps the device scale for runtime writes (the Android box view stores no scale of its own). */
const KOTLIN_SCALE = '  var dragonGradientScale = 1.0\n';

export const GRADIENT_EMITTER: PaintEmitter<'background-layers' | 'mask-layer', 'gradient-offset-1' | 'gradient-unpremultiplied-upload' | 'mask-ignored'> = {
  name: 'gradient',
  kinds: ['background-layers', 'mask-layer'],
  lines: {
    uikit: (v, _n, w) => w.kind === 'mask-layer' ? [`  dragonSetMaskLayer(${v}, DragonMaskLayer(layer: ${layer('swift', w.layer)}, layerX: ${num(w.layerOrigin[0])}, layerY: ${num(w.layerOrigin[1])}))`] : [
      `  dragonSetBackgroundLayers(${v}, DragonGradientLayers(color: ${color(w.color)}, colorClip: ${keywordLit(w.colorClip)}, obscures: [${w.obscures.map(keywordLit).join(', ')}], layers: [`,
      ...w.layers.map((l) => `    ${layer('swift', l)},`),
      `  ], lastIsBottom: ${w.lastIsBottom}, layerX: ${num(w.layerOrigin[0])}, layerY: ${num(w.layerOrigin[1])}))`,
    ],
    'android-views': (v, _n, w) => w.kind === 'mask-layer' ? [`  dragonSetMaskLayer(${v}, DragonMaskLayer(${layer('kotlin', w.layer)}, ${num(w.layerOrigin[0])}, ${num(w.layerOrigin[1])}))`] : [
      `  dragonSetBackgroundLayers(${v}, DragonGradientLayers(${color(w.color)}, ${keywordLit(w.colorClip)}, arrayOf(${w.obscures.map(keywordLit).join(', ')}), listOf(`,
      ...w.layers.map((l) => `    ${layer('kotlin', l)},`),
      `  ), ${w.lastIsBottom}, ${num(w.layerOrigin[0])}, ${num(w.layerOrigin[1])}))`,
    ],
  },
  applied: (_e, _b, w) => w.kind === 'mask-layer' ? {
    kind: `${w.layer.gradient.repeating ? 'repeating-' : ''}${w.layer.gradient.radial ? 'radial' : 'linear'}`,
    slope: slopeBits(w.layer.gradient.slope),
    origin: [w.layerOrigin[0], w.layerOrigin[1]],
    modelled: true,
    masked: true,
  } : ({
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
    {
      name: 'mask-ignored',
      replace: {
        uikit: ['public let dragonMaskPlantIgnored = false\n', 'public let dragonMaskPlantIgnored = true\n'],
        'android-views': ['const val DRAGON_MASK_PLANT_IGNORED = false\n', 'const val DRAGON_MASK_PLANT_IGNORED = true\n'],
      },
    },
  ],
};
