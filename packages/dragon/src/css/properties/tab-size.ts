// tab-size (css-text-3 §4.2): <number [0,∞]> | <length [0,∞]>, inherited, initial 8. It sizes the stops of preserved tabs, which
// the engine does not lay out yet: a preserved tab is refused with 'tab-stop' (computed-checks.ts) until TXT2-c3, so tab-size on
// text without one changes nothing Chrome draws (notes/T149-txt2-spec.md R16).
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import { normalizeUnit } from '../units.ts';
import type { CssValue } from '../values.ts';

export const TAB_SIZE_LONGHANDS = ['tab-size'] as const;
export const TAB_SIZE_SHORTHANDS = [] as const;
export const TAB_SIZE_INHERITED: readonly (typeof TAB_SIZE_LONGHANDS)[number][] = ['tab-size'];
export const TAB_SIZE_CONTAINER: readonly (typeof TAB_SIZE_LONGHANDS)[number][] = [];
export const TAB_SIZE_TEXT_ROLE: readonly (typeof TAB_SIZE_LONGHANDS)[number][] = ['tab-size'];

export const TAB_SIZE_ASPECTS: { readonly [P in (typeof TAB_SIZE_LONGHANDS)[number]]: PropertyAspect } = {
  'tab-size': { layout: true, paint: false },
};

/**
 * Blink TabSize::ParseSingleValue: a non-negative number of spaces, tried first, so
 * a bare 0 is the number 0, not 0px; otherwise a non-negative length. The grammar has already dropped a negative value; a
 * calculation, which Chrome folds, is refused (the number calculation is not folded for tab-size yet).
 */
export function parseTabSize(tokens: readonly CssNode[], base: Span): ParsedValue {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined) return { kind: 'invalid', reason: 'tab-size is one value' };
  const one = (value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property: 'tab-size', value, explicit: true }] });
  if (t.type === 'Number') return one({ kind: 'number', value: Number(t['value']) });
  if (t.type === 'Dimension') return one({ kind: 'length', value: Number(t['value']), unit: normalizeUnit(String(t['unit'])) });
  return {
    kind: 'refused',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: 'tab-size: a calculation is not supported yet; tab-size takes a number of spaces or a length', manual: 'Write tab-size as a number, such as 4, or as a length, such as 20px.' }),
  };
}

/** The value parser of the tab-size family (the value hook, css/paint-parsers.ts). */
export const TAB_SIZE_VALUE_PARSERS: { readonly [P in (typeof TAB_SIZE_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'tab-size': parseTabSize,
};
