// letter-spacing (css-text-3 §8.2) and word-spacing (§8.1): normal | <length-percentage>, inherited, text properties. Chrome computes a
// length to px, letter-spacing 0 to normal and word-spacing normal to 0px (longhands_custom.cc LetterSpacing and WordSpacing); the
// engine adds letter spacing after every cluster and word spacing after every space (TXT2-b, notes/T149-txt2-spec.md R4).
import type { PropertyAspect } from '../properties.ts';

export const TEXT_SPACING_LONGHANDS = ['letter-spacing', 'word-spacing'] as const;
export const TEXT_SPACING_SHORTHANDS = [] as const;
export const TEXT_SPACING_INHERITED: readonly (typeof TEXT_SPACING_LONGHANDS)[number][] = ['letter-spacing', 'word-spacing'];
export const TEXT_SPACING_CONTAINER: readonly (typeof TEXT_SPACING_LONGHANDS)[number][] = [];
export const TEXT_SPACING_TEXT_ROLE: readonly (typeof TEXT_SPACING_LONGHANDS)[number][] = ['letter-spacing', 'word-spacing'];

export const TEXT_SPACING_ASPECTS: { readonly [P in (typeof TEXT_SPACING_LONGHANDS)[number]]: PropertyAspect } = {
  'letter-spacing': { layout: true, paint: false },
  'word-spacing': { layout: true, paint: false },
};
