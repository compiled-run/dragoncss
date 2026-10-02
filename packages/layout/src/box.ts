// Shared box-model resolution: padding, border, margins, box-sizing and min/max (CSS2 §8, §10.4, §10.7; css-sizing-3).
import type { BorderWidthValue, BoxSizing, LayoutBox, LayoutStyle, LengthCalc, MarginValue, MaxSizeValue, MinSizeValue, Percent, Px, SizeValue } from './input.ts';
import type { EngineFaults } from './block.ts';
import { NO_ENGINE_FAULTS } from './block.ts';
import { calcHasPercent, resolveCalc } from './calc.ts';
import type { LU } from './units.ts';
import { add, clampNegativeToZero, fromCssPx, max, min, percentOf, snapBorderWidth, sub, ZERO } from './units.ts';
import { unsupported } from './unsupported.ts';

export type Edges = { readonly top: LU; readonly right: LU; readonly bottom: LU; readonly left: LU };

/** Which side of the margin box sits at a static position, physically: left or top, the centre, right or bottom. */
export type StaticEdge = 'near' | 'center' | 'far';

/** One axis of a static position (css-position-3 §4.1), relative to the parent's border box. */
export type StaticAxis = { readonly offset: LU; readonly edge: StaticEdge };

/** An absolutely positioned child with the static position its parent computed for it; laid out once its containing block is. */
export type OutOfFlow = { readonly box: LayoutBox; readonly x: StaticAxis; readonly y: StaticAxis };

/**
 * baseline: the first baseline (css-align-3 §9.1) as an offset from the border-box top, or null when the box has none.
 * outOfFlow: the box's absolutely positioned children, in document order.
 */
export type Frag = {
  readonly id: string;
  readonly width: LU;
  readonly height: LU;
  readonly baseline: LU | null;
  readonly children: readonly Placed[];
  readonly outOfFlow: readonly OutOfFlow[];
};
export type Placed = { readonly frag: Frag; readonly x: LU; readonly y: LU };

/** A point in LU. */
export type Point = { readonly x: LU; readonly y: LU };

/** How a box's percentage block sizes can resolve against its containing block. */
export type HeightBasis =
  | { readonly kind: 'indefinite' }
  | { readonly kind: 'definite'; readonly value: LU }
  | { readonly kind: 'flex-dependent' };

export const INDEFINITE: HeightBasis = { kind: 'indefinite' };

/** A length or a percentage, as every length property holds after the environment pass. */
export type LengthPercent = Px | Percent | LengthCalc;

/** Whether a length depends on its percentage basis: a percentage, or a calculation with one (0% included). */
export function hasPercent(v: LengthPercent): boolean {
  if (v.kind === 'percent') return true;
  if (v.kind === 'calc') return calcHasPercent(v.expr);
  return false;
}

/** A length against a definite basis (Blink MinimumValueForLength). */
export function resolveLength(v: LengthPercent, basis: LU, faults: EngineFaults): LU {
  if (v.kind === 'px') return fromCssPx(v.value);
  if (v.kind === 'percent') return percentOf(basis, v.value);
  return resolveCalc(v, basis, faults);
}

/**
 * A length against a basis that may be indefinite (null): a length with a percentage then has no value, so the property behaves
 * as auto, 0 or none (CSS2 §10.5, css-sizing-3 §5.2.1). Planted fault calcPercentIndefiniteAsLength resolves a calculation
 * against 0 instead.
 */
export function resolveLengthOrNull(v: LengthPercent, basis: LU | null, faults: EngineFaults): LU | null {
  if (basis !== null) return resolveLength(v, basis, faults);
  if (!hasPercent(v)) return resolveLength(v, ZERO, faults);
  if (v.kind === 'calc' && faults.calcPercentIndefiniteAsLength) return resolveCalc(v, ZERO, faults);
  return null;
}

