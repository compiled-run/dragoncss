// The interaction program of a state program (notes/T064-seld-r2-spec.md R7, R12, R16): under each app assignment, the tables the
// interaction runtime (packages/layout rt-interaction.ts) selects a state with, and per distinct interaction state a delta over
// the state program's base. The states are a second level under the app assignment, never more assignments in the 64-cap table.
// The per-case program of every (app, state) is the oracle: base plus its delta must equal it, and the runtime must land on it.
import type { InteractionTables } from '@dragon/layout';
import type { InteractionPartition } from '../analysis/interaction.ts';
import { canonicalJson } from '../digest.ts';
import type { NativeBackend, NativeProgram } from './native-program.ts';
import type { LayoutVariant, StateDelta, StateProgram } from './state-program.ts';
import { applyDelta, programAt, StateProgramError } from './state-program.ts';

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

/** The interaction tables of a partition (R7): its per-element tables with parents as indices, and its dimension sizes (rt-interaction checkInteractionTables checks them). */
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
