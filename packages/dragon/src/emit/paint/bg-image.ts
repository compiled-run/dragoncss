// BG2-u part 2 (notes/T074-bg2-spec.md R10): the native drawing of a url() background layer, part of the gradient module's support
// file and stage. The case code hands the PNG bytes and the layer's geometry to the writer, which decodes them once (the image
// module's dragonDecodeImage: ImageIO on UIKit, BitmapFactory on Android). After every layout the geometry is resolved in the view's
// device px: the origin and clip boxes are the snapped border box less the device-px borders and the paddings; the tile is the
// natural size times the device scale, placed by its px position times the scale or its percentage of the free space, and on a
// no-repeat axis at the nearest whole device px. The background-layers stage draws the tile on each repeating axis over the clip box
// (one tile on a no-repeat axis), clipped to the clip box and the rounded border box. The readback is the write's own values and the
// decoded bitmap's size. paint-samples/bg-image.ts places the device lanes' tile points from the same arithmetic.
import type { BackgroundImageWrite, TilePosition } from '../../lower/paint/bg-image.ts';
import type { JsonValue } from '../expected-dump.ts';
import { keywordLit } from './types.ts';

type Lang = 'swift' | 'kotlin';

/** A finite number as a Swift or Kotlin Double literal. */
function num(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`non-finite number ${v} in a background image`);
  if (Object.is(v, -0)) return '-0.0';
  const s = String(v);
  return /[.e]/.test(s) ? s.replace(/e\+?/, 'E') : `${s}.0`;
}

/** base64 is A-Z, a-z, 0-9, +, / and =, so it needs no escaping in a Swift or Kotlin string literal. */
function base64Lit(s: string): string {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('background image data is not base64');
  return `"${s}"`;
}

/** A natural size (whole image px) as a Double literal. */
function pxLit(n: number): string {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`natural size ${n} is not a whole positive px`);
  return `${n}.0`;
}

/** The case-code line of one background-image write: the public writer, as a runtime write would call it (RT-1). */
export function backgroundImageLine(lang: Lang, v: string, w: BackgroundImageWrite): string {
  const units = [w.positionX.unit, w.positionY.unit].map(keywordLit).join(', ');
  const repeats = [w.repeatX, w.repeatY].map(keywordLit).join(', ');
  const values = [w.positionX.value, w.positionY.value].map(num).join(', ');
  if (lang === 'swift') return `  dragonSetBackgroundImage(${v}, ${base64Lit(w.data)}, natural: [${pxLit(w.width)}, ${pxLit(w.height)}], repeats: [${repeats}], units: [${units}], position: [${values}], origin: ${keywordLit(w.origin)}, clip: ${keywordLit(w.clip)})`;
  return `  dragonSetBackgroundImage(${v}, ${base64Lit(w.data)}, doubleArrayOf(${pxLit(w.width)}, ${pxLit(w.height)}), arrayOf(${repeats}), arrayOf(${units}), doubleArrayOf(${values}), ${keywordLit(w.origin)}, ${keywordLit(w.clip)}, ${w.layer ? 'true' : 'false'})`;
}

const position = (p: TilePosition): JsonValue => [p.unit, p.value];

/** The expected readback: the natural size, the decoded bitmap's size (a PNG decodes at its natural size), repeats, positions, boxes. */
export function backgroundImageApplied(w: BackgroundImageWrite): JsonValue {
  return { natural: [w.width, w.height], decoded: [w.width, w.height], repeat: [w.repeatX, w.repeatY], position: [position(w.positionX), position(w.positionY)], origin: w.origin, clip: w.clip };
}

export const BG_IMAGE_SWIFT_MEMBERS = String.raw`  /// BG2-u: the url() background layer the case code wrote, and its geometry at the last layout.
  public var dragonBackgroundImage: DragonBackgroundImage? = nil { didSet { dragonBackgroundImageTiles = nil; setNeedsDisplay() } }
  public var dragonBackgroundImageTiles: DragonBackgroundImageTiles? = nil
`;

