// PNT1 stacking facts and the native placement (T046 §1, RT-9): every node of the stacking fixtures carries the facts rt-hit.ts
// reads (paint-order index, stacking context, host, clip chain), and on every case of the corpus the device's
// placement, emulated here step for step as native-support.ts DragonTree.apply and the stacking module's sort do it (views added
// in engine box order to their host's container, the container sorted after each box: flow children in place, layer items by
// bucket and rank), puts every layer item where Appendix E paints it, and gives the [host, index] each paint-order write expects.
// Flow siblings keep the engine's box order, which is not tree order for reversed or reordered flex items (a paint order the native
// tree had before PNT1, visible only where such items overlap), so the order check is on every pair that holds a layer item (and
// no box kept under a clip).
import { describe, expect, it } from 'vitest';
import type { NativeProgram, ProgramNode } from 'dragon';
import { engineLayoutProjection, nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { FIXTURE_GROUPS, FIXTURES } from '../src/fixtures.ts';
import { engineBoxes, nativeCompileOnce } from '../src/native-host.ts';
import { shapedCaseIds } from '../src/text-latin-run.ts';

type Facts = { paintOrder: number; context: string | null; createsContext: boolean; layer: string; host: string | null; clipChain: readonly string[]; underClip: boolean };
const factsOf = (n: ProgramNode): Facts | undefined => n.facts['stacking'] as Facts | undefined;

/** The device's placement of a program: children per container after DragonTree.apply's insertions and the stacking sorts. */
function emulate(p: NativeProgram): { order: string[]; index: Map<string, [string, number]> } {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const key = (n: ProgramNode): [number, number] => {
    const w = n.writes.find((x) => x.kind === 'paint-order');
    return w === undefined || w.kind !== 'paint-order' ? [0, 0] : [w.bucket, w.rank];
  };
  const hostOf = (n: ProgramNode): string | null => {
    const w = n.writes.find((x) => x.kind === 'paint-order');
    return w !== undefined && w.kind === 'paint-order' ? w.host : n.parent;
  };
  const containers = new Map<string, ProgramNode[]>();
  const sort = (c: ProgramNode[]): void => {
    if (!c.some((n) => key(n)[0] !== 0)) return;
    const keyed = c.map((n, i) => ({ n, k: [...key(n), i] as number[] }));
    keyed.sort((a, b) => (a.k[0] as number) - (b.k[0] as number) || (a.k[0] === 0 ? 0 : (a.k[1] as number) - (b.k[1] as number)) || (a.k[2] as number) - (b.k[2] as number));
    c.splice(0, c.length, ...keyed.map((x) => x.n));
  };
  // DragonTree.apply walks the engine's boxes in order (lines are skipped; text leaves and boxes are placed in that order).
  const rects = engineBoxes(p, { width: 400, height: 300 }, 2).filter((r) => !(r.parent !== null && r.id.startsWith(`${r.parent}:line`)));
  for (const r of rects) {
    const n = byId.get(r.id);
    if (n === undefined) throw new Error(`${r.id}: laid out but not in the program`);
    const h = hostOf(n);
    if (h === null) continue;
    const c = containers.get(h) ?? [];
    containers.set(h, c);
    c.push(n);
    // The stacking module's after-layout hook sorts the container of every box it places.
    if (n.kind !== 'text') sort(c);
  }
  const order: string[] = [];
  const index = new Map<string, [string, number]>();
  const walk = (id: string): void => {
    order.push(id);
    const c = containers.get(id) ?? [];
    c.filter((n) => n.kind !== 'text').forEach((n, i) => index.set(n.id, [id, i]));
    for (const n of c) walk(n.id);
  };
  const root = p.nodes.find((n) => n.parent === null);
  if (root === undefined) throw new Error('no root');
  walk(root.id);
  return { order, index };
}

const refusedFaces = new Map<string, string>();

// A case native refuses only for its real faces (deferred to TXT1a-2 phase R) gets the engine lowering instead; it is left out here.
const programsOf = (spec: (typeof FIXTURES)[number]) =>
  spec.kind !== 'layout' ? [] : casesOf(spec, fixtureInput(spec)).flatMap((c) => {
    const compiled = nativeCompileOnce(spec, c.environment.direction);
    const r = nativePrograms(compiled, c.assignment);
    if (r.kind !== 'ready') {
      if (engineLayoutProjection(compiled, c.environment, c.assignment).kind !== 'ready') throw new Error(`${c.id}: ${r.reason}`);
      refusedFaces.set(c.id, r.reason);
      return [];
    }
    return [{ id: c.id, p: r.programs.uikit }];
  });

describe('PNT1 stacking facts (rt-hit.ts)', () => {
  const stacking = (FIXTURE_GROUPS.find((g) => g.id === 'effects')?.fixtures ?? []).filter((f) => f.id.startsWith('stacking-')).flatMap(programsOf);
  it('covers the six stacking fixtures in both directions', () => {
    expect(stacking.map((s) => s.id)).toEqual(['stacking-basic', 'stacking-basic-rtl', 'stacking-context', 'stacking-context-rtl', 'stacking-escape', 'stacking-escape-rtl', 'stacking-transform', 'stacking-transform-rtl', 'stacking-grid-items', 'stacking-grid-items-rtl', 'stacking-isolation', 'stacking-isolation-rtl']);
  });
  for (const { id, p } of stacking) {
    it(`${id}: every box has its paint-order index, stacking context, host and clip chain; the indices are a permutation`, () => {
      const boxes = p.nodes.filter((n) => n.kind !== 'text');
      const indices: number[] = [];
      for (const n of boxes) {
        const f = factsOf(n);
        expect(f, n.id).toBeDefined();
        if (f === undefined) continue;
        indices.push(f.paintOrder);
        expect(Number.isInteger(f.paintOrder), n.id).toBe(true);
        expect(f.context === null, n.id).toBe(n.parent === null);
        expect(f.host === null, n.id).toBe(n.parent === null);
        if (f.context !== null) expect(p.nodes.some((x) => x.id === f.context && factsOf(x)?.createsContext === true), n.id).toBe(true);
        expect(Array.isArray(f.clipChain), n.id).toBe(true);
        expect(['flow', 'negative', 'positioned', 'positive'], n.id).toContain(f.layer);
      }
      expect(new Set(indices).size).toBe(indices.length);
    });
  }
});

describe('the device placement gives Appendix E order on every case', () => {
  const all = FIXTURES.flatMap(programsOf);
  it('covers every layout case of the corpus but the shaped ones native refuses for their faces', () => {
    expect(all.length).toBeGreaterThan(400);
    const layout = FIXTURES.flatMap((f) => (f.kind === 'layout' ? casesOf(f, fixtureInput(f)).map((c) => c.id) : []));
    expect([...all.map((a) => a.id), ...refusedFaces.keys()].sort()).toEqual([...layout].sort());
    expect(refusedFaces.size).toBeGreaterThan(0);
    expect([...refusedFaces.keys()].filter((id) => !shapedCaseIds().has(id))).toEqual([]);
    for (const [id, reason] of refusedFaces) expect(reason, id).toMatch(/^the (ios|android) target is blocked$/);
  });
  it('the emulated native order is the paint order, and every paint-order write expects its emulated [host, index]', () => {
    const problems: string[] = [];
    let written = 0;
    for (const { id, p } of all) {
      const { order, index } = emulate(p);
      const boxes = p.nodes.filter((n) => n.kind !== 'text');
      const at = new Map(order.map((x, k) => [x, k]));
      for (const a of boxes) {
        const fa = factsOf(a) as Facts;
        for (const b of boxes) {
          const fb = factsOf(b) as Facts;
          // A box that stays under an overflow clip its layer would leave paints in the clip's order (lower/paint/stacking.ts).
          if (a === b || (fa.layer === 'flow' && fb.layer === 'flow') || fa.underClip || fb.underClip) continue;
          if (fa.paintOrder < fb.paintOrder !== (at.get(a.id) as number) < (at.get(b.id) as number)) problems.push(`${id}: ${a.id} and ${b.id} paint in the other order natively`);
        }
      }
      for (const n of p.nodes) {
        const w = n.writes.find((x) => x.kind === 'paint-order');
        if (w === undefined || w.kind !== 'paint-order') continue;
        written++;
        const at = index.get(n.id);
        if (at === undefined || at[0] !== w.host || at[1] !== w.index) problems.push(`${id} ${n.id}: expects [${w.host}, ${w.index}], the placement gives ${JSON.stringify(at)}`);
      }
    }
    expect(problems).toEqual([]);
    expect(written).toBeGreaterThan(0);
  });
});
