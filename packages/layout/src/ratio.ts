// css-sizing-4 §5 aspect-ratio on non-replaced boxes, as Chrome 145 applies it (Blink length_utils.cc, block_node.cc,
// absolute_utils.cc and flex_layout_algorithm.cc): the ratio transfers a definite size from one axis to the other, and min and
// max sizes transfer through it. Sizes here are border-box LU; the layout ratio is the authored parts converted as Blink does (units.ts layoutRatio).
import type { LayoutBox, LayoutStyle } from './input.ts';
import type { LU } from './units.ts';
import type { LayoutRatio, RatioFaults } from './units.ts';
import { add, layoutRatioWith, max, min, mulDiv, roundedHalf, sub, truncQuotient, ZERO } from './units.ts';
import type { EngineFaults } from './block.ts';
import type { HeightBasis, MinMax } from './box.ts';
import {
  blockMinMaxWith,
  lengthHeight,
  NO_STRETCH,
  borderBoxFromSpecified,
  constrain,
  hasPercent,
  inlineMinMaxOf,
  isScrollContainer,
  lengthMaxWidth,
  lengthMinWidth,
  resolveBorder,
  resolveLength,
  resolveLengthOrNull,
  resolveMinLength,
  resolvePaddingWith,
  sumEdges,
} from './box.ts';
import type { Ctx } from './block.ts';
import { intrinsicContentInlineSize } from './intrinsic.ts';

function ratioFaults(f: EngineFaults): RatioFaults {
  return { noTrivialClamp: f.ratioNoTrivialClamp, doubleFraction: f.ratioDoubleFraction, truncatedParts: f.ratioTruncatedParts, eightSteps: f.ratioEightSteps };
}

/** Blink StyleAspectRatio::GetLayoutRatio (core/style/style_aspect_ratio.h): the box's authored parts converted once (units.ts layoutRatio), or null for auto or a degenerate ratio. */
export function styleLayoutRatio(s: LayoutStyle, f: EngineFaults): LayoutRatio | null {
  const r = s.aspectRatio;
  return r.kind === 'auto' ? null : layoutRatioWith(r.width, r.height, ratioFaults(f));
}

/** Whether the box has a preferred aspect ratio (StyleAspectRatio::GetType: a degenerate ratio is auto). */
export function hasAspectRatio(s: LayoutStyle, f: EngineFaults): boolean {
  return styleLayoutRatio(s, f) !== null;
}

/** Blink ComputedStyle::BoxSizingForAspectRatio: `auto && <ratio>` sizes the content box whatever box-sizing says. */
function ratioBoxSizing(s: LayoutStyle): LayoutStyle['boxSizing'] {
  return s.aspectRatio.kind === 'auto-ratio' ? 'content-box' : s.boxSizing;
}

function layoutRatioOf(s: LayoutStyle, f: EngineFaults): LayoutRatio {
  const r = styleLayoutRatio(s, f);
  if (r === null) throw new Error('the box has no aspect ratio');
  return r;
}

/** Blink FixedPoint::MulDiv of a size by the layout ratio to / from (the planted faults round it, or use the exact quotient of the authored parts). */
function transfer(s: LayoutStyle, f: EngineFaults, r: LayoutRatio, size: LU, toBlock: boolean): LU {
  const a = s.aspectRatio;
  if (f.ratioExactSpec && a.kind !== 'auto') return toBlock ? truncQuotient(size, a.height, a.width) : truncQuotient(size, a.width, a.height);
  const m = toBlock ? r.height : r.width;
  const d = toBlock ? r.width : r.height;
  if (f.ratioRoundedMulDiv) return roundedHalf(mulDiv(size, m * 2, d));
  return mulDiv(size, m, d);
}

function blockWith(s: LayoutStyle, f: EngineFaults, r: LayoutRatio, hbp: LU, vbp: LU, inline: LU): LU {
  if (ratioBoxSizing(s) === 'border-box') return max(vbp, transfer(s, f, r, inline, true));
  return add(transfer(s, f, r, sub(inline, hbp), true), vbp);
}

function inlineWith(s: LayoutStyle, f: EngineFaults, r: LayoutRatio, hbp: LU, vbp: LU, block: LU): LU {
  if (ratioBoxSizing(s) === 'border-box') return max(hbp, transfer(s, f, r, block, false));
  return add(transfer(s, f, r, sub(block, vbp), false), hbp);
}

