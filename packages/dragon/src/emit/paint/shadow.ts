// box-shadow on the box view (T046 §1, N2): the case code writes the computed shadows through dragonSetShadows; after every layout
// the translated paint-shadow.ts rasters the outer shadows into a premultiplied bitmap shown by a companion view directly beneath
// the box (DragonTree.companion: the same host, the box's frame, the bitmap reaching outside it), clipped out of the border box, and
// the inset shadows into a bitmap the inset-shadow stage draws, clipped to the padding box. Both are the *Over layers: each shadow
// blitted onto the backdrop the box's DOM ancestors paint (and its own background, for inset) as Chrome blits it, then encoded as
// the pixel whose platform composite over that backdrop is Chrome's colour. The ancestors are the DOM chain, not the native views
// above the box: a box hosted out of its parent (a flex item in its root's foreground, PNT1 stacking) still paints above them. A
// background write re-applies the shadows of the box and of its DOM descendants with shadows, whose backdrop it changes. Layers change with implicit actions disabled; nothing animates.
import type { ShadowValue } from '../../lower/paint/shadow.ts';
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const num = (v: number): string => {
  if (!Number.isFinite(v)) throw new Error(`shadow value ${v} is not finite`);
  const n = String(v);
  return /[.eE]/.test(n) ? n : `${n}.0`;
};

const shadowLit = (s: ShadowValue): string => `ShadowInput(${s.inset ? 'true' : 'false'}, ${num(s.x)}, ${num(s.y)}, ${num(s.blur)}, ${num(s.spread)}, ${num(s.color.r)}, ${num(s.color.g)}, ${num(s.color.b)}, ${num(s.color.alpha)})`;

const SWIFT_MEMBERS = String.raw`  /// The computed shadows in list order (css px at zoom 1); empty for none.
  public var dragonShadows: [ShadowInput] = []
  /// The companion view beneath the box that shows the outer shadows, when the box has any.
  public var dragonShadowView: DragonShadowView? = nil
  /// The inset shadows as a premultiplied bitmap and its rect in the view's points, drawn at the inset-shadow stage.
  public var dragonInsetShadowImage: CGImage? = nil
  public var dragonInsetShadowRect: CGRect = .zero
  /// The tree the shadow write came from (the backdrop walks the DOM ancestors through it), and the DOM descendants with shadow
  /// writes, whose backdrop this box's background is part of.
  public weak var dragonShadowTree: DragonTree? = nil
  public var dragonShadowedDescendants: [DragonBoxView] = []
`;

