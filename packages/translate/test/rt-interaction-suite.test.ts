// SELD-R2 (T064 R12): the interaction runtime is a translated root, and the interaction suite runs it over synthetic tables and
// event scripts, so the generated Swift and Kotlin runtimes are judged against the TypeScript one on every event.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ForcedKind, InteractionPointer, InteractionTables } from '../../layout/src/rt-interaction.ts';
import * as ia from '../../layout/src/rt-interaction.ts';
import { runLibraryCase } from '../harness/harness.ts';
import { hexBits } from '../harness/host.ts';
import { buildCorpus } from '../src/corpus.ts';
import { interactionCases, interactionExpected, interactionSets } from '../src/corpus-interaction.ts';
import { engineFiles, engineRoots, LAYOUT_SRC, lowerAll } from '../src/generate.ts';

type Step = (string | number | boolean | number[])[];
type Line = [string, InteractionTables, number, Step[]];
type Rec = [number[], number[], number, number, number, number];

const F = ia.NO_INTERACTION_FAULTS;

/** The script run by direct calls of the runtime, independent of the harness decoder and writer. */
function direct(t: InteractionTables, steps: readonly Step[]): Rec[] {
  let s: InteractionPointer = ia.interactionStart();
  return steps.map((g) => {
    const n = g[1] as number;
    if (g[0] === 'move') s = ia.pointerMoved(t, s, n);
    else if (g[0] === 'exit') s = ia.pointerExited(t, s);
    else if (g[0] === 'exit-start') s = ia.hoverExitStarted(t, s);
    else if (g[0] === 'frame') s = ia.interactionFrame(t, s);
    else if (g[0] === 'mouse-down') s = ia.mousePressed(t, s, n, F);
    else if (g[0] === 'mouse-up') s = ia.mouseReleased(t, s, F);
    else if (g[0] === 'touch-down') s = ia.touchPressed(t, s, n, F);
    else if (g[0] === 'touch-up') s = ia.touchReleased(t, s, n, F);
    else if (g[0] === 'touch-cancel') s = ia.touchCancelled(t, s, F);
    else if (g[0] === 'key') s = ia.keyPressed(t, s, g[1] as boolean);
    else if (g[0] === 'key-focus') s = ia.keyboardFocused(t, s, n);
    else if (g[0] === 'remap') s = ia.remapPointer(t, s, g[1] as number[]);
    else if (g[0] === 'layout') s = ia.layoutChanged(t, s, n, F);
    else if (g[0] === 'force') s = ia.forcePseudo(t, s, g[1] as ForcedKind, g[2] as number);
    else throw new Error(`unknown step ${String(g[0])}`);
    return [ia.hoverMatches(t, s, F), ia.activeMatches(t, s, F), ia.focusMatch(s), ia.focusVisibleMatch(s), ia.interactionCombo(t, s), ia.interactionState(t, s)];
  });
}

/** The harness answer with every bits string read back as its number. */
function decoded(answer: string): Rec[] {
  const r = JSON.parse(answer) as [string, [string[], string[], string, string, string, string][]];
  expect(r[0]).toBe('ok');
  return r[1].map(([hv, ac, f, fv, c, st]) => [hv.map(hexBits), ac.map(hexBits), hexBits(f), hexBits(fv), hexBits(c), hexBits(st)]);
}