/** Blink BlockSizeFromAspectRatio: the border-box block size for a border-box inline size. */
export function blockFromRatio(s: LayoutStyle, f: EngineFaults, hbp: LU, vbp: LU, inline: LU): LU {
  return blockWith(s, f, layoutRatioOf(s, f), hbp, vbp, inline);
}

/** Blink InlineSizeFromAspectRatio: the border-box inline size for a border-box block size. */
export function inlineFromRatio(s: LayoutStyle, f: EngineFaults, hbp: LU, vbp: LU, block: LU): LU {
  return inlineWith(s, f, layoutRatioOf(s, f), hbp, vbp, block);
}

/** Blink ComputeTransferredMinMaxInlineSizes: block min and max (border box, max null for none) through the ratio. */
export function transferredInlineMinMax(s: LayoutStyle, f: EngineFaults, block: MinMax, hbp: LU, vbp: LU): MinMax {
  const r = layoutRatioOf(s, f);
  const lo = block.min > 0 ? inlineWith(s, f, r, hbp, vbp, block.min) : ZERO;
  const hi = block.max === null ? null : inlineWith(s, f, r, hbp, vbp, block.max);
  return { min: lo, max: hi === null ? null : max(hi, lo) };
}

/** Blink ComputeTransferredMinMaxBlockSizes: inline min and max through the ratio. */
export function transferredBlockMinMax(s: LayoutStyle, f: EngineFaults, inline: MinMax, hbp: LU, vbp: LU): MinMax {
  const r = layoutRatioOf(s, f);
  const lo = inline.min > 0 ? blockWith(s, f, r, hbp, vbp, inline.min) : ZERO;
  const hi = inline.max === null ? null : blockWith(s, f, r, hbp, vbp, inline.max);
  return { min: lo, max: hi === null ? null : max(hi, lo) };
}

/** Blink ComputeMinMaxInlineSizes with transferred sizes: the explicit min and max, then the transferred ones inside them. */
function withTransferred(own: MinMax, transferred: MinMax): MinMax {
  const lo = max(own.min, own.max === null ? transferred.min : min(transferred.min, own.max));
  const hi = own.max === null ? transferred.max : transferred.max === null ? own.max : min(own.max, transferred.max);
  return { min: lo, max: hi === null ? null : max(hi, lo) };
}

/** Blink MinMaxSizes::ClampSizeToMinAndMax. */
function clampTo(v: LU, mm: MinMax): LU {
  return constrain(v, mm);
}

/** Whether a length depends on a percentage basis the block axis may lack, or is stretch: the validator refuses these beside a ratio. */
function blockLengthsHavePercent(s: LayoutStyle): boolean {
  const h = s.height.kind === 'stretch' || ((s.height.kind === 'percent' || s.height.kind === 'calc') && hasPercent(s.height));
  const lo = s.minHeight.kind === 'stretch' || (s.minHeight.kind !== 'auto' && hasPercent(s.minHeight));
  const hi = s.maxHeight.kind === 'stretch' || (s.maxHeight.kind !== 'none' && hasPercent(s.maxHeight));
  return h || lo || hi;
}

/** Edge sums of a box against a containing block inline size. */
type BoxEdges = { readonly hbp: LU; readonly vbp: LU };

function edgesOf(ctx: Ctx, box: LayoutBox, cbInline: LU): BoxEdges {
  const pad = resolvePaddingWith(box.style, cbInline, ctx.faults);
  const bor = resolveBorder(box.style, ctx.devicePixelRatio);
  return { hbp: sumEdges(bor.left, bor.right, pad.left, pad.right), vbp: sumEdges(bor.top, bor.bottom, pad.top, pad.bottom) };
}

/** The border-box block size from `height` clamped by min-height and max-height, with no content (Blink
 * ComputeBlockSizeForFragment with an indefinite intrinsic size), or null when height is auto or its percentage has no basis. */
function initialBlockSize(ctx: Ctx, box: LayoutBox, basis: HeightBasis, vbp: LU): LU | null {
  const s = box.style;
  const h = lengthHeight(box.id, s.height);
  if (h.kind === 'auto') return null;
  const b = hasPercent(h) ? (basis.kind === 'definite' ? basis.value : null) : ZERO;
  const v = resolveLengthOrNull(h, b, ctx.faults);
  if (v === null) return null;
  return clampTo(borderBoxFromSpecified(v, vbp, s.boxSizing), blockMinMaxWith(box, basis, vbp, ctx.faults, NO_STRETCH));
}

