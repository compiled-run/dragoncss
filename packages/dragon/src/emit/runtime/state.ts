// The generated state runtime (notes/T047-runtime-spec.md RT-1, SELD-R1a): the support machine every state program runs on, one
// source file per state program with its base nodes, deltas, layout variants and typed setters, the case-script cases the device
// lanes run, and the web attribute program. A setter moves the node records the old and new deltas touch and lays out again only
// when the engine input variant changes. On screen, a DragonStateMount rebuilds the Dragon views from the live records after every
// committed setter and lays them out, since DragonTree (a support file other packages share) builds and lays out in one pass; the
// case scripts run through a mount, so the device lanes judge exactly that path. Nothing here parses CSS or matches selectors.
import type { Rgba8 } from '../../css/color.ts';
import type { NativeBackend, ProgramNode } from '../../lower/native-program.ts';
import { PROGRAM_VERSIONS } from '../../lower/native-program.ts';
import type { StateDelta, StateFaults, StateProgram } from '../../lower/state-program.ts';
import { NO_STATE_FAULTS } from '../../lower/state-program.ts';
import type { GeneratedFile, Scalar } from '../../types.ts';
import type { rtBand } from '@dragon/layout';
import { BAND_KEY } from '../../lower/band-program.ts';
import { doubleLit, inputFunctions, liveEnvironmentArgs, stringLit } from '../native-support.ts';
import { bandTableLit } from './media.ts';

export const STATE_RUNTIME_VERSION = 'dragon.runtime-state/1';

/** One step of a case script (T047 §3.3 item 4). tap is a point in LU (1/64 px); the device runs it once the hit runtime is emitted. */
export type ScriptStep =
  | { readonly kind: 'set'; readonly state: string; readonly value: Scalar }
  | { readonly kind: 'advance'; readonly ms: number }
  | { readonly kind: 'tap'; readonly x: number; readonly y: number }
  /** MQ-R1 (T067 R7 (a)): the media root's new size in CSS px; the mount's root observes it and the machine moves the band. */
  | { readonly kind: 'resize'; readonly width: number; readonly height: number }
  /**
   * MQ-R2 (T067 R9): new device readings, injected exactly: a touch screen's or a desktop mouse's pointer and hover readings, or the
   * reduced-motion setting. Injected readings stay until the script ends; the platform's own changes no longer reach the machine.
   */
  | { readonly kind: 'env'; readonly reading: 'pointer'; readonly value: 'touch' | 'desktop' }
  | { readonly kind: 'env'; readonly reading: 'motion'; readonly value: 'reduce' | 'no-preference' }
  | { readonly kind: 'dump' };

/**
 * One case script as a device case: its id, steps and the expected-dump digests of the assignment it ends in. MQ-R1: start is the
 * media root's size when the script starts and viewport the size it ends at (the program's viewport for both when absent).
 */
export type ScriptCase = {
  readonly id: string;
  readonly steps: readonly ScriptStep[];
  readonly expectedDigests: readonly { readonly dpr: number; readonly sha256: string }[];
  readonly start?: { readonly width: number; readonly height: number };
  readonly viewport?: { readonly width: number; readonly height: number };
};

/** One state program as the emitter sees it. */
export type StateEmit = {
  readonly id: string;
  readonly fixture: string;
  readonly direction: 'ltr' | 'rtl';
  readonly compilerDigest: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly program: StateProgram;
  readonly scripts: readonly ScriptCase[];
  /** MQ-R1: the band table of a band program (one with env#band); absent for a program of one band. */
  readonly band?: rtBand.BandTable;
};

export class StateEmitError extends Error {}

/** A domain value's key: its JSON text, which tells 1, "1" and true apart. */
export const valueKey = (v: Scalar): string => JSON.stringify(v);

