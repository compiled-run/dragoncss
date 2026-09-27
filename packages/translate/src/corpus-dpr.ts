// The extended differential corpus (notes/T010-p2-triage.md ruling 4). The P1 corpus (corpus.ts, lock corpus.json) stays
// P1-shaped and pinned by the milestone-1 manifest; this corpus (lock corpus-dpr.json) carries what P2b adds: the new top-level
// vectors, the DPR vectors, engine mutations of them, the zoom, rounding, snap and R4 unit functions, and the snap rule. One seed,
// one generator and the same sizes for every target.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineFaults } from '../../layout/src/block.ts';
import { NO_ENGINE_FAULTS } from '../../layout/src/block.ts';
import { validateLayoutInput } from '../../layout/src/validate.ts';
import { runEngineCase, runSnapCase, runUnitsCase } from '../harness/harness.ts';
import { bitsHex } from '../harness/host.ts';
import type { Corpus, Json, Split, Suite, VectorCase } from './corpus.ts';
import { digestsOf, faultsFor, lu, m1CaseIds, mutate, px, Rng, split, topLevelVectorFiles, vectorCase, VECTORS_DIR } from './corpus.ts';
import { ROOT } from './generate.ts';

export const EXTENDED_LOCK = join(ROOT, 'packages/translate/corpus-dpr.json');

export const EXTENDED_SPEC = {
  seed: 20260927,
  unitsPerFunction: 20000,
  snapGenerated: 20000,
} as const;

/** The DPR vector sets, shared ratios first, then the Android extra (packages/parity/src/dpr.ts DPRS). */
export const DPR_SETS: readonly number[] = [2, 3, 2.625];

/** The DPRs generated snap cases are drawn at: DPR 1 and every DPR set. */
export const SNAP_DPRS: readonly number[] = [1, 2, 3, 2.625];

/** units-m2: the zoom model (R1 and the length and font zoom), R2 FromFloatRound, the snap rule and the R4 range width. */
export const UNITS_M2_FUNCTIONS = ['fromFloatRound', 'zoomCssPx', 'zoomFontSize', 'zoomViewportPx', 'snapEdge', 'cachedRangeWidth'] as const;

/** Every engine fault, initialLineWidthZoomed included: the extended engine suite draws from all of them. */
const ALL_FAULT_NAMES = Object.keys(NO_ENGINE_FAULTS) as (keyof EngineFaults)[];

// ---------------------------------------------------------------- vectors

/** Top-level vectors that are not milestone-1 cases (the P2b fixtures), sorted by file name. */
export function m2VectorCases(): VectorCase[] {
  const m1 = new Set(m1CaseIds().map((id) => `${id}.json`));
  return topLevelVectorFiles().filter((f) => !m1.has(f)).map((f) => vectorCase(VECTORS_DIR, f));
}

export type DprVectorCase = VectorCase & { readonly dpr: number };

const dprDir = (dpr: number): string => join(VECTORS_DIR, `dpr-${dpr}`);

/** Every DPR vector, per DPR set in DPR_SETS order and by file name. */
export function dprVectorCases(): DprVectorCase[] {
  const out: DprVectorCase[] = [];
  for (const dpr of DPR_SETS) {
    const dir = dprDir(dpr);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) out.push({ ...vectorCase(dir, f), dpr });
  }
  return out;
}

export type SnapVectorCase = { readonly file: string; readonly dpr: number; readonly line: string; readonly output: unknown };

type Rect = { readonly id: string; readonly parent: string | null; readonly x: number; readonly y: number; readonly width: number; readonly height: number };

function snapLine(dpr: number, rects: readonly Rect[]): string {
  return JSON.stringify({ dpr: bitsHex(dpr), rects: rects.map((b) => [b.id, b.parent, bitsHex(b.x), bitsHex(b.y), bitsHex(b.width), bitsHex(b.height)]) });
}

/** Every snap vector (dpr-<N>/snap/<case>.json): the engine rects of a DPR vector and their snapped device-px edges. */
export function snapVectorCases(): SnapVectorCase[] {
  const out: SnapVectorCase[] = [];
  for (const dpr of DPR_SETS) {
    const dir = join(dprDir(dpr), 'snap');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const v = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { platform: string; devicePixelRatio: number; input: Rect[]; output: unknown };
      if (v.devicePixelRatio !== dpr) throw new Error(`snap vector ${f} in dpr-${dpr} says DPR ${v.devicePixelRatio}`);
      out.push({ file: `dpr-${dpr}/snap/${f}`, dpr, line: snapLine(dpr, v.input), output: v.output });
    }
  }
  return out;
}

