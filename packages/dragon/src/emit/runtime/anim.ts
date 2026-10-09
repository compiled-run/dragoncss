// The native animation runtime of ANIM-b1 (notes/T065-anim-b-spec.md R2, R3, R4, R7, R9, R16): the compiled animation tables of
// a state program as typed literals of the translated engine (the device never parses CSS or JSON), and the support glue that
// runs the translated rt-animator.ts over them on a mounted state machine. The machine raises one style change event per setter
// call (R4) and moves held times only by the clock (R2); each render writes the frame's colours into the node records' writes and
// patches its lengths into the engine input (R16). The virtual driver is the case scripts' advance(ms); the display driver
// (CADisplayLink, Choreographer) runs only while the animator is busy and only on a mount that asks for it, so a lane never
// reads the wall clock (plant laneUsesWallClock). No platform animation API is used.
import type { AnimTables, EasingCode, ValueCode } from '@dragon/layout';
import type { GeneratedFile } from '../../types.ts';
import { doubleLit, stringLit } from '../native-support.ts';
import type { Lang } from '../native-support.ts';

export const ANIM_RUNTIME_VERSION = 'dragon.runtime-anim/1';

export class AnimEmitError extends Error {}

/**
 * The constructor parameters of every table class of rt-animator.ts, in declaration order (the translated classes take their
 * fields positionally); test/anim-runtime.test.ts holds these to the generated Swift and Kotlin constructors.
 */
export const TABLE_FIELDS = {
  EasingCode: ['kind', 'x1', 'y1', 'x2', 'y2', 'steps', 'position'],
  ValueCode: ['kind', 'r', 'g', 'b', 'alpha', 'px', 'percent', 'calc'],
  ListingCode: ['present', 'mode', 'delay', 'duration', 'easing'],
  SlotTable: ['node', 'property', 'kind', 'range', 'values', 'listings'],
  EntryCode: ['name', 'hasKeyframes', 'paused', 'delay', 'duration', 'iterations', 'direction', 'fill', 'easing'],
  AnimationTable: ['node', 'lists'],
  KeyframeValue: ['property', 'value'],
  KeyframeBlock: ['offsets', 'hasEasing', 'easing', 'values'],
  KeyframesTable: ['name', 'blocks'],
  RenderedTable: ['node', 'values'],
  BaseTable: ['node', 'property', 'kind', 'range', 'values'],
  TrackRef: ['node', 'property'],
  ClosureTable: ['source', 'writes'],
  AnimTables: ['assignments', 'slots', 'animations', 'keyframes', 'rendered', 'bases', 'closure'],
} as const;

/** The field counts of the fault records the glue builds with every fault off (rt-easing.ts RtFaults, rt-animator.ts AnimatorFaults). */
// A function, not only a constant: native-support.ts emits the support text while this module may still be initialising (import cycle).
function faultArity(): { readonly RtFaults: number; readonly AnimatorFaults: number } {
  return { RtFaults: 14, AnimatorFaults: 4 };
}
export const FAULT_ARITY = faultArity();

type TableClass = keyof typeof TABLE_FIELDS;

/** A field's value as a literal: strings are JsString, numbers Double (an infinite iteration count included), booleans Bool. */
function scalar(lang: Lang, where: string, v: unknown): string {
  if (typeof v === 'string') return lang === 'swift' ? `JsString(${stringLit(lang, v)})` : stringLit(lang, v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (v === Infinity) return lang === 'swift' ? 'Double.infinity' : 'Double.POSITIVE_INFINITY';
    if (!Number.isFinite(v)) throw new AnimEmitError(`${where}: ${v} is not a table number`);
    return doubleLit(v);
  }
  throw new AnimEmitError(`${where}: ${JSON.stringify(v)} is not a string, number or boolean`);
}

const array = (lang: Lang, type: string, items: readonly string[]): string => (lang === 'swift' ? `JsArray<${type}>([${items.join(', ')}])` : `jsArrayOf<${type}>(${items.join(', ')})`);

