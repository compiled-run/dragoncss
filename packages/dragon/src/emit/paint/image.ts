// REPL-a Phase B (R6): a replaced image is Dragon-owned paint. The case code hands the PNG bytes to the box view, which decodes
// them once (ImageIO on UIKit, BitmapFactory on Android) and, in the image stage after the border, draws the bitmap into the
// engine's destination rect clipped to the drawn part of the content box (DragonTree.apply sets both after layout from the
// translated paint.ts replacedPaint). The readback is the natural size, the fit and the destination rect.
import type { PaintEmitter } from './types.ts';
import { keywordLit, NO_NATIVE_PAINT } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// REPL-a image: the decoded bitmap, its natural size in CSS px and its object-fit.
  public private(set) var dragonImage: CGImage? = nil
  public private(set) var dragonImageNatural: [Double] = [0, 0]
  public private(set) var dragonImageFit: String = "fill"
  public func dragonSetImage(_ base64: String, width: Double, height: Double, fit: String) {
    dragonImage = dragonDecodeImage(base64, dragonId)
    dragonImageNatural = [width, height]
    dragonImageFit = fit
    setNeedsDisplay()
  }
`;

const SWIFT = String.raw`import UIKit
import ImageIO

/// Device px added to the drawn destination x; 0 except in the image-offset-1 raster plant build, which proves the pixel lane sees the image.
public let dragonImagePlantDevicePx: Double = 0

/// Decodes the PNG bytes once, when the view is built (kCGImageSourceShouldCacheImmediately), so a capture never waits on a decode.
public func dragonDecodeImage(_ base64: String, _ id: String) -> CGImage {
  guard let data = Data(base64Encoded: base64), let source = CGImageSourceCreateWithData(data as CFData, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else {
    fatalError("dragon: \(id): the image bytes do not decode")
  }
  return image
}

/// The image stage: the bitmap into the destination rect, clipped to the drawn part of the content box, in points.
public func dragonPaintImageStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  guard let image = v.dragonImage, let d = v.dragonReplacedDest, let c = v.dragonReplacedDrawn else { return }
  let s = CGFloat(v.dragonScale)
  ctx.saveGState()
  ctx.clip(to: CGRect(x: CGFloat(c[0]) / s, y: CGFloat(c[1]) / s, width: CGFloat(c[2]) / s, height: CGFloat(c[3]) / s))
  ctx.interpolationQuality = .high
  UIImage(cgImage: image).draw(in: CGRect(x: CGFloat(d[0] + dragonImagePlantDevicePx) / s, y: CGFloat(d[1]) / s, width: CGFloat(d[2]) / s, height: CGFloat(d[3]) / s))
  ctx.restoreGState()
}

