// PNT1 stacking facts and the native placement (T046 §1, RT-9): every node of the stacking fixtures carries the facts rt-hit.ts
// reads (paint-order index, stacking context, host, clip chain; radii where rounded), and on every case of the corpus the device's
// placement, emulated here step for step as native-support.ts DragonTree.apply and the stacking module's sort do it (views added
// in engine box order to their host's container, the container sorted whenever a view joins it: flow children in place, the
// foreground by rank, layer items by bucket and rank), puts every layer item and every hosted text leaf and flex item where
// Appendix E paints it, and gives the [host, index] each paint-order and paint-foreground write expects. Flow siblings keep the
// engine's box order, which is not tree order for reversed flex lines (a paint order the native tree had before PNT1, visible only
// where such boxes overlap), so the order check is on every pair that holds a layer item or a text leaf (and no node kept under a
// clip: underClip, foregroundClip).
import { describe, expect, it } from 'vitest';
import type { NativeProgram, ProgramNode } from 'dragon';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { FIXTURE_GROUPS, FIXTURES } from '../src/fixtures.ts';
import { engineBoxes, nativeCompile } from '../src/native-host.ts';

type Facts = { paintOrder: number; context: string | null; createsContext: boolean; layer: string; atomic: boolean; host: string | null; clipChain: readonly string[]; underClip: boolean; textPaintOrder: readonly number[]; foregroundClip: boolean };
const factsOf = (n: ProgramNode): Facts | undefined => n.facts['stacking'] as Facts | undefined;

/** The device's placement of a program: children per container after DragonTree.apply's insertions and the stacking sorts. */
function emulate(p: NativeProgram): { order: string[]; index: Map<string, [string, number]>; nodeIndex: Map<string, [string, number]> } {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  // The foreground placements, by the id each entry places (written on its box or its text leaves' box).
  const fg = new Map<string, { host: string; rank: number }>();
  for (const n of p.nodes) for (const w of n.writes) if (w.kind === 'paint-foreground') for (const e of w.entries) fg.set(e.id, { host: w.host, rank: e.rank });
  const key = (n: ProgramNode): [number, number, number] => {
    const w = n.writes.find((x) => x.kind === 'paint-order');
    if (w !== undefined && w.kind === 'paint-order') return [w.bucket, 0, w.rank];
    const f = fg.get(n.id);
    return f === undefined ? [0, 0, 0] : [0, 1, f.rank];
  };
  const hostOf = (n: ProgramNode): string | null => {
    const w = n.writes.find((x) => x.kind === 'paint-order');
    return w !== undefined && w.kind === 'paint-order' ? w.host : (fg.get(n.id)?.host ?? n.parent);
  };
  const containers = new Map<string, ProgramNode[]>();
  // A stable sort by [bucket, phase, rank], then the current index: flow children keep their place.
  const sort = (c: ProgramNode[]): void => {
    const keyed = c.map((n, i) => ({ n, k: [...key(n), i] as number[] }));
    keyed.sort((a, b) => {
      for (let j = 0; j < 4; j++) if (a.k[j] !== b.k[j]) return (a.k[j] as number) - (b.k[j] as number);
      return 0;
    });
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
    // The stacking module sorts a container whenever a view joins it (didAddSubview, onViewAdded, the clip view's listener).
    sort(c);
  }
  const order: string[] = [];
  const index = new Map<string, [string, number]>();
  const nodeIndex = new Map<string, [string, number]>();
  const walk = (id: string): void => {
    order.push(id);
    const c = containers.get(id) ?? [];
    c.filter((n) => n.kind !== 'text').forEach((n, i) => index.set(n.id, [id, i]));
    c.forEach((n, i) => nodeIndex.set(n.id, [id, c.slice(0, i).filter((x) => x.kind !== 'text').length]));
    for (const n of c) walk(n.id);
  };
  const root = p.nodes.find((n) => n.parent === null);
  if (root === undefined) throw new Error('no root');
  walk(root.id);
  return { order, index, nodeIndex };
}

