// The band partition (notes/T067 R4): the width and height atoms of a sheet split each axis into groups, and the orientation and
// aspect-ratio atoms add a ratio factor. A band is one reachable assignment of truth values to all atoms; its condition text is
// written only with the authored atoms and their negations.
import { compareMedia, comparisonsOf, evaluateFeature, evaluateWithOracle, MEDIA_EPSILON } from './evaluate.ts';
import type { MediaResult } from './evaluate.ts';
import type { MediaFaults } from './faults.ts';
import { NO_MEDIA_FAULTS } from './faults.ts';
import { INITIAL_FONT_SIZE, resolveLength } from './length.ts';
import { featuresOfList, serialiseFeature } from './parse.ts';
import type { Comparison, MediaFeature, MediaQueryList, MediaValue } from './parse.ts';

export const MAX_BANDS = 16;
/** The band count stops being counted past this many (the sheet is refused either way). */
const COUNT_LIMIT = 1024;

/** A width or height atom splits its axis; a ratio atom (orientation, aspect-ratio) reads both, as whole CSS px. */
export type MediaAtom = { readonly text: string; readonly axis: 'width' | 'height' | 'ratio'; readonly feature: MediaFeature };

export type Interval = {
  readonly lo: number;
  readonly loInclusive: boolean;
  readonly hi: number;
  readonly hiInclusive: boolean;
  /** The authored thresholds the ends come from (an end sits up to 1/64 px from its threshold). */
  readonly nominalLo: number;
  readonly nominalHi: number;
};

export type Band = {
  readonly index: number;
  /** One truth value per atom, in atom order. */
  readonly truth: readonly boolean[];
  readonly width: readonly Interval[];
  readonly height: readonly Interval[];
  readonly condition: string;
};

export type BandPartition =
  | { readonly kind: 'bands'; readonly atoms: readonly MediaAtom[]; readonly bands: readonly Band[] }
  | { readonly kind: 'refused'; readonly reason: 'too-many-bands' | 'refused-value'; readonly detail: string };

type Region = Interval & { readonly rep: number };
type Group = { readonly truth: readonly boolean[]; readonly intervals: Interval[] };

export function contains(i: Interval, v: number): boolean {
  return (v > i.lo || (i.loInclusive && v === i.lo)) && (v < i.hi || (i.hiInclusive && v === i.hi));
}

/** Whether a whole number lies in the interval. */
export function holdsWholePx(i: Interval): boolean {
  if (i.hi === Infinity) return true;
  for (let n = Math.ceil(i.lo); n <= Math.floor(i.hi); n++) if (contains(i, n)) return true;
  return false;
}

const bits = new DataView(new ArrayBuffer(8));
/** The adjacent double above (up) or below x. */
function step(x: number, up: boolean): number {
  if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
  bits.setFloat64(0, x);
  bits.setBigInt64(0, bits.getBigInt64(0) + ((x > 0) === up ? 1n : -1n));
  return bits.getFloat64(0);
}

/** The first double that holds going up from near c (first), or the last one that holds (not first); a few ulps from c. */
function flip(holds: (x: number) => boolean, c: number, first: boolean): number {
  let x = c;
  for (let k = 0; k < 64 && !holds(x); k++) x = step(x, first);
  for (let k = 0; k < 64 && holds(step(x, !first)); k++) x = step(x, !first);
  return x;
}

/** Where a width or height atom's truth changes, each with the authored threshold it comes from. */
function thresholds(f: MediaFeature, faults: MediaFaults): { readonly at: number; readonly nominal: number }[] {
  // A boolean (width) changes at 0.
  if (f.form === 'boolean') return [{ at: 0, nominal: 0 }];
  const eps = faults.mediaCompareExact ? 0 : MEDIA_EPSILON;
  return comparisonsOf(f, faults).flatMap(({ op, value }) => {
    const v = resolveLength((value as MediaValue & { kind: 'length' }).length, INITIAL_FONT_SIZE);
    if (v < 0) return [];
    const holds = (x: number): boolean => compareMedia(x, op, v, faults);
    const lower = (): number => flip(holds, v - eps, true);
    const upper = (): number => flip(holds, v + eps, false);
    const at = op === '<' || op === '>' ? [v] : op === '>=' ? [lower()] : op === '<=' ? [upper()] : [lower(), upper()];
    return at.map((p) => ({ at: p, nominal: v }));
  });
}

