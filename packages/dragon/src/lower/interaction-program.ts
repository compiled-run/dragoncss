// The interaction program of a state program (notes/T064-seld-r2-spec.md R7, R12, R16): under each app assignment, the tables the
// interaction runtime (packages/layout rt-interaction.ts) selects a state with, and per distinct interaction state a delta over
// the state program's base. The states are a second level under the app assignment, never more assignments in the 64-cap table.
// The per-case program of every (app, state) is the oracle: base plus its delta must equal it, and the runtime must land on it.
import type { InteractionFaults, InteractionPointer, InteractionTables } from '@dragon/layout';
import { rtInteraction } from '@dragon/layout';
import type { InteractionPartition } from '../analysis/interaction.ts';
import { canonicalJson } from '../digest.ts';
import type { Scalar } from '../types.ts';
import type { NativeBackend, NativeProgram, ProgramNode } from './native-program.ts';
import type { LayoutVariant, StateDelta, StateFaults, StateProgram } from './state-program.ts';
import { applyDelta, NO_STATE_FAULTS, programAt, StateProgramError, StateValueError } from './state-program.ts';

export const INTERACTION_PROGRAM_VERSION = 'dragon.interaction-program/1';

/** One app assignment's interaction level: the runtime tables, the element address of each table index, and one delta per state. */
export type InteractionLevel = {
  readonly tables: InteractionTables;
  readonly addresses: readonly string[];
  /** Per interaction state k (the partition's states, in order): its delta over the state program's base. */
  readonly deltas: readonly StateDelta[];
};

export type InteractionProgram = {
  readonly version: string;
  readonly backend: NativeBackend;
  readonly program: StateProgram;
  /** The state program's layout variants, then those only an interaction state lays out. */
  readonly variants: readonly LayoutVariant[];
  /** One per app assignment of program, in its order. */
  readonly levels: readonly InteractionLevel[];
};

/** One app assignment's input: its partition, each partition state's per-case program, and two facts per partition element. */
export type InteractionLevelInput = {
  readonly partition: InteractionPartition;
  readonly programs: readonly NativeProgram[];
  /** The element's control consumes a touch, so a tap changes no focus (the range, P7). */
  readonly touchConsumesTap: (address: string) => boolean;
  /** Pointer focus on the element gives focus-visible (it may show a virtual keyboard, R8). */
  readonly keyboardInput: (address: string) => boolean;
};

/** The interaction tables of a partition (R7): its per-element tables with parents as indices, and its dimension sizes. */
export function interactionTables(p: InteractionPartition, touchConsumesTap: (address: string) => boolean, keyboardInput: (address: string) => boolean): InteractionTables {
  const index = new Map(p.elements.map((e, i) => [e.address, i]));
  if (index.size !== p.elements.length) throw new StateProgramError('two partition elements share an address');
  const { hover, active, focus } = p.dimensions;
  if (p.combos.length !== hover.length * active.length * focus.length) throw new StateProgramError(`the partition resolved ${p.combos.length} of ${hover.length * active.length * focus.length} combinations`);
  const t: InteractionTables = {
    parent: p.elements.map((e) => {
      if (e.parent === null) return -1;
      const i = index.get(e.parent);
      if (i === undefined) throw new StateProgramError(`${e.address}: its parent ${e.parent} is not a partition element`);
      return i;
    }),
    focusable: p.elements.map((e) => e.focusable),
    touchConsumesTap: p.elements.map((e) => touchConsumesTap(e.address)),
    keyboardInput: p.elements.map((e) => keyboardInput(e.address)),
    chainOf: p.chainOf,
    activeChainOf: p.activeChainOf,
    pointerFocusOf: p.pointerFocusOf,
    keyboardFocusOf: p.keyboardFocusOf,
    forcedHoverOf: p.forcedHoverOf,
    forcedActiveOf: p.forcedActiveOf,
    forcedFocusOf: p.forcedFocusOf,
    forcedFocusVisibleOf: p.forcedFocusVisibleOf,
    hoverValues: hover.length,
    activeValues: active.length,
    focusValues: focus.length,
    combos: p.combos,
  };
  rtInteraction.checkInteractionTables(t, p.states.length);
  return t;
}

