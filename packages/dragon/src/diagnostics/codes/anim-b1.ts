// ANIM-b1: transitions and animations with no effect.
import { diagnosticFeature, manual } from '../entry.ts';

export const ANIM_B1 = diagnosticFeature(
  [
    'DRAGON_ANIMATION_NO_EFFECT',
  ],
  {
    DRAGON_ANIMATION_NO_EFFECT: { severity: 'warning', message: 'This transition or animation does nothing.', why: 'Chrome runs no animation for an animation-name without @keyframes, and no transition for a name that is not a property; Dragon compiles the same nothing.', computedWhy: null, fix: manual('Name a @keyframes rule or a property', 'Define the @keyframes rule, or fix the property name, or remove the declaration.') },
  },
);
