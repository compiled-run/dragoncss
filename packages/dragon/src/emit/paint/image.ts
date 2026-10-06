// SVG-a2 (docs/goals/milestone-2-proof/notes/T-svg-a-spec.md): an inline <svg>'s shapes are drawn in the same stage, after the
// image: each shape's path is filled (non-zero) and then stroked (butt caps, miter joins, miter limit 4) through the viewBox
// transform of the snapped content box, clipped to it. The viewBox transform is svg-geometry.ts viewBoxTransform's arithmetic.
// REPL-a Phase B (R6): a replaced image is Dragon-owned paint. The case code hands the PNG bytes to the box view, which decodes
// them once (ImageIO on UIKit, BitmapFactory on Android) and, in the image stage after the border, draws the bitmap into the
// engine's destination rect clipped to the drawn part of the content box (DragonTree.apply sets both after layout from the
// translated paint.ts replacedPaint). The readback is the natural size, the fit and the destination rect.
import type { PaintEmitter } from './types.ts';
import { keywordLit, NO_NATIVE_PAINT, rgbaLit } from './types.ts';

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
  /// SVG-a2: the svg's viewBox (min-x, min-y, width, height) or nil, and its shapes in paint order.
  public private(set) var dragonSvgViewBox: [Double]? = nil
  public private(set) var dragonSvgShapes: [DragonSvgShape]? = nil
  public func dragonSetSvg(_ viewBox: [Double]?, _ shapes: [DragonSvgShape]) {
    dragonSvgViewBox = viewBox
    dragonSvgShapes = shapes
    setNeedsDisplay()
  }
`;

const SWIFT = String.raw`import UIKit
import ImageIO

/// SVG-a2: one shape, its outline as verb-coded user units (0 move, 1 line, 2 quad, 3 cubic, 4 close, 5 circle), paint and stroke width.
public struct DragonSvgShape {
  public let path: [Double]
  public let fill: DragonRGBA8?
  public let stroke: DragonRGBA8?
  public let width: Double
  public init(_ path: [Double], _ fill: DragonRGBA8?, _ stroke: DragonRGBA8?, _ width: Double) { self.path = path; self.fill = fill; self.stroke = stroke; self.width = width }
}

/// The svg raster plants (all false in a clean build): stroke drawn under the fill, the even-odd fill rule, the stroke width not
/// scaled by the viewBox, and fill and stroke colours swapped.
public let dragonSvgPlantStrokeFirst = false
public let dragonSvgPlantEvenOdd = false
public let dragonSvgPlantStrokeUnscaled = false
public let dragonSvgPlantPaintSwapped = false

/// xMidYMid meet of a viewport w x h, in Chrome's arithmetic (svg-geometry.ts viewBoxTransform); the identity with no viewBox.
public func dragonSvgViewBoxTransform(_ vb: [Double]?, _ w: Double, _ h: Double) -> CGAffineTransform {
  guard let vb = vb else { return .identity }
  if vb[2] / vb[3] < w / h {
    let s = h / vb[3]
    return CGAffineTransform(a: s, b: 0, c: 0, d: s, tx: s * (-vb[0] - (vb[2] - (w * vb[3]) / h) / 2), ty: s * -vb[1])
  }
  let s = w / vb[2]
  return CGAffineTransform(a: s, b: 0, c: 0, d: s, tx: s * -vb[0], ty: s * (-vb[1] - (vb[3] - (h * vb[2]) / w) / 2))
}

