// MASK-CLIP (css-masking-1 §7): a linear-gradient() mask on the box view. The case code writes the gradient through the public
// writer; after every layout the translated paint-gradient.ts plans it as one background layer over the unsnapped border box (size
// auto, position 0% 0%, repeat, origin and clip border-box, over a transparent colour and with no border hiding it) at the device
// scale and rasterises it into premultiplied device-pixel strips, as BG2 rasterises a background (emit/paint/gradient.ts). UIKit
// shows the strips as the contents of sublayers of the box view's layer.mask (nearest filtering, one image pixel per device pixel),
// which masks the box view and every view inside it by alpha and clips them to the border box, as Chrome's border-box mask painting
// area does. Android draws the strips with a DST_IN Paint from an overlay drawable of the box view, in the view's hardware layer,
// which holds the box view's own paint and its children's and clips them to its bounds. Neither touches a view's visibility, alpha
// or accessibility, so the text inside stays exposed to VoiceOver and TalkBack, as Chrome keeps it.
import type { MaskWrite } from '../../lower/paint/mask.ts';
import type { Lang } from './gradient.ts';
import { gradientImage, num, slopeBits } from './gradient.ts';
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// The mask the case code wrote (MASK-CLIP), the layer the box view is masked with, and whether the last plan was modelled.
  public var dragonMaskImage: DragonMaskImage? = nil
  public let dragonMaskLayer = CALayer()
  public var dragonMaskModelled = false
`;

const SWIFT = String.raw`import UIKit

/// A box's mask (MASK-CLIP), as the case code writes it: one linear gradient over the border box, and its layer origin.
public final class DragonMaskImage {
  public let image: GradientImage
  public let layerX: Double
  public let layerY: Double
  public init(image: GradientImage, layerX: Double, layerY: Double) {
    self.image = image; self.layerX = layerX; self.layerY = layerY
  }
}

/// Whether the raster's rows are drawn bottom to top: false except in the mask-gradient-flip raster plant build.
public let dragonMaskPlantFlip = false

/// The writer (RT-1, RT-11): the case code and runtime writes set a box's mask through it.
public func dragonSetMaskImage(_ v: DragonBoxView, _ m: DragonMaskImage) {
  v.dragonMaskImage = m
  dragonAfterLayoutMask(v, v.dragonShape, v.dragonScale)
}

/// The mask's one layer: one tile of the gradient over the border box, as the initial mask longhands place it.
public func dragonMaskGeometry() -> LayerGeometry {
  return LayerGeometry(JsString("length"), SizeComponent(JsString("auto"), 0.0), SizeComponent(JsString("auto"), 0.0), LengthPct(JsString("percent"), 0.0), LengthPct(JsString("percent"), 0.0), JsString("repeat"), JsString("repeat"), JsString("border-box"), JsString("border-box"))
}

