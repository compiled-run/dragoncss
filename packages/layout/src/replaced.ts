// Replaced elements (CSS 2.2 §10.3.2, §10.6.2 and §10.4 with css-sizing-4 §5 and css-images-3 §5.5), as Chrome 145 sizes and
// paints them. Sizing is Blink ComputeReplacedSizeInternal (length_utils.cc); the destination rect is Blink
// LayoutReplaced::ComputeObjectFitAndPositionRect (layout_replaced.cc), snapped as ImagePainter::PaintIntoRect does. Every size
// here is border-box LU in zoomed px unless named otherwise.
import type { LayoutStyle, ReplacedLeaf } from './input.ts';
import type { Ctx, EngineFaults } from './block.ts';
import type { Frag, HeightBasis, LengthPercent, MinMax } from './box.ts';
import { borderBoxFromSpecified, constrain, hasPercent, resolveBorder, resolveLength, resolvePaddingWith, sumEdges } from './box.ts';
import type { LayoutRatio, LU } from './units.ts';
import { add, fromCssPx, max, min, mulDiv, snapEdge, sub, ZERO } from './units.ts';
import { unsupported } from './unsupported.ts';

/** css-images-3 §5.5 object-fit. */
export type ObjectFit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';

/**
 * The natural dimensions of a replaced element (Blink PhysicalNaturalSizingInfo) in zoomed LU of its content box: an image has
 * both sizes and their ratio; an iframe has none. ratio is two positive raw LayoutUnit values.
 */
export type NaturalSizing = { readonly width: LU | null; readonly height: LU | null; readonly ratio: LayoutRatio | null };

/** How an auto size resolves (Blink AutoSizeBehavior): fit-content, or stretch into the available size. */
export type InlineAutoBehavior = 'fit-content' | 'stretch-implicit' | 'stretch-explicit';

/**
 * What the parent gives a replaced box to size it (the parts of a Blink ConstraintSpace the replaced path reads). A null size
 * is indefinite. fixedInline and fixedBlock are sizes the parent imposes (a flexed main size, a stretched cross size). Margins are
 * the sums a stretch takes off the available size, with auto margins as 0.
 */
export type ReplacedSpace = {
  readonly availableInline: LU | null;
  readonly availableBlock: LU | null;
  readonly percentInline: LU | null;
  readonly percentBlock: LU | null;
  readonly fixedInline: LU | null;
  readonly fixedBlock: LU | null;
  readonly inlineAuto: InlineAutoBehavior;
  readonly blockAutoStretch: boolean;
  readonly inlineMargins: LU;
  readonly blockMargins: LU;
};

/** Which lengths a nested sizing pass ignores (Blink ReplacedSizeMode). */
export type ReplacedSizeMode = 'normal' | 'ignore-block-lengths' | 'ignore-inline-lengths';

/** A border-box size. */
export type ReplacedSize = { readonly inline: LU; readonly block: LU };

/** The edge sums of the box: horizontal and vertical border plus padding. */
export type BorderPadding = { readonly inline: LU; readonly block: LU };

/** Blink BlockNode::GetReplacedAspectRatio: `<ratio>` wins, then the natural ratio, then the ratio of `auto && <ratio>`. */
export function replacedAspectRatio(s: LayoutStyle, natural: NaturalSizing): LayoutRatio | null {
  const r = s.aspectRatio;
  if (r.kind === 'ratio') return { width: r.width, height: r.height };
  if (natural.ratio !== null) return natural.ratio;
  if (r.kind === 'auto-ratio') return { width: r.width, height: r.height };
  return null;
}

/** Blink ComputedStyle::BoxSizingForAspectRatio: only a plain `<ratio>` follows box-sizing; a natural ratio sizes the content box. */
function ratioBoxSizing(s: LayoutStyle): LayoutStyle['boxSizing'] {
  return s.aspectRatio.kind === 'ratio' ? s.boxSizing : 'content-box';
}

/** Blink InlineSizeFromAspectRatio. */
function inlineFromRatio(bp: BorderPadding, ratio: LayoutRatio, sizing: LayoutStyle['boxSizing'], block: LU): LU {
  if (sizing === 'border-box') return max(bp.inline, mulDiv(block, ratio.width, ratio.height));
  return add(mulDiv(sub(block, bp.block), ratio.width, ratio.height), bp.inline);
}

