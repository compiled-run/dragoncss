// -webkit-line-clamp (css-overflow-4 §4.2) and -webkit-box-orient, the two longhands of Chrome 145's legacy line clamp (TXT2-g,
// notes/T149-txt2-spec.md R11): with -webkit-box-orient: vertical and a -webkit-line-clamp other than none, display: -webkit-box
// computes to flow-root (Blink StyleAdjuster::AdjustStyleForDisplay) and its block clamps after line N (analysis/line-clamp.ts).
// Elsewhere both are inert (ComputedStyle::HasLineClamp needs the specified -webkit-box). Neither is inherited.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const LINE_CLAMP_LONGHANDS = ['-webkit-box-orient', '-webkit-line-clamp'] as const;
export const LINE_CLAMP_SHORTHANDS = [] as const;
export const LINE_CLAMP_INHERITED: readonly (typeof LINE_CLAMP_LONGHANDS)[number][] = [];
export const LINE_CLAMP_CONTAINER: readonly (typeof LINE_CLAMP_LONGHANDS)[number][] = ['-webkit-box-orient', '-webkit-line-clamp'];
export const LINE_CLAMP_TEXT_ROLE: readonly (typeof LINE_CLAMP_LONGHANDS)[number][] = [];

export const LINE_CLAMP_ASPECTS: { readonly [P in (typeof LINE_CLAMP_LONGHANDS)[number]]: PropertyAspect } = {
  '-webkit-box-orient': { layout: true, paint: false },
  '-webkit-line-clamp': { layout: true, paint: true },
};

/** Blink EBoxOrient: inline-axis computes to horizontal and block-axis to vertical (css_value_id_mappings.h). */
const ORIENT: ReadonlyMap<string, string> = new Map([['horizontal', 'horizontal'], ['inline-axis', 'horizontal'], ['vertical', 'vertical'], ['block-axis', 'vertical']]);

function parseBoxOrient(tokens: readonly CssNode[]): ParsedValue {
  const t = tokens[0];
  const k = tokens.length === 1 && t !== undefined && t.type === 'Identifier' ? ORIENT.get(asciiLower(String(t['name']))) : undefined;
  if (k === undefined) return { kind: 'invalid', reason: '-webkit-box-orient is one of horizontal, vertical, inline-axis and block-axis' };
  return { kind: 'ok', longhands: [{ property: '-webkit-box-orient', value: { kind: 'keyword', value: k }, explicit: true }] };
}

/** Blink WebkitLineClamp::ParseSingleValue: none or a positive integer; a calculation, which Chrome rounds, is refused. */
function parseLineClamp(tokens: readonly CssNode[], base: Span): ParsedValue {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined) return { kind: 'invalid', reason: '-webkit-line-clamp is one value' };
  if (t.type === 'Identifier' && asciiLower(String(t['name'])) === 'none') return { kind: 'ok', longhands: [{ property: '-webkit-line-clamp', value: { kind: 'keyword', value: 'none' }, explicit: true }] };
  const n = t.type === 'Number' ? Number(t['value']) : Number.NaN;
  if (Number.isInteger(n) && n >= 1) return { kind: 'ok', longhands: [{ property: '-webkit-line-clamp', value: { kind: 'number', value: n }, explicit: true }] };
  return {
    kind: 'refused',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: '-webkit-line-clamp: only none or a whole number of lines is supported', manual: 'Write -webkit-line-clamp as a whole number, such as 3.' }),
  };
}

/** The value parsers of the line-clamp family (the value hook, css/paint-parsers.ts). */
export const LINE_CLAMP_VALUE_PARSERS: { readonly [P in (typeof LINE_CLAMP_LONGHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  '-webkit-box-orient': parseBoxOrient,
  '-webkit-line-clamp': parseLineClamp,
};
