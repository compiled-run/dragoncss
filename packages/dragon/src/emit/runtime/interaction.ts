// The generated interaction runtime of SELD-R2 (notes/T064-seld-r2-spec.md R6, R7, R12, R14, R15, R16): per interaction program,
// the second-level tables under each app assignment (rt-interaction.ts InteractionTables as typed literals), the delta of every
// (app, state) over the state program's base, the hit facts of every (app, state), and the device-traces scripts; and the support
// machine, DragonInteractionMachine, which runs the translated rt-interaction functions over those tables, hit tests the live
// (app, state) program with the translated rt-hit, and moves the node records as packages/parity interaction-runtime.ts does.
// Nothing here parses CSS or matches selectors: the device looks up tables.
import type { InteractionFaults, InteractionTables } from '@dragon/layout';
import type { InteractionProgram } from '../../lower/interaction-program.ts';
import type { NativeBackend } from '../../lower/native-program.ts';
import { PROGRAM_VERSIONS } from '../../lower/native-program.ts';
import type { GeneratedFile, Scalar } from '../../types.ts';
import type { HitFact } from './hit.ts';
import type { Lang } from '../native-support.ts';
import { doubleLit, environmentArgs, inputFunctions, stringLit } from '../native-support.ts';
import { commentText, deltaLit, nodeLit, valueKey } from './state.ts';

export const INTERACTION_RUNTIME_VERSION = 'dragon.runtime-interaction/1';

export class InteractionEmitError extends Error {}

/** The constructor parameters of rt-interaction.ts InteractionTables, in declaration order (the translated class takes them positionally). */
export const INTERACTION_TABLE_FIELDS = ['parent', 'focusable', 'touchConsumesTap', 'keyboardInput', 'chainOf', 'activeChainOf', 'pointerFocusOf', 'keyboardFocusOf', 'forcedHoverOf', 'forcedActiveOf', 'forcedFocusOf', 'forcedFocusVisibleOf', 'hoverValues', 'activeValues', 'focusValues', 'combos'] as const satisfies readonly (keyof InteractionTables)[];

/** The constructor parameters of rt-interaction.ts InteractionFaults, in declaration order. */
export const INTERACTION_FAULT_FIELDS = ['tapSetsHover', 'hoverWithoutAncestors', 'forcedSetsAncestors', 'focusOnNonFocusable', 'focusVisibleOnPointer', 'activeWithoutAncestors', 'activeStaysAfterRelease', 'focusAtTouchPress', 'rangeTapFocuses', 'hoverNotRecomputedAfterLayout', 'hoverExitOnPress'] as const satisfies readonly (keyof InteractionFaults)[];

/**
 * One step of a device-traces script: the InteractionStep kinds of packages/parity interaction-runtime.ts, with force naming a table
 * index of the current app assignment (-1: none), plus trace, which writes one record line. Points are CSS px of the rendered program.
 */
export type InteractionScriptStep =
  | { readonly kind: 'move'; readonly x: number; readonly y: number }
  | { readonly kind: 'exit' }
  | { readonly kind: 'exit-start' }
  | { readonly kind: 'frame' }
  | { readonly kind: 'mouse-down'; readonly x: number; readonly y: number }
  | { readonly kind: 'mouse-up' }
  | { readonly kind: 'touch-down'; readonly x: number; readonly y: number }
  | { readonly kind: 'touch-up'; readonly x: number; readonly y: number }
  | { readonly kind: 'touch-cancel' }
  | { readonly kind: 'key'; readonly modified: boolean }
  | { readonly kind: 'force'; readonly pseudo: 'none' | 'hover' | 'active' | 'focus' | 'focus-visible'; readonly element: number }
  | { readonly kind: 'set'; readonly state: string; readonly value: Scalar }
  | { readonly kind: 'trace' };

export type InteractionScript = { readonly id: string; readonly steps: readonly InteractionScriptStep[] };

/** One interaction program as the emitter sees it. */
export type InteractionEmit = {
  readonly id: string;
  readonly fixture: string;
  readonly direction: 'ltr' | 'rtl';
  readonly compilerDigest: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly program: InteractionProgram;
  /** Per app assignment: the hit facts of its none state, then of each interaction state in order (hitFacts with that state's key). */
  readonly facts: readonly (readonly ReadonlyMap<string, HitFact>[])[];
  readonly scripts: readonly InteractionScript[];
};

/** The record line of one trace step: "<traceIndex>\t<app>\t<state>\t<hover>\t<active>\t<focus>\t<focusVisible>" (hover, active: indices root first, or -). */
export function traceLineOf(index: number, app: number, state: number, hover: readonly number[], active: readonly number[], focus: number, focusVisible: number): string {
  const set = (xs: readonly number[]): string => (xs.length === 0 ? '-' : xs.join(','));
  return `${index}\t${app}\t${state}\t${set(hover)}\t${set(active)}\t${focus}\t${focusVisible}`;
}

/** A well-formed record line (traceLineOf's shape). */
export const TRACE_LINE = /^(0|[1-9]\d*)\t(0|[1-9]\d*)\t(-1|0|[1-9]\d*)\t(-|(0|[1-9]\d*)(,(0|[1-9]\d*))*)\t(-|(0|[1-9]\d*)(,(0|[1-9]\d*))*)\t(-1|0|[1-9]\d*)\t(-1|0|[1-9]\d*)$/;

