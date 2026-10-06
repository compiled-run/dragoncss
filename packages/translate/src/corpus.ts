// The differential corpus (native-strategy.md section 1.7): one seed, one size and one generator for every target. Inputs are
// JSON lines; expected results come from the translated harness run in TypeScript against the TypeScript engine.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineFaults } from '../../layout/src/block.ts';
import { NO_ENGINE_FAULTS } from '../../layout/src/block.ts';
import type { LayoutBox, LayoutInput, LayoutStyle, TextLeaf } from '../../layout/src/input.ts';
import { validateLayoutInput } from '../../layout/src/validate.ts';
import { runEngineCase, runLibraryCase, runSnapCase, runUnitsCase } from '../harness/harness.ts';
import { bitsHex } from '../harness/host.ts';
import { ROOT } from './generate.ts';

export const CORPUS_SPEC = {
  seed: 20260927,
  unitsPerFunction: 20000,
  generatedTrees: 20000,
  libraryPerOperation: 2000,
} as const;

export const UNITS_FUNCTIONS = [
  'fromCssPx', 'fromDouble', 'fromPxRound', 'fromPxCeil', 'snapBorderWidth', 'percentOf', 'roundFontMetricToWholePx', 'platformFontSize',
  'textAdvance', 'lineHeightFromNumber', 'growShare', 'shrinkShare', 'fractionalFreeSpace', 'divInt', 'cumulativeShareRounded', 'distributedOffset',
] as const;

/** A small deterministic generator (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)] as T;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// ---------------------------------------------------------------- units corpus

export const EDGE = [0, -0, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 1 / 64, 0.5 / 64, -0.5 / 64, 33554431.5, 33554432, 33554433, 4e7, -4e7, 2147483647, -2147483648, 2147483648, 1e300, -1e300, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MIN_VALUE, 0.1, 0.2, 0.3, 100, 1e-7];

export function px(r: Rng): number {
  const k = r.next();
  if (k < 0.08) return r.pick(EDGE);
  if (k < 0.3) return Math.round((r.next() * 2000 - 500) * 100) / 100;
  if (k < 0.45) return Math.round(r.next() * 400 * 8) / 8;
  if (k < 0.55) return (r.next() * 2 - 1) * 4e7;
  if (k < 0.7) return Math.round(r.next() * 640) / 64 + (r.chance(0.5) ? 0.5 / 64 : 0);
  if (k < 0.8) return Math.round(r.next() * 2000) / 2 - 500;
  return r.next() * 1000 - 200;
}

export function lu(r: Rng): number {
  const k = r.next();
  if (k < 0.05) return r.pick([0, -0, 2147483647, -2147483648, 1, -1, 64, -64, 32, -32]);
  const v = Math.trunc(px(r) * 64);
  return Number.isFinite(v) ? Math.max(-2147483648, Math.min(2147483647, v)) : 0;
}

function factor(r: Rng): number {
  return r.pick([0, 0.5, 1, 2, 0.3333333, 1e-9, 1e9, r.next() * 5, Math.round(r.next() * 8) / 4]);
}

function unitsArgs(name: (typeof UNITS_FUNCTIONS)[number], r: Rng): (number | string)[] {
  const pos = (): number => Math.abs(lu(r));
  const small = (): number => 1 + r.int(12);
  const size = (): number => (r.chance(0.1) ? r.pick([0, 0.5, 10.625, 12.5, 17.5, 10.629, 11.1111, Number.NaN, 1e6]) : Math.abs(px(r)) % 200);
  switch (name) {
    case 'fromCssPx':
    case 'fromDouble':
    case 'fromPxRound':
    case 'fromPxCeil':
      return [px(r)];
    case 'snapBorderWidth':
      return [r.chance(0.1) ? r.pick([0, 0.25, 0.5, 1, 1.5, 0.333333, 0.380952, 1e-9]) : Math.abs(px(r)) % 50, r.pick([1, 2, 3, 1.5, 2.625, 0.5])];
    case 'percentOf':
      return [lu(r), r.chance(0.1) ? r.pick([0, 100, 33.333333, 66.666667, 12.5, -50, 1e-5]) : Math.round(r.next() * 20000 - 5000) / 100];
    case 'roundFontMetricToWholePx':
    case 'platformFontSize':
      return [size()];
    case 'textAdvance':
      return [r.int(300), size()];
    case 'lineHeightFromNumber':
      return [size(), r.chance(0.1) ? r.pick([0, 1, 1.2, 1.5, 0.5, 2.625]) : Math.round(r.next() * 400) / 100];
    case 'growShare':
      return [lu(r), factor(r), factor(r) * small()];
    case 'shrinkShare':
      return [lu(r), factor(r), pos(), factor(r) * pos()];
    case 'fractionalFreeSpace':
      return [lu(r), r.chance(0.1) ? r.pick([0, 1, 0.5, 0.9999999, 1e-9]) : r.next()];
    case 'divInt':
      return [lu(r), r.chance(0.05) ? r.pick([0, 0.5, -0, 3.5]) : small() * (r.chance(0.5) ? -1 : 1)];
    case 'cumulativeShareRounded':
      return [r.chance(0.02) ? -1 : pos(), r.int(12), r.chance(0.02) ? 0 : small()];
    case 'distributedOffset':
      return [r.pick(['space-between', 'space-around', 'space-evenly']), pos(), small(), r.int(12)];
  }
}

export function unitsCases(): string[] {
  const out: string[] = [];
  UNITS_FUNCTIONS.forEach((name, i) => {
    const r = new Rng(CORPUS_SPEC.seed * 31 + i);
    for (let k = 0; k < CORPUS_SPEC.unitsPerFunction; k++) {
      const args = unitsArgs(name, r).map((a) => (typeof a === 'string' ? a : bitsHex(a)));
      out.push(JSON.stringify([name, ...args]));
    }
  });
  return out;
}

// ---------------------------------------------------------------- engine corpus

/**
 * The engine faults the P1 corpus draws from: the milestone-1 set, fixed so the P1 corpus inputs do not move when a fault is
 * added (P2b adds initialLineWidthZoomed, which the extended corpus draws). The faults object of every line still names every
 * EngineFaults key, as the exact-key decoder requires.
 */
