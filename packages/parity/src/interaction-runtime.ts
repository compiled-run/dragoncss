// SELD-R2 PR 3 (notes/T064-seld-r2-spec.md R6, R12, R16): the TypeScript reference of the generated interaction runtime, over an
// interaction program (packages/dragon lower/interaction-program.ts) and rt-interaction.ts. It lives here because the compiler core
// imports @dragon/layout for types only.
import type { InteractionFaults, InteractionPointer } from '@dragon/layout';
import { rtInteraction } from '@dragon/layout';
import type { InteractionLevel, InteractionProgram, LayoutVariant, NativeProgram, ProgramNode, Scalar, StateDelta, StateFaults, StateProgram } from 'dragon';
import { applyDelta, interactionDelta, NO_STATE_FAULTS, StateProgramError, StateValueError } from 'dragon';

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
 * step that changes the shown program it calls onChange once (a mount re-renders), and when the step changes the interaction state,
 * onInteractionChange(fromApp, from, toApp, to) once (R16, ANIM-b2's style change event; -1 is the none state; states index their
 * own app's levels). A change that lays out a different engine input while a
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
  onInteractionChange: ((fromApp: number, from: number, toApp: number, to: number) => void) | null = null;

  constructor(ip: InteractionProgram, hit: HitAt, faults: InteractionFaults = rtInteraction.NO_INTERACTION_FAULTS, stateFaults: StateFaults = NO_STATE_FAULTS) {
    for (const l of ip.levels) rtInteraction.checkInteractionTables(l.tables, l.deltas.length);
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
    const fromApp = this.app;
    const from = this.shown;
    const delta = this.currentDelta;
    this.apply(s);
    if (this.app !== fromApp || this.currentDelta !== delta) this.onChange?.();
    // One event per step (R16): an app setter between two none states is the setter's own event, not an interaction change.
    if ((this.app !== fromApp || this.shown !== from) && !(from < 0 && this.shown < 0)) this.onInteractionChange?.(fromApp, from, this.app, this.shown);
    return this.snapshot();
  }

  private apply(s: InteractionStep): void {
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