/** The delta of a program over the state program's base, its engine input found in (or appended to) variants. */
function deltaOver(sp: StateProgram, p: NativeProgram, variants: LayoutVariant[], keys: string[], what: string): StateDelta {
  if (p.version !== sp.base.version) throw new StateProgramError(`${what}: program version ${p.version} differs from the base's ${sp.base.version}`);
  if (p.backend !== sp.backend) throw new StateProgramError(`${what}: a ${p.backend} program in a ${sp.backend} interaction program`);
  const baseNodes = new Map(sp.base.nodes.map((n) => [n.id, n]));
  const baseOrder = sp.base.nodes.map((n) => n.id);
  const ids = new Set(p.nodes.map((n) => n.id));
  if (ids.size !== p.nodes.length) throw new StateProgramError(`${what}: a node id repeats`);
  const removed = baseOrder.filter((id) => !ids.has(id));
  const changed = p.nodes.filter((n) => {
    const b = baseNodes.get(n.id);
    return b === undefined || canonicalJson(b) !== canonicalJson(n);
  });
  const kept = baseOrder.filter((id) => ids.has(id));
  const order = p.nodes.map((n) => n.id);
  const sameOrder = kept.length === order.length && kept.every((id, i) => id === order[i]);
  const own: LayoutVariant = { root: p.root, rootFontSize: p.rootFontSize };
  const key = canonicalJson(own);
  let variant = keys.indexOf(key);
  if (variant < 0) {
    variant = variants.length;
    variants.push(own);
    keys.push(key);
  }
  const shape = (b: LayoutVariant['root']): string => canonicalJson(shapeOf(b));
  const layout = variant === 0 ? 'none' : shape(p.root) === shape(sp.base.root) ? 'styles' : 'tree';
  return { removed, changed, order: sameOrder ? null : order, variant, layout };
}

function shapeOf(b: LayoutVariant['root']): unknown {
  return { id: b.id, boxType: b.boxType, children: b.children.map((c) => (c.kind === 'box' ? shapeOf(c) : c)) };
}

/** Derives the interaction program of a state program from one level input per app assignment, in the program's order. */
export function deriveInteractionProgram(sp: StateProgram, inputs: readonly InteractionLevelInput[]): InteractionProgram {
  if (inputs.length !== sp.assignments.length) throw new StateProgramError(`${inputs.length} interaction levels for ${sp.assignments.length} app assignments`);
  const variants = [...sp.variants];
  const keys = variants.map((v) => canonicalJson(v));
  const levels = inputs.map((input, app): InteractionLevel => {
    const p = input.partition;
    if (input.programs.length !== p.states.length) throw new StateProgramError(`app assignment ${app}: ${input.programs.length} programs for ${p.states.length} interaction states`);
    return {
      tables: interactionTables(p, input.touchConsumesTap, input.keyboardInput),
      addresses: p.elements.map((e) => e.address),
      deltas: input.programs.map((prog, k) => deltaOver(sp, prog, variants, keys, `app assignment ${app}, interaction state ${k}`)),
    };
  });
  return { version: INTERACTION_PROGRAM_VERSION, backend: sp.backend, program: sp, variants, levels };
}

/** The delta of (app, state); state -1 is the app assignment's own (the none state). */
export function interactionDelta(ip: InteractionProgram, app: number, state: number): StateDelta {
  if (state < 0) {
    const d = ip.program.deltas[app];
    if (d === undefined) throw new StateProgramError(`no app assignment ${app}`);
    return d;
  }
  const d = ip.levels[app]?.deltas[state];
  if (d === undefined) throw new StateProgramError(`no interaction state ${state} in app assignment ${app}`);
  return d;
}

/** The program of (app, state), from the interaction program alone. */
export function interactionProgramAt(ip: InteractionProgram, app: number, state: number): NativeProgram {
  if (state < 0) return programAt(ip.program, app);
  const d = interactionDelta(ip, app, state);
  const v = ip.variants[d.variant] as LayoutVariant;
  return { ...ip.program.base, root: v.root, rootFontSize: v.rootFontSize, nodes: applyDelta(ip.program, d) };
}

/** The forced pseudo-classes the runtime takes (CSS.forcePseudoState's names). */
export type ForcedPseudo = 'none' | 'hover' | 'active' | 'focus' | 'focus-visible';

/** One step of an interaction trace on the runtime reference: points are in CSS px of the rendered program. */
export type InteractionStep =
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
  | { readonly kind: 'force'; readonly pseudo: ForcedPseudo; readonly address: string | null }
  | { readonly kind: 'set'; readonly state: string; readonly value: Scalar };

/** What one trace step leaves: the addresses matching each pseudo-class, root first, and the (app, state) the runtime shows. */
export type InteractionSnapshot = {
  readonly hover: readonly string[];
  readonly active: readonly string[];
  readonly focus: string | null;
  readonly focusVisible: string | null;
  readonly app: number;
  readonly state: number;
};

