// How the font-variant family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { FontVariantLonghand } from '../properties/font-variant.ts';

export const FONT_VARIANT_ANIMATION: { readonly [P in FontVariantLonghand]: AnimationKind } = {
  'font-variant-ligatures': DISCRETE,
  'font-variant-caps': DISCRETE,
  'font-variant-alternates': DISCRETE,
  'font-variant-numeric': DISCRETE,
  'font-variant-east-asian': DISCRETE,
  'font-variant-position': DISCRETE,
  'font-variant-emoji': DISCRETE,
};
