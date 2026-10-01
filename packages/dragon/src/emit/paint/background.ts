// background-color on the box view: UIView.backgroundColor on UIKit, a ColorDrawable on Android Views (both fill the border box).
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT, rgbaLit } from './types.ts';

const SWIFT = String.raw`import UIKit

/// The readback of the background module: the live backgroundColor as sRGB RGBA8.
public func dragonAppliedBackground(_ v: DragonBoxView) -> DumpJsonObject {
  return [("backgroundColor", dragonColorJson(v.backgroundColor))]
}
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.graphics.drawable.ColorDrawable
import dev.dragon.dump.DumpJson

/** The background write of a box: a native ColorDrawable. */
fun dragonBackground(v: DragonBoxView, c: DragonRGBA8) {
  v.background = ColorDrawable(dragonArgb(c))
}

/** The readback of the background module: the live ColorDrawable colour. */
fun dragonAppliedBackground(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val bg = v.background
  return listOf(Pair("background.color", if (bg is ColorDrawable) dragonColorJson(bg.color) else DumpJson.Null))
}
`;

export const BACKGROUND_EMITTER: PaintEmitter<'background-color'> = {
  name: 'background',
  kinds: ['background-color'],
  lines: {
    uikit: (v, _n, w) => [`  ${v}.backgroundColor = dragonUIColor(${rgbaLit(w.color)})`],
    'android-views': (v, _n, w) => [`  dragonBackground(${v}, ${rgbaLit(w.color)})`],
  },
  applied: (_e, _b, w) => [w.color.r, w.color.g, w.color.b, w.color.alpha],
  native: {
    uikit: { ...NO_NATIVE_PAINT, file: SWIFT, applied: 'dragonAppliedBackground' },
    'android-views': { ...NO_NATIVE_PAINT, file: KOTLIN, applied: 'dragonAppliedBackground' },
  },
  plants: [],
};
