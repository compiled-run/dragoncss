// background-color on the box view: UIView.backgroundColor on UIKit, a ColorDrawable on Android Views (both fill the border box).
// A box the radius module rounds paints its background colour itself instead, inside the rounded border box (the background
// stage), and its native background is off; the readback then reports the colour it paints. PNT1-opacity-b: a folded fill (a
// fractional opacity folded into a translucent fill, lower/paint/background.ts) is drawn at the background stage as an opaque
// image of Chrome's bytes, the translated paint-shadow.ts backdropAt at every device pixel over the ancestors' backgrounds (the
// shadow module's backdrop) and the fill itself, since the platform's own blend of the colour rounds unlike Skia's blit.
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT, rgbaLit } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// The background colour the case or a runtime write set; painted natively unless the box is rounded.
  public var dragonBackgroundColor = DragonRGBA8(0, 0, 0, 0)
  /// Whether the colour is a folded fill (PNT1-opacity-b), drawn as Chrome's opaque bytes over the backdrop.
  public var dragonBackgroundFolded = false
  /// The folded fill's opaque pixels over the border box at the device scale, drawn at the background stage.
  public var dragonFoldedImage: CGImage? = nil
`;

const SWIFT = String.raw`import UIKit

/// The background write of a box (runtime writer): the colour, then the native-or-rounded choice for the current shape, then the
/// shadows whose backdrop it is (the shadow module).
public func dragonBackground(_ v: DragonBoxView, _ c: DragonRGBA8, folded: Bool = false) {
  v.dragonBackgroundColor = c
  v.dragonBackgroundFolded = folded
  dragonSyncBackground(v)
  dragonShadowBackdropChanged(v)
}

/// A square box keeps UIView.backgroundColor; a rounded box turns it off and the background stage fills the rounded border box. A
/// box that is not visible (T150a) shows neither, unless its background is the canvas's, which shows square. A visible square
/// folded fill turns it off too, and the background stage draws its opaque image.
public func dragonSyncBackground(_ v: DragonBoxView) {
  v.dragonFoldedImage = nil
  if v.dragonVisible ? dragonRoundedPath(v, v.dragonShape, inner: false) == nil : v.dragonVisibilityCanvas {
    if v.dragonBackgroundFolded && v.dragonVisible {
      v.backgroundColor = nil
      v.dragonFoldedImage = dragonFoldedFill(v)
    } else {
      v.backgroundColor = dragonUIColor(v.dragonBackgroundColor)
    }
  } else {
    v.backgroundColor = nil
  }
  v.setNeedsDisplay()
}

/// PNT1-opacity-b: a folded fill as an opaque sRGB image of the snapped border box, each device pixel the translated
/// paint-shadow.ts backdropAt over the ancestors' backgrounds and the box's own fill (Skia's blit_row_color32 bytes).
public func dragonFoldedFill(_ v: DragonBoxView) -> CGImage? {
  let e = v.dragonShape.edges
  let w = dragonCheckedInt(e[2] - e[0], "\(v.dragonId) folded fill width")
  let h = dragonCheckedInt(e[3] - e[1], "\(v.dragonId) folded fill height")
  if w <= 0 || h <= 0 { return nil }
  let fills = JsArray(dragonShadowBackdrop(v, own: true))
  var rgba: [Double] = []
  rgba.reserveCapacity(w * h * 4)
  do {
    for y in 0..<h {
      for x in 0..<w {
        let c = try paintShadow_backdropAt(fills, e[0] + Double(x), e[1] + Double(y))
        rgba.append(contentsOf: c.items)
        rgba.append(255)
      }
    }
  } catch {
    fatalError("dragon: \(v.dragonId): paint-shadow backdropAt failed: \(error)")
  }
  return dragonShadowImage(rgba, w, h)
}

/// The background stage: the rounded border box filled with the background colour (a square box's is UIKit's backgroundColor).
public func dragonPaintBackgroundStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
  if let img = v.dragonFoldedImage {
    let cg = CGFloat(v.dragonScale)
    UIImage(cgImage: img).draw(in: CGRect(x: 0, y: 0, width: CGFloat(img.width) / cg, height: CGFloat(img.height) / cg))
    return
  }
  if v.backgroundColor != nil || v.dragonBackgroundColor.a == 0 { return }
  guard let p = dragonRoundedPath(v, shape, inner: false) else { return }
  ctx.saveGState()
  ctx.addPath(p)
  ctx.setFillColor(dragonUIColor(v.dragonBackgroundColor).cgColor)
  ctx.fillPath()
  ctx.restoreGState()
}

/// After every layout: the native-or-rounded choice for the new shape.
public func dragonAfterLayoutBackground(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  dragonSyncBackground(v)
}

