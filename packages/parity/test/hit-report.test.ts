// SELD-R1b (notes/T047-runtime-spec.md §3.3 items 2 and 5, amendment T063J): the host hit lane. Chrome's elementFromPoint, committed
// in packages/parity/expected-hit for every layout case at every point of its derived grid, must equal the TypeScript hit test
// (packages/layout/src/rt-hit.ts) over the engine's boxes at every point; each hit plant must fail it; a tap activates the
// nearest ancestor of Chrome's element that has an activation handler.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_HIT_FAULTS, NO_HIT_TABLE_FAULTS } from '../../layout/src/rt-hit.ts';
import { capturedIds, caseHitTable, committedDivergence, committedHits, committedHitsAt, compareHits, compareHitsAt, divergenceDrift, gridSha256, HIT_FACTS_PATH, hitCases, hitDivergenceJson, hitDivergenceOf, hitDprCaptures, hitFactsJson, hitGrid, hitGridAt, hitProvenIds, hitRefusal, hitRefusedCases, replaceDirWhenFilled, restoreInterruptedSwap, staleDprDirs, tapTarget } from '../src/hit-capture.ts';
import { DPRS } from '../src/dpr.ts';
import { HIT_DIVERGENCE_REASONS } from '../src/hit-divergence.ts';
import type { NativeCase } from '../src/native-host.ts';
import { nativeCases } from '../src/native-host.ts';
import { repoPath } from '../src/paths.ts';
import { hitCaseIds, nativeTargets } from '../src/targets.ts';
import { CLAMP_OUT, CLAMP_REASON, INLINE_OUT, INLINE_REASON, STACKING_OUT, STACKING_REASON, SVG_OUT, SVG_REASON, TRANSFORM_REASON } from './hit-refusals.ts';
import { GRID_OUT, GRID_REASON } from './hit-refusals-grid.ts';
import { RADIUS_OUT, RADIUS_REASON } from './hit-refusals-radius.ts';
import { VISIBILITY_OUT, VISIBILITY_REASON } from './hit-refusals-visibility.ts';
import { CLIP_PATH_OUT, CLIP_PATH_REASON, CLIP_RECT_OUT, CLIP_RECT_REASON } from './hit-refusals-clip-rect.ts';

const cases = hitCases();

