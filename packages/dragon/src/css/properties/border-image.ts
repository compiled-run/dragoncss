// The border image longhands (css-backgrounds-3 §4) as Chrome 145 registers them (css_properties.json5: the border-image shorthand's
// longhands, in its order), the border-image shorthand and -webkit-border-image. None is inherited. Each longhand keeps its initial
// spelling as the initial value and any other value of its grammar as a typed value (featureOf <longhand>:<type>) that
// analysis/border-image.ts reads, accepts or refuses by name (MISC-PAINT); a value outside the grammar is kept under the generic
// type and refused on every target. The grammar takes any value (scripts/gen-css-grammar.ts), so Dragon never drops a declaration
// Chrome keeps.
import type { CssNode } from 'css-tree';
import { generate, parse } from 'css-tree';
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

/** Each longhand's initial value (the InitialValue of its Chrome 145 class, longhands_custom.cc). */
export const BORDER_IMAGE_INITIAL: { readonly [P in BorderImageLonghand]: CssValue } = {
  'border-image-source': { kind: 'keyword', value: 'none' },
  'border-image-slice': { kind: 'percentage', value: 100 },
  'border-image-width': { kind: 'number', value: 1 },
  'border-image-outset': { kind: 'number', value: 0 },
  'border-image-repeat': { kind: 'keyword', value: 'stretch' },
};

/** The value type of a border image value outside its longhand's grammar (featureOf key <longhand>:<border-image-value>), refused. */
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

/**
 * The value types of the non-initial values Dragon reads (featureOf key <longhand>:<type>): a source image names its function
 * (linear-gradient() and the others, url()), and each other longhand has one type for any value of its grammar.
 */
export const BORDER_IMAGE_TYPES = { slice: 'slice', width: 'widths', outset: 'outsets', repeat: 'repeat' } as const;

const IMAGE_FUNCTIONS = new Set(['linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient', 'image-set', '-webkit-image-set', 'cross-fade', '-webkit-cross-fade', 'paint', '-webkit-gradient', '-webkit-linear-gradient', '-webkit-radial-gradient', '-webkit-repeating-linear-gradient', '-webkit-repeating-radial-gradient', 'light-dark']);
const REPEATS = new Set(['stretch', 'repeat', 'round', 'space']);
const ident = (t: CssNode | undefined): string | null => (t !== undefined && t.type === 'Identifier' ? asciiLower(String(t['name'])) : null);
const isSlash = (t: CssNode | undefined): boolean => t !== undefined && t.type === 'Operator' && t['value'] === '/';
const nonNegative = (t: CssNode): boolean => Number(t['value']) >= 0;
const isNumber = (t: CssNode | undefined): t is CssNode => t !== undefined && t.type === 'Number' && nonNegative(t);
const isPercent = (t: CssNode | undefined): t is CssNode => t !== undefined && t.type === 'Percentage' && nonNegative(t);
/** A non-negative <length>: a dimension of any unit Chrome may take as a length (the check refuses every unit but px by name). */
const isLength = (t: CssNode | undefined): t is CssNode => t !== undefined && t.type === 'Dimension' && nonNegative(t) && /^[a-z]+$/i.test(String(t['unit']));
const isImage = (t: CssNode | undefined): t is CssNode => t !== undefined && (t.type === 'Url' || (t.type === 'Function' && IMAGE_FUNCTIONS.has(asciiLower(String(t['name'])))));

/** A run of tokens from i that one component takes, or 0: up to four of `one`, then (a slice) fill on either side. */
function run(tokens: readonly CssNode[], i: number, one: (t: CssNode | undefined) => boolean, fill: boolean): number {
  let k = i;
  let filled = false;
  if (fill && ident(tokens[k]) === 'fill') {
    filled = true;
    k++;
  }
  const first = k;
  while (k - first < 4 && one(tokens[k])) k++;
  if (k === first) return 0;
  if (fill && !filled && ident(tokens[k]) === 'fill') k++;
  return k - i;
}

const sliceItem = (t: CssNode | undefined): boolean => isNumber(t) || isPercent(t);
const widthItem = (t: CssNode | undefined): boolean => isNumber(t) || isPercent(t) || isLength(t) || ident(t) === 'auto';
const outsetItem = (t: CssNode | undefined): boolean => isNumber(t) || isLength(t);
const repeatItem = (t: CssNode | undefined): boolean => REPEATS.has(ident(t) ?? '');

const text = (tokens: readonly CssNode[]): string => tokens.map((t) => generate(t)).join(' ');