/** A basis for block lengths that hold no percentage: the validator refuses a percentage beside a ratio where none is known. */
function noPercentBasis(box: LayoutBox): HeightBasis {
  if (blockLengthsHavePercent(box.style)) throw new Error(`${box.id} has a percentage block size beside an aspect-ratio; validateLayoutInput rejects this input`);
  return { kind: 'indefinite' };
}

/** min-width: auto as the automatic minimum size (css-sizing-4 §5.2): the min-content size, clamped by max-width. */
function withAutoMinInline(ctx: Ctx, box: LayoutBox, mm: MinMax, hbp: LU): MinMax {
  if (box.style.minWidth.kind !== 'auto') return mm;
  const content = add(intrinsicContentInlineSize(ctx, box, 'min'), hbp);
  const lo = mm.max === null ? max(mm.min, content) : max(mm.min, min(content, mm.max));
  return { min: lo, max: mm.max === null ? null : max(mm.max, lo) };
}

/**
 * Blink ComputeInlineSizeForFragmentInternal for a block-level box in flow with width auto and a ratio. A resolvable height
 * gives the inline size through the ratio (fit-content over the transferred size) with the automatic minimum size; otherwise
 * the box stretches. Either way min-height and max-height transfer into the inline min and max.
 */
export function ratioBlockLevelInlineSize(ctx: Ctx, box: LayoutBox, cbInline: LU, stretched: LU): LU {
  const s = box.style;
  const e = edgesOf(ctx, box, cbInline);
  const basis = noPercentBasis(box);
  const block = initialBlockSize(ctx, box, basis, e.vbp);
  const own = inlineMinMaxOf(box.id, s, cbInline, e.hbp, ctx.faults);
  const mm = withTransferred(block === null || isScrollContainer(s) ? own : withAutoMinInline(ctx, box, own, e.hbp), transferredInlineMinMax(s, ctx.faults, blockMinMaxWith(box, basis, e.vbp, ctx.faults, NO_STRETCH), e.hbp, e.vbp));
  const extent = block === null ? stretched : inlineFromRatio(s, ctx.faults, e.hbp, e.vbp, block);
  return max(clampTo(extent, mm), e.hbp);
}

/** Blink ComputeBlockSizeForFragment with a ratio and height auto: the border-box block size from the inline size, before content. */
export function ratioInitialBlockSize(box: LayoutBox, f: EngineFaults, borderBoxWidth: LU, hbp: LU, vbp: LU): LU | null {
  const s = box.style;
  if (!hasAspectRatio(s, f) || s.height.kind !== 'auto') return null;
  return blockFromRatio(s, f, hbp, vbp, borderBoxWidth);
}

/**
 * The used block size of a box whose auto height comes from its ratio: the ratio size clamped by min-height and max-height, where
 * min-height auto is the automatic minimum size (the content height, clamped by max-height) unless the box is a scroll container.
 */
export function ratioFinalBlockSize(box: LayoutBox, ratioSize: LU, contentBorderBox: LU, mm: MinMax): LU {
  const s = box.style;
  if (s.minHeight.kind !== 'auto' || isScrollContainer(s)) return clampTo(ratioSize, mm);
  const lo = mm.max === null ? max(mm.min, contentBorderBox) : max(mm.min, min(contentBorderBox, mm.max));
  return clampTo(ratioSize, { min: lo, max: mm.max === null ? null : max(mm.max, lo) });
}

/**
 * Blink BlockNode::ComputeMinMaxSizes (kContent) for a box with a ratio: the transferred size when its block size is definite
 * without content (`block`, border box), else its content sizes clamped by the transferred min and max. Border box.
 */
export function ratioContentInlineSize(ctx: Ctx, box: LayoutBox, kind: 'min' | 'max', block: LU | null, cbInline: LU): LU {
  const s = box.style;
  const e = edgesOf(ctx, box, cbInline);
  if (block !== null) return inlineFromRatio(s, ctx.faults, e.hbp, e.vbp, block);
  const content = add(intrinsicContentInlineSize(ctx, box, kind), e.hbp);
  return clampTo(content, transferredInlineMinMax(s, ctx.faults, blockMinMaxWith(box, noPercentBasis(box), e.vbp, ctx.faults, NO_STRETCH), e.hbp, e.vbp));
}