// ---------------------------------------------------------------- engine-dpr

/** A seeded mutation of a DPR vector: mostly corpus.ts mutate; sometimes a border side becomes an R5 device-px width. */
function mutateDpr(input: Json, r: Rng): Json {
  if (r.chance(0.2)) {
    const copy = JSON.parse(JSON.stringify(input)) as Json;
    const boxes: Json[] = [];
    const walk = (b: Json): void => {
      if (b['kind'] !== 'box') return;
      if (b['boxType'] === 'element') boxes.push(b);
      for (const c of b['children'] as Json[]) walk(c);
    };
    walk(copy['root'] as Json);
    if (boxes.length > 0) {
      const style = r.pick(boxes)['style'] as Json;
      style[r.pick(['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'])] = { kind: 'device-px', value: r.pick([0, 0.5, 1, 2, 3, 5, 3.3]) };
      if (validateLayoutInput(copy).ok) return copy;
    }
  }
  return mutate(input, r);
}

/** One seeded mutation per DPR vector, with a planted engine fault on one in ten, drawn from every EngineFaults key. */
export function engineDprCases(vectors: readonly DprVectorCase[]): string[] {
  const r = new Rng(EXTENDED_SPEC.seed * 43);
  return vectors.map((v) => {
    const parsed = JSON.parse(v.line) as { platform: string; input: Json };
    return JSON.stringify({ platform: parsed.platform, faults: faultsFor(r, ALL_FAULT_NAMES), input: mutateDpr(parsed.input, r) });
  });
}

// ---------------------------------------------------------------- units-m2

function zoom(r: Rng): number {
  return r.chance(0.8) ? r.pick([1, 2, 3, 2.625, 1.5, 0.5, 1.75]) : r.pick([r.next() * 4, 0, -1, Number.NaN, 1e6]);
}

function fontSize(r: Rng): number {
  return r.chance(0.2) ? r.pick([0, 0.5, 10.625, 12.5, 17.5, 10.629, 11.11, 10.3, 10.06, 13.7, 9.9, 11.1111, Number.NaN, 1e6]) : Math.round(Math.abs(px(r)) % 200 * 100) / 100;
}

function unitsM2Args(name: (typeof UNITS_M2_FUNCTIONS)[number], r: Rng): number[] {
  switch (name) {
    case 'fromFloatRound':
      return [r.chance(0.3) ? (r.int(4000) - 2000 + 0.5) / 64 : px(r)];
    case 'zoomCssPx':
      return [px(r), zoom(r)];
    case 'zoomFontSize':
      return [fontSize(r), zoom(r)];
    case 'zoomViewportPx':
      return [r.chance(0.6) ? r.int(2000) : px(r), zoom(r)];
    case 'snapEdge':
      return [r.chance(0.3) ? (r.int(8000) - 4000) * 64 + r.pick([32, 31, 33, -32, 0, 63, -1]) : lu(r)];
    case 'cachedRangeWidth': {
      const start = r.chance(0.1) ? r.pick([0, 1, 7, 300]) : r.int(40);
      const end = r.chance(0.05) ? r.int(40) : start + r.int(40);
      return [start, end, fontSize(r)];
    }
  }
}

export function unitsM2Cases(): string[] {
  const out: string[] = [];
  UNITS_M2_FUNCTIONS.forEach((name, i) => {
    const r = new Rng(EXTENDED_SPEC.seed * 47 + i);
    for (let k = 0; k < EXTENDED_SPEC.unitsPerFunction; k++) out.push(JSON.stringify([name, ...unitsM2Args(name, r).map(bitsHex)]));
  });
  return out;
}

// ---------------------------------------------------------------- snap

const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

/** An LU edge case for the snap rule: exact halves of both signs, saturation, lattice points of the DPR, or a corpus LU. */
function snapLu(r: Rng, dpr: number): number {
  const k = r.next();
  if (k < 0.25) return (r.int(4000) - 2000) * 64 + 32;
  if (k < 0.35) return r.pick([INT_MAX, INT_MIN, INT_MAX - 31, INT_MAX - 32, INT_MAX - 33, INT_MIN + 31, INT_MIN + 32, 0, -32, 32, -33, 33, -31, 31, 63, -63, 64, -64, -65]);
  if (k < 0.7) return Math.round((Math.round(r.next() * 80000) / 100) * 64 * dpr) * (r.chance(0.15) ? -1 : 1);
  return lu(r);
}