const P1_FAULT_NAMES: readonly (keyof EngineFaults)[] = [
  'breakOffByOne', 'rtlAsLtr', 'ignoreOrder', 'baselineFromBorderTop', 'scrollMinAuto', 'absposInFlow', 'cbIgnoresPadding',
  'staticPosLtr', 'relativeShiftsFlow', 'metricHalfUp', 'untruncatedFontSize', 'halfLeadingSpec', 'minMaxEndMarginSpec',
  'wrapReverseBaselineSpec',
];
const DPRS = [1, 2, 2.625, 3];

type MutableStyle = { -readonly [K in keyof LayoutStyle]: LayoutStyle[K] };
export type Json = Record<string, unknown>;

export function faultsFor(r: Rng, names: readonly (keyof EngineFaults)[] = P1_FAULT_NAMES): EngineFaults {
  if (!r.chance(0.1)) return NO_ENGINE_FAULTS;
  const f = r.pick(names);
  return { ...NO_ENGINE_FAULTS, [f]: true };
}

const INITIAL: LayoutStyle = {
  display: 'block', position: 'static', top: { kind: 'auto' }, right: { kind: 'auto' }, bottom: { kind: 'auto' }, left: { kind: 'auto' },
  overflowX: 'visible', overflowY: 'visible', direction: 'ltr', boxSizing: 'content-box', width: { kind: 'auto' }, height: { kind: 'auto' },
  minWidth: { kind: 'auto' }, minHeight: { kind: 'auto' }, maxWidth: { kind: 'none' }, maxHeight: { kind: 'none' },
  marginTop: { kind: 'px', value: 0 }, marginRight: { kind: 'px', value: 0 }, marginBottom: { kind: 'px', value: 0 }, marginLeft: { kind: 'px', value: 0 },
  paddingTop: { kind: 'px', value: 0 }, paddingRight: { kind: 'px', value: 0 }, paddingBottom: { kind: 'px', value: 0 }, paddingLeft: { kind: 'px', value: 0 },
  borderTopWidth: { kind: 'px', value: 0 }, borderRightWidth: { kind: 'px', value: 0 }, borderBottomWidth: { kind: 'px', value: 0 }, borderLeftWidth: { kind: 'px', value: 0 },
  flexDirection: 'row', flexWrap: 'nowrap', flexGrow: 0, flexShrink: 1, flexBasis: { kind: 'auto' }, order: 0, justifyContent: 'normal',
  alignItems: 'normal', alignSelf: 'auto', alignContent: 'normal', rowGap: { kind: 'normal' }, columnGap: { kind: 'normal' }, textAlign: 'start',
  aspectRatio: { kind: 'auto' },
  grid: null, gridItem: null,
};

function len(r: Rng, min: number): number {
  const v = r.chance(0.15)
    ? r.pick([0, 0.5, 1, 0.015625, 0.25, 7.5, 10.625, 33.333, 100, 1e5])
    : r.chance(0.5) ? r.int(120) : Math.round(r.next() * 2000) / 16;
  return Math.max(min, min < 0 && r.chance(0.2) ? -v : v);
}

function pct(r: Rng): number {
  return r.pick([0, 10, 25, 33.333333, 50, 66.666667, 100, 12.5, 150, Math.round(r.next() * 10000) / 100]);
}

type Size = LayoutStyle['width'];
function sizeV(r: Rng, autoP: number): Size {
  if (r.chance(autoP)) return { kind: 'auto' };
  return r.chance(0.25) ? { kind: 'percent', value: pct(r) } : { kind: 'px', value: len(r, 0) };
}

function marginV(r: Rng): LayoutStyle['marginTop'] {
  const k = r.next();
  if (k < 0.55) return { kind: 'px', value: 0 };
  if (k < 0.65) return { kind: 'auto' };
  if (k < 0.72) return { kind: 'percent', value: r.chance(0.2) ? -pct(r) : pct(r) };
  return { kind: 'px', value: len(r, -1e9) };
}

