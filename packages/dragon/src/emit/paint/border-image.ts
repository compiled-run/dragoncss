// MISC-PAINT part 1: a gradient border image, Dragon-owned paint on the box view (the border module's border-image write). The case
// code writes the image through the public writer; after every layout the translated paint-gradient.ts planBorderImage lays out
// Chrome 145's nine pieces at the device scale (NinePieceImageGrid on the unsnapped border box, every piece stretched as
// GradientGeneratedImage::Draw draws it) and backgroundRow rasterises them, over transparent, into one premultiplied device-pixel
// bitmap, as the gradient module does a background. The border stage draws it 1:1 with no filtering in place of the border styles:
// Chrome paints no border style where a border image is set (BoxPainterBase::PaintBorder returns once NinePieceImagePainter::Paint
// does). The checks admit only boxes the plan models exactly at every device scale (analysis/border-image.ts), so an unmodelled plan
// on the device is a compiler fault.
import type { JsonValue } from '../expected-dump.ts';
import type { BorderImageWrite } from '../../lower/paint/border.ts';
import type { Lang } from './gradient.ts';
import { gradientImage, num, slopeBits } from './gradient.ts';

const str = (lang: Lang, k: string): string => (lang === 'swift' ? `JsString("${k}")` : `"${k}"`);

/** The writer call of a border image write. */
export function borderImageLine(lang: Lang, v: string, w: BorderImageWrite): string {
  const slices = w.slices.map((s) => `BorderImageSlice(${str(lang, s.unit)}, ${num(s.value)})`);
  const widths = w.widths.map((s) => `BorderImageLength(${str(lang, s.unit)}, ${num(s.value)})`);
  if (lang === 'swift') return `  dragonSetBorderImage(${v}, DragonBorderImage(image: ${gradientImage(lang, w.gradient)}, slices: [${slices.join(', ')}], fill: ${w.fill}, widths: [${widths.join(', ')}], layerX: ${num(w.layerOrigin[0])}, layerY: ${num(w.layerOrigin[1])}))`;
  return `  dragonSetBorderImage(${v}, DragonBorderImage(${gradientImage(lang, w.gradient)}, listOf(${slices.join(', ')}), ${w.fill}, listOf(${widths.join(', ')}), ${num(w.layerOrigin[0])}, ${num(w.layerOrigin[1])}))`;
}

/** The host side of the readback: the gradient's slope bits, the slice and width values, fill, and that the plan is modelled. */
export function borderImageApplied(w: BorderImageWrite): JsonValue {
  return { slope: slopeBits(w.gradient.slope), slices: w.slices.map((s) => s.value), fill: w.fill, widths: w.widths.map((s) => s.value), modelled: true };
}

export const BORDER_IMAGE_SWIFT_MEMBERS = String.raw`  /// The border image the case code wrote (MISC-PAINT) and the raster of the last layout.
  public var dragonBorderImage: DragonBorderImage? = nil { didSet { dragonBorderImageRaster = nil; setNeedsDisplay() } }
  public var dragonBorderImageRaster: DragonBorderImageRaster? = nil
`;

