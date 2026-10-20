// MQ-R1 (notes/T067-mq-r-spec.md R4, R5, R6): the generated media runtime. A DragonMediaRoot is the Dragon root view a state
// mount lays its tree out in; it observes its own size (layoutSubviews on iOS, onSizeChanged on Android) and hands it in whole
// device px to the state machine, which looks the band up with the translated rt-band (rtBand_bandAtPx), moves env#band through the
// state program's delta when the band changes, and lays out once at the new size (DragonStateMachine.resize, emit/runtime/state.ts).
// Nothing here reads the window or the screen, and nothing parses CSS: the band table is typed constructor calls.
import type { rtBand } from '@dragon/layout';
import type { NativeBackend } from '../../lower/native-program.ts';
import type { GeneratedFile } from '../../types.ts';
import { doubleLit, stringLit } from '../native-support.ts';

export const MEDIA_RUNTIME_VERSION = 'dragon.runtime-media/1';

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function swiftText(): string {
  return String.raw`import UIKit

/// The band table of a band program and the index of its env#band state (T067 R4, R5).
public final class DragonBandBinding {
  public let table: BandTable
  public let state: Int
  public init(_ table: BandTable, _ state: Int) { self.table = table; self.state = state }
}

/// The Dragon root view of a state mount (T067 R6): the environment is its own bounds, in whole device px at the screen scale,
/// observed in layoutSubviews, which also runs on rotation, split view and Stage Manager. It never reads the window or the screen.
public final class DragonMediaRoot: UIView {
  /// Called with the root's size in whole device px and in points (CSS px) each time it changes.
  public var onSize: ((Double, Double, Double, Double) -> Void)?
  public private(set) var sizePx: (Double, Double) = (0, 0)
  private let scale: Double
  public init(scale: Double) {
    self.scale = scale
    super.init(frame: .zero)
    clipsToBounds = true
  }
  public required init?(coder: NSCoder) { fatalError("dragon: DragonMediaRoot is built in code") }
  override public func layoutSubviews() {
    super.layoutSubviews()
    let w = dragonWholeDevicePx(Double(bounds.width) * scale, "media root width")
    let h = dragonWholeDevicePx(Double(bounds.height) * scale, "media root height")
    if w == sizePx.0 && h == sizePx.1 { return }
    sizePx = (w, h)
    onSize?(w, h, Double(bounds.width), Double(bounds.height))
  }
}

/// The band of a root size: the translated band lookup over the binding's table; a truth vector no band has is fatal, never guessed.
public func dragonBandAt(_ binding: DragonBandBinding, _ widthPx: Double, _ heightPx: Double, _ scale: Double) -> Int {
  do {
    return Int(try rtBand_bandAtPx(binding.table, widthPx, heightPx, scale, BandFaults(false)))
  } catch {
    fatalError("dragon: the band lookup failed at \(widthPx) x \(heightPx) px, scale \(scale): \(error)")
  }
}
`;
}

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function kotlinText(): string {
  return String.raw`package dev.dragon.views

import android.content.Context
import android.view.View
import android.widget.FrameLayout
import dev.dragon.layout.BandFaults
import dev.dragon.layout.BandTable
import dev.dragon.layout.rtBand_bandAtPx

/** The band table of a band program and the index of its env#band state (T067 R4, R5). */
class DragonBandBinding(val table: BandTable, val state: Int)

/**
 * The Dragon root view of a state mount (T067 R6): the environment is its own size in whole device px, observed in onSizeChanged,
 * which also runs when the activity handles a rotation itself (configChanges). It never reads the window or the display.
 */
class DragonMediaRoot(context: Context) : FrameLayout(context) {
  /**
   * Called with the root's size in whole device px each time it changes. A script's resize step names the size it asked for in CSS
   * px (requested), since a CSS size off the device px grid (300 at density 2.625) cannot be read back from whole px exactly.
   */
  var onSize: ((Double, Double) -> Unit)? = null
  var widthPx = 0.0
    private set
  var heightPx = 0.0
    private set
  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w.toDouble() == widthPx && h.toDouble() == heightPx) return
    widthPx = w.toDouble()
    heightPx = h.toDouble()
    onSize?.invoke(widthPx, heightPx)
  }
  /**
   * A size change the system lays out (a rotation) reaches onSize inside this view's layout, after the measure pass: the tree root
   * that onSize renders was never measured and would be laid out 0x0. Every child with a fixed size is measured to it first.
   */
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    for (i in 0 until childCount) {
      val c = getChildAt(i)
      val lp = c.layoutParams
      if (lp.width >= 0 && lp.height >= 0 && (c.measuredWidth != lp.width || c.measuredHeight != lp.height)) {
        c.measure(View.MeasureSpec.makeMeasureSpec(lp.width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(lp.height, View.MeasureSpec.EXACTLY))
      }
    }
    super.onLayout(changed, left, top, right, bottom)
  }
}

/** The band of a root size: the translated band lookup over the binding's table; a truth vector no band has throws, never guessed. */
fun dragonBandAt(binding: DragonBandBinding, widthPx: Double, heightPx: Double, scale: Double): Int =
  rtBand_bandAtPx(binding.table, widthPx, heightPx, scale, BandFaults(false)).toInt()
`;
}

/** The media runtime support source of a backend. */
export function mediaSupport(backend: NativeBackend, header: (what: string) => string): GeneratedFile {
  return backend === 'uikit'
    ? { path: 'Support/DragonMedia.swift', text: header('the media root and the band lookup') + swiftText() }
    : { path: 'kotlin/dev/dragon/views/DragonMedia.kt', text: header('the media root and the band lookup') + kotlinText() };
}

type Lang = 'swift' | 'kotlin';

/** A band table as the translated types' constructor calls. */
export function bandTableLit(lang: Lang, table: rtBand.BandTable): string {
  const swift = lang === 'swift';
  const s = (t: string): string => (swift ? `JsString(${stringLit(lang, t)})` : stringLit(lang, t));
  const list = (type: string, items: readonly string[]): string => (swift ? `JsArray<${type}>([${items.join(', ')}])` : `jsArrayOf<${type}>(${items.join(', ')})`);
  const atoms = table.atoms.map((a) => `BandAtom(${s(a.feature)}, ${list('BandComparison', a.comparisons.map((c) => `BandComparison(${s(c.op)}, ${doubleLit(c.value)}, ${doubleLit(c.num)}, ${doubleLit(c.den)})`))}, ${s(a.keyword)})`);
  const bands = table.bands.map((b) => list(swift ? 'Bool' : 'Boolean', b.map(String)));
  return `BandTable(${list('BandAtom', atoms)}, ${list(swift ? 'JsArray<Bool>' : 'JsArray<Boolean>', bands)})`;
}