export const BG_IMAGE_SWIFT = String.raw`
/// BG2-u: a box's url() background layer, as the case code writes it: the decoded bitmap, its natural size in CSS px, whether each
/// axis repeats, each position's unit ("px" or "percent") and value, and the background-origin and background-clip boxes.
public final class DragonBackgroundImage {
  public let image: CGImage
  public let natural: [Double]
  public let repeats: [Bool]
  public let repeatNames: [String]
  public let units: [String]
  public let position: [Double]
  public let origin: String
  public let clip: String
  public init(image: CGImage, natural: [Double], repeatNames: [String], units: [String], position: [Double], origin: String, clip: String) {
    self.image = image; self.natural = natural; self.repeatNames = repeatNames; self.repeats = repeatNames.map { $0 == "repeat" }
    self.units = units; self.position = position; self.origin = origin; self.clip = clip
  }
}

/// The geometry of one layout in the view's device px: the clip box (left, top, right, bottom) and the tile (x, y, width, height).
public struct DragonBackgroundImageTiles {
  public let clip: [Double]
  public let tile: [Double]
}

/// Device px the tile is drawn right of its place: 0 except in the bg-image-offset-1 raster plant build.
public let dragonBackgroundImagePlantDevicePx: Double = 0

/// The writer (RT-1): the case code and runtime writes set a box's url() layer through it.
public func dragonSetBackgroundImage(_ v: DragonBoxView, _ base64: String, natural: [Double], repeats: [String], units: [String], position: [Double], origin: String, clip: String) {
  if natural.count != 2 || repeats.count != 2 || units.count != 2 || position.count != 2 { fatalError("dragon: the background image of \(v.dragonId) is not one value per axis") }
  v.dragonBackgroundImage = DragonBackgroundImage(image: dragonDecodeImage(base64, v.dragonId), natural: natural, repeatNames: repeats, units: units, position: position, origin: origin, clip: clip)
  dragonAfterLayoutBackgroundImage(v, v.dragonShape, v.dragonScale)
}

/// A box's insets (top, right, bottom, left) in device px: none for the border box, the borders, or the borders and paddings.
func dragonBackgroundInsets(_ box: String, _ shape: DragonBoxShape, _ id: String) -> [Double] {
  switch box {
  case "border-box": return [0, 0, 0, 0]
  case "padding-box": return shape.borders
  case "content-box": return (0..<4).map { shape.borders[$0] + shape.padding[$0] / units_LU_PER_PX }
  default: fatalError("dragon: \(id): background box \(box)")
  }
}

/// After every layout: the clip box and the tile in the view's device px (emit/paint/bg-image.ts; paint-samples/bg-image.ts tileGeometry).
public func dragonAfterLayoutBackgroundImage(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let b = v.dragonBackgroundImage else { return }
  let w = shape.edges[2] - shape.edges[0]
  let h = shape.edges[3] - shape.edges[1]
  let o = dragonBackgroundInsets(b.origin, shape, v.dragonId)
  let c = dragonBackgroundInsets(b.clip, shape, v.dragonId)
  let area = [o[3], o[0], w - o[1], h - o[2]]
  let size = [b.natural[0] * scale, b.natural[1] * scale]
  var start = [0.0, 0.0]
  for k in 0..<2 {
    let lo = area[k]
    let free = (area[k + 2] - area[k]) - size[k]
    var at: Double
    switch b.units[k] {
    case "px": at = lo + b.position[k] * scale
    case "percent": at = lo + (b.position[k] / 100) * free
    default: fatalError("dragon: \(v.dragonId): background position unit \(b.units[k])")
    }
    if !b.repeats[k] { at = (at + 0.5).rounded(.down) }
    start[k] = at
  }
  v.dragonBackgroundImageTiles = DragonBackgroundImageTiles(clip: [c[3], c[0], w - c[1], h - c[2]], tile: [start[0] + dragonBackgroundImagePlantDevicePx, start[1], size[0], size[1]])
  v.setNeedsDisplay()
}

/// The first and last tile index on an axis that meets [lo, hi): every index on a repeating axis, 0 alone on the other.
func dragonTileRange(_ at: Double, _ size: Double, _ lo: Double, _ hi: Double, _ repeats: Bool) -> (Int, Int) {
  if !repeats { return (0, 0) }
  return (dragonCheckedInt(((lo - at) / size).rounded(.down), "background tile"), dragonCheckedInt(((hi - at) / size).rounded(.up), "background tile") - 1)
}

/// The url() layer in the background-layers stage: each tile that meets the clip box, drawn into its rect in points with high
/// quality interpolation and no antialiasing (adjacent tiles share their edges), clipped to the clip box and the rounded border box.
public func dragonPaintBackgroundImage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  guard let b = v.dragonBackgroundImage, let g = v.dragonBackgroundImageTiles else { return }
  let c = g.clip
  let t = g.tile
  guard c[2] > c[0], c[3] > c[1], t[2] > 0, t[3] > 0 else { return }
  let s = CGFloat(v.dragonScale)
  let xs = dragonTileRange(t[0], t[2], c[0], c[2], b.repeats[0])
  let ys = dragonTileRange(t[1], t[3], c[1], c[3], b.repeats[1])
  if xs.1 < xs.0 || ys.1 < ys.0 { return }
  ctx.saveGState()
  ctx.clip(to: CGRect(x: CGFloat(c[0]) / s, y: CGFloat(c[1]) / s, width: CGFloat(c[2] - c[0]) / s, height: CGFloat(c[3] - c[1]) / s))
  if let path = dragonRoundedPath(v, shape, inner: false) {
    ctx.addPath(path)
    ctx.clip()
  }
  ctx.setShouldAntialias(false)
  ctx.interpolationQuality = .high
  let ui = UIImage(cgImage: b.image)
  for j in ys.0...ys.1 {
    for i in xs.0...xs.1 {
      let x = t[0] + Double(i) * t[2]
      let y = t[1] + Double(j) * t[3]
      ui.draw(in: CGRect(x: CGFloat(x) / s, y: CGFloat(y) / s, width: CGFloat(t[2]) / s, height: CGFloat(t[3]) / s))
    }
  }
  ctx.restoreGState()
}

/// The readback of a url() layer: the natural size, the decoded bitmap's size, the repeats, the positions, and the two boxes.
public func dragonAppliedBackgroundImage(_ v: DragonBoxView) -> DumpJsonObject {
  guard let b = v.dragonBackgroundImage else { return [] }
  let position: [DumpJson] = (0..<2).map { k in DumpJson.array([DumpJson.string(b.units[k]), DumpJson.number(b.position[k])]) }
  return [("dragonBackgroundImage", .object([
    ("natural", .array(b.natural.map { .number($0) })),
    ("decoded", .array([.number(Double(b.image.width)), .number(Double(b.image.height))])),
    ("repeat", .array(b.repeatNames.map { .string($0) })),
    ("position", .array(position)),
    ("origin", .string(b.origin)),
    ("clip", .string(b.clip)),
  ]))]
}
`;

