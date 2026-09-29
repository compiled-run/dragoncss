// The G-P differential test, hand-written families (packages/parity/src/grid-corpus.ts): every horizontal-tb environment matches
// Chrome 145 exactly or is refused for a reason an out-of-scope package owns; each grid plant is caught by its corpus case; the
// registered Chrome deviation's spec reading differs from Chrome; and the harness itself reports tampered or incomplete results.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GridFaults } from '@dragon/layout';
import { NO_ENGINE_FAULTS, NO_GRID_FAULTS } from '@dragon/layout';
import type { CorpusCase } from '../src/grid-corpus.ts';
import { caseDocument, GRID_CORPUS_DIR, GRID_DEVIATIONS, GRID_PLANTS, HORIZONTAL_ENVS, parseCorpusFamily, readGridCorpus, runGridCase } from '../src/grid-corpus.ts';
import { repoPath } from '../src/paths.ts';
import { runShard } from './grid-corpus/shard.ts';

const HAND = ['abspos', 'alignment', 'auto-repeat', 'baselines', 'fr', 'gutters', 'intrinsic', 'minmax', 'percent', 'placement', 'sets', 'subgrid'];

/** Pinned from the run that introduced the test; a change in any count is a regression or a newly supported case to review. */
const PINNED = {
  matched: 1256,
  known: [],
  refused: { 'abspos-item': 88, 'aspect-ratio': 16, 'auto-repeat': 96, 'baseline-alignment': 96, calc: 16, contain: 8, float: 16, 'inline-grid': 104, 'overflow-auto': 24, 'safe-alignment': 104, 'sizing-keyword': 24, subgrid: 64, 'writing-mode': 152 },
};

let cases: CorpusCase[] | null = null;
const kase = (id: string): CorpusCase => {
  if (cases === null) cases = readGridCorpus();
  const c = cases.find((k) => k.id === id);
  if (c === undefined) throw new Error(`no corpus case ${id}`);
  return c;
};

const kinds = (c: CorpusCase, grid: GridFaults, engine = NO_ENGINE_FAULTS): string[] => [...runGridCase(c, grid, HORIZONTAL_ENVS, engine).envs.values()].map((r) => r.kind);