describe('interaction suite (SELD-R2, T064 R12)', () => {
  const lines = interactionCases();
  const parsed = lines.map((l) => JSON.parse(l) as Line);

  it('translates the interaction runtime: every exported function is an engine root, and it lowers with the harness', () => {
    const roots = engineRoots(engineFiles());
    const exported = Object.entries(ia).filter(([, v]) => typeof v === 'function' && !/^[A-Z]/.test(v.name)).map(([k]) => k);
    expect(exported.length).toBeGreaterThan(20);
    for (const fn of exported) expect(roots.some((r) => r.file === join(LAYOUT_SRC, 'rt-interaction.ts') && r.name === fn), fn).toBe(true);
    const l = lowerAll();
    expect(l.engine.sources.some((s) => s.file === 'packages/layout/src/rt-interaction.ts')).toBe(true);
  }, 120_000);

  it('is deterministic, covers every step kind and forced kind on three table sets, and every line is an answer', () => {
    expect(interactionCases()).toEqual(lines);
    expect(new Set(parsed.map((p) => JSON.stringify(p[1]))).size).toBe(3);
    const kinds = new Set(parsed.flatMap((p) => p[3].map((g) => (g[0] === 'force' ? `force ${String(g[1])}` : String(g[0])))));
    expect([...kinds].sort()).toEqual(['exit', 'exit-start', 'force active', 'force focus', 'force focus-visible', 'force hover', 'force none', 'frame', 'key', 'key-focus', 'layout', 'mouse-down', 'mouse-up', 'move', 'remap', 'touch-cancel', 'touch-down', 'touch-up'].sort());
    const expected = interactionExpected(lines);
    expect(expected.every((e) => e.startsWith('["ok",'))).toBe(true);
  });

  it('the harness answer equals direct calls of the runtime on every line', () => {
    let steps = 0;
    parsed.forEach((p, i) => {
      expect(decoded(runLibraryCase(lines[i] as string)), `line ${i}`).toEqual(direct(p[1], p[3]));
      steps += p[3].length;
    });
    expect(steps).toBeGreaterThan(600);
  });

  it('the hand scripts exercise the rules on set A', () => {
    const at = (i: number): Rec[] => decoded(runLibraryCase(lines[i] as string));
    // Mouse press on the span focuses the button; on the p, which has no focusable ancestor, it clears focus.
    expect([at(0)[1]?.[2], at(0)[4]?.[2]]).toEqual([3, -1]);
    // A tap never hovers; a tap on the range keeps the button's focus; the text input gets focus-visible.
    expect(at(1).every((r) => r[0].length === 0)).toBe(true);
    expect([at(1)[1]?.[2], at(1)[3]?.[2], at(1)[5]?.[3]]).toEqual([3, 3, 6]);
    // A modified key changes nothing; a plain key after pointer focus turns focus-visible on; a press turns it off.
    expect([at(2)[2]?.[3], at(2)[3]?.[3], at(2)[4]?.[3], at(2)[5]?.[3]]).toEqual([-1, 3, -1, 3]);
    // A hover exit then a mouse press keeps hover through the frame.
    expect(at(3)[3]?.[0]).toEqual([0, 1, 2, 3, 4]);
    // A layout change under the hovering pointer re-hits it.
    expect(at(4)[3]?.[0]).toEqual([0, 1, 7]);
    // Forcing hover on the div matches the div alone and overrides the real hover chain.
    expect(at(5)[1]?.[0]).toEqual([2]);
  });

  it('refuses a malformed line with a harness error and an out-of-range element or bad tables with a throw', () => {
    const p = parsed[0] as Line;
    const withSteps = (steps: unknown): string => JSON.stringify([p[0], p[1], p[2], steps]);
    expect(runLibraryCase(withSteps([['jump', 1]]))).toMatch(/^\["harness-error","\$\[3\]\[0\]: step jump expects 1 items, got 2"\]$/);
    expect(runLibraryCase(withSteps([['jump']]))).toBe('["harness-error","$[3][0]: unknown step jump"]');
    expect(runLibraryCase(withSteps([['move']]))).toMatch(/^\["harness-error",/);
    expect(runLibraryCase(withSteps([['move', 1.5]]))).toMatch(/^\["harness-error",.*not an integer/);
    expect(runLibraryCase(withSteps([['force', 'visited', 1]]))).toMatch(/^\["harness-error",.*unexpected visited/);
    expect(runLibraryCase(JSON.stringify([p[0], { ...p[1], combos: undefined }, p[2], []]))).toMatch(/^\["harness-error",/);
    expect(runLibraryCase(JSON.stringify([p[0], p[1], p[2]]))).toMatch(/^\["harness-error",/);
    // Out-of-range elements and invalid events are the runtime's own refusals: the reference throws.
    const n = p[1].parent.length;
    for (const bad of [[['move', n]], [['mouse-down', -2]], [['key-focus', 4]], [['force', 'hover', -1]], [['remap', []], ['move', 1], ['remap', []]], [['move', 1], ['remap', [0, n]]]]) expect(runLibraryCase(withSteps(bad)), JSON.stringify(bad)).toBe('["threw"]');
    // Tables that fail checkInteractionTables throw before any step.
    expect(runLibraryCase(JSON.stringify([p[0], { ...p[1], combos: p[1].combos.map(() => 0) }, p[2], []]))).toBe('["threw"]');
    expect(runLibraryCase(JSON.stringify([p[0], p[1], 0, []]))).toBe('["threw"]');
    expect(() => interactionExpected([lines[0] as string, withSteps([['move', n]])])).toThrow(/interaction case 1: the TypeScript reference answered \["threw"\]/);
  });

  it('every table set passes checkInteractionTables', () => {
    for (const s of interactionSets()) expect(() => ia.checkInteractionTables(s.tables, s.states), s.name).not.toThrow();
  });

  it('is the suite after animator in the corpus', () => {
    const c = buildCorpus();
    const names = c.suites.map((s) => s.name);
    expect(names.indexOf('interaction')).toBe(names.indexOf('animator') + 1);
    expect(c.suites.find((s) => s.name === 'interaction')?.lines).toEqual(lines);
  }, 600_000);
});
