// appearance (css-ui-4 §7.1): none | auto | base-select | <compat-auto> | <compat-special>, not inherited, initial none, with
// -webkit-appearance Chrome's legacy alias (aliases/appearance.ts). Chrome 145 parses one keyword and computes it as written, in
// lower case. A keyword other than none changes only a form control's look, and an element without a native appearance (every tag
// Dragon resolves: no button, input, select, textarea, meter or progress) uses none whatever it computes to (css-ui-4 §7.1.1), so
// the property has no layout or paint aspect on any supported element. Dragon accepts none, auto and the css-ui-4 compat keywords,
// pinned against Chrome by packages/parity/test/appearance-parse.test.ts. base-select and the legacy keywords Chrome may still keep
// (push-button, slider-vertical and the like) are refused, never dropped, so the grammar takes any value (scripts/gen-css-grammar.ts).
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
  appearance: { layout: false, paint: false },
};

/** none, auto, css-ui-4's <compat-auto> and its <compat-special>: the keywords Dragon accepts. */
export const APPEARANCE_KEYWORDS: readonly string[] = [
  'none', 'auto',
  'searchfield', 'textarea', 'checkbox', 'radio', 'menulist', 'listbox', 'meter', 'progress-bar', 'button',
  'textfield', 'menulist-button',
];

/** appearance as Chrome 145 parses it, any ASCII case: one keyword. A keyword outside APPEARANCE_KEYWORDS is refused. */
export function parseAppearance(tokens: readonly CssNode[], base: Span): ParsedValue {
  const only = tokens[0];
  if (tokens.length !== 1 || only === undefined || only.type !== 'Identifier') return { kind: 'invalid', reason: 'appearance takes one keyword' };
  const word = asciiLower(String(only['name']));
  if (APPEARANCE_KEYWORDS.includes(word)) return { kind: 'ok', longhands: [{ property: 'appearance', value: { kind: 'keyword', value: word }, explicit: true }] };
  return {
    kind: 'refused',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(spanOf(only, base)),
      message: `appearance: ${word} is unsupported: Dragon accepts none, auto and the css-ui-4 compat keywords, and cannot tell whether Chrome 145 keeps ${word}`,
      manual: 'Use appearance: none or auto.',
    }),
  };
}

/** The value parser of the appearance family (the value hook, css/paint-parsers.ts). */
export const APPEARANCE_VALUE_PARSERS: { readonly [P in (typeof APPEARANCE_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  appearance: parseAppearance,
};
