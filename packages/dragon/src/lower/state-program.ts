// The finite-state program of a tree with states (notes/T047-runtime-spec.md RT-1, SELD-R1a): one base program (the initial
// assignment's per-case program) plus, for every reachable assignment, a delta over the base: the nodes it removes, the node records
// it changes or adds, the node order when it differs, and which engine input it lays out. The per-case program of each assignment is
// the oracle: base plus its delta must equal it exactly, and a runtime that moves between assignments through the setters must land
// on it. Layout inputs are deduplicated into variants; a setter lays out again only when the variant changes.
import type { LayoutBox } from '@dragon/layout';
import { assignmentKey } from '../analysis/link.ts';
import { canonicalJson } from '../digest.ts';
import type { CompilerFaults } from '../faults.ts';
import type { Assignment, Scalar } from '../types.ts';
import type { NativeBackend, NativeProgram, ProgramNode } from './native-program.ts';

export const STATE_PROGRAM_VERSION = 'dragon.state-program/1';

/** The most assignments a state table holds (T047 §3.3): a larger table is refused, never truncated. */
export const MAX_STATE_TABLE_ASSIGNMENTS = 64;

export type StateFaults = Pick<CompilerFaults, 'stateDeltaDropped' | 'setterSkipsRelayout'>;
export const NO_STATE_FAULTS: StateFaults = { stateDeltaDropped: false, setterSkipsRelayout: false };

export class StateProgramError extends Error {}

/** One free state: its key ("<instance>#<state>"), and its domain in the order the reachable assignments first use each value. */
export type StateVariable = { readonly key: string; readonly instance: string; readonly state: string; readonly domain: readonly Scalar[] };

/** How an assignment's engine input differs from the base: not at all, only in box styles, or in the tree itself. */
export type LayoutChange = 'none' | 'styles' | 'tree';

export type StateDelta = {
  /** Base node ids the assignment does not have. */
  readonly removed: readonly string[];
  /** The assignment's node records that differ from the base or are not in it, in the assignment's node order. */
  readonly changed: readonly ProgramNode[];
  /** The assignment's node order, when it is not the base order without the removed nodes. */
  readonly order: readonly string[] | null;
  /** The index into variants of the engine input the assignment lays out. */
  readonly variant: number;
  readonly layout: LayoutChange;
};

export type StateProgram = {
  readonly version: string;
  readonly backend: NativeBackend;
  readonly states: readonly StateVariable[];
  /** Every reachable assignment, in the compiler's enumeration order, with its assignmentKey. */
  readonly assignments: readonly { readonly key: string; readonly assignment: Assignment }[];
  readonly initial: number;
  readonly base: NativeProgram;
  /** The distinct engine inputs (the tree and its root font size), the base's first. */
  readonly variants: readonly LayoutVariant[];
  /** One per assignment; the initial assignment's is empty. */
  readonly deltas: readonly StateDelta[];
  /** next[a][s][v]: the assignment reached from a by setting state s to its v-th domain value, or -1 when it is unreachable. */
  readonly next: readonly (readonly (readonly number[])[])[];
};

/** One engine input of a state program: the layout tree and the root font size it resolves rem against. */
export type LayoutVariant = { readonly root: LayoutBox; readonly rootFontSize: number };

export type StateCase = { readonly assignment: Assignment; readonly isInitial: boolean; readonly program: NativeProgram };

