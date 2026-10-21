// css-scroll-snap-1 §4-§6: the physical scroll-padding longhands (auto | <length-percentage [0,∞]>, initial auto), the physical
// scroll-margin longhands (<length>, initial 0), scroll-snap-type (none), scroll-snap-align (none) and scroll-snap-stop (normal),
// none inherited (Chrome 145 css_properties.json5). The flow-relative names and the box shorthands map onto the physical longhands
// (shorthands/scroll-snap.ts), as padding-inline-start maps onto padding-left or padding-right, so the web output writes the
// cascade's winner and a later physical declaration beats an earlier logical one as in Chrome. The padding and margin lengths and
// scroll-snap-stop take the generic parse with the real grammar; snap-type and snap-align are one value of up to two keywords,
// parsed here. Dragon snaps nothing and offsets no scroll target yet, so the analysis refuses an active snap pair on iOS and
// Android (analysis/scroll-containment.ts checkScrollSnap) and accepts every value everywhere else, where Chrome snaps nothing.
import type { CssNode } from 'css-tree';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import type { Span } from '../../types.ts';
import type { CssValue } from '../values.ts';
import { kwInitial, ZERO_LENGTH } from './initial-only.ts';

const PADDING = ['scroll-padding-top', 'scroll-padding-right', 'scroll-padding-bottom', 'scroll-padding-left'] as const;
const MARGIN = ['scroll-margin-top', 'scroll-margin-right', 'scroll-margin-bottom', 'scroll-margin-left'] as const;

export const SCROLL_SNAP_LONGHANDS = [...PADDING, ...MARGIN, 'scroll-snap-type', 'scroll-snap-align', 'scroll-snap-stop'] as const;
export const SCROLL_SNAP_SHORTHANDS = [
  'scroll-padding', 'scroll-padding-inline', 'scroll-padding-block', 'scroll-padding-inline-start', 'scroll-padding-inline-end', 'scroll-padding-block-start', 'scroll-padding-block-end',
  'scroll-margin', 'scroll-margin-inline', 'scroll-margin-block', 'scroll-margin-inline-start', 'scroll-margin-inline-end', 'scroll-margin-block-start', 'scroll-margin-block-end',
] as const;
export const SCROLL_SNAP_INHERITED: readonly (typeof SCROLL_SNAP_LONGHANDS)[number][] = [];
export const SCROLL_SNAP_CONTAINER: readonly (typeof SCROLL_SNAP_LONGHANDS)[number][] = [];
export const SCROLL_SNAP_TEXT_ROLE: readonly (typeof SCROLL_SNAP_LONGHANDS)[number][] = [];

type ScrollSnapLonghand = (typeof SCROLL_SNAP_LONGHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
export const SCROLL_SNAP_ASPECTS = Object.fromEntries(SCROLL_SNAP_LONGHANDS.map((p) => [p, PAINT_ONLY])) as { readonly [P in ScrollSnapLonghand]: PropertyAspect };

/** Each longhand's initial value. */
export const SCROLL_SNAP_INITIAL = Object.fromEntries(SCROLL_SNAP_LONGHANDS.map((p) => [p, p.startsWith('scroll-padding-') ? kwInitial('auto') : p.startsWith('scroll-margin-') ? ZERO_LENGTH : kwInitial(p === 'scroll-snap-stop' ? 'normal' : 'none')])) as { readonly [P in ScrollSnapLonghand]: CssValue };

const SNAP_AXES: ReadonlySet<string> = new Set(['x', 'y', 'block', 'inline', 'both']);
const SNAP_STRICTNESS: ReadonlySet<string> = new Set(['mandatory', 'proximity']);
const SNAP_ALIGNMENTS: ReadonlySet<string> = new Set(['none', 'start', 'end', 'center']);

const single = (property: ScrollSnapLonghand, value: string): ParsedValue => ({ kind: 'ok', longhands: [{ property, value: { kind: 'keyword', value }, explicit: true } as LonghandValue] });

/** The ASCII-lowercase identifiers of tokens, or null when one is not an identifier. */
function identifiers(tokens: readonly CssNode[]): string[] | null {
  const names = tokens.map((t) => (t.type === 'Identifier' ? asciiLower(String(t['name'])) : null));
  return names.every((n): n is string => n !== null) ? names : null;
}

/**
 * Blink ScrollSnapType::ParseSingleValue (longhands_custom.cc): none, or an axis and an optional strictness, as one keyword. The
 * strictness defaults to proximity, which Chrome 145 serialises away (x proximity computes to x), so it is dropped here too.
 */
export function parseScrollSnapType(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const invalid: ParsedValue = { kind: 'invalid', reason: 'scroll-snap-type is none, or x, y, block, inline or both and an optional mandatory or proximity' };
  const names = identifiers(tokens);
  if (names === null || names.length === 0 || names.length > 2) return invalid;
  const [axis, strictness] = names as [string, string?];
  if (axis === 'none') return names.length === 1 ? single('scroll-snap-type', 'none') : invalid;
  if (!SNAP_AXES.has(axis) || (strictness !== undefined && !SNAP_STRICTNESS.has(strictness))) return invalid;
  return single('scroll-snap-type', strictness === 'mandatory' ? `${axis} mandatory` : axis);
}

/** Blink ScrollSnapAlign::ParseSingleValue: one or two of none, start, end and center (block then inline); two equal ones compute to one. */
export function parseScrollSnapAlign(tokens: readonly CssNode[], _base: Span): ParsedValue {
  const names = identifiers(tokens);
  if (names === null || names.length === 0 || names.length > 2 || !names.every((n) => SNAP_ALIGNMENTS.has(n))) return { kind: 'invalid', reason: 'scroll-snap-align is one or two of none, start, end and center' };
  return single('scroll-snap-align', names.length === 2 && names[0] === names[1] ? (names[0] as string) : names.join(' '));
}

export const SCROLL_SNAP_VALUE_PARSERS: { readonly [P in 'scroll-snap-type' | 'scroll-snap-align']: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'scroll-snap-type': parseScrollSnapType,
  'scroll-snap-align': parseScrollSnapAlign,
};

/** A computed scroll-snap-type that snaps, as written (x mandatory, both), or null for none. */
export function snapTypeOf(v: CssValue): string | null {
  return v.kind === 'keyword' && v.value !== 'none' ? v.value : null;
}

/** Whether a computed scroll-snap-align aligns the box on either axis. */
export function alignsSnap(v: CssValue): boolean {
  return v.kind !== 'keyword' || v.value.split(' ').some((a) => a !== 'none');
}
