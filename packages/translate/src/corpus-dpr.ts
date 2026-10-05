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

/**
 * The engine faults engine-dpr draws from: every fault up to P2b (initialLineWidthZoomed included), fixed so its inputs do not move
 * when a package adds faults (V1 adds the calc faults, which engine-calc draws).
 */
const ALL_FAULT_NAMES: readonly (keyof EngineFaults)[] = [
  'breakOffByOne', 'rtlAsLtr', 'ignoreOrder', 'baselineFromBorderTop', 'scrollMinAuto', 'absposInFlow', 'cbIgnoresPadding',
  'staticPosLtr', 'relativeShiftsFlow', 'metricHalfUp', 'untruncatedFontSize', 'halfLeadingSpec', 'minMaxEndMarginSpec',
  'wrapReverseBaselineSpec', 'initialLineWidthZoomed',
];

/** The value-model (V1) faults: engine-calc draws from these and every fault above. */
const CALC_FAULT_NAMES: readonly (keyof EngineFaults)[] = [
  'calcPercentPlainOrder', 'calcDoubleEval', 'calcNoNonNegClamp', 'calcPercentIndefiniteAsLength', 'clampMaxWins', 'divideDirect',
  'calcLeafUnzoomed', 'viewportUnitsUnceiled',
];

/**
 * Vectors of the V1 values fixture group (packages/parity/src/fixture-groups/values.ts). The P2b suites read every layout case
 * (parity targets.ts derives their sizes), so they read these too, but after every earlier vector: each earlier line keeps its
 * place, its seeded mutation and its result, and the values lines are appended.
 */
export const VALUES_PREFIX = 'values-';
const isValuesVector = (f: string): boolean => f.startsWith(VALUES_PREFIX);

// ---------------------------------------------------------------- vectors

/** Top-level vectors that are not milestone-1 cases (the P2b fixtures), sorted by file name. */
export function m2VectorCases(): VectorCase[] {
  const m1 = new Set(m1CaseIds().map((id) => `${id}.json`));
  const files = topLevelVectorFiles().filter((f) => !m1.has(f));
  return [...files.filter((f) => !isValuesVector(f)), ...files.filter(isValuesVector)].map((f) => vectorCase(VECTORS_DIR, f));
}

export type DprVectorCase = VectorCase & { readonly dpr: number };

const dprDir = (dpr: number): string => join(VECTORS_DIR, `dpr-${dpr}`);

/** Every DPR vector, per DPR set in DPR_SETS order and by file name: the earlier vectors, then the values group's. */
export function dprVectorCases(): DprVectorCase[] {
  return [...dprVectorsOf(false), ...dprVectorsOf(true)];
}

function dprVectorsOf(values: boolean): DprVectorCase[] {
  const out: DprVectorCase[] = [];
  for (const dpr of DPR_SETS) {
    const dir = dprDir(dpr);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && isValuesVector(x) === values).sort()) out.push({ ...vectorCase(dir, f), dpr });
  }
  return out;
}

export type SnapVectorCase = { readonly file: string; readonly dpr: number; readonly line: string; readonly output: unknown };

type Rect = { readonly id: string; readonly parent: string | null; readonly x: number; readonly y: number; readonly width: number; readonly height: number };

function snapLine(dpr: number, rects: readonly Rect[]): string {
  return JSON.stringify({ dpr: bitsHex(dpr), rects: rects.map((b) => [b.id, b.parent, bitsHex(b.x), bitsHex(b.y), bitsHex(b.width), bitsHex(b.height)]) });
}

/**
 * Every snap vector (dpr-<N>/snap/<case>.json): the engine rects of a DPR vector and their snapped device-px edges. values selects
 * the values group's (suite snap-values): the snap suite's generated lines follow its vectors, so it keeps the earlier ones only.
 */
export function snapVectorCases(values = false): SnapVectorCase[] {
  return snapVectorsOf(values);
}

