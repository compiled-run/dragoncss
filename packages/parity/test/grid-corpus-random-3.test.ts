// The G-P differential test, random shard 3: seeded random grids random-06 and random-07 (packages/parity/test/grid-corpus/shard.ts).
import { describe, expect, it } from 'vitest';
import { runShard } from './grid-corpus/shard.ts';

/** Pinned from the run that introduced the test; a change in any count is a regression or a newly supported case to review. */
const PINNED = { matched: 932, known: ['random-06/rnd-1606 dpr2.625-ltr-horizontal-tb', 'random-06/rnd-1606 dpr2.625-rtl-horizontal-tb', 'random-07/rnd-1834 dpr2.625-ltr-horizontal-tb', 'random-07/rnd-1834 dpr2.625-rtl-horizontal-tb'], refused: { 'baseline-alignment': 1552, 'inline-grid': 768, 'sizing-keyword': 744 } };

describe('G-P differential test: random-06 and random-07 against Chrome 145', () => {
  it('every horizontal-tb environment matches exactly, is a pinned known mismatch, or is refused for an owned reason', () => {
    const r = runShard(['random-06', 'random-07']);
    expect(r.problems).toEqual([]);
    expect(r.cases).toBe(500);
    expect({ matched: r.matched, known: r.knownMismatches, refused: r.refused }).toEqual(PINNED);
  }, 600000);
});
