// opacity on the box view (T046 §1): the case code writes the computed opacity through dragonSetOpacity, which takes Chrome's
// paint alpha byte from it with the translated paint.ts opacityAlpha8 and sets UIView.alpha or View.setAlpha to byte / 255; both
// platforms composite the view's subtree as a group. The readback is the live
// alpha, a float32 on both (CALayer.opacity backs UIView.alpha; View alpha is a Float).
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const opacityLit = (v: number): string => {
  if (!Number.isFinite(v) || v < 0 || v >= 1) throw new Error(`opacity ${v} is not in [0, 1)`);
  const n = String(v);
  return /[.eE]/.test(n) ? n.replace(/e\+?/, 'E') : `${n}.0`;
};

const SWIFT_MEMBERS = String.raw`  /// Chrome's paint alpha byte of the box's opacity; 255 is opaque.
  public var dragonAlpha8: Int = 255
`;

const SWIFT = String.raw`import UIKit

/// Whether the opacity writer ignores the alpha; false except in the alpha-ignored plant build.
public let dragonAlphaPlantIgnored = false

/// The opacity write of a box (runtime writer): the computed opacity, shown as UIView.alpha = Chrome's alpha byte / 255 (group
/// opacity).
public func dragonSetOpacity(_ v: DragonBoxView, _ opacity: Double) {
  if !(opacity >= 0 && opacity <= 1) { fatalError("dragon: \(v.dragonId): opacity \(opacity) is not in [0, 1]") }
  let raw: Double
  do { raw = try paint_opacityAlpha8(opacity) } catch { fatalError("dragon: \(v.dragonId): paint_opacityAlpha8 failed: \(error)") }
  let alpha8 = dragonCheckedInt(raw, "\(v.dragonId) alpha byte")
  v.dragonAlpha8 = alpha8
  if dragonAlphaPlantIgnored { return }
  v.alpha = CGFloat(Double(alpha8) / 255)
}

/// The readback of the effects module: the live alpha, when the box has an opacity below 1.
public func dragonAppliedEffects(_ v: DragonBoxView) -> DumpJsonObject {
  if v.dragonAlpha8 == 255 { return [] }
  return [("alpha", .number(Double(v.alpha)))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** Chrome's paint alpha byte of the box's opacity; 255 is opaque. */
  var dragonAlpha8 = 255
`;

const KOTLIN = String.raw`package dev.dragon.views

import dev.dragon.dump.DumpJson
import dev.dragon.layout.paint_opacityAlpha8

/** Whether the opacity writer ignores the alpha; false except in the alpha-ignored plant build. */
const val DRAGON_ALPHA_PLANT_IGNORED = false

/** The opacity write of a box (runtime writer): the computed opacity, shown as View.setAlpha(Chrome's alpha byte / 255f) (group opacity). */
fun dragonSetOpacity(v: DragonBoxView, opacity: Double) {
  if (!(opacity >= 0.0 && opacity <= 1.0)) throw IllegalStateException("dragon: " + v.dragonId + ": opacity " + opacity + " is not in [0, 1]")
  val alpha8 = dragonCheckedInt(paint_opacityAlpha8(opacity), v.dragonId + " alpha byte")
  v.dragonAlpha8 = alpha8
  if (DRAGON_ALPHA_PLANT_IGNORED) return
  v.alpha = alpha8 / 255f
}

/** The readback of the effects module: the live alpha, when the box has an opacity below 1. */
fun dragonAppliedEffects(v: DragonBoxView): List<Pair<String, DumpJson>> {
  if (v.dragonAlpha8 == 255) return emptyList()
  return listOf(Pair("alpha", DumpJson.Num(v.alpha.toDouble())))
}
`;

export const EFFECTS_EMITTER: PaintEmitter<'opacity'> = {
  name: 'effects',
  kinds: ['opacity'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetOpacity(${v}, ${opacityLit(w.opacity)})`],
    'android-views': (v, _n, w) => [`  dragonSetOpacity(${v}, ${opacityLit(w.opacity)})`],
  },
  // Both read back a float32: UIView.alpha is backed by CALayer.opacity (a Float), and Android's View alpha is a Float.
  applied: (e, _b, w) => e.float32(e.paint.opacityAlpha8(w.opacity) / 255),
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, applied: 'dragonAppliedEffects' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, applied: 'dragonAppliedEffects' },
  },
  plants: [
    {
      name: 'alpha-ignored',
      replace: {
        uikit: ['public let dragonAlphaPlantIgnored = false\n', 'public let dragonAlphaPlantIgnored = true\n'],
        'android-views': ['const val DRAGON_ALPHA_PLANT_IGNORED = false\n', 'const val DRAGON_ALPHA_PLANT_IGNORED = true\n'],
      },
    },
  ],
};
