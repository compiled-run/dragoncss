// The per-tile fold of a pre-composited group (paint-group.ts groupTileFoldIndex): cc searches its rtree with the tile canvas's local
// clip bounds, which Skia outsets by one pixel, so an item meets a tile it ends right at (measured: opacity-group-outline, the box
// that ends at tile 1's first texel keeps the ring past it from folding).
import { describe, expect, it } from 'vitest';
import { groupTileFoldIndex, groupTileSpan } from '../src/paint-group.ts';

describe('groupTileFoldIndex: the tile query is outset by one pixel', () => {
  const [l, r] = groupTileSpan(1, 512) as [number, number];
  it('a lone foldable item in the tile folds', () => {
    expect(groupTileFoldIndex([l + 20, 0, l + 30, 10, 1], l, 0, r, 512)).toBe(0);
  });
  it('an item ending at the tile start, or starting at its end, meets it, so a foldable item beside it does not fold', () => {
    expect(groupTileFoldIndex([l - 80, 0, l, 10, 1, l + 20, 0, l + 30, 10, 1], l, 0, r, 512)).toBe(-1);
    expect(groupTileFoldIndex([r, 0, r + 30, 10, 1, l + 20, 0, l + 30, 10, 1], l, 0, r, 512)).toBe(-1);
  });
  it('an item one pixel further away does not meet it', () => {
    expect(groupTileFoldIndex([l - 80, 0, l - 1, 10, 1, l + 20, 0, l + 30, 10, 1], l, 0, r, 512)).toBe(1);
    expect(groupTileFoldIndex([r + 1, 0, r + 30, 10, 1, l + 20, 0, l + 30, 10, 1], l, 0, r, 512)).toBe(1);
  });
});