export const BORDER_IMAGE_SWIFT = String.raw`
/// A box's gradient border image (MISC-PAINT), as the case code writes it: the gradient, the slices and widths (top, right, bottom,
/// left), fill, and the origin of the layer it rasters in.
public final class DragonBorderImage {
  public let image: GradientImage
  public let slices: [BorderImageSlice]
  public let fill: Bool
  public let widths: [BorderImageLength]
  public let layerX: Double
  public let layerY: Double
  public init(image: GradientImage, slices: [BorderImageSlice], fill: Bool, widths: [BorderImageLength], layerX: Double, layerY: Double) {
    self.image = image; self.slices = slices; self.fill = fill; self.widths = widths; self.layerX = layerX; self.layerY = layerY
  }
}

/// The raster of one layout over the snapped border image area, in strips top to bottom (each image and its top in page device px).
public struct DragonBorderImageRaster {
  public let strips: [(image: CGImage, top: Int)]
  public let left: Int
  public let modelled: Bool
}

/// Device px the border image is drawn right of its place: 0 except in the border-image-offset-1 raster plant build.
public let dragonBorderImagePlantDevicePx: Double = 0

/// The most bytes one strip of a border image raster holds.
public let dragonBorderImageStripBytes = 1 << 24

/// The writer (RT-1): the case code sets a box's border image through it.
public func dragonSetBorderImage(_ v: DragonBoxView, _ p: DragonBorderImage) {
  v.dragonBorderImage = p
  dragonAfterLayoutBorderImage(v, v.dragonShape, v.dragonScale)
}

/// After every layout: plan the nine pieces on the unsnapped border box at the device scale and rasterise them row by row with the
/// translated paint-gradient.ts, into premultiplied RGBA8 images uploaded as they are.
public func dragonAfterLayoutBorderImage(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let p = v.dragonBorderImage else { return }
  do {
    let lu = units_LU_PER_PX
    let box = BackgroundBox(shape.lu[0], shape.lu[1], shape.lu[2], shape.lu[3], JsArray(shape.borders.map { $0 * lu }), JsArray(shape.padding), JsArray([false, false, false, false]))
    let paint = BorderImagePaint(box, p.image, JsArray(p.slices), p.fill, JsArray(p.widths), scale, try paintGradient_referenceTileSize(scale), p.layerX + shape.rootX / lu, p.layerY)
    let faults = try paintGradient_gradientFaults(JsString("none"))
    let plan = try paintGradient_planBorderImage(paint, faults)
    // The checks refuse every border image the plan does not model, so one here is a compiler fault, never an empty draw.
    if !plan.modelled { fatalError("dragon: the border image plan of \(v.dragonId) is not modelled (layer origin \(paint.layerX), \(paint.layerY))") }
    let left = dragonCheckedInt(plan.left, "\(v.dragonId) border image left")
    let top = dragonCheckedInt(plan.top, "\(v.dragonId) border image top")
    let w = dragonCheckedInt(plan.right, "\(v.dragonId) border image right") - left
    let h = dragonCheckedInt(plan.bottom, "\(v.dragonId) border image bottom") - top
    guard w > 0 && h > 0 && !plan.layers.items.isEmpty else { v.dragonBorderImageRaster = DragonBorderImageRaster(strips: [], left: left, modelled: plan.modelled); v.setNeedsDisplay(); return }
    guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { fatalError("dragon: no sRGB space for the border image of \(v.dragonId)") }
    let rows = max(1, dragonBorderImageStripBytes / (w * 4))
    var strips: [(image: CGImage, top: Int)] = []
    var y0 = 0
    while y0 < h {
      let sh = min(rows, h - y0)
      var bytes = [UInt8](repeating: 0, count: w * sh * 4)
      for y in 0..<sh {
        let row = try paintGradient_backgroundRow(plan, Double(top + y0 + y), faults).items
        if row.count != w * 4 { fatalError("dragon: the border image row of \(v.dragonId) has \(row.count) values, not \(w * 4)") }
        for i in 0..<row.count {
          let c = row[i]
          if !(c >= 0 && c <= 255) || c.rounded(.towardZero) != c { fatalError("dragon: border image channel \(c) of \(v.dragonId) is not a byte") }
          bytes[y * w * 4 + i] = UInt8(c)
        }
      }
      guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { fatalError("dragon: no data provider for the border image of \(v.dragonId)") }
      guard let image = CGImage(width: w, height: sh, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4, space: space, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { fatalError("dragon: the border image raster of \(v.dragonId) is not a CGImage") }
      strips.append((image: image, top: top + y0))
      y0 += sh
    }
    v.dragonBorderImageRaster = DragonBorderImageRaster(strips: strips, left: left, modelled: plan.modelled)
  } catch {
    fatalError("dragon: the border image raster of \(v.dragonId) threw: \(error)")
  }
  v.setNeedsDisplay()
}

/// The border stage's border image: false when the box has none; otherwise its raster (none when no piece draws) at its device-px
/// offset in the view, one image pixel per device pixel, and true, so that no border style is drawn.
public func dragonPaintBorderImage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) -> Bool {
  if v.dragonBorderImage == nil { return false }
  guard let r = v.dragonBorderImageRaster else { return true }
  let s = CGFloat(v.dragonScale)
  ctx.saveGState()
  ctx.interpolationQuality = .none
  for strip in r.strips {
    let rect = CGRect(x: (CGFloat(Double(r.left) - shape.edges[0]) + CGFloat(dragonBorderImagePlantDevicePx)) / s, y: CGFloat(Double(strip.top) - shape.edges[1]) / s, width: CGFloat(strip.image.width) / s, height: CGFloat(strip.image.height) / s)
    ctx.saveGState()
    // UIKit's context is flipped; CGContext.draw puts an image's first row at the bottom of its rect.
    ctx.translateBy(x: 0, y: rect.minY + rect.height)
    ctx.scaleBy(x: 1, y: -1)
    ctx.draw(strip.image, in: CGRect(x: rect.minX, y: 0, width: rect.width, height: rect.height))
    ctx.restoreGState()
  }
  ctx.restoreGState()
  return true
}

/// The readback of the border image: the gradient's slope bits, the slice and width values, fill, and whether the plan is modelled.
public func dragonAppliedBorderImage(_ v: DragonBoxView) -> DumpJsonObject {
  guard let p = v.dragonBorderImage else { return [] }
  return [("dragonBorderImage", .object([
    ("slope", .string(String(format: "%08x", Float(p.image.slope).bitPattern))),
    ("slices", .array(p.slices.map { .number($0.value) })),
    ("fill", .bool(p.fill)),
    ("widths", .array(p.widths.map { .number($0.value) })),
    ("modelled", .bool(v.dragonBorderImageRaster?.modelled ?? false)),
  ]))]
}
`;

