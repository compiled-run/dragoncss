// Shared box-model resolution: padding, border, margins, box-sizing and min/max (CSS2 §8, §10.4, §10.7; css-sizing-3).
import type { BoxSizing, LayoutBox, LayoutStyle, MarginValue, MaxSizeValue, MinSizeValue, PaddingValue, SizeValue } from './input.ts';
import type { LU } from './units.ts';
import { add, clampNegativeToZero, fromCssPx, max, min, percentOf, snapBorderWidth, sub, ZERO } from './units.ts';
import { unsupported } from './unsupported.ts';

export type Edges = { readonly top: LU; readonly right: LU; readonly bottom: LU; readonly left: LU };

/** baseline: the first baseline (css-align-3 §9.1) as an offset from the border-box top, or null when the box has none. */
export type Frag = { readonly id: string; readonly width: LU; readonly height: LU; readonly baseline: LU | null; readonly children: readonly Placed[] };
export type Placed = { readonly frag: Frag; readonly x: LU; readonly y: LU };

/** How a box's percentage block sizes can resolve against its containing block. */
export type HeightBasis =
  | { readonly kind: 'indefinite' }
  | { readonly kind: 'definite'; readonly value: LU }
  | { readonly kind: 'flex-dependent' };

export const INDEFINITE: HeightBasis = { kind: 'indefinite' };

// CSS2 §8.4: percentage padding refers to the containing block's width.
export function resolvePadding(style: LayoutStyle, cbInline: LU): Edges {
  const one = (v: PaddingValue): LU => (v.kind === 'px' ? fromCssPx(v.value) : percentOf(cbInline, v.value));
  return {
    top: one(style.paddingTop),
    right: one(style.paddingRight),
    bottom: one(style.paddingBottom),
    left: one(style.paddingLeft),
  };
}

// CSS2 §8.5.1: border widths arrive as computed px (zero when the style is none) and snap to the environment's device px.
export function resolveBorder(style: LayoutStyle, devicePixelRatio: number): Edges {
  return {
    top: snapBorderWidth(style.borderTopWidth.value, devicePixelRatio),
    right: snapBorderWidth(style.borderRightWidth.value, devicePixelRatio),
    bottom: snapBorderWidth(style.borderBottomWidth.value, devicePixelRatio),
    left: snapBorderWidth(style.borderLeftWidth.value, devicePixelRatio),
  };
}

export type MarginResolved = { readonly value: LU; readonly auto: boolean };

// CSS2 §8.3: percentage margins refer to the containing block's width, for vertical margins too.
export function resolveMargin(v: MarginValue, cbInline: LU): MarginResolved {
  if (v.kind === 'auto') return { value: ZERO, auto: true };
  if (v.kind === 'px') return { value: fromCssPx(v.value), auto: false };
  return { value: percentOf(cbInline, v.value), auto: false };
}

export function sumEdges(a: LU, b: LU, c: LU, d: LU): LU {
  return add(add(a, b), add(c, d));
}

// css-sizing-3 §4 box-sizing: a specified size is the content box or the border box; the border box never drops below border+padding.
export function borderBoxFromSpecified(value: LU, borderPadding: LU, boxSizing: BoxSizing): LU {
  if (boxSizing === 'content-box') return add(clampNegativeToZero(value), borderPadding);
  return max(value, borderPadding);
}

/** A width-like length resolved against a definite inline basis; null for auto. */
export function resolveInlineLength(v: SizeValue | MinSizeValue, basis: LU): LU | null {
  if (v.kind === 'auto') return null;
  if (v.kind === 'px') return fromCssPx(v.value);
  return percentOf(basis, v.value);
}

export function resolveMaxInlineLength(v: MaxSizeValue, basis: LU): LU | null {
  if (v.kind === 'none') return null;
  if (v.kind === 'px') return fromCssPx(v.value);
  return percentOf(basis, v.value);
}

export type MinMax = { readonly min: LU; readonly max: LU | null };

/** Blink ConstrainByMinMax: max(min, min(value, max)); min wins. */
export function constrain(value: LU, mm: MinMax): LU {
  const capped = mm.max === null ? value : min(value, mm.max);
  return max(mm.min, capped);
}

// CSS2 §10.4 min-width/max-width in border-box terms; min-width auto is 0 outside flex items.
export function inlineMinMax(style: LayoutStyle, cbInline: LU, borderPadding: LU): MinMax {
  const lo = resolveInlineLength(style.minWidth, cbInline);
  const hi = resolveMaxInlineLength(style.maxWidth, cbInline);
  return {
    min: lo === null ? borderPadding : borderBoxFromSpecified(lo, borderPadding, style.boxSizing),
    max: hi === null ? null : borderBoxFromSpecified(hi, borderPadding, style.boxSizing),
  };
}

/**
 * CSS2 §10.5: the basis for a height-like percentage, or null when the containing block's height is indefinite (the
 * percentage then behaves as auto, 0 or none). A flexed or stretched size that §9.8 does not make definite is refused.
 */
function percentBlockBasis(box: LayoutBox, basis: HeightBasis, prop: string): LU | null {
  if (basis.kind === 'definite') return basis.value;
  if (basis.kind === 'flex-dependent') {
    unsupported('percent-height-flex', box.id, 'css-flexbox-1 §9.8', `${prop} percentage against a flexed or stretched size that is not definite`);
  }
  return null;
}

/** The specified block size in border-box terms, or null when it behaves as auto (CSS2 §10.5). */
export function specifiedBlockSize(box: LayoutBox, basis: HeightBasis, borderPadding: LU): LU | null {
  const h = box.style.height;
  if (h.kind === 'auto') return null;
  if (h.kind === 'percent') {
    const b = percentBlockBasis(box, basis, 'height');
    return b === null ? null : borderBoxFromSpecified(percentOf(b, h.value), borderPadding, box.style.boxSizing);
  }
  return borderBoxFromSpecified(fromCssPx(h.value), borderPadding, box.style.boxSizing);
}

// CSS2 §10.7 min-height/max-height in border-box terms; percentages against an indefinite block behave as 0 / none.
export function blockMinMax(box: LayoutBox, basis: HeightBasis, borderPadding: LU): MinMax {
  const s = box.style;
  let lo = borderPadding;
  if (s.minHeight.kind === 'px') lo = borderBoxFromSpecified(fromCssPx(s.minHeight.value), borderPadding, s.boxSizing);
  else if (s.minHeight.kind === 'percent') {
    const b = percentBlockBasis(box, basis, 'min-height');
    if (b !== null) lo = borderBoxFromSpecified(percentOf(b, s.minHeight.value), borderPadding, s.boxSizing);
  }
  let hi: LU | null = null;
  if (s.maxHeight.kind === 'px') hi = borderBoxFromSpecified(fromCssPx(s.maxHeight.value), borderPadding, s.boxSizing);
  else if (s.maxHeight.kind === 'percent') {
    const b = percentBlockBasis(box, basis, 'max-height');
    if (b !== null) hi = borderBoxFromSpecified(percentOf(b, s.maxHeight.value), borderPadding, s.boxSizing);
  }
  return { min: lo, max: hi };
}

export function contentBox(borderBox: LU, borderPadding: LU): LU {
  return clampNegativeToZero(sub(borderBox, borderPadding));
}

/** css-overflow-3 §3: overflow hidden (on both axes, as the validator requires) makes the box a scroll container. */
export function isScrollContainer(style: LayoutStyle): boolean {
  return style.overflowX === 'hidden';
}