function randomStyle(r: Rng, flexParent: boolean, depth: number): LayoutStyle {
  const s: MutableStyle = { ...INITIAL };
  s.display = r.chance(0.4) ? 'flex' : 'block';
  s.position = r.chance(0.82) ? 'static' : r.chance(0.5) ? 'relative' : 'absolute';
  if (depth === 0 && s.position === 'absolute') s.position = 'static';
  const inset = (): LayoutStyle['top'] => (r.chance(0.6) ? { kind: 'auto' } : r.chance(0.2) ? { kind: 'percent', value: pct(r) } : { kind: 'px', value: len(r, -1e9) });
  if (s.position !== 'static') {
    s.top = inset();
    s.right = inset();
    s.bottom = inset();
    s.left = inset();
  }
  const ov = r.chance(0.12) ? 'hidden' : 'visible';
  s.overflowX = ov;
  s.overflowY = ov;
  s.direction = r.chance(0.3) ? 'rtl' : 'ltr';
  s.boxSizing = r.chance(0.3) ? 'border-box' : 'content-box';
  s.width = sizeV(r, 0.55);
  s.height = sizeV(r, 0.7);
  s.minWidth = sizeV(r, 0.85);
  s.minHeight = sizeV(r, 0.85);
  s.maxWidth = r.chance(0.85) ? { kind: 'none' } : r.chance(0.3) ? { kind: 'percent', value: pct(r) } : { kind: 'px', value: len(r, 0) };
  s.maxHeight = r.chance(0.85) ? { kind: 'none' } : r.chance(0.3) ? { kind: 'percent', value: pct(r) } : { kind: 'px', value: len(r, 0) };
  s.marginTop = marginV(r);
  s.marginRight = marginV(r);
  s.marginBottom = marginV(r);
  s.marginLeft = marginV(r);
  const padV = (): LayoutStyle['paddingTop'] => (r.chance(0.6) ? { kind: 'px', value: 0 } : r.chance(0.15) ? { kind: 'percent', value: pct(r) } : { kind: 'px', value: len(r, 0) });
  s.paddingTop = padV();
  s.paddingRight = padV();
  s.paddingBottom = padV();
  s.paddingLeft = padV();
  const bor = (): LayoutStyle['borderTopWidth'] => ({ kind: 'px', value: r.chance(0.6) ? 0 : r.pick([0.25, 0.5, 1, 1.5, 2, 3, 3.3, 10]) });
  s.borderTopWidth = bor();
  s.borderRightWidth = bor();
  s.borderBottomWidth = bor();
  s.borderLeftWidth = bor();
  s.flexDirection = r.pick(['row', 'row-reverse', 'column', 'column-reverse']);
  s.flexWrap = r.chance(s.flexDirection.startsWith('column') ? 0.85 : 0.5) ? 'nowrap' : r.pick(['wrap', 'wrap-reverse']);
  if (flexParent || r.chance(0.2)) {
    s.flexGrow = r.chance(0.5) ? 0 : r.pick([0.5, 1, 2, 3, 0.25, 1e-3, 1e6]);
    s.flexShrink = r.chance(0.6) ? 1 : r.pick([0, 0.5, 2, 5]);
    s.flexBasis = r.chance(0.6) ? { kind: 'auto' } : r.chance(0.03) ? { kind: 'content' } : r.chance(0.3) ? { kind: 'percent', value: pct(r) } : { kind: 'px', value: len(r, 0) };
    s.order = r.chance(0.7) ? 0 : r.pick([-2, -1, 1, 2, 5]);
    s.alignSelf = r.pick(['auto', 'auto', 'auto', 'normal', 'stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end', 'self-start', 'self-end']);
  }
  s.justifyContent = r.pick(['normal', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'stretch', 'start', 'end', 'left', 'right']);
  s.alignItems = r.pick(['normal', 'stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end', 'self-start', 'self-end']);
  s.alignContent = r.chance(0.02) ? 'baseline' : r.pick(['normal', 'stretch', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'start', 'end']);
  const gap = (): LayoutStyle['rowGap'] => (r.chance(0.6) ? { kind: 'normal' } : r.chance(0.03) ? { kind: 'percent', value: pct(r) } : { kind: 'px', value: len(r, 0) });
  s.rowGap = gap();
  s.columnGap = gap();
  s.textAlign = r.chance(0.03) ? 'justify' : r.pick(['start', 'start', 'end', 'left', 'right', 'center']);
  // SIZE-ar: a layout ratio (raw LayoutUnits) where no block length holds a percentage, which the validator refuses beside one.
  const percentBlock = s.height.kind === 'percent' || s.minHeight.kind === 'percent' || s.maxHeight.kind === 'percent';
  if (!percentBlock && r.chance(0.1)) {
    const parts = r.pick([[1024, 576], [64, 64], [7, 10], [1, 1234], [2111, 171], [128, 64], [64, 192]]);
    s.aspectRatio = { kind: r.chance(0.25) ? 'auto-ratio' : 'ratio', width: parts[0] as number, height: parts[1] as number };
  }
  return s;
}

const LETTERS = 'XXXXXXXXAbcdEfghIjklMnopQrstUvwxYz';

function randomText(r: Rng, rtl: boolean): string {
  // Most texts are Ahem glyphs; a minority carry the code points that must be refused or iterated exactly (U+200B, combining
  // marks, precomposed letters, astral and CJK code points, and bidi neutrals, which an rtl paragraph refuses).
  const special = r.chance(rtl ? 0.08 : 0.2);
  const words: string[] = [];
  const n = 1 + r.int(6);
  for (let i = 0; i < n; i++) {
    let w = '';
    const wl = 1 + r.int(8);
    for (let j = 0; j < wl; j++) {
      const k = special ? r.next() : 0;
      if (k < 0.8) w += LETTERS.charAt(r.int(LETTERS.length));
      else if (k < 0.84) w += '\u200b';
      else if (k < 0.88) w += r.pick(['1', '.', '-', "'"]);
      else if (k < 0.92) w += 'e\u0301';
      else if (k < 0.95) w += '\u00e9';
      else if (k < 0.98) w += '\u{1F600}';
      else w += '\u6f22';
    }
    words.push(w);
  }
  return words.join(' ');
}

function textLeaf(r: Rng, id: string, font: { size: number; lh: TextLeaf['lineHeight']; wrap: TextLeaf['textWrapMode'] }, rtl: boolean): TextLeaf {
  return { kind: 'text', id, text: randomText(r, rtl), font: { family: 'Ahem', size: font.size, specifiedSize: { kind: 'px', value: font.size }, absoluteSize: true }, lineHeight: font.lh, whiteSpaceCollapse: 'collapse', textWrapMode: font.wrap };
}

/** Ids: plain, and sometimes canonically equivalent pairs (U+00E9 and e + U+0301) that JS keeps distinct. */
function idFor(r: Rng, n: number, canonical: boolean): string {
  if (canonical && n % 2 === 1) return `n\u00e9${n >> 1}`;
  if (canonical && n % 2 === 0 && n > 0) return `ne\u0301${(n >> 1) - 1}`;
  return r.chance(0.02) ? `n${n}\u{1F600}` : `n${n}`;
}

