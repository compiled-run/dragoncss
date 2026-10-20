// How the table family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TABLE_LONGHANDS } from '../properties/table.ts';

export const TABLE_ANIMATION: { readonly [P in (typeof TABLE_LONGHANDS)[number]]: AnimationKind } = {
  'border-collapse': DISCRETE,
  // The spacings interpolate in Chrome; the state runtime has no writer for them, and no box Dragon builds reads them.
  '-webkit-border-horizontal-spacing': UNADMITTED,
  '-webkit-border-vertical-spacing': UNADMITTED,
  'caption-side': DISCRETE,
  'empty-cells': DISCRETE,
  'table-layout': DISCRETE,
};