/** Blink BlockSizeFromAspectRatio. */
function blockFromRatio(bp: BorderPadding, ratio: LayoutRatio, sizing: LayoutStyle['boxSizing'], inline: LU): LU {
  if (sizing === 'border-box') return max(bp.block, mulDiv(inline, ratio.height, ratio.width));
  return add(mulDiv(sub(inline, bp.inline), ratio.height, ratio.width), bp.block);
}

/** Blink ComputeNormalizedNaturalSize: the border-box natural size, from the default object size when there is no ratio. */
function normalizedNaturalSize(natural: NaturalSizing, defaultSize: ReplacedSize, bp: BorderPadding, ratio: LayoutRatio | null, sizing: LayoutStyle['boxSizing']): ReplacedSize | null {
  let inline: LU | null = natural.width !== null ? add(natural.width, bp.inline) : ratio === null ? add(defaultSize.inline, bp.inline) : null;
  let block: LU | null = natural.height !== null ? add(natural.height, bp.block) : ratio === null ? add(defaultSize.block, bp.block) : null;
  if (inline === null && block !== null && ratio !== null) inline = inlineFromRatio(bp, ratio, sizing, block);
  if (inline !== null && ratio !== null) block = blockFromRatio(bp, ratio, sizing, inline);
  return inline !== null && block !== null ? { inline, block } : null;
}

/** Blink ResolveInlineLengthInternal for px, % and calc: the border-box size, or null against an indefinite basis (except kMin). */
function inlineLength(s: LayoutStyle, v: LengthPercent, basis: LU | null, isMin: boolean, bp: BorderPadding, faults: EngineFaults): LU | null {
  const b = hasPercent(v) && basis === null ? (isMin ? ZERO : null) : basis === null ? ZERO : basis;
  if (b === null) return null;
  return borderBoxFromSpecified(resolveLength(v, b, faults), bp.inline, s.boxSizing);
}

/**
 * Blink ResolveBlockLengthInternal for px, % and calc against a basis that may be indefinite: a min length resolves its percentage
 * against 0, a max length is none (null); a main length with an unresolvable percentage resolves to its content, which the caller
 * computes (mainNeedsContent).
 */
function blockLength(s: LayoutStyle, v: LengthPercent, basis: LU | null, isMin: boolean, bp: BorderPadding, faults: EngineFaults): LU | null {
  if (hasPercent(v) && basis === null && !isMin) return null;
  return borderBoxFromSpecified(resolveLength(v, basis === null ? ZERO : basis, faults), bp.block, s.boxSizing);
}

/** Whether a main block length has a percentage that cannot resolve, so it is the content size (Blink kMain). */
function mainNeedsContent(v: LengthPercent, basis: LU | null): boolean {
  return hasPercent(v) && basis === null;
}

