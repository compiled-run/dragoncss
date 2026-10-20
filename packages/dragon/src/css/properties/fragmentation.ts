// css-break-3: break-before, break-after, break-inside, orphans and widows, with Chrome 145's legacy shorthands page-break-before,
// -after and -inside (css-break-3 §3.4) and -webkit-column-break-before, -after and -inside (Blink's
// WebkitColumnBreak*::ParseShorthand). Each acts only where a fragmentation context breaks a box: a multi-column container, a page
// or a region. Dragon lays out none on any target (column-count and column-width are refused but at their initial auto, and the
// output is never printed), so on every box Dragon compiles they change nothing and every value Chrome parses is accepted, as the
// table properties are (properties/table.ts). A multi-column lane must start reading them. orphans and widows are inherited.
// Pinned against Chrome by packages/parity/test/fragmentation-parse.test.ts.
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import { foldNumber, parseMath, V1_MATH_FUNCTIONS } from '../math.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const FRAGMENTATION_LONGHANDS = ['break-before', 'break-after', 'break-inside', 'orphans', 'widows'] as const;
export const FRAGMENTATION_SHORTHANDS = ['page-break-before', 'page-break-after', 'page-break-inside', '-webkit-column-break-before', '-webkit-column-break-after', '-webkit-column-break-inside'] as const;
export const FRAGMENTATION_INHERITED: readonly (typeof FRAGMENTATION_LONGHANDS)[number][] = ['orphans', 'widows'];
export const FRAGMENTATION_CONTAINER: readonly (typeof FRAGMENTATION_LONGHANDS)[number][] = [];
export const FRAGMENTATION_TEXT_ROLE: readonly (typeof FRAGMENTATION_LONGHANDS)[number][] = [];

type FragmentationLonghand = (typeof FRAGMENTATION_LONGHANDS)[number];
type FragmentationShorthand = (typeof FRAGMENTATION_SHORTHANDS)[number];

export const FRAGMENTATION_ASPECTS: { readonly [P in FragmentationLonghand]: PropertyAspect } = {
  'break-before': { layout: false, paint: false },
  'break-after': { layout: false, paint: false },
  'break-inside': { layout: false, paint: false },
  orphans: { layout: false, paint: false },
  widows: { layout: false, paint: false },
};

/** The keywords Chrome 145 parses for break-before and break-after (css_properties.json5; always, all and the region values are not). */
export const BREAK_BETWEEN_KEYWORDS: readonly string[] = ['auto', 'avoid', 'avoid-column', 'avoid-page', 'column', 'left', 'page', 'recto', 'right', 'verso'];
/** The keywords Chrome 145 parses for break-inside. */
export const BREAK_INSIDE_KEYWORDS: readonly string[] = ['auto', 'avoid', 'avoid-column', 'avoid-page'];

/**
 * Each legacy shorthand's keywords and the break keyword each sets (Blink's break_properties_util MapFromPageBreakBetween,
 * MapFromColumnBreakBetween and MapFromColumnOrPageBreakInside): always is page under page-break-*, column under
 * -webkit-column-break-*, and avoid stays avoid under both.
 */
const LEGACY: { readonly [S in FragmentationShorthand]: { readonly longhand: FragmentationLonghand; readonly map: { readonly [k: string]: string } } } = {
  'page-break-before': { longhand: 'break-before', map: { auto: 'auto', always: 'page', avoid: 'avoid', left: 'left', right: 'right' } },
  'page-break-after': { longhand: 'break-after', map: { auto: 'auto', always: 'page', avoid: 'avoid', left: 'left', right: 'right' } },
  'page-break-inside': { longhand: 'break-inside', map: { auto: 'auto', avoid: 'avoid' } },
  '-webkit-column-break-before': { longhand: 'break-before', map: { auto: 'auto', always: 'column', avoid: 'avoid' } },
  '-webkit-column-break-after': { longhand: 'break-after', map: { auto: 'auto', always: 'column', avoid: 'avoid' } },
  '-webkit-column-break-inside': { longhand: 'break-inside', map: { auto: 'auto', avoid: 'avoid' } },
};

/** The longhand each legacy shorthand sets. */
export const FRAGMENTATION_SHORTHAND_LONGHAND: { readonly [S in FragmentationShorthand]: FragmentationLonghand } = Object.fromEntries(
  FRAGMENTATION_SHORTHANDS.map((s) => [s, LEGACY[s].longhand]),
) as { readonly [S in FragmentationShorthand]: FragmentationLonghand };

