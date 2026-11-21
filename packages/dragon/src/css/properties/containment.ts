// css-contain-2 §2-§5 and css-sizing-4 §5.2: contain (initial none), content-visibility (visible), and contain-intrinsic-width,
// -height, -inline-size and -block-size (none) with the contain-intrinsic-size shorthand of -width and -height, none inherited
// (Chrome 145 css_properties.json5). contain takes every value Chrome 145 parses, computed to Chrome's serialization; what each
// containment does on a box is decided in analysis/containment.ts and lowered to the engine (LayoutStyle containLayout, containSize)
// and the paint tree. Dragon skips no contents yet, so content-visibility and the flow-relative intrinsic sizes accept their initial
// values alone and refuse every other value (analysis/scroll-containment.ts checkScrollContainment); contain-intrinsic-width and
// -height (and contain-intrinsic-size) take none, a length and auto with a fallback, which analysis/contain-intrinsic.ts checks.
import type { CssNode } from 'css-tree';
import type { ResolvedElement, ResolvedValue } from '../../analysis/resolve.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import type { LonghandValue } from '../stylesheet.ts';
import { normalizeUnit } from '../units.ts';
import { initialOnlyLonghand, kwInitial, nonInitial, ZERO_LENGTH } from './initial-only.ts';

export const CONTAINMENT_LONGHANDS = ['contain', 'content-visibility', 'contain-intrinsic-width', 'contain-intrinsic-height', 'contain-intrinsic-inline-size', 'contain-intrinsic-block-size'] as const;
export const CONTAINMENT_SHORTHANDS = ['contain-intrinsic-size'] as const;
export const CONTAINMENT_INHERITED: readonly (typeof CONTAINMENT_LONGHANDS)[number][] = [];
export const CONTAINMENT_CONTAINER: readonly (typeof CONTAINMENT_LONGHANDS)[number][] = [];
export const CONTAINMENT_TEXT_ROLE: readonly (typeof CONTAINMENT_LONGHANDS)[number][] = [];

