// The B3 buckets (T093 ruling A): every device-pixels pixel failure lands in one bucket, and a failure the sampler cannot place
// throws instead of being counted as clear.
import { describe, expect, it } from 'vitest';
import type { LaneFailure } from '../src/device-lanes.ts';
import type { B3Reference } from '../src/glyph-b3.ts';
import { b3Bucket } from '../src/glyph-b3.ts';
import { CLEAR_SUFFIX } from '../src/samples.ts';

const f = (node: string | null, detail = 'x'): LaneFailure => ({ lane: 'device-pixels', case: 'c', dpr: 3, node, kind: 'pixel', detail });
const glyph = { left: 20, top: 20, right: 40, bottom: 40 };
const ref: B3Reference = {
  points: [{ x: 5, y: 5, rule: 'interior:n1' }, { x: 21, y: 30, rule: 'glyph:t:line0:0' }, { x: 5, y: 8, rule: `edge:n2:top${CLEAR_SUFFIX}` }],
  run: [{ x: 5, y: 5, rule: 'interior:n1' }, { x: 21, y: 30, rule: 'glyph:t:line0:0' }],
  glyphs: [glyph],
};

describe('b3Bucket', () => {
  it('buckets position, clear, fringe and clear-fallback failures', () => {
    expect(b3Bucket(f('centre:t:line0:x'), ref, false).bucket).toBe('glyph-position');
    expect(b3Bucket(f('interior:n1', 'pixel at 5,5: native'), ref, false).bucket).toBe('clear');
    expect(b3Bucket(f('glyph:t:line0:0', 'pixel at 21,30: native'), ref, false).bucket).toBe('fringe');
    expect(b3Bucket(f(`edge:n2:top${CLEAR_SUFFIX}`, 'pixel at 5,8: native'), ref, false).bucket).toBe('clear');
  });
  it('a failure with no rule, or naming no generated point, throws', () => {
    expect(() => b3Bucket(f(null), ref, false)).toThrow(/names no sample rule/);
    expect(() => b3Bucket(f('interior:n9', 'pixel at 5,5: native'), ref, false)).toThrow(/names no generated point/);
    // A ":clear" point that is not generated (or not at the failing pixel) was counted as clear before the audit.
    expect(() => b3Bucket(f(`edge:n2:top${CLEAR_SUFFIX}`, 'pixel at 6,8: native'), ref, false)).toThrow(/names no generated point/);
    expect(() => b3Bucket(f(`edge:n9:top${CLEAR_SUFFIX}`), ref, false)).toThrow(/names no generated point/);
  });
});
