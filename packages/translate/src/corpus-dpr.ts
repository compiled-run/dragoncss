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

// ---------------------------------------------------------------- inline formatting (INL1a)

/**
 * engine-inline: generated inline formatting contexts, appended after every earlier suite so their inputs do not move. INL2a
 * appends atomicInline contexts with inline-block and inline-flex boxes after the INL1a ones, so those keep their inputs, and TXT2-a
 * appends wrapInline contexts with overflow-wrap and word-break: break-word after them, and INL2b appends vaInline contexts with
 * vertical-align after those.
 */
export const INLINE_SPEC = { engineInline: 3000, atomicInline: 1500, wrapInline: 1500, vaInline: 1500 } as const;

/** The INL1a engine faults engine-inline draws from. */
const INLINE_FAULT_NAMES: readonly (keyof EngineFaults)[] = [
  'spaceOnlyBreaks', 'fitWithoutEpsilon', 'breakAfterSolidus', 'noHyphenDigitBreak', 'lineHeightIgnoresInlineBoxes', 'halfLeadingUnflooredPerBox',
  'brIgnored', 'breakAtBoxBoundary', 'fragmentFromLineTop', 'halfLeadingSpec', 'breakOffByOne',
];

const INLINE_STYLE: Json = {
  display: 'inline', position: 'static', top: { kind: 'auto' }, right: { kind: 'auto' }, bottom: { kind: 'auto' }, left: { kind: 'auto' },
  overflowX: 'visible', overflowY: 'visible', direction: 'ltr', boxSizing: 'content-box', width: { kind: 'auto' }, height: { kind: 'auto' },
  minWidth: { kind: 'auto' }, minHeight: { kind: 'auto' }, maxWidth: { kind: 'none' }, maxHeight: { kind: 'none' },
  marginTop: { kind: 'px', value: 0 }, marginRight: { kind: 'px', value: 0 }, marginBottom: { kind: 'px', value: 0 }, marginLeft: { kind: 'px', value: 0 },
  paddingTop: { kind: 'px', value: 0 }, paddingRight: { kind: 'px', value: 0 }, paddingBottom: { kind: 'px', value: 0 }, paddingLeft: { kind: 'px', value: 0 },
  borderTopWidth: { kind: 'px', value: 0 }, borderRightWidth: { kind: 'px', value: 0 }, borderBottomWidth: { kind: 'px', value: 0 }, borderLeftWidth: { kind: 'px', value: 0 },
  flexDirection: 'row', flexWrap: 'nowrap', flexGrow: 0, flexShrink: 1, flexBasis: { kind: 'auto' }, order: 0, justifyContent: 'normal',
  alignItems: 'normal', alignSelf: 'auto', alignContent: 'normal', rowGap: { kind: 'normal' }, columnGap: { kind: 'normal' }, textAlign: 'start',
  aspectRatio: { kind: 'auto' }, verticalAlign: { kind: 'keyword', value: 'baseline' },
};

const inlineFont = (size: number): Json => ({ family: 'Ahem', size, specifiedSize: { kind: 'px', value: size }, absoluteSize: true });

function inlineLineHeight(r: Rng): Json {
  if (r.chance(0.4)) return { kind: 'normal' };
  if (r.chance(0.5)) return { kind: 'number', value: r.pick([1, 1.2, 1.5, 0.5, 2, 1.3, 3]) };
  return { kind: 'px', value: r.pick([5, 10, 12, 15, 25, 12.5, 7.7, 23.3, 40]) };
}

/** A word of Ahem-covered characters: letters in rtl (UAX #9), and in ltr also digits, the punctuation of INL-P family 3 and U+200B. */
function inlineWord(r: Rng, rtl: boolean): string {
  const letters = 'abcXYZ';
  const extra = '0123456789-?!|/(),.;:%$+"{}[]​';
  let w = '';
  const n = 1 + r.int(6);
  for (let i = 0; i < n; i++) w += !rtl && r.chance(0.3) ? r.pick([...extra]) : r.pick([...letters]);
  return w;
}