/** The element address at a point (CSS px) of the rendered program of (app, state), or null for none: the live program's hit test. */
export type HitAt = (program: NativeProgram, app: number, state: number, x: number, y: number) => string | null;

/**
 * The TypeScript reference of the generated interaction runtime: the app setters of StateRuntime and the R6 events of
 * rt-interaction.ts over the current app assignment's tables, moving the node records to the (app, state) they select. After every
 * committed change it calls onChange (a mount re-renders), and when the interaction state changes, onInteractionChange(app, from,
 * to) once (R16, ANIM-b2's style change event; -1 is the none state). A change that lays out a different engine input while a
 * hovering pointer is present re-hits the pointer's last point once, at the same step (P11).
 */
export class InteractionRuntime {
  readonly ip: InteractionProgram;
  private readonly hit: HitAt;
  private readonly faults: InteractionFaults;
  private readonly stateFaults: StateFaults;
  private readonly baseById: Map<string, ProgramNode>;
  private nodes: Map<string, ProgramNode>;
  private order: string[];
  private laidOut: number;
  private app: number;
  private shown: number;
  private pointer: InteractionPointer;
  private last: { x: number; y: number } | null = null;
  private currentDelta: StateDelta;
  onChange: (() => void) | null = null;
  onInteractionChange: ((app: number, from: number, to: number) => void) | null = null;

  constructor(ip: InteractionProgram, hit: HitAt, faults: InteractionFaults = rtInteraction.NO_INTERACTION_FAULTS, stateFaults: StateFaults = NO_STATE_FAULTS) {
    this.ip = ip;
    this.hit = hit;
    this.faults = faults;
    this.stateFaults = stateFaults;
    this.baseById = new Map(ip.program.base.nodes.map((n) => [n.id, n]));
    this.app = ip.program.initial;
    this.shown = -1;
    this.pointer = rtInteraction.interactionStart();
    const d = interactionDelta(ip, this.app, -1);
    const start = applyDelta(ip.program, d);
    this.nodes = new Map(start.map((n) => [n.id, n]));
    this.order = start.map((n) => n.id);
    this.laidOut = d.variant;
    this.currentDelta = d;
  }

  get assignment(): number {
    return this.app;
  }

  get state(): number {
    return this.shown;
  }

  private get level(): InteractionLevel {
    return this.ip.levels[this.app] as InteractionLevel;
  }

  /** The table index of an address in the current app assignment, -1 for none; an address the tables do not hold throws. */
  private indexOf(address: string | null): number {
    if (address === null) return -1;
    const i = this.level.addresses.indexOf(address);
    if (i < 0) throw new StateValueError(`no element ${address} in app assignment ${this.app}'s interaction tables`);
    return i;
  }

  private hitAt(x: number, y: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new StateValueError(`the point (${x}, ${y}) is not finite`);
    return this.indexOf(this.hit(this.program(), this.app, this.shown, x, y));
  }

  /** Runs one trace step and returns what it leaves. */
  step(s: InteractionStep): InteractionSnapshot {
    const rt = rtInteraction;
    const t = this.level.tables;
    const f = this.faults;
    switch (s.kind) {
      case 'move':
        this.last = { x: s.x, y: s.y };
        this.commit(rt.pointerMoved(t, this.pointer, this.hitAt(s.x, s.y)));
        break;
      case 'exit':
        this.commit(rt.pointerExited(t, this.pointer));
        break;
      case 'exit-start':
        this.commit(rt.hoverExitStarted(t, this.pointer));
        break;
      case 'frame':
        this.commit(rt.interactionFrame(t, this.pointer));
        break;
      case 'mouse-down':
        this.last = { x: s.x, y: s.y };
        this.commit(rt.mousePressed(t, this.pointer, this.hitAt(s.x, s.y), f));
        break;
      case 'mouse-up':
        this.commit(rt.mouseReleased(t, this.pointer, f));
        break;
      case 'touch-down':
        this.commit(rt.touchPressed(t, this.pointer, this.hitAt(s.x, s.y), f));
        break;
      case 'touch-up':
        this.commit(rt.touchReleased(t, this.pointer, this.hitAt(s.x, s.y), f));
        break;
      case 'touch-cancel':
        this.commit(rt.touchCancelled(t, this.pointer, f));
        break;
      case 'key':
        this.commit(rt.keyPressed(t, this.pointer, s.modified));
        break;
      case 'force':
        this.commit(rt.forcePseudo(t, this.pointer, s.pseudo, this.indexOf(s.address)));
        break;
      case 'set':
        this.setApp(s.state, s.value);
        break;
    }
    return this.snapshot();
  }