/// After every layout: plan the mask on the unsnapped border box at the device scale, rasterise it row by row with the translated
/// paint-gradient.ts, and make the strips the contents of the box view's mask layer, which covers the snapped border box.
public func dragonAfterLayoutMask(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let m = v.dragonMaskImage else { return }
  let s = CGFloat(scale)
  let e = shape.edges
  CATransaction.begin()
  CATransaction.setDisableActions(true)
  defer { CATransaction.commit() }
  let mask = v.dragonMaskLayer
  mask.frame = CGRect(x: 0, y: 0, width: CGFloat(e[2] - e[0]) / s, height: CGFloat(e[3] - e[1]) / s)
  mask.sublayers = nil
  v.layer.mask = mask
  v.dragonMaskModelled = true
  if shape.lu[2] <= 0 || shape.lu[3] <= 0 { return }
  do {
    let lu = units_LU_PER_PX
    let box = BackgroundBox(shape.lu[0], shape.lu[1], shape.lu[2], shape.lu[3], JsArray(shape.borders.map { $0 * lu }), JsArray(shape.padding), JsArray([false, false, false, false]))
    let paint = BackgroundPaint(box, StopColor(0.0, 0.0, 0.0, 0.0), JsString("border-box"), JsArray([BackgroundLayer(dragonMaskGeometry(), m.image)]), true, scale, try paintGradient_referenceTileSize(scale), m.layerX + shape.rootX / lu, m.layerY)
    let faults = try paintGradient_gradientFaults(JsString("none"))
    let plan = try paintGradient_planBackground(paint, faults)
    // The checks refuse every mask the plan does not model, so one here is a compiler fault, never an empty mask.
    if !plan.modelled { fatalError("dragon: the mask plan of \(v.dragonId) is not modelled (layer origin \(paint.layerX), \(paint.layerY))") }
    let left = dragonCheckedInt(plan.left, "\(v.dragonId) mask left")
    let top = dragonCheckedInt(plan.top, "\(v.dragonId) mask top")
    let w = dragonCheckedInt(plan.right, "\(v.dragonId) mask right") - left
    let h = dragonCheckedInt(plan.bottom, "\(v.dragonId) mask bottom") - top
    guard w > 0 && h > 0 else { return }
    guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { fatalError("dragon: no sRGB space for the mask of \(v.dragonId)") }
    let rows = max(1, dragonGradientStripBytes / (w * 4))
    var y0 = 0
    while y0 < h {
      let sh = min(rows, h - y0)
      var bytes = [UInt8](repeating: 0, count: w * sh * 4)
      for y in 0..<sh {
        let source = dragonMaskPlantFlip ? top + h - 1 - (y0 + y) : top + y0 + y
        let row = try paintGradient_backgroundRow(plan, Double(source), faults).items
        if row.count != w * 4 { fatalError("dragon: the mask row of \(v.dragonId) has \(row.count) values, not \(w * 4)") }
        for i in 0..<row.count {
          let c = row[i]
          if !(c >= 0 && c <= 255) || c.rounded(.towardZero) != c { fatalError("dragon: mask channel \(c) of \(v.dragonId) is not a byte") }
          bytes[y * w * 4 + i] = UInt8(c)
        }
      }
      guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { fatalError("dragon: no data provider for the mask of \(v.dragonId)") }
      guard let image = CGImage(width: w, height: sh, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4, space: space, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { fatalError("dragon: the mask raster of \(v.dragonId) is not a CGImage") }
      let strip = CALayer()
      strip.contents = image
      strip.contentsScale = s
      strip.magnificationFilter = .nearest
      strip.minificationFilter = .nearest
      strip.frame = CGRect(x: CGFloat(Double(left) - e[0]) / s, y: CGFloat(Double(top + y0) - e[1]) / s, width: CGFloat(w) / s, height: CGFloat(sh) / s)
      mask.addSublayer(strip)
      y0 += sh
    }
  } catch {
    fatalError("dragon: the mask raster of \(v.dragonId) threw: \(error)")
  }
}

/// The readback of the mask module: the gradient's kind and linear slope bits, the layer origin, whether the plan was modelled, and
/// whether the box view is masked by its mask layer.
public func dragonAppliedMask(_ v: DragonBoxView) -> DumpJsonObject {
  guard let m = v.dragonMaskImage else { return [] }
  return [("dragonMaskImage", .object([
    ("kind", .string((m.image.repeating ? "repeating-" : "") + (m.image.radial ? "radial" : "linear"))),
    ("slope", .string(String(format: "%08x", Float(m.image.slope).bitPattern))),
    ("origin", .array([.number(m.layerX), .number(m.layerY)])),
    ("modelled", .bool(v.dragonMaskModelled)),
    ("masked", .bool(v.layer.mask === v.dragonMaskLayer)),
  ]))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The mask the case code wrote (MASK-CLIP), the overlay drawable that applies it, and the device scale of the last layout. */
  var dragonMaskImage: DragonMaskImage? = null
  var dragonMaskDrawable: DragonMaskDrawable? = null
  var dragonMaskScale = 1.0
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.drawable.Drawable
import android.view.View
import dev.dragon.dump.DumpJson
import dev.dragon.layout.BackgroundBox
import dev.dragon.layout.BackgroundLayer
import dev.dragon.layout.BackgroundPaint
import dev.dragon.layout.GradientImage
import dev.dragon.layout.JsArray
import dev.dragon.layout.LayerGeometry
import dev.dragon.layout.LengthPct
import dev.dragon.layout.SizeComponent
import dev.dragon.layout.StopColor
import dev.dragon.layout.paintGradient_backgroundRow
import dev.dragon.layout.paintGradient_gradientFaults
import dev.dragon.layout.paintGradient_planBackground
import dev.dragon.layout.paintGradient_referenceTileSize
import dev.dragon.layout.units_LU_PER_PX
import java.nio.ByteBuffer

/** A box's mask (MASK-CLIP), as the case code writes it: one linear gradient over the border box, and its layer origin. */
class DragonMaskImage(val image: GradientImage, val layerX: Double, val layerY: Double)

/**
 * The mask raster of one layout, in strips top to bottom (each bitmap and its top in page device px), drawn dx device px right of
 * the box view's left and dy above each strip's top with a DST_IN Paint: the box view's hardware layer keeps its paint by the mask's alpha.
 */
class DragonMaskDrawable(val strips: List<Pair<Bitmap, Int>>, private val dx: Float, private val dy: Int) : Drawable() {
  private val paint = Paint().apply {
    xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
    isFilterBitmap = false
  }
  private val clear = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR) }
  override fun draw(canvas: Canvas) {
    // Outside the strips (an empty box, or a raster narrower than the bounds) nothing is masked in: clear it first.
    val n = canvas.save()
    for ((b, top) in strips) canvas.clipOutRect(dx, (top - dy).toFloat(), dx + b.width, (top - dy + b.height).toFloat())
    canvas.drawRect(bounds, clear)
    canvas.restoreToCount(n)
    for ((b, top) in strips) canvas.drawBitmap(b, dx, (top - dy).toFloat(), paint)
  }
  override fun setAlpha(alpha: Int) {}
  override fun setColorFilter(colorFilter: ColorFilter?) {}
  @Deprecated("Drawable.getOpacity is deprecated in the platform")
  override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}

/** Whether the raster's rows are drawn bottom to top: false except in the mask-gradient-flip raster plant build. */
const val DRAGON_MASK_PLANT_FLIP = false

/** The writer (RT-1, RT-11): the case code and runtime writes set a box's mask through it. */
fun dragonSetMaskImage(v: DragonBoxView, m: DragonMaskImage) {
  v.dragonMaskImage = m
  dragonAfterLayoutMask(v, v.dragonShape, v.dragonMaskScale)
}

/** The mask's one layer: one tile of the gradient over the border box, as the initial mask longhands place it. */
fun dragonMaskGeometry(): LayerGeometry = LayerGeometry("length", SizeComponent("auto", 0.0), SizeComponent("auto", 0.0), LengthPct("percent", 0.0), LengthPct("percent", 0.0), "repeat", "repeat", "border-box", "border-box")

/**
 * After every layout: plan the mask on the unsnapped border box at the device scale, rasterise it row by row with the translated
 * paint-gradient.ts into premultiplied bitmaps uploaded as they are (copyPixelsFromBuffer does not convert), and draw them from the
 * box view's overlay in its hardware layer.
 */
fun dragonAfterLayoutMask(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val m = v.dragonMaskImage ?: return
  v.dragonMaskScale = scale
  val e = shape.edges
  val strips = ArrayList<Pair<Bitmap, Int>>()
  var left = e[0].toInt()
  if (shape.lu[2] > 0.0 && shape.lu[3] > 0.0) {
    val box = BackgroundBox(shape.lu[0], shape.lu[1], shape.lu[2], shape.lu[3], JsArray(shape.borders.map { it * units_LU_PER_PX }.toMutableList()), JsArray(shape.padding.toMutableList()), JsArray(mutableListOf(false, false, false, false)))
    val paint = BackgroundPaint(box, StopColor(0.0, 0.0, 0.0, 0.0), "border-box", JsArray(mutableListOf(BackgroundLayer(dragonMaskGeometry(), m.image))), true, scale, paintGradient_referenceTileSize(scale), m.layerX + shape.rootX / units_LU_PER_PX, m.layerY)
    val faults = paintGradient_gradientFaults("none")
    val plan = paintGradient_planBackground(paint, faults)
    // The checks refuse every mask the plan does not model, so one here is a compiler fault, never an empty mask.
    if (!plan.modelled) throw IllegalStateException("dragon: the mask plan of " + v.dragonId + " is not modelled (layer origin " + paint.layerX + ", " + paint.layerY + ")")
    left = dragonCheckedInt(plan.left, v.dragonId + " mask left")
    val top = dragonCheckedInt(plan.top, v.dragonId + " mask top")
    val w = dragonCheckedInt(plan.right, v.dragonId + " mask right") - left
    val h = dragonCheckedInt(plan.bottom, v.dragonId + " mask bottom") - top
    if (w > 0 && h > 0) {
      val rows = maxOf(1, DRAGON_GRADIENT_STRIP_BYTES / (w * 4))
      var y0 = 0
      while (y0 < h) {
        val sh = minOf(rows, h - y0)
        val bytes = ByteArray(w * sh * 4)
        for (y in 0 until sh) {
          val source = if (DRAGON_MASK_PLANT_FLIP) top + h - 1 - (y0 + y) else top + y0 + y
          val row = paintGradient_backgroundRow(plan, source.toDouble(), faults)
          if (row.size != w * 4) throw IllegalStateException("dragon: the mask row of " + v.dragonId + " has " + row.size + " values, not " + (w * 4))
          for (i in 0 until row.size) {
            val c = row[i]
            if (!(c >= 0.0 && c <= 255.0) || kotlin.math.truncate(c) != c) throw IllegalStateException("dragon: mask channel " + c + " of " + v.dragonId + " is not a byte")
            bytes[y * w * 4 + i] = c.toInt().toByte()
          }
        }
        val bitmap = Bitmap.createBitmap(w, sh, Bitmap.Config.ARGB_8888)
        bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(bytes))
        strips.add(Pair(bitmap, top + y0))
        y0 += sh
      }
    }
  }
  // Chrome masks out what lies outside the mask painting area; the drawable clears every pixel of its bounds no strip covers.
  val d = DragonMaskDrawable(strips, (left - e[0]).toFloat(), e[1].toInt())
  d.setBounds(0, 0, (e[2] - e[0]).toInt(), (e[3] - e[1]).toInt())
  v.setLayerType(View.LAYER_TYPE_HARDWARE, null)
  v.overlay.clear()
  v.overlay.add(d)
  v.dragonMaskDrawable = d
  v.invalidate()
}

