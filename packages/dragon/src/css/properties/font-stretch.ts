// font-stretch (css-fonts-4 §2.4): normal | <percentage [0,∞]> | a width keyword, inherited, initial normal; Chrome 145 computes
// each keyword to its percentage (normal to 100%), and the font shorthand sets it from its width keyword. It selects among a
// family's faces by width and is never synthesized, so over Ahem (one face, at 100%) Chrome draws the same glyphs at every
// width; Dragon accepts it there and refuses a width other than 100% over a real face (computed-checks.ts checkFontStretch).
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedValue } from '../../analysis/computed.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import type { Longhand, PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

export const FONT_STRETCH_LONGHANDS = ['font-stretch'] as const;
export const FONT_STRETCH_SHORTHANDS = [] as const;
export const FONT_STRETCH_INHERITED: readonly (typeof FONT_STRETCH_LONGHANDS)[number][] = ['font-stretch'];
export const FONT_STRETCH_CONTAINER: readonly (typeof FONT_STRETCH_LONGHANDS)[number][] = [];
export const FONT_STRETCH_TEXT_ROLE: readonly (typeof FONT_STRETCH_LONGHANDS)[number][] = ['font-stretch'];

export const FONT_STRETCH_ASPECTS: { readonly [P in (typeof FONT_STRETCH_LONGHANDS)[number]]: PropertyAspect } = {
  'font-stretch': { layout: true, paint: false },
};

/** css-fonts-4 §2.4: the percentage of each width keyword. */
export const STRETCH_KEYWORDS: { readonly [k: string]: number } = {
  'ultra-condensed': 50,
  'extra-condensed': 62.5,
  condensed: 75,
  'semi-condensed': 87.5,
  normal: 100,
  'semi-expanded': 112.5,
  expanded: 125,
  'extra-expanded': 150,
  'ultra-expanded': 200,
};

/** The computed value of a width keyword or percentage, or null for any other value. */
export function stretchPercent(v: CssValue): number | null {
  if (v.kind === 'keyword') return STRETCH_KEYWORDS[v.value] ?? null;
  return v.kind === 'percentage' ? v.value : null;
}

/** One keyword or one non-negative percentage (the grammar has dropped the rest); a calculation is refused. */
function parseFontStretch(tokens: readonly CssNode[], base: Span): ParsedValue {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined) return { kind: 'invalid', reason: 'font-stretch is one value' };
  const ok = (value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property: 'font-stretch', value, explicit: true }] });
  if (t.type === 'Identifier' && STRETCH_KEYWORDS[asciiLower(String(t['name']))] !== undefined) return ok({ kind: 'keyword', value: asciiLower(String(t['name'])) });
  if (t.type === 'Percentage') return ok({ kind: 'percentage', value: Number(t['value']) });
  return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: 'font-stretch: a calculation is not supported yet; font-stretch takes a width keyword or a percentage', manual: 'Write font-stretch as a keyword, such as condensed, or a percentage, such as 75%.' }) };
}

/** The value parser of the font-stretch family (the value hook, css/paint-parsers.ts). */
export const FONT_STRETCH_VALUE_PARSERS: { readonly [P in (typeof FONT_STRETCH_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'font-stretch': parseFontStretch,
};

/** Chrome 145's computed font-stretch (FontStretch::CSSValueFromComputedStyleInternal): a percentage, normal 100%. */
export function computeFontStretch(props: Map<Longhand, ResolvedValue>): void {
  const v = props.get('font-stretch') as ResolvedValue;
  const pct = stretchPercent(v.value);
  if (pct !== null && v.value.kind !== 'percentage') props.set('font-stretch', { ...v, value: { kind: 'percentage', value: pct } });
}
