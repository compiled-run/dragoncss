// How the font-tuning family's longhands animate in Chrome 145 (animation-kinds.ts).
import { DISCRETE, type AnimationKind } from './kinds.ts';
import type { FontTuningLonghand } from '../properties/font-tuning.ts';

export const FONT_TUNING_ANIMATION: { readonly [P in FontTuningLonghand]: AnimationKind } = {
  'font-kerning': DISCRETE,
  'font-optical-sizing': DISCRETE,
  'font-language-override': DISCRETE,
};
