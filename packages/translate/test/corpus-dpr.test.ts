// The extended corpus (notes/T010-p2-triage.md ruling 4): the P1 corpus stays pinned by the milestone-1 manifest, and every
// top-level vector is either a manifest case or a vectors-m2 case, so nothing is unaccounted for or dropped.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hexBits } from '../harness/host.ts';
import { buildCorpus, m1CaseIds, M1_MANIFEST, topLevelVectorFiles, VECTORS_DIR } from '../src/corpus.ts';
import { buildExtendedCorpus, CALC_DIR, CALC_SPEC, DPR_SETS, extendedLockedDigest, SNAP_DPRS, UNITS_CALC_FUNCTIONS, UNITS_M2_FUNCTIONS, VALUES_PREFIX } from '../src/corpus-dpr.ts';
import { EXTENDED_FAULTS, FAULTS } from '../src/faults.ts';
import { suiteFloorProblems } from './floor.ts';

type Row = [string, string | null, string, string, string, string];
const decode = (rows: Row[]) => rows.map(([id, parent, x, y, w, h]) => ({ id, parent, x: hexBits(x), y: hexBits(y), width: hexBits(w), height: hexBits(h) }));

describe('the milestone-1 manifest', () => {
  it('lists 258 distinct case ids, each a committed top-level vector, in file-name order', () => {
    const ids = m1CaseIds();
    expect(ids.length).toBe(258);
    expect(new Set(ids).size).toBe(258);
    for (const id of ids) expect(existsSync(join(VECTORS_DIR, `${id}.json`)), id).toBe(true);
    expect(ids.map((id) => `${id}.json`)).toEqual([...ids.map((id) => `${id}.json`)].sort());
    expect(JSON.parse(readFileSync(M1_MANIFEST, 'utf8')).note).toMatch(/258 milestone-1/);
  });

  it('every top-level vector file is in the manifest or in vectors-m2, never both and never neither', () => {
    const m1 = new Set(m1CaseIds().map((id) => `${id}.json`));
    const x = buildExtendedCorpus();
    const m2 = new Set(x.m2Vectors.map((v) => v.file));
    for (const f of topLevelVectorFiles()) expect([m1.has(f), m2.has(f)], f).toContainEqual(true);
    for (const f of topLevelVectorFiles()) expect(m1.has(f) && m2.has(f), f).toBe(false);
    expect(m1.size + m2.size).toBe(topLevelVectorFiles().length);
    // The P2b fixtures are always here; later fixture groups add their own top-level vectors (packages/parity/src/fixture-groups).
    expect([...m2].sort()).toEqual(expect.arrayContaining(['border-initial-width.json', 'line-height-rounding.json', 'text-min-content-word-positions.json']));
  });

  it('the P1 vectors suite reads exactly the manifest cases', () => {
    expect(buildCorpus().vectors.map((v) => v.file)).toEqual(m1CaseIds().map((id) => `${id}.json`));
  });
});

