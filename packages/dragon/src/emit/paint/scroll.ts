// OVFL-B (T078 R9, R10): a scroll container's children are hosted in a native scroll view over its padding box, in place of the
// clip view. The offset range is the translated engine's (overflow.ts scrollRanges, set by the runtime before the after-layout
// hook) in whole device px: [minX, maxX, minY, maxY], the start side negative where the overflow extends past it, a locked
// (hidden) axis [0, 0]. Scroll offset 0 is the layout position, so every frame at rest is the layout's. Motion is native.
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// OVFL-B: this box's scroll offset range in device px from the translated engine, or nil when it is no scroll container.
  public var dragonScrollRange: [Double]? = nil
  /// Overflow auto or scroll: the clip view becomes a DragonScrollView that scrolls on the axes given (a hidden axis is locked).
  public func dragonEnableScroll(_ x: Bool, _ y: Bool) {
    guard let old = dragonClipView else { fatalError("dragon: \(dragonId) scrolls without a clip view") }
    old.removeFromSuperview()
    let s = DragonScrollView(scrollsX: x, scrollsY: y)
    addSubview(s)
    dragonClipView = s
  }
`;

const SWIFT = String.raw`import UIKit

/// A scroll container's padding box: UIKit scrolls it (bounce, deceleration and indicators are native) between the engine's
/// offsets. contentInset gives the start side (offset minX) and contentSize the end (offset maxX); safe areas never adjust it.
public final class DragonScrollView: UIScrollView {
  public let scrollsX: Bool
  public let scrollsY: Bool
  public init(scrollsX: Bool, scrollsY: Bool) {
    self.scrollsX = scrollsX
    self.scrollsY = scrollsY
    super.init(frame: .zero)
    clipsToBounds = true
    backgroundColor = nil
    isOpaque = false
    contentInsetAdjustmentBehavior = .never
    automaticallyAdjustsScrollIndicatorInsets = false
    alwaysBounceHorizontal = false
    alwaysBounceVertical = false
    scrollsToTop = false
    showsHorizontalScrollIndicator = scrollsX
    showsVerticalScrollIndicator = scrollsY
  }
  required init?(coder: NSCoder) { fatalError("DragonScrollView is built in code") }

  /// Sets the offset range [minX, maxX, minY, maxY] in device px (a locked axis takes [0, 0]) and clamps the current offset into it.
  public func dragonSetRange(_ r: [Double], _ scale: Double) {
    let s = CGFloat(scale)
    let minX = scrollsX ? r[0] : 0
    let maxX = scrollsX ? r[1] : 0
    let minY = scrollsY ? r[2] : 0
    let maxY = scrollsY ? r[3] : 0
    if minX > 0 || maxX < minX || minY > 0 || maxY < minY { fatalError("dragon: scroll range \(r) does not hold offset 0") }
    contentInset = UIEdgeInsets(top: CGFloat(-minY) / s, left: CGFloat(-minX) / s, bottom: 0, right: 0)
    contentSize = CGSize(width: bounds.width + CGFloat(maxX) / s, height: bounds.height + CGFloat(maxY) / s)
    let o = contentOffset
    contentOffset = CGPoint(x: min(max(o.x, CGFloat(minX) / s), CGFloat(maxX) / s), y: min(max(o.y, CGFloat(minY) / s), CGFloat(maxY) / s))
  }
}

/// After every layout (the clip module has set the frame): the engine's range, re-applied and clamped (R10).
public func dragonAfterLayoutScroll(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let sv = v.dragonClipView as? DragonScrollView else { return }
  guard let r = v.dragonScrollRange else { fatalError("dragon: \(v.dragonId): a scroll view with no engine scroll range") }
  sv.dragonSetRange(r, scale)
}