/// The readback of the background module: the live backgroundColor as sRGB RGBA8, or the colour a rounded box or a folded fill paints.
public func dragonAppliedBackground(_ v: DragonBoxView) -> DumpJsonObject {
  if v.backgroundColor == nil && (v.dragonBackgroundFolded || !v.dragonVisible || dragonRoundedPath(v, v.dragonShape, inner: false) != nil) { return [("backgroundColor", dragonRGBAJson(v.dragonBackgroundColor))] }
  return [("backgroundColor", dragonColorJson(v.backgroundColor))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The background colour the case or a runtime write set; painted natively unless the box is rounded. */
  var dragonBackgroundColor = DragonRGBA8(0, 0, 0, 0)
  /** Whether the colour is a folded fill (PNT1-opacity-b), drawn as Chrome's opaque bytes over the backdrop. */
  var dragonBackgroundFolded = false
  /** The folded fill's opaque pixels over the border box in device px, drawn at the background stage. */
  var dragonFoldedBitmap: android.graphics.Bitmap? = null
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.drawable.ColorDrawable
import dev.dragon.dump.DumpJson
import dev.dragon.layout.JsArray
import dev.dragon.layout.paintShadow_backdropAt

/**
 * The background write of a box (runtime writer): the colour, then the native-or-rounded choice for the current shape, then the
 * shadows whose backdrop it is (the shadow module).
 */
fun dragonBackground(v: DragonBoxView, c: DragonRGBA8, folded: Boolean = false) {
  v.dragonBackgroundColor = c
  v.dragonBackgroundFolded = folded
  dragonSyncBackground(v)
  dragonShadowBackdropChanged(v)
}

/**
 * A square box keeps a native ColorDrawable; a rounded box turns it off and the background stage fills the rounded border box. A box
 * that is not visible (T150a) shows neither, unless its background is the canvas's, which shows square. A visible square folded
 * fill has none either, and the background stage draws its opaque bitmap.
 */
fun dragonSyncBackground(v: DragonBoxView) {
  v.dragonFoldedBitmap = null
  val square = if (v.dragonVisible) dragonRoundedPath(v, v.dragonShape, false) == null else v.dragonVisibilityCanvas
  if (square && v.dragonBackgroundFolded && v.dragonVisible) {
    v.background = null
    v.dragonFoldedBitmap = dragonFoldedFill(v)
  } else {
    v.background = if (square) ColorDrawable(dragonArgb(v.dragonBackgroundColor)) else null
  }
  v.invalidate()
}

/**
 * PNT1-opacity-b: a folded fill as an opaque bitmap of the snapped border box, each device pixel the translated paint-shadow.ts
 * backdropAt over the ancestors' backgrounds and the box's own fill (Skia's blit_row_color32 bytes).
 */
fun dragonFoldedFill(v: DragonBoxView): Bitmap? {
  val e = v.dragonShape.edges
  val w = dragonCheckedInt(e[2] - e[0], v.dragonId + " folded fill width")
  val h = dragonCheckedInt(e[3] - e[1], v.dragonId + " folded fill height")
  if (w <= 0 || h <= 0) return null
  val fills = JsArray(dragonShadowBackdrop(v, true))
  val rgba = ArrayList<Double>(w * h * 4)
  for (y in 0 until h) {
    for (x in 0 until w) {
      rgba.addAll(paintShadow_backdropAt(fills, e[0] + x, e[1] + y))
      rgba.add(255.0)
    }
  }
  return dragonShadowBitmap(rgba, w, h)
}

/** The background stage: the rounded border box filled with the background colour (a square box's is its ColorDrawable). */
fun dragonPaintBackgroundStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
  val folded = v.dragonFoldedBitmap
  if (folded != null) {
    canvas.drawBitmap(folded, 0f, 0f, null)
    return
  }
  if (v.background != null || v.dragonBackgroundColor.a == 0) return
  val p = dragonRoundedPath(v, shape, false) ?: return
  val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  paint.style = Paint.Style.FILL
  paint.color = dragonArgb(v.dragonBackgroundColor)
  canvas.drawPath(p, paint)
}

/** After every layout: the native-or-rounded choice for the new shape. */
fun dragonAfterLayoutBackground(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  dragonSyncBackground(v)
}

/** The readback of the background module: the live ColorDrawable colour, or the colour a rounded box or a folded fill paints. */
fun dragonAppliedBackground(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val bg = v.background
  if (bg == null && (v.dragonBackgroundFolded || !v.dragonVisible || dragonRoundedPath(v, v.dragonShape, false) != null)) return listOf(Pair("background.color", dragonRGBAJson(v.dragonBackgroundColor)))
  return listOf(Pair("background.color", if (bg is ColorDrawable) dragonColorJson(bg.color) else DumpJson.Null))
}
`;

export const BACKGROUND_EMITTER: PaintEmitter<'background-color'> = {
  name: 'background',
  kinds: ['background-color'],
  lines: {
    uikit: (v, _n, w) => [`  dragonBackground(${v}, ${rgbaLit(w.color)}${w.folded === true ? ', folded: true' : ''})`],
    'android-views': (v, _n, w) => [`  dragonBackground(${v}, ${rgbaLit(w.color)}${w.folded === true ? ', folded = true' : ''})`],
  },
  applied: (_e, _b, w) => [w.color.r, w.color.g, w.color.b, w.color.alpha],
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, stages: { background: 'dragonPaintBackgroundStage' }, afterLayout: 'dragonAfterLayoutBackground', applied: 'dragonAppliedBackground' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, stages: { background: 'dragonPaintBackgroundStage' }, afterLayout: 'dragonAfterLayoutBackground', applied: 'dragonAppliedBackground' },
  },
  plants: [],
};
