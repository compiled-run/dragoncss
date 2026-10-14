// Fonts, text and the foreground colour (css-fonts-4, css-inline-3, css-text-4, css-color-4).
import type { PropertyAspect } from '../properties.ts';

export const TEXT_FAMILY_LONGHANDS = ['font-size', 'font-family', 'font-weight', 'font-style', 'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', 'line-height', 'text-align', 'white-space-collapse', 'text-wrap-mode', 'color'] as const;
export const TEXT_FAMILY_SHORTHANDS = ['white-space', 'font', 'font-synthesis'] as const;
export const TEXT_FAMILY_INHERITED: readonly (typeof TEXT_FAMILY_LONGHANDS)[number][] = ['font-size', 'font-family', 'font-weight', 'font-style', 'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', 'line-height', 'text-align', 'white-space-collapse', 'text-wrap-mode', 'color'];
export const TEXT_FAMILY_CONTAINER: readonly (typeof TEXT_FAMILY_LONGHANDS)[number][] = [];
export const TEXT_FAMILY_TEXT_ROLE: readonly (typeof TEXT_FAMILY_LONGHANDS)[number][] = ['font-size', 'font-family', 'font-weight', 'font-style', 'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', 'line-height', 'text-align', 'white-space-collapse', 'text-wrap-mode'];

export const TEXT_FAMILY_ASPECTS: { readonly [P in (typeof TEXT_FAMILY_LONGHANDS)[number]]: PropertyAspect } = {
  'font-size': { layout: true, paint: false },
  'font-family': { layout: true, paint: false },
  'font-weight': { layout: true, paint: false },
  'font-style': { layout: true, paint: false },
  // font-synthesis decides whether Chrome draws a synthesized face, and so whether native lays the text out (TXT-W2).
  'font-synthesis-weight': { layout: true, paint: false },
  'font-synthesis-style': { layout: true, paint: false },
  'font-synthesis-small-caps': { layout: true, paint: false },
  'line-height': { layout: true, paint: false },
  'text-align': { layout: true, paint: false },
  'white-space-collapse': { layout: true, paint: false },
  'text-wrap-mode': { layout: true, paint: false },
  color: { layout: false, paint: true },
};

/**
 * The longhands the font shorthand sets besides Dragon's (Chrome 145's expansion), with their initial values as getComputedStyle
 * serializes them. Dragon does not model them: a font value compiles only when it leaves each at this value (small-caps and a
 * non-normal stretch are refused), and the font-shorthand test checks Chrome computes each to it.
 */
export const FONT_RESET_LONGHANDS = {
  'font-variant-caps': 'normal',
  'font-variant-ligatures': 'normal',
  'font-variant-numeric': 'normal',
  'font-variant-east-asian': 'normal',
  'font-variant-alternates': 'normal',
  'font-variant-position': 'normal',
  'font-variant-emoji': 'normal',
  'font-stretch': '100%',
  'font-size-adjust': 'none',
  'font-language-override': 'normal',
  'font-kerning': 'auto',
  'font-optical-sizing': 'auto',
  'font-feature-settings': 'normal',
  'font-variation-settings': 'normal',
} as const;