/// The readback of the scroll module: the offset range UIKit clamps a user's scroll to, in whole device px.
public func dragonAppliedScroll(_ v: DragonBoxView) -> DumpJsonObject {
  guard let sv = v.dragonClipView as? DragonScrollView else { return [] }
  let s = v.dragonScale
  let r = [-sv.contentInset.left, sv.contentSize.width + sv.contentInset.right - sv.bounds.width, -sv.contentInset.top, sv.contentSize.height + sv.contentInset.bottom - sv.bounds.height]
  return [("dragonScroll.range", .array(r.map { .number(dragonWholeDevicePx(Double($0) * s, "\(v.dragonId) scroll range") + 0) }))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** OVFL-B: this box's scroll offset range in device px from the translated engine, or null when it is no scroll container. */
  var dragonScrollRange: IntArray? = null
  /** Overflow auto or scroll: the clip view becomes a DragonScrollView that scrolls on the axes given (a hidden axis is locked). */
  fun dragonEnableScroll(x: Boolean, y: Boolean) {
    val old = dragonClipView ?: throw IllegalStateException("dragon: " + dragonId + " scrolls without a clip view")
    removeView(old)
    val s = DragonScrollView(context, x, y)
    addView(s)
    dragonClipView = s
  }
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.content.Context
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.widget.OverScroller
import dev.dragon.dump.DumpJson

/**
 * A scroll container's padding box: a clip view scrolled with View.scrollTo between the engine's offsets, in both axes (the
 * platform ScrollView scrolls one), with OverScroller flings, the platform touch slop and fling speeds, and overlay scrollbars that
 * fade, enabled at the first touch so a view at rest draws none.
 */
class DragonScrollView(ctx: Context, val scrollsX: Boolean, val scrollsY: Boolean) : DragonClipView(ctx) {
  /** The offset range: minX, maxX, minY, maxY in device px; a locked axis is 0, 0. Every scroll clamps to it. */
  val dragonRange = IntArray(4)
  private val scroller = OverScroller(ctx)
  private val slop: Int
  private val minFling: Int
  private val maxFling: Int
  private var tracker: VelocityTracker? = null
  private var lastX = 0f
  private var lastY = 0f
  private var dragging = false
  init {
    val c = ViewConfiguration.get(ctx)
    slop = c.scaledTouchSlop
    minFling = c.scaledMinimumFlingVelocity
    maxFling = c.scaledMaximumFlingVelocity
    scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
    isScrollbarFadingEnabled = true
    isHorizontalScrollBarEnabled = false
    isVerticalScrollBarEnabled = false
  }

  /** Sets the offset range (a locked axis takes 0, 0) and clamps the current offset into it. */
  fun dragonSetRange(r: IntArray) {
    dragonRange[0] = if (scrollsX) r[0] else 0
    dragonRange[1] = if (scrollsX) r[1] else 0
    dragonRange[2] = if (scrollsY) r[2] else 0
    dragonRange[3] = if (scrollsY) r[3] else 0
    if (dragonRange[0] > 0 || dragonRange[1] < dragonRange[0] || dragonRange[2] > 0 || dragonRange[3] < dragonRange[2]) throw IllegalStateException("dragon: scroll range " + r.joinToString() + " does not hold offset 0")
    scrollTo(scrollX, scrollY)
  }

  override fun scrollTo(x: Int, y: Int) {
    super.scrollTo(x.coerceIn(dragonRange[0], dragonRange[1]), y.coerceIn(dragonRange[2], dragonRange[3]))
  }

  override fun computeHorizontalScrollRange(): Int = width + dragonRange[1] - dragonRange[0]
  override fun computeHorizontalScrollOffset(): Int = scrollX - dragonRange[0]
  override fun computeHorizontalScrollExtent(): Int = width
  override fun computeVerticalScrollRange(): Int = height + dragonRange[3] - dragonRange[2]
  override fun computeVerticalScrollOffset(): Int = scrollY - dragonRange[2]
  override fun computeVerticalScrollExtent(): Int = height

  private fun canScroll(): Boolean = dragonRange[1] > dragonRange[0] || dragonRange[3] > dragonRange[2]

  override fun onInterceptTouchEvent(e: MotionEvent): Boolean {
    if (!canScroll()) return false
    when (e.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        lastX = e.x
        lastY = e.y
        dragging = !scroller.isFinished
        scroller.forceFinished(true)
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = kotlin.math.abs(e.x - lastX)
        val dy = kotlin.math.abs(e.y - lastY)
        if ((scrollsX && dx > slop) || (scrollsY && dy > slop)) {
          dragging = true
          lastX = e.x
          lastY = e.y
          parent?.requestDisallowInterceptTouchEvent(true)
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> dragging = false
    }
    return dragging
  }

  override fun onTouchEvent(e: MotionEvent): Boolean {
    if (!canScroll()) return false
    val t = tracker ?: VelocityTracker.obtain().also { tracker = it }
    t.addMovement(e)
    when (e.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        scroller.forceFinished(true)
        lastX = e.x
        lastY = e.y
        isHorizontalScrollBarEnabled = scrollsX
        isVerticalScrollBarEnabled = scrollsY
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = (lastX - e.x).toInt()
        val dy = (lastY - e.y).toInt()
        if (!dragging && ((scrollsX && kotlin.math.abs(dx) > slop) || (scrollsY && kotlin.math.abs(dy) > slop))) {
          dragging = true
          parent?.requestDisallowInterceptTouchEvent(true)
        }
        if (dragging) {
          scrollTo(scrollX + (if (scrollsX) dx else 0), scrollY + (if (scrollsY) dy else 0))
          lastX = e.x
          lastY = e.y
          awakenScrollBars()
        }
      }
      MotionEvent.ACTION_UP -> {
        t.computeCurrentVelocity(1000, maxFling.toFloat())
        val vx = if (scrollsX) -t.xVelocity.toInt() else 0
        val vy = if (scrollsY) -t.yVelocity.toInt() else 0
        if (kotlin.math.abs(vx) > minFling || kotlin.math.abs(vy) > minFling) {
          scroller.fling(scrollX, scrollY, vx, vy, dragonRange[0], dragonRange[1], dragonRange[2], dragonRange[3])
          postInvalidateOnAnimation()
        }
        dragging = false
        t.recycle()
        tracker = null
      }
      MotionEvent.ACTION_CANCEL -> {
        dragging = false
        t.recycle()
        tracker = null
      }
    }
    return true
  }

  override fun computeScroll() {
    if (scroller.computeScrollOffset()) {
      scrollTo(scroller.currX, scroller.currY)
      awakenScrollBars()
      postInvalidateOnAnimation()
    }
  }
}

/** After every layout (the clip module has set the frame): the engine's range, re-applied and clamped (R10). */
fun dragonAfterLayoutScroll(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val sv = v.dragonClipView as? DragonScrollView ?: return
  val r = v.dragonScrollRange ?: throw IllegalStateException("dragon: " + v.dragonId + ": a scroll view with no engine scroll range")
  sv.dragonSetRange(r)
}

/** The readback of the scroll module: the offset range every scroll clamps to, in device px. */
fun dragonAppliedScroll(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val sv = v.dragonClipView as? DragonScrollView ?: return emptyList()
  return listOf(Pair("dragonScroll.range", DumpJson.Arr(sv.dragonRange.map { DumpJson.Num(it.toDouble()) })))
}
`;

const bool = (b: boolean): string => (b ? 'true' : 'false');

export const SCROLL_EMITTER: PaintEmitter<'scroll-container'> = {
  name: 'scroll',
  kinds: ['scroll-container'],
  lines: {
    uikit: (v, _n, w) => [`  ${v}.dragonEnableScroll(${bool(w.x)}, ${bool(w.y)})`],
    'android-views': (v, _n, w) => [`  ${v}.dragonEnableScroll(${bool(w.x)}, ${bool(w.y)})`],
  },
  applied: (_e, _backend, w, _dpr, g) => {
    if (g.scroll === null) throw new Error('a scroll container with no engine scroll range');
    const [minX, maxX, minY, maxY] = g.scroll;
    return w.x ? (w.y ? [minX, maxX, minY, maxY] : [minX, maxX, 0, 0]) : w.y ? [0, 0, minY, maxY] : [0, 0, 0, 0];
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, afterLayout: 'dragonAfterLayoutScroll', applied: 'dragonAppliedScroll' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutScroll', applied: 'dragonAppliedScroll' },
  },
  plants: [],
};