/**
 * Generated inline formatting contexts (INL1a): text, nested inline boxes of mixed sizes and line-heights, and <br>s, collapsed as
 * the compiler collapses them (css-text-3 §4.1.1: no doubled spaces, none at the start, after a <br> or at the end), in a block
 * container of random width, text-align and direction, at every DPR, some with an INL1a planted fault.
 */
export function engineInlineCases(): string[] {
  const r = new Rng(EXTENDED_SPEC.seed * 67);
  const out: string[] = [];
  let n = 0;
  while (out.length < INLINE_SPEC.engineInline) {
    const rtl = r.chance(0.3);
    const direction = rtl ? 'rtl' : 'ltr';
    let ids = 0;
    // afterSpace: the last character written is a space, or nothing has been written since the start or a <br>.
    let afterSpace = true;
    const leaf = (size: number, lh: Json, wrap: string): Json => {
      let text = '';
      const words = 1 + r.int(3);
      for (let i = 0; i < words; i++) {
        if (!afterSpace && (i > 0 || r.chance(0.4))) text += ' ';
        text += inlineWord(r, rtl);
        afterSpace = false;
      }
      if (r.chance(0.3)) {
        text += ' ';
        afterSpace = true;
      }
      return { kind: 'text', id: `t${ids++}`, text, font: inlineFont(size), lineHeight: lh, whiteSpaceCollapse: 'collapse', textWrapMode: wrap, overflowWrap: 'normal', wordBreak: 'normal' };
    };
    const wrap = r.chance(0.9) ? 'wrap' : 'nowrap';
    const content = (depth: number, size: number, lh: Json): Json[] => {
      const kids: Json[] = [];
      const count = r.int(4) + (depth === 0 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const pick = r.next();
        if (pick < 0.5) kids.push(leaf(size, lh, wrap));
        else if (pick < 0.65) {
          kids.push({ kind: 'br', id: `b${ids++}`, font: inlineFont(r.pick([size, 30, 8])), lineHeight: r.chance(0.7) ? lh : inlineLineHeight(r) });
          afterSpace = true;
        } else if (depth < 2) {
          const own = r.chance(0.6) ? r.pick([8, 10, 13, 15, 20, 23.3, 30, 17.5]) : size;
          const ownLh = r.chance(0.5) ? inlineLineHeight(r) : lh;
          const id = `s${ids++}`;
          kids.push({ kind: 'inline', id, style: { ...INLINE_STYLE, direction }, font: inlineFont(own), lineHeight: ownLh, children: content(depth + 1, own, ownLh) });
        }
      }
      return kids;
    };
    const strutSize = r.pick([10, 10, 12.5, 16, 20, 17.5]);
    const strutLh = inlineLineHeight(r);
    const kids = content(0, strutSize, strutLh);
    // The context ends without a space (phase II would remove it; the compiler strips it).
    const trim = (items: Json[]): boolean => {
      for (let i = items.length - 1; i >= 0; i--) {
        const c = items[i] as Json;
        if (c['kind'] === 'br') return true;
        if (c['kind'] === 'inline') {
          if (trim(c['children'] as Json[])) return true;
          continue;
        }
        c['text'] = (c['text'] as string).replace(/ +$/, '');
        if (c['text'] !== '') return true;
      }
      return false;
    };
    trim(kids);
    const dropEmpty = (items: Json[]): Json[] => items.filter((c) => c['kind'] !== 'text' || c['text'] !== '').map((c) => (c['kind'] === 'inline' ? { ...c, children: dropEmpty(c['children'] as Json[]) } : c));
    const children = dropEmpty(kids);
    const containerStyle = { ...INLINE_STYLE, display: 'block', direction, width: { kind: 'px', value: 20 + r.int(180) + (r.chance(0.2) ? r.pick([0.015625, 0.5, 0.3]) : 0) }, textAlign: r.pick(['start', 'end', 'left', 'right', 'center']) };
    const container: Json = { kind: 'box', id: 'c', boxType: 'element', style: containerStyle, strut: children.length === 0 ? null : { font: inlineFont(strutSize), lineHeight: strutLh }, children };
    const root: Json = { kind: 'box', id: 'root', boxType: 'element', style: { ...INLINE_STYLE, display: r.chance(0.2) ? 'flex' : 'block', direction }, strut: null, children: [container] };
    const input: Json = { viewport: { width: 400, height: 300 }, devicePixelRatio: r.pick([1, 2, 3, 2.625]), viewportUnits: { small: { width: 400, height: 300 }, large: { width: 400, height: 300 }, dynamic: { width: 400, height: 300 } }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: 16, root };
    n++;
    if (!validateLayoutInput(input).ok) throw new Error(`engine-inline: generated input ${n} is invalid: ${JSON.stringify(validateLayoutInput(input))}`);
    const faults = r.chance(0.2) ? { ...NO_ENGINE_FAULTS, [r.pick(INLINE_FAULT_NAMES)]: true } : NO_ENGINE_FAULTS;
    out.push(JSON.stringify({ platform: 'darwin-arm64', faults, input }));
  }
  return [...out, ...atomicInlineCases(), ...wrapInlineCases(), ...vaInlineCases()];
}

