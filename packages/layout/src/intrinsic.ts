// Intrinsic inline sizes (css-sizing-3 §5) and flex container intrinsic inline sizes (css-flexbox-1 §9.9.1, §9.9.2).
import type { Auto, LayoutBox, LayoutNode, NoneValue } from './input.ts';
import type { LU } from './units.ts';
import { add, fromCssPx, max, min, sum, ZERO, mulInt } from './units.ts';
import { borderBoxFromSpecified, hasPercent, lengthMaxWidth, lengthMinWidth, lengthWidth, resolveBorder, resolveLength, resolveMinLength, sumEdges } from './box.ts';
import type { Ctx } from './block.ts';
import { gridIntrinsicContentInlineSize } from './grid.ts';
import { inlineIntrinsicSize } from './inline.ts';
import { isOutOfFlow } from './position.ts';
import { hasAspectRatio, ratioInlineContribution } from './ratio.ts';
import { replacedContribution } from './replaced.ts';
import { unsupported } from './unsupported.ts';

export type IntrinsicKind = 'min' | 'max';

const AUTO: Auto = { kind: 'auto' };
const NONE: NoneValue = { kind: 'none' };

// css-sizing-3 §5.1: the min-content or max-content inline size of a box's content box. Absolutely positioned children take no
// part (CSS2 §9.3.1).
export function intrinsicContentInlineSize(ctx: Ctx, box: LayoutBox, kind: IntrinsicKind): LU {
  const kids = box.children;
  if (box.style.display === 'flex') return flexIntrinsicContent(ctx, box, kind);
  if (box.style.display === 'grid') return gridIntrinsicContentInlineSize(ctx, box, kind);
  if (box.strut !== null) return inlineIntrinsicSize(ctx, box, kind);
  if (kids.some((k) => k.kind !== 'box' && k.kind !== 'replaced')) throw new Error(`${box.id}: inline content without a strut (validateLayoutInput rejects it)`);
  // CSS2 §9.5 (Blink BlockNode::ComputeMinMaxSizes): floats sit beside each other on one "line", so in the max-content size the left
  // floats' contributions add up, as do the right floats', and the two sides add up; each float alone bounds the min-content size.
  // The compiler keeps every float of a formatting context after its in-flow boxes, with no clear (computed-checks.ts checkFloats).
  let widest = ZERO;
  let left = ZERO;
  let right = ZERO;
  for (const k of kids) {
    if ((k.kind !== 'box' && k.kind !== 'replaced') || isOutOfFlow(ctx, k)) continue;
    const c = inlineContribution(ctx, k, kind);
    if (kind === 'max' && k.style.float === 'left') left = add(left, c);
    else if (kind === 'max' && k.style.float === 'right') right = add(right, c);
    else widest = max(widest, c);
  }
  return max(widest, add(left, right));
  return widest;
}