describe('extended corpus (lock packages/translate/corpus-dpr.json)', () => {
  const x = buildExtendedCorpus();
  const n = Object.fromEntries(x.suites.map((s) => [s.name, s.lines.length]));

  it('matches the committed digest, is deterministic, and has the suites and sizes of ruling 4', () => {
    // PIN-DERIVE: p1-floor.json keeps every extended suite in order (a later package appends its own suite without a test edit);
    // each suite's size is derived below.
    expect(suiteFloorProblems(new URL('./p1-floor.json', import.meta.url), 'extended', x.suites.map((s) => ({ name: s.name, count: s.lines.length })))).toEqual([]);
    expect(x.digest).toBe(extendedLockedDigest());
    expect(buildExtendedCorpus().digest).toBe(x.digest);
    // V1 appends its own suites; the values group's vectors are appended to the P2b suites after every earlier line.
    const top = topLevelVectorFiles().length;
    expect(top).toBeGreaterThanOrEqual(261);
    const firstValues = x.m2Vectors.findIndex((v) => v.file.startsWith(VALUES_PREFIX));
    expect(firstValues).toBeGreaterThan(0);
    expect(x.m2Vectors.slice(firstValues).every((v) => v.file.startsWith(VALUES_PREFIX))).toBe(true);
    expect(n['vectors-m2']).toBe(top - m1CaseIds().length);
    expect(n['vectors-dpr']).toBe(DPR_SETS.length * top);
    expect(n['engine-dpr']).toBeGreaterThanOrEqual(DPR_SETS.length * top);
    expect(n['units-m2']).toBeGreaterThanOrEqual(120000);
    // snap reads the earlier snap vectors only (its generated lines follow them); snap-values reads the values group's.
    const values = topLevelVectorFiles().filter((f) => f.startsWith(VALUES_PREFIX)).length;
    expect(n['snap']).toBeGreaterThanOrEqual(20000 + DPR_SETS.length * (top - values));
    expect(n['snap-values']).toBe(DPR_SETS.length * values);
    expect(n['calc-goldens']).toBe(readdirSync(CALC_DIR).filter((f) => f.endsWith('.json')).length);
    expect(n['calc-goldens']).toBeGreaterThan(0);
    expect(n['engine-calc']).toBe(CALC_SPEC.engineCalc);
    expect(n['units-calc']).toBe(CALC_SPEC.unitsPerFunction * UNITS_CALC_FUNCTIONS.length);
    expect(x.engineSplit.threw + x.engineSplit.harnessError).toBe(0);
  });

  it('the TypeScript harness reproduces every vectors-m2 and DPR vector output and every snap vector exactly', () => {
    const check = (suite: string, vectors: readonly { file: string; output: unknown }[]) => {
      const s = x.suites.find((y) => y.name === suite);
      vectors.forEach((v, i) => {
        const r = JSON.parse(s?.expected[i] as string) as [string, string, Row[]];
        expect(r[0], v.file).toBe('ok');
        expect(decode(r[2]), v.file).toEqual(v.output);
      });
    };
    check('vectors-m2', x.m2Vectors);
    check('vectors-dpr', x.dprVectors);
    expect(x.dprVectors.map((v) => v.dpr).filter((d, i, a) => a.indexOf(d) === i)).toEqual([...DPR_SETS]);
    const snap = x.suites.find((y) => y.name === 'snap');
    x.snapVectors.forEach((v, i) => {
      const r = JSON.parse(snap?.expected[i] as string) as [string, [string, ...string[]][]];
      expect(r[0], v.file).toBe('ok');
      const out = r[1].map(([id, ...e]) => {
        const [left, top, right, bottom, width, height] = e.map(hexBits) as [number, number, number, number, number, number];
        return { id, left, top, right, bottom, width, height };
      });
      expect(out, v.file).toEqual(v.output);
    });
  });

  it('units-m2 runs 20000 cases of each zoom, rounding, snap and R4 function; snap covers halves, negatives, saturation and DPR 1, 2, 3 and 2.625', () => {
    const units = x.suites.find((s) => s.name === 'units-m2');
    for (const f of UNITS_M2_FUNCTIONS) expect(units?.lines.filter((l) => l.startsWith(`["${f}"`)).length, f).toBe(20000);
    const snap = x.suites.find((s) => s.name === 'snap')?.lines ?? [];
    const generated = snap.slice(x.snapVectors.length).map((l) => JSON.parse(l) as { dpr: string; rects: Row[] });
    expect(generated.length).toBe(20000);
    expect(new Set(generated.map((g) => hexBits(g.dpr)))).toEqual(new Set(SNAP_DPRS));
    const values = generated.flatMap((g) => g.rects.flatMap((r) => [r[2], r[3], r[4], r[5]].map(hexBits)));
    expect(values.some((v) => v < 0 && ((v % 64) + 64) % 64 === 32)).toBe(true);
    expect(values.some((v) => v > 0 && v % 64 === 32)).toBe(true);
    expect(values.includes(2147483647) && values.includes(-2147483648)).toBe(true);
  });

  it('engine-dpr mutates every DPR vector once, sometimes into an R5 device-px width, and draws initialLineWidthZoomed among the planted engine faults', () => {
    const engine = x.suites.find((s) => s.name === 'engine-dpr')?.lines ?? [];
    expect(engine.length).toBe(x.dprVectors.length);
    expect(engine.some((l) => l.includes('"initialLineWidthZoomed":true'))).toBe(true);
    expect(engine.filter((l) => l.includes('device-px')).length).toBeGreaterThan(x.dprVectors.filter((v) => v.line.includes('device-px')).length);
  });

  it('EXTENDED_FAULTS is FAULTS plus snap-truncating-division, defined for Swift and Kotlin', () => {
    expect(EXTENDED_FAULTS.map((f) => f.id)).toEqual([...FAULTS.map((f) => f.id), 'snap-truncating-division']);
    for (const f of EXTENDED_FAULTS) {
      expect(f.swift.length, f.id).toBeGreaterThan(0);
      expect(f.kotlin.length, f.id).toBeGreaterThan(0);
    }
  });

  it('the DPR vector folders hold what the suites read', () => {
    for (const dpr of DPR_SETS) expect(readdirSync(join(VECTORS_DIR, `dpr-${dpr}`)).filter((f) => f.endsWith('.json')).sort()).toEqual([...topLevelVectorFiles()].sort());
  });
});