/// A shape's outline as a CGPath in user units.
public func dragonSvgPath(_ p: [Double]) -> CGPath {
  let path = CGMutablePath()
  var i = 0
  while i < p.count {
    switch Int(p[i]) {
    case 0: path.move(to: CGPoint(x: p[i + 1], y: p[i + 2])); i += 3
    case 1: path.addLine(to: CGPoint(x: p[i + 1], y: p[i + 2])); i += 3
    case 2: path.addQuadCurve(to: CGPoint(x: p[i + 3], y: p[i + 4]), control: CGPoint(x: p[i + 1], y: p[i + 2])); i += 5
    case 3: path.addCurve(to: CGPoint(x: p[i + 5], y: p[i + 6]), control1: CGPoint(x: p[i + 1], y: p[i + 2]), control2: CGPoint(x: p[i + 3], y: p[i + 4])); i += 7
    case 4: path.closeSubpath(); i += 1
    case 5: path.addEllipse(in: CGRect(x: p[i + 1] - p[i + 3], y: p[i + 2] - p[i + 3], width: 2 * p[i + 3], height: 2 * p[i + 3])); i += 4
    default: fatalError("dragon: svg path verb \(p[i])")
    }
  }
  return path
}

/// The svg stage: every shape filled, then stroked, through the viewBox transform of the content box, clipped to it, in points.
public func dragonPaintSvg(_ v: DragonBoxView, _ ctx: CGContext) {
  guard let shapes = v.dragonSvgShapes, let c = v.dragonReplacedContent else { return }
  let s = v.dragonScale
  let box = CGRect(x: c[0] / s, y: c[1] / s, width: c[2] / s, height: c[3] / s)
  let m = dragonSvgViewBoxTransform(v.dragonSvgViewBox, Double(box.width), Double(box.height))
  ctx.saveGState()
  ctx.clip(to: box)
  ctx.translateBy(x: box.minX, y: box.minY)
  ctx.concatenate(m)
  ctx.setShouldAntialias(true)
  for shape in shapes {
    let path = dragonSvgPath(shape.path)
    let fill = dragonSvgPlantPaintSwapped ? shape.stroke : shape.fill
    let stroke = dragonSvgPlantPaintSwapped ? shape.fill : shape.stroke
    func paintFill() {
      guard let f = fill else { return }
      ctx.addPath(path)
      ctx.setFillColor(dragonUIColor(f).cgColor)
      ctx.fillPath(using: dragonSvgPlantEvenOdd ? .evenOdd : .winding)
    }
    func paintStroke() {
      guard let k = stroke, shape.width > 0 else { return }
      ctx.addPath(path)
      ctx.setLineWidth(CGFloat(dragonSvgPlantStrokeUnscaled ? shape.width / Double(m.a) : shape.width))
      ctx.setLineCap(.butt)
      ctx.setLineJoin(.miter)
      ctx.setMiterLimit(4)
      ctx.setStrokeColor(dragonUIColor(k).cgColor)
      ctx.strokePath()
    }
    if dragonSvgPlantStrokeFirst { paintStroke(); paintFill() } else { paintFill(); paintStroke() }
  }
  ctx.restoreGState()
}

