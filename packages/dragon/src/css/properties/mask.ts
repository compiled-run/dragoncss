// The mask layer longhands (css-masking-1 §7) as Chrome 145 registers them (css_properties.json5: the mask shorthand's longhands, in
// its order), the mask shorthand and mask-position, which Chrome makes a shorthand of -webkit-mask-position-x and -y. None is
// inherited. Dragon accepts each longhand at its initial value, where Chrome paints nothing for it: with mask-image none no layer has
// an image, so no mask applies (ComputedStyle::HasMask). mask-image (and the mask shorthand) also takes one gradient (MASK-CLIP
// gradient masks): a linear or radial gradient Dragon draws as a background layer (analysis/paint-values/gradient.ts), with every
// length in px or an absolute unit, so the computed value needs no font size. With the other longhands initial, Chrome paints it
// as one border-box layer whose alpha masks the box (mask-mode match-source on a gradient is alpha). mask-composite also takes
// source-over, which only -webkit-mask-composite parses (aliases/mask.ts) and which composites one layer as add does. Every other
// value is kept and refused where it applies on every target (computed-checks.ts checkMask), since a mask image can hide text.
// The grammar takes any value (scripts/gen-css-grammar.ts), so Dragon never drops a declaration Chrome keeps.
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import type { GradientSpec } from '../../analysis/paint-values/gradient.ts';
import { imageItem, valueItems } from '../../analysis/paint-values/gradient.ts';
import type { Span } from '../../types.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

export const MASK_LONGHANDS = ['mask-image', '-webkit-mask-position-x', '-webkit-mask-position-y', 'mask-size', 'mask-repeat', 'mask-origin', 'mask-clip', 'mask-composite', 'mask-mode'] as const;
export const MASK_SHORTHANDS = ['mask', 'mask-position'] as const;
export const MASK_INHERITED: readonly (typeof MASK_LONGHANDS)[number][] = [];
export const MASK_CONTAINER: readonly (typeof MASK_LONGHANDS)[number][] = [];
export const MASK_TEXT_ROLE: readonly (typeof MASK_LONGHANDS)[number][] = [];

export type MaskLonghand = (typeof MASK_LONGHANDS)[number];

export const MASK_ASPECTS: { readonly [P in MaskLonghand]: PropertyAspect } = {
  'mask-image': { layout: false, paint: true },
  '-webkit-mask-position-x': { layout: false, paint: true },
  '-webkit-mask-position-y': { layout: false, paint: true },
  'mask-size': { layout: false, paint: true },
  'mask-repeat': { layout: false, paint: true },
  'mask-origin': { layout: false, paint: true },
  'mask-clip': { layout: false, paint: true },
  'mask-composite': { layout: false, paint: true },
  'mask-mode': { layout: false, paint: true },
};

/** Each longhand's initial value (the InitialValue of its Chrome 145 class, longhands_custom.cc), the only value Dragon accepts. */
export const MASK_INITIAL: { readonly [P in MaskLonghand]: CssValue } = {
  'mask-image': { kind: 'keyword', value: 'none' },
  '-webkit-mask-position-x': { kind: 'percentage', value: 0 },
  '-webkit-mask-position-y': { kind: 'percentage', value: 0 },
  'mask-size': { kind: 'keyword', value: 'auto' },
  'mask-repeat': { kind: 'keyword', value: 'repeat' },
  'mask-origin': { kind: 'keyword', value: 'border-box' },
  'mask-clip': { kind: 'keyword', value: 'border-box' },
  'mask-composite': { kind: 'keyword', value: 'add' },
  'mask-mode': { kind: 'keyword', value: 'match-source' },
};

/** The value type of a mask value other than the initial one (featureOf key <longhand>:<mask-layer-value>); checkMask refuses it. */
export const MASK_LAYER_VALUE_TYPE = 'mask-layer-value';

/** -webkit-mask-composite's legacy default operator (aliases/mask.ts): it composites as add does, and with mask-image none no mask applies. */
export const MASK_COMPOSITE_SOURCE_OVER = { kind: 'keyword', value: 'source-over' } as const satisfies CssValue;

/** Whether a computed mask longhand holds its initial value. */
export function isInitialMask(property: MaskLonghand, v: CssValue): boolean {
  const initial = MASK_INITIAL[property];
  if (initial.kind === 'keyword') return v.kind === 'keyword' && v.value === initial.value;
  return v.kind === 'percentage' && v.value === 0;
}

/** The gradient functions a mask image takes; conic gradients are refused like a background's (BG2-c). */
const MASK_GRADIENTS = new Set(['linear-gradient', 'radial-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient']);

/** Whether a node or one inside it is a length in a font-relative or other unit that only computes to px later, or a calculation. */
function needsCompute(n: CssNode): boolean {
  if (n.type === 'Dimension') {
    const unit = asciiLower(String(n['unit']));
    if (unit !== 'px' && unit !== 'deg' && unit !== 'grad' && unit !== 'rad' && unit !== 'turn' && unit !== 'cm' && unit !== 'mm' && unit !== 'q' && unit !== 'in' && unit !== 'pt' && unit !== 'pc') return true;
  }
  if (n.type === 'Function' && !MASK_GRADIENTS.has(asciiLower(String(n['name']))) && !['rgb', 'rgba', 'hsl', 'hsla', 'hwb'].includes(asciiLower(String(n['name'])))) return true;
  const kids = (n as { children?: { toArray(): CssNode[] } | null }).children;
  return kids !== undefined && kids !== null && kids.toArray().some(needsCompute);
}

