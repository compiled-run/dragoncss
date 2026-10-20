// overflow-wrap (css-text-3 §5.5): normal | break-word | anywhere, and word-break (§5.2): normal | break-all | keep-all |
// break-word | auto-phrase, both inherited text properties, initial normal; word-wrap is Chrome's legacy alias of overflow-wrap.
// The engine breaks an overflowing word at grapheme clusters (TXT2-a, notes/T149-txt2-spec.md §0); break-all over ASCII letters,
// digits and spaces and keep-all are laid out over Ahem (TXT2-d, fixture group text-word-break); auto-phrase is refused.
import type { PropertyAspect } from '../properties.ts';

export const TEXT_BREAK_LONGHANDS = ['overflow-wrap', 'word-break'] as const;
export const TEXT_BREAK_SHORTHANDS = ['word-wrap'] as const;
export const TEXT_BREAK_INHERITED: readonly (typeof TEXT_BREAK_LONGHANDS)[number][] = ['overflow-wrap', 'word-break'];
export const TEXT_BREAK_CONTAINER: readonly (typeof TEXT_BREAK_LONGHANDS)[number][] = [];
export const TEXT_BREAK_TEXT_ROLE: readonly (typeof TEXT_BREAK_LONGHANDS)[number][] = ['overflow-wrap', 'word-break'];

export const TEXT_BREAK_ASPECTS: { readonly [P in (typeof TEXT_BREAK_LONGHANDS)[number]]: PropertyAspect } = {
  'overflow-wrap': { layout: true, paint: false },
  'word-break': { layout: true, paint: false },
};
