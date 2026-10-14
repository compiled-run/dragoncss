// resize (css-ui-4 §5.1): none | both | horizontal | vertical | block | inline, not inherited, initial none. Chrome 145 also parses
// auto (css_parser_fast_paths.cc, under CSSResizeAuto, a stable feature), and Resize::ApplyValue in longhands_custom.cc stores it
// as both where textareas are resizable, which every desktop Chrome is (WebPreferences text_areas_are_resizable), so it computes to
// both; every other value computes as specified. No layout or paint aspect: Chrome draws a resizer and lets the user drag only on a
// scroll container or an iframe, which native refuses (analysis/resize.ts); on any other box the value changes nothing.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import type { ResolvedValue } from '../../analysis/computed.ts';
import { asciiLower } from '../escapes.ts';
import type { Longhand, PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const RESIZE_LONGHANDS = ['resize'] as const;
export const RESIZE_SHORTHANDS = [] as const;
export const RESIZE_INHERITED: readonly (typeof RESIZE_LONGHANDS)[number][] = [];
export const RESIZE_CONTAINER: readonly (typeof RESIZE_LONGHANDS)[number][] = [];
export const RESIZE_TEXT_ROLE: readonly (typeof RESIZE_LONGHANDS)[number][] = [];

export const RESIZE_ASPECTS: { readonly [P in (typeof RESIZE_LONGHANDS)[number]]: PropertyAspect } = {
  resize: { layout: false, paint: false },
};

const KEYWORDS: readonly string[] = ['none', 'both', 'horizontal', 'vertical', 'block', 'inline', 'auto'];

/** resize as Chrome 145 parses it: one of seven keywords, any ASCII case. */
export function parseResize(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined || t.type !== 'Identifier') return { kind: 'invalid', reason: 'resize is one keyword' };
  const k = asciiLower(String(t['name']));
  if (!KEYWORDS.includes(k)) return { kind: 'invalid', reason: `Chrome 145 does not parse resize: ${k}` };
  return { kind: 'ok', longhands: [{ property: 'resize', value: { kind: 'keyword', value: k }, explicit: true }] };
}

/** The value parser of the resize family (the value hook, css/paint-parsers.ts). */
export const RESIZE_VALUE_PARSERS: { readonly [P in (typeof RESIZE_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  resize: parseResize,
};

/** Resize::ApplyValue: auto computes to both in desktop Chrome; every other keyword computes as specified. */
export function computeResize(props: Map<Longhand, ResolvedValue>): void {
  const v = props.get('resize') as ResolvedValue;
  if (v.value.kind === 'keyword' && v.value.value === 'auto') props.set('resize', { ...v, value: { kind: 'keyword', value: 'both' } });
}
