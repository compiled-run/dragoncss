// The shorthands of the families Dragon accepts at their initial values alone (css/properties/initial-only.ts): overscroll-behavior,
// contain-intrinsic-size and container, as Chrome 145 registers them.
import type { ShorthandHandler } from './shared.ts';

// A non-CSS-wide value never reaches expand: the paint value hook parses it (css/paint-parsers.ts).
const hooked = (): never => {
  throw new Error('initial-only shorthand values are parsed by the paint value hook (css/paint-parsers.ts)');
};

export const INITIAL_ONLY_SHORTHANDS = {
  'overscroll-behavior': { longhands: ['overscroll-behavior-x', 'overscroll-behavior-y'], expand: hooked },
  'contain-intrinsic-size': { longhands: ['contain-intrinsic-width', 'contain-intrinsic-height'], expand: hooked },
  container: { longhands: ['container-name', 'container-type'], expand: hooked },
} as const satisfies { readonly [s: string]: ShorthandHandler };