/// The readback of an svg: its viewBox and each shape's fill, stroke and stroke width.
public func dragonAppliedSvg(_ v: DragonBoxView) -> DumpJsonObject {
  guard let shapes = v.dragonSvgShapes else { return [] }
  let vb: DumpJson = v.dragonSvgViewBox.map { .array($0.map { .number($0) }) } ?? .null
  let rows: [DumpJson] = shapes.map { .array([$0.fill.map { dragonRGBAJson($0) } ?? .null, $0.stroke.map { dragonRGBAJson($0) } ?? .null, .number($0.width)]) }
  return [("dragonSvg", .object([("viewBox", vb), ("shapes", .array(rows))]))]
}

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
  dragonPaintSvg(v, ctx)
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
  guard v.dragonImage != nil else { return dragonAppliedSvg(v) }
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
  /** Whether the stage may draw through its own layer: false under a transform that moves at run time (lower/paint/image.ts). */
  var dragonImageLayer: Boolean = false
    private set
  /** The image's own compositing layer (dragonPaintImageStage), made on the first hardware draw. */
  var dragonImageNode: android.graphics.RenderNode? = null
  fun dragonSetImage(base64: String, width: Double, height: Double, fit: String, layer: Boolean) {
    dragonImage = dragonDecodeImage(base64, dragonId)
    dragonImageNatural = doubleArrayOf(width, height)
    dragonImageFit = fit
    dragonImageLayer = layer
    invalidate()
  }
  /** SVG-a2: the svg's viewBox (min-x, min-y, width, height) or null, and its shapes in paint order. */
  var dragonSvgViewBox: DoubleArray? = null
    private set
  var dragonSvgShapes: List<DragonSvgShape>? = null
    private set
  fun dragonSetSvg(viewBox: DoubleArray?, shapes: List<DragonSvgShape>) {
    dragonSvgViewBox = viewBox
    dragonSvgShapes = shapes
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

/** SVG-a2: one shape, its outline as verb-coded user units (0 move, 1 line, 2 quad, 3 cubic, 4 close, 5 circle), paint and stroke width. */
class DragonSvgShape(val path: DoubleArray, val fill: DragonRGBA8?, val stroke: DragonRGBA8?, val width: Double)

/** The svg raster plants (all false in a clean build): stroke under the fill, even-odd fill, stroke width not scaled by the viewBox, paints swapped. */
const val DRAGON_SVG_PLANT_STROKE_FIRST = false
const val DRAGON_SVG_PLANT_EVEN_ODD = false
const val DRAGON_SVG_PLANT_STROKE_UNSCALED = false
const val DRAGON_SVG_PLANT_PAINT_SWAPPED = false

/** xMidYMid meet of a viewport w x h as [scale, tx, ty], in Chrome's arithmetic (svg-geometry.ts viewBoxTransform); the identity with no viewBox. */
fun dragonSvgViewBoxTransform(vb: DoubleArray?, w: Double, h: Double): DoubleArray {
  if (vb == null) return doubleArrayOf(1.0, 0.0, 0.0)
  if (vb[2] / vb[3] < w / h) {
    val s = h / vb[3]
    return doubleArrayOf(s, s * (-vb[0] - (vb[2] - (w * vb[3]) / h) / 2), s * -vb[1])
  }
  val s = w / vb[2]
  return doubleArrayOf(s, s * -vb[0], s * (-vb[1] - (vb[3] - (h * vb[2]) / w) / 2))
}

/** A shape's outline as a Path in user units, non-zero fill. */
fun dragonSvgPath(p: DoubleArray, evenOdd: Boolean): android.graphics.Path {
  val path = android.graphics.Path()
  path.fillType = if (evenOdd) android.graphics.Path.FillType.EVEN_ODD else android.graphics.Path.FillType.WINDING
  var i = 0
  while (i < p.size) {
    when (p[i].toInt()) {
      0 -> { path.moveTo(p[i + 1].toFloat(), p[i + 2].toFloat()); i += 3 }
      1 -> { path.lineTo(p[i + 1].toFloat(), p[i + 2].toFloat()); i += 3 }
      2 -> { path.quadTo(p[i + 1].toFloat(), p[i + 2].toFloat(), p[i + 3].toFloat(), p[i + 4].toFloat()); i += 5 }
      3 -> { path.cubicTo(p[i + 1].toFloat(), p[i + 2].toFloat(), p[i + 3].toFloat(), p[i + 4].toFloat(), p[i + 5].toFloat(), p[i + 6].toFloat()); i += 7 }
      4 -> { path.close(); i += 1 }
      5 -> { path.addCircle(p[i + 1].toFloat(), p[i + 2].toFloat(), p[i + 3].toFloat(), android.graphics.Path.Direction.CW); i += 4 }
      else -> throw IllegalStateException("dragon: svg path verb " + p[i])
    }
  }
  return path
}

/** The svg stage: every shape filled, then stroked, through the viewBox transform of the content box (CSS px), clipped to it. */
fun dragonPaintSvg(v: DragonBoxView, canvas: Canvas) {
  val shapes = v.dragonSvgShapes ?: return
  val c = v.dragonReplacedContent ?: return
  // User units are CSS px: the viewBox maps into the content box in CSS px, then the density scales it to device px.
  val density = v.resources.displayMetrics.density.toDouble()
  val m = dragonSvgViewBoxTransform(v.dragonSvgViewBox, c[2] / density, c[3] / density)
  canvas.save()
  canvas.clipRect(c[0].toFloat(), c[1].toFloat(), (c[0] + c[2]).toFloat(), (c[1] + c[3]).toFloat())
  canvas.translate(c[0].toFloat(), c[1].toFloat())
  canvas.scale(density.toFloat(), density.toFloat())
  val matrix = android.graphics.Matrix()
  matrix.setValues(floatArrayOf(m[0].toFloat(), 0f, m[1].toFloat(), 0f, m[0].toFloat(), m[2].toFloat(), 0f, 0f, 1f))
  canvas.concat(matrix)
  for (shape in shapes) {
    val path = dragonSvgPath(shape.path, DRAGON_SVG_PLANT_EVEN_ODD)
    val fill = if (DRAGON_SVG_PLANT_PAINT_SWAPPED) shape.stroke else shape.fill
    val stroke = if (DRAGON_SVG_PLANT_PAINT_SWAPPED) shape.fill else shape.stroke
    val paintFill = {
      if (fill != null) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.style = Paint.Style.FILL
        paint.color = dragonArgb(fill)
        canvas.drawPath(path, paint)
      }
    }
    val paintStroke = {
      if (stroke != null && shape.width > 0) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = (if (DRAGON_SVG_PLANT_STROKE_UNSCALED) shape.width / m[0] else shape.width).toFloat()
        paint.strokeCap = Paint.Cap.BUTT
        paint.strokeJoin = Paint.Join.MITER
        paint.strokeMiter = 4f
        paint.color = dragonArgb(stroke)
        canvas.drawPath(path, paint)
      }
    }
    if (DRAGON_SVG_PLANT_STROKE_FIRST) { paintStroke(); paintFill() } else { paintFill(); paintStroke() }
  }
  canvas.restore()
}