function randomInput(r: Rng): LayoutInput {
  const total = 1 + r.int(12);
  const canonical = r.chance(0.08);
  let made = 0;
  const makeBox = (depth: number, flexParent: boolean): LayoutBox => {
    const id = idFor(r, made, canonical);
    made++;
    const style = randomStyle(r, flexParent, depth);
    const children: (LayoutBox | TextLeaf)[] = [];
    const font = { size: r.pick([10, 10, 12.5, 16, 20, 10.625, 7.3, 13.33]), lh: r.chance(0.6) ? { kind: 'normal' } as const : r.chance(0.5) ? { kind: 'number', value: r.pick([1, 1.2, 1.5, 0.5, 2]) } as const : { kind: 'px', value: r.pick([5, 10, 15, 25, 12.5]) } as const, wrap: r.chance(0.85) ? 'wrap' as const : 'nowrap' as const };
    if (made < total && r.chance(0.35) && style.display === 'block') {
      const n = 1 + r.int(2);
      for (let i = 0; i < n; i++) children.push(textLeaf(r, `${id}:t${i}`, font, style.direction === 'rtl'));
      return { kind: 'box', id, boxType: 'element', style, children };
    }
    while (made < total && r.chance(0.75)) {
      if (r.chance(0.15)) {
        // Text beside boxes, or in a flex container, arrives wrapped in an anonymous box (CSS2 §9.2.1.1, css-flexbox-1 §4).
        const aid = `${id}:anon${children.length}`;
        const astyle: LayoutStyle = { ...INITIAL, direction: style.direction, textAlign: style.textAlign };
        children.push({ kind: 'box', id: aid, boxType: 'anonymous', style: astyle, children: [textLeaf(r, `${aid}:t0`, font, style.direction === 'rtl')] });
        continue;
      }
      children.push(makeBox(depth + 1, style.display === 'flex'));
    }
    return { kind: 'box', id, boxType: 'element', style, children };
  };
  const root = makeBox(0, false);
  const dpr = r.pick(DPRS);
  const viewport = { width: r.chance(0.05) ? 0 : 100 + r.int(900), height: r.chance(0.05) ? 0 : 100 + r.int(900) };
  return { viewport, devicePixelRatio: dpr, ...referenceEnvironment(viewport), root };
}

/**
 * The environment inputs of the reference environment, drawing nothing from the generator so the P1 inputs keep their shape:
 * every viewport unit reads the viewport, no safe area, a 16px root font size (V2 of the value model).
 */
export function referenceEnvironment(viewport: { readonly width: number; readonly height: number }): Pick<LayoutInput, 'viewportUnits' | 'safeArea' | 'rootFontSize'> {
  return { viewportUnits: { small: viewport, large: viewport, dynamic: viewport }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: 16 };
}

// ---------------------------------------------------------------- library corpus

const LIBRARY_OPS = ['round', 'trunc', 'floor', 'ceil', 'fround', 'isInteger', 'hex', 'sort', 'map', 'codePoints', 'equal'] as const;

/** Strings whose code units differ while Swift or NFC comparison calls them equal, and astral and combining code points. */
const STRING_POOL = ['a', 'b', 'K', '\u212a', '\u00e9', 'e\u0301', '\u00c5', 'A\u030a', '\u212b', 'x\u{1F600}', '\u{1F600}', '\u6f22', 'n0', 'n1', 'n0:line0', '\u200b', ' '];

function libraryArgs(op: (typeof LIBRARY_OPS)[number], r: Rng): unknown[] {
  const halves = (): number => (r.chance(0.5) ? r.int(40) - 20 + 0.5 : r.pick(EDGE));
  switch (op) {
    case 'round':
    case 'trunc':
    case 'floor':
    case 'ceil':
    case 'fround':
      return [bitsHex(r.chance(0.6) ? halves() : px(r))];
    case 'isInteger':
      return [bitsHex(r.chance(0.5) ? r.int(100) - 50 : r.chance(0.5) ? halves() : r.pick(EDGE))];
    case 'hex':
      return [bitsHex(r.chance(0.8) ? r.int(0x110000) : r.int(2 ** 40))];
    case 'sort': {
      const n = 1 + r.int(12);
      return [Array.from({ length: n }, (_, i) => [bitsHex(r.int(4) - (r.chance(0.2) ? 0.5 : 0)), `t${i}`])];
    }
    case 'map':
      return [Array.from({ length: 1 + r.int(8) }, () => r.pick(STRING_POOL))];
    case 'codePoints':
      return [Array.from({ length: 1 + r.int(6) }, () => r.pick(STRING_POOL)).join('')];
    case 'equal':
      return [r.pick(STRING_POOL), r.pick(STRING_POOL)];
  }
}

export function libraryCases(): string[] {
  const out: string[] = [];
  LIBRARY_OPS.forEach((op, i) => {
    const r = new Rng(CORPUS_SPEC.seed * 37 + i);
    for (let k = 0; k < CORPUS_SPEC.libraryPerOperation; k++) out.push(JSON.stringify([op, ...libraryArgs(op, r)]));
  });
  return out;
}

export type VectorCase = { readonly file: string; readonly line: string; readonly output: unknown; readonly measurer: string };

export const VECTORS_DIR = join(ROOT, 'packages/layout/vectors');
/** The committed manifest of the 258 milestone-1 case ids: the P1 vectors suite reads exactly these (ruling 4). */
export const M1_MANIFEST = join(ROOT, 'packages/translate/corpus-m1-cases.json');

export function m1CaseIds(): string[] {
  return (JSON.parse(readFileSync(M1_MANIFEST, 'utf8')) as { cases: string[] }).cases;
}

/** Every top-level vector file name, sorted. */
export function topLevelVectorFiles(): string[] {
  return readdirSync(VECTORS_DIR).filter((f) => f.endsWith('.json')).sort();
}

export function vectorCase(dir: string, file: string): VectorCase {
  const v = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { platform: string; measurer: string; input: unknown; output: unknown };
  const valid = validateLayoutInput(v.input);
  if (!valid.ok) throw new Error(`vector ${file} fails the validator`);
  return { file, line: JSON.stringify({ platform: v.platform, faults: NO_ENGINE_FAULTS, input: v.input }), output: v.output, measurer: v.measurer };
}

/** The milestone-1 vectors, in manifest order (file-name order at 8228b4e). */
export function vectorCases(): VectorCase[] {
  return m1CaseIds().map((id) => vectorCase(VECTORS_DIR, `${id}.json`));
}

