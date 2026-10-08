// SELD-R1b (notes/T047-runtime-spec.md §3.3 items 2 and 5, amendment T063J): the host hit lane. Chrome's elementFromPoint, committed
// in packages/parity/expected-hit for every layout case at every point of its derived grid, must equal the TypeScript hit test
// (packages/layout/src/rt-hit.ts) over the engine's boxes at every point; each hit plant must fail it; a tap activates the
// nearest ancestor of Chrome's element that has an activation handler.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NO_HIT_FAULTS, NO_HIT_TABLE_FAULTS } from '../../layout/src/rt-hit.ts';
import { capturedIds, caseHitTable, committedHits, compareHits, gridSha256, HIT_FACTS_PATH, hitCases, hitFactsJson, hitGrid, tapTarget } from '../src/hit-capture.ts';
import { nativeCases } from '../src/native-host.ts';
import { repoPath } from '../src/paths.ts';

const cases = hitCases();

describe('the host hit lane', () => {
  it('leaves out exactly the cases hitTableOf refuses, the INL1a inline-box and <br> fixtures, each with a named reason', () => {
    const hit = new Set(cases.map((n) => n.case.id));
    const out = nativeCases().filter((n) => !hit.has(n.case.id));
    expect(out.map((n) => n.case.id)).toEqual([
      'inline-mixed-sizes', 'inline-mixed-sizes-rtl', 'inline-empty-boxes', 'inline-empty-boxes-rtl', 'inline-br', 'inline-br-rtl', 'inline-box-boundaries',
      'inline-box-boundaries-rtl', 'inline-box-hyphen', 'inline-tags', 'inline-tags-rtl', 'inline-baselines', 'inline-baselines-rtl',
    ]);
    for (const n of out) expect(() => caseHitTable(n), n.case.id).toThrow(/is (an inline box|a <br>), which the hit table does not model yet/);
  });

  it('has a capture of every layout case, on the grid its hit table derives', () => {
    // Derived-count pin: every layout case, including the 8 hit-* cases.
    expect(cases.filter((n) => n.case.id.startsWith('hit-')).map((n) => n.case.id)).toEqual(['hit-line-strip-a', 'hit-line-strip-a-rtl', 'hit-line-strip-b', 'hit-line-strip-b-rtl', 'hit-order', 'hit-order-rtl', 'hit-pointer-events', 'hit-pointer-events-rtl']);
    for (const n of cases) {
      const c = committedHits(n.case.id);
      const grid = hitGrid(caseHitTable(n), n.case.environment.viewport);
      expect([n.case.id, c.points, c.gridSha256]).toEqual([n.case.id, grid.length, gridSha256(grid)]);
    }
  });

  it('pairs the layout vectors with the hit facts every case compiles to now', () => {
    // packages/layout/rt-vectors/hit/facts.json feeds the P1 hit suite on the devices; a stale file would test old facts there.
    expect(readFileSync(repoPath(HIT_FACTS_PATH), 'utf8'), 'run pnpm run parity:hit-capture -- --vectors').toBe(hitFactsJson(cases));
  });

  it('names Chrome\'s element at every point of every case', () => {
    let points = 0;
    const mismatches: string[] = [];
    for (const n of cases) {
      const r = compareHits(n, committedHits(n.case.id));
      expect(r.stale, n.case.id).toBe(false);
      points += r.points;
      for (const m of r.mismatches.slice(0, 3)) mismatches.push(`${m.case} (${m.x / 64}, ${m.y / 64}): Chrome ${m.chrome}, Dragon ${m.dragon}`);
    }
    expect(mismatches).toEqual([]);
    expect(points).toBeGreaterThan(600000);
  });
});

describe('planted hit faults (T047 §3.3 item 12, host half)', () => {
  const failing = (run: (n: (typeof cases)[number]) => number): string[] => cases.filter((n) => run(n) > 0).map((n) => n.case.id);
  it('hitIgnoresPointerEventsNone fails the pointer-events cases', () => {
    const f = failing((n) => compareHits(n, committedHits(n.case.id), { ...NO_HIT_FAULTS, ignorePointerEventsNone: true }).mismatches.length);
    expect(f).toEqual(expect.arrayContaining(['hit-pointer-events', 'hit-pointer-events-rtl']));
  });
  it('hitReversedOrder fails the paint-order cases', () => {
    const f = failing((n) => compareHits(n, committedHits(n.case.id), { ...NO_HIT_FAULTS, reversedOrder: true }).mismatches.length);
    expect(f).toEqual(expect.arrayContaining(['hit-order', 'hit-order-rtl', 'hit-line-strip-a', 'hit-pointer-events']));
  });
  it('pointerEventsNotInherited fails the inherited none cases', () => {
    const f = failing((n) => compareHits(n, committedHits(n.case.id), NO_HIT_FAULTS, { ...NO_HIT_TABLE_FAULTS, pointerEventsNotInherited: true }).mismatches.length);
    expect(f).toEqual(['hit-pointer-events', 'hit-pointer-events-rtl']);
  });
});

describe('tap dispatch', () => {
  // No layout fixture holds an activation element yet (a href is DRAGON_UNSUPPORTED_ATTRIBUTE and button belongs to FORM-a), so
  // every tap here activates nothing; packages/layout/test/rt-hit.test.ts proves the ancestor walk on a table with handlers.
  it('activates the nearest activation ancestor of Chrome\'s element at every captured point', () => {
    let taps = 0;
    for (const n of cases) {
      const t = caseHitTable(n);
      const chrome = capturedIds(committedHits(n.case.id));
      const index = new Map(t.ids.map((id, i) => [id, i]));
      hitGrid(t, n.case.environment.viewport).forEach(([x, y], i) => {
        let at = index.get(chrome[i] as string);
        while (at !== undefined && at >= 0 && t.activation[at] !== true) at = t.nodes[at]?.parent;
        const want = at === undefined || at < 0 ? null : t.ids[at];
        expect([n.case.id, x, y, tapTarget(t, x, y)]).toEqual([n.case.id, x, y, want]);
        if (want !== null) taps++;
      });
    }
    expect(taps).toBe(0);
  });
});