// CSS2 §8.4: percentage padding refers to the containing block's width. The native hosts call this form (emit/native-support.ts).
export function resolvePadding(style: LayoutStyle, cbInline: LU): Edges {
  return {
    top: resolveLength(style.paddingTop, cbInline, NO_ENGINE_FAULTS),
    right: resolveLength(style.paddingRight, cbInline, NO_ENGINE_FAULTS),
    bottom: resolveLength(style.paddingBottom, cbInline, NO_ENGINE_FAULTS),
    left: resolveLength(style.paddingLeft, cbInline, NO_ENGINE_FAULTS),
  };
}

/** Whether any planted value-model fault is on: only then does length resolution differ from the no-fault form. */
function valueFaultsOn(f: EngineFaults): boolean {
  return f.calcPercentPlainOrder || f.calcDoubleEval || f.calcNoNonNegClamp || f.calcPercentIndefiniteAsLength || f.clampMaxWins || f.divideDirect || f.calcLeafUnzoomed || f.viewportUnitsUnceiled;
}

/** resolvePadding with the planted engine faults the layout runs with. */
export function resolvePaddingWith(style: LayoutStyle, cbInline: LU, faults: EngineFaults): Edges {
  if (!valueFaultsOn(faults)) return resolvePadding(style, cbInline);
  return {
    top: resolveLength(style.paddingTop, cbInline, faults),
    right: resolveLength(style.paddingRight, cbInline, faults),
    bottom: resolveLength(style.paddingBottom, cbInline, faults),
    left: resolveLength(style.paddingLeft, cbInline, faults),
  };
}

/** A border width in CSS px of the environment; the environment pass has already made a calculation px. */
function borderWidthPx(v: BorderWidthValue): number {
  if (v.kind === 'calc') throw new Error('a border width calculation reached layout; the environment pass resolves it');
  return v.value;
}

// CSS2 §8.5.1: border widths arrive as computed px (zero when the style is none) and snap to the environment's device px.
export function resolveBorder(style: LayoutStyle, devicePixelRatio: number): Edges {
  return {
    top: snapBorderWidth(borderWidthPx(style.borderTopWidth), devicePixelRatio),
    right: snapBorderWidth(borderWidthPx(style.borderRightWidth), devicePixelRatio),
    bottom: snapBorderWidth(borderWidthPx(style.borderBottomWidth), devicePixelRatio),
    left: snapBorderWidth(borderWidthPx(style.borderLeftWidth), devicePixelRatio),
  };
}

export type MarginResolved = { readonly value: LU; readonly auto: boolean };

/** resolveMargin with no planted engine faults: the form external callers (the native hosts) use. */
export function resolveMargin(v: MarginValue, cbInline: LU): MarginResolved {
  return resolveMarginWith(v, cbInline, NO_ENGINE_FAULTS);
}

// CSS2 §8.3: percentage margins refer to the containing block's width, for vertical margins too.
export function resolveMarginWith(v: MarginValue, cbInline: LU, faults: EngineFaults): MarginResolved {
  if (v.kind === 'auto') return { value: ZERO, auto: true };
  return { value: resolveLength(v, cbInline, faults), auto: false };
}

export function sumEdges(a: LU, b: LU, c: LU, d: LU): LU {
  return add(add(a, b), add(c, d));
}

// css-sizing-3 §4 box-sizing: a specified size is the content box or the border box; the border box never drops below border+padding.
export function borderBoxFromSpecified(value: LU, borderPadding: LU, boxSizing: BoxSizing): LU {
  if (boxSizing === 'content-box') return add(clampNegativeToZero(value), borderPadding);
  return max(value, borderPadding);
}

/** resolveInlineLength with no planted engine faults: the form external callers (the native hosts) use. */
export function resolveInlineLength(v: SizeValue | MinSizeValue, basis: LU): LU | null {
  return resolveInlineLengthWith(v, basis, NO_ENGINE_FAULTS);
}

/** A width-like length resolved against a definite inline basis; null for auto. */
export function resolveInlineLengthWith(v: SizeValue | MinSizeValue, basis: LU, faults: EngineFaults): LU | null {
  if (v.kind === 'auto') return null;
  return resolveLength(v, basis, faults);
}

/** resolveMaxInlineLength with no planted engine faults: the form external callers (the native hosts) use. */
export function resolveMaxInlineLength(v: MaxSizeValue, basis: LU): LU | null {
  return resolveMaxInlineLengthWith(v, basis, NO_ENGINE_FAULTS);
}