/** A longhand's value from its whole token list, or null where the longhand's grammar does not take it. */
function longhandValue(property: BorderImageLonghand, tokens: readonly CssNode[]): CssValue | null {
  if (tokens.length === 1 && isInitialSpelling(property, tokens[0])) return BORDER_IMAGE_INITIAL[property];
  switch (property) {
    case 'border-image-source': {
      const [t, extra] = tokens;
      if (extra !== undefined || !isImage(t)) return null;
      return { kind: 'other', type: t.type === 'Url' ? 'url()' : `${asciiLower(String(t['name']))}()`, text: generate(t) };
    }
    case 'border-image-slice':
      return run(tokens, 0, sliceItem, true) === tokens.length ? { kind: 'other', type: BORDER_IMAGE_TYPES.slice, text: text(tokens) } : null;
    case 'border-image-width':
      return run(tokens, 0, widthItem, false) === tokens.length ? { kind: 'other', type: BORDER_IMAGE_TYPES.width, text: text(tokens) } : null;
    case 'border-image-outset':
      return run(tokens, 0, outsetItem, false) === tokens.length ? { kind: 'other', type: BORDER_IMAGE_TYPES.outset, text: text(tokens) } : null;
    case 'border-image-repeat':
      return tokens.length <= 2 && run(tokens, 0, repeatItem, false) === tokens.length ? { kind: 'other', type: BORDER_IMAGE_TYPES.repeat, text: text(tokens) } : null;
  }
}

/**
 * One longhand: its initial spelling as the initial value; a value of its grammar as a typed value the check reads; anything else
 * as written under the generic type, which checkBorderImage refuses (the grammar takes any value, so nothing Chrome keeps is dropped).
 */
function parseLonghand(property: BorderImageLonghand): (tokens: readonly CssNode[], base: Span) => ParsedValue {
  return (tokens) => {
    if (tokens.length === 0) return { kind: 'invalid', reason: `${property} needs a value` };
    return { kind: 'ok', longhands: [{ property, value: longhandValue(property, tokens) ?? other(tokens), explicit: true }] };
  };
}

/**
 * Chrome's ConsumeBorderImageComponents (css_parsing_utils.cc): <source> || <slice> [ / <width> | / <width>? / <outset> ]? ||
 * <repeat>, each at most once, in any order; the longhands it leaves out are reset to their initial values. Null where it does
 * not take the tokens.
 */
function borderImageComponents(tokens: readonly CssNode[]): { readonly [P in BorderImageLonghand]?: readonly CssNode[] } | null {
  const out: { [P in BorderImageLonghand]?: readonly CssNode[] } = {};
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (out['border-image-source'] === undefined && (isImage(t) || ident(t) === 'none')) {
      out['border-image-source'] = [t as CssNode];
      i++;
      continue;
    }
    const r = out['border-image-repeat'] === undefined ? Math.min(2, run(tokens, i, repeatItem, false)) : 0;
    if (r > 0) {
      out['border-image-repeat'] = tokens.slice(i, i + r);
      i += r;
      continue;
    }
    const s = out['border-image-slice'] === undefined ? run(tokens, i, sliceItem, true) : 0;
    if (s === 0) return null;
    out['border-image-slice'] = tokens.slice(i, i + s);
    i += s;
    if (!isSlash(tokens[i])) continue;
    i++;
    const w = run(tokens, i, widthItem, false);
    if (w > 0) out['border-image-width'] = tokens.slice(i, i + w);
    i += w;
    if (!isSlash(tokens[i])) {
      if (w === 0) return null;
      continue;
    }
    i++;
    const o = run(tokens, i, outsetItem, false);
    if (o === 0) return null;
    out['border-image-outset'] = tokens.slice(i, i + o);
    i += o;
  }
  return out;
}

/**
 * border-image: each component Chrome's grammar takes sets its longhand (as that longhand parses it) and the rest are reset to their
 * initial values (shorthands_custom.cc BorderImage::ParseShorthand). -webkit-border-image, and a border-image value the grammar does
 * not take, keep the old reading: none sets every longhand initial, and anything else is kept as written on every longhand and
 * refused, so a value Dragon does not read is over-refused, never accepted (-webkit-border-image also sets the border widths and
 * an implied fill, which Dragon does not model).
 */