const escapeKeyPart = (s: string): string => s.replace(/[\\#]/g, (c) => `\\${c}`);

/**
 * A free state's key, "<instance>#<state>" with every '#' and '\' inside either part escaped by a '\', so two different
 * (instance, state) pairs never share a key (doc/a with b#c is doc/a#b\#c, doc/a#b with c is doc/a\#b#c).
 */
export const stateKey = (instance: string, state: string): string => `${escapeKeyPart(instance)}#${escapeKeyPart(state)}`;

const sameScalar = (a: Scalar, b: Scalar): boolean => a === b && typeof a === typeof b;

/** The layout-tree shape without styles: box ids, types and children, and text leaves whole. */
function shapeOf(b: LayoutBox): unknown {
  return { id: b.id, boxType: b.boxType, children: b.children.map((c) => (c.kind === 'box' ? shapeOf(c) : c)) };
}

/** Derives the state program of one tree case set (one fixture and direction) for one backend. */
export function deriveStateProgram(backend: NativeBackend, cases: readonly StateCase[], faults: StateFaults = NO_STATE_FAULTS): StateProgram {
  if (cases.length === 0) throw new StateProgramError('a state program needs at least one case');
  if (cases.length > MAX_STATE_TABLE_ASSIGNMENTS) throw new StateProgramError(`${cases.length} reachable assignments exceed the state table limit of ${MAX_STATE_TABLE_ASSIGNMENTS}`);
  const initials = cases.flatMap((c, i) => (c.isInitial ? [i] : []));
  if (initials.length !== 1) throw new StateProgramError(`a state program needs exactly one initial case, got ${initials.length}`);
  const initial = initials[0] as number;
  for (const c of cases) if (c.program.backend !== backend) throw new StateProgramError(`a ${c.program.backend} program in a ${backend} state program`);

  const keys = cases.map((c) => assignmentKey(c.assignment));
  if (new Set(keys).size !== keys.length) throw new StateProgramError('two cases have the same assignment');
  const states: { key: string; instance: string; state: string; domain: Scalar[] }[] = [];
  const first = (cases[0] as StateCase).assignment;
  for (const a of first) states.push({ key: stateKey(a.state.instance, a.state.state), instance: a.state.instance, state: a.state.state, domain: [] });
  for (const c of cases) {
    if (c.assignment.length !== states.length) throw new StateProgramError(`assignment ${assignmentKey(c.assignment)} does not name every free state`);
    for (const s of states) {
      const found = c.assignment.filter((a) => stateKey(a.state.instance, a.state.state) === s.key);
      if (found.length !== 1) throw new StateProgramError(`assignment ${assignmentKey(c.assignment)} names ${s.key} ${found.length} times`);
      const v = (found[0] as Assignment[number]).value;
      if (!s.domain.some((d) => sameScalar(d, v))) s.domain.push(v);
    }
  }

  const base = (cases[initial] as StateCase).program;
  const baseNodes = new Map(base.nodes.map((n) => [n.id, n]));
  const baseOrder = base.nodes.map((n) => n.id);
  const variants: LayoutVariant[] = [{ root: base.root, rootFontSize: base.rootFontSize }];
  const variantKeys = [canonicalJson(variants[0])];
  const baseShape = canonicalJson(shapeOf(base.root));
  const deltas = cases.map((c): StateDelta => {
    const p = c.program;
    if (p.version !== base.version) throw new StateProgramError(`program version ${p.version} differs from the base's ${base.version}`);
    const ids = new Set(p.nodes.map((n) => n.id));
    if (ids.size !== p.nodes.length) throw new StateProgramError(`assignment ${assignmentKey(c.assignment)}: a node id repeats`);
    const removed = baseOrder.filter((id) => !ids.has(id));
    let changed = p.nodes.filter((n) => {
      const b = baseNodes.get(n.id);
      return b === undefined || canonicalJson(b) !== canonicalJson(n);
    });
    // Planted: the lowering loses the last changed node record of every delta.
    if (faults.stateDeltaDropped && changed.length > 0) changed = changed.slice(0, -1);
    const kept = baseOrder.filter((id) => ids.has(id));
    const order = p.nodes.map((n) => n.id);
    const sameOrder = kept.length === order.length && kept.every((id, i) => id === order[i]);
    const own: LayoutVariant = { root: p.root, rootFontSize: p.rootFontSize };
    const rootKey = canonicalJson(own);
    let variant = variantKeys.indexOf(rootKey);
    if (variant < 0) {
      variant = variants.length;
      variants.push(own);
      variantKeys.push(rootKey);
    }
    const layout: LayoutChange = variant === 0 ? 'none' : canonicalJson(shapeOf(p.root)) === baseShape ? 'styles' : 'tree';
    return { removed, changed, order: sameOrder ? null : order, variant, layout };
  });

  const index = new Map(keys.map((k, i) => [k, i]));
  const next = cases.map((c) => states.map((s) => s.domain.map((v) => {
    const moved = c.assignment.map((a) => (stateKey(a.state.instance, a.state.state) === s.key ? { state: a.state, value: v } : a));
    return index.get(assignmentKey(moved)) ?? -1;
  })));
  return {
    version: STATE_PROGRAM_VERSION,
    backend,
    states,
    assignments: cases.map((c, i) => ({ key: keys[i] as string, assignment: c.assignment })),
    initial,
    base,
    variants,
    deltas,
    next,
  };
}

/** The node list of base plus a delta, in the delta's order: what the assignment's per-case program holds. */
export function applyDelta(sp: StateProgram, d: StateDelta): ProgramNode[] {
  const removed = new Set(d.removed);
  const changed = new Map(d.changed.map((n) => [n.id, n]));
  const nodes = new Map<string, ProgramNode>();
  for (const n of sp.base.nodes) if (!removed.has(n.id)) nodes.set(n.id, changed.get(n.id) ?? n);
  for (const n of d.changed) nodes.set(n.id, n);
  const order = d.order ?? sp.base.nodes.map((n) => n.id).filter((id) => !removed.has(id));
  return order.map((id) => {
    const n = nodes.get(id);
    if (n === undefined) throw new StateProgramError(`the delta orders ${id}, which it neither keeps nor adds`);
    return n;
  });
}

/** The program of assignment i, from the state program alone. */
export function programAt(sp: StateProgram, i: number): NativeProgram {
  const d = sp.deltas[i];
  if (d === undefined) throw new StateProgramError(`no assignment ${i}`);
  const v = sp.variants[d.variant] as LayoutVariant;
  return { ...sp.base, root: v.root, rootFontSize: v.rootFontSize, nodes: applyDelta(sp, d) };
}

export class StateValueError extends Error {}

/**
 * The TypeScript reference of the generated runtime (emit/runtime/state.ts): a setter validates its value, moves the node records
 * the old and new deltas touch to the new assignment's, and lays out again only when the engine input variant changes.
 */
export class StateRuntime {
  private nodes: Map<string, ProgramNode>;
  private order: string[];
  private current: number;
  private laidOut: number;
  private readonly baseById: Map<string, ProgramNode>;
  readonly sp: StateProgram;
  private readonly faults: StateFaults;
  /** Called after every committed setter, as the generated machine's onChange is: a mount re-renders from it. */
  onChange: (() => void) | null = null;

  constructor(sp: StateProgram, faults: StateFaults = NO_STATE_FAULTS) {
    this.sp = sp;
    this.faults = faults;
    this.baseById = new Map(sp.base.nodes.map((n) => [n.id, n]));
    this.current = sp.initial;
    const d = sp.deltas[sp.initial] as StateDelta;
    const start = applyDelta(sp, d);
    this.nodes = new Map(start.map((n) => [n.id, n]));
    this.order = start.map((n) => n.id);
    this.laidOut = d.variant;
  }

  get assignment(): number {
    return this.current;
  }

  /** Sets a state by key to a domain value; an unknown state, a value outside the domain or an unreachable result throws first. */
  set(key: string, value: Scalar): void {
    const s = this.sp.states.findIndex((x) => x.key === key);
    if (s < 0) throw new StateValueError(`no state ${key}; the states are ${this.sp.states.map((x) => x.key).join(', ')}`);
    const state = this.sp.states[s] as StateVariable;
    const v = state.domain.findIndex((d) => sameScalar(d, value));
    if (v < 0) throw new StateValueError(`${key}: ${JSON.stringify(value)} is not in the domain ${JSON.stringify(state.domain)}`);
    const to = ((this.sp.next[this.current] as readonly (readonly number[])[])[s] as readonly number[])[v] as number;
    if (to < 0) throw new StateValueError(`${key} = ${JSON.stringify(value)} is unreachable from ${(this.sp.assignments[this.current] as { key: string }).key}`);
    this.moveTo(to);
  }

  private moveTo(to: number): void {
    const from = this.sp.deltas[this.current] as StateDelta;
    const d = this.sp.deltas[to] as StateDelta;
    const touched = new Set([...from.removed, ...from.changed.map((n) => n.id), ...d.removed, ...d.changed.map((n) => n.id)]);
    const removed = new Set(d.removed);
    const changed = new Map(d.changed.map((n) => [n.id, n]));
    for (const id of touched) {
      const n = removed.has(id) ? undefined : (changed.get(id) ?? this.baseById.get(id));
      if (n === undefined) this.nodes.delete(id);
      else this.nodes.set(id, n);
    }
    this.order = d.order === null ? this.sp.base.nodes.map((n) => n.id).filter((id) => this.nodes.has(id)) : [...d.order];
    // Planted: the setter never lays out again.
    if (!this.faults.setterSkipsRelayout && d.variant !== this.laidOut) this.laidOut = d.variant;
    this.current = to;
    this.onChange?.();
  }

  /** The live program: the current node records over the engine input last laid out. */
  program(): NativeProgram {
    const v = this.sp.variants[this.laidOut] as LayoutVariant;
    return {
      ...this.sp.base,
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
