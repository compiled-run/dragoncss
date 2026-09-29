// Intrinsic inline sizes (css-sizing-3 §5) and flex container intrinsic inline sizes (css-flexbox-1 §9.9.1, §9.9.2).
import type { LayoutBox, TextLeaf } from './input.ts';
import type { LU } from './units.ts';
import { add, fromCssPx, max, min, sum, ZERO, mulInt } from './units.ts';
import { borderBoxFromSpecified, resolveBorder, sumEdges } from './box.ts';
import type { Ctx } from './block.ts';
import { gridIntrinsicContentInlineSize } from './grid.ts';
import { inlineIntrinsicSize } from './inline.ts';
import { isOutOfFlow } from './position.ts';
import { unsupported } from './unsupported.ts';

export type IntrinsicKind = 'min' | 'max';

// css-sizing-3 §5.1: the min-content or max-content inline size of a box's content box. Absolutely positioned children take no
// part (CSS2 §9.3.1).
export function intrinsicContentInlineSize(ctx: Ctx, box: LayoutBox, kind: IntrinsicKind): LU {
  const kids = box.children;
  if (box.style.display === 'flex') return flexIntrinsicContent(ctx, box, kind);
  if (box.style.display === 'grid') return gridIntrinsicContentInlineSize(ctx, box, kind);
  const texts = kids.filter((k): k is TextLeaf => k.kind === 'text');
  if (texts.length > 0) {
    if (texts.length !== kids.length) throw new Error(`${box.id} mixes text and boxes; validateLayoutInput rejects this input`);
    return inlineIntrinsicSize(ctx, box, texts, kind);
  }
  let widest = ZERO;
  for (const k of kids) if (k.kind === 'box' && !isOutOfFlow(ctx, k)) widest = max(widest, inlineContribution(ctx, k, kind));
  return widest;
}

// css-sizing-3 §5.2: a box's outer inline-size contribution. §5.2.1 cyclic percentages: percentage width behaves as auto, percentage
// min-width as auto and max-width as none, percentage padding and margins and auto margins contribute zero (fixture intrinsic-percent).
export function inlineContribution(ctx: Ctx, box: LayoutBox, kind: IntrinsicKind): LU {
  const s = box.style;
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const pad = (v: typeof s.paddingLeft): LU => (v.kind === 'px' ? fromCssPx(v.value) : ZERO);
  const bp = sumEdges(bor.left, bor.right, pad(s.paddingLeft), pad(s.paddingRight));
  let size: LU;
  if (s.width.kind === 'px') size = borderBoxFromSpecified(fromCssPx(s.width.value), bp, s.boxSizing);
  else size = add(intrinsicContentInlineSize(ctx, box, kind), bp);
  if (s.maxWidth.kind === 'px') size = min(size, borderBoxFromSpecified(fromCssPx(s.maxWidth.value), bp, s.boxSizing));
  if (s.minWidth.kind === 'px') size = max(size, borderBoxFromSpecified(fromCssPx(s.minWidth.value), bp, s.boxSizing));
  size = max(size, bp);
  const margin = (v: typeof s.marginLeft): LU => (v.kind === 'px' ? fromCssPx(v.value) : ZERO);
  return add(size, add(margin(s.marginLeft), margin(s.marginRight)));
}

// css-flexbox-1 §9.9.1 (row): max-content sums item contributions plus gaps; min-content sums them for a single line and takes the
// largest for a multi-line container. §9.9.2 (column, single-line): the largest contribution.
function flexIntrinsicContent(ctx: Ctx, box: LayoutBox, kind: IntrinsicKind): LU {
  const s = box.style;
  const items = box.children.filter((k): k is LayoutBox => k.kind === 'box' && !isOutOfFlow(ctx, k));
  const contributions = items.map((k) => inlineContribution(ctx, k, kind));
  const isRow = s.flexDirection === 'row' || s.flexDirection === 'row-reverse';
  if (!isRow && s.flexWrap !== 'nowrap') unsupported('flex-intrinsic-wrap-column', box.id, 'css-flexbox-1 §9.9.2', 'intrinsic inline size of a multi-line column flex container');
  if (!isRow || (kind === 'min' && s.flexWrap !== 'nowrap')) {
    let widest = ZERO;
    for (const c of contributions) widest = max(widest, c);
    return widest;
  }
  const gap = s.columnGap;
  if (gap.kind === 'percent') unsupported('percent-gap', box.id, 'css-align-3 §8.1', 'percentage gap (not yet supported)');
  const gapLu = gap.kind === 'px' ? fromCssPx(gap.value) : ZERO;
  const gaps = items.length > 1 ? mulInt(gapLu, items.length - 1) : ZERO;
  return add(sum(contributions), gaps);
}