export const BG_IMAGE_KOTLIN_MEMBERS = String.raw`  /** BG2-u: the url() background layer the case code wrote, its geometry at the last layout, and its own compositing layer. */
  var dragonBackgroundImage: DragonBackgroundImage? = null
    set(value) { field = value; dragonBackgroundImageTiles = null; invalidate() }
  var dragonBackgroundImageTiles: DragonBackgroundImageTiles? = null
  var dragonBackgroundImageNode: android.graphics.RenderNode? = null
`;

export const BG_IMAGE_KOTLIN_IMPORTS = String.raw`import android.graphics.BitmapShader
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RenderNode
import android.graphics.Shader
`;

export const BG_IMAGE_KOTLIN = String.raw`
/**
 * BG2-u: a box's url() background layer, as the case code writes it: the decoded bitmap, its natural size in CSS px, each axis's
 * repeat, each position's unit ("px" or "percent") and value, the background-origin and background-clip boxes, and whether the
 * stage may draw through its own layer (false under a transform that moves at run time). The shader and paint are made once.
 */
class DragonBackgroundImage(val image: Bitmap, val natural: DoubleArray, val repeatNames: Array<String>, val units: Array<String>, val position: DoubleArray, val origin: String, val clip: String, val layer: Boolean) {
  val repeats: BooleanArray = BooleanArray(2) { k -> repeatNames[k] == "repeat" }
  val shader: BitmapShader = BitmapShader(image, if (repeats[0]) Shader.TileMode.REPEAT else Shader.TileMode.CLAMP, if (repeats[1]) Shader.TileMode.REPEAT else Shader.TileMode.CLAMP)
  val paint: Paint = Paint(Paint.FILTER_BITMAP_FLAG).also { it.shader = shader }
}

/** The geometry of one layout in the view's device px: the clip box (left, top, right, bottom) and the tile (x, y, width, height). */
class DragonBackgroundImageTiles(val clip: DoubleArray, val tile: DoubleArray)

/** Device px the tile is drawn right of its place: 0 except in the bg-image-offset-1 raster plant build. */
const val DRAGON_BACKGROUND_IMAGE_PLANT_DEVICE_PX = 0.0

/** The writer (RT-1): the case code and runtime writes set a box's url() layer through it. */
fun dragonSetBackgroundImage(v: DragonBoxView, base64: String, natural: DoubleArray, repeats: Array<String>, units: Array<String>, position: DoubleArray, origin: String, clip: String, layer: Boolean) {
  if (natural.size != 2 || repeats.size != 2 || units.size != 2 || position.size != 2) throw IllegalStateException("dragon: the background image of " + v.dragonId + " is not one value per axis")
  v.dragonBackgroundImage = DragonBackgroundImage(dragonDecodeImage(base64, v.dragonId), natural, repeats, units, position, origin, clip, layer)
  dragonAfterLayoutBackgroundImage(v, v.dragonShape, v.dragonGradientScale)
}

/** A box's insets (top, right, bottom, left) in device px: none for the border box, the borders, or the borders and paddings. */
fun dragonBackgroundInsets(box: String, shape: DragonBoxShape, id: String): DoubleArray = when (box) {
  "border-box" -> doubleArrayOf(0.0, 0.0, 0.0, 0.0)
  "padding-box" -> shape.borders.copyOf()
  "content-box" -> DoubleArray(4) { k -> shape.borders[k] + shape.padding[k] / units_LU_PER_PX }
  else -> throw IllegalStateException("dragon: " + id + ": background box " + box)
}

/** After every layout: the clip box and the tile in the view's device px (emit/paint/bg-image.ts; paint-samples/bg-image.ts tileGeometry). */
fun dragonAfterLayoutBackgroundImage(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val b = v.dragonBackgroundImage ?: return
  val w = shape.edges[2] - shape.edges[0]
  val h = shape.edges[3] - shape.edges[1]
  val o = dragonBackgroundInsets(b.origin, shape, v.dragonId)
  val c = dragonBackgroundInsets(b.clip, shape, v.dragonId)
  val area = doubleArrayOf(o[3], o[0], w - o[1], h - o[2])
  val size = doubleArrayOf(b.natural[0] * scale, b.natural[1] * scale)
  val start = DoubleArray(2)
  for (k in 0 until 2) {
    val lo = area[k]
    val free = (area[k + 2] - area[k]) - size[k]
    var at = when (b.units[k]) {
      "px" -> lo + b.position[k] * scale
      "percent" -> lo + (b.position[k] / 100) * free
      else -> throw IllegalStateException("dragon: " + v.dragonId + ": background position unit " + b.units[k])
    }
    if (!b.repeats[k]) at = kotlin.math.floor(at + 0.5)
    start[k] = at
  }
  v.dragonBackgroundImageTiles = DragonBackgroundImageTiles(doubleArrayOf(c[3], c[0], w - c[1], h - c[2]), doubleArrayOf(start[0] + DRAGON_BACKGROUND_IMAGE_PLANT_DEVICE_PX, start[1], size[0], size[1]))
  v.invalidate()
}

/**
 * The url() layer in the background-layers stage: the shader (scaled to the tile, placed at its origin) over the clip box, narrowed
 * to the tile on a no-repeat axis, with a filtered Paint and no antialiasing, clipped to the rounded border box. On a hardware canvas
 * it is drawn into a RenderNode with its own compositing layer over that rect, as the image module draws an img (a filtered bitmap
 * drawn straight into the frame moved other boxes' edges on the emulator's renderer, #72); directly on a software canvas, under a
 * transform that moves at run time, a fractional or non-translate matrix, or past the GPU's texture size.
 */
fun dragonPaintBackgroundImage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  val b = v.dragonBackgroundImage ?: return
  val g = v.dragonBackgroundImageTiles ?: return
  val c = g.clip
  val t = g.tile
  if (!(t[2] > 0.0 && t[3] > 0.0)) return
  val l = if (b.repeats[0]) c[0] else maxOf(c[0], t[0])
  val r = if (b.repeats[0]) c[2] else minOf(c[2], t[0] + t[2])
  val top = if (b.repeats[1]) c[1] else maxOf(c[1], t[1])
  val bottom = if (b.repeats[1]) c[3] else minOf(c[3], t[1] + t[3])
  if (r <= l || bottom <= top) return
  val m = Matrix()
  m.setScale((t[2] / b.image.width).toFloat(), (t[3] / b.image.height).toFloat())
  m.postTranslate(t[0].toFloat(), t[1].toFloat())
  b.shader.setLocalMatrix(m)
  val curve = dragonRoundedPath(v, shape, false)
  val px = dragonCoveringPx(doubleArrayOf(l, top, r - l, bottom - top))
  if (!canvas.isHardwareAccelerated || !b.layer || px[2] - px[0] > canvas.maximumBitmapWidth || px[3] - px[1] > canvas.maximumBitmapHeight || !dragonWholePxTranslate(v)) {
    canvas.save()
    if (curve != null) canvas.clipPath(curve)
    canvas.drawRect(l.toFloat(), top.toFloat(), r.toFloat(), bottom.toFloat(), b.paint)
    canvas.restore()
    return
  }
  val node = v.dragonBackgroundImageNode ?: RenderNode("dragonBackgroundImage").also {
    it.setUseCompositingLayer(true, null)
    v.dragonBackgroundImageNode = it
  }
  node.setPosition(px[0], px[1], px[2], px[3])
  val inner = node.beginRecording(px[2] - px[0], px[3] - px[1])
  try {
    inner.translate(-px[0].toFloat(), -px[1].toFloat())
    if (curve != null) inner.clipPath(curve)
    inner.drawRect(l.toFloat(), top.toFloat(), r.toFloat(), bottom.toFloat(), b.paint)
  } finally {
    node.endRecording()
  }
  canvas.drawRenderNode(node)
}

/** The readback of a url() layer: the natural size, the decoded bitmap's size, the repeats, the positions, and the two boxes. */
fun dragonAppliedBackgroundImage(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val b = v.dragonBackgroundImage ?: return listOf()
  val position = (0 until 2).map { k -> DumpJson.Arr(listOf(DumpJson.Str(b.units[k]), DumpJson.Num(b.position[k]))) }
  return listOf(Pair("dragonBackgroundImage", DumpJson.Obj(listOf(
    Pair("natural", DumpJson.Arr(b.natural.map { DumpJson.Num(it) })),
    Pair("decoded", DumpJson.Arr(listOf(DumpJson.Num(b.image.width.toDouble()), DumpJson.Num(b.image.height.toDouble())))),
    Pair("repeat", DumpJson.Arr(b.repeatNames.map { DumpJson.Str(it) })),
    Pair("position", DumpJson.Arr(position)),
    Pair("origin", DumpJson.Str(b.origin)),
    Pair("clip", DumpJson.Str(b.clip)),
  ))))
}
`;

/** The raster plant: every tile drawn 1 device px right of its place. */
export const BG_IMAGE_PLANT = {
  name: 'bg-image-offset-1',
  replace: {
    uikit: ['public let dragonBackgroundImagePlantDevicePx: Double = 0\n', 'public let dragonBackgroundImagePlantDevicePx: Double = 1\n'],
    'android-views': ['const val DRAGON_BACKGROUND_IMAGE_PLANT_DEVICE_PX = 0.0\n', 'const val DRAGON_BACKGROUND_IMAGE_PLANT_DEVICE_PX = 1.0\n'],
  },
} as const;