// css-sizing-3 §5.2: a box's outer inline-size contribution. §5.2.1 cyclic percentages: percentage width behaves as auto, percentage
// min-width as auto and max-width as none, percentage padding and margins and auto margins contribute zero (fixture intrinsic-percent).
export function inlineContribution(ctx: Ctx, node: LayoutNode, kind: IntrinsicKind): LU {
  const s = node.style;
  const margin = (v: typeof s.marginLeft): LU => (v.kind === 'px' ? fromCssPx(v.value) : v.kind === 'calc' ? resolveLength(v, ZERO, ctx.faults) : ZERO);
  // A replaced box contributes its replaced size, which already holds min-width and max-width (replaced.ts).
  if (node.kind === 'replaced') return add(replacedContribution(ctx, node, kind), add(margin(s.marginLeft), margin(s.marginRight)));
  const box = node;
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  // A calculation evaluates against a basis of 0 (Blink MinimumValueForLength with no percentage resolution size): calc(10px + 5%) is 10px.
  const pad = (v: typeof s.paddingLeft): LU => (v.kind === 'px' ? fromCssPx(v.value) : v.kind === 'calc' ? resolveLength(v, ZERO, ctx.faults) : ZERO);
  const bp = sumEdges(bor.left, bor.right, pad(s.paddingLeft), pad(s.paddingRight));
  // css-sizing-3 §5.2: min-content and max-content contribute that size of the content box, fit-content the size being asked for
  // (Blink ComputeMinMaxInlineSizes resolves a keyword width, min-width or max-width through the box's own min and max content).
  // stretch has no size without an available space: a width or min-width of stretch contributes as auto, a max-width as none.
  const keyword = (k: string): LU | null => {
    if (k !== 'min-content' && k !== 'max-content' && k !== 'fit-content') return null;
    if (hasAspectRatio(s)) return unsupported('intrinsic-size-keyword', box.id, 'css-sizing-4 §5.1', `${k} with an aspect-ratio`);
    return add(intrinsicContentInlineSize(ctx, box, k === 'min-content' ? 'min' : k === 'max-content' ? 'max' : kind), bp);
  };
  const width = keyword(s.width.kind);
  const maxWidth = keyword(s.maxWidth.kind);
  const minWidth = keyword(s.minWidth.kind);
  // Blink ResolveInlineLengthInternal with an indefinite percentage basis: a width or max-width with a percentage is auto or none,
  // a min-width with one resolves against 0, so min-width: calc(60px - 10%) contributes 60px (probed in Chrome 145).
  let size: LU;
  if (width !== null) {
    size = width;
  } else {
    const w = s.width.kind === 'stretch' ? AUTO : lengthWidth(box.id, s.width);
    if (w.kind !== 'auto' && !hasPercent(w)) size = borderBoxFromSpecified(resolveLength(w, ZERO, ctx.faults), bp, s.boxSizing);
    else if (hasAspectRatio(s)) size = ratioInlineContribution(ctx, box, kind);
    else size = add(intrinsicContentInlineSize(ctx, box, kind), bp);
  }
  if (maxWidth !== null) {
    size = min(size, maxWidth);
  } else {
    const hi = s.maxWidth.kind === 'stretch' ? NONE : lengthMaxWidth(box.id, s.maxWidth);
    if (hi.kind !== 'none' && !hasPercent(hi)) size = min(size, borderBoxFromSpecified(resolveLength(hi, ZERO, ctx.faults), bp, s.boxSizing));
  }
  if (minWidth !== null) {
    size = max(size, minWidth);
  } else {
    const lo = s.minWidth.kind === 'stretch' ? AUTO : lengthMinWidth(box.id, s.minWidth);
    if (lo.kind !== 'auto') size = max(size, borderBoxFromSpecified(resolveMinLength(lo, null, ctx.faults), bp, s.boxSizing));
  }
  size = max(size, bp);
  return add(size, add(margin(s.marginLeft), margin(s.marginRight)));
}

// css-flexbox-1 §9.9.1 (row): max-content sums item contributions plus gaps; min-content sums them for a single line and takes the
// largest for a multi-line container. §9.9.2 (column, single-line): the largest contribution.
function flexIntrinsicContent(ctx: Ctx, box: LayoutBox, kind: IntrinsicKind): LU {
  const s = box.style;
  const items = box.children.filter((k): k is LayoutNode => (k.kind === 'box' || k.kind === 'replaced') && !isOutOfFlow(ctx, k));
  const contributions = items.map((k) => inlineContribution(ctx, k, kind));
  const isRow = s.flexDirection === 'row' || s.flexDirection === 'row-reverse';
  if (!isRow && s.flexWrap !== 'nowrap') unsupported('flex-intrinsic-wrap-column', box.id, 'css-flexbox-1 §9.9.2', 'intrinsic inline size of a multi-line column flex container');
  if (!isRow || (kind === 'min' && s.flexWrap !== 'nowrap')) {
    let widest = ZERO;
    for (const c of contributions) widest = max(widest, c);
    return widest;
  }
  const gap = s.columnGap;
  if (gap.kind !== 'normal' && hasPercent(gap)) unsupported('percent-gap', box.id, 'css-align-3 §8.1', 'percentage gap (not yet supported)');
  const gapLu = gap.kind === 'normal' ? ZERO : resolveLength(gap, ZERO, ctx.faults);
  const gaps = items.length > 1 ? mulInt(gapLu, items.length - 1) : ZERO;
  return add(sum(contributions), gaps);
}
