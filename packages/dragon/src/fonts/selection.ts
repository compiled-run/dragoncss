// A port of Blink's font selection at Chromium 145.0.7632.6: FontSelectionValue and friends (platform/fonts/font_selection_types.h),
// FontSelectionAlgorithm (platform/fonts/font_selection_algorithm.cc), the capabilities of an @font-face rule
// (core/css/font_face.cc GetFontSelectionCapabilities), and the part of FontFaceCache / CSSSegmentedFontFace above fallback.
import type { FontFaceDescriptors, DeclaredFace, StretchKeyword } from './font-face.ts';
import { NO_FONT_FAULTS } from './faults.ts';
import type { FontFaults } from './faults.ts';
import { capabilitiesHash, hashTableOrder } from './wtf-hash.ts';

/** font_selection_types.h FontSelectionValue: an int16 backing in quarter units (fractionalEntropy 4). */
export type FontSelectionValue = { readonly raw: number };

/** font_selection_types.h: ClampTo<int16_t>(x * fractionalEntropy), truncating toward zero; NaN clamps to 0. */
export function fsv(x: number): FontSelectionValue {
  const v = x * 4;
  if (Number.isNaN(v)) return { raw: 0 };
  return { raw: Math.max(-32768, Math.min(32767, Math.trunc(v))) };
}

/** font_selection_types.h operator- on the int16 backing: the int result is narrowed back to int16. */
const sub = (a: FontSelectionValue, b: FontSelectionValue): FontSelectionValue => ({ raw: ((a.raw - b.raw) << 16) >> 16 });
const neg = (a: FontSelectionValue): FontSelectionValue => ({ raw: (-a.raw << 16) >> 16 });
const lt = (a: FontSelectionValue, b: FontSelectionValue): boolean => a.raw < b.raw;
const gt = (a: FontSelectionValue, b: FontSelectionValue): boolean => a.raw > b.raw;
const le = (a: FontSelectionValue, b: FontSelectionValue): boolean => a.raw <= b.raw;
const ge = (a: FontSelectionValue, b: FontSelectionValue): boolean => a.raw >= b.raw;
const max = (a: FontSelectionValue, b: FontSelectionValue): FontSelectionValue => (lt(a, b) ? b : a);
const min = (a: FontSelectionValue, b: FontSelectionValue): FontSelectionValue => (lt(b, a) ? b : a);
const ZERO: FontSelectionValue = { raw: 0 };

// font_selection_types.h constants.
export const kItalicThreshold = fsv(14);
export const kItalicSlopeValue = fsv(14);
export const kNormalSlopeValue = ZERO;
export const kNormalWeightValue = fsv(400);
export const kBoldWeightValue = fsv(700);
export const kBoldThreshold = fsv(600);
export const kUpperWeightSearchThreshold = fsv(500);
export const kLowerWeightSearchThreshold = fsv(400);
export const kNormalWidthValue = fsv(100);
/** font_selection_types.h width keywords (kUltraCondensedWidthValue .. kUltraExpandedWidthValue). */
export const WIDTH_KEYWORD_VALUES: { readonly [K in StretchKeyword]: FontSelectionValue } = {
  'ultra-condensed': fsv(50),
  'extra-condensed': fsv(Math.fround(62.5)),
  condensed: fsv(75),
  'semi-condensed': fsv(Math.fround(87.5)),
  normal: fsv(100),
  'semi-expanded': fsv(Math.fround(112.5)),
  expanded: fsv(125),
  'extra-expanded': fsv(150),
  'ultra-expanded': fsv(200),
};

/** font_selection_types.h FontSelectionRange. */
export type FontSelectionRange = { readonly minimum: FontSelectionValue; readonly maximum: FontSelectionValue };
const range = (a: FontSelectionValue, b: FontSelectionValue = a): FontSelectionRange => ({ minimum: a, maximum: b });
const includes = (r: FontSelectionRange, v: FontSelectionValue): boolean => ge(v, r.minimum) && le(v, r.maximum);
const isValid = (r: FontSelectionRange): boolean => le(r.minimum, r.maximum);
/** font_selection_types.h FontSelectionRange::UniqueValue: minimum << 16 | maximum on sign-extended ints. */
const uniqueValue = (r: FontSelectionRange): number => ((r.minimum.raw << 16) | r.maximum.raw) >>> 0;

/** font_selection_types.h FontSelectionCapabilities. */
export type FontSelectionCapabilities = { readonly width: FontSelectionRange; readonly slope: FontSelectionRange; readonly weight: FontSelectionRange };
export type FontSelectionRequest = { readonly weight: FontSelectionValue; readonly width: FontSelectionValue; readonly slope: FontSelectionValue };