/** One record of a table class as a constructor call, its fields checked against TABLE_FIELDS (no missing or extra field). */
function record(lang: Lang, cls: TableClass, where: string, o: object, field: (name: string, v: unknown) => string | null): string {
  const fields = TABLE_FIELDS[cls] as readonly string[];
  const keys = Object.keys(o);
  const extra = keys.filter((k) => !fields.includes(k));
  const missing = fields.filter((k) => !keys.includes(k));
  if (extra.length > 0 || missing.length > 0) {
    const what = [...(missing.length > 0 ? [`lacks ${missing.join(', ')}`] : []), ...(extra.length > 0 ? [`has unknown ${extra.join(', ')}`] : [])];
    throw new AnimEmitError(`${where}: ${cls} ${what.join(' and ')}`);
  }
  const args = fields.map((f) => field(f, (o as Record<string, unknown>)[f]) ?? scalar(lang, `${where}.${f}`, (o as Record<string, unknown>)[f]));
  return `${cls}(${args.join(', ')})`;
}

const easingLit = (lang: Lang, where: string, e: EasingCode): string => record(lang, 'EasingCode', where, e, () => null);
const valueLit = (lang: Lang, where: string, v: ValueCode): string => record(lang, 'ValueCode', where, v, () => null);
const numbers = (lang: Lang, where: string, xs: readonly number[]): string => array(lang, 'Double', xs.map((x, i) => scalar(lang, `${where}[${i}]`, x)));
const booleans = (lang: Lang, where: string, xs: readonly boolean[]): string => array(lang, lang === 'swift' ? 'Bool' : 'Boolean', xs.map((x, i) => scalar(lang, `${where}[${i}]`, x)));
const values = (lang: Lang, where: string, xs: readonly ValueCode[]): string => array(lang, 'ValueCode', xs.map((x, i) => valueLit(lang, `${where}[${i}]`, x)));
const trackLit = (lang: Lang, where: string, t: object): string => record(lang, 'TrackRef', where, t, () => null);

/**
 * The tables as typed literals: one declaration per top-level table record (so no single literal grows past what the type checkers
 * handle quickly) and the AnimTables expression over them. prefix names the declarations.
 */