/** One seeded mutation of a vector input: a length, a percentage, a flex factor, a direction or the DPR. */
export function mutate(input: Json, r: Rng): Json {
  for (let attempt = 0; attempt < 20; attempt++) {
    const copy = JSON.parse(JSON.stringify(input)) as Json;
    const boxes: Json[] = [];
    const walk = (b: Json): void => {
      if (b['kind'] !== 'box') return;
      if (b['boxType'] === 'element') boxes.push(b);
      for (const c of b['children'] as Json[]) walk(c);
    };
    walk(copy['root'] as Json);
    const kind = r.int(5);
    const box = boxes.length > 0 ? r.pick(boxes) : null;
    if (kind === 4 || box === null) {
      copy['devicePixelRatio'] = r.pick([2, 2.625, 3, 1.5]);
    } else {
      const style = box['style'] as Json;
      if (kind === 0) {
        const k = r.pick(['width', 'height', 'marginTop', 'marginLeft', 'marginRight', 'paddingLeft', 'paddingTop', 'borderLeftWidth', 'minWidth', 'maxWidth', 'flexBasis', 'rowGap', 'columnGap']);
        style[k] = k.startsWith('margin') ? { kind: 'px', value: len(r, -1e9) } : { kind: 'px', value: len(r, 0) };
      } else if (kind === 1) {
        const k = r.pick(['width', 'height', 'marginLeft', 'paddingRight', 'minHeight', 'maxWidth', 'flexBasis']);
        style[k] = { kind: 'percent', value: pct(r) };
      } else if (kind === 2) {
        style[r.pick(['flexGrow', 'flexShrink'])] = r.pick([0, 0.5, 1, 2, 3, 0.25]);
      } else {
        style['direction'] = style['direction'] === 'rtl' ? 'ltr' : 'rtl';
        // Anonymous children inherit direction.
        for (const c of box['children'] as Json[]) if (c['kind'] === 'box' && c['boxType'] === 'anonymous') (c['style'] as Json)['direction'] = style['direction'];
      }
    }
    if (validateLayoutInput(copy).ok) return copy;
  }
  return { ...input, devicePixelRatio: 2 };
}

export type EngineCorpus = { readonly lines: string[]; readonly mutated: number; readonly generated: number };

export function engineCases(vectors: readonly VectorCase[]): EngineCorpus {
  const r = new Rng(CORPUS_SPEC.seed);
  const lines: string[] = [];
  for (const v of vectors) {
    const parsed = JSON.parse(v.line) as { platform: string; input: Json };
    lines.push(JSON.stringify({ platform: parsed.platform, faults: faultsFor(r), input: mutate(parsed.input, r) }));
  }
  let generated = 0;
  while (generated < CORPUS_SPEC.generatedTrees) {
    const input = randomInput(r);
    if (!validateLayoutInput(input).ok) continue;
    const platform = r.chance(0.005) ? 'linux-x64' : 'darwin-arm64';
    lines.push(JSON.stringify({ platform, faults: faultsFor(r), input }));
    generated++;
  }
  return { lines, mutated: vectors.length, generated };
}

export type Split = { ok: number; unsupported: number; refused: number; threw: number; harnessError: number };

export function split(results: readonly string[]): Split {
  const s: Split = { ok: 0, unsupported: 0, refused: 0, threw: 0, harnessError: 0 };
  for (const x of results) {
    if (x.startsWith('["ok"')) s.ok++;
    else if (x.startsWith('["unsupported"')) s.unsupported++;
    else if (x.startsWith('["refused"')) s.refused++;
    else if (x.startsWith('["threw"')) s.threw++;
    else s.harnessError++;
  }
  return s;
}

export type Suite = { readonly name: string; readonly mode: 'engine' | 'units' | 'library' | 'snap'; readonly lines: readonly string[]; readonly expected: readonly string[] };

export type Corpus = {
  readonly suites: readonly Suite[];
  readonly vectors: readonly VectorCase[];
  readonly engineSplit: Split;
  readonly digest: string;
  readonly digests: Readonly<Record<string, string>>;
};

const NAN_SIGN_PAYLOAD = /"([0-9a-f]{16})"/g;
const isNanBits = (hex: string): boolean => {
  const v = BigInt(`0x${hex}`);
  return ((v >> 52n) & 0x7ffn) === 0x7ffn && (v & 0xfffffffffffffn) !== 0n;
};

/**
 * A corpus line with every NaN's bits written as the one quiet NaN, 7ff8000000000000 (PM ruling, 2026-10-04). JavaScript gives
 * NaN sign and payload bits no meaning, and hosts differ in them: x86-64 makes 0 * Infinity fff8000000000000, arm64
 * 7ff8000000000000 (units-m2 #45946 and #46835, zoomFontSize with NaN inputs, failed only on the x86_64 emulator). Every other
 * value keeps its exact bits: -0 is still 8000000000000000, and a NaN never equals a number.
 */
export function canonicalNan(line: string): string {
  return line.replace(NAN_SIGN_PAYLOAD, (tok, hex: string) => (isNanBits(hex) ? '"7ff8000000000000"' : tok));
}

/** Whether a native result line equals the TypeScript one: exact, except that any NaN matches any NaN. */
export const sameResult = (expected: string, got: string): boolean => expected === got || canonicalNan(expected) === canonicalNan(got);

/** Per-suite digests (inputs and TypeScript results, NaNs canonical) and the corpus digest over them. */
export function digestsOf(suites: readonly Suite[]): { readonly digest: string; readonly digests: Record<string, string> } {
  const digests: Record<string, string> = {};
  const all = createHash('sha256');
  for (const s of suites) {
    const h = createHash('sha256');
    for (let i = 0; i < s.lines.length; i++) h.update(canonicalNan(s.lines[i] as string)).update('\n').update(canonicalNan(s.expected[i] as string)).update('\n');
    digests[s.name] = h.digest('hex');
    all.update(`${s.name} ${digests[s.name]}\n`);
  }
  return { digest: all.digest('hex'), digests };
}