/** Blink ComputeReplacedSize for a replaced box that is not an SVG document root. */
export function replacedSize(s: LayoutStyle, natural: NaturalSizing, defaultSize: ReplacedSize, bp: BorderPadding, space: ReplacedSpace, mode: ReplacedSizeMode, faults: EngineFaults): ReplacedSize {
  const ratio = replacedAspectRatio(s, natural);
  const sizing = ratioBoxSizing(s);
  const naturalSize = normalizedNaturalSize(natural, defaultSize, bp, ratio, sizing);

  // The intrinsic block size for a block length that resolves to its content (BlockSizeFunc).
  const blockContent = (): LU | null => {
    if (ratio === null) return (naturalSize as ReplacedSize).block;
    if (mode === 'normal') return replacedSize(s, natural, defaultSize, bp, space, 'ignore-block-lengths', faults).block;
    return naturalSize === null ? null : naturalSize.block;
  };

  let blockMm: MinMax;
  let replacedBlock: LU | null = null;
  if (mode === 'ignore-block-lengths') {
    blockMm = { min: ZERO, max: null };
  } else {
    const lo = s.minHeight.kind === 'auto' ? bp.block : blockLength(s, s.minHeight, space.percentBlock, true, bp, faults);
    const hi = s.maxHeight.kind === 'none' ? null : blockLength(s, s.maxHeight, space.percentBlock, false, bp, faults);
    const loLu = lo === null ? bp.block : lo;
    blockMm = { min: loLu, max: hi === null ? null : max(loLu, hi) };
    if (space.fixedBlock !== null) {
      replacedBlock = space.fixedBlock;
    } else {
      let size: LU | null;
      if (s.height.kind !== 'auto') size = mainNeedsContent(s.height, space.percentBlock) ? blockContent() : blockLength(s, s.height, space.percentBlock, false, bp, faults);
      else if (space.blockAutoStretch && space.availableBlock !== null) size = max(bp.block, sub(space.availableBlock, space.blockMargins));
      else size = blockContent();
      if (size !== null) replacedBlock = constrain(size, blockMm);
    }
  }

  // ComputeTransferredMinMaxInlineSizes: the block min and max through the ratio.
  let transferred: MinMax = { min: ZERO, max: null };
  if (ratio !== null) {
    const tlo = blockMm.min > 0 ? inlineFromRatio(bp, ratio, sizing, blockMm.min) : ZERO;
    const thi = blockMm.max === null ? null : inlineFromRatio(bp, ratio, sizing, blockMm.max);
    transferred = { min: tlo, max: thi === null ? null : max(thi, tlo) };
  }

  // The size an inline length that resolves to its content takes (MinMaxSizesFunc, min and max alike), or null.
  const inlineContent = (): LU | null => {
    if (ratio === null) return (naturalSize as ReplacedSize).inline;
    if (replacedBlock !== null) return inlineFromRatio(bp, ratio, sizing, replacedBlock);
    if (naturalSize !== null) return mode === 'normal' ? replacedSize(s, natural, defaultSize, bp, space, 'ignore-inline-lengths', faults).inline : naturalSize.inline;
    return null;
  };

  let inlineMm: MinMax;
  let replacedInline: LU | null = null;
  if (mode === 'ignore-inline-lengths') {
    inlineMm = transferred;
  } else {
    const lo = s.minWidth.kind === 'auto' ? bp.inline : inlineLength(s, s.minWidth, space.percentInline, true, bp, faults);
    const hi = s.maxWidth.kind === 'none' ? null : inlineLength(s, s.maxWidth, space.percentInline, false, bp, faults);
    let mlo = lo === null ? bp.inline : lo;
    let mhi = hi;
    // css-sizing-4 §5.1 size transfers, unless the width is auto under an explicit stretch.
    if (s.width.kind === 'auto' && space.inlineAuto !== 'stretch-explicit') {
      mlo = max(mlo, mhi === null ? transferred.min : min(transferred.min, mhi));
      mhi = mhi === null ? transferred.max : transferred.max === null ? mhi : min(mhi, transferred.max);
    }
    inlineMm = { min: mlo, max: mhi === null ? null : max(mlo, mhi) };
    if (space.fixedInline !== null) {
      replacedInline = space.fixedInline;
    } else {
      let size: LU | null;
      if (s.width.kind !== 'auto') size = inlineLength(s, s.width, space.percentInline, false, bp, faults);
      else if (space.inlineAuto !== 'fit-content') size = space.availableInline === null ? null : max(bp.inline, sub(space.availableInline, space.inlineMargins));
      else {
        // fit-content: min-content and max-content are the same size, so it is that size whatever the space.
        const c = inlineContent();
        size = c === null ? null : space.availableInline === null ? null : c;
      }
      if (size !== null) replacedInline = constrain(size, inlineMm);
    }
  }

  if (replacedInline !== null && replacedBlock !== null) return { inline: replacedInline, block: replacedBlock };

  // Only a ratio and no size at all: stretch into the available inline size.
  if (naturalSize === null && replacedInline === null && replacedBlock === null) {
    let stretch: LU;
    if (space.availableInline !== null) stretch = max(bp.inline, sub(space.availableInline, space.inlineMargins));
    else if (s.width.kind !== 'auto' && hasPercent(s.width)) stretch = add(defaultSize.inline, bp.inline);
    else stretch = bp.inline;
    replacedInline = constrain(stretch, inlineMm);
  }

  if (replacedInline !== null) {
    const b = ratio === null ? (naturalSize as ReplacedSize).block : blockFromRatio(bp, ratio, sizing, replacedInline);
    return { inline: replacedInline, block: constrain(b, blockMm) };
  }
  if (replacedBlock !== null) {
    const i = ratio === null ? (naturalSize as ReplacedSize).inline : inlineFromRatio(bp, ratio, sizing, replacedBlock);
    return { inline: constrain(i, inlineMm), block: replacedBlock };
  }
  const n = naturalSize as ReplacedSize;
  return { inline: constrain(n.inline, inlineMm), block: constrain(n.block, blockMm) };
}

