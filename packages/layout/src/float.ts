// FLT: floats (CSS2 §9.5, §10.3.5, §10.6.7). A float is a block-level box that leaves the flow: shrink-to-fit wide, placed as high
// as it can go at its flow position and then as far left (or right) as it fits beside the floats before it in its container, and
// counted in the height of the block formatting context root that holds it. Floats never move in-flow boxes here: the compiler
// refuses a float whose formatting context has in-flow content after it, and floats whose formatting context holds floats in
// another container (analysis/computed-checks.ts checkFloats), so no line box or block box ever has to avoid one.
import type { Float, LayoutBox, LayoutNode } from './input.ts';
import type { LU } from './units.ts';
import { add, max, min, sub, ZERO } from './units.ts';
import type { Frag, HeightBasis, Placed } from './box.ts';
import {
  borderBoxFromSpecified,
  constrain,
  contentBox,
  inlineMinMaxOf,
  isScrollContainer,
  lengthWidth,
  resolveBorder,
  resolveInlineLengthWith,
  resolveMarginWith,
  resolvePaddingWith,
  sumEdges,
} from './box.ts';
import type { Ctx } from './block.ts';
import { layoutContents } from './block.ts';
import { intrinsicContentInlineSize } from './intrinsic.ts';
import { isOutOfFlow } from './position.ts';
import { layoutReplacedInFlow } from './replaced.ts';
import { unsupported } from './unsupported.ts';

/** Whether a child of a block container floats (CSS2 §9.5); an absolutely positioned box never does (§9.7). */
export function isFloat(ctx: Ctx, node: LayoutNode): boolean {
  return node.style.float !== 'none' && !isOutOfFlow(ctx, node);
}

