// The shorthands of the families Dragon accepts at their initial values alone (css/properties/initial-only.ts): overscroll-behavior,
// scroll-padding, scroll-margin and their flow-relative forms, contain-intrinsic-size, container, columns and column-rule, as Chrome
// 145 registers them (columns without its column-height and column-wrap, which MulticolColumnWrapping keeps off).
import { MULTICOL_SHORTHAND_LONGHANDS } from '../properties/multicol.ts';
import { SCROLL_SNAP_SHORTHAND_LONGHANDS } from '../properties/scroll-snap.ts';
import type { ShorthandHandler } from './shared.ts';

// A non-CSS-wide value never reaches expand: the paint value hook parses it (css/paint-parsers.ts).
const hooked = (): never => {
  throw new Error('initial-only shorthand values are parsed by the paint value hook (css/paint-parsers.ts)');
};

export const INITIAL_ONLY_SHORTHANDS = {
  'overscroll-behavior': { longhands: ['overscroll-behavior-x', 'overscroll-behavior-y'], expand: hooked },
  'scroll-padding': { longhands: SCROLL_SNAP_SHORTHAND_LONGHANDS['scroll-padding'], expand: hooked },
  'scroll-padding-inline': { longhands: SCROLL_SNAP_SHORTHAND_LONGHANDS['scroll-padding-inline'], expand: hooked },
  'scroll-padding-block': { longhands: SCROLL_SNAP_SHORTHAND_LONGHANDS['scroll-padding-block'], expand: hooked },
  'scroll-margin': { longhands: SCROLL_SNAP_SHORTHAND_LONGHANDS['scroll-margin'], expand: hooked },
  'scroll-margin-inline': { longhands: SCROLL_SNAP_SHORTHAND_LONGHANDS['scroll-margin-inline'], expand: hooked },
  'scroll-margin-block': { longhands: SCROLL_SNAP_SHORTHAND_LONGHANDS['scroll-margin-block'], expand: hooked },
  'contain-intrinsic-size': { longhands: ['contain-intrinsic-width', 'contain-intrinsic-height'], expand: hooked },
  container: { longhands: ['container-name', 'container-type'], expand: hooked },
  columns: { longhands: MULTICOL_SHORTHAND_LONGHANDS.columns, expand: hooked },
  'column-rule': { longhands: MULTICOL_SHORTHAND_LONGHANDS['column-rule'], expand: hooked },
} as const satisfies { readonly [s: string]: ShorthandHandler };
