// Backgrounds (css-backgrounds-3 §2).
import type { PropertyAspect } from '../properties.ts';

export const BACKGROUND_LONGHANDS = ['background-color'] as const;
export const BACKGROUND_SHORTHANDS = ['background'] as const;
export const BACKGROUND_INHERITED: readonly (typeof BACKGROUND_LONGHANDS)[number][] = [];
export const BACKGROUND_CONTAINER: readonly (typeof BACKGROUND_LONGHANDS)[number][] = [];
export const BACKGROUND_TEXT_ROLE: readonly (typeof BACKGROUND_LONGHANDS)[number][] = [];

export const BACKGROUND_ASPECTS: { readonly [P in (typeof BACKGROUND_LONGHANDS)[number]]: PropertyAspect } = {
  'background-color': { layout: false, paint: true },
};

/**
 * The longhands the background shorthand sets besides background-color (css-backgrounds-3 §3.10), in Chrome 145's expansion
 * order, with their initial values as Chrome 145 serializes them in getComputedStyle. Dragon does not model them: a background
 * value compiles only when it leaves each at this value, and the parity lane compares every one of them.
 */
export const BACKGROUND_RESET_LONGHANDS = {
  'background-image': 'none',
  'background-position-x': '0%',
  'background-position-y': '0%',
  'background-size': 'auto',
  'background-repeat': 'repeat',
  'background-attachment': 'scroll',
  'background-origin': 'padding-box',
  'background-clip': 'border-box',
} as const;

export type BackgroundResetLonghand = keyof typeof BACKGROUND_RESET_LONGHANDS;
