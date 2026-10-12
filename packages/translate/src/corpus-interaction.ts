// The interaction suite (SELD-R2, T064 R12): synthetic interaction tables and event scripts, built in code, so the translated
// interaction runtime in Swift and Kotlin is judged against the TypeScript one on every event and every rule it implements.
import type { InteractionTables } from '../../layout/src/rt-interaction.ts';
import { checkInteractionTables } from '../../layout/src/rt-interaction.ts';
import { runLibraryCase } from '../harness/harness.ts';

/** One script step: [kind, ...arguments] as the harness reads it (harness.ts rtInteractionResult). */
export type InteractionStep = readonly (string | number | boolean | readonly number[])[];

/** One table set: its tables, its state count and the scripts it runs. */
export type InteractionSet = { readonly name: string; readonly tables: InteractionTables; readonly states: number };

/** MINSTD: deterministic and exact in doubles, so the suite never depends on Math.random. */
class Lcg {
  private s: number;
  constructor(seed: number) {
    this.s = seed % 2147483647 || 1;
  }
  int(n: number): number {
    this.s = (this.s * 48271) % 2147483647;
    return this.s % n;
  }
}

type Shape = { readonly parent: readonly number[]; readonly focusable: readonly boolean[]; readonly touchConsumesTap: readonly boolean[]; readonly keyboardInput: readonly boolean[]; readonly hoverValues: number; readonly activeValues: number; readonly focusValues: number; readonly states: number };

/** Tables over a tree shape with every value drawn in range: chains and focus values, forced states and combos, some -1. */
function tablesOf(shape: Shape, seed: number): InteractionTables {
  const r = new Lcg(seed);
  const n = shape.parent.length;
  const each = (f: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => f(i));
  const stateOrNone = (): number => (r.int(4) === 0 ? -1 : r.int(shape.states));
  const combos = Array.from({ length: shape.hoverValues * shape.activeValues * shape.focusValues }, (_, c) => (c === 0 ? -1 : stateOrNone()));
  return {
    parent: shape.parent,
    focusable: shape.focusable,
    touchConsumesTap: shape.touchConsumesTap,
    keyboardInput: shape.keyboardInput,
    chainOf: each(() => r.int(shape.hoverValues)),
    activeChainOf: each(() => r.int(shape.activeValues)),
    pointerFocusOf: each(() => r.int(shape.focusValues)),
    keyboardFocusOf: each((i) => (shape.focusable[i] === true ? r.int(shape.focusValues) : -1)),
    forcedHoverOf: each(stateOrNone),
    forcedActiveOf: each(stateOrNone),
    forcedFocusOf: each(stateOrNone),
    forcedFocusVisibleOf: each(stateOrNone),
    hoverValues: shape.hoverValues,
    activeValues: shape.activeValues,
    focusValues: shape.focusValues,
    combos,
  };
}

/**
 * Set A: html(0) > body(1) > div(2) > button(3) > span(4); div > range(5), focusable and consuming a tap; body > text input(6),
 * focusable keyboard input; body > p(7). The hand scripts name these indices.
 */
const SHAPE_A: Shape = {
  parent: [-1, 0, 1, 2, 3, 2, 1, 1],
  focusable: [false, false, false, true, false, true, true, false],
  touchConsumesTap: [false, false, false, false, false, true, false, false],
  keyboardInput: [false, false, false, false, false, false, true, false],
  hoverValues: 3,
  activeValues: 3,
  focusValues: 4,
  states: 9,
};

/** Set B: a flat root with six children, alternating focusable, one of them consuming a tap and one a keyboard input. */
const SHAPE_B: Shape = {
  parent: [-1, 0, 0, 0, 0, 0, 0],
  focusable: [false, true, false, true, false, true, true],
  touchConsumesTap: [false, false, false, true, false, false, false],
  keyboardInput: [false, false, false, false, false, true, false],
  hoverValues: 2,
  activeValues: 4,
  focusValues: 3,
  states: 5,
};