/** The space of a block-level replaced box in normal flow (Blink CreateConstraintSpaceForChild: replaced boxes fit their content). */
export function blockFlowSpace(cbInline: LU, cbBlock: LU | null, inlineMargins: LU): ReplacedSpace {
  return {
    availableInline: cbInline,
    availableBlock: cbBlock,
    percentInline: cbInline,
    percentBlock: cbBlock,
    fixedInline: null,
    fixedBlock: null,
    inlineAuto: 'fit-content',
    blockAutoStretch: false,
    inlineMargins,
    blockMargins: ZERO,
  };
}

// ---------------------------------------------------------------- the engine's replaced leaves (input.ts ReplacedLeaf)

/** A leaf's natural dimensions in LU; an image's ratio is its natural size, and an empty size has no ratio (Blink PhysicalSize::IsEmpty). */
export function naturalSizingOf(leaf: ReplacedLeaf): NaturalSizing {
  const n = leaf.natural;
  if (n.kind === 'none') return { width: null, height: null, ratio: null };
  const w = fromCssPx(n.width);
  const h = fromCssPx(n.height);
  return { width: w, height: h, ratio: w > 0 && h > 0 ? { width: w, height: h } : null };
}

/** The default object size in LU. */
export function defaultSizeOf(leaf: ReplacedLeaf): ReplacedSize {
  return { inline: fromCssPx(leaf.defaultWidth), block: fromCssPx(leaf.defaultHeight) };
}

/** Border plus padding of a leaf against its containing block's inline size. */
export function replacedBorderPadding(ctx: Ctx, leaf: ReplacedLeaf, cbInline: LU): BorderPadding {
  const pad = resolvePaddingWith(leaf.style, cbInline, ctx.faults);
  const bor = resolveBorder(leaf.style, ctx.devicePixelRatio);
  return { inline: sumEdges(bor.left, bor.right, pad.left, pad.right), block: sumEdges(bor.top, bor.bottom, pad.top, pad.bottom) };
}

/** Whether a block length of the style depends on its percentage basis. */
function blockLengthsHavePercent(s: LayoutStyle): boolean {
  return (s.height.kind !== 'auto' && hasPercent(s.height)) || (s.minHeight.kind !== 'auto' && hasPercent(s.minHeight)) || (s.maxHeight.kind !== 'none' && hasPercent(s.maxHeight));
}

/** The percentage basis of the leaf's block lengths, null when indefinite; a flexed size that §9.8 does not make definite is refused. */
export function replacedBlockBasis(leaf: ReplacedLeaf, basis: HeightBasis): LU | null {
  if (basis.kind === 'definite') return basis.value;
  if (basis.kind === 'flex-dependent' && blockLengthsHavePercent(leaf.style)) {
    unsupported('percent-height-flex', leaf.id, 'css-flexbox-1 §9.8', 'percentage height against a flexed or stretched size that is not definite');
  }
  return null;
}

/** A leaf's fragment of a border-box size: no children, and no baseline of its own (one is synthesized from its border box). */
export function replacedFrag(leaf: ReplacedLeaf, size: ReplacedSize): Frag {
  return { id: leaf.id, width: size.inline, height: size.block, baseline: null, children: [], outOfFlow: [] };
}

/** The sum of a pair of margins with auto as 0. */
function marginSum(ctx: Ctx, a: LayoutStyle['marginLeft'], b: LayoutStyle['marginLeft'], cbInline: LU): LU {
  const va = a.kind === 'auto' ? ZERO : resolveLength(a, cbInline, ctx.faults);
  const vb = b.kind === 'auto' ? ZERO : resolveLength(b, cbInline, ctx.faults);
  return add(va, vb);
}

/** The leaf's size in a space. */
export function sizeReplaced(ctx: Ctx, leaf: ReplacedLeaf, bp: BorderPadding, space: ReplacedSpace, mode: ReplacedSizeMode): ReplacedSize {
  return replacedSize(leaf.style, naturalSizingOf(leaf), defaultSizeOf(leaf), bp, space, mode, ctx.faults);
}