// ---------------------------------------------------------------- support sources

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function swiftSupportText(): string {
  return String.raw`import UIKit

/// One write of a state node in UIKit vocabulary: exactly what the uikit case emitter writes for the program write.
public enum DragonStateWrite {
  case background(DragonRGBA8)
  case borderStyles([String])
  case borderColors([DragonRGBA8])
  case clip
  case text(String, String, DragonRGBA8)
}

/// One node record of a state program.
public struct DragonStateNode {
  public let id: String
  public let parent: String?
  public let kind: String
  public let writes: [DragonStateWrite]
  public init(_ id: String, _ parent: String?, _ kind: String, _ writes: [DragonStateWrite]) { self.id = id; self.parent = parent; self.kind = kind; self.writes = writes }
}

/// One assignment's delta over the base: removed node ids, changed or added node records, the order when it differs, the variant.
public struct DragonStateDelta {
  public let removed: [String]
  public let changed: [DragonStateNode]
  public let order: [String]?
  public let variant: Int
  public init(_ removed: [String], _ changed: [DragonStateNode], _ order: [String]?, _ variant: Int) { self.removed = removed; self.changed = changed; self.order = order; self.variant = variant }
}

/// One case-script step: set state s to its v-th domain value, advance the virtual clock, resize the media root (CSS px), inject
/// device readings (MQ-R2: env(0, v) the pointer, v 0 a desktop mouse and 1 a touch screen; env(1, v) reduced motion, v 1 reduce),
/// or mark the dump.
public enum DragonScriptStep {
  case set(Int, Int)
  case advance(Double)
  case resize(Double, Double)
  case env(Int, Int)
  case dump
}

/// The finite-state runtime of one state program.
public final class DragonStateMachine {
  public let states: [String]
  public let domains: [[String]]
  private let base: [DragonStateNode]
  private var baseById: [String: DragonStateNode] = [:]
  private let deltas: [DragonStateDelta]
  private let next: [[[Int]]]
  private let variants: [(Double, Double, Double) -> LayoutInput]
  private let skipRelayout: Bool
  /// MQ-R1: the band table and env#band state of a band program; nil for a program of one band.
  public let band: DragonBandBinding?
  /// The band of the current assignment, and the viewport (CSS px) the engine lays out at: the media root's size.
  public private(set) var bandIndex: Int
  public private(set) var viewport: (Double, Double)
  /// MQ-R2: the device readings the band lookup answers the device atoms from, and the media root's size in whole device px and
  /// its scale, which a readings change looks the band up at.
  public var readings = DragonReadings.desktop
  private var sizePx: (Double, Double) = (0, 0)
  private var scale: Double = 0
  public let clock = DragonVirtualClock()
  public private(set) var current: Int
  public private(set) var laidOut: Int
  /// Called after every committed setter; a DragonStateMount uses it to rebuild and lay out the views on screen.
  public var onChange: (() -> Void)?
  private var nodes: [String: DragonStateNode] = [:]
  private var order: [String] = []

  public init(states: [String], domains: [[String]], base: [DragonStateNode], deltas: [DragonStateDelta], next: [[[Int]]], initial: Int, variants: [(Double, Double, Double) -> LayoutInput], skipRelayout: Bool, viewport: (Double, Double), band: DragonBandBinding?, initialBand: Int) {
    self.states = states; self.domains = domains; self.base = base; self.deltas = deltas; self.next = next; self.variants = variants; self.skipRelayout = skipRelayout
    self.viewport = viewport; self.band = band; self.bandIndex = initialBand
    if let b = band, b.table.bands.items.count != domains[b.state].count { fatalError("dragon: the band table has \(b.table.bands.items.count) bands, env#band \(domains[b.state].count) values") }
    current = initial
    laidOut = deltas[initial].variant
    for n in base { baseById[n.id] = n }
    let d = deltas[initial]
    let removed = Set(d.removed)
    for n in base where !removed.contains(n.id) { nodes[n.id] = n }
    for n in d.changed { nodes[n.id] = n }
    order = d.order ?? base.map { $0.id }.filter { nodes[$0] != nil }
  }

  /// Sets state s to its v-th domain value; an index out of range or an unreachable result fails before any change.
  public func set(_ s: Int, _ v: Int) {
    if s < 0 || s >= states.count { fatalError("dragon: no state \(s) (\(states.count) states)") }
    if v < 0 || v >= domains[s].count { fatalError("dragon: \(states[s]): value \(v) is outside the domain \(domains[s])") }
    let to = next[current][s][v]
    if to < 0 { fatalError("dragon: \(states[s]) = \(domains[s][v]) is unreachable from assignment \(current)") }
    let from = deltas[current]
    let d = deltas[to]
    var touched = Set(from.removed)
    for n in from.changed { touched.insert(n.id) }
    for id in d.removed { touched.insert(id) }
    for n in d.changed { touched.insert(n.id) }
    let removed = Set(d.removed)
    var changed: [String: DragonStateNode] = [:]
    for n in d.changed { changed[n.id] = n }
    for id in touched { nodes[id] = removed.contains(id) ? nil : (changed[id] ?? baseById[id]) }
    order = d.order ?? base.map { $0.id }.filter { nodes[$0] != nil }
    if !skipRelayout && d.variant != laidOut { laidOut = d.variant }
    current = to
    onChange?()
  }

  /// Sets a state by key to a domain value by key (the case scripts' untyped path); an unknown key fails.
  public func set(state: String, value: String) {
    guard let s = states.firstIndex(of: state) else { fatalError("dragon: no state \(state); the states are \(states)") }
    guard let v = domains[s].firstIndex(of: value) else { fatalError("dragon: \(state): \(value) is not in the domain \(domains[s])") }
    set(s, v)
  }

  /// Builds the Dragon views of the live node records, writing each as the case emitter does.
  public func build(_ t: DragonTree) {
    for id in order {
      guard let n = nodes[id] else { fatalError("dragon: the state runtime orders \(id), which it does not hold") }
      if n.kind == "text" {
        let v = t.textNode(n.id, parent: n.parent, kind: n.kind)
        for w in n.writes {
          guard case let .text(s, family, color) = w else { fatalError("dragon: text \(n.id) holds a box write") }
          v.dragonSetText(s, family: family, color: color)
        }
        continue
      }
      let v = t.boxNode(n.id, parent: n.parent, kind: n.kind)
      for w in n.writes {
        switch w {
        case .background(let c): v.backgroundColor = dragonUIColor(c)
        case .borderStyles(let s): v.dragonBorderStyles = s
        case .borderColors(let c): v.dragonBorderColors = c
        case .clip: v.dragonEnableClip()
        case .text: fatalError("dragon: box \(n.id) holds a text write")
        }
      }
    }
  }

  /// The engine input last laid out, at the current viewport.
  public func input(_ dpr: Double) -> LayoutInput { return variants[laidOut](dpr, viewport.0, viewport.1) }

  /// MQ-R1 (T067 R5): one size change of the media root: its whole device px pick the band, its CSS px are the viewport. The new
  /// band first, through env#band's delta when it changes (whose setter lays out once), else one layout at the new size.
  public func resize(_ widthPx: Double, _ heightPx: Double, css: (Double, Double), scale: Double) {
    viewport = css
    sizePx = (widthPx, heightPx)
    self.scale = scale
    if let b = band {
      let to = dragonBandAt(b, widthPx, heightPx, scale, readings)
      if to != bandIndex {
        bandIndex = to
        set(b.state, to)
        return
      }
    }
    onChange?()
  }

  /// MQ-R2 (T067 R9): new device readings: the band of the root on them, through env#band's delta when it moves (whose setter lays
  /// out once); the same band needs no layout, as the viewport has not changed.
  public func setReadings(_ r: DragonReadings) {
    readings = r
    guard let b = band, scale > 0 else { return }
    let to = dragonBandAt(b, sizePx.0, sizePx.1, scale, readings)
    if to != bandIndex {
      bandIndex = to
      set(b.state, to)
    }
  }
}

/// A state machine on screen: the Dragon views of its live records, laid out with the engine input it last laid out, in a stage.
/// Every committed setter rebuilds the views from the records, lays them out and swaps them in for the previous ones, so a typed
/// setter call changes what is on screen.
public final class DragonStateMount {
  public let machine: DragonStateMachine
  public private(set) var tree = DragonTree()
  public private(set) var renders = 0
  /// MQ-R1: the Dragon root view the tree is laid out in; its own size is the environment (T067 R6).
  public let media: DragonMediaRoot
  private let stage: UIView
  private let measurer: TextMeasurer
  private let scale: Double
  private let bridge: DragonBridge

  /// MQ-R2: the platform readings' observer, and whether a script injected its own (the platform then no longer reaches the machine).
  private var observer: DragonReadingsObserver?
  public private(set) var injected = false

  /// size: the media root's size in CSS px; the machine takes the platform's readings and the band of the size before the first render.
  public init(machine: DragonStateMachine, stage: UIView, measurer: TextMeasurer, scale: Double, bridge: DragonBridge, size: (Double, Double)) {
    self.machine = machine; self.stage = stage; self.measurer = measurer; self.scale = scale; self.bridge = bridge
    machine.readings = DragonReadings.platform()
    media = DragonMediaRoot(scale: scale)
    stage.addSubview(media)
    media.frame = CGRect(x: 0, y: 0, width: CGFloat(size.0), height: CGFloat(size.1))
    media.layoutIfNeeded()
    machine.resize(media.sizePx.0, media.sizePx.1, css: size, scale: scale)
    render()
    machine.onChange = { [weak self] in self?.render() }
    media.onSize = { [weak self] w, h, cw, ch in
      guard let self = self else { return }
      self.machine.resize(w, h, css: (cw, ch), scale: self.scale)
    }
    observer = DragonReadingsObserver { [weak self] in
      guard let self = self, !self.injected else { return }
      self.machine.setReadings(DragonReadings.platform())
    }
  }

  /// MQ-R2: a script's env step: the readings it names, exactly, from now on.
  public func inject(_ r: DragonReadings) {
    injected = true
    machine.setReadings(r)
  }

  /// A script's resize step: the media root takes the new size, and its own layoutSubviews hands it to the machine.
  public func resize(_ width: Double, _ height: Double) {
    media.frame = CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height))
    media.layoutIfNeeded()
  }

  private func render() {
    let t = DragonTree()
    machine.build(t)
    media.addSubview(t.root)
    do {
      try t.apply(machine.input(scale), measurer: measurer, scale: scale, bridge: bridge)
    } catch {
      fatalError("dragon: the state mount could not lay out assignment \(machine.current): \(error)")
    }
    tree.root.removeFromSuperview()
    tree = t
    renders += 1
  }
}

/// A case script: its case (identity and expected digests, the viewport it ends at), its start size and its steps, which run on a
/// DragonStateMount through the setters and the media root.
public struct DragonStateScript {
  public let dragonCase: DragonCase
  public let make: () -> DragonStateMachine
  public let start: (Double, Double)
  public let steps: [DragonScriptStep]

  /// Runs the steps on a mount; each set goes through the setter and each resize through the media root, so the mount re-renders.
  public func run(_ m: DragonStateMount) {
    for s in steps {
      switch s {
      case .set(let a, let b): m.machine.set(a, b)
      case .advance(let ms): m.machine.clock.advance(ms)
      case .resize(let w, let h): m.resize(w, h)
      case .env(let reading, let v): m.inject(reading == 0 ? m.machine.readings.pointing(touch: v == 1) : m.machine.readings.motion(reduce: v == 1))
      case .dump: break
      }
    }
  }
}

/// A case script as a device case. Its views come only from a DragonStateMount, so its case builds nothing by itself.
public func dragonStateScriptCase(id: String, fixture: String, direction: String, compilerDigest: String, viewport: (width: Double, height: Double), start: (Double, Double), expectedDigests: [Double: String], make: @escaping () -> DragonStateMachine, steps: [DragonScriptStep]) -> DragonStateScript {
  let c = DragonCase(id: id, fixture: fixture, direction: direction, compilerDigest: compilerDigest, viewport: viewport, expectedDigests: expectedDigests, input: { _ in
    fatalError("dragon: script \(id) runs on a state mount, not as a layout case")
  }, build: { _ in
    fatalError("dragon: script \(id) runs on a state mount, not as a layout case")
  })
  return DragonStateScript(dragonCase: c, make: make, start: start, steps: steps)
}
`;
}

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function kotlinSupportText(): string {
  return String.raw`package dev.dragon.views

import android.view.ViewGroup
import dev.dragon.layout.LayoutInput
import dev.dragon.layout.TextMeasurer

/** One write of a state node in Android vocabulary: exactly what the android-views case emitter writes for the program write. */
sealed class DragonStateWrite {
  class Background(val c: DragonRGBA8) : DragonStateWrite()
  class BorderStyles(val s: Array<String>) : DragonStateWrite()
  class BorderColors(val c: Array<DragonRGBA8>) : DragonStateWrite()
  object Clip : DragonStateWrite()
  class Text(val text: String, val family: String, val color: DragonRGBA8) : DragonStateWrite()
}

/** One node record of a state program. */
class DragonStateNode(val id: String, val parent: String?, val kind: String, val writes: List<DragonStateWrite>)

/** One assignment's delta over the base: removed node ids, changed or added node records, the order when it differs, the variant. */
class DragonStateDelta(val removed: List<String>, val changed: List<DragonStateNode>, val order: List<String>?, val variant: Int)

/** One case-script step: set state s to its v-th domain value, advance the virtual clock, or mark the dump. */
sealed class DragonScriptStep {
  class Set(val s: Int, val v: Int) : DragonScriptStep()
  class Advance(val ms: Double) : DragonScriptStep()
  /** MQ-R1: the media root's new size in CSS px. */
  class Resize(val width: Double, val height: Double) : DragonScriptStep()
  /** MQ-R2: inject device readings: reading 0 the pointer (v 0 a desktop mouse, 1 a touch screen), reading 1 reduced motion (v 1 reduce). */
  class Env(val reading: Int, val v: Int) : DragonScriptStep()
  object Dump : DragonScriptStep()
}

/** The finite-state runtime of one state program. */
class DragonStateMachine(
  val states: List<String>,
  val domains: List<List<String>>,
  private val base: List<DragonStateNode>,
  private val deltas: List<DragonStateDelta>,
  private val next: List<List<List<Int>>>,
  initial: Int,
  private val variants: List<(Double, Double, Double) -> LayoutInput>,
  private val skipRelayout: Boolean,
  viewport: Pair<Double, Double>,
  /** MQ-R1: the band table and env#band state of a band program; null for a program of one band. */
  val band: DragonBandBinding?,
  initialBand: Int,
) {
  private val baseById = HashMap<String, DragonStateNode>()
  val clock = DragonVirtualClock()
  /** The band of the current assignment, and the viewport (CSS px) the engine lays out at: the media root's size. */
  var bandIndex: Int = initialBand
    private set
  var viewport: Pair<Double, Double> = viewport
    private set
  /**
   * MQ-R2: the device readings the band lookup answers the device atoms from, and the media root's size in whole device px and its
   * scale, which a readings change looks the band up at.
   */
  var readings: DragonReadings = DragonReadings.DESKTOP
  private var sizePx: Pair<Double, Double> = Pair(0.0, 0.0)
  private var scale: Double = 0.0
  var current: Int = initial
    private set
  var laidOut: Int = deltas[initial].variant
    private set
  /** Called after every committed setter; a DragonStateMount uses it to rebuild and lay out the views on screen. */
  var onChange: (() -> Unit)? = null
  private val nodes = HashMap<String, DragonStateNode>()
  private var order: List<String> = emptyList()

  init {
    if (band != null && band.table.bands.size != domains[band.state].size) throw IllegalStateException("dragon: the band table has " + band.table.bands.size + " bands, env#band " + domains[band.state].size + " values")
    for (n in base) baseById[n.id] = n
    val d = deltas[initial]
    val removed = d.removed.toHashSet()
    for (n in base) if (!removed.contains(n.id)) nodes[n.id] = n
    for (n in d.changed) nodes[n.id] = n
    order = d.order ?: base.map { it.id }.filter { nodes.containsKey(it) }
  }

  /** Sets state s to its v-th domain value; an index out of range or an unreachable result fails before any change. */
  fun set(s: Int, v: Int) {
    if (s < 0 || s >= states.size) throw IllegalStateException("dragon: no state " + s + " (" + states.size + " states)")
    if (v < 0 || v >= domains[s].size) throw IllegalStateException("dragon: " + states[s] + ": value " + v + " is outside the domain " + domains[s])
    val to = next[current][s][v]
    if (to < 0) throw IllegalStateException("dragon: " + states[s] + " = " + domains[s][v] + " is unreachable from assignment " + current)
    val from = deltas[current]
    val d = deltas[to]
    val touched = HashSet<String>()
    touched.addAll(from.removed)
    for (n in from.changed) touched.add(n.id)
    touched.addAll(d.removed)
    for (n in d.changed) touched.add(n.id)
    val removed = d.removed.toHashSet()
    val changed = HashMap<String, DragonStateNode>()
    for (n in d.changed) changed[n.id] = n
    for (id in touched) {
      val n = if (removed.contains(id)) null else (changed[id] ?: baseById[id])
      if (n == null) nodes.remove(id) else nodes[id] = n
    }
    order = d.order ?: base.map { it.id }.filter { nodes.containsKey(it) }
    if (!skipRelayout && d.variant != laidOut) laidOut = d.variant
    current = to
    onChange?.invoke()
  }

  /** Sets a state by key to a domain value by key (the case scripts' untyped path); an unknown key fails. */
  fun set(state: String, value: String) {
    val s = states.indexOf(state)
    if (s < 0) throw IllegalStateException("dragon: no state " + state + "; the states are " + states)
    val v = domains[s].indexOf(value)
    if (v < 0) throw IllegalStateException("dragon: " + state + ": " + value + " is not in the domain " + domains[s])
    set(s, v)
  }

  /** Builds the Dragon views of the live node records, writing each as the case emitter does. */
  fun build(t: DragonTree) {
    for (id in order) {
      val n = nodes[id] ?: throw IllegalStateException("dragon: the state runtime orders " + id + ", which it does not hold")
      if (n.kind == "text") {
        val v = t.textNode(n.id, n.parent, n.kind)
        for (w in n.writes) {
          if (w !is DragonStateWrite.Text) throw IllegalStateException("dragon: text " + n.id + " holds a box write")
          v.dragonSetText(w.text, w.family, w.color)
        }
        continue
      }
      val v = t.boxNode(n.id, n.parent, n.kind)
      for (w in n.writes) {
        when (w) {
          is DragonStateWrite.Background -> dragonBackground(v, w.c)
          is DragonStateWrite.BorderStyles -> v.dragonBorderStyles = w.s
          is DragonStateWrite.BorderColors -> v.dragonBorderColors = w.c
          is DragonStateWrite.Clip -> v.dragonEnableClip()
          is DragonStateWrite.Text -> throw IllegalStateException("dragon: box " + n.id + " holds a text write")
        }
      }
    }
  }

  /** The engine input last laid out. */
  fun input(dpr: Double): LayoutInput = variants[laidOut](dpr, viewport.first, viewport.second)

  /**
   * MQ-R1 (T067 R5): one size change of the media root: its whole device px pick the band, its CSS px are the viewport. The new band
   * first, through env#band's delta when it changes (whose setter lays out once), else one layout at the new size.
   */
  fun resize(widthPx: Double, heightPx: Double, css: Pair<Double, Double>, scale: Double) {
    viewport = css
    sizePx = Pair(widthPx, heightPx)
    this.scale = scale
    val b = band
    if (b != null) {
      val to = dragonBandAt(b, widthPx, heightPx, scale, readings)
      if (to != bandIndex) {
        bandIndex = to
        set(b.state, to)
        return
      }
    }
    onChange?.invoke()
  }

  /**
   * MQ-R2 (T067 R9): new device readings: the band of the root on them, through env#band's delta when it moves (whose setter lays
   * out once); the same band needs no layout, as the viewport has not changed.
   */
  fun setReadings(r: DragonReadings) {
    readings = r
    val b = band ?: return
    if (scale <= 0.0) return
    val to = dragonBandAt(b, sizePx.first, sizePx.second, scale, readings)
    if (to != bandIndex) {
      bandIndex = to
      set(b.state, to)
    }
  }
}

/**
 * A state machine on screen: the Dragon views of its live records, laid out with the engine input it last laid out, in a stage.
 * Every committed setter rebuilds the views from the records, lays them out and swaps them in for the previous ones, so a typed
 * setter call changes what is on screen.
 */
class DragonStateMount(val machine: DragonStateMachine, private val stage: ViewGroup, private val measurer: TextMeasurer, private val scale: Double, private val bridge: DragonBridge, size: Pair<Double, Double>) {
  var tree: DragonTree = DragonTree(stage.context)
    private set
  var renders = 0
    private set
  /** MQ-R1: the Dragon root view the tree is laid out in; its own size is the environment (T067 R6). */
  val media = DragonMediaRoot(stage.context)
  /** The CSS size a script's resize step asked for, read by the next size change; null for a size the system set. */
  private var requested: Pair<Double, Double>? = size
  /** MQ-R2: the platform readings' observer, and whether a script injected its own (the platform then no longer reaches the machine). */
  private var observer: DragonReadingsObserver? = null
  var injected = false
    private set

  init {
    machine.readings = DragonReadings.platform(stage.context)
    stage.addView(media, ViewGroup.LayoutParams(pxOf(size.first), pxOf(size.second)))
    media.onSize = { w, h ->
      val css = requested ?: Pair(w / scale, h / scale)
      requested = null
      machine.resize(w, h, css, scale)
    }
    // The first size: laid out here, so the machine takes its band before the first render; the setter then renders nothing.
    media.layout(0, 0, pxOf(size.first), pxOf(size.second))
    render()
    machine.onChange = { render() }
    observer = DragonReadingsObserver(stage.context) {
      if (!injected) machine.setReadings(DragonReadings.platform(stage.context))
    }
  }

  /** MQ-R2: a script's env step: the readings it names, exactly, from now on. */
  fun inject(r: DragonReadings) {
    injected = true
    machine.setReadings(r)
  }

  /** Stops observing the platform readings, when the mount leaves the screen. */
  fun close() {
    observer?.close()
    observer = null
  }

  /** CSS px to the whole device px the view takes: ceil, as DragonTree.apply sizes the root. */
  private fun pxOf(css: Double): Int = kotlin.math.ceil(css * scale).toInt()

  /** A script's resize step: the media root takes the new size, and its own onSizeChanged hands it to the machine. */
  fun resize(width: Double, height: Double) {
    requested = Pair(width, height)
    // The stage's own LayoutParams type is kept (a FrameLayout measures its children with MarginLayoutParams; a plain
    // ViewGroup.LayoutParams set here would fail its next measure pass with a ClassCastException).
    val lp = media.layoutParams
    lp.width = pxOf(width)
    lp.height = pxOf(height)
    media.layoutParams = lp
    media.layout(media.left, media.top, media.left + pxOf(width), media.top + pxOf(height))
  }

  private fun render() {
    val t = DragonTree(stage.context)
    machine.build(t)
    t.apply(machine.input(scale), measurer, scale, bridge)
    media.addView(t.root, ViewGroup.LayoutParams(t.root.dragonFrame[2], t.root.dragonFrame[3]))
    media.removeView(tree.root)
    tree = t
    renders++
  }
}

/** A case script: its case (identity and expected digests) and its steps, which run on a DragonStateMount through the setters. */
class DragonStateScript(val dragonCase: DragonCase, val make: () -> DragonStateMachine, val start: Pair<Double, Double>, val steps: List<DragonScriptStep>) {
  /** Runs the steps on a mount; each set goes through the setter and each resize through the media root, so the mount re-renders. */
  fun run(m: DragonStateMount) {
    for (s in steps) {
      when (s) {
        is DragonScriptStep.Set -> m.machine.set(s.s, s.v)
        is DragonScriptStep.Advance -> m.machine.clock.advance(s.ms)
        is DragonScriptStep.Resize -> m.resize(s.width, s.height)
        is DragonScriptStep.Env -> m.inject(if (s.reading == 0) m.machine.readings.pointing(s.v == 1) else m.machine.readings.motion(s.v == 1))
        is DragonScriptStep.Dump -> {}
      }
    }
  }
}

/** A case script as a device case. Its views come only from a DragonStateMount, so its case builds nothing by itself. */
fun dragonStateScriptCase(id: String, fixture: String, direction: String, compilerDigest: String, width: Double, height: Double, start: Pair<Double, Double>, expectedDigests: Map<Double, String>, make: () -> DragonStateMachine, steps: List<DragonScriptStep>): DragonStateScript {
  val c = DragonCase(id, fixture, direction, compilerDigest, width, height, expectedDigests, { _ ->
    throw IllegalStateException("dragon: script " + id + " runs on a state mount, not as a layout case")
  }, { _ ->
    throw IllegalStateException("dragon: script " + id + " runs on a state mount, not as a layout case")
  })
  return DragonStateScript(c, make, start, steps)
}
`;
}

