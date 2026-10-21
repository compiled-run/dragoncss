// compositing-1 §9.2: background-blend-mode (a comma-separated list of <blend-mode>, one item per background layer, initial normal,
// not inherited). Chrome 145 parses each item with ConsumeBackgroundBlendMode: normal and the fifteen separable and non-separable
// modes, never plus-lighter or plus-darker (scripts/gen-css-grammar.ts holds that grammar). Dragon draws no blending yet (coverage-rank
// lane BG2), so it accepts the single keyword normal alone, where Chrome paints each layer over the one below with source-over, as
// Dragon already does. Every other kept value, a list among them, is refused on every target (analysis/background-blend.ts): a blend
// mode can make text over a background unreadable.
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

export const BACKGROUND_BLEND_LONGHANDS = ['background-blend-mode'] as const;
export const BACKGROUND_BLEND_SHORTHANDS = [] as const;
export const BACKGROUND_BLEND_INHERITED: readonly (typeof BACKGROUND_BLEND_LONGHANDS)[number][] = [];
export const BACKGROUND_BLEND_CONTAINER: readonly (typeof BACKGROUND_BLEND_LONGHANDS)[number][] = [];
export const BACKGROUND_BLEND_TEXT_ROLE: readonly (typeof BACKGROUND_BLEND_LONGHANDS)[number][] = [];

export const BACKGROUND_BLEND_ASPECTS: { readonly [P in (typeof BACKGROUND_BLEND_LONGHANDS)[number]]: PropertyAspect } = {
  'background-blend-mode': { layout: false, paint: true },
};

/** The initial value, the only one Dragon accepts. */
export const BACKGROUND_BLEND_INITIAL = 'normal';

/** The value type of a kept value other than a single normal (featureOf key background-blend-mode:<blend-mode-list>); refused. */
export const BLEND_MODE_LIST_TYPE = 'blend-mode-list';

/** Whether a computed background-blend-mode is the single keyword normal. */
export const isInitialBackgroundBlend = (v: CssValue): boolean => v.kind === 'keyword' && v.value === BACKGROUND_BLEND_INITIAL;

/**
 * A value the grammar kept: one normal in any ASCII case as the keyword, anything else (another mode, or a list of any length) as
 * its written text, lowercased, which checkBackgroundBlend refuses.
 */
export function parseBackgroundBlendMode(tokens: readonly CssNode[], _base: Span): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'background-blend-mode needs a value' };
  const one = tokens.length === 1 && tokens[0]?.type === 'Identifier' && asciiLower(String(tokens[0]['name'])) === BACKGROUND_BLEND_INITIAL;
  const text = tokens.map((t) => (t.type === 'Identifier' ? asciiLower(String(t['name'])) : generate(t))).join(' ').replaceAll(' ,', ',');
  const value: CssValue = one ? { kind: 'keyword', value: BACKGROUND_BLEND_INITIAL } : { kind: 'other', type: BLEND_MODE_LIST_TYPE, text };
  return { kind: 'ok', longhands: [{ property: 'background-blend-mode', value, explicit: true }] };
}

/** The value parser of the family (the paint value hook, css/paint-parsers.ts). */
export const BACKGROUND_BLEND_VALUE_PARSERS = { 'background-blend-mode': parseBackgroundBlendMode } as const;
