// The band partition: every width and height atom of a sheet splits the viewport into bands, each one assignment of truth
// values to all atoms. A band's condition text is written only with the authored atoms and their negations.
import { evaluateFeature, evaluateWithOracle } from './evaluate.ts';
import type { MediaResult } from './evaluate.ts';
import type { MediaFaults } from './faults.ts';
import { NO_MEDIA_FAULTS } from './faults.ts';
import { INITIAL_FONT_SIZE, resolveLength } from './length.ts';
import { featuresOfList, serialiseFeature } from './parse.ts';
import type { MediaFeature, MediaQueryList, MediaValue } from './parse.ts';

export const MAX_BANDS = 16;

export type MediaAtom = { readonly text: string; readonly axis: 'width' | 'height'; readonly feature: MediaFeature };

export type Interval = { readonly lo: number; readonly loInclusive: boolean; readonly hi: number; readonly hiInclusive: boolean };

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
  | { readonly kind: 'refused'; readonly reason: 'too-many-bands' | 'non-axis-feature' | 'refused-value'; readonly detail: string };

type Region = Interval & { readonly rep: number };
type Group = { readonly truth: readonly boolean[]; readonly intervals: Interval[] };

export function contains(i: Interval, v: number): boolean {
  return (v > i.lo || (i.loInclusive && v === i.lo)) && (v < i.hi || (i.hiInclusive && v === i.hi));
}

function thresholds(f: MediaFeature): number[] {
  const values: MediaValue[] = [f.value, f.left?.value, f.right?.value].filter((v): v is MediaValue => v !== null && v !== undefined);
  const out = values.map((v) => resolveLength((v as MediaValue & { kind: 'length' }).length, INITIAL_FONT_SIZE));
  // A boolean (width) changes at 0.
  return f.form === 'boolean' ? [0] : out;
}

function axisGroups(atoms: readonly MediaAtom[], faults: MediaFaults): Group[] {
  const points = [...new Set(atoms.flatMap((a) => thresholds(a.feature)))].filter((p) => p >= 0).sort((a, b) => a - b);
  const regions: Region[] = [];
  let lo = 0;
  let loInclusive = true;
  for (const p of points) {
    if (p > lo) regions.push({ lo, loInclusive, hi: p, hiInclusive: false, rep: (lo + p) / 2 });
    if (!faults.bandGapAtBoundary) regions.push({ lo: p, loInclusive: true, hi: p, hiInclusive: true, rep: p });
    lo = p;
    loInclusive = false;
  }
  regions.push({ lo, loInclusive, hi: Infinity, hiInclusive: false, rep: lo + 1 });
  const groups: Group[] = [];
  for (const r of regions) {
    const truth = atoms.map((a) => evaluateFeature(a.feature, { width: r.rep, height: r.rep }, faults));
    const key = truth.join();
    const group = groups.find((g) => g.truth.join() === key);
    const interval: Interval = { lo: r.lo, loInclusive: r.loInclusive, hi: r.hi, hiInclusive: r.hiInclusive };
    if (group === undefined) {
      groups.push({ truth, intervals: [interval] });
      continue;
    }
    const last = group.intervals[group.intervals.length - 1] as Interval;
    if (last.hi === r.lo && (last.hiInclusive || r.loInclusive)) {
      group.intervals[group.intervals.length - 1] = { lo: last.lo, loInclusive: last.loInclusive, hi: r.hi, hiInclusive: r.hiInclusive };
    } else group.intervals.push(interval);
  }
  return groups;
}

/** Collects the width and height atoms of every list, deduplicated by their serialisation. */
export function mediaAtoms(lists: readonly MediaQueryList[]): MediaAtom[] | Extract<BandPartition, { kind: 'refused' }> {
  const atoms: MediaAtom[] = [];
  for (const f of lists.flatMap(featuresOfList)) {
    if (f.refused === 'environment') continue;
    const text = serialiseFeature(f);
    if (f.base !== 'width' && f.base !== 'height') return { kind: 'refused', reason: 'non-axis-feature', detail: text };
    if (f.refused !== null) return { kind: 'refused', reason: 'refused-value', detail: text };
    if (!atoms.some((a) => a.text === text)) atoms.push({ text, axis: f.base, feature: f });
  }
  return atoms;
}

/** Derives the ordered bands of a sheet's media query lists: by width, then by height. */
export function band(lists: readonly MediaQueryList[], faults: MediaFaults = NO_MEDIA_FAULTS): BandPartition {
  const atoms = mediaAtoms(lists);
  if (!Array.isArray(atoms)) return atoms;
  const widthAtoms = atoms.filter((a) => a.axis === 'width');
  const heightAtoms = atoms.filter((a) => a.axis === 'height');
  const widthGroups = axisGroups(widthAtoms, faults);
  const heightGroups = axisGroups(heightAtoms, faults);
  const count = widthGroups.length * heightGroups.length;
  if (count > MAX_BANDS) return { kind: 'refused', reason: 'too-many-bands', detail: `${count} bands, more than ${MAX_BANDS}` };
  const bands: Band[] = [];
  for (const wg of widthGroups) {
    for (const hg of heightGroups) {
      const truth = atoms.map((a) => (a.axis === 'width' ? wg.truth[widthAtoms.indexOf(a)] : hg.truth[heightAtoms.indexOf(a)]) as boolean);
      const condition = atoms.map((a, k) => (truth[k] ? a.text : `(not ${a.text})`)).join(' and ') || 'all';
      bands.push({ index: bands.length, truth, width: wg.intervals, height: hg.intervals, condition });
    }
  }
  return { kind: 'bands', atoms, bands };
}

/** The band that holds a viewport, or null (only a faulted partition leaves a gap). */
export function bandAt(partition: Extract<BandPartition, { kind: 'bands' }>, viewport: { readonly width: number; readonly height: number }): Band | null {
  return (
    partition.bands.find((b) => b.width.some((i) => contains(i, viewport.width)) && b.height.some((i) => contains(i, viewport.height))) ?? null
  );
}

/** Evaluates a list in a band: every width and height feature takes the band's truth value for its atom. */
export function evaluateInBand(list: MediaQueryList, partition: Extract<BandPartition, { kind: 'bands' }>, b: Band): MediaResult {
  return evaluateWithOracle(list, (f) => {
    const k = partition.atoms.findIndex((a) => a.text === serialiseFeature(f));
    if (k < 0) throw new Error(`${serialiseFeature(f)} is not an atom of the partition`);
    return b.truth[k] as boolean;
  });
}