export type UnicodeRange = { readonly start: number; readonly end: number };

/** font_selection_types.h FontSelectionRange::Expand. */
function expand(a: FontSelectionRange, b: FontSelectionRange): FontSelectionRange {
  if (!isValid(a)) return b;
  return { minimum: min(a.minimum, b.minimum), maximum: max(a.maximum, b.maximum) };
}

type Distance = FontSelectionValue;

/** font_selection_algorithm.cc FontSelectionAlgorithm, with its request and the bounds of all the family's faces. */
export class FontSelectionAlgorithm {
  private readonly request: FontSelectionRequest;
  private readonly bounds: FontSelectionCapabilities;
  private readonly faults: FontFaults;
  constructor(request: FontSelectionRequest, bounds: FontSelectionCapabilities, faults: FontFaults = NO_FONT_FAULTS) {
    this.request = request;
    this.bounds = bounds;
    this.faults = faults;
  }

  /** font_selection_algorithm.cc StretchDistance. */
  stretchDistance(c: FontSelectionCapabilities): Distance {
    const width = c.width;
    const req = this.request.width;
    if (includes(width, req)) return ZERO;
    if (gt(req, kNormalWidthValue)) {
      if (gt(width.minimum, req)) return sub(width.minimum, req);
      const threshold = max(req, this.bounds.width.maximum);
      return sub(threshold, width.maximum);
    }
    if (lt(width.maximum, req)) return sub(req, width.maximum);
    const threshold = min(req, this.bounds.width.minimum);
    return sub(width.minimum, threshold);
  }

  /** font_selection_algorithm.cc StyleDistance. */
  styleDistance(c: FontSelectionCapabilities): Distance {
    const slope = c.slope;
    // Fault obliqueAsItalic: every oblique request is treated as the italic slope.
    const req = this.faults.obliqueAsItalic && this.request.slope.raw !== 0 ? kItalicSlopeValue : this.request.slope;
    if (includes(slope, req)) return ZERO;
    if (ge(req, kItalicThreshold)) {
      if (gt(slope.minimum, req)) return sub(slope.minimum, req);
      const threshold = max(req, this.bounds.slope.maximum);
      return sub(threshold, slope.maximum);
    }
    if (ge(req, ZERO)) {
      if (ge(slope.maximum, ZERO) && lt(slope.maximum, req)) return sub(req, slope.maximum);
      if (gt(slope.minimum, req)) return slope.minimum;
      const threshold = max(req, this.bounds.slope.maximum);
      return sub(threshold, slope.maximum);
    }
    if (gt(req, neg(kItalicThreshold))) {
      if (gt(slope.minimum, req) && le(slope.minimum, ZERO)) return sub(slope.minimum, req);
      if (lt(slope.maximum, req)) return neg(slope.maximum);
      const threshold = min(req, this.bounds.slope.minimum);
      return sub(slope.minimum, threshold);
    }
    if (lt(slope.maximum, req)) return sub(req, slope.maximum);
    const threshold = min(req, this.bounds.slope.minimum);
    return sub(slope.minimum, threshold);
  }

  /** font_selection_algorithm.cc WeightDistance, with the 400 to 500 search band. */
  weightDistance(c: FontSelectionCapabilities): Distance {
    const weight = c.weight;
    const req = this.request.weight;
    if (includes(weight, req)) return ZERO;
    // Fault weightBandUpwardFirst: a request in the 400 to 500 band searches upward without the 500 limit, as above 500.
    if (ge(req, kLowerWeightSearchThreshold) && le(req, kUpperWeightSearchThreshold) && !this.faults.weightBandUpwardFirst) {
      if (gt(weight.minimum, req) && le(weight.minimum, kUpperWeightSearchThreshold)) return sub(weight.minimum, req);
      if (lt(weight.maximum, req)) return sub(kUpperWeightSearchThreshold, weight.maximum);
      const threshold = min(req, this.bounds.weight.minimum);
      return sub(weight.minimum, threshold);
    }
    if (lt(req, kLowerWeightSearchThreshold)) {
      if (lt(weight.maximum, req)) return sub(req, weight.maximum);
      const threshold = min(req, this.bounds.weight.minimum);
      return sub(weight.minimum, threshold);
    }
    if (gt(weight.minimum, req)) return sub(weight.minimum, req);
    const threshold = max(req, this.bounds.weight.maximum);
    return sub(threshold, weight.maximum);
  }