/** A block-level replaced box in normal flow (CSS 2.2 §10.3.4, §10.6.2): its border-box fragment. */
export function layoutReplacedInFlow(ctx: Ctx, leaf: ReplacedLeaf, cbInline: LU, heightBasis: HeightBasis): Frag {
  const bp = replacedBorderPadding(ctx, leaf, cbInline);
  const space = blockFlowSpace(cbInline, replacedBlockBasis(leaf, heightBasis), marginSum(ctx, leaf.style.marginLeft, leaf.style.marginRight, cbInline));
  return replacedFrag(leaf, sizeReplaced(ctx, leaf, bp, space, 'normal'));
}

/**
 * The parts of a flex item's space (Blink FlexLayoutAlgorithm::BuildSpaceForLayout): the container's content box as the available
 * and percentage sizes, a stretch along the cross axis when the item stretches in a definite cross size, and the sizes the
 * algorithm fixes once it has them.
 */
export type FlexItemSpace = {
  readonly isRow: boolean;
  readonly contentWidth: LU;
  /** The container's inner height, or null when indefinite. */
  readonly innerHeight: LU | null;
  /** The percentage basis for the item's block lengths, or null. */
  readonly percentBlock: LU | null;
  readonly stretchCross: boolean;
  readonly fixedInline: LU | null;
  readonly fixedBlock: LU | null;
};

/** A flex item leaf's border-box size. */
export function sizeReplacedFlexItem(ctx: Ctx, leaf: ReplacedLeaf, bp: BorderPadding, f: FlexItemSpace, mode: ReplacedSizeMode): ReplacedSize {
  const s = leaf.style;
  const space: ReplacedSpace = {
    availableInline: f.contentWidth,
    availableBlock: f.innerHeight,
    percentInline: f.contentWidth,
    percentBlock: f.percentBlock,
    fixedInline: f.fixedInline,
    fixedBlock: f.fixedBlock,
    inlineAuto: !f.isRow && f.stretchCross ? 'stretch-explicit' : 'fit-content',
    blockAutoStretch: f.isRow && f.stretchCross,
    inlineMargins: marginSum(ctx, s.marginLeft, s.marginRight, f.contentWidth),
    blockMargins: marginSum(ctx, s.marginTop, s.marginBottom, f.contentWidth),
  };
  return sizeReplaced(ctx, leaf, bp, space, mode);
}

/**
 * Blink ComputeMinAndMaxContentContributionForReplaced: the leaf's min-content and max-content contribution (border box, no
 * margins), sized with no available or percentage size; a percentage width or max-width makes the min-content size min-width.
 */
export function replacedContribution(ctx: Ctx, leaf: ReplacedLeaf, kind: 'min' | 'max'): LU {
  const s = leaf.style;
  const bp = replacedBorderPadding(ctx, leaf, ZERO);
  const space: ReplacedSpace = {
    availableInline: null,
    availableBlock: null,
    percentInline: null,
    percentBlock: null,
    fixedInline: null,
    fixedBlock: null,
    inlineAuto: 'fit-content',
    blockAutoStretch: false,
    inlineMargins: ZERO,
    blockMargins: ZERO,
  };
  const size = sizeReplaced(ctx, leaf, bp, space, 'normal').inline;
  const percentWidth = (s.width.kind !== 'auto' && hasPercent(s.width)) || (s.maxWidth.kind !== 'none' && hasPercent(s.maxWidth));
  if (kind === 'max' || !percentWidth) return size;
  if (s.minWidth.kind === 'auto') return bp.inline;
  return borderBoxFromSpecified(resolveLength(s.minWidth, ZERO, ctx.faults), bp.inline, s.boxSizing);
}

/** The leaf's destination rect for a content box (objectFitRect with the leaf's object-fit and object-position). */
export function replacedObjectRect(ctx: Ctx, leaf: ReplacedLeaf, content: ObjectRect): ObjectRect {
  return objectFitRect(content, naturalSizingOf(leaf), leaf.objectFit, { x: leaf.objectPositionX, y: leaf.objectPositionY }, ctx.faults);
}

