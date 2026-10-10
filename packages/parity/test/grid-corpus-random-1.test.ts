// The G-P differential test, random shard 1: seeded random grids random-02 and random-03 (packages/parity/test/grid-corpus/shard.ts).
import { describe, expect, it } from 'vitest';
import { runShard } from './grid-corpus/shard.ts';

/** Pinned from the run that introduced the test; a change in any count is a regression or a newly supported case to review. */
const PINNED = { matched: 952, known: [], refused: { 'baseline-alignment': 1344, 'inline-grid': 792, 'sizing-keyword': 912 } };

describe('G-P differential test: random-02 and random-03 against Chrome 145', () => {
  it('every horizontal-tb environment matches exactly, is a pinned known mismatch, or is refused for an owned reason', () => {
    const r = runShard(['random-02', 'random-03']);
    expect(r.problems).toEqual([]);
    expect(r.cases).toBe(500);
    expect({ matched: r.matched, known: r.knownMismatches, refused: r.refused }).toEqual(PINNED);
  }, 600000);
});