/** The readback of an svg: its viewBox and each shape's fill, stroke and stroke width. */
fun dragonAppliedSvg(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val shapes = v.dragonSvgShapes ?: return emptyList()
  val vb = v.dragonSvgViewBox
  val rows = shapes.map { DumpJson.Arr(listOf(it.fill?.let { f -> dragonRGBAJson(f) } ?: DumpJson.Null, it.stroke?.let { k -> dragonRGBAJson(k) } ?: DumpJson.Null, DumpJson.Num(it.width))) }
  return listOf(Pair("dragonSvg", DumpJson.Obj(listOf(Pair("viewBox", if (vb == null) DumpJson.Null else DumpJson.Arr(vb.map { DumpJson.Num(it) })), Pair("shapes", DumpJson.Arr(rows))))))
}

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
  dragonPaintSvg(v, canvas)
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
  // Direct draw (sampled once through the full matrix) on a software canvas, under a transform that moves at run time (the
  // compiler's layer flag), under a scale, rotation, skew or fractional translate of the box or an ancestor (a layer would be
  // resampled), and for a layer over the GPU's texture size limit.
  if (!canvas.isHardwareAccelerated || !v.dragonImageLayer || r - l > canvas.maximumBitmapWidth || b - t > canvas.maximumBitmapHeight || !dragonWholePxTranslate(v)) {
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
  if (v.dragonImage == null) return dragonAppliedSvg(v)
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

/** A finite number as a Swift or Kotlin Double literal (the shortest round-trip digits, with a decimal point). */
const numLit = (n: number): string => {
  if (!Number.isFinite(n)) throw new Error(`svg number ${n} is not finite`);
  const t = String(n);
  return /[.e]/.test(t) ? t : `${t}.0`;
};

const svgColor = (c: { r: number; g: number; b: number; alpha: number } | null, backend: 'swift' | 'kotlin'): string => (c === null ? (backend === 'swift' ? 'nil' : 'null') : rgbaLit(c));

export const IMAGE_EMITTER: PaintEmitter<'replaced-image' | 'svg-shapes', 'image-offset-1' | 'svg-stroke-first' | 'svg-even-odd' | 'svg-stroke-unscaled' | 'svg-paint-swapped'> = {
  name: 'image',
  kinds: ['replaced-image', 'svg-shapes'],
  lines: {
    uikit: (v, _n, w) => (w.kind === 'svg-shapes'
      ? [`  ${v}.dragonSetSvg(${w.viewBox === null ? 'nil' : `[${w.viewBox.map(numLit).join(', ')}]`}, [${w.shapes.map((sh) => `DragonSvgShape([${sh.path.map(numLit).join(', ')}], ${svgColor(sh.fill, 'swift')}, ${svgColor(sh.stroke, 'swift')}, ${numLit(sh.width)})`).join(', ')}])`]
      : [`  ${v}.dragonSetImage(${base64Lit(w.data)}, width: ${pxLit(w.width)}, height: ${pxLit(w.height)}, fit: ${keywordLit(w.fit)})`]),
    'android-views': (v, _n, w) => (w.kind === 'svg-shapes'
      ? [`  ${v}.dragonSetSvg(${w.viewBox === null ? 'null' : `doubleArrayOf(${w.viewBox.map(numLit).join(', ')})`}, listOf(${w.shapes.map((sh) => `DragonSvgShape(doubleArrayOf(${sh.path.map(numLit).join(', ')}), ${svgColor(sh.fill, 'kotlin')}, ${svgColor(sh.stroke, 'kotlin')}, ${numLit(sh.width)})`).join(', ')}))`]
      : [`  ${v}.dragonSetImage(${base64Lit(w.data)}, ${pxLit(w.width)}, ${pxLit(w.height)}, ${keywordLit(w.fit)}, ${w.layer ? 'true' : 'false'})`]),
  },
  applied: (_e, backend, w, dpr, g) => {
    if (w.kind === 'svg-shapes') {
      const rgba = (c: { r: number; g: number; b: number; alpha: number } | null) => (c === null ? null : [c.r, c.g, c.b, c.alpha]);
      return { viewBox: w.viewBox === null ? null : [...w.viewBox], shapes: w.shapes.map((sh) => [rgba(sh.fill), rgba(sh.stroke), sh.width]) };
    }
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
    { name: 'svg-stroke-first', replace: { uikit: ['public let dragonSvgPlantStrokeFirst = false', 'public let dragonSvgPlantStrokeFirst = true'], 'android-views': ['const val DRAGON_SVG_PLANT_STROKE_FIRST = false', 'const val DRAGON_SVG_PLANT_STROKE_FIRST = true'] } },
    { name: 'svg-even-odd', replace: { uikit: ['public let dragonSvgPlantEvenOdd = false', 'public let dragonSvgPlantEvenOdd = true'], 'android-views': ['const val DRAGON_SVG_PLANT_EVEN_ODD = false', 'const val DRAGON_SVG_PLANT_EVEN_ODD = true'] } },
    { name: 'svg-stroke-unscaled', replace: { uikit: ['public let dragonSvgPlantStrokeUnscaled = false', 'public let dragonSvgPlantStrokeUnscaled = true'], 'android-views': ['const val DRAGON_SVG_PLANT_STROKE_UNSCALED = false', 'const val DRAGON_SVG_PLANT_STROKE_UNSCALED = true'] } },
    { name: 'svg-paint-swapped', replace: { uikit: ['public let dragonSvgPlantPaintSwapped = false', 'public let dragonSvgPlantPaintSwapped = true'], 'android-views': ['const val DRAGON_SVG_PLANT_PAINT_SWAPPED = false', 'const val DRAGON_SVG_PLANT_PAINT_SWAPPED = true'] } },
  ],
};