/** The value of a mask image Dragon draws: one gradient function it parses, with no length left to compute; else null. */
function gradientValue(tokens: readonly CssNode[]): CssValue | null {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined || t.type !== 'Function') return null;
  const name = asciiLower(String(t['name']));
  if (!MASK_GRADIENTS.has(name) || needsCompute(t) || !imageItem([t]).ok) return null;
  return { kind: 'other', type: `${name}()`, text: generate(t) };
}

/** The gradient of a computed mask-image Dragon draws (gradientValue), or null for none or any other value. */
export function maskGradientOf(v: CssValue): GradientSpec | null {
  if (v.kind !== 'other' || !MASK_GRADIENTS.has(v.type.slice(0, -2))) return null;
  const items = valueItems(v);
  if (items.length !== 1) return null;
  const item = imageItem(items[0] as CssNode[]);
  return item.ok && item.value.kind === 'gradient' ? item.value.gradient : null;
}

/** Whether a computed mask longhand holds a value Dragon draws: an accepted value (isAcceptedMask), or a gradient mask-image. */
export function isDrawnMask(property: MaskLonghand, v: CssValue): boolean {
  return isAcceptedMask(property, v) || (property === 'mask-image' && maskGradientOf(v) !== null);
}

/** Whether a computed mask longhand holds a value Dragon accepts: its initial value, or mask-composite source-over. */
export function isAcceptedMask(property: MaskLonghand, v: CssValue): boolean {
  return isInitialMask(property, v) || (property === 'mask-composite' && v.kind === 'keyword' && v.value === MASK_COMPOSITE_SOURCE_OVER.value);
}

/** The property name a mask longhand's value is written under: source-over parses only through -webkit-mask-composite. */
export function maskDeclarationName(property: MaskLonghand, v: CssValue): string {
  return property === 'mask-composite' && v.kind === 'keyword' && v.value === MASK_COMPOSITE_SOURCE_OVER.value ? '-webkit-mask-composite' : property;
}

/** A mask value kept as written, which checkMask refuses. */
export const maskLayerOther = (tokens: readonly CssNode[]): CssValue => ({ kind: 'other', type: MASK_LAYER_VALUE_TYPE, text: tokens.map((t) => generate(t)).join(' ') });
const other = maskLayerOther;

/** The initial spelling a longhand accepts: its one keyword in any ASCII case, or 0% (unsigned) for the position axes. */
function isInitialSpelling(property: MaskLonghand, t: CssNode | undefined): boolean {
  if (t === undefined) return false;
  const initial = MASK_INITIAL[property];
  if (initial.kind === 'keyword') return t.type === 'Identifier' && asciiLower(String(t['name'])) === initial.value;
  return t.type === 'Percentage' && Number(t['value']) === 0 && !String(t['value']).startsWith('-');
}

/** One longhand: its initial spelling as the initial value, or the written text of anything else, which checkMask refuses. */
function parseLonghand(property: MaskLonghand): (tokens: readonly CssNode[], base: Span) => ParsedValue {
  return (tokens) => {
    if (tokens.length === 0) return { kind: 'invalid', reason: `${property} needs a value` };
    const value = tokens.length === 1 && isInitialSpelling(property, tokens[0]) ? MASK_INITIAL[property] : ((property === 'mask-image' ? gradientValue(tokens) : null) ?? other(tokens));
    return { kind: 'ok', longhands: [{ property, value, explicit: true }] };
  };
}

/** mask-position: 0% 0% sets both axes to their initial value; anything else is kept on both axes and refused. */
export function parseMaskPosition(tokens: readonly CssNode[], _base: Span): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'mask-position needs a value' };
  const initial = tokens.length === 2 && isInitialSpelling('-webkit-mask-position-x', tokens[0]) && isInitialSpelling('-webkit-mask-position-y', tokens[1]);
  const axis = (p: '-webkit-mask-position-x' | '-webkit-mask-position-y'): LonghandValue => ({ property: p, value: initial ? MASK_INITIAL[p] : other(tokens), explicit: true });
  return { kind: 'ok', longhands: [axis('-webkit-mask-position-x'), axis('-webkit-mask-position-y')] };
}

/**
 * mask: none, or one gradient alone, sets mask-image to it and every other longhand to its initial value, as Chrome expands it;
 * anything else is kept on mask-image and refused.
 */
export function parseMask(tokens: readonly CssNode[], _base: Span): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'mask needs a value' };
  const none = tokens.length === 1 && isInitialSpelling('mask-image', tokens[0]);
  const image = none ? MASK_INITIAL['mask-image'] : (gradientValue(tokens) ?? other(tokens));
  return {
    kind: 'ok',
    longhands: MASK_LONGHANDS.map((p): LonghandValue => (p === 'mask-image' ? { property: p, value: image, explicit: true } : { property: p, value: MASK_INITIAL[p], explicit: false })),
  };
}

/** The value parsers of the mask family (the paint value hook, css/paint-parsers.ts). */
export const MASK_VALUE_PARSERS: { readonly [P in MaskLonghand | (typeof MASK_SHORTHANDS)[number]]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'mask-image': parseLonghand('mask-image'),
  '-webkit-mask-position-x': parseLonghand('-webkit-mask-position-x'),
  '-webkit-mask-position-y': parseLonghand('-webkit-mask-position-y'),
  'mask-size': parseLonghand('mask-size'),
  'mask-repeat': parseLonghand('mask-repeat'),
  'mask-origin': parseLonghand('mask-origin'),
  'mask-clip': parseLonghand('mask-clip'),
  'mask-composite': parseLonghand('mask-composite'),
  'mask-mode': parseLonghand('mask-mode'),
  mask: parseMask,
  'mask-position': parseMaskPosition,
};
