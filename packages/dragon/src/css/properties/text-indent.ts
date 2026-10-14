// text-indent (css-text-3 §8.1): <length-percentage>, inherited, initial 0. Chrome 145 parses no hanging or each-line (CssTextIndent
// is a test feature). The engine indents the first formatted line of each block container (TXT2-h, notes/T149-txt2-spec.md R12).
import type { PropertyAspect } from '../properties.ts';

export const TEXT_INDENT_LONGHANDS = ['text-indent'] as const;
export const TEXT_INDENT_SHORTHANDS = [] as const;
export const TEXT_INDENT_INHERITED: readonly (typeof TEXT_INDENT_LONGHANDS)[number][] = ['text-indent'];
export const TEXT_INDENT_CONTAINER: readonly (typeof TEXT_INDENT_LONGHANDS)[number][] = [];
export const TEXT_INDENT_TEXT_ROLE: readonly (typeof TEXT_INDENT_LONGHANDS)[number][] = [];

export const TEXT_INDENT_ASPECTS: { readonly [P in (typeof TEXT_INDENT_LONGHANDS)[number]]: PropertyAspect } = {
  'text-indent': { layout: true, paint: false },
};
