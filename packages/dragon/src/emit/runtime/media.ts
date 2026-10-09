// MQ-R1 (notes/T067-mq-r-spec.md R4, R5, R6): the generated media runtime. A DragonMediaRoot is the Dragon root view a state
// mount lays its tree out in; it observes its own size (layoutSubviews on iOS, onSizeChanged on Android) and hands it in whole
// device px to the state machine, which looks the band up with the translated rt-band (rtBand_bandAtPx), moves env#band through the
// state program's delta when the band changes, and lays out once at the new size (DragonStateMachine.resize, emit/runtime/state.ts).
// Nothing here reads the window or the screen, and nothing parses CSS: the band table is typed constructor calls.
// MQ-R2 (T067 R9): DragonReadings are the device readings the device features answer from (the scale is the mount's): on iOS a
// touch screen that cannot hover (an iPad adds a fine, hovering pointer to any-pointer and any-hover while a GCMouse is connected)
// and UIAccessibility's reduce-motion setting; on Android the translated port of Chromium's TouchDevice rule over every input
// device's sources (rtBand_androidPointerReadings) and Chromium's AccessibilityState.prefersReducedMotion
// (ANIMATOR_DURATION_SCALE == 0). A DragonReadingsObserver calls back when any of them changes.
import type { rtBand } from '@dragon/layout';
import type { NativeBackend } from '../../lower/native-program.ts';
import type { GeneratedFile } from '../../types.ts';
import { doubleLit, stringLit } from '../native-support.ts';