function parseBorderImage(name: (typeof BORDER_IMAGE_SHORTHANDS)[number]): (tokens: readonly CssNode[], base: Span) => ParsedValue {
  return (tokens) => {
    if (tokens.length === 0) return { kind: 'invalid', reason: `${name} needs a value` };
    const none = tokens.length === 1 && isInitialSpelling('border-image-source', tokens[0]);
    const parts = name === 'border-image' && !none ? borderImageComponents(tokens) : null;
    if (parts !== null) {
      const values = BORDER_IMAGE_LONGHANDS.map((p) => {
        const part = parts[p];
        return part === undefined ? BORDER_IMAGE_INITIAL[p] : longhandValue(p, part);
      });
      if (values.every((v) => v !== null)) {
        return { kind: 'ok', longhands: BORDER_IMAGE_LONGHANDS.map((p, k): LonghandValue => ({ property: p, value: values[k] as CssValue, explicit: parts[p] !== undefined })) };
      }
    }
    return {
      kind: 'ok',
      // Anything but none marks every longhand non-initial, so that a value Dragon does not read is over-refused, never accepted.
      longhands: BORDER_IMAGE_LONGHANDS.map((p): LonghandValue => ({ property: p, value: none ? BORDER_IMAGE_INITIAL[p] : other(tokens), explicit: p === 'border-image-source' || !none })),
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

/** A border-image-slice side: a <number> (image px) or a <percentage> of the image's size (paint-gradient.ts BorderImageSlice). */
export type SliceSide = { readonly unit: 'number' | 'percent'; readonly value: number };
/** A border-image-width or -outset side: a multiple of the border width, a length (unit as written), a percentage, or auto. */
export type ExtentSide = { readonly unit: 'number' | 'percent' | 'auto' | 'length'; readonly value: number; readonly lengthUnit: string };
export type RepeatKeyword = 'stretch' | 'repeat' | 'round' | 'space';

/** A computed border image read into its parts: each side list top, right, bottom, left (css-backgrounds-3 §6, the 1-to-4 rule). */
export type BorderImageParts = {
  readonly source: CssNode | null;
  readonly slices: readonly SliceSide[];
  readonly fill: boolean;
  readonly widths: readonly ExtentSide[];
  readonly outsets: readonly ExtentSide[];
  readonly repeat: readonly [RepeatKeyword, RepeatKeyword];
};

/** The value's tokens: an initial value's own, or the parsed text of a kept one. */
function tokensOf(v: CssValue): CssNode[] {
  switch (v.kind) {
    case 'other': {
      const root = parse(v.text, { context: 'value' }) as unknown as { children: { toArray(): CssNode[] } };
      return root.children.toArray().filter((n) => n.type !== 'WhiteSpace');
    }
    case 'keyword':
      return [{ type: 'Identifier', name: v.value } as unknown as CssNode];
    case 'number':
      return [{ type: 'Number', value: String(v.value) } as unknown as CssNode];
    case 'percentage':
      return [{ type: 'Percentage', value: String(v.value) } as unknown as CssNode];
    default:
      return [];
  }
}

/** The 1-to-4 rule: top, right (top), bottom (top), left (right). */
function sides<T>(items: readonly T[]): readonly T[] {
  const [t, r = t, b = t, l = r] = items;
  return [t, r, b, l] as T[];
}

function extent(t: CssNode): ExtentSide {
  if (t.type === 'Identifier') return { unit: 'auto', value: 0, lengthUnit: '' };
  if (t.type === 'Number') return { unit: 'number', value: Number(t['value']), lengthUnit: '' };
  if (t.type === 'Percentage') return { unit: 'percent', value: Number(t['value']), lengthUnit: '' };
  return { unit: 'length', value: Number(t['value']), lengthUnit: asciiLower(String(t['unit'])) };
}

/**
 * The computed border image of an element's five longhands, or the first longhand Dragon cannot read (a value kept under the
 * generic type: outside the grammar, a CSS-wide keyword's text, or a var() that never resolved).
 */
export function borderImageParts(value: (p: BorderImageLonghand) => CssValue): { readonly ok: true; readonly parts: BorderImageParts } | { readonly ok: false; readonly property: BorderImageLonghand } {
  for (const p of BORDER_IMAGE_LONGHANDS) {
    const v = value(p);
    if (v.kind === 'other' && v.type === BORDER_IMAGE_VALUE_TYPE) return { ok: false, property: p };
  }
  const source = tokensOf(value('border-image-source'));
  const slice = tokensOf(value('border-image-slice'));
  const width = tokensOf(value('border-image-width'));
  const outset = tokensOf(value('border-image-outset'));
  const repeat = tokensOf(value('border-image-repeat')).map((t) => ident(t) as RepeatKeyword);
  const first = source[0];
  const numbers = slice.filter((t) => t.type !== 'Identifier');
  if (numbers.length === 0 || width.length === 0 || outset.length === 0 || repeat.length === 0) return { ok: false, property: numbers.length === 0 ? 'border-image-slice' : width.length === 0 ? 'border-image-width' : outset.length === 0 ? 'border-image-outset' : 'border-image-repeat' };
  return {
    ok: true,
    parts: {
      source: first === undefined || ident(first) === 'none' ? null : first,
      slices: sides(numbers.map((t): SliceSide => ({ unit: t.type === 'Percentage' ? 'percent' : 'number', value: Number(t['value']) }))),
      fill: slice.some((t) => ident(t) === 'fill'),
      widths: sides(width.map(extent)),
      outsets: sides(outset.map(extent)),
      repeat: [repeat[0] as RepeatKeyword, (repeat[1] ?? repeat[0]) as RepeatKeyword],
    },
  };
}