const SWIFT = String.raw`import UIKit

/// Device px added to the outer shadow bitmap's x; 0 except in the shadow-offset-1 raster plant build.
public let dragonShadowPlantDevicePx: Double = 0

/// The companion view beneath a box: a bitmap sublayer, which reaches outside the view's bounds (the box's frame).
public final class DragonShadowView: UIView {
  public let bitmapLayer = CALayer()
  public init() {
    super.init(frame: .zero)
    isOpaque = false
    backgroundColor = nil
    clipsToBounds = false
    isUserInteractionEnabled = false
    bitmapLayer.magnificationFilter = .nearest
    bitmapLayer.minificationFilter = .nearest
    layer.addSublayer(bitmapLayer)
  }
  required init?(coder: NSCoder) { fatalError("DragonShadowView is built in code") }
}

/// The shadow write of a box (runtime writer): the shadows, a companion view for outer shadows (registered with the tree the
/// first time), then every after-layout hook re-applies the paint.
public func dragonSetShadows(_ t: DragonTree, _ v: DragonBoxView, _ shadows: [ShadowInput]) {
  v.dragonShadows = shadows
  if v.dragonShadowTree == nil {
    v.dragonShadowTree = t
    for a in dragonShadowAncestors(v) where !a.dragonShadowedDescendants.contains(where: { $0 === v }) { a.dragonShadowedDescendants.append(v) }
  }
  if v.dragonShadowView == nil && shadows.contains(where: { !$0.inset }) {
    let s = DragonShadowView()
    v.dragonShadowView = s
    t.companion(v.dragonId, s)
  }
  dragonAfterLayout(v, v.dragonShape, v.dragonScale)
  v.setNeedsDisplay()
}

/// A box's DOM ancestors, outermost first, through the tree of its shadow write.
public func dragonShadowAncestors(_ v: DragonBoxView) -> [DragonBoxView] {
  guard let t = v.dragonShadowTree else { fatalError("dragon: \(v.dragonId): a shadow backdrop without the tree of its shadow write") }
  var chain: [DragonBoxView] = []
  var id = v.dragonParent
  while let pid = id {
    guard let b = t.node(pid) as? DragonBoxView else { fatalError("dragon: \(v.dragonId): the DOM ancestor \(pid) is not a built box") }
    chain.insert(b, at: 0)
    id = b.dragonParent
  }
  return chain
}

/// The backdrop of a box's shadows: each DOM ancestor box's background over its (rounded) border box, outermost first, then the
/// box's own when own is set (the inset shadows); the white root is beneath.
public func dragonShadowBackdrop(_ v: DragonBoxView, own: Bool) -> [BackdropFill] {
  let chain = dragonShadowAncestors(v) + (own ? [v] : [])
  var out: [BackdropFill] = []
  for b in chain {
    let c = b.dragonBackgroundColor
    if c.a == 0 { continue }
    let e = b.dragonShape.edges
    out.append(BackdropFill(e[0], e[1], e[2], e[3], JsArray(b.dragonShape.radii), Double(c.r), Double(c.g), Double(c.b), Double(c.a)))
  }
  return out
}

/// After a background write: the shadows of the box and of every DOM descendant with shadows, whose backdrop the write changed.
public func dragonShadowBackdropChanged(_ v: DragonBoxView) {
  if !v.dragonShadows.isEmpty { dragonAfterLayoutShadow(v, v.dragonShape, v.dragonScale) }
  for b in v.dragonShadowedDescendants where !b.dragonShadows.isEmpty { dragonAfterLayoutShadow(b, b.dragonShape, b.dragonScale) }
}

/// A premultiplied sRGB RGBA8 image from a paint-shadow.ts layer, or nil for an empty one.
public func dragonShadowImage(_ rgba: [Double], _ w: Int, _ h: Int) -> CGImage? {
  if w <= 0 || h <= 0 { return nil }
  if rgba.count != w * h * 4 { fatalError("dragon: a shadow layer of \(rgba.count) values is not \(w)x\(h) RGBA") }
  var bytes = [UInt8](repeating: 0, count: rgba.count)
  for i in 0..<rgba.count {
    let c = rgba[i]
    if !(c >= 0 && c <= 255) || c.rounded(.towardZero) != c { fatalError("dragon: shadow channel \(c) is not a byte") }
    bytes[i] = UInt8(c)
  }
  guard let space = CGColorSpace(name: CGColorSpace.sRGB), let provider = CGDataProvider(data: Data(bytes) as CFData) else { fatalError("dragon: no sRGB space or data provider for a shadow") }
  return CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4, space: space, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
}

/// After every layout: the outer shadow bitmap on the companion view (in its points, relative to the box's frame) and the inset
/// shadow bitmap for the inset-shadow stage, both from the translated paint-shadow.ts at the device scale.
public func dragonAfterLayoutShadow(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  if v.dragonShadows.isEmpty { return }
  // The radius module set this layout's radii on the stored shape.
  let sh = v.dragonShape
  let e = sh.edges
  let inner = dragonRadiusShape(v, sh).map { Array($0[8..<16]) } ?? [0, 0, 0, 0, 0, 0, 0, 0]
  let opaque = v.dragonBackgroundColor.a == 255
  let cg = CGFloat(scale)
  do {
    let outer = try paintShadow_outerShadowLayerOver(e[0], e[1], e[2], e[3], JsArray(sh.radii), opaque, JsArray(v.dragonShadows), scale, ShadowFaults(false, false, false), JsArray(dragonShadowBackdrop(v, own: false)))
    let inset = try paintShadow_insetShadowLayerOver(e[0], e[1], e[2], e[3], JsArray(sh.borders), JsArray(inner), JsArray(v.dragonShadows), scale, ShadowFaults(false, false, false), JsArray(dragonShadowBackdrop(v, own: true)))
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if let s = v.dragonShadowView {
      let w = dragonCheckedInt(outer.right - outer.left, "\(v.dragonId) shadow width")
      let h = dragonCheckedInt(outer.bottom - outer.top, "\(v.dragonId) shadow height")
      s.bitmapLayer.contents = dragonShadowImage(outer.rgba.items, w, h)
      s.bitmapLayer.frame = CGRect(x: CGFloat(outer.left - e[0] + dragonShadowPlantDevicePx) / cg, y: CGFloat(outer.top - e[1]) / cg, width: CGFloat(w) / cg, height: CGFloat(h) / cg)
    }
    CATransaction.commit()
    let iw = dragonCheckedInt(inset.right - inset.left, "\(v.dragonId) inset width")
    let ih = dragonCheckedInt(inset.bottom - inset.top, "\(v.dragonId) inset height")
    v.dragonInsetShadowImage = dragonShadowImage(inset.rgba.items, iw, ih)
    v.dragonInsetShadowRect = CGRect(x: CGFloat(inset.left - e[0]) / cg, y: CGFloat(inset.top - e[1]) / cg, width: CGFloat(iw) / cg, height: CGFloat(ih) / cg)
  } catch {
    fatalError("dragon: \(v.dragonId): paint-shadow failed: \(error)")
  }
  v.setNeedsDisplay()
}

/// The inset-shadow stage: the inset shadow bitmap over the padding box.
public func dragonPaintInsetShadowStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  guard let img = v.dragonInsetShadowImage else { return }
  UIImage(cgImage: img).draw(in: v.dragonInsetShadowRect)
}

/// The readback of the shadow module: each shadow as [inset, x, y, blur, spread, r, g, b, a].
public func dragonAppliedShadow(_ v: DragonBoxView) -> DumpJsonObject {
  if v.dragonShadows.isEmpty { return [] }
  return [("dragonShadow.shadows", .array(v.dragonShadows.map { s in .array([s.inset ? 1 : 0, s.x, s.y, s.blur, s.spread, s.r, s.g, s.b, s.a].map { .number($0) }) }))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The computed shadows in list order (css px at zoom 1); empty for none. */
  var dragonShadows: Array<dev.dragon.layout.ShadowInput> = emptyArray()
  /** The companion view beneath the box that shows the outer shadows, when the box has any. */
  var dragonShadowView: DragonShadowView? = null
  /** The inset shadows as a premultiplied bitmap at its device-px offset in the view, drawn at the inset-shadow stage. */
  var dragonInsetShadowBitmap: android.graphics.Bitmap? = null
  var dragonInsetShadowOffset = intArrayOf(0, 0)
  /** The device scale of the last layout. */
  var dragonShadowScale = 1.0
  /**
   * The tree the shadow write came from (the backdrop walks the DOM ancestors through it), and the DOM descendants with shadow
   * writes, whose backdrop this box's background is part of.
   */
  var dragonShadowTree: DragonTree? = null
  val dragonShadowedDescendants = ArrayList<DragonBoxView>()
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import dev.dragon.dump.DumpJson
import dev.dragon.layout.BackdropFill
import dev.dragon.layout.JsArray
import dev.dragon.layout.ShadowFaults
import dev.dragon.layout.ShadowInput
import dev.dragon.layout.paintShadow_insetShadowLayerOver
import dev.dragon.layout.paintShadow_outerShadowLayerOver
import java.nio.ByteBuffer

/** Device px added to the outer shadow bitmap's x; 0 except in the shadow-offset-1 raster plant build. */
const val DRAGON_SHADOW_PLANT_DEVICE_PX = 0

/** The companion view beneath a box: it draws its bitmap at a device-px offset, reaching outside its bounds. */
class DragonShadowView(ctx: Context) : DragonGroup(ctx) {
  var bitmap: Bitmap? = null
  var dx = 0
  var dy = 0
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val b = bitmap ?: return
    canvas.drawBitmap(b, dx.toFloat(), dy.toFloat(), null)
  }
}

/**
 * The shadow write of a box (runtime writer): the shadows, a companion view for outer shadows (registered with the tree the
 * first time), then every after-layout hook re-applies the paint.
 */
fun dragonSetShadows(t: DragonTree, v: DragonBoxView, shadows: Array<ShadowInput>) {
  v.dragonShadows = shadows
  if (v.dragonShadowTree == null) {
    v.dragonShadowTree = t
    for (a in dragonShadowAncestors(v)) if (a.dragonShadowedDescendants.none { it === v }) a.dragonShadowedDescendants.add(v)
  }
  if (v.dragonShadowView == null && shadows.any { !it.inset }) {
    val s = DragonShadowView(v.context)
    v.dragonShadowView = s
    t.companion(v.dragonId, s)
  }
  dragonAfterLayout(v, v.dragonShape, v.dragonShadowScale)
  v.invalidate()
}

/** A box's DOM ancestors, outermost first, through the tree of its shadow write. */
fun dragonShadowAncestors(v: DragonBoxView): List<DragonBoxView> {
  val t = v.dragonShadowTree ?: throw IllegalStateException("dragon: " + v.dragonId + ": a shadow backdrop without the tree of its shadow write")
  val chain = ArrayList<DragonBoxView>()
  var id = v.dragonParent
  while (id != null) {
    val b = t.node(id) as? DragonBoxView ?: throw IllegalStateException("dragon: " + v.dragonId + ": the DOM ancestor " + id + " is not a built box")
    chain.add(0, b)
    id = b.dragonParent
  }
  return chain
}

/**
 * The backdrop of a box's shadows: each DOM ancestor box's background over its (rounded) border box, outermost first, then the
 * box's own when own is set (the inset shadows); the white root is beneath.
 */
fun dragonShadowBackdrop(v: DragonBoxView, own: Boolean): MutableList<BackdropFill> {
  val chain = ArrayList<DragonBoxView>(dragonShadowAncestors(v))
  if (own) chain.add(v)
  val out = ArrayList<BackdropFill>()
  for (b in chain) {
    val c = b.dragonBackgroundColor
    if (c.a == 0) continue
    val e = b.dragonShape.edges
    out.add(BackdropFill(e[0], e[1], e[2], e[3], JsArray(b.dragonShape.radii.toMutableList()), c.r.toDouble(), c.g.toDouble(), c.b.toDouble(), c.a.toDouble()))
  }
  return out
}

/** After a background write: the shadows of the box and of every DOM descendant with shadows, whose backdrop the write changed. */
fun dragonShadowBackdropChanged(v: DragonBoxView) {
  if (v.dragonShadows.isNotEmpty()) dragonAfterLayoutShadow(v, v.dragonShape, v.dragonShadowScale)
  for (b in v.dragonShadowedDescendants) if (b.dragonShadows.isNotEmpty()) dragonAfterLayoutShadow(b, b.dragonShape, b.dragonShadowScale)
}

/** A premultiplied RGBA8 bitmap from a paint-shadow.ts layer, or null for an empty one. */
fun dragonShadowBitmap(rgba: List<Double>, w: Int, h: Int): Bitmap? {
  if (w <= 0 || h <= 0) return null
  if (rgba.size != w * h * 4) throw IllegalStateException("dragon: a shadow layer of " + rgba.size + " values is not " + w + "x" + h + " RGBA")
  val bytes = ByteArray(rgba.size)
  for (i in rgba.indices) {
    val c = rgba[i]
    if (!(c >= 0.0 && c <= 255.0) || kotlin.math.truncate(c) != c) throw IllegalStateException("dragon: shadow channel " + c + " is not a byte")
    bytes[i] = c.toInt().toByte()
  }
  val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
  b.copyPixelsFromBuffer(ByteBuffer.wrap(bytes))
  return b
}

/**
 * After every layout: the outer shadow bitmap on the companion view (at its device-px offset from the box's frame) and the inset
 * shadow bitmap for the inset-shadow stage, both from the translated paint-shadow.ts at the device scale.
 */
fun dragonAfterLayoutShadow(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  if (v.dragonShadows.isEmpty()) return
  v.dragonShadowScale = scale
  val e = shape.edges
  val r = dragonRadiusShape(v, shape)
  val inner = if (r == null) DoubleArray(8) else r.copyOfRange(8, 16)
  val opaque = v.dragonBackgroundColor.a == 255
  val faults = ShadowFaults(false, false, false)
  val outer = paintShadow_outerShadowLayerOver(e[0], e[1], e[2], e[3], JsArray(shape.radii.toMutableList()), opaque, JsArray(v.dragonShadows.toMutableList()), scale, faults, JsArray(dragonShadowBackdrop(v, false)))
  val inset = paintShadow_insetShadowLayerOver(e[0], e[1], e[2], e[3], JsArray(shape.borders.toMutableList()), JsArray(inner.toMutableList()), JsArray(v.dragonShadows.toMutableList()), scale, faults, JsArray(dragonShadowBackdrop(v, true)))
  val s = v.dragonShadowView
  if (s != null) {
    s.bitmap = dragonShadowBitmap(outer.rgba, dragonCheckedInt(outer.right - outer.left, v.dragonId + " shadow width"), dragonCheckedInt(outer.bottom - outer.top, v.dragonId + " shadow height"))
    s.dx = dragonCheckedInt(outer.left - e[0], v.dragonId + " shadow x") + DRAGON_SHADOW_PLANT_DEVICE_PX
    s.dy = dragonCheckedInt(outer.top - e[1], v.dragonId + " shadow y")
    s.invalidate()
  }
  v.dragonInsetShadowBitmap = dragonShadowBitmap(inset.rgba, dragonCheckedInt(inset.right - inset.left, v.dragonId + " inset width"), dragonCheckedInt(inset.bottom - inset.top, v.dragonId + " inset height"))
  v.dragonInsetShadowOffset = intArrayOf(dragonCheckedInt(inset.left - e[0], v.dragonId + " inset x"), dragonCheckedInt(inset.top - e[1], v.dragonId + " inset y"))
  v.invalidate()
}

/** The inset-shadow stage: the inset shadow bitmap over the padding box. */
fun dragonPaintInsetShadowStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  val b = v.dragonInsetShadowBitmap ?: return
  canvas.drawBitmap(b, v.dragonInsetShadowOffset[0].toFloat(), v.dragonInsetShadowOffset[1].toFloat(), null)
}

/** The readback of the shadow module: each shadow as [inset, x, y, blur, spread, r, g, b, a]. */
fun dragonAppliedShadow(v: DragonBoxView): List<Pair<String, DumpJson>> {
  if (v.dragonShadows.isEmpty()) return emptyList()
  return listOf(Pair("dragonShadow.shadows", DumpJson.Arr(v.dragonShadows.map { s -> DumpJson.Arr(listOf(if (s.inset) 1.0 else 0.0, s.x, s.y, s.blur, s.spread, s.r, s.g, s.b, s.a).map { DumpJson.Num(it) }) })))
}
`;