function snapVectorsOf(values: boolean): SnapVectorCase[] {
  const out: SnapVectorCase[] = [];
  for (const dpr of DPR_SETS) {
    const dir = join(dprDir(dpr), 'snap');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && isValuesVector(x) === values).sort()) {
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

// ---------------------------------------------------------------- V1 value model (notes/T006-value-model-spec.md)

/** Sizes of the V1 calc suites. */
export const CALC_SPEC = { engineCalc: 4000, unitsPerFunction: 5000 } as const;

/** units-calc: R6, the calculation leaves, float PixelsAndPercent, the two stores, the float inverse, the double min and max steps, and the LU conversion. */
export const UNITS_CALC_FUNCTIONS = [
  'viewportUnitBase', 'viewportLeafPx', 'emLeafPx', 'pixelsAndPercentAt', 'cssLengthFixed', 'clampLengthFloat', 'floatInvert', 'doubleMinStep',
  'doubleMaxStep', 'calcToLu',
] as const;

export const CALC_DIR = join(VECTORS_DIR, 'calc');

/** The calc goldens (vectors/calc/<name>.json): an engine vector for each (verify) point of the value model, by file name. */
export function calcGoldenCases(): VectorCase[] {
  const files = existsSync(CALC_DIR) ? readdirSync(CALC_DIR).filter((f) => f.endsWith('.json')).sort() : [];
  if (files.length === 0) throw new Error(`no calc goldens in ${CALC_DIR}; the calc-goldens suite would run no cases`);
  return files.map((f) => vectorCase(CALC_DIR, f));
}

const CALC_LENGTHS = [0, 1, 10, 0.1, 7.5, 33.333, 100, 12.5, 0.015625, 250];
const CALC_PERCENTS = [0, 5, 10, 25, 33.333333, 50, 66.666667, 100, 12.5];

function calcLeaf(r: Rng, percent: boolean): Json {
  const k = r.next();
  if (percent && k < 0.3) return { kind: 'percent', value: r.pick(CALC_PERCENTS) };
  if (k < 0.55) return { kind: 'px', value: r.chance(0.8) ? r.pick(CALC_LENGTHS) : Math.round(r.next() * 4000) / 64 };
  if (k < 0.8) return { kind: 'viewport', value: r.pick([1, 5, 10, 33.333, 50, 100, 2.5]), axis: r.pick(['width', 'height', 'min', 'max']), size: 'large' };
  return { kind: 'em', value: r.pick([0.2, 1, 1.5, 2, 0.333]), fontSize: { kind: 'px', value: r.pick([10, 16, 10.625, 12.5, 13.33]) } };
}

/** A CSS-level calculation as the compiler writes it: sums of signed terms, products by a number or its inverse, min, max and clamp. */
function calcNode(r: Rng, depth: number, percent: boolean): Json {
  if (depth <= 0 || r.chance(0.3)) return calcLeaf(r, percent);
  const k = r.next();
  if (k < 0.35) {
    const terms: Json[] = [];
    const n = 2 + r.int(2);
    for (let i = 0; i < n; i++) {
      const t = calcNode(r, depth - 1, percent);
      terms.push(i > 0 && r.chance(0.3) ? { kind: 'product', terms: [t, { kind: 'number', value: -1 }] } : t);
    }
    return { kind: 'sum', terms };
  }
  if (k < 0.55) {
    const n = r.pick([0.5, 2, 3, 1.5, 0.1]);
    const inner = calcNode(r, depth - 1, percent);
    if (r.chance(0.4)) return { kind: 'product', terms: [inner, { kind: 'invert', term: { kind: 'number', value: r.pick([3, 7, 2, 1.5]) } }] };
    return r.chance(0.5) ? { kind: 'product', terms: [{ kind: 'number', value: n }, inner] } : { kind: 'product', terms: [inner, { kind: 'number', value: n }] };
  }
  if (k < 0.85) {
    const terms: Json[] = [];
    const n = 1 + r.int(4);
    for (let i = 0; i < n; i++) terms.push(calcNode(r, depth - 1, percent));
    return { kind: r.chance(0.5) ? 'min' : 'max', terms };
  }
  return { kind: 'clamp', min: calcNode(r, depth - 1, percent), value: calcNode(r, depth - 1, percent), max: calcNode(r, depth - 1, percent) };
}

/** A length field, its calculation range, and whether it takes a percentage. */
const CALC_FIELDS: readonly (readonly [string, 'all' | 'non-negative', boolean])[] = [
  ['width', 'non-negative', true], ['height', 'non-negative', true], ['minWidth', 'non-negative', true], ['minHeight', 'non-negative', true],
  ['maxWidth', 'non-negative', true], ['maxHeight', 'non-negative', true], ['marginTop', 'all', true], ['marginRight', 'all', true],
  ['marginBottom', 'all', true], ['marginLeft', 'all', true], ['paddingTop', 'non-negative', true], ['paddingLeft', 'non-negative', true],
  ['top', 'all', true], ['left', 'all', true], ['right', 'all', true], ['bottom', 'all', true], ['flexBasis', 'non-negative', true],
  ['rowGap', 'non-negative', false], ['columnGap', 'non-negative', false], ['borderTopWidth', 'non-negative', false], ['borderLeftWidth', 'non-negative', false],
];

/** Every top-level vector with one to three of its lengths replaced by generated calculations, at every DPR, some with a planted fault. */
export function engineCalcCases(): string[] {
  const r = new Rng(EXTENDED_SPEC.seed * 59);
  const bases = topLevelVectorFiles().map((f) => JSON.parse(readFileSync(join(VECTORS_DIR, f), 'utf8')) as { platform: string; input: Json });
  const faultNames = [...ALL_FAULT_NAMES, ...CALC_FAULT_NAMES];
  const out: string[] = [];
  let k = 0;
  while (out.length < CALC_SPEC.engineCalc) {
    const base = bases[k % bases.length] as { platform: string; input: Json };
    k++;
    const input = JSON.parse(JSON.stringify(base.input)) as Json;
    const boxes: Json[] = [];
    const walk = (b: Json): void => {
      if (b['kind'] !== 'box') return;
      if (b['boxType'] === 'element') boxes.push(b);
      for (const c of b['children'] as Json[]) walk(c);
    };
    walk(input['root'] as Json);
    const n = 1 + r.int(3);
    for (let i = 0; i < n && boxes.length > 0; i++) {
      const [field, range, percent] = r.pick(CALC_FIELDS);
      const withPercent = percent || r.chance(0.05);
      (r.pick(boxes)['style'] as Json)[field] = { kind: 'calc', expr: calcNode(r, 1 + r.int(3), withPercent), range };
    }
    input['devicePixelRatio'] = r.pick([1, 2, 3, 2.625]);
    if (!validateLayoutInput(input).ok) continue;
    const faults = r.chance(0.2) ? { ...NO_ENGINE_FAULTS, [r.pick(faultNames)]: true } : NO_ENGINE_FAULTS;
    out.push(JSON.stringify({ platform: base.platform, faults, input }));
  }
  return out;
}

function calcUnitsArgs(name: (typeof UNITS_CALC_FUNCTIONS)[number], r: Rng): number[] {
  const f = (x: number): number => Math.fround(x);
  const zeros = [0, -0, Number.NaN, 1, -1, 0.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  switch (name) {
    case 'viewportUnitBase':
      return [r.chance(0.6) ? r.pick([300, 400, 851, 393, 320, 568, 844, 390, 915, 412]) : r.chance(0.5) ? r.int(2000) : px(r), zoom(r)];
    case 'viewportLeafPx':
      return [r.pick([1, 5, 10, 33.333, 50, 100, 2.5, -10, 0.1]), r.chance(0.7) ? f(r.int(2000) / r.pick([1, 2, 3, 2.625])) : px(r), zoom(r)];
    case 'emLeafPx':
      return [r.chance(0.5) ? r.pick([0.2, 1, 1.5, 2, 0.333, -1]) : px(r) / 16, fontSize(r), zoom(r)];
    case 'pixelsAndPercentAt':
      return [f(r.chance(0.5) ? r.pick([0, 10, 0.1, -5, 26.25]) : px(r)), f(r.chance(0.6) ? r.pick([0, 5, 33.333333, 50, 100, -10]) : r.next() * 200), f(r.chance(0.5) ? r.int(1600) : Math.abs(px(r)))];
    case 'cssLengthFixed':
    case 'clampLengthFloat':
      return [r.chance(0.1) ? r.pick([33554429, 33554430, -33554430, -33554431, 3.4028234663852886e38, 1e39, -1e39, Number.NaN]) : px(r)];
    case 'floatInvert':
      return [r.chance(0.3) ? r.pick([3, 7, 1.5, 0, -0, 0.1]) : f(px(r))];
    case 'doubleMinStep':
    case 'doubleMaxStep':
      return [r.chance(0.4) ? r.pick(zeros) : px(r), r.chance(0.4) ? r.pick(zeros) : px(r)];
    case 'calcToLu':
      return [r.chance(0.2) ? r.pick([Number.NaN, -0.5, 1e40, -1e40, 0.015625, -0]) : f(px(r)), r.int(2)];
  }
}

export function unitsCalcCases(): string[] {
  const out: string[] = [];
  UNITS_CALC_FUNCTIONS.forEach((name, i) => {
    const r = new Rng(EXTENDED_SPEC.seed * 61 + i);
    for (let k = 0; k < CALC_SPEC.unitsPerFunction; k++) out.push(JSON.stringify([name, ...calcUnitsArgs(name, r).map(bitsHex)]));
  });
  return out;
}

// ---------------------------------------------------------------- scroll containers (OVFL)

/** Every LayoutStyle field at its initial value, which engine-overflow's boxes start from. */
const OVERFLOW_STYLE: Json = {
  display: 'block', position: 'static', top: { kind: 'auto' }, right: { kind: 'auto' }, bottom: { kind: 'auto' }, left: { kind: 'auto' },
  overflowX: 'visible', overflowY: 'visible', direction: 'ltr', boxSizing: 'content-box', width: { kind: 'auto' }, height: { kind: 'auto' },
  minWidth: { kind: 'auto' }, minHeight: { kind: 'auto' }, maxWidth: { kind: 'none' }, maxHeight: { kind: 'none' },
  marginTop: { kind: 'px', value: 0 }, marginRight: { kind: 'px', value: 0 }, marginBottom: { kind: 'px', value: 0 }, marginLeft: { kind: 'px', value: 0 },
  paddingTop: { kind: 'px', value: 0 }, paddingRight: { kind: 'px', value: 0 }, paddingBottom: { kind: 'px', value: 0 }, paddingLeft: { kind: 'px', value: 0 },
  borderTopWidth: { kind: 'px', value: 0 }, borderRightWidth: { kind: 'px', value: 0 }, borderBottomWidth: { kind: 'px', value: 0 }, borderLeftWidth: { kind: 'px', value: 0 },
  flexDirection: 'row', flexWrap: 'nowrap', flexGrow: 0, flexShrink: 1, flexBasis: { kind: 'auto' }, order: 0, justifyContent: 'normal',
  alignItems: 'normal', alignSelf: 'auto', alignContent: 'normal', rowGap: { kind: 'normal' }, columnGap: { kind: 'normal' }, textAlign: 'start',
  aspectRatio: { kind: 'auto' },
};

/** engine-overflow: generated scroll containers with scroll metrics, appended after every earlier suite so their inputs do not move. */
export const OVERFLOW_SPEC = { engineOverflow: 3000 } as const;

/** The OVFL engine faults engine-overflow draws from, with the earlier faults its trees exercise. */
const OVERFLOW_FAULT_NAMES: readonly (keyof EngineFaults)[] = ['gutterReserved', 'overflowIgnoresPadding', 'relativeShiftsFlow', 'scrollMinAuto', 'cbIgnoresPadding', 'rtlAsLtr'];

/** css-overflow-3 §3.1 computed pairs: both axes in visible and clip, or both in hidden, auto and scroll. */
const OVERFLOW_PAIRS: readonly (readonly [string, string])[] = [
  ['visible', 'visible'], ['hidden', 'hidden'], ['auto', 'auto'], ['scroll', 'scroll'], ['clip', 'clip'], ['visible', 'clip'], ['clip', 'visible'],
  ['hidden', 'auto'], ['auto', 'hidden'], ['scroll', 'auto'], ['hidden', 'scroll'],
];

/**
 * Generated scroll containers (OVFL): block and flex boxes with random overflow pairs, sizes, padding, borders and margins (negative
 * ones included), relative and absolutely positioned children, block-level replaced leaves, nested containers and Ahem text, in both directions at every DPR,
 * some with an OVFL planted fault. Each line carries viewportDirection, so the harness also runs scrollMetrics.
 */
export function engineOverflowCases(): string[] {
  const r = new Rng(EXTENDED_SPEC.seed * 71);
  const out: string[] = [];
  let n = 0;
  const pxv = (v: number): Json => ({ kind: 'px', value: v });
  const len = (choices: readonly number[]): Json => (r.chance(0.3) ? { kind: 'auto' } : pxv(r.pick(choices)));
  while (out.length < OVERFLOW_SPEC.engineOverflow) {
    const rtl = r.chance(0.3);
    const direction = rtl ? 'rtl' : 'ltr';
    let ids = 0;
    const font = (size: number): Json => ({ family: 'Ahem', size, specifiedSize: { kind: 'px', value: size }, absoluteSize: true });
    const box = (depth: number, parentFlex: boolean): Json => {
      const id = `n${ids++}`;
      const [ox, oy] = r.pick(OVERFLOW_PAIRS) as readonly [string, string];
      const display = depth < 3 && r.chance(0.25) ? 'flex' : 'block';
      const position = r.chance(0.12) ? 'relative' : r.chance(0.08) && depth > 0 ? 'absolute' : 'static';
      const style: Json = {
        ...OVERFLOW_STYLE,
        display,
        position,
        direction: r.chance(0.1) ? (rtl ? 'ltr' : 'rtl') : direction,
        overflowX: ox,
        overflowY: oy,
        width: len([0, 10, 25, 40, 60, 90, 150, 12.5]),
        height: len([0, 10, 20, 35, 50, 80, 7.25]),
        marginTop: pxv(r.pick([0, 0, 3, 8, -4, 12])),
        marginRight: pxv(r.pick([0, 0, 5, -6, 15, -40])),
        marginBottom: pxv(r.pick([0, 0, 4, 9, -5, -30, 20])),
        marginLeft: pxv(r.pick([0, 0, 2, 7, -3])),
        paddingTop: pxv(r.pick([0, 0, 2, 5])),
        paddingRight: pxv(r.pick([0, 0, 3, 7.5])),
        paddingBottom: pxv(r.pick([0, 0, 4, 9])),
        paddingLeft: pxv(r.pick([0, 0, 1, 6])),
        borderTopWidth: pxv(r.pick([0, 0, 1, 2])),
        borderRightWidth: pxv(r.pick([0, 0, 1, 3])),
        borderBottomWidth: pxv(r.pick([0, 0, 1, 2])),
        borderLeftWidth: pxv(r.pick([0, 0, 1, 4])),
        flexShrink: parentFlex && r.chance(0.5) ? 0 : 1,
      };
      if (position === 'relative') {
        style['left'] = r.chance(0.5) ? pxv(r.pick([5, -7, 20])) : { kind: 'auto' };
        style['top'] = r.chance(0.5) ? pxv(r.pick([6, -9, 30])) : { kind: 'auto' };
      }
      if (position === 'absolute') {
        style['left'] = r.chance(0.6) ? pxv(r.pick([0, 15, 70, -10])) : { kind: 'auto' };
        style['top'] = r.chance(0.6) ? pxv(r.pick([0, 25, 90, -5])) : { kind: 'auto' };
        style['width'] = pxv(r.pick([10, 30, 120]));
        style['height'] = pxv(r.pick([10, 40, 100]));
      }
      if (depth >= 3 || r.chance(0.25)) {
        // Inline content: Ahem words in one text leaf (no positioned siblings, so no abspos-in-inline refusal).
        const size = r.pick([10, 16, 12.5]);
        const words: string[] = [];
        const count = 1 + r.int(5);
        for (let i = 0; i < count; i++) words.push('XabcXY'.slice(0, 1 + r.int(6)).repeat(1 + r.int(3)));
        style['textAlign'] = r.pick(['start', 'end', 'center', 'left', 'right']);
        style['display'] = 'block';
        return { kind: 'box', id, boxType: 'element', style, children: [{ kind: 'text', id: `t${ids++}`, text: words.join(' '), font: font(size), lineHeight: { kind: 'normal' }, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap' }] };
      }
      const kids: Json[] = [];
      const count = r.int(4);
      for (let i = 0; i < count; i++) kids.push(r.chance(0.15) ? replacedLeaf() : box(depth + 1, display === 'flex'));
      return { kind: 'box', id, boxType: 'element', style, children: kids };
    };
    // A block-level replaced leaf (REPL-a): its border box, margins and relative offset count in its scroll container.
    const replacedLeaf = (): Json => ({
      kind: 'replaced',
      id: `n${ids++}`,
      style: {
        ...OVERFLOW_STYLE,
        display: 'block',
        position: r.chance(0.2) ? 'relative' : 'static',
        top: r.chance(0.5) ? pxv(r.pick([4, -6])) : { kind: 'auto' },
        width: len([20, 64, 150]),
        height: len([10, 40, 120]),
        marginTop: pxv(r.pick([0, 3, -4])),
        marginBottom: pxv(r.pick([0, 5, -8])),
        marginLeft: pxv(r.pick([0, 2])),
        paddingRight: pxv(r.pick([0, 3])),
        borderBottomWidth: pxv(r.pick([0, 2])),
      },
      natural: { kind: 'image', width: r.pick([160, 40, 64]), height: r.pick([80, 64]) },
      defaultWidth: 300,
      defaultHeight: 150,
      objectFit: 'fill',
      objectPositionX: { kind: 'percent', value: 50 },
      objectPositionY: { kind: 'percent', value: 50 },
    });
    const container = box(0, false);
    const root: Json = { kind: 'box', id: 'root', boxType: 'element', style: { ...OVERFLOW_STYLE, display: 'block', direction }, children: [container] };
    const input: Json = { viewport: { width: 400, height: 300 }, devicePixelRatio: r.pick([1, 2, 3, 2.625]), viewportUnits: { small: { width: 400, height: 300 }, large: { width: 400, height: 300 }, dynamic: { width: 400, height: 300 } }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: 16, root };
    n++;
    if (!validateLayoutInput(input).ok) throw new Error(`engine-overflow: generated input ${n} is invalid: ${JSON.stringify(validateLayoutInput(input))}`);
    const faults = r.chance(0.2) ? { ...NO_ENGINE_FAULTS, [r.pick(OVERFLOW_FAULT_NAMES)]: true } : NO_ENGINE_FAULTS;
    out.push(JSON.stringify({ platform: 'darwin-arm64', faults, input, viewportDirection: r.chance(0.8) ? direction : rtl ? 'ltr' : 'rtl' }));
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
  const snapValues = snapVectorCases(true).map((v) => v.line);
  const goldenLines = calcGoldenCases().map((v) => v.line);
  const engineCalc = engineCalcCases();
  const unitsCalc = unitsCalcCases();
  const engineOverflow = engineOverflowCases();
  const suites: Suite[] = [
    { name: 'vectors-m2', mode: 'engine', lines: m2Lines, expected: m2Lines.map(runEngineCase) },
    { name: 'vectors-dpr', mode: 'engine', lines: dprLines, expected: dprLines.map(runEngineCase) },
    { name: 'engine-dpr', mode: 'engine', lines: engine, expected: engine.map(runEngineCase) },
    { name: 'units-m2', mode: 'units', lines: units, expected: units.map(runUnitsCase) },
    { name: 'snap', mode: 'snap', lines: snap, expected: snap.map(runSnapCase) },
    // V1 value model: new suites only, after the P2b ones.
    { name: 'snap-values', mode: 'snap', lines: snapValues, expected: snapValues.map(runSnapCase) },
    { name: 'calc-goldens', mode: 'engine', lines: goldenLines, expected: goldenLines.map(runEngineCase) },
    { name: 'engine-calc', mode: 'engine', lines: engineCalc, expected: engineCalc.map(runEngineCase) },
    { name: 'units-calc', mode: 'units', lines: unitsCalc, expected: unitsCalc.map(runUnitsCase) },
    // OVFL: a new suite only, after the V1 ones.
    { name: 'engine-overflow', mode: 'engine', lines: engineOverflow, expected: engineOverflow.map(runEngineCase) },
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
    calcUnitsPerFunction: CALC_SPEC.unitsPerFunction,
    calcUnitsFunctions: UNITS_CALC_FUNCTIONS,
    engineCalc: CALC_SPEC.engineCalc,
    engineOverflow: OVERFLOW_SPEC.engineOverflow,
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
