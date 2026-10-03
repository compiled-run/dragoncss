// Line breaking inside words and letter spacing (css-text-3 §5.2, §5.5, §8.2): overflow-wrap, word-break and letter-spacing, all
// inherited text properties. TXT2-a lays out overflow-wrap and word-break: break-word; letter-spacing is accepted only as normal or
// a zero length (analysis/computed-checks.ts), its layout is TXT2-b.
import type { PropertyAspect } from '../properties.ts';

export const TEXT_WRAP_LONGHANDS = ['overflow-wrap', 'word-break', 'letter-spacing'] as const;
export const TEXT_WRAP_SHORTHANDS = [] as const;
export const TEXT_WRAP_INHERITED: readonly (typeof TEXT_WRAP_LONGHANDS)[number][] = ['overflow-wrap', 'word-break', 'letter-spacing'];
export const TEXT_WRAP_CONTAINER: readonly (typeof TEXT_WRAP_LONGHANDS)[number][] = [];
export const TEXT_WRAP_TEXT_ROLE: readonly (typeof TEXT_WRAP_LONGHANDS)[number][] = ['overflow-wrap', 'word-break', 'letter-spacing'];

export const TEXT_WRAP_ASPECTS: { readonly [P in (typeof TEXT_WRAP_LONGHANDS)[number]]: PropertyAspect } = {
  'overflow-wrap': { layout: true, paint: false },
  'word-break': { layout: true, paint: false },
  'letter-spacing': { layout: true, paint: false },
};