/** The INL2a engine faults the atomic contexts draw from. */
const ATOMIC_FAULT_NAMES: readonly (keyof EngineFaults)[] = [
  'inlineBlockFirstBaseline', 'overflowBaselineIgnored', 'inlineFlexLastBaseline', 'atomicMarginExcluded', 'noBreakAroundAtomic', 'atomicShrinkToFitIgnored',
  'lineHeightIgnoresInlineBoxes', 'breakOffByOne', 'fitWithoutEpsilon',
];

/**
 * Generated inline formatting contexts with atomic inlines (INL2a): Ahem text, inline boxes and <br>s beside inline-block boxes
 * (empty and sized, or holding text, <br>s or block children, with margins, padding, borders and overflow: hidden) and inline-flex
 * boxes (rows and columns of text items), collapsed as the compiler collapses them, at every DPR, some with a planted fault.
 */
function atomicInlineCases(): string[] {
  const r = new Rng(EXTENDED_SPEC.seed * 71);
  const out: string[] = [];
  let n = 0;
  const len = (vs: readonly number[]): Json => ({ kind: 'px', value: r.pick(vs) });
  while (out.length < INLINE_SPEC.atomicInline) {
    const rtl = r.chance(0.3);
    const direction = rtl ? 'rtl' : 'ltr';
    let ids = 0;
    let afterSpace = true;
    const word = (): string => {
      let w = '';
      const k = 1 + r.int(5);
      for (let i = 0; i < k; i++) w += r.pick([...'abcXYZ']);
      return w;
    };
    const textLeaf = (size: number, lh: Json, words: number): Json => {
      let text = '';
      for (let i = 0; i < words; i++) {
        if (!afterSpace && (i > 0 || r.chance(0.5))) text += ' ';
        text += word();
        afterSpace = false;
      }
      if (r.chance(0.3)) {
        text += ' ';
        afterSpace = true;
      }
      return { kind: 'text', id: `t${ids++}`, text, font: inlineFont(size), lineHeight: lh, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap', overflowWrap: 'normal', wordBreak: 'normal' };
    };
    // A box's own inline content, collapsed: it starts a context of its own.
    const ownText = (size: number, lh: Json): Json[] => {
      afterSpace = true;
      const t = textLeaf(size, lh, 1 + r.int(3));
      t['text'] = (t['text'] as string).replace(/ +$/, '');
      return [t];
    };
    const decorated = (style: Json): Json => {
      const s: Json = { ...style };
      if (r.chance(0.4)) for (const k of ['marginLeft', 'marginRight', 'marginTop', 'marginBottom']) s[k] = len([0, 2, 5, 7, 0.5]);
      if (r.chance(0.3)) for (const k of ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']) s[k] = len([0, 1, 3, 6]);
      if (r.chance(0.2)) for (const k of ['borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'borderBottomWidth']) s[k] = len([0, 1, 2]);
      if (r.chance(0.15)) {
        s['overflowX'] = 'hidden';
        s['overflowY'] = 'hidden';
      }
      if (r.chance(0.3)) s['width'] = len([10, 15, 30, 55]);
      if (r.chance(0.3)) s['height'] = len([0, 10, 25, 40]);
      return s;
    };
    const atomic = (size: number, lh: Json): Json => {
      const id = `a${ids++}`;
      const own = r.chance(0.5) ? r.pick([8, 10, 13, 20]) : size;
      const ownLh = r.chance(0.5) ? inlineLineHeight(r) : lh;
      let node: Json;
      if (r.chance(0.6)) {
        const pick = r.next();
        const kids: Json[] = pick < 0.3 ? [] : pick < 0.8 ? ownText(own, ownLh) : [
          { kind: 'box', id: `${id}k0`, boxType: 'element', style: { ...INLINE_STYLE, display: 'block', direction, paddingBottom: len([0, 3, 5]) }, strut: { font: inlineFont(own), lineHeight: ownLh }, children: ownText(own, ownLh) },
          { kind: 'box', id: `${id}k1`, boxType: 'element', style: { ...INLINE_STYLE, display: 'block', direction, height: len([0, 4]) }, strut: null, children: [] },
        ];
        if (pick >= 0.3 && pick < 0.8 && r.chance(0.3)) kids.push({ kind: 'br', id: `${id}br`, font: inlineFont(own), lineHeight: ownLh }, ...ownText(own, ownLh));
        node = { kind: 'box', id, boxType: 'element', style: decorated({ ...INLINE_STYLE, display: 'inline-block', direction }), strut: kids.some((k) => k['kind'] !== 'box') ? { font: inlineFont(own), lineHeight: ownLh } : null, children: kids };
      } else {
        const items: Json[] = [];
        const count = r.int(4);
        for (let i = 0; i < count; i++) items.push({ kind: 'box', id: `${id}i${i}`, boxType: 'element', style: { ...INLINE_STYLE, display: 'block', direction, paddingTop: len([0, 2, 7, 9]) }, strut: { font: inlineFont(own), lineHeight: ownLh }, children: ownText(own, ownLh) });
        const flex = { ...INLINE_STYLE, display: 'inline-flex', direction, flexDirection: r.pick(['row', 'column']), alignItems: r.pick(['normal', 'baseline', 'center', 'flex-start']), justifyContent: r.pick(['normal', 'center']) };
        node = { kind: 'box', id, boxType: 'element', style: decorated(flex), strut: null, children: items };
      }
      afterSpace = false;
      return node;
    };
    const size = r.pick([10, 10, 12.5, 16, 20]);
    const lh = inlineLineHeight(r);
    const kids: Json[] = [];
    const count = 1 + r.int(5);
    // In rtl an atomic inline needs a letter on both sides in its paragraph (UAX #9), so rtl contexts open and close with text.
    if (rtl) kids.push(textLeaf(size, lh, 1));
    for (let i = 0; i < count; i++) {
      const pick = r.next();
      if (pick < 0.4) kids.push(atomic(size, lh));
      else if (pick < 0.75) kids.push(textLeaf(size, lh, 1 + r.int(2)));
      else if (pick < 0.85 && !rtl) {
        kids.push({ kind: 'br', id: `b${ids++}`, font: inlineFont(size), lineHeight: lh });
        afterSpace = true;
      } else {
        const own = r.pick([8, 13, 20]);
        const ownLh = r.chance(0.5) ? inlineLineHeight(r) : lh;
        kids.push({ kind: 'inline', id: `s${ids++}`, style: { ...INLINE_STYLE, direction }, font: inlineFont(own), lineHeight: ownLh, children: [textLeaf(own, ownLh, 1 + r.int(2))] });
      }
    }
    if (rtl) kids.push(textLeaf(size, lh, 1));
    const trim = (items: Json[]): boolean => {
      for (let i = items.length - 1; i >= 0; i--) {
        const c = items[i] as Json;
        if (c['kind'] === 'br' || c['kind'] === 'box') return true;
        if (c['kind'] === 'inline') {
          if (trim(c['children'] as Json[])) return true;
          continue;
        }
        c['text'] = (c['text'] as string).replace(/ +$/, '');
        if (c['text'] !== '') return true;
      }
      return false;
    };
    trim(kids);
    const dropEmpty = (items: Json[]): Json[] => items.filter((c) => c['kind'] !== 'text' || c['text'] !== '').map((c) => (c['kind'] === 'inline' ? { ...c, children: dropEmpty(c['children'] as Json[]) } : c));
    const children = dropEmpty(kids).filter((c) => c['kind'] !== 'inline' || (c['children'] as Json[]).length > 0);
    const containerStyle = { ...INLINE_STYLE, display: 'block', direction, width: { kind: 'px', value: 20 + r.int(180) }, textAlign: r.pick(['start', 'end', 'left', 'right', 'center']) };
    const container: Json = { kind: 'box', id: 'c', boxType: 'element', style: containerStyle, strut: { font: inlineFont(size), lineHeight: lh }, children };
    const root: Json = { kind: 'box', id: 'root', boxType: 'element', style: { ...INLINE_STYLE, display: r.chance(0.2) ? 'flex' : 'block', direction }, strut: null, children: [container] };
    const input: Json = { viewport: { width: 400, height: 300 }, devicePixelRatio: r.pick([1, 2, 3, 2.625]), viewportUnits: { small: { width: 400, height: 300 }, large: { width: 400, height: 300 }, dynamic: { width: 400, height: 300 } }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: 16, root };
    n++;
    const v = validateLayoutInput(input);
    if (!v.ok) throw new Error(`engine-inline atomic: generated input ${n} is invalid: ${JSON.stringify(v.errors)}`);
    const faults = r.chance(0.25) ? { ...NO_ENGINE_FAULTS, [r.pick(ATOMIC_FAULT_NAMES)]: true } : NO_ENGINE_FAULTS;
    out.push(JSON.stringify({ platform: 'darwin-arm64', faults, input }));
  }
  return out;
}

/** The TXT2-a engine faults the wrap contexts draw from. */
const WRAP_FAULT_NAMES: readonly (keyof EngineFaults)[] = [
  'anywhereMinContentIgnored', 'breakWordShrinksMinContent', 'graphemeClusterSplit', 'breakAnywhereAlways', 'emergencyBreakBeforeOpportunity', 'wordBreakBreakWordIgnored',
  'fitWithoutEpsilon', 'breakOffByOne',
];

/**
 * Generated inline formatting contexts for TXT2-a: Ahem words of 1 to 24 letters (so some overflow), inline boxes and <br>s, with
 * one overflow-wrap and word-break per context (normal, break-word, anywhere; normal or break-word), some nowrap, in a block
 * container of random width and text-align, sometimes a flex item, at every DPR, some with a planted fault.
 */
function wrapInlineCases(): string[] {
  const r = new Rng(EXTENDED_SPEC.seed * 73);
  const out: string[] = [];
  let n = 0;
  while (out.length < INLINE_SPEC.wrapInline) {
    const rtl = r.chance(0.3);
    const direction = rtl ? 'rtl' : 'ltr';
    const overflowWrap = r.pick(['normal', 'break-word', 'anywhere', 'anywhere']);
    const wordBreak = r.chance(0.25) ? 'break-word' : 'normal';
    const wrap = r.chance(0.9) ? 'wrap' : 'nowrap';
    let ids = 0;
    let afterSpace = true;
    const leaf = (size: number, lh: Json): Json => {
      let text = '';
      const words = 1 + r.int(3);
      for (let i = 0; i < words; i++) {
        if (!afterSpace && (i > 0 || r.chance(0.4))) text += ' ';
        const len = 1 + r.int(r.chance(0.5) ? 24 : 5);
        for (let k = 0; k < len; k++) text += r.pick([...'abXY']);
        afterSpace = false;
      }
      if (r.chance(0.3)) {
        text += ' ';
        afterSpace = true;
      }
      return { kind: 'text', id: `t${ids++}`, text, font: inlineFont(size), lineHeight: lh, whiteSpaceCollapse: 'collapse', textWrapMode: wrap, overflowWrap, wordBreak };
    };
    const size = r.pick([10, 10, 12.5, 16, 20]);
    const lh = inlineLineHeight(r);
    const kids: Json[] = [];
    const count = 1 + r.int(4);
    for (let i = 0; i < count; i++) {
      const pick = r.next();
      if (pick < 0.65) kids.push(leaf(size, lh));
      else if (pick < 0.8 && !rtl) {
        kids.push({ kind: 'br', id: `b${ids++}`, font: inlineFont(size), lineHeight: lh });
        afterSpace = true;
      } else {
        const own = r.pick([8, 13, 20]);
        kids.push({ kind: 'inline', id: `s${ids++}`, style: { ...INLINE_STYLE, direction }, font: inlineFont(own), lineHeight: lh, children: [leaf(own, lh)] });
      }
    }
    const trim = (items: Json[]): boolean => {
      for (let i = items.length - 1; i >= 0; i--) {
        const c = items[i] as Json;
        if (c['kind'] === 'br') return true;
        if (c['kind'] === 'inline') {
          if (trim(c['children'] as Json[])) return true;
          continue;
        }
        c['text'] = (c['text'] as string).replace(/ +$/, '');
        if (c['text'] !== '') return true;
      }
      return false;
    };
    trim(kids);
    const dropEmpty = (items: Json[]): Json[] => items.filter((c) => c['kind'] !== 'text' || c['text'] !== '').map((c) => (c['kind'] === 'inline' ? { ...c, children: dropEmpty(c['children'] as Json[]) } : c));
    const children = dropEmpty(kids).filter((c) => c['kind'] !== 'inline' || (c['children'] as Json[]).length > 0);
    if (!children.some((c) => c['kind'] === 'text' || c['kind'] === 'inline')) continue;
    const containerStyle = { ...INLINE_STYLE, display: 'block', direction, width: { kind: 'px', value: 10 + r.int(120) }, textAlign: r.pick(['start', 'end', 'center']) };
    const container: Json = { kind: 'box', id: 'c', boxType: 'element', style: containerStyle, strut: { font: inlineFont(size), lineHeight: lh }, children };
    const root: Json = { kind: 'box', id: 'root', boxType: 'element', style: { ...INLINE_STYLE, display: r.chance(0.3) ? 'flex' : 'block', direction, width: { kind: 'px', value: 20 + r.int(200) } }, strut: null, children: [container] };
    const input: Json = { viewport: { width: 400, height: 300 }, devicePixelRatio: r.pick([1, 2, 3, 2.625]), viewportUnits: { small: { width: 400, height: 300 }, large: { width: 400, height: 300 }, dynamic: { width: 400, height: 300 } }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: 16, root };
    n++;
    const v = validateLayoutInput(input);
    if (!v.ok) throw new Error(`engine-inline wrap: generated input ${n} is invalid: ${JSON.stringify(v.errors)}`);
    const faults = r.chance(0.25) ? { ...NO_ENGINE_FAULTS, [r.pick(WRAP_FAULT_NAMES)]: true } : NO_ENGINE_FAULTS;
    out.push(JSON.stringify({ platform: 'darwin-arm64', faults, input }));
  }
  return out;
}

/** The INL2b engine faults the vertical-align contexts draw from. */
const VA_FAULT_NAMES: readonly (keyof EngineFaults)[] = [
  'topBottomSinglePass', 'middleWithoutXHeight', 'subShiftOwnFont', 'lineHeightIgnoresInlineBoxes', 'fragmentFromLineTop', 'halfLeadingUnflooredPerBox',
  'breakOffByOne',
];

/** A vertical-align value: mostly keywords, some lengths and percentages (percentages only where the node has a line-height). */
function vaValue(r: Rng, percent: boolean): Json {
  const pick = r.next();
  if (pick < 0.75) return { kind: 'keyword', value: r.pick(['baseline', 'sub', 'super', 'text-top', 'text-bottom', 'middle', 'top', 'bottom']) };
  if (pick < 0.9 || !percent) return { kind: 'px', value: r.pick([5, -5, 3, -7.5, 12, 0.5]) };
  return { kind: 'percent', value: r.pick([50, -50, 25, 100, -12.5]) };
}

/**
 * Generated inline formatting contexts with vertical-align (INL2b): Ahem text, nested inline boxes of mixed sizes and
 * line-heights, <br>s, and inline-block boxes (empty and sized, or holding text), each with a random vertical-align, collapsed as
 * the compiler collapses them, in a block container of random width and text-align, at every DPR, some with a planted fault.
 */
function vaInlineCases(): string[] {
  const r = new Rng(EXTENDED_SPEC.seed * 79);
  const out: string[] = [];
  let n = 0;
  while (out.length < INLINE_SPEC.vaInline) {
    const rtl = r.chance(0.3);
    const direction = rtl ? 'rtl' : 'ltr';
    let ids = 0;
    let afterSpace = true;
    const leaf = (size: number, lh: Json): Json => {
      let text = '';
      const words = 1 + r.int(2);
      for (let i = 0; i < words; i++) {
        if (!afterSpace && (i > 0 || r.chance(0.5))) text += ' ';
        const len = 1 + r.int(5);
        for (let k = 0; k < len; k++) text += r.pick([...'abcXYZ']);
        afterSpace = false;
      }
      if (r.chance(0.3)) {
        text += ' ';
        afterSpace = true;
      }
      return { kind: 'text', id: `t${ids++}`, text, font: inlineFont(size), lineHeight: lh, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap', overflowWrap: 'normal', wordBreak: 'normal' };
    };
    const inlineBox = (depth: number, lh: Json): Json => {
      const own = r.pick([7, 8, 10, 13, 16.6667, 20, 30]);
      const ownLh = r.chance(0.5) ? inlineLineHeight(r) : lh;
      const kids: Json[] = [leaf(own, ownLh)];
      if (depth < 2 && r.chance(0.4)) kids.push(inlineBox(depth + 1, ownLh));
      if (r.chance(0.3)) kids.push(leaf(own, ownLh));
      return { kind: 'inline', id: `s${ids++}`, style: { ...INLINE_STYLE, direction, verticalAlign: vaValue(r, true) }, font: inlineFont(own), lineHeight: ownLh, children: kids };
    };
    const atomic = (size: number, lh: Json): Json => {
      const id = `a${ids++}`;
      const withText = r.chance(0.4);
      const style = { ...INLINE_STYLE, display: 'inline-block', direction, verticalAlign: vaValue(r, withText), width: { kind: 'px', value: r.pick([5, 10, 15]) }, height: withText ? { kind: 'auto' } : { kind: 'px', value: r.pick([0, 10, 25, 40, 60]) } };
      let children: Json[] = [];
      if (withText) {
        afterSpace = true;
        const t = leaf(size, lh);
        t['text'] = (t['text'] as string).replace(/ +$/, '');
        children = [t];
      }
      afterSpace = false;
      return { kind: 'box', id, boxType: 'element', style, strut: withText ? { font: inlineFont(size), lineHeight: lh } : null, children };
    };
    const size = r.pick([10, 10, 12.5, 16, 20]);
    const lh = inlineLineHeight(r);
    const kids: Json[] = [];
    const count = 2 + r.int(5);
    // In rtl an atomic inline needs a letter on both sides in its paragraph (UAX #9), so rtl contexts open and close with text.
    if (rtl) kids.push(leaf(size, lh));
    for (let i = 0; i < count; i++) {
      const pick = r.next();
      if (pick < 0.3) kids.push(leaf(size, lh));
      else if (pick < 0.75) kids.push(inlineBox(0, lh));
      else if (pick < 0.92) kids.push(atomic(size, lh));
      else if (!rtl) {
        kids.push({ kind: 'br', id: `b${ids++}`, font: inlineFont(size), lineHeight: lh });
        afterSpace = true;
      }
    }
    if (rtl) kids.push(leaf(size, lh));
    const trim = (items: Json[]): boolean => {
      for (let i = items.length - 1; i >= 0; i--) {
        const c = items[i] as Json;
        if (c['kind'] === 'br' || c['kind'] === 'box') return true;
        if (c['kind'] === 'inline') {
          if (trim(c['children'] as Json[])) return true;
          continue;
        }
        c['text'] = (c['text'] as string).replace(/ +$/, '');
        if (c['text'] !== '') return true;
      }
      return false;
    };
    trim(kids);
    const dropEmpty = (items: Json[]): Json[] => items.filter((c) => c['kind'] !== 'text' || c['text'] !== '').map((c) => (c['kind'] === 'inline' ? { ...c, children: dropEmpty(c['children'] as Json[]) } : c));
    const children = dropEmpty(kids).filter((c) => c['kind'] !== 'inline' || (c['children'] as Json[]).length > 0);
    if (!children.some((c) => c['kind'] === 'text' || c['kind'] === 'inline')) continue;
    const containerStyle = { ...INLINE_STYLE, display: 'block', direction, width: { kind: 'px', value: 20 + r.int(180) }, textAlign: r.pick(['start', 'end', 'center']) };
    const container: Json = { kind: 'box', id: 'c', boxType: 'element', style: containerStyle, strut: { font: inlineFont(size), lineHeight: lh }, children };
    const root: Json = { kind: 'box', id: 'root', boxType: 'element', style: { ...INLINE_STYLE, display: r.chance(0.2) ? 'flex' : 'block', direction }, strut: null, children: [container] };
    const input: Json = { viewport: { width: 400, height: 300 }, devicePixelRatio: r.pick([1, 2, 3, 2.625]), viewportUnits: { small: { width: 400, height: 300 }, large: { width: 400, height: 300 }, dynamic: { width: 400, height: 300 } }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: 16, root };
    n++;
    const v = validateLayoutInput(input);
    if (!v.ok) throw new Error(`engine-inline vertical-align: generated input ${n} is invalid: ${JSON.stringify(v.errors)}`);
    const faults = r.chance(0.25) ? { ...NO_ENGINE_FAULTS, [r.pick(VA_FAULT_NAMES)]: true } : NO_ENGINE_FAULTS;
    out.push(JSON.stringify({ platform: 'darwin-arm64', faults, input }));
  }
  return out;
}

// ---------------------------------------------------------------- text-latin (TXT1a-2)

/** The shaped vectors (packages/layout/vectors/text-latin/dpr-<d>/, written by layout:vectors and layout:dpr-vectors), in DPR then file order. */
export const TEXT_LATIN_DPRS: readonly number[] = [1, ...DPR_SETS];

/**
 * Each shaped vector as an engine line with its shape transcript (R3): the harness replays HarfBuzz from it, and a call the
 * transcript lacks is a harness error. The vector's recorded output must be the replayed layout.
 */
export function textLatinVectorCases(): DprVectorCase[] {
  const out: DprVectorCase[] = [];
  for (const dpr of TEXT_LATIN_DPRS) {
    const dir = join(VECTORS_DIR, 'text-latin', `dpr-${dpr}`);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const v = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { platform: string; measurer: string; language: string; faces: unknown; calls: unknown; input: unknown; output: unknown };
      if (!validateLayoutInput(v.input).ok) throw new Error(`text-latin vector dpr-${dpr}/${f} fails the validator`);
      const line = JSON.stringify({ platform: v.platform, faults: NO_ENGINE_FAULTS, input: v.input, shaping: { language: v.language, faces: v.faces, calls: v.calls } });
      out.push({ file: `text-latin/dpr-${dpr}/${f}`, line, output: v.output, measurer: v.measurer, dpr });
    }
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
  const engineInline = engineInlineCases();
  const textLatin = textLatinVectorCases().map((v) => v.line);
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
    // INL1a: a new suite only, after the V1 ones.
    { name: 'engine-inline', mode: 'engine', lines: engineInline, expected: engineInline.map(runEngineCase) },
    // TXT1a-2: a new suite only, after the INL1a one.
    { name: 'text-latin', mode: 'engine', lines: textLatin, expected: textLatin.map(runEngineCase) },
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
    engineInline: INLINE_SPEC.engineInline + INLINE_SPEC.atomicInline + INLINE_SPEC.wrapInline + INLINE_SPEC.vaInline,
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