function axisGroups(atoms: readonly MediaAtom[], faults: MediaFaults): Group[] {
  const nominal = new Map<number, number>();
  for (const p of atoms.flatMap((a) => thresholds(a.feature, faults))) if (p.at >= 0 && !nominal.has(p.at)) nominal.set(p.at, p.nominal);
  const points = [...nominal.keys()].sort((a, b) => a - b);
  const regions: Region[] = [];
  let lo = 0;
  let loInclusive = true;
  let nominalLo = 0;
  for (const p of points) {
    const at = nominal.get(p) as number;
    // Two adjacent doubles leave no open region between them.
    if (p > lo && (loInclusive || step(lo, true) !== p)) regions.push({ lo, loInclusive, hi: p, hiInclusive: false, nominalLo, nominalHi: at, rep: (lo + p) / 2 });
    if (!faults.bandGapAtBoundary) regions.push({ lo: p, loInclusive: true, hi: p, hiInclusive: true, nominalLo: at, nominalHi: at, rep: p });
    lo = p;
    loInclusive = false;
    nominalLo = at;
  }
  regions.push({ lo, loInclusive, hi: Infinity, hiInclusive: false, nominalLo, nominalHi: Infinity, rep: lo + 1 });
  const groups: Group[] = [];
  for (const r of regions) {
    const truth = atoms.map((a) => evaluateFeature(a.feature, { width: r.rep, height: r.rep }, faults));
    const key = truth.join();
    const group = groups.find((g) => g.truth.join() === key);
    const interval: Interval = { lo: r.lo, loInclusive: r.loInclusive, hi: r.hi, hiInclusive: r.hiInclusive, nominalLo: r.nominalLo, nominalHi: r.nominalHi };
    if (group === undefined) {
      groups.push({ truth, intervals: [interval] });
      continue;
    }
    const last = group.intervals[group.intervals.length - 1] as Interval;
    if (last.hi === r.lo && (last.hiInclusive || r.loInclusive)) {
      group.intervals[group.intervals.length - 1] = { ...last, hi: r.hi, hiInclusive: r.hiInclusive, nominalHi: r.nominalHi };
    } else group.intervals.push(interval);
  }
  return groups;
}

// The ratio factor. Orientation and aspect-ratio read whole CSS px W and H, so each atom is a set of linear constraints on
// integers; a truth vector is dropped only when no integer (W, H) in the band's width and height groups satisfies it.

/** A W + b H <= k over integers W and H. */
type Lin = { readonly a: bigint; readonly b: bigint; readonly k: bigint };
/** Alternatives, each a conjunction. */
type Dnf = readonly (readonly Lin[])[];

const abs = (x: bigint): bigint => (x < 0n ? -x : x);
const gcd = (x: bigint, y: bigint): bigint => {
  let [p, q] = [abs(x), abs(y)];
  while (q !== 0n) [p, q] = [q, p % q];
  return p;
};
const floorDiv = (n: bigint, d: bigint): bigint => {
  const q = n / d;
  return (n % d !== 0n && (n < 0n) !== (d < 0n)) ? q - 1n : q;
};

/** A double as an exact fraction n / d. */
function fraction(x: number): { readonly n: bigint; readonly d: bigint } {
  if (!Number.isFinite(x)) throw new Error(`a media ratio term ${x} is not finite`);
  let d = 1n;
  while (!Number.isInteger(x)) {
    x *= 2;
    d *= 2n;
  }
  return { n: BigInt(x), d };
}

/** a W + b H + c <= 0 (or < 0 when strict), as the tightest integer constraint: integer LHS, divided by the gcd of a and b. */
function constraint(a: number, b: number, c: number, strict: boolean): Lin {
  const [fa, fb, fc] = [fraction(a), fraction(b), fraction(c)];
  const scale = fa.d * fb.d * fc.d;
  const [A, B] = [(fa.n * scale) / fa.d, (fb.n * scale) / fb.d];
  const C = (fc.n * scale) / fc.d;
  // A W + B H <= -C, or < -C, with an integer left side.
  return tighten(A, B, strict ? -C - 1n : -C);
}

function tighten(a: bigint, b: bigint, k: bigint): Lin {
  const g = gcd(a, b);
  return g === 0n ? { a, b, k } : { a: a / g, b: b / g, k: floorDiv(k, g) };
}

const NEVER: Lin = { a: 0n, b: 0n, k: -1n };

/** Whether some integer W and H satisfy every constraint: H is eliminated (Fourier-Motzkin, so this can only say yes too often). */
function feasible(cs: readonly Lin[]): boolean {
  const pos = cs.filter((c) => c.b > 0n);
  const neg = cs.filter((c) => c.b < 0n);
  const onW = cs.filter((c) => c.b === 0n);
  for (const p of pos) for (const n of neg) onW.push(tighten(p.a * -n.b + n.a * p.b, 0n, p.k * -n.b + n.k * p.b));
  let lo: bigint | null = null;
  let hi: bigint | null = null;
  for (const c of onW) {
    if (c.a === 0n) {
      if (c.k < 0n) return false;
    } else if (c.a > 0n) {
      const h = floorDiv(c.k, c.a);
      if (hi === null || h < hi) hi = h;
    } else {
      const l = -floorDiv(c.k, -c.a);
      if (lo === null || l > lo) lo = l;
    }
  }
  return lo === null || hi === null || lo <= hi;
}

