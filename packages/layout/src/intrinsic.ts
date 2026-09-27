// Intrinsic inline sizes (css-sizing-3 §5) and flex container intrinsic inline sizes (css-flexbox-1 §9.9.1, §9.9.2).
import type { LayoutBox, TextLeaf } from './input.ts';
import type { LU } from './units.ts';
import { add, fromCssPx, max, min, sum, ZERO, mulInt } from './units.ts';
import { borderBoxFromSpecified, resolveBorder, requireLtr, sumEdges, visibleChildren } from './box.ts';
import type { Ctx } from './block.ts';
import { unsupported } from './unsupported.ts';

export type IntrinsicKind = 'min' | 'max';

// css-sizing-3 §5.1: the min-content or max-content inline size of a box's content box.
export function intrinsicContentInlineSize(ctx: Ctx, box: LayoutBox, kind: IntrinsicKind): LU {
  requireLtr(box);
  const kids = visibleChildren(box);
  if (box.style.display === 'flex') return flexIntrinsicContent(ctx, box, kind);
  const texts = kids.filter((k): k is TextLeaf => k.kind === 'text');
  if (texts.length > 0) {
    if (texts.length !== kids.length) unsupported('anonymous-block', box.id, 'CSS2 §9.2.1.1', 'block container mixes text and block children');
    return textIntrinsic(ctx, box.id, texts, kind);
  }
  let widest = ZERO;
  for (const k of kids) if (k.kind === 'box') widest = max(widest, inlineContribution(ctx, k, kind));
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

// css-text-3 §4.1: single-line text contributes its advance (max) or its widest unbreakable piece (min).
function textIntrinsic(ctx: Ctx, nodeId: string, texts: readonly TextLeaf[], kind: IntrinsicKind): LU {
  const widths: LU[] = [];
  let widestPiece = ZERO;
  for (const t of texts) {
    const r = ctx.measurer.measure(t.text, t.font);
    if (!r.ok) unsupported('text-glyph', t.id, 'css-fonts-4 §5', r.reason);
    widths.push(r.measure.width);
    widestPiece = max(widestPiece, r.measure.minContentWidth);
  }
  if (kind === 'max') return sum(widths);
  if (texts.length > 1) unsupported('multi-line-text', nodeId, 'css-text-3 §5', 'min-content of several adjacent text runs');
  return widestPiece;
}

// css-flexbox-1 §9.9.1 (row): max-content sums item contributions plus gaps; min-content sums them for a single line and takes the
// largest for a multi-line container. §9.9.2 (column, single-line): the largest contribution.
function flexIntrinsicContent(ctx: Ctx, box: LayoutBox, kind: IntrinsicKind): LU {
  const s = box.style;
  const kids = visibleChildren(box);
  for (const k of kids) if (k.kind === 'text') unsupported('anonymous-flex-item', k.id, 'css-flexbox-1 §4', 'text directly inside a flex container');
  const items = kids.filter((k): k is LayoutBox => k.kind === 'box');
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
