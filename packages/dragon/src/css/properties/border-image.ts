// The border image longhands (css-backgrounds-3 §4) as Chrome 145 registers them (css_properties.json5: the border-image shorthand's
// longhands, in its order), the border-image shorthand and -webkit-border-image. None is inherited. Dragon draws no border image yet (coverage-rank lane
// MISC-PAINT), so it accepts each longhand only at its initial value, where Chrome paints nothing for it: with border-image-source
// none there is no image, so the border paints as border-style says (ComputedStyle::BorderImage). Every other value is kept and refused
// on every target (computed-checks.ts checkBorderImage). The grammar takes any value (scripts/gen-css-grammar.ts), so Dragon never
// drops a declaration Chrome keeps.
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

export const BORDER_IMAGE_LONGHANDS = ['border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat'] as const;
// -webkit-border-image is no alias in Chrome but a legacy overlapping longhand that sets every border image longhand at once
// (longhands_custom.cc WebkitBorderImage::ApplyValue), so it is the family's own shorthand here, as -webkit-border-radius is the
// radius family's. It parses with an implied fill and sets the border widths from lengths (css_to_style_map.cc MapNinePieceImage),
// and none, the one value Dragon accepts, sets the initial border image and no width.
export const BORDER_IMAGE_SHORTHANDS = ['border-image', '-webkit-border-image'] as const;
export const BORDER_IMAGE_INHERITED: readonly (typeof BORDER_IMAGE_LONGHANDS)[number][] = [];
export const BORDER_IMAGE_CONTAINER: readonly (typeof BORDER_IMAGE_LONGHANDS)[number][] = [];
export const BORDER_IMAGE_TEXT_ROLE: readonly (typeof BORDER_IMAGE_LONGHANDS)[number][] = [];

export type BorderImageLonghand = (typeof BORDER_IMAGE_LONGHANDS)[number];

export const BORDER_IMAGE_ASPECTS: { readonly [P in BorderImageLonghand]: PropertyAspect } = {
  'border-image-source': { layout: false, paint: true },
  'border-image-slice': { layout: false, paint: true },
  'border-image-width': { layout: false, paint: true },
  'border-image-outset': { layout: false, paint: true },
  'border-image-repeat': { layout: false, paint: true },
};

/** Each longhand's initial value (the InitialValue of its Chrome 145 class, longhands_custom.cc), the only value Dragon accepts. */
export const BORDER_IMAGE_INITIAL: { readonly [P in BorderImageLonghand]: CssValue } = {
  'border-image-source': { kind: 'keyword', value: 'none' },
  'border-image-slice': { kind: 'percentage', value: 100 },
  'border-image-width': { kind: 'number', value: 1 },
  'border-image-outset': { kind: 'number', value: 0 },
  'border-image-repeat': { kind: 'keyword', value: 'stretch' },
};

/** The value type of a border image value other than the initial one (featureOf key <longhand>:<border-image-value>). */
export const BORDER_IMAGE_VALUE_TYPE = 'border-image-value';

/** Whether a computed border image longhand holds its initial value. */
export function isInitialBorderImage(property: BorderImageLonghand, v: CssValue): boolean {
  const initial = BORDER_IMAGE_INITIAL[property];
  if (initial.kind === 'keyword') return v.kind === 'keyword' && v.value === initial.value;
  if (initial.kind === 'percentage') return v.kind === 'percentage' && v.value === initial.value;
  return initial.kind === 'number' && v.kind === 'number' && v.value === initial.value;
}

const other = (tokens: readonly CssNode[]): CssValue => ({ kind: 'other', type: BORDER_IMAGE_VALUE_TYPE, text: tokens.map((t) => generate(t)).join(' ') });

/**
 * The initial spelling a longhand accepts: its one keyword in any ASCII case, 100% for the slice, or the unsigned plain number 1 or 0
 * for the width and outset (a 0px outset computes to 0px in Chrome, not to the initial 0, so it is kept and refused).
 */
function isInitialSpelling(property: BorderImageLonghand, t: CssNode | undefined): boolean {
  if (t === undefined) return false;
  const initial = BORDER_IMAGE_INITIAL[property];
  if (initial.kind === 'keyword') return t.type === 'Identifier' && asciiLower(String(t['name'])) === initial.value;
  const text = String(t['value']);
  if (/^[-+]/.test(text)) return false;
  if (initial.kind === 'percentage') return t.type === 'Percentage' && Number(text) === initial.value;
  return initial.kind === 'number' && t.type === 'Number' && Number(text) === initial.value;
}

/** One longhand: its initial spelling as the initial value, or the written text of anything else, which checkBorderImage refuses. */
function parseLonghand(property: BorderImageLonghand): (tokens: readonly CssNode[], base: Span) => ParsedValue {
  return (tokens) => {
    if (tokens.length === 0) return { kind: 'invalid', reason: `${property} needs a value` };
    const value = tokens.length === 1 && isInitialSpelling(property, tokens[0]) ? BORDER_IMAGE_INITIAL[property] : other(tokens);
    return { kind: 'ok', longhands: [{ property, value, explicit: true }] };
  };
}

/**
 * border-image: none (and -webkit-border-image: none) sets border-image-source none and every other longhand to its initial value, as
 * Chrome expands it (shorthands_custom.cc BorderImage::ParseShorthand); anything else is kept on border-image-source and refused.
 */
function parseBorderImage(name: (typeof BORDER_IMAGE_SHORTHANDS)[number]): (tokens: readonly CssNode[], base: Span) => ParsedValue {
  return (tokens) => {
    if (tokens.length === 0) return { kind: 'invalid', reason: `${name} needs a value` };
    const none = tokens.length === 1 && isInitialSpelling('border-image-source', tokens[0]);
    return {
      kind: 'ok',
      longhands: BORDER_IMAGE_LONGHANDS.map((p): LonghandValue => (p === 'border-image-source' ? { property: p, value: none ? BORDER_IMAGE_INITIAL[p] : other(tokens), explicit: true } : { property: p, value: BORDER_IMAGE_INITIAL[p], explicit: false })),
    };
  };
}

/** The value parsers of the border image family (the paint value hook, css/paint-parsers.ts). */
export const BORDER_IMAGE_VALUE_PARSERS: { readonly [P in BorderImageLonghand | (typeof BORDER_IMAGE_SHORTHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'border-image-source': parseLonghand('border-image-source'),
  'border-image-slice': parseLonghand('border-image-slice'),
  'border-image-width': parseLonghand('border-image-width'),
  'border-image-outset': parseLonghand('border-image-outset'),
  'border-image-repeat': parseLonghand('border-image-repeat'),
  'border-image': parseBorderImage('border-image'),
  '-webkit-border-image': parseBorderImage('-webkit-border-image'),
};