/** The constraints of one comparison `W den op H num` (aspect-ratio, R2), holding or not. */
function ratioComparison(op: Comparison, num: number, den: number, holds: boolean, eps: number): Dnf {
  // x = W den - H num; each case is x (op) value as a W + b H + c (<|<=) 0.
  const le = (sign: 1 | -1, c: number, strict: boolean): Lin => constraint(sign * den, -sign * num, c, strict);
  switch (op) {
    case '>=':
      return holds ? [[le(-1, -eps, false)]] : [[le(1, eps, true)]];
    case '<=':
      return holds ? [[le(1, -eps, false)]] : [[le(-1, eps, true)]];
    case '<':
      return holds ? [[le(1, 0, true)]] : [[le(-1, 0, false)]];
    case '>':
      return holds ? [[le(-1, 0, true)]] : [[le(1, 0, false)]];
    case '=':
      return holds ? [[le(-1, -eps, false), le(1, -eps, false)]] : [[le(1, eps, true)], [le(-1, eps, true)]];
  }
}

/** The constraints of a ratio atom holding (all comparisons) or not (any one fails). */
function ratioAtom(f: MediaFeature, holds: boolean, faults: MediaFaults): Dnf {
  if (f.form === 'boolean') return holds ? [[]] : [[NEVER]];
  if (f.base === 'orientation') {
    const landscape = (f.value as MediaValue & { kind: 'ident' }).name === 'landscape';
    // Landscape is W > H, that is H - W <= -1; portrait is W - H <= 0.
    return landscape === holds ? [[{ a: -1n, b: 1n, k: -1n }]] : [[{ a: 1n, b: -1n, k: 0n }]];
  }
  const eps = faults.mediaCompareExact ? 0 : MEDIA_EPSILON;
  const each = comparisonsOf(f, faults).map(({ op, value }) => {
    const r = value as MediaValue & { kind: 'ratio' };
    return ratioComparison(op, r.num, r.den, holds, eps);
  });
  if (!holds) return each.flat();
  return each.reduce<Dnf>((acc, d) => acc.flatMap((x) => d.map((y) => [...x, ...y])), [[]]);
}

/** Beyond this many alternatives the ratio proof gives up and keeps every vector. */
const ALTERNATIVE_LIMIT = 256;

function extend(alternatives: Dnf | null, dnf: Dnf): Dnf | null {
  if (alternatives === null) return null;
  const out: Lin[][] = [];
  for (const a of alternatives) {
    for (const d of dnf) {
      const c = [...a, ...d];
      if (!feasible(c)) continue;
      out.push(c);
      if (out.length > ALTERNATIVE_LIMIT) return null;
    }
  }
  return out;
}

/** The whole CSS px a width or height interval truncates to: W >= lo and W <= hi (hi null when unbounded). */
function wholeRange(i: Interval): { readonly lo: bigint; readonly hi: bigint | null } | null {
  const lo = Math.floor(i.lo);
  if (i.hi === Infinity) return { lo: BigInt(lo), hi: null };
  const hi = i.hiInclusive ? Math.floor(i.hi) : Math.ceil(i.hi) - 1;
  return hi < lo ? null : { lo: BigInt(lo), hi: BigInt(hi) };
}

function domain(width: readonly Interval[], height: readonly Interval[]): Dnf {
  const bounds = (r: { lo: bigint; hi: bigint | null }, axis: 'a' | 'b'): Lin[] => {
    const unit = (s: bigint): { a: bigint; b: bigint } => (axis === 'a' ? { a: s, b: 0n } : { a: 0n, b: s });
    return [{ ...unit(-1n), k: -r.lo }, ...(r.hi === null ? [] : [{ ...unit(1n), k: r.hi }])];
  };
  const ws = width.map(wholeRange).filter((r) => r !== null);
  const hs = height.map(wholeRange).filter((r) => r !== null);
  return ws.flatMap((w) => hs.map((h) => [...bounds(w, 'a'), ...bounds(h, 'b')]));
}

