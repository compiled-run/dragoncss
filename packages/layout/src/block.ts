// Block formatting: box contents, block-level widths and heights, S1 margin collapsing, and single-line inline content.
import type { LayoutBox, TextLeaf } from './input.ts';
import type { LU } from './units.ts';
import {
  add,
  divInt,
  floorToWholePx,
  fromCssPx,
  lineHeightFromNumber,
  max,
  sub,
  sum,
  ZERO,
} from './units.ts';
import type { Edges, Frag, HeightBasis, Placed } from './box.ts';
import {
  blockMinMax,
  borderBoxFromSpecified,
  constrain,
  contentBox,
  hasNonTrivialBlockMinMax,
  inlineMinMax,
  INDEFINITE,
  requireLtr,
  resolveBorder,
  resolveInlineLength,
  resolveMargin,
  resolvePadding,
  specifiedBlockSize,
  sumEdges,
  visibleChildren,
} from './box.ts';
import { layoutFlexContainer } from './flex.ts';
import type { TextMeasurer } from './text.ts';
import { unsupported } from './unsupported.ts';

export type Ctx = { readonly measurer: TextMeasurer };

export type ContentsArgs = {
  /** Inline size of the containing block, the basis for percentage padding and margins. */
  readonly cbInline: LU;
  readonly borderBoxWidth: LU;
  /** A border-box height fixed by a flex container, or null. */
  readonly forcedBorderBoxHeight: LU | null;
  /** The containing block's block size, for this box's percentage heights. */
  readonly heightBasis: HeightBasis;
  /** True when the box establishes an independent formatting context (root, flex item). */
  readonly formattingContextRoot: boolean;
};

export type ContentsResult = {
  readonly frag: Frag;
  /** Margins from descendants that adjoin this box's top margin (CSS2 §8.3.1). */
  readonly escapeTop: readonly LU[];
  readonly escapeBottom: readonly LU[];
  readonly collapseThrough: boolean;
};

// CSS2 §10.6.3 and §10.7: lays out a box at a given border-box width and resolves its used height.
export function layoutContents(ctx: Ctx, box: LayoutBox, a: ContentsArgs): ContentsResult {
  requireLtr(box);
  const s = box.style;
  const pad = resolvePadding(s, a.cbInline);
  const bor = resolveBorder(s);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const vbp = sumEdges(bor.top, bor.bottom, pad.top, pad.bottom);
  const contentWidth = contentBox(a.borderBoxWidth, hbp);
  const minMax = blockMinMax(box, a.heightBasis, vbp);
  const specified = a.forcedBorderBoxHeight === null ? specifiedBlockSize(box, a.heightBasis, vbp) : null;
  const fixedBorderBox = a.forcedBorderBoxHeight !== null
    ? a.forcedBorderBoxHeight
    : specified === null ? null : constrain(specified, minMax);
  const childBasis: HeightBasis = a.forcedBorderBoxHeight !== null
    ? { kind: 'flex-dependent' }
    : fixedBorderBox === null ? INDEFINITE : { kind: 'definite', value: contentBox(fixedBorderBox, vbp) };

  let contentHeight: LU;
  let placed: readonly Placed[];
  let escapeTop: readonly LU[] = [];
  let escapeBottom: readonly LU[] = [];
  let hasContent = true;
  if (s.display === 'flex') {
    const r = layoutFlexContainer(ctx, box, {
      pad,
      bor,
      contentWidth,
      definiteInnerHeight: fixedBorderBox === null ? null : contentBox(fixedBorderBox, vbp),
      innerHeightMinMax: {
        min: contentBox(minMax.min, vbp),
        max: minMax.max === null ? null : contentBox(minMax.max, vbp),
      },
      childBasis,
      sizeIsFlexDependent: a.forcedBorderBoxHeight !== null,
    });
    contentHeight = r.contentHeight;
    placed = r.placed;
  } else {
    const canCollapseTop = !a.formattingContextRoot && bor.top === 0 && pad.top === 0;
    const canCollapseBottom = !a.formattingContextRoot && bor.bottom === 0 && pad.bottom === 0 && fixedBorderBox === null;
    const r = layoutBlockFlow(ctx, box, {
      contentWidth,
      origin: { x: add(bor.left, pad.left), y: add(bor.top, pad.top) },
      canCollapseTop,
      canCollapseBottom,
      childBasis,
    });
    contentHeight = r.contentHeight;
    placed = r.placed;
    escapeTop = r.escapeTop;
    escapeBottom = r.escapeBottom;
    hasContent = r.hasContent;
    if (hasNonZero(escapeBottom) && hasNonTrivialBlockMinMax(minMax, vbp)) {
      unsupported('margin-collapse', box.id, 'CSS2 §8.3.1', 'bottom margin collapsing through a box with min-height or max-height (S2)');
    }
  }

  const height = fixedBorderBox !== null ? fixedBorderBox : constrain(add(contentHeight, vbp), minMax);
  const collapseThrough = !a.formattingContextRoot && s.display === 'block' && !hasContent && height === 0 && vbp === 0;
  if (!hasContent && !collapseThrough && hasNonZero(escapeTop)) {
    unsupported('margin-collapse', box.id, 'CSS2 §8.3.1', 'child margins adjoining the top of a box without in-flow content (S2)');
  }
  return {
    frag: { id: box.id, width: a.borderBoxWidth, height, children: placed },
    escapeTop,
    escapeBottom: collapseThrough ? [] : escapeBottom,
    collapseThrough,
  };
}

