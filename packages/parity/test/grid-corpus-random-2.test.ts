// The G-P differential test, random shard 2: seeded random grids random-04 and random-05 (packages/parity/test/grid-corpus/shard.ts).
import { describe, expect, it } from 'vitest';
import { runShard } from './grid-corpus/shard.ts';

/** Pinned from the run that introduced the test; a change in any count is a regression or a newly supported case to review. */
const PINNED = { matched: 952, known: [], refused: { 'baseline-alignment': 1504, 'inline-grid': 808, 'sizing-keyword': 736 } };

describe('G-P differential test: random-04 and random-05 against Chrome 145', () => {
  it('every horizontal-tb environment matches exactly, is a pinned known mismatch, or is refused for an owned reason', () => {
    const r = runShard(['random-04', 'random-05']);
    expect(r.problems).toEqual([]);
    expect(r.cases).toBe(500);
    expect({ matched: r.matched, known: r.knownMismatches, refused: r.refused }).toEqual(PINNED);
  }, 600000);
});