type ContainmentLonghand = (typeof CONTAINMENT_LONGHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
// contain moves boxes (formatting context roots, containing blocks, size containment) and clips and restacks them (paint containment).
export const CONTAINMENT_ASPECTS = { ...Object.fromEntries(CONTAINMENT_LONGHANDS.map((p) => [p, PAINT_ONLY])), contain: { layout: true, paint: true } } as { readonly [P in ContainmentLonghand]: PropertyAspect };

/**
 * The longhands that accept their initial values alone: content-visibility and the flow-relative intrinsic sizes. contain has its own
 * parser, and contain-intrinsic-width and -height take the values parseIntrinsicSize reads (analysis/contain-intrinsic.ts).
 */
export const CONTAINMENT_INITIAL_ONLY = CONTAINMENT_LONGHANDS.filter((p) => p !== 'contain' && p !== 'contain-intrinsic-width' && p !== 'contain-intrinsic-height');

/** The physical intrinsic-size longhands Dragon lowers (LayoutStyle containIntrinsicWidth and containIntrinsicHeight). */
export const INTRINSIC_SIZE_PROPERTIES = ['contain-intrinsic-width', 'contain-intrinsic-height'] as const;

/** The value type of contain-intrinsic-width or -height: auto with a fallback of none or a length (css-sizing-4 §5.2). */
export const INTRINSIC_AUTO_TYPE = 'contain-intrinsic-auto';

/** Each longhand's initial value, the only one Dragon accepts. */
export const CONTAINMENT_INITIAL: { readonly [P in ContainmentLonghand]: CssValue } = {
  contain: kwInitial('none'),
  'content-visibility': kwInitial('visible'),
  'contain-intrinsic-width': kwInitial('none'),
  'contain-intrinsic-height': kwInitial('none'),
  'contain-intrinsic-inline-size': kwInitial('none'),
  'contain-intrinsic-block-size': kwInitial('none'),
};

/** css-contain-2 §2: the containment types of a computed contain value; size is the size containment, in both axes or the inline one. */
export type Containment = { readonly size: 'none' | 'inline-size' | 'size'; readonly layout: boolean; readonly style: boolean; readonly paint: boolean };

const NO_CONTAINMENT: Containment = { size: 'none', layout: false, style: false, paint: false };

/**
 * contain: none | strict | content | [ [size | inline-size] || layout || style || paint ], each keyword once and in any ASCII case.
 * It computes as Chrome 145 serializes it (ComputedStyleUtils::ValueForContain): the types in the order size or inline-size,
 * layout, style, paint, with size layout style paint written strict and layout style paint written content.
 */
function parseContain(tokens: readonly CssNode[]): ReturnType<InitialOnlyParser> {
  const words = tokens.map((t) => (t.type === 'Identifier' ? asciiLower(String(t['name'])) : null));
  if (words.length === 0 || words.some((w) => w === null)) return { kind: 'invalid' };
  const set = new Set(words as string[]);
  if (set.size !== words.length) return { kind: 'invalid', reason: 'contain names a containment type twice' };
  const one = (value: string): ReturnType<InitialOnlyParser> => ({ kind: 'ok', longhands: [{ property: 'contain', value: { kind: 'keyword', value }, explicit: true }] });
  if (words.length === 1 && (set.has('none') || set.has('strict') || set.has('content'))) return one(words[0] as string);
  const types = ['size', 'inline-size', 'layout', 'style', 'paint'];
  if ([...set].some((w) => !types.includes(w))) return { kind: 'invalid' };
  if (set.has('size') && set.has('inline-size')) return { kind: 'invalid', reason: 'contain takes size or inline-size, not both' };
  const text = types.filter((t) => set.has(t)).join(' ');
  return one(text === 'size layout style paint' ? 'strict' : text === 'layout style paint' ? 'content' : text);
}

/** The containment types an element's computed contain value names (the containment it asks for, before where it applies). */
export function containmentOf(el: Pick<ResolvedElement, 'props'>): Containment {
  const v = (el.props.get('contain') as ResolvedValue | undefined)?.value;
  if (v === undefined || v.kind !== 'keyword' || v.value === 'none') return NO_CONTAINMENT;
  const words = v.value === 'strict' ? ['size', 'layout', 'style', 'paint'] : v.value === 'content' ? ['layout', 'style', 'paint'] : v.value.split(' ');
  return { size: words.includes('size') ? 'size' : words.includes('inline-size') ? 'inline-size' : 'none', layout: words.includes('layout'), style: words.includes('style'), paint: words.includes('paint') };
}

/**
 * One contain-intrinsic-width or -height value from tokens[i]: none, a non-negative length (a unitless 0 is 0px), or auto followed by
 * none or a non-negative length (css-sizing-4 §5.2: auto? [none | <length [0,∞]>]), with the number of tokens it takes; null for
 * anything else.
 */
function intrinsicValueAt(tokens: readonly CssNode[], i: number): { readonly value: CssValue; readonly used: number } | null {
  const t = tokens[i];
  if (t === undefined) return null;
  const word = t.type === 'Identifier' ? asciiLower(String(t['name'])) : null;
  if (word === 'none') return { value: kwInitial('none'), used: 1 };
  const length = lengthOf(t);
  if (length !== null) return { value: length, used: 1 };
  if (word !== 'auto') return null;
  const next = tokens[i + 1];
  if (next !== undefined && next.type === 'Identifier' && asciiLower(String(next['name'])) === 'none') return { value: { kind: 'other', type: INTRINSIC_AUTO_TYPE, text: 'auto none' }, used: 2 };
  const fallback = next === undefined ? null : lengthOf(next);
  if (fallback === null || fallback.kind !== 'length') return null;
  return { value: { kind: 'other', type: INTRINSIC_AUTO_TYPE, text: `auto ${fallback.value}${fallback.unit}` }, used: 2 };
}

/** A non-negative length token as a CssValue length, a unitless 0 being 0px; null for anything else. */
function lengthOf(t: CssNode): CssValue | null {
  if (t.type === 'Number') return Number(t['value']) === 0 ? ZERO_LENGTH : null;
  if (t.type !== 'Dimension') return null;
  const value = Number(t['value']);
  return Number.isFinite(value) && value >= 0 ? { kind: 'length', value, unit: normalizeUnit(String(t['unit'])) } : null;
}

/**
 * contain-intrinsic-width or -height (one value) or the contain-intrinsic-size shorthand (one value for both, or width then height).
 * A spelling it does not read is kept as written, so the family check refuses it (never dropped where Chrome may keep it).
 */
function parseIntrinsicSize(longhands: readonly ('contain-intrinsic-width' | 'contain-intrinsic-height')[]): InitialOnlyParser {
  return (tokens) => {
    if (tokens.length === 0) return { kind: 'invalid', reason: `${longhands.length === 1 ? longhands[0] : 'contain-intrinsic-size'} needs a value` };
    const values: CssValue[] = [];
    let i = 0;
    while (i < tokens.length && values.length < longhands.length) {
      const v = intrinsicValueAt(tokens, i);
      if (v === null) break;
      values.push(v.value);
      i += v.used;
    }
    const read = i === tokens.length && values.length > 0;
    return { kind: 'ok', longhands: longhands.map((p, k): LonghandValue => ({ property: p, value: read ? (values[k] ?? (values[0] as CssValue)) : nonInitial(tokens), explicit: true })) };
  };
}

export const CONTAINMENT_VALUE_PARSERS: { readonly [P in ContainmentLonghand | (typeof CONTAINMENT_SHORTHANDS)[number]]: InitialOnlyParser } = {
  ...(Object.fromEntries(CONTAINMENT_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, CONTAINMENT_INITIAL[p])])) as { readonly [P in ContainmentLonghand]: InitialOnlyParser }),
  contain: parseContain,
  'contain-intrinsic-width': parseIntrinsicSize(['contain-intrinsic-width']),
  'contain-intrinsic-height': parseIntrinsicSize(['contain-intrinsic-height']),
  'contain-intrinsic-size': parseIntrinsicSize(['contain-intrinsic-width', 'contain-intrinsic-height']),
};
