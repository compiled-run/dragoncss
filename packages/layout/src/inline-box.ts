// Atomic inlines (CSS2 §9.2.4, §10.3.9, §10.8.1; css-display-3 §2.4): an inline-block or inline-flex box among a block container's
// inline-level children. It is laid out as its block-level equivalent at its shrink-to-fit width, and takes part in its line as
// one U+FFFC item whose advance is its margin box and which sits on the baseline with its own baseline (INL-P family 5,
// docs/research/inline-spike/blink-notes.md §2 and §7).
import type { LayoutBox, LayoutStyle } from './input.ts';
import type { LU } from './units.ts';
import { add, max, min, sub, ZERO } from './units.ts';
import type { Frag } from './box.ts';
import { borderBoxFromSpecified, constrain, INDEFINITE, inlineMinMaxWith, isScrollContainer, resolveBorder, resolveInlineLengthWith, resolveMarginWith, resolvePaddingWith, sumEdges } from './box.ts';
import type { Ctx } from './block.ts';
import { layoutContents } from './block.ts';
import type { IntrinsicKind } from './intrinsic.ts';
import { inlineContribution, intrinsicContentInlineSize } from './intrinsic.ts';
import { unsupported } from './unsupported.ts';

/** Whether a box is an atomic inline: display inline-block or inline-flex. */
export function isAtomicInline(box: LayoutBox): boolean {
  return box.style.display === 'inline-block' || box.style.display === 'inline-flex';
}

/** The box with its block-level display (css-display-3 §2.4: inline-block is a flow-root block, inline-flex a flex container). */
export function blockLevelOf(box: LayoutBox): LayoutBox {
  if (!isAtomicInline(box)) return box;
  const display = box.style.display === 'inline-flex' ? 'flex' : 'block';
  const style: LayoutStyle = { ...box.style, display };
  return { kind: 'box', id: box.id, boxType: box.boxType, style, strut: box.strut, children: box.children };
}

/**
 * A laid-out atomic inline: its fragment, its physical margins, its advance (the margin-box width) and the distances of its margin
 * box above and below its baseline, which it adds to its line (CSS2 §10.8.1, Blink LogicalBoxFragment::BaselineMetrics).
 */
export type AtomicLayout = {
  readonly frag: Frag;
  readonly marginLeft: LU;
  readonly marginRight: LU;
  readonly marginTop: LU;
  readonly advance: LU;
  readonly above: LU;
  readonly below: LU;
};

// CSS2 §10.3.9 (Blink ComputeInlineSizeForFragment with shrink-to-fit): a specified width, or min(max(min-content, available),
// max-content) with the available width the containing block's less the margins; then min-width and max-width. Planted fault
// atomicShrinkToFitIgnored fills the available width instead.
function atomicWidth(ctx: Ctx, box: LayoutBox, cbInline: LU, margins: LU): LU {
  const s = box.style;
  const pad = resolvePaddingWith(s, cbInline, ctx.faults);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const specified = resolveInlineLengthWith(s.width, cbInline, ctx.faults);
  let width: LU;
  if (specified !== null) width = borderBoxFromSpecified(specified, hbp, s.boxSizing);
  else if (ctx.faults.atomicShrinkToFitIgnored) width = sub(cbInline, margins);
  else {
    const block = blockLevelOf(box);
    const minContent = add(intrinsicContentInlineSize(ctx, block, 'min'), hbp);
    const maxContent = add(intrinsicContentInlineSize(ctx, block, 'max'), hbp);
    width = min(maxContent, max(minContent, sub(cbInline, margins)));
  }
  return max(constrain(width, inlineMinMaxWith(s, cbInline, hbp, ctx.faults)), hbp);
}

/**
 * The baseline of an atomic inline from its border-box top (Blink 145, blink-notes.md §7), or null to synthesize it at the bottom
 * margin edge. inline-block: its last line box's baseline (block_layout_algorithm.cc:1448-1451, :3622-3647), none when it is a
 * scroll container (physical_box_fragment.h:167-172). inline-flex: the flex container's first baseline (flex_layout_algorithm.cc
 * :80-142). A last baseline that a flex container inside the inline-block would decide is refused.
 */
function atomicBaseline(ctx: Ctx, box: LayoutBox, frag: Frag, last: LU | null, lastFlex: string): LU | null {
  if (box.style.display === 'inline-flex') {
    if (!ctx.faults.inlineFlexLastBaseline) return frag.baseline;
    // Planted fault inlineFlexLastBaseline: the last item's own baseline.
    const item = frag.children[frag.children.length - 1];
    return item === undefined || item.frag.baseline === null ? frag.baseline : add(item.y, item.frag.baseline);
  }
  if (isScrollContainer(box.style) && !ctx.faults.overflowBaselineIgnored) return null;
  // Planted fault inlineBlockFirstBaseline: the first baseline.
  if (ctx.faults.inlineBlockFirstBaseline) return frag.baseline;
  if (lastFlex !== '') unsupported('flex-baseline', lastFlex, 'CSS2 §10.8.1, css-flexbox-1 §8.5', `the last baseline of flex container ${lastFlex} would give the baseline of inline-block ${box.id}`);
  return last;
}

/** Lays out an atomic inline in a block container whose content box is cbInline wide (percentages resolve against it). */
export function layoutAtomic(ctx: Ctx, box: LayoutBox, cbInline: LU): AtomicLayout {
  const s = box.style;
  const ml = resolveMarginWith(s.marginLeft, cbInline, ctx.faults).value;
  const mr = resolveMarginWith(s.marginRight, cbInline, ctx.faults).value;
  const mt = resolveMarginWith(s.marginTop, cbInline, ctx.faults).value;
  const mb = resolveMarginWith(s.marginBottom, cbInline, ctx.faults).value;
  // Planted fault atomicMarginExcluded: the margins take no space.
  const noMargins = ctx.faults.atomicMarginExcluded;
  const marginLeft = noMargins ? ZERO : ml;
  const marginRight = noMargins ? ZERO : mr;
  const marginTop = noMargins ? ZERO : mt;
  const marginBottom = noMargins ? ZERO : mb;
  const width = atomicWidth(ctx, box, cbInline, add(ml, mr));
  // inline.ts checkAtomic refuses a percentage block size, so the containing block's height is never read.
  const r = layoutContents(ctx, blockLevelOf(box), {
    cbInline,
    borderBoxWidth: width,
    forcedBorderBoxHeight: null,
    forcedHeightDefinite: false,
    heightBasis: INDEFINITE,
    formattingContextRoot: true,
  });
  const baseline = atomicBaseline(ctx, box, r.frag, r.lastBaseline, r.lastBaselineFlex);
  const marginBox = add(add(marginTop, r.frag.height), marginBottom);
  const above = baseline === null ? marginBox : add(marginTop, baseline);
  return { frag: r.frag, marginLeft, marginRight, marginTop, advance: add(add(marginLeft, width), marginRight), above, below: sub(marginBox, above) };
}

/** An atomic inline's min-content or max-content contribution: its margin box (css-sizing-3 §5.2). */
export function atomicContribution(ctx: Ctx, box: LayoutBox, kind: IntrinsicKind): LU {
  const c = inlineContribution(ctx, blockLevelOf(box), kind);
  if (!ctx.faults.atomicMarginExcluded) return c;
  const s = box.style;
  const m = (v: typeof s.marginLeft): LU => (v.kind === 'px' ? resolveMarginWith(v, ZERO, ctx.faults).value : ZERO);
  return sub(c, add(m(s.marginLeft), m(s.marginRight)));
}