// ---------------------------------------------------------------- rt suite (ANIM-a2, T047 section 3.2)

/** The rt vectors (packages/layout/rt-vectors): the TypeScript rt reference on the Chrome oracle inputs, which Swift and Kotlin must equal. */
export const RT_VECTORS_DIR = join(ROOT, 'packages/layout/rt-vectors');

type RtEasingJson = { readonly kind: string; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly steps: number; readonly position: string };
type RtComboJson = { readonly delayMs: number; readonly endDelayMs: number; readonly durationMs: number; readonly iterations: number | 'Infinity'; readonly iterationStart: number; readonly direction: string; readonly fill: string; readonly easing: RtEasingJson };
type RtLengthJson = { readonly kind: string; readonly px: number; readonly percent: number };
type RtOpJson = { readonly fn: string; readonly x: RtLengthJson; readonly y: RtLengthJson; readonly angle: number; readonly sx: number; readonly sy: number };
type RtValueJson = { readonly kind: string; readonly number: number; readonly length: RtLengthJson; readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }; readonly ops: readonly RtOpJson[] };
type RtCaseJson = { readonly from: RtValueJson; readonly to: RtValueJson; readonly effectEasing: RtEasingJson; readonly keyframeEasing: RtEasingJson };

type RtSecondsJson = { readonly delay: number; readonly duration: number; readonly iterations: number | 'Infinity'; readonly direction: string; readonly fill: string; readonly easing: RtEasingJson };
type RtRuleJson = readonly { readonly offset: number; readonly easing: RtEasingJson | null; readonly value: { readonly v: RtValueJson } | null }[];
type RtStepsJson = readonly (readonly [string, number])[];
type RtKeyframeCaseJson = { readonly range: string; readonly underlying: { readonly v: RtValueJson }; readonly rule: RtRuleJson; readonly timing: RtSecondsJson };
type RtTransitionCaseJson = { readonly range: string; readonly states: readonly { readonly value: { readonly v: RtValueJson }; readonly listing: { readonly mode: string; readonly delay: number; readonly duration: number; readonly easing: RtEasingJson } }[]; readonly steps: RtStepsJson };
type RtAnimationCaseJson = { readonly range: string; readonly rules: readonly { readonly name: string; readonly rule: RtRuleJson }[]; readonly states: readonly { readonly base: { readonly v: RtValueJson }; readonly entries: readonly { readonly name: string; readonly paused: boolean; readonly timing: RtSecondsJson }[] }[]; readonly steps: RtStepsJson };

const rtRead = <T>(name: string): T => JSON.parse(readFileSync(join(RT_VECTORS_DIR, name), 'utf8')) as T;
/** The input a record's index names; an index outside the file's inputs is a corrupt vector file, never a skipped record. */
function rtAt<T>(list: readonly T[], i: number, file: string): T {
  const v = Number.isInteger(i) ? list[i] : undefined;
  if (v === undefined) throw new Error(`rt vectors ${file}: record index ${String(i)} is outside its ${list.length} inputs`);
  return v;
}
const rtEasingLine = (e: RtEasingJson): unknown[] => [e.kind, bitsHex(e.x1), bitsHex(e.y1), bitsHex(e.x2), bitsHex(e.y2), bitsHex(e.steps), e.position];
const rtComboLine = (c: RtComboJson): unknown[] => [
  bitsHex(c.delayMs), bitsHex(c.endDelayMs), bitsHex(c.durationMs), bitsHex(c.iterations === 'Infinity' ? Number.POSITIVE_INFINITY : c.iterations), bitsHex(c.iterationStart), c.direction, c.fill, rtEasingLine(c.easing),
];
const rtLengthLine = (l: RtLengthJson): unknown[] => [l.kind, bitsHex(l.px), bitsHex(l.percent)];
const rtValueLine = (v: RtValueJson): unknown[] => [
  v.kind, bitsHex(v.number), rtLengthLine(v.length), [bitsHex(v.color.r), bitsHex(v.color.g), bitsHex(v.color.b), bitsHex(v.color.alpha)],
  v.ops.map((o) => [o.fn, rtLengthLine(o.x), rtLengthLine(o.y), bitsHex(o.angle), bitsHex(o.sx), bitsHex(o.sy)]),
];

const rtSecondsLine = (t: RtSecondsJson): unknown[] => [bitsHex(t.delay), bitsHex(t.duration), bitsHex(t.iterations === 'Infinity' ? Number.POSITIVE_INFINITY : t.iterations), t.direction, t.fill, rtEasingLine(t.easing)];
const rtRuleLine = (r: RtRuleJson): unknown[] => r.map((k) => [bitsHex(k.offset), k.easing === null ? null : rtEasingLine(k.easing), k.value === null ? null : rtValueLine(k.value.v)]);
const rtStepsLine = (s: RtStepsJson): unknown[] => s.map(([k, n]) => [k, bitsHex(n)]);

/**
 * The rt suite: one library-mode line per rt vector record, in file order: timing.json, easing.json, hold.json, then interp.json.
 * Every number is its bit pattern. The expected results are the translated harness in TypeScript; rt-vectors.test.ts in this
 * package proves they are the vectors' records.
 */