/** A float's margin box in its container's content box, and its side. */
export type FloatArea = { readonly side: Float; readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

/** A laid-out float: its fragment and its resolved margins. */
export type FloatLayout = { readonly frag: Frag; readonly marginLeft: LU; readonly marginRight: LU; readonly marginTop: LU; readonly marginBottom: LU };

// CSS2 §10.3.5 (Blink ComputeInlineSizeForFragment with shrink-to-fit): a specified width, or min(max(min-content, available),
// max-content) with the available width the containing block's less the margins; then min-width and max-width.
function floatWidth(ctx: Ctx, box: LayoutBox, cbInline: LU, margins: LU): LU {
  const s = box.style;
  const pad = resolvePaddingWith(s, cbInline, ctx.faults);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const specified = resolveInlineLengthWith(lengthWidth(box.id, s.width), cbInline, ctx.faults);
  let width: LU;
  if (specified !== null) width = borderBoxFromSpecified(specified, hbp, s.boxSizing);
  else {
    const minContent = add(intrinsicContentInlineSize(ctx, box, 'min'), hbp);
    const maxContent = add(intrinsicContentInlineSize(ctx, box, 'max'), hbp);
    width = min(maxContent, max(minContent, sub(cbInline, margins)));
  }
  return max(constrain(width, inlineMinMaxOf(box.id, s, cbInline, hbp, ctx.faults)), hbp);
}

/**
 * Lays out a float in a block container whose content box is cbInline wide: a box as a new formatting context at its shrink-to-fit
 * width, a replaced box as a block-level one (CSS2 §10.3.6, §10.6.2); auto margins are 0. A relatively positioned float and a
 * negative margin, which would let it overlap the boxes Dragon does not move, are refused.
 */
export function layoutFloat(ctx: Ctx, node: LayoutNode, cbInline: LU, basis: HeightBasis): FloatLayout {
  const s = node.style;
  if (s.position !== 'static') unsupported('float', node.id, 'CSS2 §9.4.3, §9.5', `a ${s.position} float ${node.id}`);
  const marginLeft = resolveMarginWith(s.marginLeft, cbInline, ctx.faults).value;
  const marginRight = resolveMarginWith(s.marginRight, cbInline, ctx.faults).value;
  const marginTop = resolveMarginWith(s.marginTop, cbInline, ctx.faults).value;
  const marginBottom = resolveMarginWith(s.marginBottom, cbInline, ctx.faults).value;
  if (marginLeft < 0 || marginRight < 0 || marginTop < 0 || marginBottom < 0) unsupported('float', node.id, 'CSS2 §9.5.1', `a negative margin on float ${node.id}`);
  if (node.kind === 'replaced') return { frag: layoutReplacedInFlow(ctx, node, cbInline, basis), marginLeft, marginRight, marginTop, marginBottom };
  const width = floatWidth(ctx, node, cbInline, add(marginLeft, marginRight));
  const r = layoutContents(ctx, node, {
    cbInline,
    borderBoxWidth: width,
    forcedBorderBoxHeight: null,
    forcedHeightDefinite: false,
    heightBasis: basis,
    formattingContextRoot: true,
    bfcLineOffset: ZERO,
  });
  return { frag: r.frag, marginLeft, marginRight, marginTop, marginBottom };
}

/**
 * CSS2 §9.5.1: where a float's margin box (width x height) goes in a content box cbInline wide, given the floats before it in the
 * same container and its flow position top. Its top is no higher than top or any earlier float's top (rule 5); it is placed at the
 * highest offset (top, or an earlier float's bottom) where it fits between the left floats' right edges and the right floats' left
 * edges beside it (rules 2, 3, 7 and 8), or where no float is beside it; then as far left or right as it goes (rule 9).
 */
export function placeFloat(floats: readonly FloatArea[], side: Float, width: LU, height: LU, top: LU, cbInline: LU): FloatArea {
  let at = top;
  for (const f of floats) at = max(at, f.y);
  for (;;) {
    let left = ZERO;
    let right = cbInline;
    let beside = false;
    // The next offset to try: the nearest bottom of a float beside this one.
    let next: LU | null = null;
    for (const f of floats) {
      // An earlier float's top is at or above at, so it is beside the new float while its bottom is below at.
      const bottom = add(f.y, f.height);
      if (bottom <= at) continue;
      beside = true;
      next = next === null ? bottom : min(next, bottom);
      if (f.side === 'left') left = max(left, add(f.x, f.width));
      else right = min(right, f.x);
    }
    if (!beside || sub(right, left) >= width) return { side, x: side === 'left' ? left : sub(right, width), y: at, width, height };
    at = next as LU;
  }
}

/** A block box whose floats belong to its parent's formatting context: a block container that is no new formatting context. */
function sharesFormattingContext(ctx: Ctx, node: LayoutNode): boolean {
  return node.kind === 'box' && node.style.display === 'block' && node.strut === null && !isScrollContainer(node.style) && !isFloat(ctx, node) && !isOutOfFlow(ctx, node);
}

/**
 * CSS2 §10.6.7: the bottom margin edge of the lowest float in a box's formatting context, from its border-box top: its own floats
 * and those of the block boxes in it that are no new formatting context, from the fragments its flow placed. null without floats.
 * A relatively positioned box between them is refused (its offset moves the float, not the formatting context's area).
 */
export function floatsBottom(ctx: Ctx, box: LayoutBox, placed: readonly Placed[], cbInline: LU): LU | null {
  let bottom: LU | null = null;
  for (const k of box.children) {
    if (k.kind !== 'box' && k.kind !== 'replaced') continue;
    let p: Placed | null = null;
    for (const x of placed) if (x.frag.id === k.id) p = x;
    if (p === null) continue;
    let b: LU | null = null;
    if (isFloat(ctx, k)) {
      b = add(add(p.y, p.frag.height), resolveMarginWith(k.style.marginBottom, cbInline, ctx.faults).value);
    } else if (sharesFormattingContext(ctx, k)) {
      const kb = k as LayoutBox;
      const pad = resolvePaddingWith(kb.style, cbInline, ctx.faults);
      const bor = resolveBorder(kb.style, ctx.devicePixelRatio);
      const inner = floatsBottom(ctx, kb, p.frag.children, contentBox(p.frag.width, sumEdges(bor.left, bor.right, pad.left, pad.right)));
      if (inner !== null) {
        if (kb.style.position !== 'static') unsupported('float', kb.id, 'CSS2 §9.4.3, §10.6.7', `the ${kb.style.position} box ${kb.id} holds a float of its parent's formatting context`);
        b = add(p.y, inner);
      }
    }
    if (b !== null) bottom = bottom === null ? b : max(bottom, b);
  }
  return bottom;
}