/** The state runtime support source of a backend. */
export function stateSupport(backend: NativeBackend, header: (what: string) => string): GeneratedFile {
  return backend === 'uikit'
    ? { path: 'Support/DragonState.swift', text: header('the finite-state runtime and case-script cases') + swiftSupportText() }
    : { path: 'kotlin/dev/dragon/views/DragonState.kt', text: header('the finite-state runtime and case-script cases') + kotlinSupportText() };
}

// ---------------------------------------------------------------- per state program sources

type Lang = 'swift' | 'kotlin';

const rgba = (c: Rgba8): string => `DragonRGBA8(${c.r}, ${c.g}, ${c.b}, ${c.alpha})`;

function nodeLit(lang: Lang, n: ProgramNode): string {
  const q = (s: string): string => stringLit(lang, s);
  const writes: string[] = [];
  for (const w of n.writes) {
    switch (w.kind) {
      case 'background-color':
        writes.push(lang === 'swift' ? `.background(${rgba(w.color)})` : `DragonStateWrite.Background(${rgba(w.color)})`);
        break;
      case 'border-styles':
        writes.push(lang === 'swift' ? `.borderStyles([${w.styles.map(q).join(', ')}])` : `DragonStateWrite.BorderStyles(arrayOf(${w.styles.map(q).join(', ')}))`);
        break;
      case 'border-colors':
        writes.push(lang === 'swift' ? `.borderColors([${w.colors.map(rgba).join(', ')}])` : `DragonStateWrite.BorderColors(arrayOf(${w.colors.map(rgba).join(', ')}))`);
        break;
      case 'padding-box-clip':
        writes.push(lang === 'swift' ? '.clip' : 'DragonStateWrite.Clip');
        break;
      case 'font': {
        const color = n.writes.find((x) => x.kind === 'text-color');
        if (color === undefined || color.kind !== 'text-color') throw new StateEmitError(`${n.id}: a text run without a colour`);
        writes.push(lang === 'swift' ? `.text(${q(n.text ?? '')}, ${q(w.font.family)}, ${rgba(color.color)})` : `DragonStateWrite.Text(${q(n.text ?? '')}, ${q(w.font.family)}, ${rgba(color.color)})`);
        break;
      }
      case 'border-widths':
      case 'text-color':
        break;
      case 'transform':
        // PNT2 integration: a state record holds no transform write; a transformed node of a state program is refused here, by name.
        throw new StateEmitError(`${n.id}: a transform in a state program has no state-node write (PNT2 writes transforms on the static program only)`);
      case 'replaced-image':
      case 'foreign-view':
        // REPL-a draws an image or hosts a web view from its own paint stage; the state runtime does not rebuild either yet.
        throw new StateEmitError(`${n.id}: a ${w.kind} write in a state program is not supported yet (REPL-a images and web views under SELD-R states)`);
      default: {
        // A write kind added to the program but not here would otherwise vanish from the generated record without a word.
        const unknown: never = w;
        throw new StateEmitError(`${n.id}: no state-node write for ${JSON.stringify(unknown)}`);
      }
    }
  }
  if (n.kind === 'text' && !writes.some((x) => x.startsWith(lang === 'swift' ? '.text(' : 'DragonStateWrite.Text('))) throw new StateEmitError(`${n.id}: a text node without a text run`);
  const parent = n.parent === null ? (lang === 'swift' ? 'nil' : 'null') : q(n.parent);
  return lang === 'swift' ? `DragonStateNode(${q(n.id)}, ${parent}, ${q(n.kind)}, [${writes.join(', ')}])` : `DragonStateNode(${q(n.id)}, ${parent}, ${q(n.kind)}, listOf(${writes.join(', ')}))`;
}