export function rtCases(read: <T>(name: string) => T = rtRead): string[] {
  const out: string[] = [];
  const timing = read<{ combos: RtComboJson[]; records: [number, number, string | null, string | null][] }>('timing.json');
  for (const [i, t] of timing.records) out.push(JSON.stringify(['rt-timing', rtComboLine(rtAt(timing.combos, i, 'timing.json')), bitsHex(t)]));
  const easing = read<{ easings: { spec: RtEasingJson }[]; records: [number, number, string | null][] }>('easing.json');
  for (const [i, t] of easing.records) out.push(JSON.stringify(['rt-easing', rtEasingLine(rtAt(easing.easings, i, 'easing.json').spec), bitsHex(t)]));
  const hold = read<{ elapsedSeconds: number; combos: RtComboJson[]; records: [number, number, string | null, string | null][] }>('hold.json');
  for (const [i, t] of hold.records) out.push(JSON.stringify(['rt-hold', rtComboLine(rtAt(hold.combos, i, 'hold.json')), bitsHex(t), bitsHex(hold.elapsedSeconds)]));
  const interp = read<{ box: { width: number; height: number }; cases: RtCaseJson[]; records: [number, number, string | null, string][] }>('interp.json');
  for (const [i, t] of interp.records) {
    const c = rtAt(interp.cases, i, 'interp.json');
    out.push(JSON.stringify(['rt-interp', rtValueLine(c.from), rtValueLine(c.to), rtEasingLine(c.effectEasing), rtEasingLine(c.keyframeEasing), bitsHex(t), bitsHex(interp.box.width), bitsHex(interp.box.height)]));
  }
  // ANIM-b (T065): advance.json, keyframes.json, transitions.json, then animations.json; serialisation uses the keyframes box.
  const advance = read<{ sequences: number[][]; records: [number, unknown][] }>('advance.json');
  for (const [i] of advance.records) out.push(JSON.stringify(['rt-advance', rtAt(advance.sequences, i, 'advance.json').map(bitsHex)]));
  const keyframes = read<{ box: { width: number; height: number }; cases: RtKeyframeCaseJson[]; records: [number, number, string | null, string][] }>('keyframes.json');
  const box = [bitsHex(keyframes.box.width), bitsHex(keyframes.box.height)];
  for (const [i, t] of keyframes.records) {
    const c = rtAt(keyframes.cases, i, 'keyframes.json');
    out.push(JSON.stringify(['rt-keyframes', c.range, rtValueLine(c.underlying.v), rtRuleLine(c.rule), rtSecondsLine(c.timing), bitsHex(t), ...box]));
  }
  const transitions = read<{ cases: RtTransitionCaseJson[]; records: [number, unknown][] }>('transitions.json');
  for (const [i] of transitions.records) {
    const c = rtAt(transitions.cases, i, 'transitions.json');
    const states = c.states.map((s) => [rtValueLine(s.value.v), [s.listing.mode, bitsHex(s.listing.delay), bitsHex(s.listing.duration), rtEasingLine(s.listing.easing)]]);
    out.push(JSON.stringify(['rt-transitions', c.range, states, rtStepsLine(c.steps), ...box]));
  }
  const animations = read<{ cases: RtAnimationCaseJson[]; records: [number, unknown][] }>('animations.json');
  for (const [i] of animations.records) {
    const c = rtAt(animations.cases, i, 'animations.json');
    const names = c.rules.map((r) => r.name);
    const states = c.states.map((s) => [rtValueLine(s.base.v), s.entries.map((e) => [e.name, names.includes(e.name), e.paused, rtSecondsLine(e.timing)])]);
    out.push(JSON.stringify(['rt-animations', c.range, c.rules.map((r) => [r.name, rtRuleLine(r.rule)]), states, rtStepsLine(c.steps), ...box]));
  }
  return out;
}

// ---------------------------------------------------------------- hit suite (SELD-R1b, T047 RT-9)

/** The hit facts of every layout case (packages/parity parity:hit-capture -- --vectors), keyed by case id. */
export const HIT_FACTS = join(RT_VECTORS_DIR, 'hit/facts.json');

/**
 * The hit suite: one library-mode line per layout vector, top-level and at every DPR, in directory then file-name order: the
 * vector's input and its case's hit facts. The TypeScript harness's answers are the expected results; Swift and Kotlin must equal
 * them, and packages/parity hit-report proves the TypeScript hit test equals Chrome at DPR 1.
 */
/** Throws unless every refused hit case carries a written reason and has no facts. */
export function checkHitRefusals(facts: Record<string, unknown>, refused: Record<string, unknown>): void {
  for (const [id, why] of Object.entries(refused)) if (typeof why !== 'string' || why === '' || facts[id] !== undefined) throw new Error(`hit facts: refused case ${id} needs a reason and no facts`);
}

export function hitCases(): string[] {
  const file = JSON.parse(readFileSync(HIT_FACTS, 'utf8')) as { cases: Record<string, unknown>; refused?: Record<string, unknown> };
  const facts = file.cases;
  // A case the hit lane refuses by name (parity hit-capture.ts hitRefusal) has no hit line; it must carry a written reason.
  const refused = file.refused ?? {};
  checkHitRefusals(facts, refused);
  const out: string[] = [];
  for (const dir of ['', 'dpr-2', 'dpr-3', 'dpr-2.625']) {
    const at = dir === '' ? VECTORS_DIR : join(VECTORS_DIR, dir);
    for (const file of readdirSync(at).filter((f) => f.endsWith('.json')).sort()) {
      const id = file.slice(0, -'.json'.length);
      if (refused[id] !== undefined) continue;
      const f = facts[id];
      if (f === undefined) throw new Error(`no hit facts for vector ${dir === '' ? '' : `${dir}/`}${file}; run pnpm run parity:hit-capture -- --vectors`);
      const v = JSON.parse(readFileSync(join(at, file), 'utf8')) as { platform: string; input: unknown };
      out.push(JSON.stringify(['rt-hit', v.platform, v.input, f]));
    }
  }
  if (out.length === 0) throw new Error('the hit suite has no cases');
  return out;
}

/** The hit suite's expected results; a line the TypeScript reference threw on or refused fails the build, not the natives. */
export function hitExpected(lines: readonly string[]): string[] {
  return lines.map((line, i) => {
    const r = runLibraryCase(line);
    if (!r.startsWith('["ok",')) throw new Error(`hit case ${i}: the TypeScript reference answered ${r.slice(0, 200)}, not a result`);
    return r;
  });
}

// ---------------------------------------------------------------- animator suite (ANIM-b1 3b, T065 R16)

/** The frame cases as animator scripts (packages/parity parity:anim-vectors). */
export const ANIMATOR_VECTORS = join(RT_VECTORS_DIR, 'animator/cases.json');