export const MEDIA_RUNTIME_VERSION = 'dragon.runtime-media/2';

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function swiftText(): string {
  return String.raw`import GameController
import UIKit

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

/// MQ-R2 (T067 R9): the device readings the device features answer from, beside the scale.
public struct DragonReadings: Equatable {
  public var pointer: String
  public var hover: Bool
  public var anyCoarse: Bool
  public var anyFine: Bool
  public var anyHover: Bool
  public var reducedMotion: Bool
  /// Headless Chrome's desktop page: a mouse, no motion preference (a machine's readings until its mount reads the platform's).
  public static let desktop = DragonReadings(pointer: "fine", hover: true, anyCoarse: false, anyFine: true, anyHover: true, reducedMotion: false)
  /// The pointer readings of a touch screen alone (touch) or a desktop mouse, the motion setting kept.
  public func pointing(touch: Bool) -> DragonReadings {
    return DragonReadings(pointer: touch ? "coarse" : "fine", hover: !touch, anyCoarse: touch, anyFine: !touch, anyHover: !touch, reducedMotion: reducedMotion)
  }
  /// Every pointer and hover reading from env(2, bits) (emit/runtime/state.ts pointerBits), the motion setting kept.
  public func pointers(_ bits: Int) -> DragonReadings {
    let pointer = ["none", "coarse", "fine"][bits & 3]
    return DragonReadings(pointer: pointer, hover: bits & 4 != 0, anyCoarse: bits & 8 != 0, anyFine: bits & 16 != 0, anyHover: bits & 32 != 0, reducedMotion: reducedMotion)
  }
  /// The reduced-motion setting, the pointer readings kept.
  public func motion(reduce: Bool) -> DragonReadings {
    var r = self
    r.reducedMotion = reduce
    return r
  }
  /// The platform's readings: a touch screen that cannot hover, which an iPad's connected mouse or trackpad (GCMouse) adds a fine,
  /// hovering pointer to for any-pointer and any-hover (the primary pointer stays the touch screen); reduced motion is the setting
  /// every iOS browser reports.
  public static func platform() -> DragonReadings {
    let mouse = UIDevice.current.userInterfaceIdiom == .pad && !GCMouse.mice().isEmpty
    return DragonReadings(pointer: "coarse", hover: false, anyCoarse: true, anyFine: mouse, anyHover: mouse, reducedMotion: dragonReduceMotion())
  }
  /// The platform inputs the readings come from, for the dump: [1 on an iPad else 0, the connected GCMouse count].
  public static func platformInputs() -> [Double] {
    return [UIDevice.current.userInterfaceIdiom == .pad ? 1 : 0, Double(GCMouse.mice().count)]
  }
}

/// The user's reduce-motion setting.
public func dragonReduceMotion() -> Bool { return UIAccessibility.isReduceMotionEnabled }

/// Observes the platform readings (the reduce-motion setting, mice connecting and disconnecting) and calls back on the main queue.
public final class DragonReadingsObserver {
  private var tokens: [NSObjectProtocol] = []
  public init(_ onChange: @escaping () -> Void) {
    for name in [UIAccessibility.reduceMotionStatusDidChangeNotification, NSNotification.Name.GCMouseDidConnect, NSNotification.Name.GCMouseDidDisconnect] {
      tokens.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in onChange() })
    }
  }
  deinit { for t in tokens { NotificationCenter.default.removeObserver(t) } }
}

/// The band of a root size on a device: the translated band lookup over the binding's table; a truth vector no band has is fatal, never guessed.
public func dragonBandAt(_ binding: DragonBandBinding, _ widthPx: Double, _ heightPx: Double, _ scale: Double, _ r: DragonReadings) -> Int {
  do {
    let env = BandEnvironment(scale, JsString(r.pointer), r.hover, r.anyCoarse, r.anyFine, r.anyHover, r.reducedMotion)
    return Int(try rtBand_bandAtPx(binding.table, widthPx, heightPx, env, BandFaults(false, false)))
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
import android.database.ContentObserver
import android.hardware.input.InputManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.InputDevice
import android.view.View
import android.widget.FrameLayout
import dev.dragon.layout.BandEnvironment
import dev.dragon.layout.BandFaults
import dev.dragon.layout.BandTable
import dev.dragon.layout.jsArrayOf
import dev.dragon.layout.rtBand_androidPointerReadings
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

/** MQ-R2 (T067 R9): the device readings the device features answer from, beside the scale. */
data class DragonReadings(val pointer: String, val hover: Boolean, val anyCoarse: Boolean, val anyFine: Boolean, val anyHover: Boolean, val reducedMotion: Boolean) {
  /** The pointer readings of a touch screen alone (touch) or a desktop mouse, the motion setting kept. */
  fun pointing(touch: Boolean): DragonReadings = DragonReadings(if (touch) "coarse" else "fine", !touch, touch, !touch, !touch, reducedMotion)
  /** The reduced-motion setting, the pointer readings kept. */
  fun motion(reduce: Boolean): DragonReadings = copy(reducedMotion = reduce)
  /** Every pointer and hover reading from env(2, bits) (emit/runtime/state.ts pointerBits), the motion setting kept. */
  fun pointers(bits: Int): DragonReadings = DragonReadings(arrayOf("none", "coarse", "fine")[bits and 3], (bits and 4) != 0, (bits and 8) != 0, (bits and 16) != 0, (bits and 32) != 0, reducedMotion)

  companion object {
    /** Headless Chrome's desktop page: a mouse, no motion preference (a machine's readings until its mount reads the platform's). */
    val DESKTOP = DragonReadings("fine", true, false, true, true, false)

    /** The platform's readings: the port of Chromium's pointer rule over every input device, and the reduced-motion setting. */
    fun platform(context: Context): DragonReadings {
      val p = rtBand_androidPointerReadings(jsArrayOf(*platformInputs().toTypedArray()), BandFaults(false, false))
      return DragonReadings(p.pointer, p.hover, p.anyCoarse, p.anyFine, p.anyHover, dragonReduceMotion(context))
    }

    /** Every input device's getSources() (TouchDevice.availablePointerAndHoverTypes skips a device it cannot read). */
    fun platformInputs(): List<Double> = InputDevice.getDeviceIds().toList().mapNotNull { id ->
      try {
        InputDevice.getDevice(id)
      } catch (e: RuntimeException) {
        null
      }
    }.map { it.sources.toDouble() }
  }
}

/** Chromium's AccessibilityState.prefersReducedMotion: animations are off (ANIMATOR_DURATION_SCALE is 0; its default is 1). */
fun dragonReduceMotion(context: Context): Boolean = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

/** Observes the platform readings (the animator duration scale, input devices added, removed or changed) and calls back on the main looper. */
class DragonReadingsObserver(private val context: Context, private val notify: () -> Unit) : InputManager.InputDeviceListener {
  private val handler = Handler(Looper.getMainLooper())
  private val settings = object : ContentObserver(handler) {
    override fun onChange(selfChange: Boolean) {
      notify()
    }
  }
  private val input: InputManager = context.getSystemService(InputManager::class.java)

  init {
    context.contentResolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, settings)
    input.registerInputDeviceListener(this, handler)
  }

  fun close() {
    context.contentResolver.unregisterContentObserver(settings)
    input.unregisterInputDeviceListener(this)
  }

  override fun onInputDeviceAdded(deviceId: Int) = notify()
  override fun onInputDeviceRemoved(deviceId: Int) = notify()
  override fun onInputDeviceChanged(deviceId: Int) = notify()
}

/** The band of a root size on a device: the translated band lookup over the binding's table; a truth vector no band has throws, never guessed. */
fun dragonBandAt(binding: DragonBandBinding, widthPx: Double, heightPx: Double, scale: Double, r: DragonReadings): Int =
  rtBand_bandAtPx(binding.table, widthPx, heightPx, BandEnvironment(scale, r.pointer, r.hover, r.anyCoarse, r.anyFine, r.anyHover, r.reducedMotion), BandFaults(false, false)).toInt()
`;
}

/**
 * MQ-R2's support plant (T067 R9): the reduced-motion reading takes another setting, Android's transition animation scale
 * (TRANSITION_ANIMATION_SCALE) instead of the animator duration scale Chromium reads, and iOS's reduce-transparency setting.
 * device-env's motion phase on Android catches it (only the animator duration scale changes there).
 */
export type MediaPlantName = 'reduced-motion-transition-scale';

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
export function mediaPlants(): readonly { readonly name: MediaPlantName; readonly replace: { readonly [B in NativeBackend]: readonly [string, string] } }[] {
  return [
    {
      name: 'reduced-motion-transition-scale',
      replace: {
        uikit: ['public func dragonReduceMotion() -> Bool { return UIAccessibility.isReduceMotionEnabled }', 'public func dragonReduceMotion() -> Bool { return UIAccessibility.isReduceTransparencyEnabled }'],
        'android-views': ['Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f', 'Settings.Global.TRANSITION_ANIMATION_SCALE, 1f) == 0f'],
      },
    },
  ];
}

/** The media runtime support source of a backend. */
export function mediaSupport(backend: NativeBackend, header: (what: string) => string): GeneratedFile {
  return backend === 'uikit'
    ? { path: 'Support/DragonMedia.swift', text: header('the media root, the device readings and the band lookup') + swiftText() }
    : { path: 'kotlin/dev/dragon/views/DragonMedia.kt', text: header('the media root, the device readings and the band lookup') + kotlinText() };
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
