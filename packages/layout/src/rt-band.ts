// The @media band lookup a native root runs when its size changes (notes/T067-mq-r-spec.md R2, R3, R4). The compiler writes each
// media feature of the stylesheet as a typed atom and each band as the truth vector of all atoms; the device evaluates every atom
// on the root's media size and looks the vector up, and never sees CSS. The comparisons are Chrome 145's media query evaluator's
// (CompareDoubleValue, HandleNegativeMediaFeatureValue, OrientationMediaFeatureEval, AspectRatioMediaFeatureEval), implemented
// from the measurements M2 and M3 rather than from its code: >= and <= take 1/64 px of slack, = is within 1/64, < and > are exact,
// and orientation and aspect-ratio read the truncated size. The media size is the float Chrome derives from the root's whole
// device px (measured, M1, M4, M5).
import { froundOf, truncOf } from './rt-easing.ts';

/** LayoutUnit::Epsilon(): the slack of >=, <= and = in CompareDoubleValue. */
export const MEDIA_EPSILON = 1 / 64;

export type BandOp = 'lt' | 'le' | 'gt' | 'ge' | 'eq';

/** One comparison of an atom: the size (or the size ratio) against value px (or num/den), the size on the left. */
export type BandComparison = { readonly op: BandOp; readonly value: number; readonly num: number; readonly den: number };

export type BandFeature = 'width' | 'height' | 'orientation' | 'aspect-ratio';

/**
 * One media feature as the compiler wrote it. comparisons: every comparison must hold (a two-sided range has two); none is the
 * boolean form. keyword: orientation's value, 'none' for every other feature and for the boolean form.
 */
export type BandAtom = { readonly feature: BandFeature; readonly comparisons: readonly BandComparison[]; readonly keyword: 'portrait' | 'landscape' | 'none' };

/** The band table of a stylesheet: its atoms and, per band in band order, the truth value of every atom. */
export type BandTable = { readonly atoms: readonly BandAtom[]; readonly bands: readonly (readonly boolean[])[] };

/** Planted faults of the band lookup; a device or host lane must catch each one. */
export type BandFaults = {
  /** >= and <= compare strictly and = exactly, so a root exactly at a threshold takes the wrong band. */
  readonly bandBoundaryExclusive: boolean;
};

export const NO_BAND_FAULTS: BandFaults = { bandBoundaryExclusive: false };

export class BandError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`band lookup: ${detail}`);
    this.detail = detail;
  }
}

/** The media width or height of a root px whole device px wide at a device pixel ratio: fround(fround(px) * fround(1 / fround(dpr))). */
export function mediaSize(px: number, dpr: number): number {
  if (!(px >= 0) || px !== truncOf(px)) throw new BandError(`a root size must be whole device px, got ${px}`);
  if (!(dpr > 0) || dpr === 1 / 0) throw new BandError(`a device pixel ratio must be finite and positive, got ${dpr}`);
  return froundOf(froundOf(px) * froundOf(1 / froundOf(dpr)));
}

/** CompareDoubleValue: actual against a non-negative query with 1/64 slack on >=, <= and =; a negative query only holds for > and >=. */
export function compareMedia(actual: number, query: number, op: BandOp, faults: BandFaults): boolean {
  if (query < 0) return op === 'gt' || op === 'ge';
  const precision = faults.bandBoundaryExclusive ? 0 : MEDIA_EPSILON;
  if (op === 'ge') return faults.bandBoundaryExclusive ? actual > query : actual >= query - precision;
  if (op === 'le') return faults.bandBoundaryExclusive ? actual < query : actual <= query + precision;
  if (op === 'eq') {
    const d = actual - query;
    return (d < 0 ? -d : d) <= precision;
  }
  if (op === 'lt') return actual < query;
  return actual > query;
}

/** Whether one atom holds at a media size (CSS px, as mediaSize gives it). */
export function atomHolds(atom: BandAtom, width: number, height: number, faults: BandFaults): boolean {
  if (atom.feature === 'width' || atom.feature === 'height') {
    const actual = atom.feature === 'width' ? width : height;
    if (atom.comparisons.length === 0) return actual !== 0;
    for (const c of atom.comparisons) if (!compareMedia(actual, c.value, c.op, faults)) return false;
    return true;
  }
  // OrientationMediaFeatureEval and AspectRatioMediaFeatureEval take int width = *media_values.Width().
  const w = truncOf(width);
  const h = truncOf(height);
  if (atom.feature === 'orientation') {
    if (atom.keyword === 'none') return h >= 0 && w >= 0;
    // A square viewport is portrait.
    return w > h ? atom.keyword === 'landscape' : atom.keyword === 'portrait';
  }
  if (atom.comparisons.length === 0) return true;
  for (const c of atom.comparisons) if (!compareMedia(w * c.den, h * c.num, c.op, faults)) return false;
  return true;
}

/** The truth value of every atom at a media size, in atom order. */
export function truthVector(table: BandTable, width: number, height: number, faults: BandFaults): boolean[] {
  const out: boolean[] = [];
  for (const a of table.atoms) out.push(atomHolds(a, width, height, faults));
  return out;
}

/** The band whose truth vector equals the atoms' values at a media size; a vector no band has is an error, never a guess. */
export function bandIndex(table: BandTable, width: number, height: number, faults: BandFaults): number {
  const v = truthVector(table, width, height, faults);
  for (let k = 0; k < table.bands.length; k++) {
    const b = table.bands[k] as readonly boolean[];
    if (b.length !== v.length) throw new BandError(`band ${k} has ${b.length} truth values for ${v.length} atoms`);
    let same = true;
    for (let i = 0; i < v.length; i++) if ((b[i] as boolean) !== (v[i] as boolean)) same = false;
    if (same) return k;
  }
  let bits = '';
  for (const x of v) bits += x ? '1' : '0';
  throw new BandError(`no band has the truth vector ${bits} at ${width} x ${height} css px`);
}

/** The band of a root of whole device px at a device pixel ratio. */
export function bandAtPx(table: BandTable, widthPx: number, heightPx: number, dpr: number, faults: BandFaults): number {
  return bandIndex(table, mediaSize(widthPx, dpr), mediaSize(heightPx, dpr), faults);
}