const programsOf = (spec: (typeof FIXTURES)[number]) =>
  spec.kind !== 'layout' ? [] : casesOf(spec, fixtureInput(spec)).map((c) => {
    const r = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
    if (r.kind !== 'ready') throw new Error(`${c.id}: ${r.reason}`);
    return { id: c.id, p: r.programs.uikit };
  });

describe('PNT1 stacking facts (rt-hit.ts)', () => {
  const stacking = (FIXTURE_GROUPS.find((g) => g.id === 'stacking')?.fixtures ?? []).flatMap(programsOf);
  it('covers the three stacking fixtures in both directions', () => {
    expect(stacking.map((s) => s.id)).toEqual(['stacking-basic', 'stacking-basic-rtl', 'stacking-context', 'stacking-context-rtl', 'stacking-escape', 'stacking-escape-rtl', 'stacking-foreground', 'stacking-foreground-rtl', 'stacking-mix', 'stacking-mix-rtl', 'stacking-flex-order', 'stacking-flex-order-rtl']);
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
  it('covers every layout case of the corpus', () => {
    expect(all.length).toBeGreaterThan(400);
  });
  it('the emulated native order is the paint order, and every paint-order and paint-foreground write expects its emulated [host, index]', () => {
    const problems: string[] = [];
    let written = 0;
    let foreground = 0;
    let textPairs = 0;
    for (const { id, p } of all) {
      const { order, index, nodeIndex } = emulate(p);
      const byId = new Map(p.nodes.map((n) => [n.id, n]));
      // Each node's Appendix E index, whether it is a layer item or a text leaf, and whether it paints under a clip natively.
      const info = new Map<string, { order: number; keyed: boolean; clip: boolean }>();
      for (const n of p.nodes) {
        if (n.kind === 'text') continue;
        const f = factsOf(n) as Facts;
        info.set(n.id, { order: f.paintOrder, keyed: f.layer !== 'flow', clip: f.underClip || (f.atomic && f.foregroundClip) });
        const texts = p.nodes.filter((x) => x.parent === n.id && x.kind === 'text');
        // White space only paints nothing and is never hosted (lower/paint/stacking.ts blank), so it is not compared.
        texts.forEach((t, k) => info.set(t.id, { order: f.textPaintOrder[k] as number, keyed: true, clip: f.foregroundClip || f.underClip || /^[ \t\n\r\f]*$/.test(t.text ?? '') }));
      }
      const at = new Map(order.map((x, k) => [x, k]));
      for (const a of p.nodes) {
        const ia = info.get(a.id);
        if (ia === undefined) throw new Error(`${id} ${a.id}: no paint order`);
        for (const b of p.nodes) {
          const ib = info.get(b.id) as { order: number; keyed: boolean; clip: boolean };
          // A node that stays under an overflow clip its layer would leave paints in the clip's order (lower/paint/stacking.ts); a
          // text leaf of collapsed white space is not laid out, so it has no view.
          if (a === b || (!ia.keyed && !ib.keyed) || ia.clip || ib.clip || !at.has(a.id) || !at.has(b.id)) continue;
          if (a.kind === 'text' || b.kind === 'text') textPairs++;
          if (ia.order < ib.order !== (at.get(a.id) as number) < (at.get(b.id) as number)) problems.push(`${id}: ${a.id} and ${b.id} paint in the other order natively`);
        }
      }
      for (const n of p.nodes) {
        for (const w of n.writes) {
          if (w.kind === 'paint-order') {
            written++;
            const got = index.get(n.id);
            if (got === undefined || got[0] !== w.host || got[1] !== w.index) problems.push(`${id} ${n.id}: expects [${w.host}, ${w.index}], the placement gives ${JSON.stringify(got)}`);
          }
          if (w.kind === 'paint-foreground') {
            foreground++;
            for (const e of w.entries) {
              const got = nodeIndex.get(e.id);
              if (byId.get(e.id) === undefined || got === undefined || got[0] !== w.host || got[1] !== e.index) problems.push(`${id} ${n.id}: expects ${e.id} at [${w.host}, ${e.index}], the placement gives ${JSON.stringify(got)}`);
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(written).toBeGreaterThan(0);
    expect(foreground).toBeGreaterThan(0);
    expect(textPairs).toBeGreaterThan(0);
  });
});
