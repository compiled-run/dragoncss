// appearance (css-ui-4 §7.1): none | auto | base-select | <compat-auto> | <compat-special>, not inherited, initial none, with
// -webkit-appearance Chrome's legacy alias (aliases/appearance.ts). Chrome 145 parses one keyword and computes it as written, in
// lower case. A keyword other than none changes a form control's look, and an element without a native appearance (every tag
// Dragon resolves: no button, input, select, textarea, meter or progress) uses none whatever it computes to (css-ui-4 §7.1.1), so
// it paints nothing. It does change layout: Chrome turns an inline or inline-table box with appearance other than none into
// inline-block, and a list-item or table box into block, which analysis/computed.ts appearanceDisplay applies, so the
// property has a layout aspect. Dragon accepts none, auto and the css-ui-4 compat keywords,
// pinned against Chrome by packages/parity/test/appearance-parse.test.ts. base-select and slider-vertical, which Chrome keeps, are
// refused; every other keyword (push-button, inner-spin-button and the like) Chrome drops, and so does Dragon. The grammar takes any
// value so the parser decides (scripts/gen-css-grammar.ts).
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import { spanOf } from '../ast.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const APPEARANCE_LONGHANDS = ['appearance'] as const;
export const APPEARANCE_SHORTHANDS = [] as const;
export const APPEARANCE_INHERITED: readonly (typeof APPEARANCE_LONGHANDS)[number][] = [];
export const APPEARANCE_CONTAINER: readonly (typeof APPEARANCE_LONGHANDS)[number][] = [];
export const APPEARANCE_TEXT_ROLE: readonly (typeof APPEARANCE_LONGHANDS)[number][] = [];

export const APPEARANCE_ASPECTS: { readonly [P in (typeof APPEARANCE_LONGHANDS)[number]]: PropertyAspect } = {
  appearance: { layout: true, paint: false },
};

/** none, auto, css-ui-4's <compat-auto> and its <compat-special>: the keywords Dragon accepts. */
export const APPEARANCE_KEYWORDS: readonly string[] = [
  'none', 'auto',
  'searchfield', 'textarea', 'checkbox', 'radio', 'menulist', 'listbox', 'meter', 'progress-bar', 'button',
  'textfield', 'menulist-button',
];

/** The keywords Chrome 145 keeps beyond APPEARANCE_KEYWORDS, which Dragon refuses: base-select (customizable select) and slider-vertical. */
export const APPEARANCE_REFUSED: readonly string[] = ['base-select', 'slider-vertical'];

/** appearance as Chrome 145 parses it, any ASCII case: one keyword. APPEARANCE_REFUSED is refused, and any other keyword dropped. */
export function parseAppearance(tokens: readonly CssNode[], base: Span): ParsedValue {
  const only = tokens[0];
  if (tokens.length !== 1 || only === undefined || only.type !== 'Identifier') return { kind: 'invalid', reason: 'appearance takes one keyword' };
  const word = asciiLower(String(only['name']));
  if (APPEARANCE_KEYWORDS.includes(word)) return { kind: 'ok', longhands: [{ property: 'appearance', value: { kind: 'keyword', value: word }, explicit: true }] };
  if (!APPEARANCE_REFUSED.includes(word)) return { kind: 'invalid', reason: `Chrome 145 does not parse appearance: ${word}` };
  return {
    kind: 'refused',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(spanOf(only, base)),
      message: `appearance: ${word} is unsupported: Chrome 145 keeps it, and Dragon accepts none, auto and the css-ui-4 compat keywords only`,
      manual: 'Use appearance: none or auto.',
    }),
  };
}

/** The value parser of the appearance family (the value hook, css/paint-parsers.ts). */
export const APPEARANCE_VALUE_PARSERS: { readonly [P in (typeof APPEARANCE_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  appearance: parseAppearance,
};
