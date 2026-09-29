// The G-P differential test, random shard 0: seeded random grids random-00 and random-01 (packages/parity/test/grid-corpus/shard.ts).
import { describe, expect, it } from 'vitest';
import { runShard } from './grid-corpus/shard.ts';

/** Pinned from the run that introduced the test; a change in any count is a regression or a newly supported case to review. */
const PINNED = { matched: 870, known: ['random-01/rnd-0313 dpr2.625-ltr-horizontal-tb', 'random-01/rnd-0313 dpr2.625-rtl-horizontal-tb'], refused: { 'baseline-alignment': 1560, 'inline-grid': 840, 'sizing-keyword': 728 } };

describe('G-P differential test: random-00 and random-01 against Chrome 145', () => {
  it('every horizontal-tb environment matches exactly, is a pinned known mismatch, or is refused for an owned reason', () => {
    const r = runShard(['random-00', 'random-01']);
    expect(r.problems).toEqual([]);
    expect(r.cases).toBe(500);
    expect({ matched: r.matched, known: r.knownMismatches, refused: r.refused }).toEqual(PINNED);
  }, 600000);
});
