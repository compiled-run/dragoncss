// background-color on the box view: UIView.backgroundColor on UIKit, a ColorDrawable on Android Views (both fill the border box).
// A box the radius module rounds paints its background colour itself instead, inside the rounded border box (the background
// stage), and its native background is off; the readback then reports the colour it paints.
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT, rgbaLit } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// The background colour the case or a runtime write set; painted natively unless the box is rounded.
  public var dragonBackgroundColor = DragonRGBA8(0, 0, 0, 0)
`;

const SWIFT = String.raw`import UIKit

/// The background write of a box (runtime writer): the colour, then the native-or-rounded choice for the current shape, then the
/// shadows whose backdrop it is (the shadow module).
public func dragonBackground(_ v: DragonBoxView, _ c: DragonRGBA8) {
  v.dragonBackgroundColor = c
  dragonSyncBackground(v)
  dragonShadowBackdropChanged(v)
}

/// A square box keeps UIView.backgroundColor; a rounded box turns it off and the background stage fills the rounded border box. A
/// box that is not visible (T150a) shows neither, unless its background is the canvas's, which shows square.
public func dragonSyncBackground(_ v: DragonBoxView) {
  if v.dragonVisible ? dragonRoundedPath(v, v.dragonShape, inner: false) == nil : v.dragonVisibilityCanvas {
    v.backgroundColor = dragonUIColor(v.dragonBackgroundColor)
  } else {
    v.backgroundColor = nil
  }
  v.setNeedsDisplay()
}

/// The background stage: the rounded border box filled with the background colour (a square box's is UIKit's backgroundColor).
public func dragonPaintBackgroundStage(_ v: DragonBoxView, _ ctx: CGContext, _ shape: DragonBoxShape) {
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

/// The readback of the background module: the live backgroundColor as sRGB RGBA8, or the colour a rounded box paints.
public func dragonAppliedBackground(_ v: DragonBoxView) -> DumpJsonObject {
  if v.backgroundColor == nil && (!v.dragonVisible || dragonRoundedPath(v, v.dragonShape, inner: false) != nil) { return [("backgroundColor", dragonRGBAJson(v.dragonBackgroundColor))] }
  return [("backgroundColor", dragonColorJson(v.backgroundColor))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The background colour the case or a runtime write set; painted natively unless the box is rounded. */
  var dragonBackgroundColor = DragonRGBA8(0, 0, 0, 0)
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.drawable.ColorDrawable
import dev.dragon.dump.DumpJson

/**
 * The background write of a box (runtime writer): the colour, then the native-or-rounded choice for the current shape, then the
 * shadows whose backdrop it is (the shadow module).
 */
fun dragonBackground(v: DragonBoxView, c: DragonRGBA8) {
  v.dragonBackgroundColor = c
  dragonSyncBackground(v)
  dragonShadowBackdropChanged(v)
}

/**
 * A square box keeps a native ColorDrawable; a rounded box turns it off and the background stage fills the rounded border box. A box
 * that is not visible (T150a) shows neither, unless its background is the canvas's, which shows square.
 */
fun dragonSyncBackground(v: DragonBoxView) {
  v.background = if (if (v.dragonVisible) dragonRoundedPath(v, v.dragonShape, false) == null else v.dragonVisibilityCanvas) ColorDrawable(dragonArgb(v.dragonBackgroundColor)) else null
  v.invalidate()
}

/** The background stage: the rounded border box filled with the background colour (a square box's is its ColorDrawable). */
fun dragonPaintBackgroundStage(v: DragonBoxView, canvas: Canvas, shape: DragonBoxShape) {
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

/** The readback of the background module: the live ColorDrawable colour, or the colour a rounded box paints. */
fun dragonAppliedBackground(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val bg = v.background
  if (bg == null && (!v.dragonVisible || dragonRoundedPath(v, v.dragonShape, false) != null)) return listOf(Pair("background.color", dragonRGBAJson(v.dragonBackgroundColor)))
  return listOf(Pair("background.color", if (bg is ColorDrawable) dragonColorJson(bg.color) else DumpJson.Null))
}
`;

export const BACKGROUND_EMITTER: PaintEmitter<'background-color'> = {
  name: 'background',
  kinds: ['background-color'],
  lines: {
    uikit: (v, _n, w) => [`  dragonBackground(${v}, ${rgbaLit(w.color)})`],
    'android-views': (v, _n, w) => [`  dragonBackground(${v}, ${rgbaLit(w.color)})`],
  },
  applied: (_e, _b, w) => [w.color.r, w.color.g, w.color.b, w.color.alpha],
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, stages: { background: 'dragonPaintBackgroundStage' }, afterLayout: 'dragonAfterLayoutBackground', applied: 'dragonAppliedBackground' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, stages: { background: 'dragonPaintBackgroundStage' }, afterLayout: 'dragonAfterLayoutBackground', applied: 'dragonAppliedBackground' },
  },
  plants: [],
};