  /** What the live interaction leaves, as addresses. */
  snapshot(): InteractionSnapshot {
    const rt = rtInteraction;
    const t = this.level.tables;
    const a = this.level.addresses;
    const at = (i: number): string | null => (i < 0 ? null : (a[i] as string));
    return {
      hover: rt.hoverMatches(t, this.pointer, this.faults).map((i) => a[i] as string),
      active: rt.activeMatches(t, this.pointer, this.faults).map((i) => a[i] as string),
      focus: at(rt.focusMatch(this.pointer)),
      focusVisible: at(rt.focusVisibleMatch(this.pointer)),
      app: this.app,
      state: this.shown,
    };
  }

  private setApp(key: string, value: Scalar): void {
    const sp = this.ip.program;
    const s = sp.states.findIndex((x) => x.key === key);
    if (s < 0) throw new StateValueError(`no state ${key}; the states are ${sp.states.map((x) => x.key).join(', ')}`);
    const v = (sp.states[s] as StateProgram['states'][number]).domain.findIndex((d) => d === value && typeof d === typeof value);
    if (v < 0) throw new StateValueError(`${key}: ${JSON.stringify(value)} is not in the domain`);
    const to = ((sp.next[this.app] as readonly (readonly number[])[])[s] as readonly number[])[v] as number;
    if (to < 0) throw new StateValueError(`${key} = ${JSON.stringify(value)} is unreachable from app assignment ${this.app}`);
    const fromAddresses = this.level.addresses;
    const toAddresses = (this.ip.levels[to] as InteractionLevel).addresses;
    const remap = fromAddresses.map((x) => toAddresses.indexOf(x));
    this.app = to;
    const t = this.level.tables;
    this.pointer = rtInteraction.remapPointer(t, this.pointer, remap);
    // The setter's own layout comes first, then the pointer's last point is hit on it (P11).
    this.moveTo(to, rtInteraction.interactionState(t, this.pointer), true);
    if (this.pointer.pointerIn && this.last !== null) this.commit(rtInteraction.layoutChanged(t, this.pointer, this.hitAt(this.last.x, this.last.y), this.faults));
  }

  /** Takes a new pointer, moves to the state it selects and, when that lays out another engine input under a hovering pointer, re-hits once. */
  private commit(p: InteractionPointer): void {
    this.pointer = p;
    const t = this.level.tables;
    const before = this.laidOut;
    this.moveTo(this.app, rtInteraction.interactionState(t, p), false);
    if (this.laidOut !== before && this.pointer.pointerIn && this.last !== null) {
      this.pointer = rtInteraction.layoutChanged(t, this.pointer, this.hitAt(this.last.x, this.last.y), this.faults);
      this.moveTo(this.app, rtInteraction.interactionState(t, this.pointer), false);
    }
  }

  private moveTo(app: number, state: number, appChanged: boolean): void {
    const from = this.shown;
    if (!appChanged && state === from) return;
    const old = this.currentDelta;
    const d = interactionDelta(this.ip, app, state);
    const touched = new Set([...old.removed, ...old.changed.map((n) => n.id), ...d.removed, ...d.changed.map((n) => n.id)]);
    const removed = new Set(d.removed);
    const changed = new Map(d.changed.map((n) => [n.id, n]));
    for (const id of touched) {
      const n = removed.has(id) ? undefined : (changed.get(id) ?? this.baseById.get(id));
      if (n === undefined) this.nodes.delete(id);
      else this.nodes.set(id, n);
    }
    this.order = d.order === null ? this.ip.program.base.nodes.map((n) => n.id).filter((id) => this.nodes.has(id)) : [...d.order];
    if (!this.stateFaults.setterSkipsRelayout && d.variant !== this.laidOut) this.laidOut = d.variant;
    this.currentDelta = d;
    this.shown = state;
    this.onChange?.();
    if (state !== from) this.onInteractionChange?.(app, from, state);
  }

  /** The live program: the current node records over the engine input last laid out. */
  program(): NativeProgram {
    const v = this.ip.variants[this.laidOut] as LayoutVariant;
    return {
      ...this.ip.program.base,
      root: v.root,
      rootFontSize: v.rootFontSize,
      nodes: this.order.map((id) => {
        const n = this.nodes.get(id);
        if (n === undefined) throw new StateProgramError(`the runtime orders ${id}, which it does not hold`);
        return n;
      }),
    };
  }
}