// ---------------------------------------------------------------- support sources

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function swiftSupportText(): string {
  return String.raw`import UIKit

/// One element's hit facts in one interaction state (rt-hit.ts HitFact).
public struct DragonInteractionFact {
  public let id: String
  public let pointerEvents: String
  public let inherited: Bool
  public let activation: Bool
  public init(_ id: String, _ pointerEvents: String, _ inherited: Bool, _ activation: Bool) { self.id = id; self.pointerEvents = pointerEvents; self.inherited = inherited; self.activation = activation }
}

/// One app assignment's interaction level: the rt-interaction tables, the element address of each table index, each interaction
/// state's delta (an index into the machine's deltas) and the hit facts (an index into the machine's fact sets) of the none state,
/// then of each interaction state.
public struct DragonInteractionLevel {
  public let tables: InteractionTables
  public let addresses: [String]
  public let deltas: [Int]
  public let facts: [Int]
  public init(_ tables: InteractionTables, _ addresses: [String], _ deltas: [Int], _ facts: [Int]) { self.tables = tables; self.addresses = addresses; self.deltas = deltas; self.facts = facts }
}

/// One step of a device-traces script (the TS InteractionScriptStep); trace writes one record line.
public enum DragonInteractionStep {
  case move(Double, Double)
  case exit
  case exitStart
  case frame
  case mouseDown(Double, Double)
  case mouseUp
  case touchDown(Double, Double)
  case touchUp(Double, Double)
  case touchCancel
  case key(Bool)
  case force(String, Int)
  case set(String, String)
  case trace
}

/// A translated runtime call; a throw is a broken table or a bad argument, which the generated code never recovers from.
func dragonInteractionCall<T>(_ what: String, _ f: () throws -> T) -> T {
  do { return try f() } catch { fatalError("dragon: interaction \(what): \(error)") }
}

/// The interaction runtime of one interaction program (packages/parity interaction-runtime.ts, translated by hand): the app setters
/// and the R6 events of the translated rt-interaction over the current app assignment's tables, hit tested on the live (app, state)
/// program by the translated rt-hit. deltas holds the app assignments' deltas first (index = assignment), then the interaction
/// states'. Every public call is one step: onChange runs once when the step changes the shown program, and onInteractionChange
/// (fromApp, from, toApp, to) once when it changes the interaction state (R16; -1 is the none state). A step that lays out another
/// engine input under a hovering pointer re-hits the pointer's last point once (P11).
public final class DragonInteractionMachine {
  public let states: [String]
  public let domains: [[String]]
  private let base: [DragonStateNode]
  private var baseById: [String: DragonStateNode] = [:]
  private let deltas: [DragonStateDelta]
  private let levels: [DragonInteractionLevel]
  private let next: [[[Int]]]
  private let variants: [(Double) -> LayoutInput]
  private let facts: [[DragonInteractionFact]]
  private let faults: InteractionFaults
  private var measurer: TextMeasurer?
  private var scale = 1.0
  public private(set) var app: Int
  public private(set) var shown: Int = -1
  public private(set) var laidOut: Int
  private var current: Int
  private var pointer: InteractionPointer
  private var last: (Double, Double)?
  private var nodes: [String: DragonStateNode] = [:]
  private var order: [String] = []
  private var hitTables: [String: (HitPrepared, [String])] = [:]
  private var traces = 0
  /// Called after every step that changes the shown program; a mount re-renders.
  public var onChange: (() -> Void)?
  /// R16: (fromApp, from, toApp, to), at most once per step.
  public var onInteractionChange: ((Int, Int, Int, Int) -> Void)?

  public init(states: [String], domains: [[String]], base: [DragonStateNode], deltas: [DragonStateDelta], levels: [DragonInteractionLevel], next: [[[Int]]], initial: Int, variants: [(Double) -> LayoutInput], facts: [[DragonInteractionFact]], faults: InteractionFaults) {
    self.states = states; self.domains = domains; self.base = base; self.deltas = deltas; self.levels = levels; self.next = next
    self.variants = variants; self.facts = facts; self.faults = faults
    if levels.count != next.count || deltas.count < levels.count { fatalError("dragon: \(levels.count) interaction levels for \(next.count) app assignments and \(deltas.count) deltas") }
    for (a, l) in levels.enumerated() {
      dragonInteractionCall("tables of app assignment \(a)") { try rtInteraction_checkInteractionTables(l.tables, Double(l.deltas.count)) }
      if l.addresses.count != l.tables.parent.items.count || l.facts.count != l.deltas.count + 1 { fatalError("dragon: app assignment \(a): the level's addresses or facts do not match its tables") }
      for d in l.deltas where d < 0 || d >= deltas.count { fatalError("dragon: app assignment \(a): no delta \(d)") }
      for f in l.facts where f < 0 || f >= facts.count { fatalError("dragon: app assignment \(a): no fact set \(f)") }
    }
    app = initial
    current = initial
    laidOut = deltas[initial].variant
    pointer = dragonInteractionCall("start") { try rtInteraction_interactionStart() }
    for n in base { baseById[n.id] = n }
    let d = deltas[initial]
    let removed = Set(d.removed)
    for n in base where !removed.contains(n.id) { nodes[n.id] = n }
    for n in d.changed { nodes[n.id] = n }
    order = d.order ?? base.map { $0.id }.filter { nodes[$0] != nil }
  }

  /// The mount's measurer and scale: the hit test lays out the live engine input with them. A point step before this fails.
  public func attach(_ measurer: TextMeasurer, scale: Double) {
    self.measurer = measurer
    self.scale = scale
    hitTables = [:]
  }

  private var tables: InteractionTables { return levels[app].tables }

  public func pointerMoved(_ x: Double, _ y: Double) {
    step {
      last = (x, y)
      let h = hitAt(x, y)
      commit(dragonInteractionCall("pointerMoved") { try rtInteraction_pointerMoved(tables, pointer, h) })
    }
  }

  public func pointerExited() {
    step { commit(dragonInteractionCall("pointerExited") { try rtInteraction_pointerExited(tables, pointer) }) }
  }

  /// Android's ACTION_HOVER_EXIT: hover clears at the next frame unless a mouse press comes first (R15).
  public func hoverExitStarted() {
    step { commit(dragonInteractionCall("hoverExitStarted") { try rtInteraction_hoverExitStarted(tables, pointer) }) }
  }

  public func frame() {
    step { commit(dragonInteractionCall("frame") { try rtInteraction_interactionFrame(tables, pointer) }) }
  }

  public func mousePressed(_ x: Double, _ y: Double) {
    step {
      last = (x, y)
      let h = hitAt(x, y)
      commit(dragonInteractionCall("mousePressed") { try rtInteraction_mousePressed(tables, pointer, h, faults) })
    }
  }

  public func mouseReleased() {
    step { commit(dragonInteractionCall("mouseReleased") { try rtInteraction_mouseReleased(tables, pointer, faults) }) }
  }

  public func touchPressed(_ x: Double, _ y: Double) {
    step {
      let h = hitAt(x, y)
      commit(dragonInteractionCall("touchPressed") { try rtInteraction_touchPressed(tables, pointer, h, faults) })
    }
  }

  public func touchReleased(_ x: Double, _ y: Double) {
    step {
      let h = hitAt(x, y)
      commit(dragonInteractionCall("touchReleased") { try rtInteraction_touchReleased(tables, pointer, h, faults) })
    }
  }

  public func touchCancelled() {
    step { commit(dragonInteractionCall("touchCancelled") { try rtInteraction_touchCancelled(tables, pointer, faults) }) }
  }

  public func keyPressed(_ modified: Bool) {
    step { commit(dragonInteractionCall("keyPressed") { try rtInteraction_keyPressed(tables, pointer, modified) }) }
  }

  /// CSS.forcePseudoState: kind is none, hover, active, focus or focus-visible; element a table index of the current app assignment (-1: none).
  public func forcePseudo(kind: String, element: Int) {
    step { commit(dragonInteractionCall("forcePseudo") { try rtInteraction_forcePseudo(tables, pointer, JsString(kind), Double(element)) }) }
  }

  /// The app setter by key and domain value key: the pointer is remapped onto the new tables, and a hovering pointer re-hit (P11).
  public func set(state: String, value: String) {
    step {
      guard let s = states.firstIndex(of: state) else { fatalError("dragon: no state \(state); the states are \(states)") }
      guard let v = domains[s].firstIndex(of: value) else { fatalError("dragon: \(state): \(value) is not in the domain \(domains[s])") }
      let to = next[app][s][v]
      if to < 0 { fatalError("dragon: \(state) = \(value) is unreachable from app assignment \(app)") }
      let toAddresses = levels[to].addresses
      let remap = JsArray<Double>(levels[app].addresses.map { a in Double(toAddresses.firstIndex(of: a) ?? -1) })
      app = to
      pointer = dragonInteractionCall("remapPointer") { try rtInteraction_remapPointer(tables, pointer, remap) }
      // The setter's own layout comes first, then the pointer's last point is hit on it (P11).
      moveTo(to, stateOf(), true)
      if pointer.pointerIn, let l = last {
        let h = hitAt(l.0, l.1)
        commit(dragonInteractionCall("layoutChanged") { try rtInteraction_layoutChanged(tables, pointer, h, faults) })
      }
    }
  }

  /// The record line of the current snapshot, numbered from 0 per machine:
  /// "<traceIndex>\t<app>\t<state>\t<hover>\t<active>\t<focus>\t<focusVisible>" (hover, active: table indices root first, or -).
  public func traceLine() -> String {
    let t = tables
    let p = pointer
    let hover = dragonInteractionCall("hoverMatches") { try rtInteraction_hoverMatches(t, p, faults) }.items.map { String(Int($0)) }
    let active = dragonInteractionCall("activeMatches") { try rtInteraction_activeMatches(t, p, faults) }.items.map { String(Int($0)) }
    let focus = Int(dragonInteractionCall("focusMatch") { try rtInteraction_focusMatch(p) })
    let visible = Int(dragonInteractionCall("focusVisibleMatch") { try rtInteraction_focusVisibleMatch(p) })
    let line = "\(traces)\t\(app)\t\(shown)\t\(hover.isEmpty ? "-" : hover.joined(separator: ","))\t\(active.isEmpty ? "-" : active.joined(separator: ","))\t\(focus)\t\(visible)"
    traces += 1
    return line
  }

  private func step(_ body: () -> Void) {
    let fromApp = app
    let from = shown
    let delta = current
    body()
    if app != fromApp || current != delta { onChange?() }
    // One event per step (R16): an app setter between two none states is the setter's own event, not an interaction change.
    if (app != fromApp || shown != from) && !(from < 0 && shown < 0) { onInteractionChange?(fromApp, from, app, shown) }
  }

  private func stateOf() -> Int {
    return Int(dragonInteractionCall("interactionState") { try rtInteraction_interactionState(tables, pointer) })
  }

  /// Takes a new pointer, moves to the state it selects and, when that lays out another engine input under a hovering pointer, re-hits once.
  private func commit(_ p: InteractionPointer) {
    pointer = p
    let before = laidOut
    moveTo(app, stateOf(), false)
    if laidOut != before && pointer.pointerIn, let l = last {
      let h = hitAt(l.0, l.1)
      pointer = dragonInteractionCall("layoutChanged") { try rtInteraction_layoutChanged(tables, pointer, h, faults) }
      moveTo(app, stateOf(), false)
    }
  }

  private func moveTo(_ to: Int, _ state: Int, _ appChanged: Bool) {
    if !appChanged && state == shown { return }
    let index = state < 0 ? to : levels[to].deltas[state]
    let old = deltas[current]
    let d = deltas[index]
    var touched = Set(old.removed)
    for n in old.changed { touched.insert(n.id) }
    for id in d.removed { touched.insert(id) }
    for n in d.changed { touched.insert(n.id) }
    let removed = Set(d.removed)
    var changed: [String: DragonStateNode] = [:]
    for n in d.changed { changed[n.id] = n }
    for id in touched { nodes[id] = removed.contains(id) ? nil : (changed[id] ?? baseById[id]) }
    order = d.order ?? base.map { $0.id }.filter { nodes[$0] != nil }
    if d.variant != laidOut { laidOut = d.variant }
    current = index
    shown = state
  }

  /// The table index of the element at a point (CSS px) of the live (app, state) program, or -1: rt-hit with that state's facts.
  private func hitAt(_ x: Double, _ y: Double) -> Double {
    if !x.isFinite || !y.isFinite { fatalError("dragon: the point (\(x), \(y)) is not finite") }
    guard let measurer = measurer else { fatalError("dragon: the interaction machine hit tests only once a mount has attached its measurer") }
    let f = levels[app].facts[shown + 1]
    let key = "\(laidOut)|\(f)"
    var entry = hitTables[key]
    if entry == nil {
      let map = JsStringMap<HitFact>()
      for r in facts[f] { map.set(JsString(r.id), HitFact(JsString(r.pointerEvents), r.inherited, r.activation)) }
      let t = dragonInteractionCall("hit table") { try rtHit_hitTableOf(variants[laidOut](scale), measurer, map, HitTableFaults(false)) }
      let prepared = dragonInteractionCall("prepare hit") { try rtHit_prepareHit(t.nodes, HitFaults(false, false)) }
      entry = (prepared, t.ids.items.map { $0.description })
      hitTables[key] = entry
    }
    guard let found = entry else { fatalError("dragon: no hit table") }
    let prepared = found.0
    let ids = found.1
    let zoom = scale * 64
    let i = Int(dragonInteractionCall("hit") { try rtHit_hitAt(prepared, x * zoom, y * zoom) })
    // The view hit returns the document element when nothing else is hit; the tables hold element addresses only.
    if i < 0 || i >= ids.count { return -1 }
    return Double(levels[app].addresses.firstIndex(of: ids[i]) ?? -1)
  }

  /// Builds the Dragon views of the live node records, writing each as the case emitter does.
  public func build(_ t: DragonTree) {
    for id in order {
      guard let n = nodes[id] else { fatalError("dragon: the interaction runtime orders \(id), which it does not hold") }
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
        case .background(let c): dragonBackground(v, c)
        case .borderStyles(let s): v.dragonBorderStyles = s
        case .borderColors(let c): v.dragonBorderColors = c
        case .clip: v.dragonEnableClip()
        case .text: fatalError("dragon: box \(n.id) holds a text write")
        }
      }
    }
  }

  /// The engine input last laid out.
  public func input(_ dpr: Double) -> LayoutInput {
    return variants[laidOut](dpr)
  }
}

/// A device-traces script: its id and steps. run drives a mounted machine, the pointer steps through pointer (the machine's entry
/// points or the platform's events) and the others on the machine, and returns one record line per trace step; the host writes
/// them as <id>@<scale>.trace.
public struct DragonInteractionScript {
  public let id: String
  public let fixture: String
  public let direction: String
  public let viewport: (width: Double, height: Double)
  public let make: () -> DragonInteractionMachine
  public let steps: [DragonInteractionStep]

  public init(id: String, fixture: String, direction: String, viewport: (width: Double, height: Double), make: @escaping () -> DragonInteractionMachine, steps: [DragonInteractionStep]) {
    self.id = id; self.fixture = fixture; self.direction = direction; self.viewport = viewport; self.make = make; self.steps = steps
  }

  public func run(_ m: DragonInteractionMachine, pointer: DragonPointerInput) -> [String] {
    var out: [String] = []
    for s in steps {
      switch s {
      case .move(let x, let y): pointer.pointerMoved(x, y)
      case .exit: pointer.pointerExited()
      case .exitStart: pointer.hoverExitStarted()
      case .frame: pointer.frame()
      case .mouseDown(let x, let y): pointer.mousePressed(x, y)
      case .mouseUp: pointer.mouseReleased()
      case .touchDown(let x, let y): pointer.touchPressed(x, y)
      case .touchUp(let x, let y): pointer.touchReleased(x, y)
      case .touchCancel: pointer.touchCancelled()
      case .key(let modified): m.keyPressed(modified)
      case .force(let kind, let element): m.forcePseudo(kind: kind, element: element)
      case .set(let state, let value): m.set(state: state, value: value)
      case .trace: out.append(m.traceLine())
      }
    }
    return out
  }
}
`;
}

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function kotlinSupportText(): string {
  return String.raw`package dev.dragon.views

import dev.dragon.layout.*

/** One element's hit facts in one interaction state (rt-hit.ts HitFact). */
class DragonInteractionFact(val id: String, val pointerEvents: String, val inherited: Boolean, val activation: Boolean)

/**
 * One app assignment's interaction level: the rt-interaction tables, the element address of each table index, each interaction
 * state's delta (an index into the machine's deltas) and the hit facts (an index into the machine's fact sets) of the none state,
 * then of each interaction state.
 */
class DragonInteractionLevel(val tables: InteractionTables, val addresses: List<String>, val deltas: List<Int>, val facts: List<Int>)

/** One step of a device-traces script (the TS InteractionScriptStep); Trace writes one record line. */
sealed class DragonInteractionStep {
  class Move(val x: Double, val y: Double) : DragonInteractionStep()
  object Exit : DragonInteractionStep()
  object ExitStart : DragonInteractionStep()
  object Frame : DragonInteractionStep()
  class MouseDown(val x: Double, val y: Double) : DragonInteractionStep()
  object MouseUp : DragonInteractionStep()
  class TouchDown(val x: Double, val y: Double) : DragonInteractionStep()
  class TouchUp(val x: Double, val y: Double) : DragonInteractionStep()
  object TouchCancel : DragonInteractionStep()
  class Key(val modified: Boolean) : DragonInteractionStep()
  class Force(val kind: String, val element: Int) : DragonInteractionStep()
  class Set(val state: String, val value: String) : DragonInteractionStep()
  object Trace : DragonInteractionStep()
}

/**
 * The interaction runtime of one interaction program (packages/parity interaction-runtime.ts, translated by hand): the app setters
 * and the R6 events of the translated rt-interaction over the current app assignment's tables, hit tested on the live (app, state)
 * program by the translated rt-hit. deltas holds the app assignments' deltas first (index = assignment), then the interaction
 * states'. Every public call is one step: onChange runs once when the step changes the shown program, and onInteractionChange
 * (fromApp, from, toApp, to) once when it changes the interaction state (R16; -1 is the none state). A step that lays out another
 * engine input under a hovering pointer re-hits the pointer's last point once (P11).
 */
class DragonInteractionMachine(
  val states: List<String>,
  val domains: List<List<String>>,
  private val base: List<DragonStateNode>,
  private val deltas: List<DragonStateDelta>,
  private val levels: List<DragonInteractionLevel>,
  private val next: List<List<List<Int>>>,
  initial: Int,
  private val variants: List<(Double) -> LayoutInput>,
  private val facts: List<List<DragonInteractionFact>>,
  private val faults: InteractionFaults,
) {
  private var measurer: TextMeasurer? = null
  private var scale = 1.0
  private val baseById = HashMap<String, DragonStateNode>()
  var app: Int = initial
    private set
  var shown: Int = -1
    private set
  var laidOut: Int = deltas[initial].variant
    private set
  private var current: Int = initial
  private var pointer: InteractionPointer = rtInteraction_interactionStart()
  private var hasLast = false
  private var lastX = 0.0
  private var lastY = 0.0
  private val nodes = HashMap<String, DragonStateNode>()
  private var order: List<String> = emptyList()
  private val hitTables = HashMap<String, Pair<HitPrepared, List<String>>>()
  private var traces = 0
  /** Called after every step that changes the shown program; a mount re-renders. */
  var onChange: (() -> Unit)? = null
  /** R16: (fromApp, from, toApp, to), at most once per step. */
  var onInteractionChange: ((Int, Int, Int, Int) -> Unit)? = null

  init {
    if (levels.size != next.size || deltas.size < levels.size) throw IllegalStateException("dragon: " + levels.size + " interaction levels for " + next.size + " app assignments and " + deltas.size + " deltas")
    for ((a, l) in levels.withIndex()) {
      rtInteraction_checkInteractionTables(l.tables, l.deltas.size.toDouble())
      if (l.addresses.size != l.tables.parent.size || l.facts.size != l.deltas.size + 1) throw IllegalStateException("dragon: app assignment " + a + ": the level's addresses or facts do not match its tables")
      for (d in l.deltas) if (d < 0 || d >= deltas.size) throw IllegalStateException("dragon: app assignment " + a + ": no delta " + d)
      for (f in l.facts) if (f < 0 || f >= facts.size) throw IllegalStateException("dragon: app assignment " + a + ": no fact set " + f)
    }
    for (n in base) baseById[n.id] = n
    val d = deltas[initial]
    val removed = d.removed.toHashSet()
    for (n in base) if (!removed.contains(n.id)) nodes[n.id] = n
    for (n in d.changed) nodes[n.id] = n
    order = d.order ?: base.map { it.id }.filter { nodes.containsKey(it) }
  }

  /** The mount's measurer and scale: the hit test lays out the live engine input with them. A point step before this fails. */
  fun attach(measurer: TextMeasurer, scale: Double) {
    this.measurer = measurer
    this.scale = scale
    hitTables.clear()
  }

  private val tables: InteractionTables get() = levels[app].tables

  fun pointerMoved(x: Double, y: Double) = step {
    hasLast = true; lastX = x; lastY = y
    val h = hitAt(x, y)
    commit(rtInteraction_pointerMoved(tables, pointer, h))
  }

  fun pointerExited() = step { commit(rtInteraction_pointerExited(tables, pointer)) }

  /** Android's ACTION_HOVER_EXIT: hover clears at the next frame unless a mouse press comes first (R15). */
  fun hoverExitStarted() = step { commit(rtInteraction_hoverExitStarted(tables, pointer)) }

  fun frame() = step { commit(rtInteraction_interactionFrame(tables, pointer)) }

  fun mousePressed(x: Double, y: Double) = step {
    hasLast = true; lastX = x; lastY = y
    val h = hitAt(x, y)
    commit(rtInteraction_mousePressed(tables, pointer, h, faults))
  }

  fun mouseReleased() = step { commit(rtInteraction_mouseReleased(tables, pointer, faults)) }

  fun touchPressed(x: Double, y: Double) = step {
    val h = hitAt(x, y)
    commit(rtInteraction_touchPressed(tables, pointer, h, faults))
  }

  fun touchReleased(x: Double, y: Double) = step {
    val h = hitAt(x, y)
    commit(rtInteraction_touchReleased(tables, pointer, h, faults))
  }

  fun touchCancelled() = step { commit(rtInteraction_touchCancelled(tables, pointer, faults)) }

  fun keyPressed(modified: Boolean) = step { commit(rtInteraction_keyPressed(tables, pointer, modified)) }

  /** CSS.forcePseudoState: kind is none, hover, active, focus or focus-visible; element a table index of the current app assignment (-1: none). */
  fun forcePseudo(kind: String, element: Int) = step { commit(rtInteraction_forcePseudo(tables, pointer, kind, element.toDouble())) }

  /** The app setter by key and domain value key: the pointer is remapped onto the new tables, and a hovering pointer re-hit (P11). */
  fun set(state: String, value: String) = step {
    val s = states.indexOf(state)
    if (s < 0) throw IllegalStateException("dragon: no state " + state + "; the states are " + states)
    val v = domains[s].indexOf(value)
    if (v < 0) throw IllegalStateException("dragon: " + state + ": " + value + " is not in the domain " + domains[s])
    val to = next[app][s][v]
    if (to < 0) throw IllegalStateException("dragon: " + state + " = " + value + " is unreachable from app assignment " + app)
    val toAddresses = levels[to].addresses
    val remap = JsArray<Double>()
    for (a in levels[app].addresses) remap.add(toAddresses.indexOf(a).toDouble())
    app = to
    pointer = rtInteraction_remapPointer(tables, pointer, remap)
    // The setter's own layout comes first, then the pointer's last point is hit on it (P11).
    moveTo(to, stateOf(), true)
    if (pointer.pointerIn && hasLast) {
      val h = hitAt(lastX, lastY)
      commit(rtInteraction_layoutChanged(tables, pointer, h, faults))
    }
  }

  /**
   * The record line of the current snapshot, numbered from 0 per machine:
   * "<traceIndex>\t<app>\t<state>\t<hover>\t<active>\t<focus>\t<focusVisible>" (hover, active: table indices root first, or -).
   */
  fun traceLine(): String {
    val t = tables
    val hover = rtInteraction_hoverMatches(t, pointer, faults).map { it.toInt().toString() }
    val active = rtInteraction_activeMatches(t, pointer, faults).map { it.toInt().toString() }
    val focus = rtInteraction_focusMatch(pointer).toInt()
    val visible = rtInteraction_focusVisibleMatch(pointer).toInt()
    val line = traces.toString() + "\t" + app + "\t" + shown + "\t" + (if (hover.isEmpty()) "-" else hover.joinToString(",")) + "\t" + (if (active.isEmpty()) "-" else active.joinToString(",")) + "\t" + focus + "\t" + visible
    traces++
    return line
  }

  private fun step(body: () -> Unit) {
    val fromApp = app
    val from = shown
    val delta = current
    body()
    if (app != fromApp || current != delta) onChange?.invoke()
    // One event per step (R16): an app setter between two none states is the setter's own event, not an interaction change.
    if ((app != fromApp || shown != from) && !(from < 0 && shown < 0)) onInteractionChange?.invoke(fromApp, from, app, shown)
  }

  private fun stateOf(): Int = rtInteraction_interactionState(tables, pointer).toInt()

  /** Takes a new pointer, moves to the state it selects and, when that lays out another engine input under a hovering pointer, re-hits once. */
  private fun commit(p: InteractionPointer) {
    pointer = p
    val before = laidOut
    moveTo(app, stateOf(), false)
    if (laidOut != before && pointer.pointerIn && hasLast) {
      val h = hitAt(lastX, lastY)
      pointer = rtInteraction_layoutChanged(tables, pointer, h, faults)
      moveTo(app, stateOf(), false)
    }
  }

  private fun moveTo(to: Int, state: Int, appChanged: Boolean) {
    if (!appChanged && state == shown) return
    val index = if (state < 0) to else levels[to].deltas[state]
    val old = deltas[current]
    val d = deltas[index]
    val touched = HashSet<String>()
    touched.addAll(old.removed)
    for (n in old.changed) touched.add(n.id)
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
    if (d.variant != laidOut) laidOut = d.variant
    current = index
    shown = state
  }

  /** The table index of the element at a point (CSS px) of the live (app, state) program, or -1: rt-hit with that state's facts. */
  private fun hitAt(x: Double, y: Double): Double {
    if (!x.isFinite() || !y.isFinite()) throw IllegalStateException("dragon: the point (" + x + ", " + y + ") is not finite")
    val measurer = this.measurer ?: throw IllegalStateException("dragon: the interaction machine hit tests only once a mount has attached its measurer")
    val f = levels[app].facts[shown + 1]
    val key = laidOut.toString() + "|" + f
    val entry = hitTables.getOrPut(key) {
      val map = JsStringMap<HitFact>()
      for (r in facts[f]) map.set(r.id, HitFact(r.pointerEvents, r.inherited, r.activation))
      val t = rtHit_hitTableOf(variants[laidOut](scale), measurer, map, HitTableFaults(false))
      Pair(rtHit_prepareHit(t.nodes, HitFaults(false, false)), t.ids.toList())
    }
    val zoom = scale * 64.0
    val i = rtHit_hitAt(entry.first, x * zoom, y * zoom).toInt()
    // The view hit returns the document element when nothing else is hit; the tables hold element addresses only.
    if (i < 0 || i >= entry.second.size) return -1.0
    return levels[app].addresses.indexOf(entry.second[i]).toDouble()
  }

  /** Builds the Dragon views of the live node records, writing each as the case emitter does. */
  fun build(t: DragonTree) {
    for (id in order) {
      val n = nodes[id] ?: throw IllegalStateException("dragon: the interaction runtime orders " + id + ", which it does not hold")
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
  fun input(dpr: Double): LayoutInput = variants[laidOut](dpr)
}

/**
 * A device-traces script: its id and steps. run drives a mounted machine, the pointer steps through pointer (the machine's entry
 * points or real MotionEvents) and the others on the machine, and returns one record line per trace step; the host writes them as
 * <id>@<scale>.trace.
 */
class DragonInteractionScript(val id: String, val fixture: String, val direction: String, val width: Double, val height: Double, val make: () -> DragonInteractionMachine, val steps: List<DragonInteractionStep>) {
  fun run(m: DragonInteractionMachine, pointer: DragonPointerInput): List<String> {
    val out = ArrayList<String>()
    for (s in steps) {
      when (s) {
        is DragonInteractionStep.Move -> pointer.pointerMoved(s.x, s.y)
        is DragonInteractionStep.Exit -> pointer.pointerExited()
        is DragonInteractionStep.ExitStart -> pointer.hoverExitStarted()
        is DragonInteractionStep.Frame -> pointer.frame()
        is DragonInteractionStep.MouseDown -> pointer.mousePressed(s.x, s.y)
        is DragonInteractionStep.MouseUp -> pointer.mouseReleased()
        is DragonInteractionStep.TouchDown -> pointer.touchPressed(s.x, s.y)
        is DragonInteractionStep.TouchUp -> pointer.touchReleased(s.x, s.y)
        is DragonInteractionStep.TouchCancel -> pointer.touchCancelled()
        is DragonInteractionStep.Key -> m.keyPressed(s.modified)
        is DragonInteractionStep.Force -> m.forcePseudo(s.kind, s.element)
        is DragonInteractionStep.Set -> m.set(s.state, s.value)
        is DragonInteractionStep.Trace -> out.add(m.traceLine())
      }
    }
    return out
  }
}
`;
}

