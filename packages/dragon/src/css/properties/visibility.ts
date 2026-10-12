// visibility (css-display-3 §4): visible | hidden | collapse, inherited, initial visible, computed as specified. Chrome 145 keeps a
// collapsed flex item's space and paints it as hidden, so collapse is hidden on every non-table box (notes/T150-visibility-spec.md
// R2, M2). webref's grammar also lists force-hidden (css-display-4), which Chrome 145 does not parse, so the value parser drops it.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

export const VISIBILITY_LONGHANDS = ['visibility'] as const;
export const VISIBILITY_SHORTHANDS = [] as const;
export const VISIBILITY_INHERITED: readonly (typeof VISIBILITY_LONGHANDS)[number][] = ['visibility'];
export const VISIBILITY_CONTAINER: readonly (typeof VISIBILITY_LONGHANDS)[number][] = [];
export const VISIBILITY_TEXT_ROLE: readonly (typeof VISIBILITY_LONGHANDS)[number][] = [];

export const VISIBILITY_ASPECTS: { readonly [P in (typeof VISIBILITY_LONGHANDS)[number]]: PropertyAspect } = {
  visibility: { layout: false, paint: true },
};

export type VisibilityKeyword = 'visible' | 'hidden' | 'collapse';

/** The keyword of a computed visibility; anything else is a compiler fault. */
export function visibilityOf(v: CssValue): VisibilityKeyword {
  if (v.kind === 'keyword' && (v.value === 'visible' || v.value === 'hidden' || v.value === 'collapse')) return v.value;
  throw new Error(`visibility ${JSON.stringify(v)} is not visible, hidden or collapse`);
}

/** Whether a computed visibility paints the box's own decorations: only visible does (R2: collapse is hidden off tables). */
export const paintsOwn = (k: VisibilityKeyword): boolean => k === 'visible';

/** css-display-3 §4 as Chrome 145 parses it: one of the three keywords, any ASCII case (force-hidden is invalid there). */
export function parseVisibility(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined || t.type !== 'Identifier') return { kind: 'invalid', reason: 'visibility is one keyword' };
  const k = asciiLower(String(t['name']));
  if (k !== 'visible' && k !== 'hidden' && k !== 'collapse') return { kind: 'invalid', reason: `Chrome 145 does not parse visibility: ${k}` };
  return { kind: 'ok', longhands: [{ property: 'visibility', value: { kind: 'keyword', value: k }, explicit: true }] };
}

/** The value parser of the visibility family (the paint value hook, css/paint-parsers.ts). */
export const VISIBILITY_VALUE_PARSERS: { readonly [P in (typeof VISIBILITY_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  visibility: parseVisibility,
};