/**
 * css-sizing-3 §5.2 contribution of a box with a ratio whose width is not a length (Blink
 * ComputeMinAndMaxContentContributionInternal): its content sizes (ratio-aware), with the automatic minimum size when the ratio
 * gave them, then min-width and max-width, and the transferred min and max when width is auto. Border box, no margins.
 */
export function ratioInlineContribution(ctx: Ctx, box: LayoutBox, kind: 'min' | 'max'): LU {
  const s = box.style;
  const e = edgesOf(ctx, box, ZERO);
  const basis = noPercentBasis(box);
  const block = initialBlockSize(ctx, box, basis, e.vbp);
  const size = ratioContentInlineSize(ctx, box, kind, block, ZERO);
  // As inlineContribution: a percentage max-width is none, and min-width resolves against no basis (§5.2.1).
  const minWidth = lengthMinWidth(box.id, s.minWidth);
  const maxWidth = lengthMaxWidth(box.id, s.maxWidth);
  const own: MinMax = {
    min: minWidth.kind !== 'auto' ? borderBoxFromSpecified(resolveMinLength(minWidth, null, ctx.faults), e.hbp, s.boxSizing) : e.hbp,
    max: maxWidth.kind !== 'none' && !hasPercent(maxWidth) ? borderBoxFromSpecified(resolveLength(maxWidth, ZERO, ctx.faults), e.hbp, s.boxSizing) : null,
  };
  const autoMin = block !== null && !isScrollContainer(s) ? withAutoMinInline(ctx, box, own, e.hbp) : own;
  const mm = s.width.kind === 'auto' ? withTransferred(autoMin, transferredInlineMinMax(s, ctx.faults, blockMinMaxWith(box, basis, e.vbp, ctx.faults, NO_STRETCH), e.hbp, e.vbp)) : autoMin;
  return max(clampTo(size, mm), e.hbp);
}

/**
 * Blink ComputeOofInlineDimensions for an absolutely positioned box with width auto and a ratio. When the block size resolves
 * without layout (a height, or both block insets) and the width does not stretch against a weaker block constraint, the width
 * is the transferred size, with the automatic minimum size unless overflow is hidden; otherwise it stretches between both
 * inline insets or shrinks to fit. The transferred min and max apply either way. `stretchInline` is the space between the
 * inline insets less the margins (null unless both are set), `available` the shrink-to-fit space, and `stretchBlock` the
 * same for the block axis (null unless both block insets are set).
 */
export function ratioAbsoluteInlineSize(ctx: Ctx, box: LayoutBox, cbWidth: LU, stretchInline: LU | null, available: LU, stretchBlock: LU | null): LU {
  const s = box.style;
  const e = edgesOf(ctx, box, cbWidth);
  const basis = noPercentBasis(box);
  const blockMm = blockMinMaxWith(box, basis, e.vbp, ctx.faults, NO_STRETCH);
  const block = s.height.kind !== 'auto'
    ? initialBlockSize(ctx, box, basis, e.vbp)
    : stretchBlock === null ? null : max(clampTo(stretchBlock, blockMm), e.vbp);
  const own = inlineMinMaxOf(box.id, s, cbWidth, e.hbp, ctx.faults);
  const ratioWins = block !== null && (stretchInline === null || s.height.kind !== 'auto');
  const autoMin = ratioWins && !isScrollContainer(s) ? withAutoMinInline(ctx, box, own, e.hbp) : own;
  const mm = withTransferred(autoMin, transferredInlineMinMax(s, ctx.faults, blockMm, e.hbp, e.vbp));
  let extent: LU;
  if (ratioWins) extent = inlineFromRatio(s, ctx.faults, e.hbp, e.vbp, block as LU);
  else if (stretchInline !== null) extent = stretchInline;
  else {
    const minContent = add(intrinsicContentInlineSize(ctx, box, 'min'), e.hbp);
    const maxContent = add(intrinsicContentInlineSize(ctx, box, 'max'), e.hbp);
    extent = min(maxContent, max(minContent, available));
  }
  return max(clampTo(extent, mm), e.hbp);
}

/**
 * Whether an absolutely positioned box's auto height comes from its ratio rather than stretching between its block insets: only
 * when its width stretches between its inline insets too (Chrome 145 stretches a width: 30px box with top and bottom set).
 */
export function ratioSetsAbsoluteHeight(box: LayoutBox, f: EngineFaults, inlineStretches: boolean): boolean {
  return hasAspectRatio(box.style, f) && box.style.height.kind === 'auto' && inlineStretches;
}
