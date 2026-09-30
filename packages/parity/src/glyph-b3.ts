// The B3 buckets of device-pixels pixel failures (T093 ruling A and addendum; pnpm run parity:glyph-b3).
import type { LaneFailure } from './device-lanes.ts';
import type { GlyphBox, SamplePoint } from './samples.ts';
import { CLEAR_SUFFIX, GLYPH_EDGE_RULE, glyphClearance, SAMPLE_INSET_DEVICE_PX } from './samples.ts';

export const BUCKETS = ['glyph-position', 'glyph-ink-edge', 'dropped', 'fringe', 'clear'] as const;
export type Bucket = (typeof BUCKETS)[number];

/** A case at a DPR: its points now, the points of the run the failure list came from, and the engine's glyph boxes. */
export type B3Reference = { readonly points: readonly SamplePoint[]; readonly run: readonly SamplePoint[]; readonly glyphs: readonly GlyphBox[] };

/**
 * The bucket of one device-pixels pixel failure: glyph-position (the x centre or bottom edge check), glyph-ink-edge (a glyph-edge
 * scanline's edge position), fringe (a compared pixel within SAMPLE_INSET_DEVICE_PX of a glyph box edge), clear, or dropped (its
 * pixels are no longer compared; before is true for a list from a run before the clearance). restored: a dropped failure whose
 * pixel the F2 fallback keeps as "<rule>:clear", bucketed by its clearance. A failure that names no point of the run throws.
 */
export function b3Bucket(f: LaneFailure, ref: B3Reference, before: boolean): { readonly bucket: Bucket; readonly restored: boolean } {
  const node = f.node;
  if (node === null) throw new Error(`${f.case}@${f.dpr}: a device-pixels pixel failure names no sample rule: ${f.detail}`);
  if (/^(centre|bottom):/.test(node)) return { bucket: 'glyph-position', restored: false };
  const at = / at (\d+),(\d+):/.exec(f.detail);
  const atPixel = (p: SamplePoint): boolean => at === null || (p.x === Number(at[1]) && p.y === Number(at[2]));
  // The pixels the check compares: a glyph-edge scanline Chrome shows no edge across is compared by colour at its two ends only.
  // A run before the clearance compared every pixel of such a scanline.
  const comparedOf = (ps: readonly SamplePoint[], endsOnly: boolean): SamplePoint[] => {
    const line = ps.filter((p) => p.rule === node);
    const ends = endsOnly && GLYPH_EDGE_RULE.test(node) && at !== null ? [line[0], line[line.length - 1]].filter((p): p is SamplePoint => p !== undefined) : line;
    return ends.filter(atPixel);
  };
  const clearance = (ps: readonly SamplePoint[]): Bucket => {
    if (ps.length === 0) throw new Error(`${f.case}@${f.dpr} ${node}: no compared pixel to bucket`);
    return Math.min(...ps.flatMap((p) => ref.glyphs.map((g) => glyphClearance(p.x, p.y, g)))) < SAMPLE_INSET_DEVICE_PX ? 'fringe' : 'clear';
  };
  const noPoint = (): Error => new Error(`${f.case}@${f.dpr} ${node}: the failure names no generated point${before ? '' : '; a list from before the glyph clearance needs --before-clearance'}`);
  if (node.endsWith(CLEAR_SUFFIX)) {
    const ps = ref.points.filter((p) => p.rule === node && atPixel(p));
    if (ps.length === 0) throw noPoint();
    return { bucket: clearance(ps), restored: false };
  }
  const failed = comparedOf(ref.run, !before);
  if (failed.length === 0) throw noPoint();
  const now = comparedOf(ref.points, true);
  const key = (ps: readonly SamplePoint[]): string => ps.map((p) => `${p.x},${p.y}`).join(';');
  if (key(failed) !== key(now)) {
    // In a list from before the clearance, a colour failure whose pixel the fallback now keeps as "<rule>:clear".
    const restoredAt = before && at !== null ? ref.points.filter((p) => p.rule === `${node}${CLEAR_SUFFIX}` && atPixel(p)) : [];
    return restoredAt.length > 0 ? { bucket: clearance(restoredAt), restored: true } : { bucket: 'dropped', restored: false };
  }
  if (at === null && GLYPH_EDGE_RULE.test(node)) return { bucket: 'glyph-ink-edge', restored: false };
  return { bucket: clearance(failed), restored: false };
}