export const SHADOW_EMITTER: PaintEmitter<'box-shadow'> = {
  name: 'shadow',
  kinds: ['box-shadow'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetShadows(t, ${v}, [${w.shadows.map(shadowLit).join(', ')}])`],
    'android-views': (v, _n, w) => [`  dragonSetShadows(t, ${v}, arrayOf(${w.shadows.map(shadowLit).join(', ')}))`],
  },
  applied: (_e, _b, w) => w.shadows.map((s) => [s.inset ? 1 : 0, s.x, s.y, s.blur, s.spread, s.color.r, s.color.g, s.color.b, s.color.alpha]),
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, stages: { 'inset-shadow': 'dragonPaintInsetShadowStage' }, afterLayout: 'dragonAfterLayoutShadow', applied: 'dragonAppliedShadow' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, stages: { 'inset-shadow': 'dragonPaintInsetShadowStage' }, afterLayout: 'dragonAfterLayoutShadow', applied: 'dragonAppliedShadow' },
  },
  plants: [
    {
      name: 'shadow-offset-1',
      replace: {
        uikit: ['public let dragonShadowPlantDevicePx: Double = 0\n', 'public let dragonShadowPlantDevicePx: Double = 1\n'],
        'android-views': ['const val DRAGON_SHADOW_PLANT_DEVICE_PX = 0\n', 'const val DRAGON_SHADOW_PLANT_DEVICE_PX = 1\n'],
      },
    },
  ],
};