/** The truth vectors of the ratio atoms not proven empty in a width group and a height group, true before false. */
function ratioVectors(atoms: readonly MediaAtom[], width: readonly Interval[], height: readonly Interval[], faults: MediaFaults): boolean[][] {
  const out: boolean[][] = [];
  // Untruncated (faulted) sizes are not whole px, so the integer proof would not hold; every vector is kept.
  const proof = atoms.length === 0 || faults.orientationUntruncated || faults.aspectRatioUntruncated ? null : domain(width, height);
  const visit = (k: number, truth: boolean[], alternatives: Dnf | null): void => {
    if (out.length >= COUNT_LIMIT || (alternatives !== null && alternatives.length === 0)) return;
    const atom = atoms[k];
    if (atom === undefined) {
      out.push(truth);
      return;
    }
    for (const holds of [true, false]) visit(k + 1, [...truth, holds], extend(alternatives, ratioAtom(atom.feature, holds, faults)));
  };
  visit(0, [], proof);
  return out;
}

/** Collects the width, height and ratio atoms of every list, deduplicated by their serialisation. */
export function mediaAtoms(lists: readonly MediaQueryList[]): MediaAtom[] | Extract<BandPartition, { kind: 'refused' }> {
  const atoms: MediaAtom[] = [];
  for (const f of lists.flatMap(featuresOfList)) {
    if (f.refused === 'environment') continue;
    const text = serialiseFeature(f);
    if (f.refused !== null) return { kind: 'refused', reason: 'refused-value', detail: text };
    const axis = f.base === 'width' || f.base === 'height' ? f.base : 'ratio';
    if (!atoms.some((a) => a.text === text)) atoms.push({ text, axis, feature: f });
  }
  return atoms;
}

/** Derives the ordered bands of a sheet's media query lists: by width, then by height, then by the ratio atoms' truths. */
export function band(lists: readonly MediaQueryList[], faults: MediaFaults = NO_MEDIA_FAULTS): BandPartition {
  const atoms = mediaAtoms(lists);
  if (!Array.isArray(atoms)) return atoms;
  const on = (axis: MediaAtom['axis']): MediaAtom[] => atoms.filter((a) => a.axis === axis);
  const [widthAtoms, heightAtoms, ratioAtoms] = [on('width'), on('height'), on('ratio')];
  const widthGroups = axisGroups(widthAtoms, faults);
  const heightGroups = axisGroups(heightAtoms, faults);
  const bands: Band[] = [];
  let count = 0;
  for (const wg of widthGroups) {
    for (const hg of heightGroups) {
      for (const ratio of ratioVectors(ratioAtoms, wg.intervals, hg.intervals, faults)) {
        if (++count > MAX_BANDS) continue;
        const truth = atoms.map((a) => (a.axis === 'width' ? wg.truth[widthAtoms.indexOf(a)] : a.axis === 'height' ? hg.truth[heightAtoms.indexOf(a)] : ratio[ratioAtoms.indexOf(a)]) as boolean);
        const condition = atoms.map((a, k) => (truth[k] ? a.text : `(not ${a.text})`)).join(' and ') || 'all';
        bands.push({ index: bands.length, truth, width: wg.intervals, height: hg.intervals, condition });
      }
      if (count >= COUNT_LIMIT) break;
    }
    if (count >= COUNT_LIMIT) break;
  }
  if (count > MAX_BANDS) {
    const n = count >= COUNT_LIMIT ? `at least ${COUNT_LIMIT}` : String(count);
    return { kind: 'refused', reason: 'too-many-bands', detail: `${n} bands, more than ${MAX_BANDS}` };
  }
  return { kind: 'bands', atoms, bands };
}

/**
 * The band that holds a viewport (CSS px, Chrome's media size): its width and height intervals hold the viewport and its ratio
 * truths equal the ratio atoms there. Null when none does (only a faulted partition leaves a gap).
 */
export function bandAt(
  partition: Extract<BandPartition, { kind: 'bands' }>,
  viewport: { readonly width: number; readonly height: number },
  faults: MediaFaults = NO_MEDIA_FAULTS,
): Band | null {
  const ratio = partition.atoms.map((a) => (a.axis === 'ratio' ? evaluateFeature(a.feature, viewport, faults) : null));
  return (
    partition.bands.find(
      (b) => b.width.some((i) => contains(i, viewport.width)) && b.height.some((i) => contains(i, viewport.height)) && ratio.every((r, k) => r === null || b.truth[k] === r),
    ) ?? null
  );
}

/** Evaluates a list in a band: every feature takes the band's truth value for its atom. */
export function evaluateInBand(list: MediaQueryList, partition: Extract<BandPartition, { kind: 'bands' }>, b: Band): MediaResult {
  return evaluateWithOracle(list, (f) => {
    const k = partition.atoms.findIndex((a) => a.text === serialiseFeature(f));
    if (k < 0) throw new Error(`${serialiseFeature(f)} is not an atom of the partition`);
    return b.truth[k] as boolean;
  });
}
