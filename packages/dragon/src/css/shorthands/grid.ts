// css-grid-2 §7.4 (grid-template), §7.8 (grid), §8.4 (grid-row, grid-column, grid-area); the parse driver expands them through
// grid-values.ts before these handlers are reached, so expand is the same expansion. grid-gap, grid-row-gap and grid-column-gap
// are Chrome's legacy aliases of gap, row-gap and column-gap (css-align-3 §8.5).
import { GRID_SHORTHAND_LONGHANDS, gridLonghands } from '../grid-values.ts';
import type { CssValue } from '../values.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit, twoAxes } from './shared.ts';

const gridShorthand = (name: keyof typeof GRID_SHORTHAND_LONGHANDS): ShorthandHandler => ({
  longhands: GRID_SHORTHAND_LONGHANDS[name],
  expand: (_values, tokens) => {
    const longhands = gridLonghands(name, tokens);
    if (longhands === null) throw new Error(`${name}: the parse driver accepted a value Chrome drops`);
    return longhands;
  },
});

export const GRID_SHORTHANDS = {
  grid: gridShorthand('grid'),
  'grid-template': gridShorthand('grid-template'),
  'grid-row': gridShorthand('grid-row'),
  'grid-column': gridShorthand('grid-column'),
  'grid-area': gridShorthand('grid-area'),
  'grid-gap': twoAxes(['row-gap', 'column-gap']),
  'grid-row-gap': { longhands: ['row-gap'], expand: (values) => [explicit('row-gap', values[0] as CssValue)] },
  'grid-column-gap': { longhands: ['column-gap'], expand: (values) => [explicit('column-gap', values[0] as CssValue)] },
} as const satisfies { readonly [s: string]: ShorthandHandler };
