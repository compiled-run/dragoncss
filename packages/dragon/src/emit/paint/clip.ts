// css-overflow-3 §3: overflow hidden hosts the box's children in a Dragon clip view over its padding box (the container factory
// makes it; the after-layout hook sets its frame from the engine's border widths at the device scale).
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const SWIFT_MEMBERS = String.raw`  public private(set) var dragonClipView: DragonClipView? = nil
  /// Overflow hidden: the children are hosted by a clip view over the padding box.
  public func dragonEnableClip() {
    let c = dragonMakeContainer()
    addSubview(c)
    dragonClipView = c
  }
`;

const SWIFT = String.raw`import UIKit

/// After every layout: the clip view over the padding box, in points relative to the box.
public func dragonAfterLayoutClip(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let c = v.dragonClipView else { return }
  let e = shape.edges
  let px = shape.borders
  let cg = CGFloat(scale)
  c.frame = CGRect(x: CGFloat(px[3]) / cg, y: CGFloat(px[0]) / cg, width: CGFloat(e[2] - e[0] - px[3] - px[1]) / cg, height: CGFloat(e[3] - e[1] - px[0] - px[2]) / cg)
}

/// The readback of the clip module: the clip frame in whole device px / scale, or null when it does not clip.
public func dragonAppliedClip(_ v: DragonBoxView) -> DumpJsonObject {
  guard let c = v.dragonClipView else { return [] }
  let s = v.dragonScale
  return [("dragonClip.frame", c.clipsToBounds ? .array([c.frame.minX, c.frame.minY, c.frame.width, c.frame.height].map { .number(dragonWholeDevicePx(Double($0) * s, "\(v.dragonId) clip") / s) }) : .null)]
}
`;

const KOTLIN_MEMBERS = String.raw`  var dragonClipView: DragonClipView? = null
    private set
  /** Overflow hidden: the children are hosted by a clip view over the padding box. */
  fun dragonEnableClip() {
    val c = dragonMakeContainer(context)
    addView(c)
    dragonClipView = c
  }
`;

const KOTLIN = String.raw`package dev.dragon.views

import dev.dragon.dump.DumpJson

/** After every layout: the clip view over the padding box, in device px relative to the box. */
fun dragonAfterLayoutClip(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val c = v.dragonClipView ?: return
  val e = shape.edges
  val px = shape.borders
  dragonSetFrame(c.dragonFrame, px[3], px[0], e[2] - e[0] - px[1], e[3] - e[1] - px[2], v.dragonId + " clip")
}

/** The readback of the clip module: the clip bounds in device px, or null when the clip view does not clip to its bounds. */
fun dragonAppliedClip(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val c = v.dragonClipView ?: return emptyList()
  val b = c.clipBounds
  return listOf(Pair("dragonClip.clipBounds", if (b == null || b.left != 0 || b.top != 0 || b.right != c.width || b.bottom != c.height) DumpJson.Null else DumpJson.Arr(listOf(c.left, c.top, c.right, c.bottom).map { DumpJson.Num(it.toDouble()) })))
}
`;

export const CLIP_EMITTER: PaintEmitter<'padding-box-clip'> = {
  name: 'clip',
  kinds: ['padding-box-clip'],
  lines: {
    uikit: (v) => [`  ${v}.dragonEnableClip()`],
    'android-views': (v) => [`  ${v}.dragonEnableClip()`],
  },
  applied: (_e, backend, _w, dpr, g) => {
    const [bt, br, bb, bl] = g.border;
    const width = g.box.right - g.box.left;
    const height = g.box.bottom - g.box.top;
    return backend === 'uikit' ? [bl / dpr, bt / dpr, (width - bl - br) / dpr, (height - bt - bb) / dpr] : [bl, bt, width - br, height - bb];
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, afterLayout: 'dragonAfterLayoutClip', applied: 'dragonAppliedClip' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutClip', applied: 'dragonAppliedClip' },
  },
  plants: [],
};