/** The interaction runtime support source of a backend. */
export function interactionSupport(backend: NativeBackend, header: (what: string) => string): GeneratedFile {
  return backend === 'uikit'
    ? { path: 'Support/DragonInteraction.swift', text: header('the interaction runtime and device-traces scripts') + swiftSupportText() }
    : { path: 'kotlin/dev/dragon/views/DragonInteraction.kt', text: header('the interaction runtime and device-traces scripts') + kotlinSupportText() };
}

// ---------------------------------------------------------------- per interaction program sources

const list = (lang: Lang, items: readonly string[]): string => (lang === 'swift' ? `[${items.join(', ')}]` : `listOf(${items.join(', ')})`);
const jsArray = (lang: Lang, type: 'Double' | 'Bool', items: readonly string[]): string => {
  const t = lang === 'kotlin' && type === 'Bool' ? 'Boolean' : type;
  return lang === 'swift' ? `JsArray<${t}>([${items.join(', ')}])` : `jsArrayOf<${t}>(${items.join(', ')})`;
};

function intLit(where: string, v: number, lo: number): string {
  if (!Number.isInteger(v) || v < lo) throw new InteractionEmitError(`${where}: ${v} is not an integer of at least ${lo}`);
  return String(v);
}

/** The tables as an InteractionTables constructor call, every field checked against INTERACTION_TABLE_FIELDS. */
export function interactionTablesLit(lang: Lang, t: InteractionTables, where: string): string {
  const keys = Object.keys(t);
  const extra = keys.filter((k) => !(INTERACTION_TABLE_FIELDS as readonly string[]).includes(k));
  const missing = INTERACTION_TABLE_FIELDS.filter((k) => !keys.includes(k));
  if (extra.length > 0 || missing.length > 0) throw new InteractionEmitError(`${where}: InteractionTables lacks [${missing.join(', ')}] or has unknown [${extra.join(', ')}]`);
  const args = INTERACTION_TABLE_FIELDS.map((f) => {
    const v = t[f] as unknown;
    if (typeof v === 'number') return doubleLit(Number(intLit(`${where}.${f}`, v, 1)));
    if (!Array.isArray(v)) throw new InteractionEmitError(`${where}.${f}: not a table`);
    if (f === 'focusable' || f === 'touchConsumesTap' || f === 'keyboardInput') {
      return jsArray(lang, 'Bool', v.map((x, i) => {
        if (typeof x !== 'boolean') throw new InteractionEmitError(`${where}.${f}[${i}]: ${JSON.stringify(x)} is not a boolean`);
        return x ? 'true' : 'false';
      }));
    }
    return jsArray(lang, 'Double', v.map((x, i) => doubleLit(Number(intLit(`${where}.${f}[${i}]`, x as number, -1)))));
  });
  return `InteractionTables(${args.join(', ')})`;
}

