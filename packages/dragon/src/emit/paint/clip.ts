// css-overflow-3 §3: overflow hidden hosts the box's children in a Dragon clip view over its padding box (the container factory
// makes it; the after-layout hook sets its frame from the engine's border widths at the device scale).
// css-masking-1 §5.1: a clip rect() that is empty at every size hides the box view (isHidden, View.INVISIBLE), and with it every
// view inside it, through the one runtime writer dragonClipRectEmpty; the readback is 1 when the box view is hidden. A hidden or
// invisible view leaves the accessibility tree, so analysis refuses the write where the subtree has text (the only native
// accessibility elements), which Chrome keeps there (analysis/paint-values/clip.ts).
// css-masking-1 §6.1: clip-path: inset() stores its edges through dragonSetClipPath; after every layout the clip rect is the snapped
// border box inset by each edge (px times the scale, plus its percentage of the layout width or height), in device px (clipPathRect).
// UIKit masks the box view's layer with an opaque layer over the rect; Android clips the canvas of the box view's draw, around its own
// paint and its children's. Neither touches the views' visibility, so no view leaves the accessibility tree.
import type { InsetEdge } from '../../css/properties/clip-path.ts';
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
  /// clip-path: inset() (MASK-CLIP): the four edges (top, right, bottom, left) as px, percent pairs; empty without one.
  public var dragonClipPathInsets: [Double] = []
  /// The clip-path rect (left, top, right, bottom) in device px relative to the box, from the last layout; empty without one.
  public var dragonClipPathRect: [Double] = []
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

/// Whether the clip-path writer ignores the write; false except in the clip-path-ignored plant build.
public let dragonClipPathPlantIgnored = false

/// The clip-path write of a box (runtime writer): its inset() edges; the after-layout hook masks the box view to their rect.
public func dragonSetClipPath(_ v: DragonBoxView, _ insets: [Double]) {
  if dragonClipPathPlantIgnored { return }
  if insets.count != 8 { fatalError("dragon: \(v.dragonId): \(insets.count) clip-path inset values, not 8") }
  v.dragonClipPathInsets = insets
}

/// The clip-path rect of a box in device px relative to it (left, top, right, bottom); zero when the insets leave nothing.
public func dragonClipPathRectOf(_ insets: [Double], _ shape: DragonBoxShape, _ scale: Double) -> [Double] {
  let e = shape.edges
  let edge = { (k: Int, size: Double) -> Double in insets[2 * k] * scale + insets[2 * k + 1] / 100 * size }
  let l = edge(3, shape.size[0]), t = edge(0, shape.size[1])
  let r = e[2] - e[0] - edge(1, shape.size[0]), b = e[3] - e[1] - edge(2, shape.size[1])
  return r <= l || b <= t ? [0, 0, 0, 0] : [l, t, r, b]
}