/// The readback of the image module: the natural size, the fit and the destination rect in points relative to the box.
public func dragonAppliedImage(_ v: DragonBoxView) -> DumpJsonObject {
  guard v.dragonImage != nil else { return [] }
  let s = v.dragonScale
  let dest: DumpJson = v.dragonReplacedDest.map { .array($0.map { .number($0 / s) }) } ?? .null
  return [("dragonImage", .object([("natural", .array(v.dragonImageNatural.map { .number($0) })), ("fit", .string(v.dragonImageFit)), ("dest", dest)]))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** REPL-a image: the decoded bitmap, its natural size in CSS px and its object-fit. */
  var dragonImage: android.graphics.Bitmap? = null
    private set
  var dragonImageNatural: DoubleArray = DoubleArray(2)
    private set
  var dragonImageFit: String = "fill"
    private set
  /** The image's own compositing layer (dragonPaintImageStage), made on the first hardware draw. */
  var dragonImageNode: android.graphics.RenderNode? = null
  fun dragonSetImage(base64: String, width: Double, height: Double, fit: String) {
    dragonImage = dragonDecodeImage(base64, dragonId)
    dragonImageNatural = doubleArrayOf(width, height)
    dragonImageFit = fit
    invalidate()
  }
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.RenderNode
import android.util.Base64
import android.view.View
import dev.dragon.dump.DumpJson

/** Device px added to the drawn destination x; 0 except in the image-offset-1 raster plant build, which proves the pixel lane sees the image. */
const val DRAGON_IMAGE_PLANT_DEVICE_PX = 0.0

/** Decodes the PNG bytes once, when the view is built (BitmapFactory is synchronous), so a capture never waits on a decode. */
fun dragonDecodeImage(base64: String, id: String): Bitmap {
  val bytes = Base64.decode(base64, Base64.DEFAULT)
  val options = BitmapFactory.Options()
  options.inPreferredConfig = Bitmap.Config.ARGB_8888
  options.inScaled = false
  val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: throw IllegalStateException("dragon: " + id + ": the image bytes do not decode")
  // Upload the texture now, not on the first draw, so the frame that presents the box already holds the image.
  bitmap.prepareToDraw()
  return bitmap
}

/**
 * The image stage: the bitmap, filtered, into the destination rect, clipped to the drawn part of the content box, in device px.
 * On a hardware canvas it is drawn into a RenderNode with its own compositing layer over the drawn part (whole device px), which
 * the frame composites unscaled: a filtered bitmap drawn straight into the window's frame moved other boxes' edges by one colour
 * step on the Android emulator's renderer (#72's device run), and a layer keeps the filtered draw out of that render pass.
 */
fun dragonPaintImageStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  val image = v.dragonImage ?: return
  val d = v.dragonReplacedDest ?: return
  val c = v.dragonReplacedDrawn ?: return
  val x = d[0] + DRAGON_IMAGE_PLANT_DEVICE_PX
  val dest = RectF(x.toFloat(), d[1].toFloat(), (x + d[2]).toFloat(), (d[1] + d[3]).toFloat())
  val paint = Paint(Paint.FILTER_BITMAP_FLAG)
  val px = dragonCoveringPx(c)
  val l = px[0]
  val t = px[1]
  val r = px[2]
  val b = px[3]
  // Direct draw (sampled once through the full matrix) on a software canvas, under a scale, rotation, skew or fractional
  // translate of the box or an ancestor (a layer would be resampled), and for a layer over the GPU's texture size limit.
  if (!canvas.isHardwareAccelerated || r - l > canvas.maximumBitmapWidth || b - t > canvas.maximumBitmapHeight || !dragonWholePxTranslate(v)) {
    canvas.save()
    canvas.clipRect(c[0].toFloat(), c[1].toFloat(), (c[0] + c[2]).toFloat(), (c[1] + c[3]).toFloat())
    canvas.drawBitmap(image, null, dest, paint)
    canvas.restore()
    return
  }
  if (r <= l || b <= t) return
  val node = v.dragonImageNode ?: RenderNode("dragonImage").also {
    it.setUseCompositingLayer(true, null)
    v.dragonImageNode = it
  }
  node.setPosition(l, t, r, b)
  val inner = node.beginRecording(r - l, b - t)
  try {
    inner.translate(-l.toFloat(), -t.toFloat())
    inner.clipRect(c[0].toFloat(), c[1].toFloat(), (c[0] + c[2]).toFloat(), (c[1] + c[3]).toFloat())
    inner.drawBitmap(image, null, dest, paint)
  } finally {
    node.endRecording()
  }
  canvas.drawRenderNode(node)
}

/** Whether the view and every ancestor map to their parent by at most a whole-device-px translate (each View matrix). */
fun dragonWholePxTranslate(v: View): Boolean {
  val m = FloatArray(9)
  var at: View? = v
  while (at != null) {
    val matrix = at.matrix
    if (!matrix.isIdentity) {
      matrix.getValues(m)
      if (m[0] != 1f || m[1] != 0f || m[3] != 0f || m[4] != 1f || m[6] != 0f || m[7] != 0f || m[8] != 1f || m[2] % 1f != 0f || m[5] % 1f != 0f) return false
    }
    at = at.parent as? View
  }
  return true
}

/** The readback of the image module: the natural size, the fit and the destination rect in device px relative to the box. */
fun dragonAppliedImage(v: DragonBoxView): List<Pair<String, DumpJson>> {
  if (v.dragonImage == null) return emptyList()
  val d = v.dragonReplacedDest
  val dest = if (d == null) DumpJson.Null else DumpJson.Arr(d.map { DumpJson.Num(it) })
  return listOf(Pair("dragonImage", DumpJson.Obj(listOf(Pair("natural", DumpJson.Arr(v.dragonImageNatural.map { DumpJson.Num(it) })), Pair("fit", DumpJson.Str(v.dragonImageFit)), Pair("dest", dest)))))
}
`;

/** A natural size (whole image px) as a Swift or Kotlin Double literal. */
const pxLit = (n: number): string => {
  if (!Number.isInteger(n) || n < 0) throw new Error(`natural size ${n} is not a whole px`);
  return `${n}.0`;
};

/** base64 is A-Z, a-z, 0-9, +, / and =, so it needs no escaping in a Swift or Kotlin string literal. */
const base64Lit = (s: string): string => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('image data is not base64');
  return `"${s}"`;
};

export const IMAGE_EMITTER: PaintEmitter<'replaced-image'> = {
  name: 'image',
  kinds: ['replaced-image'],
  lines: {
    uikit: (v, _n, w) => [`  ${v}.dragonSetImage(${base64Lit(w.data)}, width: ${pxLit(w.width)}, height: ${pxLit(w.height)}, fit: ${keywordLit(w.fit)})`],
    'android-views': (v, _n, w) => [`  ${v}.dragonSetImage(${base64Lit(w.data)}, ${pxLit(w.width)}, ${pxLit(w.height)}, ${keywordLit(w.fit)})`],
  },
  applied: (_e, backend, w, dpr, g) => {
    if (g.replaced === null) throw new Error('an image write on a box that is not replaced');
    return { natural: [w.width, w.height], fit: w.fit, dest: backend === 'uikit' ? g.replaced.dest.map((v) => v / dpr) : [...g.replaced.dest] };
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, stages: { border: 'dragonPaintImageStage' }, applied: 'dragonAppliedImage' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, stages: { border: 'dragonPaintImageStage' }, applied: 'dragonAppliedImage' },
  },
  plants: [
    {
      name: 'image-offset-1',
      replace: {
        uikit: ['public let dragonImagePlantDevicePx: Double = 0', 'public let dragonImagePlantDevicePx: Double = 1'],
        'android-views': ['const val DRAGON_IMAGE_PLANT_DEVICE_PX = 0.0', 'const val DRAGON_IMAGE_PLANT_DEVICE_PX = 1.0'],
      },
    },
  ],
};