/** The faults as an InteractionFaults constructor call (all off when absent). */
export function interactionFaultsLit(faults: InteractionFaults | null): string {
  return `InteractionFaults(${INTERACTION_FAULT_FIELDS.map((f) => (faults !== null && faults[f] ? 'true' : 'false')).join(', ')})`;
}

function factsLit(lang: Lang, facts: ReadonlyMap<string, HitFact>): string {
  const q = (s: string): string => stringLit(lang, s);
  const rows = [...facts].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([id, f]) => {
    if (f.pointerEvents !== 'auto' && f.pointerEvents !== 'none') throw new InteractionEmitError(`${id}: pointer-events ${JSON.stringify(f.pointerEvents)}`);
    return `DragonInteractionFact(${q(id)}, ${q(f.pointerEvents)}, ${f.inherited}, ${f.activation})`;
  });
  return list(lang, rows);
}

const PSEUDOS: readonly string[] = ['none', 'hover', 'active', 'focus', 'focus-visible'];

function stepLit(lang: Lang, ip: InteractionProgram, id: string, i: number, s: InteractionScriptStep): string {
  const sw = lang === 'swift';
  const where = `${id} step ${i}`;
  const point = (x: number, y: number): string => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new InteractionEmitError(`${where}: the point (${x}, ${y}) is not finite`);
    return `${doubleLit(x)}, ${doubleLit(y)}`;
  };
  switch (s.kind) {
    case 'move':
      return sw ? `.move(${point(s.x, s.y)})` : `DragonInteractionStep.Move(${point(s.x, s.y)})`;
    case 'exit':
      return sw ? '.exit' : 'DragonInteractionStep.Exit';
    case 'exit-start':
      return sw ? '.exitStart' : 'DragonInteractionStep.ExitStart';
    case 'frame':
      return sw ? '.frame' : 'DragonInteractionStep.Frame';
    case 'mouse-down':
      return sw ? `.mouseDown(${point(s.x, s.y)})` : `DragonInteractionStep.MouseDown(${point(s.x, s.y)})`;
    case 'mouse-up':
      return sw ? '.mouseUp' : 'DragonInteractionStep.MouseUp';
    case 'touch-down':
      return sw ? `.touchDown(${point(s.x, s.y)})` : `DragonInteractionStep.TouchDown(${point(s.x, s.y)})`;
    case 'touch-up':
      return sw ? `.touchUp(${point(s.x, s.y)})` : `DragonInteractionStep.TouchUp(${point(s.x, s.y)})`;
    case 'touch-cancel':
      return sw ? '.touchCancel' : 'DragonInteractionStep.TouchCancel';
    case 'key':
      return sw ? `.key(${s.modified})` : `DragonInteractionStep.Key(${s.modified})`;
    case 'force': {
      if (!PSEUDOS.includes(s.pseudo)) throw new InteractionEmitError(`${where}: no pseudo-class ${JSON.stringify(s.pseudo)}`);
      const e = intLit(`${where}: force element`, s.element, -1);
      return sw ? `.force(${stringLit(lang, s.pseudo)}, ${e})` : `DragonInteractionStep.Force(${stringLit(lang, s.pseudo)}, ${e})`;
    }
    case 'set': {
      const state = ip.program.states.find((x) => x.key === s.state);
      if (state === undefined) throw new InteractionEmitError(`${where}: no state ${s.state}`);
      if (!state.domain.some((d) => valueKey(d) === valueKey(s.value))) throw new InteractionEmitError(`${where}: ${s.state} has no value ${valueKey(s.value)}`);
      const args = `${stringLit(lang, s.state)}, ${stringLit(lang, valueKey(s.value))}`;
      return sw ? `.set(${args})` : `DragonInteractionStep.Set(${args})`;
    }
    case 'trace':
      return sw ? '.trace' : 'DragonInteractionStep.Trace';
    default: {
      const unknown: never = s;
      throw new InteractionEmitError(`${where}: no step ${JSON.stringify(unknown)}`);
    }
  }
}