/// After every layout: the clip view over the padding box, in points relative to the box; the clip-path mask over its rect.
public func dragonAfterLayoutClip(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  let cg = CGFloat(scale)
  if !v.dragonClipPathInsets.isEmpty {
    let r = dragonClipPathRectOf(v.dragonClipPathInsets, shape, scale)
    v.dragonClipPathRect = r
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let m = v.layer.mask ?? CALayer()
    m.backgroundColor = UIColor.black.cgColor
    m.frame = CGRect(x: CGFloat(r[0]) / cg, y: CGFloat(r[1]) / cg, width: CGFloat(r[2] - r[0]) / cg, height: CGFloat(r[3] - r[1]) / cg)
    v.layer.mask = m
    CATransaction.commit()
  }
  guard let c = v.dragonClipView else { return }
  let e = shape.edges
  let px = shape.borders
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
  if !v.dragonClipPathInsets.isEmpty {
    let s = v.dragonScale
    let r = v.dragonClipPathRect
    out.append(("dragonClipPath.frame", v.layer.mask == nil || r.count != 4 ? .null : .array([r[0] / s, r[1] / s, (r[2] - r[0]) / s, (r[3] - r[1]) / s].map { .number($0) })))
  }
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
  /** clip-path: inset() (MASK-CLIP): the four edges (top, right, bottom, left) as px, percent pairs; null without one. */
  var dragonClipPathInsets: DoubleArray? = null
  /** The clip-path rect [left, top, right, bottom] in device px relative to the box, from the last layout; null without one. */
  var dragonClipPathRect: DoubleArray? = null
  /** clip-path: the canvas is clipped around the box's own paint and its children's; the views' visibility is untouched. */
  override fun draw(canvas: Canvas) {
    val r = dragonClipPathRect
    if (r == null) {
      super.draw(canvas)
      return
    }
    val n = canvas.save()
    canvas.clipRect(r[0].toFloat(), r[1].toFloat(), r[2].toFloat(), r[3].toFloat())
    super.draw(canvas)
    canvas.restoreToCount(n)
  }
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

/** Whether the clip-path writer ignores the write; false except in the clip-path-ignored plant build. */
const val DRAGON_CLIP_PATH_PLANT_IGNORED = false

/** The clip-path write of a box (runtime writer): its inset() edges; the after-layout hook sets the rect its draw clips to. */
fun dragonSetClipPath(v: DragonBoxView, insets: DoubleArray) {
  if (DRAGON_CLIP_PATH_PLANT_IGNORED) return
  if (insets.size != 8) throw IllegalStateException("dragon: " + v.dragonId + ": " + insets.size + " clip-path inset values, not 8")
  v.dragonClipPathInsets = insets
  v.invalidate()
}

/** The clip-path rect of a box in device px relative to it (left, top, right, bottom); zero when the insets leave nothing. */
fun dragonClipPathRectOf(insets: DoubleArray, shape: DragonBoxShape, scale: Double): DoubleArray {
  val e = shape.edges
  fun edge(k: Int, size: Double): Double = insets[2 * k] * scale + insets[2 * k + 1] / 100.0 * size
  val l = edge(3, shape.size[0])
  val t = edge(0, shape.size[1])
  val r = e[2] - e[0] - edge(1, shape.size[0])
  val b = e[3] - e[1] - edge(2, shape.size[1])
  return if (r <= l || b <= t) doubleArrayOf(0.0, 0.0, 0.0, 0.0) else doubleArrayOf(l, t, r, b)
}

/** After every layout: the clip view over the padding box, in device px relative to the box; the clip-path rect. */
fun dragonAfterLayoutClip(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val insets = v.dragonClipPathInsets
  if (insets != null) {
    v.dragonClipPathRect = dragonClipPathRectOf(insets, shape, scale)
    v.invalidate()
  }
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
  if (v.dragonClipPathInsets != null) {
    val r = v.dragonClipPathRect
    out.add(Pair("dragonClipPath.rect", if (r == null) DumpJson.Null else DumpJson.Arr(r.map { DumpJson.Num(it) })))
  }
  return out
}
`;

/** The eight writer values of inset() edges (top, right, bottom, left), each as px then percent. */
export function clipPathInsets(edges: readonly InsetEdge[]): number[] {
  if (edges.length !== 4) throw new Error(`clip-path has ${edges.length} inset edges, not 4`);
  return edges.flatMap((e) => {
    if (!Number.isFinite(e.value) || (e.unit !== 'px' && e.unit !== '%')) throw new Error(`clip-path edge ${e.value}${e.unit} is not a finite px or % value`);
    return e.unit === 'px' ? [e.value, 0] : [0, e.value];
  });
}

/**
 * The clip-path rect of a box in device px relative to its snapped border box (left, top, right, bottom), as the device computes it
 * (dragonClipPathRectOf, in the same order of operations): each edge is px times the scale plus its percentage of the layout height
 * (top, bottom) or width; [0, 0, 0, 0] when the insets leave nothing.
 */
export function clipPathRect(insets: readonly number[], box: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }, size: readonly [number, number], dpr: number): [number, number, number, number] {
  const edge = (k: number, extent: number): number => (insets[2 * k] as number) * dpr + ((insets[2 * k + 1] as number) / 100) * extent;
  const l = edge(3, size[0]);
  const t = edge(0, size[1]);
  const r = box.right - box.left - edge(1, size[0]);
  const b = box.bottom - box.top - edge(2, size[1]);
  return r <= l || b <= t ? [0, 0, 0, 0] : [l, t, r, b];
}

const swiftNumber = (n: number): string => {
  const t = String(n);
  return /[.eE]/.test(t) ? t : `${t}.0`;
};

export const CLIP_EMITTER: PaintEmitter<'padding-box-clip' | 'clip-rect-empty' | 'clip-path-inset', 'clip-rect-ignored' | 'clip-path-ignored'> = {
  name: 'clip',
  kinds: ['padding-box-clip', 'clip-rect-empty', 'clip-path-inset'],
  lines: {
    uikit: (v, _n, w) => [w.kind === 'clip-path-inset' ? `  dragonSetClipPath(${v}, [${clipPathInsets(w.edges).map(swiftNumber).join(', ')}])` : w.kind === 'clip-rect-empty' ? `  dragonClipRectEmpty(${v})` : `  ${v}.dragonEnableClip()`],
    'android-views': (v, _n, w) => [w.kind === 'clip-path-inset' ? `  dragonSetClipPath(${v}, doubleArrayOf(${clipPathInsets(w.edges).map(swiftNumber).join(', ')}))` : w.kind === 'clip-rect-empty' ? `  dragonClipRectEmpty(${v})` : `  ${v}.dragonEnableClip()`],
  },
  applied: (_e, backend, w, dpr, g) => {
    // The box view hidden.
    if (w.kind === 'clip-rect-empty') return 1;
    if (w.kind === 'clip-path-inset') {
      const [l, t, r, b] = clipPathRect(clipPathInsets(w.edges), g.box, g.size, dpr);
      return backend === 'uikit' ? [l / dpr, t / dpr, (r - l) / dpr, (b - t) / dpr] : [l, t, r, b];
    }
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
    {
      name: 'clip-path-ignored',
      replace: {
        uikit: ['public let dragonClipPathPlantIgnored = false\n', 'public let dragonClipPathPlantIgnored = true\n'],
        'android-views': ['const val DRAGON_CLIP_PATH_PLANT_IGNORED = false\n', 'const val DRAGON_CLIP_PATH_PLANT_IGNORED = true\n'],
      },
    },
  ],
};
