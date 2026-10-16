// css-overflow-3 §3: overflow hidden hosts the box's children in a Dragon clip view over its padding box (the container factory
// makes it; the after-layout hook sets its frame from the engine's border widths at the device scale).
// css-masking-1 §5.1: a clip rect() that is empty at every size hides the box view (isHidden, View.INVISIBLE), and with it every
// view inside it, through the one runtime writer dragonClipRectEmpty; the readback is 1 when the box view is hidden. A hidden or
// invisible view leaves the accessibility tree, so analysis refuses the write where the subtree has text (the only native
// accessibility elements), which Chrome keeps there (analysis/paint-values/clip.ts).
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// The view the children are hosted in over the padding box: a DragonClipView, or the scroll module's DragonScrollView.
  public private(set) var dragonClipView: UIView? = nil
  /// Overflow hidden: the children are hosted by a clip view over the padding box.
  public func dragonEnableClip() {
    let c = dragonMakeContainer()
    addSubview(c)
    dragonClipView = c
  }
  /// Whether a clip rect() that is empty at every size hides the box (MASK-CLIP); set only by dragonClipRectEmpty.
  public var dragonClipRectEmpty = false
`;

const SWIFT = String.raw`import UIKit

/// Whether the clip rect writer ignores the write; false except in the clip-rect-ignored plant build.
public let dragonClipRectPlantIgnored = false

/// The empty clip rect write of a box (runtime writer): the box view is hidden, and with it every view inside it.
public func dragonClipRectEmpty(_ v: DragonBoxView) {
  if dragonClipRectPlantIgnored { return }
  CATransaction.begin()
  CATransaction.setDisableActions(true)
  v.dragonClipRectEmpty = true
  v.isHidden = true
  CATransaction.commit()
}

/// After every layout: the clip view over the padding box, in points relative to the box.
public func dragonAfterLayoutClip(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let c = v.dragonClipView else { return }
  let e = shape.edges
  let px = shape.borders
  let cg = CGFloat(scale)
  c.frame = CGRect(x: CGFloat(px[3]) / cg, y: CGFloat(px[0]) / cg, width: CGFloat(e[2] - e[0] - px[3] - px[1]) / cg, height: CGFloat(e[3] - e[1] - px[0] - px[2]) / cg)
}

/// The readback of the clip module: the clip frame in whole device px / scale, or null when it does not clip.
/// The empty clip rect's readback is 1 when the box view is hidden, or 0.
public func dragonAppliedClip(_ v: DragonBoxView) -> DumpJsonObject {
  var out: DumpJsonObject = []
  if let c = v.dragonClipView {
    let s = v.dragonScale
    out.append(("dragonClip.frame", c.clipsToBounds ? .array([c.frame.minX, c.frame.minY, c.frame.width, c.frame.height].map { .number(dragonWholeDevicePx(Double($0) * s, "\(v.dragonId) clip") / s) }) : .null))
  }
  if v.dragonClipRectEmpty { out.append(("dragonClipRect.hidden", .number(v.isHidden ? 1 : 0))) }
  return out
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The view the children are hosted in over the padding box: a DragonClipView, or the scroll module's DragonScrollView. */
  var dragonClipView: DragonClipView? = null
    private set
  /** Overflow hidden: the children are hosted by a clip view over the padding box. */
  fun dragonEnableClip() {
    val c = dragonMakeContainer(context)
    addView(c)
    dragonClipView = c
  }
  /** Whether a clip rect() that is empty at every size hides the box (MASK-CLIP); set only by dragonClipRectEmpty. */
  var dragonClipRectEmpty = false
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.view.View
import dev.dragon.dump.DumpJson

/** Whether the clip rect writer ignores the write; false except in the clip-rect-ignored plant build. */
const val DRAGON_CLIP_RECT_PLANT_IGNORED = false

/** The empty clip rect write of a box (runtime writer): the box view is invisible, and with it every view inside it. */
fun dragonClipRectEmpty(v: DragonBoxView) {
  if (DRAGON_CLIP_RECT_PLANT_IGNORED) return
  v.dragonClipRectEmpty = true
  v.visibility = View.INVISIBLE
}

/** After every layout: the clip view over the padding box, in device px relative to the box. */
fun dragonAfterLayoutClip(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val c = v.dragonClipView ?: return
  val e = shape.edges
  val px = shape.borders
  dragonSetFrame(c.dragonFrame, px[3], px[0], e[2] - e[0] - px[1], e[3] - e[1] - px[2], v.dragonId + " clip")
}

/** The readback of the clip module: the clip bounds in device px, or null when the clip view does not clip to its bounds. */
/** The empty clip rect's readback is 1 when the box view is invisible, or 0. */
fun dragonAppliedClip(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val out = ArrayList<Pair<String, DumpJson>>()
  val c = v.dragonClipView
  if (c != null) {
    val b = c.clipBounds
    out.add(Pair("dragonClip.clipBounds", if (b == null || b.left != 0 || b.top != 0 || b.right != c.width || b.bottom != c.height) DumpJson.Null else DumpJson.Arr(listOf(c.left, c.top, c.right, c.bottom).map { DumpJson.Num(it.toDouble()) })))
  }
  if (v.dragonClipRectEmpty) out.add(Pair("dragonClipRect.hidden", DumpJson.Num(if (v.visibility == View.INVISIBLE) 1.0 else 0.0)))
  return out
}
`;

export const CLIP_EMITTER: PaintEmitter<'padding-box-clip' | 'clip-rect-empty', 'clip-rect-ignored'> = {
  name: 'clip',
  kinds: ['padding-box-clip', 'clip-rect-empty'],
  lines: {
    uikit: (v, _n, w) => [w.kind === 'clip-rect-empty' ? `  dragonClipRectEmpty(${v})` : `  ${v}.dragonEnableClip()`],
    'android-views': (v, _n, w) => [w.kind === 'clip-rect-empty' ? `  dragonClipRectEmpty(${v})` : `  ${v}.dragonEnableClip()`],
  },
  applied: (_e, backend, w, dpr, g) => {
    // The box view hidden.
    if (w.kind === 'clip-rect-empty') return 1;
    const [bt, br, bb, bl] = g.border;
    const width = g.box.right - g.box.left;
    const height = g.box.bottom - g.box.top;
    return backend === 'uikit' ? [bl / dpr, bt / dpr, (width - bl - br) / dpr, (height - bt - bb) / dpr] : [bl, bt, width - br, height - bb];
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, afterLayout: 'dragonAfterLayoutClip', applied: 'dragonAppliedClip' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutClip', applied: 'dragonAppliedClip' },
  },
  plants: [
    {
      name: 'clip-rect-ignored',
      replace: {
        uikit: ['public let dragonClipRectPlantIgnored = false\n', 'public let dragonClipRectPlantIgnored = true\n'],
        'android-views': ['const val DRAGON_CLIP_RECT_PLANT_IGNORED = false\n', 'const val DRAGON_CLIP_RECT_PLANT_IGNORED = true\n'],
      },
    },
  ],
};