export function resolveMaxInlineLengthWith(v: MaxSizeValue, basis: LU, faults: EngineFaults): LU | null {
  if (v.kind === 'none') return null;
  return resolveLength(v, basis, faults);
}

export type MinMax = { readonly min: LU; readonly max: LU | null };

/** Blink ConstrainByMinMax: max(min, min(value, max)); min wins. */
export function constrain(value: LU, mm: MinMax): LU {
  const capped = mm.max === null ? value : min(value, mm.max);
  return max(mm.min, capped);
}

/** inlineMinMax with no planted engine faults: the form external callers (the native hosts) use. */
export function inlineMinMax(style: LayoutStyle, cbInline: LU, borderPadding: LU): MinMax {
  return inlineMinMaxWith(style, cbInline, borderPadding, NO_ENGINE_FAULTS);
}

// CSS2 §10.4 min-width/max-width in border-box terms; min-width auto is 0 outside flex items.
export function inlineMinMaxWith(style: LayoutStyle, cbInline: LU, borderPadding: LU, faults: EngineFaults): MinMax {
  const lo = resolveInlineLengthWith(style.minWidth, cbInline, faults);
  const hi = resolveMaxInlineLengthWith(style.maxWidth, cbInline, faults);
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

/** The block basis of a length that has a percentage (it may throw percent-height-flex), or null for one that has none. */
function blockBasisFor(box: LayoutBox, v: LengthPercent, basis: HeightBasis, prop: string): LU | null {
  return hasPercent(v) ? percentBlockBasis(box, basis, prop) : ZERO;
}

/** specifiedBlockSize with no planted engine faults: the form external callers (the native hosts) use. */
export function specifiedBlockSize(box: LayoutBox, basis: HeightBasis, borderPadding: LU): LU | null {
  return specifiedBlockSizeWith(box, basis, borderPadding, NO_ENGINE_FAULTS);
}

/** The specified block size in border-box terms, or null when it behaves as auto (CSS2 §10.5). */
export function specifiedBlockSizeWith(box: LayoutBox, basis: HeightBasis, borderPadding: LU, faults: EngineFaults): LU | null {
  const h = box.style.height;
  if (h.kind === 'auto') return null;
  const v = resolveLengthOrNull(h, blockBasisFor(box, h, basis, 'height'), faults);
  return v === null ? null : borderBoxFromSpecified(v, borderPadding, box.style.boxSizing);
}

/**
 * A min length against a basis that may be indefinite: Blink ResolveBlockLengthInternal resolves it against 0 (length_utils.cc
 * kMin), so a percentage is 0 and calc(30px + 10%) is 30px (measured, values-calc-min-max-height-indefinite).
 */
export function resolveMinLength(v: LengthPercent, basis: LU | null, faults: EngineFaults): LU {
  return resolveLength(v, basis === null ? ZERO : basis, faults);
}

/** blockMinMax with no planted engine faults: the form external callers (the native hosts) use. */
export function blockMinMax(box: LayoutBox, basis: HeightBasis, borderPadding: LU): MinMax {
  return blockMinMaxWith(box, basis, borderPadding, NO_ENGINE_FAULTS);
}

// CSS2 §10.7 min-height/max-height in border-box terms; against an indefinite block a min resolves against 0 and a max is none.
export function blockMinMaxWith(box: LayoutBox, basis: HeightBasis, borderPadding: LU, faults: EngineFaults): MinMax {
  const s = box.style;
  let lo = borderPadding;
  if (s.minHeight.kind !== 'auto') {
    lo = borderBoxFromSpecified(resolveMinLength(s.minHeight, blockBasisFor(box, s.minHeight, basis, 'min-height'), faults), borderPadding, s.boxSizing);
  }
  let hi: LU | null = null;
  if (s.maxHeight.kind !== 'none') {
    const v = resolveLengthOrNull(s.maxHeight, blockBasisFor(box, s.maxHeight, basis, 'max-height'), faults);
    if (v !== null) hi = borderBoxFromSpecified(v, borderPadding, s.boxSizing);
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