function hasNonZero(values: readonly LU[]): boolean {
  return values.some((v) => v !== 0);
}

// CSS2 §8.3.1 (S1 subset): a collapsed set may hold at most one non-zero margin and no negative ones; otherwise S2.
function resolveCollapsed(nodeId: string, set: readonly LU[]): LU {
  let nonZero = 0;
  for (const v of set) {
    if (v < 0) unsupported('margin-collapse', nodeId, 'CSS2 §8.3.1', 'negative adjoining vertical margin (S2)');
    if (v !== 0) nonZero++;
  }
  if (nonZero > 1) unsupported('margin-collapse', nodeId, 'CSS2 §8.3.1', 'two non-zero adjoining vertical margins (S2)');
  return sum(set);
}

export type BlockLevelResult = {
  readonly frag: Frag;
  readonly marginLeft: LU;
  readonly marginTop: LU;
  readonly marginBottom: LU;
  readonly contents: ContentsResult;
};

// CSS2 §10.3.3: block-level, non-replaced width and horizontal margins in normal flow (LTR).
export function blockLevelInlineSize(
  box: LayoutBox,
  cbInline: LU,
): { readonly borderBoxWidth: LU; readonly marginLeft: LU; readonly marginTop: LU; readonly marginBottom: LU } {
  const s = box.style;
  const pad = resolvePadding(s, cbInline);
  const bor = resolveBorder(s);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const ml = resolveMargin(s.marginLeft, cbInline);
  const mr = resolveMargin(s.marginRight, cbInline);
  const mt = resolveMargin(s.marginTop, cbInline);
  const mb = resolveMargin(s.marginBottom, cbInline);
  const specified = resolveInlineLength(s.width, cbInline);
  const stretched = sub(sub(cbInline, ml.value), mr.value);
  const raw = specified === null ? stretched : borderBoxFromSpecified(specified, hbp, s.boxSizing);
  const width = max(constrain(raw, inlineMinMax(s, cbInline, hbp)), hbp);
  // Blink ResolveInlineAutoMargins (ng_length_utils.cc): both auto centre with LayoutUnit / 2, clamped at zero.
  let marginLeft = ml.value;
  const available = sub(cbInline, add(width, add(ml.value, mr.value)));
  if (ml.auto && mr.auto) marginLeft = max(divInt(available, 2), ZERO);
  else if (ml.auto) marginLeft = max(available, ZERO);
  return { borderBoxWidth: width, marginLeft, marginTop: mt.value, marginBottom: mb.value };
}

type FlowArgs = {
  readonly contentWidth: LU;
  readonly origin: { readonly x: LU; readonly y: LU };
  readonly canCollapseTop: boolean;
  readonly canCollapseBottom: boolean;
  readonly childBasis: HeightBasis;
};

type FlowResult = {
  readonly contentHeight: LU;
  readonly placed: readonly Placed[];
  readonly escapeTop: readonly LU[];
  readonly escapeBottom: readonly LU[];
  readonly hasContent: boolean;
};