function programSource(lang: Lang, e: InteractionEmit, k: number, faults: InteractionFaults | null): string {
  const q = (s: string): string => stringLit(lang, s);
  const ip = e.program;
  const sp = ip.program;
  const sw = lang === 'swift';
  const p = `dragonInteractions${k}`;
  if (ip.levels.length !== sp.assignments.length) throw new InteractionEmitError(`${e.id}: ${ip.levels.length} levels for ${sp.assignments.length} app assignments`);
  if (e.facts.length !== ip.levels.length) throw new InteractionEmitError(`${e.id}: hit facts for ${e.facts.length} of ${ip.levels.length} app assignments`);
  const out: string[] = [`// interaction program ${commentText(e.id)} (${sp.assignments.length} app assignments, ${ip.levels.reduce((n, l) => n + l.deltas.length, 0)} interaction states, ${ip.variants.length} layout variants)`];
  // Kotlin builds every table in its own function, so no class initialiser grows past the JVM's method size limit.
  const decl = (name: string, type: string, value: string): string => {
    out.push(sw ? `private let ${name}: ${type} = ${value}` : `private fun ${name}(): ${type} = ${value}`);
    return sw ? name : `${name}()`;
  };
  const variantFns: string[] = [];
  ip.variants.forEach((variant, j) => {
    const input = inputFunctions(lang, variant.root, `${p}V${j}`);
    out.push(...input.decls);
    const fn = `${p}Input${j}`;
    variantFns.push(sw ? fn : `::${fn}`);
    out.push(sw
      ? `private func ${fn}(_ dpr: Double) -> LayoutInput {\n  return LayoutInput(Viewport(${doubleLit(e.viewport.width)}, ${doubleLit(e.viewport.height)}), dpr, ${environmentArgs(e.viewport, variant.rootFontSize)}, ${input.root})\n}`
      : `private fun ${fn}(dpr: Double): LayoutInput = LayoutInput(Viewport(${doubleLit(e.viewport.width)}, ${doubleLit(e.viewport.height)}), dpr, ${environmentArgs(e.viewport, variant.rootFontSize)}, ${input.root})`);
  });
  const states = decl(`${p}States`, sw ? '[String]' : 'List<String>', list(lang, sp.states.map((s) => q(s.key))));
  const domains = decl(`${p}Domains`, sw ? '[[String]]' : 'List<List<String>>', list(lang, sp.states.map((s) => list(lang, s.domain.map((v) => q(valueKey(v)))))));
  const nodes = sp.base.nodes.map((n, i) => decl(`${p}Node${i}`, 'DragonStateNode', nodeLit(lang, n)));
  const base = decl(`${p}Base`, sw ? '[DragonStateNode]' : 'List<DragonStateNode>', list(lang, nodes));
  // The flat delta list: the app assignments' deltas first (index = assignment), then each level's states in order.
  const flat = [...sp.deltas];
  const levelDeltas = ip.levels.map((l) => l.deltas.map((d) => flat.push(d) - 1));
  flat.forEach((d, i) => {
    if (!Number.isInteger(d.variant) || d.variant < 0 || d.variant >= ip.variants.length) throw new InteractionEmitError(`${e.id}: delta ${i} lays out variant ${d.variant} of ${ip.variants.length}`);
  });
  const deltaRefs = flat.map((d, i) => decl(`${p}Delta${i}`, 'DragonStateDelta', deltaLit(lang, d)));
  const deltas = decl(`${p}Deltas`, sw ? '[DragonStateDelta]' : 'List<DragonStateDelta>', list(lang, deltaRefs));
  const next = decl(`${p}Next`, sw ? '[[[Int]]]' : 'List<List<List<Int>>>', list(lang, sp.next.map((a) => list(lang, a.map((st) => list(lang, st.map(String)))))));
  // Equal fact sets are stored once.
  const factKeys: string[] = [];
  const factRefs: string[] = [];
  const levelFacts = e.facts.map((perState, a) => {
    if (perState.length !== (ip.levels[a]?.deltas.length ?? -1) + 1) throw new InteractionEmitError(`${e.id}: app assignment ${a} has ${perState.length} fact sets for ${ip.levels[a]?.deltas.length} interaction states and none`);
    return perState.map((f) => {
      const text = factsLit(lang, f);
      let i = factKeys.indexOf(text);
      if (i < 0) {
        i = factKeys.length;
        factKeys.push(text);
        factRefs.push(decl(`${p}Facts${i}`, sw ? '[DragonInteractionFact]' : 'List<DragonInteractionFact>', text));
      }
      return i;
    });
  });
  const facts = decl(`${p}Facts`, sw ? '[[DragonInteractionFact]]' : 'List<List<DragonInteractionFact>>', list(lang, factRefs));
  const levelRefs = ip.levels.map((l, a) => {
    if (l.addresses.length !== l.tables.parent.length) throw new InteractionEmitError(`${e.id}: app assignment ${a} names ${l.addresses.length} addresses for ${l.tables.parent.length} elements`);
    const tables = decl(`${p}Tables${a}`, 'InteractionTables', interactionTablesLit(lang, l.tables, `${e.id} app ${a}`));
    const ints = (xs: readonly number[]): string => list(lang, xs.map(String));
    return decl(`${p}Level${a}`, 'DragonInteractionLevel', `DragonInteractionLevel(${tables}, ${list(lang, l.addresses.map(q))}, ${ints(levelDeltas[a] as number[])}, ${ints(levelFacts[a] as number[])})`);
  });
  const levels = decl(`${p}Levels`, sw ? '[DragonInteractionLevel]' : 'List<DragonInteractionLevel>', list(lang, levelRefs));
  const faultsRef = decl(`${p}Faults`, 'InteractionFaults', interactionFaultsLit(faults));
  if (sw) {
    out.push(`/// A fresh interaction runtime of ${commentText(e.id)} at its initial app assignment.`);
    out.push(`public func ${p}Machine() -> DragonInteractionMachine {\n  return DragonInteractionMachine(states: ${states}, domains: ${domains}, base: ${base}, deltas: ${deltas}, levels: ${levels}, next: ${next}, initial: ${sp.initial}, variants: ${list(lang, variantFns)}, facts: ${facts}, faults: ${faultsRef})\n}`);
  } else {
    out.push(`/** A fresh interaction runtime of ${commentText(e.id)} at its initial app assignment. */`);
    out.push(`fun ${p}Machine(): DragonInteractionMachine =\n  DragonInteractionMachine(${states}, ${domains}, ${base}, ${deltas}, ${levels}, ${next}, ${sp.initial}, ${list(lang, variantFns)}, ${facts}, ${faultsRef})`);
  }
  e.scripts.forEach((sc, j) => {
    if (!/^[A-Za-z0-9._~-]+$/.test(sc.id)) throw new InteractionEmitError(`${sc.id}: a script id names a record file, so it holds only letters, digits and . _ ~ -`);
    const steps = decl(`${p}Steps${j}`, sw ? '[DragonInteractionStep]' : 'List<DragonInteractionStep>', list(lang, sc.steps.map((st, i) => stepLit(lang, ip, sc.id, i, st))));
    out.push(sw
      ? `let ${p}Script${j} = DragonInteractionScript(id: ${q(sc.id)}, fixture: ${q(e.fixture)}, direction: ${q(e.direction)}, viewport: (width: ${doubleLit(e.viewport.width)}, height: ${doubleLit(e.viewport.height)}), make: ${p}Machine, steps: ${steps})`
      : `val ${p}Script${j}: DragonInteractionScript by lazy { DragonInteractionScript(${q(sc.id)}, ${q(e.fixture)}, ${q(e.direction)}, ${doubleLit(e.viewport.width)}, ${doubleLit(e.viewport.height)}, ::${p}Machine, ${steps}) }`);
  });
  return out.join('\n');
}

