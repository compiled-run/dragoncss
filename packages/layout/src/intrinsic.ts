// Intrinsic inline sizes (css-sizing-3 §5) and flex container intrinsic inline sizes (css-flexbox-1 §9.9.1, §9.9.2).
import type { LayoutBox, LayoutNode, TextLeaf } from './input.ts';
import type { LU } from './units.ts';
import { add, fromCssPx, max, min, sum, ZERO, mulInt } from './units.ts';
import { borderBoxFromSpecified, hasPercent, resolveBorder, resolveLength, resolveMinLength, sumEdges } from './box.ts';
import type { Ctx } from './block.ts';
import { inlineIntrinsicSize } from './inline.ts';
import { isOutOfFlow } from './position.ts';
import { hasAspectRatio, ratioInlineContribution } from './ratio.ts';
import { replacedContribution } from './replaced.ts';
import { unsupported } from './unsupported.ts';

export type IntrinsicKind = 'min' | 'max';

// css-sizing-3 §5.1: the min-content or max-content inline size of a box's content box. Absolutely positioned children take no
// part (CSS2 §9.3.1).
export function intrinsicContentInlineSize(ctx: Ctx, box: LayoutBox, kind: IntrinsicKind): LU {
  const kids = box.children;
  if (box.style.display === 'flex') return flexIntrinsicContent(ctx, box, kind);
  const texts = kids.filter((k): k is TextLeaf => k.kind === 'text');
  if (texts.length > 0) {
    if (texts.length !== kids.length) throw new Error(`${box.id} mixes text and boxes; validateLayoutInput rejects this input`);
    return inlineIntrinsicSize(ctx, box, texts, kind);
  }
  let widest = ZERO;
  for (const k of kids) if (k.kind !== 'text' && !isOutOfFlow(ctx, k)) widest = max(widest, inlineContribution(ctx, k, kind));
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
  // Blink ResolveInlineLengthInternal with an indefinite percentage basis: a width or max-width with a percentage is auto or none,
  // a min-width with one resolves against 0, so min-width: calc(60px - 10%) contributes 60px (probed in Chrome 145).
  let size: LU;
  if (s.width.kind !== 'auto' && !hasPercent(s.width)) size = borderBoxFromSpecified(resolveLength(s.width, ZERO, ctx.faults), bp, s.boxSizing);
  else if (hasAspectRatio(s)) size = ratioInlineContribution(ctx, box, kind);
  else size = add(intrinsicContentInlineSize(ctx, box, kind), bp);
  if (s.maxWidth.kind !== 'none' && !hasPercent(s.maxWidth)) size = min(size, borderBoxFromSpecified(resolveLength(s.maxWidth, ZERO, ctx.faults), bp, s.boxSizing));
  if (s.minWidth.kind !== 'auto') size = max(size, borderBoxFromSpecified(resolveMinLength(s.minWidth, null, ctx.faults), bp, s.boxSizing));
  size = max(size, bp);
  return add(size, add(margin(s.marginLeft), margin(s.marginRight)));
}

// css-flexbox-1 §9.9.1 (row): max-content sums item contributions plus gaps; min-content sums them for a single line and takes the
// largest for a multi-line container. §9.9.2 (column, single-line): the largest contribution.
function flexIntrinsicContent(ctx: Ctx, box: LayoutBox, kind: IntrinsicKind): LU {
  const s = box.style;
  const items = box.children.filter((k): k is LayoutNode => k.kind !== 'text' && !isOutOfFlow(ctx, k));
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