  /** font_selection_algorithm.cc IsBetterMatchForRequest: stretch, then style, then weight. */
  isBetterMatch(first: FontSelectionCapabilities, second: FontSelectionCapabilities): boolean {
    const order: ((c: FontSelectionCapabilities) => Distance)[] = this.faults.weightBeforeStretch
      ? [(c) => this.weightDistance(c), (c) => this.styleDistance(c), (c) => this.stretchDistance(c)]
      : [(c) => this.stretchDistance(c), (c) => this.styleDistance(c), (c) => this.weightDistance(c)];
    for (let i = 0; i < 3; i++) {
      const f = order[i] as (c: FontSelectionCapabilities) => Distance;
      const a = f(first);
      const b = f(second);
      if (lt(a, b)) return true;
      if (i < 2 && gt(a, b)) return false;
    }
    return false;
  }
}

const DEG_PER: { readonly [unit: string]: number } = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };

/** core/css/font_face.cc FontFace::GetFontSelectionCapabilities, from the declared descriptors. */
export function capabilitiesOf(d: FontFaceDescriptors): FontSelectionCapabilities {
  const normal: FontSelectionCapabilities = { width: range(kNormalWidthValue), slope: range(kNormalSlopeValue), weight: range(kNormalWeightValue) };
  let width = normal.width;
  let slope = normal.slope;
  let weight = normal.weight;
  const ordered = (a: number, b: number): FontSelectionRange => (a < b ? range(fsv(a), fsv(b)) : range(fsv(b), fsv(a)));
  if (d.stretch !== undefined) {
    if (d.stretch.kind === 'keyword') width = d.stretch.value === 'auto' ? range(kNormalWidthValue) : range(WIDTH_KEYWORD_VALUES[d.stretch.value]);
    else if (d.stretch.values.length === 2) width = ordered(d.stretch.values[0] as number, d.stretch.values[1] as number);
    else width = range(fsv(Math.fround(d.stretch.values[0] as number)));
  }
  if (d.style !== undefined) {
    const s = d.style;
    if (s.kind === 'normal' || s.kind === 'auto') slope = range(kNormalSlopeValue);
    else if (s.kind === 'italic' || s.kind === 'oblique') slope = range(kItalicSlopeValue);
    else if (s.kind === 'oblique-angles') {
      const deg = s.angles.map((a) => a.value * (DEG_PER[a.unit] as number));
      slope = deg.length === 1 ? range(fsv(deg[0] as number)) : ordered(deg[0] as number, deg[1] as number);
    }
  }
  if (d.weight !== undefined) {
    const w = d.weight;
    if (w.kind === 'normal' || w.kind === 'auto') weight = range(kNormalWeightValue);
    else if (w.kind === 'bold') weight = range(kBoldWeightValue);
    else if (w.kind === 'numbers' && w.values.length === 2) {
      const [a, b] = w.values as [number, number];
      if (a < 1 || b > 1000) return normal;
      weight = ordered(a, b);
    } else if (w.kind === 'numbers') {
      const v = Math.fround(w.values[0] as number);
      if (v < 1 || v > 1000) return normal;
      weight = range(fsv(v));
    }
  }
  return { width, slope, weight };
}

/** The request for a computed font-weight, font-stretch percentage and font-style (FontDescription::GetFontSelectionRequest). */
export function selectionRequest(weight: number, stretchPercent: number, style: { readonly kind: 'normal' | 'italic' } | { readonly kind: 'oblique'; readonly degrees: number }): FontSelectionRequest {
  const slope = style.kind === 'oblique' ? fsv(Math.fround(style.degrees)) : style.kind === 'italic' ? kItalicSlopeValue : kNormalSlopeValue;
  return { weight: fsv(Math.fround(weight)), width: fsv(Math.fround(stretchPercent)), slope };
}

const sameCaps = (a: FontSelectionCapabilities, b: FontSelectionCapabilities): boolean =>
  (['width', 'slope', 'weight'] as const).every((k) => a[k].minimum.raw === b[k].minimum.raw && a[k].maximum.raw === b[k].maximum.raw);

let foldTable: Uint16Array | null = null;

/** BMP case pairs new in Unicode 17: Chrome 145's ICU is on Unicode 16 and leaves them unfolded (font-family-fold parity test). */
const UNICODE_17_CASE_PAIRS: ReadonlySet<number> = new Set([0xa7ce, 0xa7cf, 0xa7d2, 0xa7d3, 0xa7d4, 0xa7d5]);

