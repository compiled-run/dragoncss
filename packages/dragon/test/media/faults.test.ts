import { describe, expect, it } from 'vitest';
import { MEDIA_FAULT_NAMES, NO_MEDIA_FAULTS } from '../../src/media/index.ts';
import { compareCapture } from './compare.ts';
import { CAPTURE as capture } from './corpus.ts';

describe('planted media faults', () => {
  it('plants the five faults', () => {
    expect(MEDIA_FAULT_NAMES).toEqual(['maxWidthExclusive', 'emFromRoot', 'unknownAsTrue', 'notBindsTighterThanAnd', 'bandGapAtBoundary']);
  });

  it('passes every comparison unfaulted', () => {
    expect(compareCapture(capture, NO_MEDIA_FAULTS).mismatches).toEqual([]);
  });

  it.each(MEDIA_FAULT_NAMES)('%s flips at least one captured comparison', (name) => {
    const r = compareCapture(capture, { ...NO_MEDIA_FAULTS, [name]: true });
    expect(r.mismatches.length).toBeGreaterThan(0);
  });

  it('catches emFromRoot only on the 20px root page', () => {
    const r = compareCapture(capture, { ...NO_MEDIA_FAULTS, emFromRoot: true });
    expect(r.mismatches.every((m) => m.kind !== 'matches' || m.detail.includes('root 20px'))).toBe(true);
  });
});