/** Ids: plain, sometimes canonically equivalent pairs, and sometimes a repeated id. */
function snapId(r: Rng, i: number): string {
  if (r.chance(0.03)) return i % 2 === 0 ? 'n\u00e9' : 'ne\u0301';
  if (r.chance(0.02) && i > 0) return `n${i - 1}`;
  return `n${i}`;
}

export function snapGeneratedCases(): string[] {
  const r = new Rng(EXTENDED_SPEC.seed * 53);
  const out: string[] = [];
  for (let k = 0; k < EXTENDED_SPEC.snapGenerated; k++) {
    const dpr = SNAP_DPRS[k % SNAP_DPRS.length] as number;
    const n = 1 + r.int(12);
    const rects: Rect[] = [];
    for (let i = 0; i < n; i++) {
      const parent = i === 0 ? null : r.chance(0.03) ? 'absent' : (rects[r.int(i)] as Rect).id;
      const size = (): number => {
        const v = snapLu(r, dpr);
        return r.chance(0.92) ? Math.min(INT_MAX, Math.abs(v)) : v;
      };
      rects.push({ id: snapId(r, i), parent, x: snapLu(r, dpr), y: snapLu(r, dpr), width: size(), height: size() });
    }
    out.push(snapLine(dpr, rects));
  }
  return out;
}

// ---------------------------------------------------------------- the extended corpus

export type ExtendedCorpus = Corpus & {
  readonly m2Vectors: readonly VectorCase[];
  readonly dprVectors: readonly DprVectorCase[];
  readonly snapVectors: readonly SnapVectorCase[];
};

export function buildExtendedCorpus(): ExtendedCorpus {
  const m2 = m2VectorCases();
  const dpr = dprVectorCases();
  const snapVectors = snapVectorCases();
  const m2Lines = m2.map((v) => v.line);
  const dprLines = dpr.map((v) => v.line);
  const engine = engineDprCases(dpr);
  const units = unitsM2Cases();
  const snap = [...snapVectors.map((v) => v.line), ...snapGeneratedCases()];
  const suites: Suite[] = [
    { name: 'vectors-m2', mode: 'engine', lines: m2Lines, expected: m2Lines.map(runEngineCase) },
    { name: 'vectors-dpr', mode: 'engine', lines: dprLines, expected: dprLines.map(runEngineCase) },
    { name: 'engine-dpr', mode: 'engine', lines: engine, expected: engine.map(runEngineCase) },
    { name: 'units-m2', mode: 'units', lines: units, expected: units.map(runUnitsCase) },
    { name: 'snap', mode: 'snap', lines: snap, expected: snap.map(runSnapCase) },
  ];
  const d = digestsOf(suites);
  const engineSplit: Split = split(suites[2]?.expected ?? []);
  return { suites, vectors: m2, m2Vectors: m2, dprVectors: dpr, snapVectors, engineSplit, digest: d.digest, digests: d.digests };
}

export function extendedLockText(c: ExtendedCorpus): string {
  const lock = {
    note: 'Written by pnpm run native:gen. The extended differential corpus (notes/T010-p2-triage.md ruling 4): the P2b top-level vectors, the DPR vectors and engine mutations of them, units-m2 and the snap rule, for every native target. The P1 corpus (corpus.json) is pinned separately. Inputs and results are regenerated under packages/translate/out; this digest covers both.',
    seed: EXTENDED_SPEC.seed,
    dprSets: DPR_SETS,
    snapDprs: SNAP_DPRS,
    unitsPerFunction: EXTENDED_SPEC.unitsPerFunction,
    unitsFunctions: UNITS_M2_FUNCTIONS,
    snapGenerated: EXTENDED_SPEC.snapGenerated,
    snapVectors: c.snapVectors.length,
    cases: Object.fromEntries(c.suites.map((s) => [s.name, s.lines.length])),
    engineSplit: c.engineSplit,
    digests: c.digests,
    digest: c.digest,
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function extendedLockedDigest(): string | null {
  if (!existsSync(EXTENDED_LOCK)) return null;
  return (JSON.parse(readFileSync(EXTENDED_LOCK, 'utf8')) as { digest: string }).digest;
}
