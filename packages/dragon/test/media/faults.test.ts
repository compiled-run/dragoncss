import { describe, expect, it } from 'vitest';
import { MEDIA_FAULT_NAMES, NO_MEDIA_FAULTS } from '../../src/media/index.ts';
import { compareCapture } from './compare.ts';
import { CAPTURE as capture } from './corpus.ts';

describe('planted media faults', () => {
  it('plants the five MQ-a faults and the five MQ-R0 faults', () => {
    expect(MEDIA_FAULT_NAMES).toEqual([
      'maxWidthExclusive', 'emFromRoot', 'unknownAsTrue', 'notBindsTighterThanAnd', 'bandGapAtBoundary',
      'mediaCompareExact', 'orientationUntruncated', 'aspectRatioUntruncated', 'mediaWidthDouble', 'emulatedSizeRounded',
    ]);
  });

  it('passes every comparison unfaulted', () => {
    expect(compareCapture(capture, NO_MEDIA_FAULTS).mismatches).toEqual([]);
  });

  it.each(MEDIA_FAULT_NAMES)('%s flips at least one captured comparison', (name) => {
    const r = compareCapture(capture, { ...NO_MEDIA_FAULTS, [name]: true });
    expect(r.mismatches.length).toBeGreaterThan(0);
  });

  // The integer-viewport corpus cannot see these (notes/T067 finding 1): each is caught by a fractional frame.
  it.each(['mediaCompareExact', 'orientationUntruncated', 'aspectRatioUntruncated', 'mediaWidthDouble', 'emulatedSizeRounded'] as const)('%s flips a row at a fractional frame', (name) => {
    const r = compareCapture(capture, { ...NO_MEDIA_FAULTS, [name]: true });
    expect(r.mismatches.filter((m) => m.fractional === true).length).toBeGreaterThan(0);
  });

  it('mediaCompareExact flips nothing at the integer viewports, which is how MQ-a missed it', () => {
    const r = compareCapture(capture, { ...NO_MEDIA_FAULTS, mediaCompareExact: true });
    expect(r.mismatches.filter((m) => m.fractional !== true)).toEqual([]);
  });

  it('catches emFromRoot only on the 20px root page', () => {
    const r = compareCapture(capture, { ...NO_MEDIA_FAULTS, emFromRoot: true });
    expect(r.mismatches.every((m) => m.kind !== 'matches' || m.detail.includes('root 20px'))).toBe(true);
  });
});
