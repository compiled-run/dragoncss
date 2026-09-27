// Shared box-model resolution: padding, border, margins, box-sizing and min/max (CSS2 §8, §10.4, §10.7; css-sizing-3).
import type { BoxSizing, LayoutBox, LayoutStyle, MarginValue, MaxSizeValue, MinSizeValue, PaddingValue, SizeValue } from './input.ts';
import type { LU } from './units.ts';
import { add, clampNegativeToZero, fromCssPx, max, min, percentOf, sub, ZERO } from './units.ts';
import { unsupported } from './unsupported.ts';

export type Edges = { readonly top: LU; readonly right: LU; readonly bottom: LU; readonly left: LU };

export type Frag = { readonly id: string; readonly width: LU; readonly height: LU; readonly children: readonly Placed[] };
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

// CSS2 §8.5.1: border widths arrive as computed px (zero when the style is none).
export function resolveBorder(style: LayoutStyle): Edges {
  return {
    top: fromCssPx(style.borderTopWidth.value),
    right: fromCssPx(style.borderRightWidth.value),
    bottom: fromCssPx(style.borderBottomWidth.value),
    left: fromCssPx(style.borderLeftWidth.value),
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

/** A height-like percentage: resolves only against an indefinite basis in S1 (as auto); definite bases are S2. */
function percentBlockUnsupported(box: LayoutBox, basis: HeightBasis, prop: string): void {
  if (basis.kind === 'definite') {
    unsupported('percent-height-definite', box.id, 'CSS2 §10.5', `${prop} percentage against a definite containing block (S2)`);
  }
  if (basis.kind === 'flex-dependent') {
    unsupported('percent-height-flex', box.id, 'css-flexbox-1 §9.8', `${prop} percentage against a flexed or stretched size (S2)`);
  }
}

/** The specified block size in border-box terms, or null when it behaves as auto (CSS2 §10.5). */
export function specifiedBlockSize(box: LayoutBox, basis: HeightBasis, borderPadding: LU): LU | null {
  const h = box.style.height;
  if (h.kind === 'auto') return null;
  if (h.kind === 'percent') {
    percentBlockUnsupported(box, basis, 'height');
    return null;
  }
  return borderBoxFromSpecified(fromCssPx(h.value), borderPadding, box.style.boxSizing);
}

// CSS2 §10.7 min-height/max-height in border-box terms; percentages against an indefinite block behave as 0 / none.
export function blockMinMax(box: LayoutBox, basis: HeightBasis, borderPadding: LU): MinMax {
  const s = box.style;
  let lo = borderPadding;
  if (s.minHeight.kind === 'px') lo = borderBoxFromSpecified(fromCssPx(s.minHeight.value), borderPadding, s.boxSizing);
  else if (s.minHeight.kind === 'percent') percentBlockUnsupported(box, basis, 'min-height');
  let hi: LU | null = null;
  if (s.maxHeight.kind === 'px') hi = borderBoxFromSpecified(fromCssPx(s.maxHeight.value), borderPadding, s.boxSizing);
  else if (s.maxHeight.kind === 'percent') percentBlockUnsupported(box, basis, 'max-height');
  return { min: lo, max: hi };
}

export function hasNonTrivialBlockMinMax(mm: MinMax, borderPadding: LU): boolean {
  return mm.max !== null || mm.min > borderPadding;
}

export function contentBox(borderBox: LU, borderPadding: LU): LU {
  return clampNegativeToZero(sub(borderBox, borderPadding));
}

export function visibleChildren(box: LayoutBox): readonly (LayoutBox | import('./input.ts').TextLeaf)[] {
  return box.children.filter((c) => c.kind === 'text' || c.style.display !== 'none');
}

// css-writing-modes-4 §2.1: S1 lays out left-to-right only.
export function requireLtr(box: LayoutBox): void {
  if (box.style.direction !== 'ltr') unsupported('direction-rtl', box.id, 'css-writing-modes-4 §2.1', 'direction: rtl arrives in S4');
}