/**
 * The generated interaction program sources of a backend and the device-traces script table (dragonInteractionCaseList,
 * dragonInteractionCaseTable). faults plants the runtime faults in every emitted machine (the device column of R14's plants).
 */
export function emitInteractionPrograms(backend: NativeBackend, emits: readonly InteractionEmit[], faults: InteractionFaults | null = null): GeneratedFile[] {
  const lang: Lang = backend === 'uikit' ? 'swift' : 'kotlin';
  const generated = `// GENERATED by dragon emit/runtime/interaction.ts (${INTERACTION_RUNTIME_VERSION}; program ${PROGRAM_VERSIONS[backend]}). Do not edit.\n`;
  const header = lang === 'swift' ? `${generated}import UIKit\n\n` : `${generated}package dev.dragon.cases\n\nimport dev.dragon.layout.*\nimport dev.dragon.views.*\n\n`;
  const ids = emits.flatMap((e) => e.scripts.map((s) => s.id));
  if (new Set(ids).size !== ids.length) throw new InteractionEmitError('two device-traces scripts share an id');
  const files = emits.map((e, k): GeneratedFile => (lang === 'swift'
    ? { path: `Cases/DragonInteractions${String(k).padStart(3, '0')}.swift`, text: `${header}${programSource(lang, e, k, faults)}\n` }
    : { path: `kotlin/dev/dragon/cases/DragonInteractions${String(k).padStart(3, '0')}.kt`, text: `${header}${programSource(lang, e, k, faults)}\n` }));
  const scripts = emits.flatMap((e, k) => e.scripts.map((_, j) => `dragonInteractions${k}Script${j}`));
  files.push(lang === 'swift'
    ? { path: 'Cases/DragonInteractionCaseTable.swift', text: `${header}/// Every device-traces script, in interaction program order.\npublic let dragonInteractionCaseList: [DragonInteractionScript] = [${scripts.join(', ')}]\n\npublic let dragonInteractionCaseTable: [String: DragonInteractionScript] = Dictionary(uniqueKeysWithValues: dragonInteractionCaseList.map { ($0.id, $0) })\n` }
    : { path: 'kotlin/dev/dragon/cases/DragonInteractionCaseTable.kt', text: `${header}/** Every device-traces script, in interaction program order. */\nval dragonInteractionCaseList: List<DragonInteractionScript> by lazy { listOf(${scripts.join(', ')}) }\n\nval dragonInteractionCaseTable: Map<String, DragonInteractionScript> by lazy { dragonInteractionCaseList.associateBy { it.id } }\n` });
  return files;
}