// CSS2 §9.4.1 and §10.6.3: stacks block-level children, collapsing adjoining vertical margins (S1 subset of §8.3.1).
function layoutBlockFlow(ctx: Ctx, box: LayoutBox, a: FlowArgs): FlowResult {
  const kids = visibleChildren(box);
  const texts = kids.filter((k): k is TextLeaf => k.kind === 'text');
  if (texts.length > 0) {
    if (texts.length !== kids.length) unsupported('anonymous-block', box.id, 'CSS2 §9.2.1.1', 'block container mixes text and block children (S3)');
    return layoutSingleLine(ctx, box, texts, a);
  }
  const placed: Placed[] = [];
  let pending: LU[] = [];
  let cursor = ZERO;
  let seen = false;
  let escapeTop: readonly LU[] = [];
  for (const kid of kids) {
    if (kid.kind !== 'box') continue;
    const inline = blockLevelInlineSize(kid, a.contentWidth);
    const c = layoutContents(ctx, kid, {
      cbInline: a.contentWidth,
      borderBoxWidth: inline.borderBoxWidth,
      forcedBorderBoxHeight: null,
      heightBasis: a.childBasis,
      formattingContextRoot: false,
    });
    const set = [...pending, inline.marginTop, ...c.escapeTop];
    let y: LU;
    if (c.collapseThrough) {
      if (inline.marginTop !== 0 || inline.marginBottom !== 0 || hasNonZero(c.escapeTop)) {
        unsupported('margin-collapse', kid.id, 'CSS2 §8.3.1', 'a zero-height box with non-zero margins collapses through (S2)');
      }
      y = !seen && a.canCollapseTop ? ZERO : add(cursor, resolveCollapsed(box.id, set));
      pending = [...set, inline.marginBottom, ...c.escapeBottom];
    } else if (!seen && a.canCollapseTop) {
      resolveCollapsed(box.id, set);
      escapeTop = set;
      y = ZERO;
      cursor = c.frag.height;
      seen = true;
      pending = [inline.marginBottom, ...c.escapeBottom];
    } else {
      y = add(cursor, resolveCollapsed(box.id, set));
      cursor = add(y, c.frag.height);
      seen = true;
      pending = [inline.marginBottom, ...c.escapeBottom];
    }
    placed.push({ frag: c.frag, x: add(a.origin.x, inline.marginLeft), y: add(a.origin.y, y) });
  }
  if (!seen) {
    if (a.canCollapseTop) {
      resolveCollapsed(box.id, pending);
      return { contentHeight: ZERO, placed, escapeTop: pending, escapeBottom: [], hasContent: false };
    }
    return { contentHeight: resolveCollapsed(box.id, pending), placed, escapeTop: [], escapeBottom: [], hasContent: false };
  }
  if (a.canCollapseBottom) {
    resolveCollapsed(box.id, pending);
    return { contentHeight: cursor, placed, escapeTop, escapeBottom: pending, hasContent: true };
  }
  return { contentHeight: add(cursor, resolveCollapsed(box.id, pending)), placed, escapeTop, escapeBottom: [], hasContent: true };
}

// CSS2 §10.8.1 with css-inline-3 §4: one line box of Ahem text; Blink floors the top half-leading to whole px.
function layoutSingleLine(ctx: Ctx, box: LayoutBox, texts: readonly TextLeaf[], a: FlowArgs): FlowResult {
  const align = box.style.textAlign;
  if (align !== 'start' && align !== 'left') unsupported('text-align', box.id, 'css-text-3 §7.1', `text-align: ${align} (S3)`);
  const first = texts[0] as TextLeaf;
  for (const t of texts) {
    if (t.font.size !== first.font.size || !sameLineHeight(t, first)) {
      unsupported('mixed-inline-font', t.id, 'CSS2 §10.8', 'text runs with different fonts or line-heights in one line (S3)');
    }
  }
  const metrics = ctx.measurer.metrics(first.font);
  const glyphHeight = add(add(metrics.ascent, metrics.descent), metrics.lineGap);
  const lineHeight = resolveLineHeight(first, glyphHeight);
  const halfLeading = floorToWholePx(divInt(sub(lineHeight, glyphHeight), 2));
  const placed: Placed[] = [];
  let x = ZERO;
  let breakable = false;
  for (const t of texts) {
    const m = ctx.measurer.measure(t.text, t.font);
    if (!m.ok) unsupported('text-glyph', t.id, 'css-fonts-4 §5', m.reason);
    breakable = breakable || m.measure.hasBreakOpportunity;
    placed.push({
      frag: { id: t.id, width: m.measure.width, height: add(metrics.ascent, metrics.descent), children: [] },
      x: add(a.origin.x, x),
      y: add(a.origin.y, halfLeading),
    });
    x = add(x, m.measure.width);
  }
  if (x > a.contentWidth && breakable) {
    unsupported('multi-line-text', box.id, 'css-text-3 §5', 'text wider than its line with a break opportunity wraps (S3)');
  }
  return { contentHeight: lineHeight, placed, escapeTop: [], escapeBottom: [], hasContent: true };
}

function sameLineHeight(a: TextLeaf, b: TextLeaf): boolean {
  const x = a.lineHeight;
  const y = b.lineHeight;
  if (x.kind === 'normal' || y.kind === 'normal') return x.kind === y.kind;
  return x.kind === y.kind && x.value === y.value;
}

// CSS2 §10.8.1: normal uses the font's ascent + descent + line gap; numbers multiply the font size.
function resolveLineHeight(t: TextLeaf, normal: LU): LU {
  const lh = t.lineHeight;
  if (lh.kind === 'normal') return normal;
  if (lh.kind === 'number') return lineHeightFromNumber(t.font.size, lh.value);
  return fromCssPx(lh.value);
}

export type { Edges };