/** One keyword, any ASCII case, from words; null for anything else. */
function oneKeyword(tokens: readonly CssNode[], words: readonly string[]): string | null {
  const only = tokens[0];
  if (tokens.length !== 1 || only === undefined || only.type !== 'Identifier') return null;
  const word = asciiLower(String(only['name']));
  return words.includes(word) ? word : null;
}

function breakKeyword(property: FragmentationLonghand, words: readonly string[]): (tokens: readonly CssNode[], base: Span) => ParsedValue {
  return (tokens) => {
    const word = oneKeyword(tokens, words);
    if (word === null) return { kind: 'invalid', reason: `Chrome 145 parses ${property} as one of ${words.join(', ')}` };
    return { kind: 'ok', longhands: [{ property, value: { kind: 'keyword', value: word }, explicit: true }] };
  };
}

function legacyShorthand(name: FragmentationShorthand): (tokens: readonly CssNode[], base: Span) => ParsedValue {
  const { longhand, map } = LEGACY[name];
  return (tokens) => {
    const word = oneKeyword(tokens, Object.keys(map));
    if (word === null) return { kind: 'invalid', reason: `Chrome 145 parses ${name} as one of ${Object.keys(map).join(', ')}` };
    return { kind: 'ok', longhands: [{ property: longhand, value: { kind: 'keyword', value: map[word] as string }, explicit: true }] };
  };
}

/** Blink stores orphans and widows in 16 bits: a larger specified integer computes to this. */
export const MAX_ORPHANS_WIDOWS = 32767;

/**
 * orphans and widows as Chrome 145 parses them (Blink ConsumePositiveInteger): an integer of at least 1, or a calc(), min(), max()
 * or clamp() of numbers, rounded to the nearest integer and clamped to at least 1 (css-values-4 §10.9). The computed value is
 * clamped to MAX_ORPHANS_WIDOWS.
 */
function positiveInteger(property: FragmentationLonghand): (tokens: readonly CssNode[], base: Span) => ParsedValue {
  return (tokens) => {
    const only = tokens[0];
    const ok = (n: number): ParsedValue => ({ kind: 'ok', longhands: [{ property, value: { kind: 'number', value: Math.min(n, MAX_ORPHANS_WIDOWS) }, explicit: true }] });
    if (tokens.length !== 1 || only === undefined) return { kind: 'invalid', reason: `${property} takes one positive integer` };
    if (only.type === 'Number') {
      const text = String(only['value']);
      const n = Number(text);
      if (!/^[+]?\d+$/.test(text) || n < 1) return { kind: 'invalid', reason: `${property} takes an integer of at least 1` };
      return ok(n);
    }
    if (only.type === 'Function' && V1_MATH_FUNCTIONS.has(asciiLower(String(only['name'])))) {
      const parsed = parseMath(generate(only), { type: 'number' });
      if (!parsed.ok) return { kind: 'invalid', reason: `${property}: ${parsed.reason}` };
      const n = foldNumber(parsed.node);
      if (Number.isNaN(n) || n < 1) return ok(1);
      if (!Number.isFinite(n)) return ok(MAX_ORPHANS_WIDOWS);
      // Round half up by hand (only css/color.ts may call the Math rounding functions, test/ua.test.ts): n is at least 1 here.
      const whole = n - (n % 1);
      return ok(n % 1 >= 0.5 ? whole + 1 : whole);
    }
    return { kind: 'invalid', reason: `${property} takes one positive integer` };
  };
}

/** The value parsers of the fragmentation family (the value hook, css/paint-parsers.ts). */
export const FRAGMENTATION_VALUE_PARSERS: { readonly [P in FragmentationLonghand | FragmentationShorthand]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'break-before': breakKeyword('break-before', BREAK_BETWEEN_KEYWORDS),
  'break-after': breakKeyword('break-after', BREAK_BETWEEN_KEYWORDS),
  'break-inside': breakKeyword('break-inside', BREAK_INSIDE_KEYWORDS),
  orphans: positiveInteger('orphans'),
  widows: positiveInteger('widows'),
  ...(Object.fromEntries(FRAGMENTATION_SHORTHANDS.map((s) => [s, legacyShorthand(s)])) as { readonly [S in FragmentationShorthand]: (tokens: readonly CssNode[], base: Span) => ParsedValue }),
};