describe('the host hit lane', () => {
  // The hit lane leaves out the union of seven refusals (hit-refusals.ts, hit-refusals-radius.ts, hit-refusals-grid.ts); taking any alone would bring the others' cases back.
  const transformed = (): string[] => nativeCases().filter((n) => n.programs.uikit.nodes.some((x) => x.writes.some((w) => w.kind === 'transform'))).map((n) => n.case.id);
  it('leaves out exactly the union of the transform cases, the PNT1 stacking cases, the PNT1 radius fixtures, the INL1a inline-box and <br> fixtures, the GRID fixtures, the T150a visibility fixtures, the MASK-CLIP clip and clip-path fixtures, the svg fixtures and the TXT2-g line-clamp fixtures, each with a named reason', () => {
    const hit = new Set(cases.map((n) => n.case.id));
    const out = nativeCases().filter((n) => !hit.has(n.case.id));
    const union = new Set([...transformed(), ...STACKING_OUT, ...RADIUS_OUT, ...INLINE_OUT, ...GRID_OUT, ...VISIBILITY_OUT, ...CLIP_RECT_OUT, ...CLIP_PATH_OUT, ...SVG_OUT, ...CLAMP_OUT]);
    expect(out.map((n) => n.case.id)).toEqual(nativeCases().map((n) => n.case.id).filter((id) => union.has(id)));
    for (const n of out.filter((x) => INLINE_OUT.includes(x.case.id))) expect(() => caseHitTable(n), n.case.id).toThrow(INLINE_REASON);
    for (const n of out.filter((x) => CLAMP_OUT.includes(x.case.id))) expect(() => caseHitTable(n), n.case.id).toThrow(CLAMP_REASON);
    for (const n of out.filter((x) => GRID_OUT.includes(x.case.id))) expect(() => caseHitTable(n), n.case.id).toThrow(GRID_REASON);
    // The device-hit lane declares exactly the hit cases at every device DPR (targets.ts hitCaseIds), so P5 counts them, not all.
    expect(hitCaseIds()).toEqual(cases.map((n) => n.case.id));
    for (const t of nativeTargets()) for (const s of t.lanes.find((l) => l.lane === 'device-hit')?.sets ?? []) expect(s.ids, `${t.target} ${s.dpr}`).toEqual(hitCaseIds());
    for (const t of nativeTargets()) for (const s of t.lanes.find((l) => l.lane === 'device-frames')?.sets ?? []) expect(s.ids.length, `${t.target} ${s.dpr}`).toBe(nativeCases().length);
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

  it('refuses by name every case whose program writes a transform (T064 R13; SELD-R2b T146 lifts it), and the PNT1 stacking, PNT1 radius, INL1a inline, GRID, T150a visibility, MASK-CLIP clip and clip-path and svg cases (SVG-a2 lifts it) with their own reasons', () => {
    const refused = hitRefusedCases();
    const moved = new Set(transformed());
    expect(refused.filter((r) => moved.has(r.id)).map((r) => r.id)).toEqual(transformed());
    expect(refused.filter((r) => RADIUS_OUT.includes(r.id)).map((r) => r.id).sort()).toEqual([...RADIUS_OUT].sort());
    expect(refused.filter((r) => GRID_OUT.includes(r.id)).map((r) => r.id).sort()).toEqual([...GRID_OUT].sort());
    expect(refused.filter((r) => VISIBILITY_OUT.includes(r.id)).map((r) => r.id).sort()).toEqual([...VISIBILITY_OUT].sort());
    expect(refused.filter((r) => CLIP_RECT_OUT.includes(r.id)).map((r) => r.id).sort()).toEqual([...CLIP_RECT_OUT].sort());
    expect(refused.filter((r) => CLIP_PATH_OUT.includes(r.id)).map((r) => r.id).sort()).toEqual([...CLIP_PATH_OUT].sort());
    expect(refused.filter((r) => CLAMP_OUT.includes(r.id)).map((r) => r.id).sort()).toEqual([...CLAMP_OUT].sort());
    expect(moved.size).toBeGreaterThan(0);
    for (const r of refused) {
      if (moved.has(r.id)) expect(r.reason, r.id).toMatch(TRANSFORM_REASON);
      else if (STACKING_OUT.includes(r.id)) expect(r.reason, r.id).toMatch(STACKING_REASON);
      else if (SVG_OUT.includes(r.id)) expect(r.reason, r.id).toMatch(SVG_REASON);
      else if (CLAMP_OUT.includes(r.id)) expect(r.reason, r.id).toMatch(CLAMP_REASON);
      else if (RADIUS_OUT.includes(r.id)) expect(r.reason, r.id).toMatch(RADIUS_REASON);
      else if (GRID_OUT.includes(r.id)) expect(r.reason, r.id).toMatch(GRID_REASON);
      else if (VISIBILITY_OUT.includes(r.id)) expect(r.reason, r.id).toMatch(VISIBILITY_REASON);
      else if (CLIP_RECT_OUT.includes(r.id)) expect(r.reason, r.id).toMatch(CLIP_RECT_REASON);
      else if (CLIP_PATH_OUT.includes(r.id)) expect(r.reason, r.id).toMatch(CLIP_PATH_REASON);
      else expect([INLINE_OUT.includes(r.id), r.reason], r.id).toEqual([true, expect.stringMatching(INLINE_REASON)]);
    }
    const covered = new Set(cases.map((n) => n.case.id));
    for (const r of refused) expect(covered.has(r.id), r.id).toBe(false);
    expect(cases.length + refused.length).toBe(nativeCases().length);
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

describe('the host hit lane at the device DPRs', () => {
  // Chrome at --force-device-scale-factor=N lays out in device px and snaps text rects there, as rt-hit.ts does at that DPR: the
  // device-hit lane's expectedHitRuns and the device-traces reference hit test with that model, so it must name Chrome's element at
  // every point of every hit case at DPR 2, 3 and 2.625 (elementFromPoint's float point, its CSS px viewport gate, and pre-wrap's
  // hanging spaces, which only show at a fractional device scale).
  const dprCaptures = hitDprCaptures(cases);
  it('captures every hit case at every device DPR', () => {
    expect(dprCaptures.map((d) => d.dpr)).toEqual(DPRS);
    for (const d of dprCaptures) expect(d.ids).toEqual(cases.map((n) => n.case.id));
  });

  // One test per DPR, each case compared at every point of its committed capture on the grid its table derives now (a stale grid
  // fails by name): Chrome's element everywhere but the DPR's known divergences, and exactly those points there, so a new mismatch
  // and a fixed point both fail. A pinned case is not proven at that DPR (hitProvenIds); each one has a reviewed reason.
  for (const dpr of DPRS) {
    it(`names Chrome's element at every point of every hit case's capture at DPR ${dpr} but exactly its known divergences`, () => {
      const byId = new Map(cases.map((n) => [n.case.id, n]));
      const own = dprCaptures.find((d) => d.dpr === dpr);
      if (own === undefined) throw new Error(`no hit captures at DPR ${dpr}`);
      const divergence = committedDivergence(dpr);
      const drift: string[] = [];
      const stale: string[] = [];
      let points = 0;
      for (const id of own.ids) {
        const n = byId.get(id);
        if (n === undefined) throw new Error(`${id} is not a hit case`);
        const r = compareHitsAt(n, committedHitsAt(id, dpr), dpr);
        if (r.stale) stale.push(id);
        points += r.points;
        drift.push(...divergenceDrift(id, dpr, r.mismatches, divergence.cases[id]));
      }
      expect(stale).toEqual([]);
      expect(drift).toEqual([]);
      expect(points).toBeGreaterThan(0);
      // Every pinned case is a hit case with a reviewed reason.
      expect(Object.keys(divergence.cases).filter((id) => !byId.has(id))).toEqual([]);
      expect(Object.keys(divergence.cases).filter((id) => !HIT_DIVERGENCE_REASONS.has(id))).toEqual([]);
      // Not proven at this DPR wherever a claim could be made: the proven set leaves out every pinned case.
      const proven = new Set(hitProvenIds(dpr, own.ids, divergence));
      expect(Object.keys(divergence.cases).filter((id) => proven.has(id))).toEqual([]);
      expect(proven.size).toBe(own.ids.length - Object.keys(divergence.cases).length);
    });
  }

  it('demands exactly the pinned points: a new mismatch and a fixed point both drift', () => {
    const m = (x: number, y: number) => ({ case: 'c', x, y, chrome: 'a', dragon: 'b' });
    expect(divergenceDrift('c', 2, [m(128, 0), m(0, 128)], [[0, 128], [128, 0]])).toEqual([]);
    expect(divergenceDrift('c', 2, [m(128, 0), m(256, 0)], [[128, 0]])).toEqual(['c (2, 0): Chrome a, Dragon b, not pinned']);
    expect(divergenceDrift('c', 2, [], [[128, 0]])).toEqual(['c (1, 0): pinned, now Chrome\'s element']);
    expect(divergenceDrift('c', 2, [m(128, 0)])).toEqual(['c (1, 0): Chrome a, Dragon b, not pinned']);
  });

  it('writes, reads and refuses the known-divergence file, and leaves a pinned case out of the proven ones', () => {
    const m = (x: number, y: number) => ({ case: 'b', x, y, chrome: 'a', dragon: 'b' });
    const d = hitDivergenceOf(2.625, [{ case: 'a', stale: false, mismatches: [] }, { case: 'b', stale: false, mismatches: [m(5, 9), m(3, 1), m(1, 9)] }]);
    expect(d.cases).toEqual({ b: [[3, 1], [1, 9], [5, 9]] });
    expect(() => hitDivergenceOf(2.625, [{ case: 'a', stale: true, mismatches: [] }])).toThrow(/a: its capture at DPR 2.625 is not on the grid/);
    const root = mkdtempSync(join(tmpdir(), 'dragon-hit-div-'));
    try {
      const path = join(root, 'known-divergence.json');
      writeFileSync(path, hitDivergenceJson(d));
      expect(committedDivergence(2.625, path)).toEqual(d);
      expect(() => committedDivergence(2, path)).toThrow(/malformed or from another Chrome, capture version or DPR/);
      writeFileSync(path, hitDivergenceJson({ ...d, cases: { b: [] } }));
      expect(() => committedDivergence(2.625, path)).toThrow(/malformed/);
      writeFileSync(path, hitDivergenceJson({ ...d, cases: {} }));
      expect(committedDivergence(2.625, path).cases).toEqual({});
      expect(() => committedDivergence(2.625, join(root, 'none.json'))).toThrow(/no readable hit divergence file/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(hitProvenIds(2.625, ['a', 'b', 'c'], d)).toEqual(['a', 'c']);
    expect(hitProvenIds(1, ['a', 'b'], null)).toEqual(['a', 'b']);
    expect(() => hitProvenIds(2, ['a'], d)).toThrow(/need that DPR's divergence file/);
  });

  it('gives every reviewed divergence reason to a hit case, in one line', () => {
    const ids = new Set(cases.map((n) => n.case.id));
    expect([...HIT_DIVERGENCE_REASONS.keys()].filter((id) => !ids.has(id))).toEqual([]);
    for (const [id, why] of HIT_DIVERGENCE_REASONS) expect(why.length > 0 && !why.includes('\n'), id).toBe(true);
  });

  it('lets no profile row claim the hit test from a device lane, so the proven set is the only hit claim', async () => {
    // device-hit compares the device with the TS hit test, not with Chrome; a row citing it would claim what hitProvenIds bounds.
    const { webProfile } = await import('../../dragon/src/profiles/web.ts');
    const { iosProfile } = await import('../../dragon/src/profiles/ios.ts');
    const { androidProfile } = await import('../../dragon/src/profiles/android.ts');
    for (const profile of [webProfile, iosProfile, androidProfile]) {
      expect(profile.rows.length, profile.target).toBeGreaterThan(0);
      const lanes = new Set(profile.rows.flatMap((r) => r.proofs.map((p) => p.lane)));
      expect([...lanes].filter((l) => !['linux-dragon-layout', 'chrome-dual', 'device-anim'].includes(l)), profile.target).toEqual([]);
    }
  });

  it('names c at interaction-combo\'s step point (2, 30) at 2.625, where DPR 1 names d', () => {
    const dpr = 2.625;
    for (const id of ['interaction-combo', 'interaction-combo-rtl']) {
      const n = cases.find((x) => x.case.id === id);
      if (n === undefined) throw new Error(`${id} is not a hit case`);
      const c = committedHitsAt(id, dpr);
      const grid = hitGridAt(caseHitTable(n, undefined, dpr), n.case.environment.viewport, dpr);
      // c's 10 px X, snapped to device px: 0 to 26 at 2.625 (390 to 400 in rtl: 1024 to 1050); the step's y 30 is 78.75 device
      // px, inside c's text rect snapped to device px (53 to 79).
      const w = n.case.environment.viewport.width;
      const [x0, x1] = id.endsWith('-rtl') ? [Math.round((w - 10) * dpr) * 64, Math.round(w * dpr) * 64] : [0, Math.round(10 * dpr) * 64];
      const chrome = capturedIds(c);
      const [y0, y1] = [30 * dpr * 64, Math.ceil(30 * dpr) * 64];
      const row = grid.flatMap(([gx, gy], i) => (gy >= y0 && gy < y1 && gx >= x0 && gx < x1 ? [[gx, gy, chrome[i]]] : []));
      expect(row.length, id).toBeGreaterThan(1);
      expect(row.filter(([, , h]) => h !== 'c'), id).toEqual([]);
    }
  });

  it('refuses a DPR capture compared at another DPR, and a DPR-1 capture read as a DPR one', () => {
    const n = cases.find((x) => x.case.id === 'interaction-combo');
    if (n === undefined) throw new Error('no interaction-combo hit case');
    expect(() => compareHitsAt(n, committedHits('interaction-combo'), 2.625)).toThrow(/a capture at DPR 1 compared at DPR 2.625/);
    expect(() => compareHitsAt(n, committedHitsAt('interaction-combo', 2.625), 1)).toThrow(/a capture at DPR 2.625 compared at DPR 1/);
  });

  it('swaps a DPR capture folder in only once its capture finished: a failed capture leaves the old folder intact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dragon-hit-dpr-'));
    try {
      const dir = join(root, 'dpr-2.625');
      mkdirSync(dir);
      writeFileSync(join(dir, 'old.hit.json'), 'old');
      await expect(replaceDirWhenFilled(dir, async (into) => {
        writeFileSync(join(into, 'half.hit.json'), 'half');
        throw new Error('Chrome went away');
      })).rejects.toThrow(/Chrome went away/);
      expect(readdirSync(root)).toEqual(['dpr-2.625']);
      expect(readdirSync(dir)).toEqual(['old.hit.json']);
      await replaceDirWhenFilled(dir, async (into) => writeFileSync(join(into, 'new.hit.json'), 'new'));
      expect(readdirSync(root)).toEqual(['dpr-2.625']);
      expect(readdirSync(dir)).toEqual(['new.hit.json']);
      // A first capture has no folder to keep.
      await replaceDirWhenFilled(join(root, 'dpr-3'), async (into) => writeFileSync(join(into, 'a.hit.json'), 'a'));
      expect(readdirSync(root).sort()).toEqual(['dpr-2.625', 'dpr-3']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('restores a DPR capture folder a swap left only as its .old sibling, and the sweep keeps a live DPR\'s .old and .partial', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dragon-hit-dpr-'));
    try {
      // A run that died between moving dpr-2 to dpr-2.old and moving dpr-2.partial in.
      const dir = join(root, 'dpr-2');
      mkdirSync(`${dir}.old`);
      writeFileSync(join(`${dir}.old`, 'old.hit.json'), 'old');
      mkdirSync(`${dir}.partial`);
      writeFileSync(join(`${dir}.partial`, 'half.hit.json'), 'half');
      expect(staleDprDirs(readdirSync(root), [2, 3])).toEqual([]);
      restoreInterruptedSwap(dir);
      expect(readdirSync(root).sort()).toEqual(['dpr-2', 'dpr-2.partial']);
      expect(readdirSync(dir)).toEqual(['old.hit.json']);
      // A failed capture after that still leaves the restored folder; replaceDirWhenFilled restores before it starts too.
      rmSync(`${dir}.partial`, { recursive: true });
      renameSync(dir, `${dir}.old`);
      await expect(replaceDirWhenFilled(dir, async () => {
        throw new Error('Chrome went away');
      })).rejects.toThrow(/Chrome went away/);
      expect(readdirSync(root)).toEqual(['dpr-2']);
      expect(readdirSync(dir)).toEqual(['old.hit.json']);
      // Only a DPR no capture names any more is swept, with its siblings.
      expect(staleDprDirs(['dpr-2', 'dpr-2.old', 'dpr-2.partial', 'dpr-1.5', 'dpr-1.5.old', 'dpr-1.5.partial', 'other'], [2, 3])).toEqual(['dpr-1.5', 'dpr-1.5.old', 'dpr-1.5.partial']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

describe('the PNT1 stacking and radius hit refusals fire independently (merge of #198 into #196)', () => {
  type Node = NativeCase['programs']['uikit']['nodes'][number];
  const edit = (n: NativeCase, f: (x: Node) => Node): NativeCase => ({ ...n, programs: { uikit: { ...n.programs.uikit, nodes: n.programs.uikit.nodes.map(f) }, 'android-views': n.programs['android-views'] } });
  const caseOf = (id: string): NativeCase => {
    const n = nativeCases().find((x) => x.case.id === id);
    if (n === undefined) throw new Error(`no case ${id}`);
    return n;
  };
  const flat = (x: Node): Node => ({ ...x, facts: { ...x.facts, stacking: { ...(x.facts['stacking'] as object), createsContext: false } } });
  it('a stacking case refuses with the stacking reason, with or without a rounded corner, and with the radius reason once its contexts go', () => {
    const stacking = caseOf('stacking-basic');
    const radius = stacking.programs.uikit.nodes.find((x) => x.parent !== null && x.kind !== 'text');
    if (radius === undefined) throw new Error('no box');
    const rounded = (x: Node): Node => (x.id === radius.id ? { ...x, writes: [...x.writes, { kind: 'border-radius' } as unknown as Node['writes'][number]] } : x);
    expect(hitRefusal(stacking)).toMatch(STACKING_REASON);
    expect(hitRefusal(edit(stacking, rounded))).toMatch(STACKING_REASON);
    expect(hitRefusal(edit(stacking, (x) => rounded(flat(x))))).toMatch(RADIUS_REASON);
  });
  it('a radius case refuses with the radius reason, and with the stacking reason once one of its boxes makes a context', () => {
    const radius = caseOf('radius-basic');
    expect(hitRefusal(radius)).toMatch(RADIUS_REASON);
    const box = radius.programs.uikit.nodes.find((x) => x.parent !== null && x.kind !== 'text');
    if (box === undefined) throw new Error('no box');
    expect(hitRefusal(edit(radius, (x) => (x.id === box.id ? { ...x, facts: { ...x.facts, stacking: { ...(x.facts['stacking'] as object), createsContext: true } } } : x)))).toMatch(STACKING_REASON);
  });
});