/** Set C: a deep chain with a focusable root, so every press focuses something; one value per dimension but focus. */
const SHAPE_C: Shape = {
  parent: [-1, 0, 1, 2, 3, 4],
  focusable: [true, false, false, true, false, false],
  touchConsumesTap: [false, false, false, false, false, true],
  keyboardInput: [false, false, false, true, false, false],
  hoverValues: 1,
  activeValues: 2,
  focusValues: 3,
  states: 3,
};

export function interactionSets(): InteractionSet[] {
  const sets = [
    { name: 'A', tables: tablesOf(SHAPE_A, 20261009), states: SHAPE_A.states },
    { name: 'B', tables: tablesOf(SHAPE_B, 20261010), states: SHAPE_B.states },
    { name: 'C', tables: tablesOf(SHAPE_C, 20261011), states: SHAPE_C.states },
  ];
  for (const s of sets) checkInteractionTables(s.tables, s.states);
  return sets;
}

/** Scripts on set A, one per rule of the runtime. */
const HAND_A: readonly (readonly InteractionStep[])[] = [
  // A mouse press focuses the nearest focusable inclusive ancestor, or clears focus; release clears the active chain.
  [['move', 4], ['mouse-down', 4], ['mouse-up'], ['move', 7], ['mouse-down', 7], ['mouse-up'], ['mouse-down', 6], ['mouse-up'], ['mouse-down', -1], ['mouse-up']],
  // A tap never hovers; it focuses at release, except on the range, which consumes it; a keyboard input gets focus-visible.
  [['touch-down', 4], ['touch-up', 4], ['touch-down', 5], ['touch-up', 5], ['touch-down', 6], ['touch-up', 6], ['touch-down', 3], ['touch-cancel'], ['touch-down', 7], ['touch-up', 7]],
  // A non-modified key after pointer focus turns focus-visible on; a pointer press turns it off; keyboard focus sets it.
  [['mouse-down', 4], ['mouse-up'], ['key', true], ['key', false], ['mouse-down', 3], ['key', false], ['key-focus', 5], ['mouse-down', 7], ['key', false], ['key-focus', -1], ['key', false]],
  // Android's hover exit before a press keeps hover through the press; a frame without a press clears it.
  [['move', 4], ['exit-start'], ['mouse-down', 4], ['frame'], ['mouse-up'], ['exit-start'], ['frame'], ['move', 7], ['exit-start'], ['move', 2], ['frame'], ['exit']],
  // A layout change re-hits under a hovering pointer, remaps press and focus, and drops what left the tree.
  [['move', 4], ['mouse-down', 4], ['remap', [0, 1, 2, 5, 7, 3, 6, 4]], ['layout', 7], ['mouse-up'], ['remap', [0, 1, 2, -1, -1, 3, 6, 7]], ['layout', 2], ['exit'], ['remap', [0, 1, 2, 3, 4, 5, 6, 7]], ['layout', 3], ['key-focus', 6], ['remap', [0, 1, -1, -1, -1, -1, -1, -1]], ['layout', -1]],
  // A forced pseudo-class overrides every real interaction until it stops, and a layout change that drops its element stops it.
  [['move', 4], ['force', 'hover', 2], ['mouse-down', 3], ['force', 'active', 4], ['force', 'focus', 3], ['force', 'focus-visible', 6], ['mouse-up'], ['force', 'none', -1], ['force', 'focus', 5], ['force', 'none', 2], ['force', 'hover', 7], ['remap', [0, 1, 2, 3, 4, 5, 6, -1]], ['layout', 4]],
];