/** Each BMP code unit's ICU simple default case-folding class (CaseFolding.txt C+S, as /iu matches), keyed by its smallest member. */
function simpleFoldTable(): Uint16Array {
  if (foldTable !== null) return foldTable;
  const root = new Uint16Array(0x10000).map((_, i) => i);
  const find = (c: number): number => {
    let r = c;
    while (root[r] !== r) r = root[r] as number;
    return r;
  };
  for (let c = 0; c < 0x10000; c++) {
    if ((c >= 0xd800 && c <= 0xdfff) || UNICODE_17_CASE_PAIRS.has(c)) continue;
    const ch = String.fromCharCode(c);
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    if (lower === ch && upper === ch) continue;
    const same = new RegExp(`^\\u${c.toString(16).padStart(4, '0')}$`, 'iu');
    for (const m of [lower, upper, upper.toLowerCase(), lower.toUpperCase()]) {
      if (m.length !== 1 || m === ch || !same.test(m)) continue;
      const a = find(c);
      const b = find(m.charCodeAt(0));
      if (a !== b) root[Math.max(a, b)] = Math.min(a, b);
    }
  }
  for (let c = 0; c < 0x10000; c++) root[c] = find(c);
  foldTable = root;
  return root;
}

/**
 * FontFaceCache keys families with CaseFoldingHashTraits (font_face_cache.h), compared by DeprecatedEqualIgnoringCaseAndNullity:
 * each UTF-16 code unit is simply case-folded (u_foldCase), so U+0131 stays and astral letters never fold (Chrome 145, probed).
 */
export function foldFamily(name: string): string {
  const table = simpleFoldTable();
  let out = '';
  for (let i = 0; i < name.length; i++) out += String.fromCharCode(table[name.charCodeAt(i)] as number);
  return out;
}

/** One CSSSegmentedFontFace: the faces of a family that share exact capabilities, in declaration order. */
export type SegmentedFace = { readonly capabilities: FontSelectionCapabilities; readonly faces: readonly DeclaredFace[] };

/**
 * font_face_cache.cc: faces grouped per family (case-folded key) and per exact capabilities, the groups in the
 * iteration order of Blink's HashMap. Faces within a group stay in declaration order (FontFaceList::Insert, one cascade layer).
 */
export function segmentedFaces(faces: readonly DeclaredFace[], family: string): SegmentedFace[] {
  const groups: { capabilities: FontSelectionCapabilities; faces: DeclaredFace[] }[] = [];
  const key = foldFamily(family);
  for (const f of [...faces].filter((x) => foldFamily(x.family) === key).sort((a, b) => a.order - b.order)) {
    const g = groups.find((x) => sameCaps(x.capabilities, f.capabilities));
    if (g === undefined) groups.push({ capabilities: f.capabilities, faces: [f] });
    else g.faces.push(f);
  }
  const hash = (g: SegmentedFace): number => capabilitiesHash([uniqueValue(g.capabilities.width), uniqueValue(g.capabilities.slope), uniqueValue(g.capabilities.weight)]);
  return hashTableOrder(groups, hash);
}

/** font_face_cache.cc FontSelectionQueryResult::GetOrCreate: the best group, the first in iteration order among equals. */
export function bestSegmentedFace(groups: readonly SegmentedFace[], request: FontSelectionRequest, faults: FontFaults = NO_FONT_FAULTS): SegmentedFace | null {
  if (groups.length === 0) return null;
  // A default FontSelectionCapabilities is {0, 0} on every axis (valid), so the bounds always include 0.
  let bounds: FontSelectionCapabilities = { width: range(ZERO), slope: range(ZERO), weight: range(ZERO) };
  for (const g of groups) bounds = { width: expand(bounds.width, g.capabilities.width), slope: expand(bounds.slope, g.capabilities.slope), weight: expand(bounds.weight, g.capabilities.weight) };
  const algorithm = new FontSelectionAlgorithm(request, bounds, faults);
  let best: SegmentedFace | null = null;
  for (const g of groups) if (best === null || algorithm.isBetterMatch(g.capabilities, best.capabilities)) best = g;
  return best;
}

/**
 * The ordered faces Chrome tries for a code point in a family: the best capability group's faces, later declarations first
 * (CSSSegmentedFontFace::GetFontData, ForEachReverse), filtered by unicode-range. Per-character fallback through missing glyphs
 * belongs to the engine (TXT1a).
 */
export function candidates(faces: readonly DeclaredFace[], family: string, request: FontSelectionRequest, codePoint: number, faults: FontFaults = NO_FONT_FAULTS): DeclaredFace[] {
  const best = bestSegmentedFace(segmentedFaces(faces, family), request, faults);
  if (best === null) return [];
  const ordered = faults.firstDeclaredWins ? [...best.faces] : [...best.faces].reverse();
  return faults.unicodeRangeIgnored ? ordered : ordered.filter((f) => f.ranges.some((r) => codePoint >= r.start && codePoint <= r.end));
}