/**
 * The readback of the mask module: the gradient's kind and linear slope bits, the layer origin, whether the plan was modelled (a plan
 * that was not throws), and whether the box view draws its mask in a hardware layer.
 */
fun dragonAppliedMask(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val m = v.dragonMaskImage ?: return listOf()
  return listOf(Pair("dragonMaskImage", DumpJson.Obj(listOf(
    Pair("kind", DumpJson.Str((if (m.image.repeating) "repeating-" else "") + (if (m.image.radial) "radial" else "linear"))),
    Pair("slope", DumpJson.Str(String.format("%08x", java.lang.Float.floatToRawIntBits(m.image.slope.toFloat())))),
    Pair("origin", DumpJson.Arr(listOf(DumpJson.Num(m.layerX), DumpJson.Num(m.layerY)))),
    Pair("modelled", DumpJson.Bool(v.dragonMaskDrawable != null)),
    Pair("masked", DumpJson.Bool(v.layerType == View.LAYER_TYPE_HARDWARE && v.dragonMaskDrawable != null)),
  ))))
}
`;

/** A translated DragonMaskImage constructor call. */
function maskImage(lang: Lang, w: MaskWrite): string {
  return lang === 'swift'
    ? `DragonMaskImage(image: ${gradientImage(lang, w.gradient)}, layerX: ${num(w.layerOrigin[0])}, layerY: ${num(w.layerOrigin[1])})`
    : `DragonMaskImage(${gradientImage(lang, w.gradient)}, ${num(w.layerOrigin[0])}, ${num(w.layerOrigin[1])})`;
}

export const MASK_EMITTER: PaintEmitter<'mask-image', 'mask-gradient-flip'> = {
  name: 'mask',
  kinds: ['mask-image'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetMaskImage(${v}, ${maskImage('swift', w)})`],
    'android-views': (v, _n, w) => [`  dragonSetMaskImage(${v}, ${maskImage('kotlin', w)})`],
  },
  applied: (_e, _b, w) => ({
    kind: 'linear',
    slope: slopeBits(w.gradient.slope),
    origin: [w.layerOrigin[0], w.layerOrigin[1]],
    modelled: true,
    masked: true,
  }),
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, afterLayout: 'dragonAfterLayoutMask', applied: 'dragonAppliedMask' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutMask', applied: 'dragonAppliedMask' },
  },
  plants: [
    {
      name: 'mask-gradient-flip',
      replace: {
        uikit: ['public let dragonMaskPlantFlip = false\n', 'public let dragonMaskPlantFlip = true\n'],
        'android-views': ['const val DRAGON_MASK_PLANT_FLIP = false\n', 'const val DRAGON_MASK_PLANT_FLIP = true\n'],
      },
    },
  ],
};