/** A walk of valid events: elements in range, keyboard focus only on focusable elements, forcing only on an element. */
function walk(set: InteractionSet, seed: number, steps: number): InteractionStep[] {
  const r = new Lcg(seed);
  const t = set.tables;
  const n = t.parent.length;
  const focusable = t.parent.map((_, i) => i).filter((i) => t.focusable[i] === true);
  const hit = (): number => r.int(n + 1) - 1;
  const kinds = ['hover', 'active', 'focus', 'focus-visible'];
  const out: InteractionStep[] = [];
  for (let i = 0; i < steps; i++) {
    const k = r.int(15);
    if (k === 0) out.push(['move', hit()]);
    else if (k === 1) out.push(['exit']);
    else if (k === 2) out.push(['exit-start']);
    else if (k === 3) out.push(['frame']);
    else if (k === 4) out.push(['mouse-down', hit()]);
    else if (k === 5) out.push(['mouse-up']);
    else if (k === 6) out.push(['touch-down', hit()]);
    else if (k === 7) out.push(['touch-up', hit()]);
    else if (k === 8) out.push(['touch-cancel']);
    else if (k === 9) out.push(['key', r.int(2) === 0]);
    else if (k === 10) out.push(['key-focus', r.int(3) === 0 ? -1 : (focusable[r.int(focusable.length)] as number)]);
    else if (k === 11) out.push(['remap', remap(t, r)]);
    else if (k === 12) out.push(['layout', hit()]);
    else if (k === 13) out.push(['force', kinds[r.int(kinds.length)] as string, r.int(n)]);
    else out.push(['force', 'none', hit()]);
  }
  return out;
}

/** A remap that keeps focus valid: focusable elements go to focusable elements or leave, the others anywhere or leave. */
function remap(t: InteractionTables, r: Lcg): number[] {
  const n = t.parent.length;
  const focusable = t.parent.map((_, i) => i).filter((i) => t.focusable[i] === true);
  return t.parent.map((_, i) => {
    if (r.int(5) === 0) return -1;
    return t.focusable[i] === true ? (focusable[r.int(focusable.length)] as number) : r.int(n);
  });
}

/** One script on every table set that sends every event once, the indices taken from the set's own size. */
function everyEvent(set: InteractionSet): InteractionStep[] {
  const n = set.tables.parent.length;
  const last = n - 1;
  const f = set.tables.parent.map((_, i) => i).filter((i) => set.tables.focusable[i] === true);
  const keyTarget = f[f.length - 1] as number;
  return [['move', last], ['exit-start'], ['frame'], ['move', 1], ['mouse-down', last], ['mouse-up'], ['touch-down', 1], ['touch-up', 1], ['touch-down', last], ['touch-cancel'], ['key', true], ['key', false], ['key-focus', keyTarget], ['remap', set.tables.parent.map((_, i) => i)], ['layout', 0], ['force', 'hover', last], ['force', 'active', 0], ['force', 'focus', 1], ['force', 'focus-visible', last], ['force', 'none', -1], ['exit']];
}

/** The suite's lines: ['rt-interaction', tables, states, steps], set A's hand scripts, then every set's event and walk scripts. */
export function interactionCases(): string[] {
  const sets = interactionSets();
  const line = (s: InteractionSet, steps: readonly InteractionStep[]): string => JSON.stringify(['rt-interaction', s.tables, s.states, steps]);
  const a = sets[0] as InteractionSet;
  const out = HAND_A.map((steps) => line(a, steps));
  sets.forEach((s, i) => {
    out.push(line(s, everyEvent(s)));
    for (let w = 0; w < 4; w++) out.push(line(s, walk(s, 7919 * (i + 1) + 104729 * w, 50)));
  });
  return out;
}

/** The suite's expected results; a line the TypeScript reference threw on or refused fails the build, not the natives. */
export function interactionExpected(lines: readonly string[]): string[] {
  return lines.map((line, i) => {
    const r = runLibraryCase(line);
    if (!r.startsWith('["ok",')) throw new Error(`interaction case ${i}: the TypeScript reference answered ${r.slice(0, 200)}, not a result`);
    return r;
  });
}