const list = (lang: Lang, items: readonly string[]): string => (lang === 'swift' ? `[${items.join(', ')}]` : `listOf(${items.join(', ')})`);

function deltaLit(lang: Lang, d: StateDelta): string {
  const q = (s: string): string => stringLit(lang, s);
  const order = d.order === null ? (lang === 'swift' ? 'nil' : 'null') : list(lang, d.order.map(q));
  const removed = d.removed.length === 0 && lang === 'kotlin' ? 'emptyList()' : list(lang, d.removed.map(q));
  const changed = d.changed.length === 0 && lang === 'kotlin' ? 'emptyList()' : list(lang, d.changed.map((n) => nodeLit(lang, n)));
  return `DragonStateDelta(${removed}, ${changed}, ${order}, ${d.variant})`;
}

/** A state key as doc-comment text: one line, and never the end of a block comment. */
const commentText = (s: string): string => s.replace(/[\r\n\u2028\u2029]/g, ' ').replace(/\*\//g, '* /');

/** An identifier from any text: letters, digits and _, never a keyword (every name carries a prefix). */
const ident = (s: string): string => s.replace(/[^A-Za-z0-9]/g, '_');

/** The typed setter names of a state program: one per state, and the enum case of each domain value (unique per state). */
export function typedSetters(sp: StateProgram): { readonly name: string; readonly boolean: boolean; readonly cases: readonly string[] }[] {
  const names = new Set<string>();
  return sp.states.map((s) => {
    let name = `set_${ident(s.instance)}_${ident(s.state)}`;
    while (names.has(name)) name += '_';
    names.add(name);
    // A Bool setter needs both values reachable: with only one, the other argument would name no domain value.
    const boolean = s.domain.length === 2 && s.domain.includes(true) && s.domain.includes(false);
    const seen = new Set<string>();
    const cases = s.domain.map((v) => {
      let c = `v_${ident(v === null ? 'null' : String(v))}`;
      while (seen.has(c)) c += '_';
      seen.add(c);
      return c;
    });
    return { name, boolean, cases };
  });
}

function stepLit(lang: Lang, sp: StateProgram, id: string, step: ScriptStep): string {
  switch (step.kind) {
    case 'set': {
      const s = sp.states.findIndex((x) => x.key === step.state);
      const state = sp.states[s];
      if (state === undefined) throw new StateEmitError(`${id}: no state ${step.state}`);
      const v = state.domain.findIndex((d) => valueKey(d) === valueKey(step.value));
      if (v < 0) throw new StateEmitError(`${id}: ${step.state} has no value ${valueKey(step.value)}`);
      return lang === 'swift' ? `.set(${s}, ${v})` : `DragonScriptStep.Set(${s}, ${v})`;
    }
    case 'advance':
      if (!Number.isFinite(step.ms) || step.ms < 0) throw new StateEmitError(`${id}: advance(${step.ms}) is not a finite, non-negative step`);
      return lang === 'swift' ? `.advance(${doubleLit(step.ms)})` : `DragonScriptStep.Advance(${doubleLit(step.ms)})`;
    case 'resize':
      if (![step.width, step.height].every((v) => Number.isFinite(v) && v > 0)) throw new StateEmitError(`${id}: resize(${step.width}, ${step.height}) is not a positive size`);
      return lang === 'swift' ? `.resize(${doubleLit(step.width)}, ${doubleLit(step.height)})` : `DragonScriptStep.Resize(${doubleLit(step.width)}, ${doubleLit(step.height)})`;
    case 'env': {
      const reading = step.reading === 'pointer' ? 0 : 1;
      const v = step.value === 'touch' || step.value === 'reduce' ? 1 : 0;
      return lang === 'swift' ? `.env(${reading}, ${v})` : `DragonScriptStep.Env(${reading}, ${v})`;
    }
    case 'dump':
      return lang === 'swift' ? '.dump' : 'DragonScriptStep.Dump';
    case 'tap':
      throw new StateEmitError(`${id}: tap(${step.x}, ${step.y}) needs the device hit runtime (the device-hit lane), which is not emitted yet`);
  }
}

function machineSource(lang: Lang, e: StateEmit, k: number, faults: StateFaults): string {
  const q = (s: string): string => stringLit(lang, s);
  const sp = e.program;
  const p = `dragonStates${k}`;
  const out: string[] = [`// state program ${commentText(e.id)} (${sp.assignments.length} assignments, ${sp.variants.length} layout variants)`];
  const variantFns: string[] = [];
  sp.variants.forEach((variant, j) => {
    const input = inputFunctions(lang, variant.root, `${p}V${j}`);
    out.push(...input.decls);
    const fn = `${p}Input${j}`;
    variantFns.push(lang === 'swift' ? fn : `::${fn}`);
    // MQ-R1: the viewport is the machine's (the media root's CSS size), not a literal.
    out.push(lang === 'swift'
      ? `private func ${fn}(_ dpr: Double, _ vw: Double, _ vh: Double) -> LayoutInput {\n  return LayoutInput(Viewport(vw, vh), dpr, ${liveEnvironmentArgs('vw', 'vh', variant.rootFontSize)}, ${input.root})\n}`
      : `private fun ${fn}(dpr: Double, vw: Double, vh: Double): LayoutInput = LayoutInput(Viewport(vw, vh), dpr, ${liveEnvironmentArgs('vw', 'vh', variant.rootFontSize)}, ${input.root})`);
  });
  // Every table is its own typed constant, so no single literal grows past what the type checkers handle quickly.
  const decl = (name: string, type: string, value: string): string => (lang === 'swift' ? `private let ${name}: ${type} = ${value}` : `private val ${name}: ${type} = ${value}`);
  const kt = lang === 'kotlin';
  out.push(decl(`${p}States`, kt ? 'List<String>' : '[String]', list(lang, sp.states.map((s) => q(s.key)))));
  out.push(decl(`${p}Domains`, kt ? 'List<List<String>>' : '[[String]]', list(lang, sp.states.map((s) => list(lang, s.domain.map((v) => q(valueKey(v))))))));
  sp.base.nodes.forEach((n, i) => out.push(decl(`${p}Node${i}`, 'DragonStateNode', nodeLit(lang, n))));
  out.push(decl(`${p}Base`, kt ? 'List<DragonStateNode>' : '[DragonStateNode]', list(lang, sp.base.nodes.map((_, i) => `${p}Node${i}`))));
  sp.deltas.forEach((d, i) => out.push(decl(`${p}Delta${i}`, 'DragonStateDelta', deltaLit(lang, d))));
  out.push(decl(`${p}Deltas`, kt ? 'List<DragonStateDelta>' : '[DragonStateDelta]', list(lang, sp.deltas.map((_, i) => `${p}Delta${i}`))));
  out.push(decl(`${p}Next`, kt ? 'List<List<List<Int>>>' : '[[[Int]]]', list(lang, sp.next.map((a) => list(lang, a.map((st) => list(lang, st.map(String))))))));
  const skip = faults.setterSkipsRelayout ? 'true' : 'false';
  // MQ-R1: a band program carries its band table and env#band's index; its initial band is the initial assignment's.
  const bandState = sp.states.findIndex((s) => s.key === BAND_KEY);
  if ((bandState >= 0) !== (e.band !== undefined)) throw new StateEmitError(`${e.id}: a band program needs its band table, and only a band program has one`);
  const band = e.band === undefined ? (lang === 'swift' ? 'nil' : 'null') : `DragonBandBinding(${p}Bands, ${bandState})`;
  const initialBand = bandState < 0 ? 0 : (((sp.assignments[sp.initial] as StateProgram['assignments'][number]).assignment.find((a) => a.state.instance === '@env')?.value as number | undefined) ?? 0);
  if (e.band !== undefined) out.push(decl(`${p}Bands`, 'BandTable', bandTableLit(lang, e.band)));
  if (lang === 'swift') {
    out.push(`/// A fresh runtime of state program ${commentText(e.id)} at its initial assignment.`);
    out.push(`public func ${p}Machine() -> DragonStateMachine {\n  return DragonStateMachine(states: ${p}States, domains: ${p}Domains, base: ${p}Base, deltas: ${p}Deltas, next: ${p}Next, initial: ${sp.initial}, variants: ${list(lang, variantFns)}, skipRelayout: ${skip}, viewport: (${doubleLit(e.viewport.width)}, ${doubleLit(e.viewport.height)}), band: ${band}, initialBand: ${initialBand})\n}`);
  } else {
    out.push(`/** A fresh runtime of state program ${commentText(e.id)} at its initial assignment. */`);
    out.push(`fun ${p}Machine(): DragonStateMachine =\n  DragonStateMachine(${p}States, ${p}Domains, ${p}Base, ${p}Deltas, ${p}Next, ${sp.initial}, ${list(lang, variantFns)}, ${skip}, Pair(${doubleLit(e.viewport.width)}, ${doubleLit(e.viewport.height)}), ${band}, ${initialBand})`);
  }
  // The typed setters (decision 17): booleans for boolean domains, an enum per other domain.
  const setters = typedSetters(sp);
  const cls = `DragonStates${k}`;
  const body: string[] = [];
  setters.forEach((s, i) => {
    const state = sp.states[i] as StateProgram['states'][number];
    // MQ-R1 (T067 R5): env#band is set by the media root's size, never by the app, so it has no typed setter.
    if (state.key === BAND_KEY) return;
    if (s.boolean) {
      const t = state.domain.findIndex((v) => v === true);
      const f = state.domain.findIndex((v) => v === false);
      body.push(lang === 'swift'
        ? `  /// ${commentText(state.key)}\n  public func ${s.name}(_ v: Bool) { machine.set(${i}, v ? ${t} : ${f}) }`
        : `  /** ${commentText(state.key)} */\n  fun ${s.name}(v: Boolean) = machine.set(${i}, if (v) ${t} else ${f})`);
      return;
    }
    const en = `${cls}_${s.name.slice(4)}`;
    body.push(lang === 'swift'
      ? `  /// ${commentText(state.key)}\n  public func ${s.name}(_ v: ${en}) { machine.set(${i}, v.rawValue) }`
      : `  /** ${commentText(state.key)} */\n  fun ${s.name}(v: ${en}) = machine.set(${i}, v.ordinal)`);
    out.push(lang === 'swift'
      ? `public enum ${en}: Int { ${s.cases.map((c, j) => `case ${c} = ${j}`).join('; ')} }`
      : `enum class ${en} { ${s.cases.join(', ')} }`);
  });
  out.push(lang === 'swift'
    ? `/// The typed state API of ${commentText(e.id)}.\npublic final class ${cls} {\n  public let machine = ${p}Machine()\n  public init() {}\n${body.join('\n')}\n}`
    : `/** The typed state API of ${commentText(e.id)}. */\nclass ${cls} {\n  val machine = ${p}Machine()\n${body.join('\n')}\n}`);
  e.scripts.forEach((sc, j) => {
    const steps = list(lang, sc.steps.map((st) => stepLit(lang, sp, sc.id, st)));
    // MQ-R1: a resize script starts at its own size and ends at another; the case's viewport is the one it ends at.
    const start = sc.start ?? e.viewport;
    const end = sc.viewport ?? e.viewport;
    if (lang === 'swift') {
      // An empty Swift dictionary literal is [:] (device-env's script has no expected digests).
      const digests = sc.expectedDigests.map((d) => `${doubleLit(d.dpr)}: ${q(d.sha256)}`).join(', ');
      out.push(`let ${p}Script${j} = dragonStateScriptCase(id: ${q(sc.id)}, fixture: ${q(e.fixture)}, direction: ${q(e.direction)}, compilerDigest: ${q(e.compilerDigest)}, viewport: (width: ${doubleLit(end.width)}, height: ${doubleLit(end.height)}), start: (${doubleLit(start.width)}, ${doubleLit(start.height)}), expectedDigests: [${digests === '' ? ':' : digests}], make: ${p}Machine, steps: ${steps})`);
    } else {
      const digests = sc.expectedDigests.map((d) => `${doubleLit(d.dpr)} to ${q(d.sha256)}`).join(', ');
      out.push(`val ${p}Script${j} = dragonStateScriptCase(${q(sc.id)}, ${q(e.fixture)}, ${q(e.direction)}, ${q(e.compilerDigest)}, ${doubleLit(end.width)}, ${doubleLit(end.height)}, Pair(${doubleLit(start.width)}, ${doubleLit(start.height)}), mapOf(${digests}), ::${p}Machine, ${steps})`);
    }
  });
  return out.join('\n');
}

/**
 * The generated state program sources of a backend and the script case table (dragonStateCaseTable), which the host looks cases up
 * in beside dragonCaseTable. faults plants setterSkipsRelayout in the emitted machines.
 */
export function emitStatePrograms(backend: NativeBackend, emits: readonly StateEmit[], faults: StateFaults = NO_STATE_FAULTS): GeneratedFile[] {
  const lang: Lang = backend === 'uikit' ? 'swift' : 'kotlin';
  const generated = `// GENERATED by dragon emit/runtime/state.ts (${STATE_RUNTIME_VERSION}; program ${PROGRAM_VERSIONS[backend]}). Do not edit.\n`;
  const header = lang === 'swift' ? `${generated}import UIKit\n\n` : `${generated}package dev.dragon.cases\n\nimport dev.dragon.layout.*\nimport dev.dragon.views.*\n\n`;
  const ids = emits.flatMap((e) => e.scripts.map((s) => s.id));
  if (new Set(ids).size !== ids.length) throw new StateEmitError('two case scripts share an id');
  const files = emits.map((e, k): GeneratedFile => (lang === 'swift'
    ? { path: `Cases/DragonStates${String(k).padStart(3, '0')}.swift`, text: `${header}${machineSource(lang, e, k, faults)}\n` }
    : { path: `kotlin/dev/dragon/cases/DragonStates${String(k).padStart(3, '0')}.kt`, text: `${header}${machineSource(lang, e, k, faults)}\n` }));
  const scripts = emits.flatMap((e, k) => e.scripts.map((_, j) => `dragonStates${k}Script${j}`));
  files.push(lang === 'swift'
    ? { path: 'Cases/DragonStateCaseTable.swift', text: `${header}/// Every case script, in state program order.\npublic let dragonStateCaseList: [DragonStateScript] = [${scripts.join(', ')}]\n\npublic let dragonStateCaseTable: [String: DragonStateScript] = Dictionary(uniqueKeysWithValues: dragonStateCaseList.map { ($0.dragonCase.id, $0) })\n` }
    : { path: 'kotlin/dev/dragon/cases/DragonStateCaseTable.kt', text: `${header}/** Every case script, in state program order. */\nval dragonStateCaseList: List<DragonStateScript> by lazy { listOf(${scripts.join(', ')}) }\n\nval dragonStateCaseTable: Map<String, DragonStateScript> by lazy { dragonStateCaseList.associateBy { it.dragonCase.id } }\n` });
  return files;
}

// ---------------------------------------------------------------- the web attribute program

/** One assignment's class attribute per element address (null: the element carries no class). */
export type WebClassTable = ReadonlyMap<string, string | null>;

export type WebStateProgram = {
  readonly states: readonly string[];
  readonly domains: readonly (readonly string[])[];
  readonly initial: number;
  readonly next: StateProgram['next'];
  /** Every element address any assignment classes, sorted, and per assignment the class of each (null for none). */
  readonly elements: readonly string[];
  readonly classes: readonly (readonly (string | null)[])[];
};

/** The web attribute program of a state program: the class attribute of every element in every assignment. */
export function webStateProgram(sp: StateProgram, tables: readonly WebClassTable[]): WebStateProgram {
  if (tables.length !== sp.assignments.length) throw new StateEmitError(`${tables.length} class tables for ${sp.assignments.length} assignments`);
  const elements = [...new Set(tables.flatMap((t) => [...t.keys()]))].sort();
  return {
    states: sp.states.map((s) => s.key),
    domains: sp.states.map((s) => s.domain.map(valueKey)),
    initial: sp.initial,
    next: sp.next,
    elements,
    classes: tables.map((t) => elements.map((a) => t.get(a) ?? null)),
  };
}

/**
 * The web runtime as an ES module: createDragonStates(elementOf) applies the initial assignment's class attributes and returns
 * set(state, value), which validates before any mutation (every element it writes included) and rewrites only the class attributes
 * that change.
 */
export function webStateModule(w: WebStateProgram): string {
  return `// GENERATED by dragon emit/runtime/state.ts (${STATE_RUNTIME_VERSION}). Do not edit.
const P = ${JSON.stringify(w)};
export function createDragonStates(elementOf) {
  let current = P.initial;
  // Every element is looked up before any attribute is written, so a missing element fails with nothing changed.
  const apply = (from, to) => {
    const writes = [];
    P.elements.forEach((address, i) => {
      const c = P.classes[to][i];
      if (from !== null && P.classes[from][i] === c) return;
      const el = elementOf(address);
      if (el === null || el === undefined) throw new Error('dragon: no element ' + address);
      writes.push([el, c]);
    });
    for (const [el, c] of writes) if (c === null) el.removeAttribute('class'); else el.setAttribute('class', c);
  };
  apply(null, current);
  return {
    get assignment() { return current; },
    set(state, value) {
      const s = P.states.indexOf(state);
      if (s < 0) throw new Error('dragon: no state ' + state);
      const v = P.domains[s].indexOf(JSON.stringify(value));
      if (v < 0) throw new Error('dragon: ' + state + ': ' + JSON.stringify(value) + ' is not in the domain');
      const to = P.next[current][s][v];
      if (to < 0) throw new Error('dragon: ' + state + ' = ' + JSON.stringify(value) + ' is unreachable');
      apply(current, to);
      current = to;
    },
  };
}
`;
}
