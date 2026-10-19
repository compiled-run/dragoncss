// text-shadow (css-text-decor-4 §4): none | a comma list of shadows, inherited, initial none. Only none is accepted: Dragon draws no
// text shadow yet (TXT-FX, T158), so computed-checks refuses every shadow list on every target (checkTextShadow).
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import { readShadows, shadowValue } from './shadow.ts';

export const TEXT_SHADOW_LONGHANDS = ['text-shadow'] as const;
export const TEXT_SHADOW_SHORTHANDS = [] as const;
export const TEXT_SHADOW_INHERITED: readonly (typeof TEXT_SHADOW_LONGHANDS)[number][] = ['text-shadow'];
export const TEXT_SHADOW_CONTAINER: readonly (typeof TEXT_SHADOW_LONGHANDS)[number][] = [];
export const TEXT_SHADOW_TEXT_ROLE: readonly (typeof TEXT_SHADOW_LONGHANDS)[number][] = [];

export const TEXT_SHADOW_ASPECTS: { readonly [P in (typeof TEXT_SHADOW_LONGHANDS)[number]]: PropertyAspect } = {
  'text-shadow': { layout: false, paint: true },
};

/** none, or a shadow list read as box-shadow reads one (the grammar has already left out inset and spread); analysis/computed-checks.ts refuses the list. */
export function parseTextShadow(tokens: readonly CssNode[], base: Span): ParsedValue {
  const r = readShadows(tokens, base);
  if ('refused' in r) {
    const v = r.refused;
    return v.kind === 'refused' ? { kind: 'refused', diagnostic: { ...v.diagnostic, message: v.diagnostic.message.replace(/^box-shadow:/, 'text-shadow:') } } : v;
  }
  if ('invalid' in r) return { kind: 'invalid', reason: r.invalid };
  return { kind: 'ok', longhands: [{ property: 'text-shadow', value: shadowValue(r.ok, false), explicit: true }] };
}

/** The value parser of the text-shadow family (the value hook, css/paint-parsers.ts). */
export const TEXT_SHADOW_VALUE_PARSERS: { readonly [P in (typeof TEXT_SHADOW_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'text-shadow': parseTextShadow,
};