export const BORDER_IMAGE_KOTLIN_IMPORTS = `import android.graphics.Bitmap
import dev.dragon.layout.BackgroundBox
import dev.dragon.layout.BorderImageLength
import dev.dragon.layout.BorderImagePaint
import dev.dragon.layout.BorderImageSlice
import dev.dragon.layout.GradientImage
import dev.dragon.layout.paintGradient_backgroundRow
import dev.dragon.layout.paintGradient_gradientFaults
import dev.dragon.layout.paintGradient_planBorderImage
import dev.dragon.layout.paintGradient_referenceTileSize
import dev.dragon.layout.units_LU_PER_PX
import java.nio.ByteBuffer
`;

export const BORDER_IMAGE_KOTLIN_MEMBERS = `  /** The border image the case code wrote (MISC-PAINT), the raster of the last layout, and the device scale for runtime writes. */
  var dragonBorderImage: DragonBorderImage? = null
    set(value) { field = value; dragonBorderImageRaster = null; invalidate() }
  var dragonBorderImageRaster: DragonBorderImageRaster? = null
  var dragonBorderImageScale = 1.0
`;

export const BORDER_IMAGE_KOTLIN = String.raw`
/**
 * A box's gradient border image (MISC-PAINT), as the case code writes it: the gradient, the slices and widths (top, right, bottom,
 * left), fill, and the origin of the layer it rasters in.
 */
class DragonBorderImage(val image: GradientImage, val slices: List<BorderImageSlice>, val fill: Boolean, val widths: List<BorderImageLength>, val layerX: Double, val layerY: Double)

/** The raster of one layout over the snapped border image area, in strips top to bottom (each bitmap and its top in page device px). */
class DragonBorderImageRaster(val strips: List<Pair<Bitmap, Int>>, val left: Int, val modelled: Boolean)

/** Device px the border image is drawn right of its place: 0 except in the border-image-offset-1 raster plant build. */
const val DRAGON_BORDER_IMAGE_PLANT_DEVICE_PX = 0.0

/** The most bytes one strip of a border image raster holds. */
const val DRAGON_BORDER_IMAGE_STRIP_BYTES = 1 shl 24

/** The writer (RT-1): the case code sets a box's border image through it. */
fun dragonSetBorderImage(v: DragonBoxView, p: DragonBorderImage) {
  v.dragonBorderImage = p
  dragonAfterLayoutBorderImage(v, v.dragonShape, v.dragonBorderImageScale)
}

/**
 * After every layout: plan the nine pieces on the unsnapped border box at the device scale and rasterise them row by row with the
 * translated paint-gradient.ts, into premultiplied RGBA8 bitmaps uploaded as they are (copyPixelsFromBuffer does not convert).
 */
fun dragonAfterLayoutBorderImage(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  v.dragonBorderImageScale = scale
  val p = v.dragonBorderImage ?: return
  val box = BackgroundBox(shape.lu[0], shape.lu[1], shape.lu[2], shape.lu[3], JsArray(shape.borders.map { it * units_LU_PER_PX }.toMutableList()), JsArray(shape.padding.toMutableList()), JsArray(mutableListOf(false, false, false, false)))
  val paint = BorderImagePaint(box, p.image, JsArray(p.slices.toMutableList()), p.fill, JsArray(p.widths.toMutableList()), scale, paintGradient_referenceTileSize(scale), p.layerX + shape.rootX / units_LU_PER_PX, p.layerY)
  val faults = paintGradient_gradientFaults("none")
  val plan = paintGradient_planBorderImage(paint, faults)
  // The checks refuse every border image the plan does not model, so one here is a compiler fault, never an empty draw.
  if (!plan.modelled) throw IllegalStateException("dragon: the border image plan of " + v.dragonId + " is not modelled (layer origin " + paint.layerX + ", " + paint.layerY + ")")
  val left = dragonCheckedInt(plan.left, v.dragonId + " border image left")
  val top = dragonCheckedInt(plan.top, v.dragonId + " border image top")
  val w = dragonCheckedInt(plan.right, v.dragonId + " border image right") - left
  val h = dragonCheckedInt(plan.bottom, v.dragonId + " border image bottom") - top
  if (w <= 0 || h <= 0 || plan.layers.size == 0) {
    v.dragonBorderImageRaster = DragonBorderImageRaster(listOf(), left, plan.modelled)
    v.invalidate()
    return
  }
  val rows = maxOf(1, DRAGON_BORDER_IMAGE_STRIP_BYTES / (w * 4))
  val strips = ArrayList<Pair<Bitmap, Int>>()
  var y0 = 0
  while (y0 < h) {
    val sh = minOf(rows, h - y0)
    val bytes = ByteArray(w * sh * 4)
    for (y in 0 until sh) {
      val row = paintGradient_backgroundRow(plan, (top + y0 + y).toDouble(), faults)
      if (row.size != w * 4) throw IllegalStateException("dragon: the border image row of " + v.dragonId + " has " + row.size + " values, not " + (w * 4))
      for (i in 0 until row.size) {
        val c = row[i]
        if (!(c >= 0.0 && c <= 255.0) || kotlin.math.truncate(c) != c) throw IllegalStateException("dragon: border image channel " + c + " of " + v.dragonId + " is not a byte")
        bytes[y * w * 4 + i] = c.toInt().toByte()
      }
    }
    val bitmap = Bitmap.createBitmap(w, sh, Bitmap.Config.ARGB_8888)
    bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(bytes))
    strips.add(Pair(bitmap, top + y0))
    y0 += sh
  }
  v.dragonBorderImageRaster = DragonBorderImageRaster(strips, left, plan.modelled)
  v.invalidate()
}

/**
 * The border stage's border image: false when the box has none; otherwise its raster (none when no piece draws) at its device-px
 * offset, one bitmap pixel per device pixel with a null Paint, and true, so that no border style is drawn.
 */
fun dragonPaintBorderImage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape): Boolean {
  if (v.dragonBorderImage == null) return false
  val r = v.dragonBorderImageRaster ?: return true
  for ((b, top) in r.strips) canvas.drawBitmap(b, (r.left - shape.edges[0] + DRAGON_BORDER_IMAGE_PLANT_DEVICE_PX).toFloat(), (top - shape.edges[1]).toFloat(), null)
  return true
}

/** The readback of the border image: the gradient's slope bits, the slice and width values, fill, and whether the plan is modelled. */
fun dragonAppliedBorderImage(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val p = v.dragonBorderImage ?: return listOf()
  return listOf(Pair("dragonBorderImage", DumpJson.Obj(listOf(
    Pair("slope", DumpJson.Str(String.format("%08x", java.lang.Float.floatToRawIntBits(p.image.slope.toFloat())))),
    Pair("slices", DumpJson.Arr(p.slices.map { DumpJson.Num(it.value) })),
    Pair("fill", DumpJson.Bool(p.fill)),
    Pair("widths", DumpJson.Arr(p.widths.map { DumpJson.Num(it.value) })),
    Pair("modelled", DumpJson.Bool(v.dragonBorderImageRaster?.modelled ?: false)),
  ))))
}
`;

/** The border-image-offset-1 raster plant: every border image raster drawn 1 device px right (the gradient points catch it). */
export const BORDER_IMAGE_PLANT = {
  name: 'border-image-offset-1' as const,
  replace: {
    uikit: ['public let dragonBorderImagePlantDevicePx: Double = 0\n', 'public let dragonBorderImagePlantDevicePx: Double = 1\n'] as const,
    'android-views': ['const val DRAGON_BORDER_IMAGE_PLANT_DEVICE_PX = 0.0\n', 'const val DRAGON_BORDER_IMAGE_PLANT_DEVICE_PX = 1.0\n'] as const,
  },
};