/**
 * The animator suite: one library-mode line per frame case: its tables, every assignment's resolved engine input, its initial
 * assignment and its script. The TypeScript harness's answers are the expected results; Swift and Kotlin must equal them, and
 * packages/parity anim-report proves the TypeScript animator equals Chrome at every sample.
 */
export function animatorCases(): string[] {
  const v = JSON.parse(readFileSync(ANIMATOR_VECTORS, 'utf8')) as { schema: string; cases: { tables: unknown; inputs: unknown; initial: number; steps: unknown }[] };
  if (v.schema !== 'dragon-animator-vectors/1') throw new Error(`${ANIMATOR_VECTORS}: schema ${v.schema}; run pnpm run parity:anim-vectors`);
  const out = v.cases.map((c) => JSON.stringify(['rt-animator', c.tables, c.inputs, c.initial, c.steps]));
  if (out.length === 0) throw new Error('the animator suite has no cases');
  return out;
}

/** The animator suite's expected results; a line the TypeScript reference threw on or refused fails the build, not the natives. */
export function animatorExpected(lines: readonly string[]): string[] {
  return lines.map((line, i) => {
    const r = runLibraryCase(line);
    if (!r.startsWith('["ok",')) throw new Error(`animator case ${i}: the TypeScript reference answered ${r.slice(0, 200)}, not a result`);
    return r;
  });
}

// ---------------------------------------------------------------- band suite (MQ-R1, T067 R4)

/** Every media fixture's band table at root sizes around its thresholds (packages/parity parity:band-vectors). */
export const BAND_VECTORS = join(RT_VECTORS_DIR, 'band/cases.json');

/**
 * The band suite: one library-mode line per band table: its atoms and bands, and root sizes in whole device px at a DPR. The
 * TypeScript harness's answers (media width, height and band) are the expected results; Swift and Kotlin must equal them, and
 * packages/parity media-runtime.test.ts proves the TypeScript lookup equals MQ-R0's partition, which equals Chrome.
 */
export function bandCases(): string[] {
  const v = JSON.parse(readFileSync(BAND_VECTORS, 'utf8')) as { schema: string; cases: { table: unknown; sizes: unknown }[] };
  if (v.schema !== 'dragon-band-vectors/2') throw new Error(`${BAND_VECTORS}: schema ${v.schema}; run pnpm run parity:band-vectors`);
  const out = v.cases.map((c) => JSON.stringify(['rt-band', c.table, c.sizes]));
  if (out.length === 0) throw new Error('the band suite has no cases');
  return out;
}

/** The band suite's expected results; a line the TypeScript reference threw on or refused fails the build, not the natives. */
export function bandExpected(lines: readonly string[]): string[] {
  return lines.map((line, i) => {
    const r = runLibraryCase(line);
    if (!r.startsWith('["ok",')) throw new Error(`band case ${i}: the TypeScript reference answered ${r.slice(0, 200)}, not a result`);
    return r;
  });
}

// ---------------------------------------------------------------- pointer suite (MQ-R2, T067 R9)

/** Input devices' sources and the readings Chromium's own Java rule gives them (packages/parity parity:pointer-vectors). */
export const POINTER_VECTORS = join(RT_VECTORS_DIR, 'pointer/cases.json');

/**
 * The pointer suite: one library-mode line per set of input devices, each device its InputDevice.getSources(). The TypeScript
 * harness's answers are the expected results; Swift and Kotlin must equal them, and packages/parity pointer-vectors.test.ts proves
 * the TypeScript port equals the answers of Chromium's Java rule (TouchDevice.availablePointerAndHoverTypes) recorded beside them.
 */
export function pointerCases(): string[] {
  const v = JSON.parse(readFileSync(POINTER_VECTORS, 'utf8')) as { schema: string; cases: { sources: readonly string[] }[] };
  if (v.schema !== 'dragon-pointer-vectors/1') throw new Error(`${POINTER_VECTORS}: schema ${v.schema}; run pnpm run parity:pointer-vectors`);
  const out = v.cases.map((c) => JSON.stringify(['rt-pointer', c.sources]));
  if (out.length === 0) throw new Error('the pointer suite has no cases');
  return out;
}

export function buildCorpus(): Corpus {
  const vectors = vectorCases();
  const vLines = vectors.map((v) => v.line);
  const units = unitsCases();
  const engine = engineCases(vectors);
  const library = libraryCases();
  const rt = rtCases();
  const hit = hitCases();
  const animator = animatorCases();
  const band = bandCases();
  const pointer = pointerCases();
  const suites: Suite[] = [
    { name: 'vectors', mode: 'engine', lines: vLines, expected: vLines.map(runEngineCase) },
    { name: 'units', mode: 'units', lines: units, expected: units.map(runUnitsCase) },
    { name: 'engine', mode: 'engine', lines: engine.lines, expected: engine.lines.map(runEngineCase) },
    { name: 'library', mode: 'library', lines: library, expected: library.map(runLibraryCase) },
    // ANIM-a2: the rt vectors (timing, easing, hold and interpolation), after the P1 suites.
    { name: 'rt', mode: 'library', lines: rt, expected: rt.map(runLibraryCase) },
    // SELD-R1b: the hit table, grid and answers of every layout vector, after rt.
    { name: 'hit', mode: 'library', lines: hit, expected: hitExpected(hit) },
    // ANIM-b1 3b: the runtime animator over every frame case's tables and script, after hit.
    { name: 'animator', mode: 'library', lines: animator, expected: animatorExpected(animator) },
    // MQ-R1: the @media band lookup over every media fixture's band table, after animator.
    { name: 'band', mode: 'library', lines: band, expected: bandExpected(band) },
    // MQ-R2: the Android pointer and hover readings over every source combination, after band.
    { name: 'pointer', mode: 'library', lines: pointer, expected: bandExpected(pointer) },
  ];
  const d = digestsOf(suites);
  return { suites, vectors, engineSplit: split(suites[2]?.expected ?? []), digest: d.digest, digests: d.digests };
}
