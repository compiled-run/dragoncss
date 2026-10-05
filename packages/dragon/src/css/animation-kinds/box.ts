// How the box family's longhands animate in Chrome 145 (animation-kinds.ts).
import { ALL, DISCRETE, NON_NEGATIVE, UNADMITTED, type AnimationKind } from './kinds.ts';
import type { BOX_LONGHANDS } from '../properties/box.ts';

export const BOX_ANIMATION: { readonly [P in (typeof BOX_LONGHANDS)[number]]: AnimationKind } = {
  direction: DISCRETE,
  'box-sizing': DISCRETE,
  width: NON_NEGATIVE,
  height: NON_NEGATIVE,
  'min-width': NON_NEGATIVE,
  'min-height': NON_NEGATIVE,
  'max-width': NON_NEGATIVE,
  'max-height': NON_NEGATIVE,
  'aspect-ratio': UNADMITTED,
  'margin-top': ALL,
  'margin-right': ALL,
  'margin-bottom': ALL,
  'margin-left': ALL,
  'padding-top': NON_NEGATIVE,
  'padding-right': NON_NEGATIVE,
  'padding-bottom': NON_NEGATIVE,
  'padding-left': NON_NEGATIVE,
  // REPL-a: object-fit is discrete in Chrome; object-position interpolates, and its writer is not built.
  'object-fit': DISCRETE,
  'object-position': UNADMITTED,
};