/** A rect in zoomed LU. */
export type ObjectRect = { readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

/** object-position after the environment pass: each axis an offset from the left or top edge (Chrome computes `right 10px` as calc(100% - 10px)). */
export type ObjectPosition = { readonly x: LengthPercent; readonly y: LengthPercent };

/** A physical size in LU. */
type ObjectSize = { readonly width: LU; readonly height: LU };

/** Blink PhysicalSize::FitToAspectRatio: shrink (contain) or grow (cover) one side so the size takes the ratio. */
function fitToRatio(width: LU, height: LU, ratio: LayoutRatio, grow: boolean): ObjectSize {
  const constrainedHeight = mulDiv(width, ratio.height, ratio.width);
  if ((grow && constrainedHeight < height) || (!grow && constrainedHeight > height)) return { width: mulDiv(height, ratio.width, ratio.height), height };
  return { width, height: constrainedHeight };
}

/**
 * Blink LayoutReplaced::ComputeObjectFitAndPositionRect: where the natural content is drawn, in the same coordinates as the
 * content box. With no natural size or ratio (an iframe) it is the content box. object-position resolves against the free space.
 */
export function objectFitRect(content: ObjectRect, natural: NaturalSizing, fit: ObjectFit, position: ObjectPosition, faults: EngineFaults): ObjectRect {
  const hasSize = natural.width !== null && natural.height !== null && natural.width > 0 && natural.height > 0;
  if (!hasSize && natural.ratio === null) return content;
  let w = content.width;
  let h = content.height;
  const nw = natural.width === null ? ZERO : natural.width;
  const nh = natural.height === null ? ZERO : natural.height;
  if (fit === 'contain' || fit === 'cover' || fit === 'scale-down') {
    if (natural.ratio !== null) {
      const f: ObjectSize = fitToRatio(w, h, natural.ratio, fit === 'cover');
      w = f.width;
      h = f.height;
    }
    // scale-down: the smaller of contain and none (an image from src has an image pixel ratio of 1).
    if (fit === 'scale-down' && w > nw && hasSize) {
      w = nw;
      h = nh;
    }
  } else if (fit === 'none' && hasSize) {
    // A ratio with no natural size (Blink ConcreteObjectSize) does not arise: a PNG has both, an iframe neither.
    w = nw;
    h = nh;
  }
  const x = resolveLength(position.x, sub(content.width, w), faults);
  const y = resolveLength(position.y, sub(content.height, h), faults);
  return { x: add(content.x, x), y: add(content.y, y), width: w, height: h };
}

/** A rect in whole device px. */
export type PixelRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** Blink SnapSizeToPixel: the distance between the snapped edges (whole px of the location cancel), at least one px for a size above 4/64 px. */
function snapSize(size: LU, location: LU): number {
  const result = snapEdge(add(location, size)) - snapEdge(location);
  if (result === 0 && (size > 4 || size < -4)) return size > 0 ? 1 : -1;
  return result;
}

/** Blink ToPixelSnappedRect of an absolute rect: rounded origin, snapped size. */
export function pixelSnappedRect(r: ObjectRect): PixelRect {
  return { x: snapEdge(r.x), y: snapEdge(r.y), width: snapSize(r.width, r.x), height: snapSize(r.height, r.y) };
}

/**
 * Blink ImagePainter::PaintIntoRect: the device-px rect an image is drawn into, from absolute LU rects. When the destination is
 * not inside the content box, the drawn part is the intersection of the two snapped rects; null when nothing is drawn.
 */
export function drawnObjectRect(dest: ObjectRect, content: ObjectRect): PixelRect | null {
  const d = pixelSnappedRect(dest);
  if (d.width <= 0 || d.height <= 0) return null;
  const inside = dest.x >= content.x && dest.y >= content.y && add(dest.x, dest.width) <= add(content.x, content.width) && add(dest.y, dest.height) <= add(content.y, content.height);
  if (inside) return d;
  const c = pixelSnappedRect(content);
  const x0 = c.x > d.x ? c.x : d.x;
  const y0 = c.y > d.y ? c.y : d.y;
  const x1 = c.x + c.width < d.x + d.width ? c.x + c.width : d.x + d.width;
  const y1 = c.y + c.height < d.y + d.height ? c.y + c.height : d.y + d.height;
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