export function animTablesLit(lang: Lang, t: AnimTables, prefix: string): { readonly decls: readonly string[]; readonly expr: string } {
  const decls: string[] = [];
  const decl = (name: string, type: string, value: string): string => {
    decls.push(lang === 'swift' ? `private let ${name}: ${type} = ${value}` : `private val ${name}: ${type} = ${value}`);
    return name;
  };
  const slots = t.slots.map((s, i) => decl(`${prefix}Slot${i}`, 'SlotTable', record(lang, 'SlotTable', `slots[${i}]`, s, (f, v) => {
    if (f === 'values') return values(lang, `slots[${i}].values`, v as ValueCode[]);
    if (f === 'listings') return array(lang, 'ListingCode', (v as AnimTables['slots'][number]['listings']).map((l, j) => record(lang, 'ListingCode', `slots[${i}].listings[${j}]`, l, (g, x) => (g === 'easing' ? easingLit(lang, `slots[${i}].listings[${j}].easing`, x as EasingCode) : null))));
    return null;
  })));
  const animations = t.animations.map((a, i) => decl(`${prefix}Animation${i}`, 'AnimationTable', record(lang, 'AnimationTable', `animations[${i}]`, a, (f, v) => {
    if (f !== 'lists') return null;
    const lists = (v as AnimTables['animations'][number]['lists']).map((list, j) => array(lang, 'EntryCode', list.map((e, k) => record(lang, 'EntryCode', `animations[${i}].lists[${j}][${k}]`, e, (g, x) => (g === 'easing' ? easingLit(lang, `animations[${i}].lists[${j}][${k}].easing`, x as EasingCode) : null)))));
    return array(lang, 'JsArray<EntryCode>', lists);
  })));
  const keyframes = t.keyframes.map((k, i) => decl(`${prefix}Keyframes${i}`, 'KeyframesTable', record(lang, 'KeyframesTable', `keyframes[${i}]`, k, (f, v) => {
    if (f !== 'blocks') return null;
    return array(lang, 'KeyframeBlock', (v as AnimTables['keyframes'][number]['blocks']).map((b, j) => record(lang, 'KeyframeBlock', `keyframes[${i}].blocks[${j}]`, b, (g, x) => {
      const at = `keyframes[${i}].blocks[${j}].${g}`;
      if (g === 'offsets') return numbers(lang, at, x as number[]);
      if (g === 'easing') return easingLit(lang, at, x as EasingCode);
      if (g === 'values') return array(lang, 'KeyframeValue', (x as AnimTables['keyframes'][number]['blocks'][number]['values']).map((kv, m) => record(lang, 'KeyframeValue', `${at}[${m}]`, kv, (h, y) => (h === 'value' ? valueLit(lang, `${at}[${m}].value`, y as ValueCode) : null))));
      return null;
    })));
  })));
  const rendered = t.rendered.map((r, i) => decl(`${prefix}Rendered${i}`, 'RenderedTable', record(lang, 'RenderedTable', `rendered[${i}]`, r, (f, v) => (f === 'values' ? booleans(lang, `rendered[${i}].values`, v as boolean[]) : null))));
  const bases = t.bases.map((b, i) => decl(`${prefix}Base${i}`, 'BaseTable', record(lang, 'BaseTable', `bases[${i}]`, b, (f, v) => (f === 'values' ? values(lang, `bases[${i}].values`, v as ValueCode[]) : null))));
  const closure = t.closure.map((c, i) => decl(`${prefix}Closure${i}`, 'ClosureTable', record(lang, 'ClosureTable', `closure[${i}]`, c, (f, v) => {
    if (f === 'source') return trackLit(lang, `closure[${i}].source`, v as object);
    if (f === 'writes') return array(lang, 'TrackRef', (v as AnimTables['closure'][number]['writes']).map((w, j) => trackLit(lang, `closure[${i}].writes[${j}]`, w)));
    return null;
  })));
  const expr = record(lang, 'AnimTables', 'tables', t, (f) => {
    switch (f) {
      case 'slots':
        return array(lang, 'SlotTable', slots);
      case 'animations':
        return array(lang, 'AnimationTable', animations);
      case 'keyframes':
        return array(lang, 'KeyframesTable', keyframes);
      case 'rendered':
        return array(lang, 'RenderedTable', rendered);
      case 'bases':
        return array(lang, 'BaseTable', bases);
      case 'closure':
        return array(lang, 'ClosureTable', closure);
      default:
        return null;
    }
  });
  return { decls, expr };
}