describe('G-P differential test: hand-written families against Chrome 145', () => {
  it('every horizontal-tb environment matches exactly or is refused for an owned reason', () => {
    const r = runShard(HAND);
    expect(r.problems).toEqual([]);
    expect(r.cases).toBe(258);
    expect({ matched: r.matched, known: r.knownMismatches, refused: r.refused }).toEqual(PINNED);
  }, 600000);

  for (const p of GRID_PLANTS) {
    it(`plant ${p.fault} is caught by ${p.kase}: every environment matches without it, and some environment differs with it`, () => {
      const c = kase(p.kase);
      expect(kinds(c, NO_GRID_FAULTS)).toEqual(HORIZONTAL_ENVS.map(() => 'match'));
      const planted = p.fault === 'ignoreOrder' ? kinds(c, NO_GRID_FAULTS, { ...NO_ENGINE_FAULTS, ignoreOrder: true }) : kinds(c, { ...NO_GRID_FAULTS, [p.fault]: true });
      expect(planted).not.toContain('refused');
      expect(planted).toContain('mismatch');
    });
  }

  for (const d of GRID_DEVIATIONS) {
    it(`Chrome deviation ${d.id}: the engine matches Chrome, and the spec reading (${d.fault}) differs in every environment`, () => {
      for (const id of d.cases) {
        const c = kase(id);
        expect(kinds(c, NO_GRID_FAULTS)).toEqual(HORIZONTAL_ENVS.map(() => 'match'));
        expect(kinds(c, { ...NO_GRID_FAULTS, [d.fault]: true })).toEqual(HORIZONTAL_ENVS.map(() => 'mismatch'));
      }
    });
  }

  it('the hand shard and the four random shards cover every corpus file exactly once', () => {
    const files = readdirSync(repoPath(GRID_CORPUS_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    const shards = [...HAND, ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => `random-0${k}`)].sort();
    expect(files).toEqual(shards);
  });

  it('the plants cover every grid fault, and no fault is on in NO_GRID_FAULTS', () => {
    const planted = new Set<string>([...GRID_PLANTS.map((p) => p.fault), ...GRID_DEVIATIONS.map((d) => d.fault)]);
    expect(Object.keys(NO_GRID_FAULTS).filter((f) => !planted.has(f))).toEqual([]);
    expect(Object.values(NO_GRID_FAULTS).every((v) => v === false)).toBe(true);
  });

  it('a tampered Chrome box, a missing item and an extra environment are each reported, never passed', () => {
    const c = kase('p-dense');
    const tamper = (f: (items: number[][]) => number[][]): CorpusCase => ({
      ...c,
      results: new Map([...c.results].map(([env, r]) => [env, { ...r, items: f(r.items.map((b) => [...b])) as unknown as typeof r.items }])),
    });
    const shifted = tamper((items) => items.map((b, k) => (k === 2 ? [(b[0] as number) + 1, b[1] as number, b[2] as number, b[3] as number] : b)));
    expect(kinds(shifted, NO_GRID_FAULTS)).toEqual(HORIZONTAL_ENVS.map(() => 'mismatch'));
    const unknownLabel: CorpusCase = { ...c, labels: [...c.labels.slice(0, -1), 'nobody'] };
    const r = runGridCase(unknownLabel, NO_GRID_FAULTS);
    for (const o of r.envs.values()) expect(o.kind === 'mismatch' && o.detail.includes('nobody: Dragon has no box')).toBe(true);
    const missingEnv: CorpusCase = { ...c, results: new Map([...c.results].filter(([env]) => env !== 'dpr2-rtl-horizontal-tb')) };
    const m = runGridCase(missingEnv, NO_GRID_FAULTS).envs.get('dpr2-rtl-horizontal-tb');
    expect(m?.kind === 'mismatch' && m.detail.includes('no result')).toBe(true);
  });

  it('the corpus reader rejects incomplete files instead of skipping their cases', () => {
    const text = readFileSync(repoPath(`${GRID_CORPUS_DIR}/placement.json`), 'utf8');
    const j = JSON.parse(text) as { envs: string[]; cases: Record<string, { distinct: { items: unknown[] }[]; labels: string[]; cb: number[] }> };
    expect(parseCorpusFamily('placement', text).length).toBe(Object.keys(j.cases).length);
    const first = Object.keys(j.cases)[0] as string;
    const without = structuredClone(j);
    (without.cases[first] as { distinct: { items: unknown[] }[] }).distinct[0]?.items.pop();
    expect(() => parseCorpusFamily('placement', JSON.stringify(without))).toThrow(/no complete result/);
    const badEnv = { ...structuredClone(j), envs: ['dpr1-ltr-sideways'] };
    expect(() => parseCorpusFamily('placement', JSON.stringify(badEnv))).toThrow(/bad envs/);
    const badCb = structuredClone(j);
    (badCb.cases[first] as { cb: number[] }).cb = [0, 300];
    expect(() => parseCorpusFamily('placement', JSON.stringify(badCb))).toThrow(/bad wrapper size/);
  });

  it('a case document keeps every labelled element and moves each inline style to its own class rule', () => {
    const c = kase('p-named-lines');
    const doc = caseDocument(c);
    expect([...doc.ids.keys()]).toEqual(c.labels);
    for (const id of doc.ids.values()) expect(doc.html).toContain(`data-dragon-id="${id}"`);
    expect(doc.html).toContain('.e0 { display:grid;grid-template-columns:[a] 20px [b] 20px [a] 20px [c]; }');
    expect(doc.html).not.toContain('style=');
  });
});
