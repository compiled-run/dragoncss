// letter-spacing (css-text-3 §8.2): normal | <length-percentage>, inherited, a text property. Chrome computes a length to px and 0 to
// normal (longhands_custom.cc LetterSpacing); the engine adds it after every cluster (TXT2-b, notes/T149-txt2-spec.md R4).
import type { PropertyAspect } from '../properties.ts';

export const TEXT_SPACING_LONGHANDS = ['letter-spacing'] as const;
export const TEXT_SPACING_SHORTHANDS = [] as const;
export const TEXT_SPACING_INHERITED: readonly (typeof TEXT_SPACING_LONGHANDS)[number][] = ['letter-spacing'];
export const TEXT_SPACING_CONTAINER: readonly (typeof TEXT_SPACING_LONGHANDS)[number][] = [];
export const TEXT_SPACING_TEXT_ROLE: readonly (typeof TEXT_SPACING_LONGHANDS)[number][] = ['letter-spacing'];

export const TEXT_SPACING_ASPECTS: { readonly [P in (typeof TEXT_SPACING_LONGHANDS)[number]]: PropertyAspect } = {
  'letter-spacing': { layout: true, paint: false },
};
