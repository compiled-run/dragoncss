// Fonts, text and the foreground colour (css-fonts-4, css-inline-3, css-text-4, css-color-4).
import type { PropertyAspect } from '../properties.ts';

export const TEXT_FAMILY_LONGHANDS = ['font-size', 'font-family', 'line-height', 'text-align', 'white-space-collapse', 'text-wrap-mode', 'color'] as const;
export const TEXT_FAMILY_SHORTHANDS = ['white-space'] as const;
export const TEXT_FAMILY_INHERITED: readonly (typeof TEXT_FAMILY_LONGHANDS)[number][] = ['font-size', 'font-family', 'line-height', 'text-align', 'white-space-collapse', 'text-wrap-mode', 'color'];
export const TEXT_FAMILY_CONTAINER: readonly (typeof TEXT_FAMILY_LONGHANDS)[number][] = [];
export const TEXT_FAMILY_TEXT_ROLE: readonly (typeof TEXT_FAMILY_LONGHANDS)[number][] = ['font-size', 'font-family', 'line-height', 'text-align', 'white-space-collapse', 'text-wrap-mode'];

export const TEXT_FAMILY_ASPECTS: { readonly [P in (typeof TEXT_FAMILY_LONGHANDS)[number]]: PropertyAspect } = {
  'font-size': { layout: true, paint: false },
  'font-family': { layout: true, paint: false },
  'line-height': { layout: true, paint: false },
  'text-align': { layout: true, paint: false },
  'white-space-collapse': { layout: true, paint: false },
  'text-wrap-mode': { layout: true, paint: false },
  color: { layout: false, paint: true },
};