function falses(n: number): string {
  return Array.from({ length: n }, () => 'false').join(', ');
}

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function swiftText(): string {
  return String.raw`import UIKit

/// The animator of one mounted state machine: the translated rt-animator over the program's tables, with every fault off. inputs
/// are each assignment's engine input resolved for the environment at scale 1 (R14), where length endpoints come from.
public final class DragonAnimator {
  private let tables: AnimTables
  private var inputs: JsArray<LayoutInput>
  /// MQ-R1: the next event's after-change inputs, every assignment's at the media root's new size; nil without a size change.
  private var staged: JsArray<LayoutInput>?
  private let initial: Double
  private let faults = RtFaults(${falses(faultArity().RtFaults)})
  private let anim = AnimatorFaults(${falses(faultArity().AnimatorFaults)})
  private var state: AnimatorState
  private var entries = JsArray<FrameEntry>([])
  private var colors: [String: DragonRGBA8] = [:]

  /// Starts at assignment current (R7: CSS animations start at first style; no transition starts on it).
  public init(tables: AnimTables, inputs: [LayoutInput], initial: Int, current: Int) {
    self.tables = tables; self.inputs = JsArray(inputs); self.initial = Double(initial)
    if Double(inputs.count) != tables.assignments { fatalError("dragon: \(inputs.count) engine inputs for \(tables.assignments) assignments") }
    do {
      state = try rtAnimator_animatorStart(tables, self.inputs, Double(current), faults, anim)
    } catch {
      fatalError("dragon: the animator could not start: \(error)")
    }
    refresh()
  }

  /// MQ-R1: the inputs the next event's after-change style resolves against, after a size change of the media root.
  public func stage(_ after: [LayoutInput]) {
    if Double(after.count) != tables.assignments { fatalError("dragon: \(after.count) engine inputs for \(tables.assignments) assignments") }
    staged = JsArray(after)
  }

  /// R4: one style change event, the setter having moved the machine to assignment to; across a staged size change, the
  /// before-change style reads the old inputs and the after-change style the new ones (MQ-R1).
  public func event(_ to: Int) {
    let after = staged ?? inputs
    do { state = try rtAnimator_animatorRestyle(state, tables, inputs, after, initial, Double(to), faults, anim) } catch { fatalError("dragon: animator event to \(to): \(error)") }
    inputs = after
    staged = nil
    refresh()
  }

  /// R2: every running transition and animation moves by ms.
  public func advance(_ ms: Double) {
    do { state = try rtAnimator_animatorAdvance(state, tables, inputs, initial, ms, faults, anim) } catch { fatalError("dragon: animator advance(\(ms)): \(error)") }
    refresh()
  }

  /// R3: true while a transition runs or an animation is relevant; the display driver runs only then.
  public var busy: Bool {
    do { return try rtAnimator_animatorBusy(state) } catch { fatalError("dragon: animator busy: \(error)") }
  }

  private func refresh() {
    do {
      entries = try rtAnimator_animatorFrame(state, tables, faults)
      var out: [String: DragonRGBA8] = [:]
      for c in try rtAnimator_frameColors(entries, tables, anim).items {
        out[c.node.description + "|" + c.property.description] = DragonRGBA8(dragonCheckedInt(c.rgba.r, "red"), dragonCheckedInt(c.rgba.g, "green"), dragonCheckedInt(c.rgba.b, "blue"), dragonCheckedInt(c.rgba.alpha, "alpha"))
      }
      colors = out
    } catch {
      fatalError("dragon: animator frame: \(error)")
    }
  }

  /// The frame's colour of a node's property as the device draws it (R9 closure included), or nil where it does not animate.
  public func color(_ node: String, _ property: String) -> DragonRGBA8? { return colors[node + "|" + property] }

  /// The engine input with the frame's lengths patched in (R16); the input itself when nothing animates.
  public func patch(_ input: LayoutInput) -> LayoutInput {
    if entries.items.isEmpty { return input }
    do { return try rtAnimator_patchInput(input, entries, tables) } catch { fatalError("dragon: animator patch: \(error)") }
  }
}

/// The display driver (R3): CADisplayLink, Δ from successive target timestamps, up to the screen's maximum rate. tick gets Δ in ms
/// and returns whether to keep running.
public final class DragonDisplayDriver: NSObject {
  private var link: CADisplayLink?
  private var last: CFTimeInterval?
  private let tick: (Double) -> Bool

  public init(tick: @escaping (Double) -> Bool) { self.tick = tick }

  public var running: Bool { return link != nil }

  public func start() {
    if link != nil { return }
    let l = CADisplayLink(target: self, selector: #selector(step(_:)))
    let fps = Float(UIScreen.main.maximumFramesPerSecond)
    l.preferredFrameRateRange = CAFrameRateRange(minimum: min(30, fps), maximum: fps, preferred: fps)
    l.add(to: .main, forMode: .common)
    link = l
    last = nil
  }

  public func stop() {
    link?.invalidate()
    link = nil
    last = nil
  }

  @objc private func step(_ l: CADisplayLink) {
    let t = l.targetTimestamp
    let dt = last.map { (t - $0) * 1000 } ?? 0
    last = t
    if !tick(dt) { stop() }
  }
}
`;
}

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function kotlinText(): string {
  return String.raw`package dev.dragon.views

import android.view.Choreographer
import dev.dragon.layout.*

/**
 * The animator of one mounted state machine: the translated rt-animator over the program's tables, with every fault off. inputs
 * are each assignment's engine input resolved for the environment at scale 1 (R14), where length endpoints come from.
 */
class DragonAnimator(private val tables: AnimTables, inputs: List<LayoutInput>, initial: Int, current: Int) {
  private var inputs: JsArray<LayoutInput> = JsArray<LayoutInput>(inputs.size).also { it.addAll(inputs) }
  /** MQ-R1: the next event's after-change inputs, every assignment's at the media root's new size; null without a size change. */
  private var staged: JsArray<LayoutInput>? = null
  private val initial = initial.toDouble()
  private val faults = RtFaults(${falses(faultArity().RtFaults)})
  private val anim = AnimatorFaults(${falses(faultArity().AnimatorFaults)})
  private var state: AnimatorState
  private var entries: JsArray<FrameEntry> = jsArrayOf()
  private var colors: Map<String, DragonRGBA8> = emptyMap()

  init {
    if (inputs.size.toDouble() != tables.assignments) throw IllegalStateException("dragon: " + inputs.size + " engine inputs for " + tables.assignments + " assignments")
    state = rtAnimator_animatorStart(tables, this.inputs, current.toDouble(), faults, anim)
    refresh()
  }

  /** MQ-R1: the inputs the next event's after-change style resolves against, after a size change of the media root. */
  fun stage(after: List<LayoutInput>) {
    if (after.size.toDouble() != tables.assignments) throw IllegalStateException("dragon: " + after.size + " engine inputs for " + tables.assignments + " assignments")
    staged = JsArray<LayoutInput>(after.size).also { it.addAll(after) }
  }

  /**
   * R4: one style change event, the setter having moved the machine to assignment to; across a staged size change, the
   * before-change style reads the old inputs and the after-change style the new ones (MQ-R1).
   */
  fun event(to: Int) {
    val after = staged ?: inputs
    state = rtAnimator_animatorRestyle(state, tables, inputs, after, initial, to.toDouble(), faults, anim)
    inputs = after
    staged = null
    refresh()
  }

  /** R2: every running transition and animation moves by ms. */
  fun advance(ms: Double) {
    state = rtAnimator_animatorAdvance(state, tables, inputs, initial, ms, faults, anim)
    refresh()
  }

  /** R3: true while a transition runs or an animation is relevant; the display driver runs only then. */
  val busy: Boolean get() = rtAnimator_animatorBusy(state)

  private fun refresh() {
    entries = rtAnimator_animatorFrame(state, tables, faults)
    val out = HashMap<String, DragonRGBA8>()
    for (c in rtAnimator_frameColors(entries, tables, anim)) out[c.node + "|" + c.property] = DragonRGBA8(dragonCheckedInt(c.rgba.r, "red"), dragonCheckedInt(c.rgba.g, "green"), dragonCheckedInt(c.rgba.b, "blue"), dragonCheckedInt(c.rgba.alpha, "alpha"))
    colors = out
  }

  /** The frame's colour of a node's property as the device draws it (R9 closure included), or null where it does not animate. */
  fun color(node: String, property: String): DragonRGBA8? = colors[node + "|" + property]

  /** The engine input with the frame's lengths patched in (R16); the input itself when nothing animates. */
  fun patch(input: LayoutInput): LayoutInput = if (entries.isEmpty()) input else rtAnimator_patchInput(input, entries, tables)
}

/** The display driver (R3): Choreographer, Δ from successive frame times. tick gets Δ in ms and returns whether to keep running. */
class DragonDisplayDriver(private val tick: (Double) -> Boolean) : Choreographer.FrameCallback {
  private var last = -1L
  var running = false
    private set

  fun start() {
    if (running) return
    running = true
    last = -1L
    Choreographer.getInstance().postFrameCallback(this)
  }

  fun stop() {
    if (running) Choreographer.getInstance().removeFrameCallback(this)
    running = false
    last = -1L
  }

  override fun doFrame(frameTimeNanos: Long) {
    if (!running) return
    val dt = if (last < 0) 0.0 else (frameTimeNanos - last) / 1e6
    last = frameTimeNanos
    if (tick(dt)) Choreographer.getInstance().postFrameCallback(this) else stop()
  }
}
`;
}

/** The animation runtime support source of a backend. */
export function animSupport(backend: 'uikit' | 'android-views', header: (what: string) => string): GeneratedFile {
  return backend === 'uikit'
    ? { path: 'Support/DragonAnim.swift', text: header('the animation runtime and its display driver') + swiftText() }
    : { path: 'kotlin/dev/dragon/views/DragonAnim.kt', text: header('the animation runtime and its display driver') + kotlinText() };
}
