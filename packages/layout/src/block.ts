// Block formatting: box contents, block-level widths and heights, margin collapsing, and inline content (inline.ts).
import type { Direction, LayoutBox, TextLeaf } from './input.ts';
import type { LU } from './units.ts';
import { add, divInt, max, min, sub, ZERO } from './units.ts';
import type { Edges, Frag, HeightBasis, Placed } from './box.ts';
import {
  blockMinMax,
  borderBoxFromSpecified,
  constrain,
  contentBox,
  inlineMinMax,
  INDEFINITE,
  isScrollContainer,
  resolveBorder,
  resolveInlineLength,
  resolveMargin,
  resolvePadding,
  specifiedBlockSize,
  sumEdges,
} from './box.ts';
import { layoutFlexContainer } from './flex.ts';
import { layoutInline } from './inline.ts';
import type { TextMeasurer } from './text.ts';

/** Seeded engine errors, so the parity harness can prove it fails (docs/api.md §7). The product runs with NO_ENGINE_FAULTS. */
export type EngineFaults = {
  /** Line breaking accepts one more glyph advance than the line has, so every break lands one glyph late. */
  readonly breakOffByOne: boolean;
  /** Every box is laid out as if its direction were ltr: text-align start in rtl acts as left, and rtl margins and flex axes flip back. */
  readonly rtlAsLtr: boolean;
  /** Flex items keep document order: the order property is ignored. */
  readonly ignoreOrder: boolean;
  /** A flex item's baseline is measured without its top border and padding. */
  readonly baselineFromBorderTop: boolean;
  /** A scroll container flex item keeps the content-based automatic minimum size instead of 0. */
  readonly scrollMinAuto: boolean;
};

export const NO_ENGINE_FAULTS: EngineFaults = { breakOffByOne: false, rtlAsLtr: false, ignoreOrder: false, baselineFromBorderTop: false, scrollMinAuto: false };

export type Ctx = { readonly measurer: TextMeasurer; readonly devicePixelRatio: number; readonly faults: EngineFaults };

/** css-writing-modes-4 §2.1: the box's inline base direction. */
export function directionOf(ctx: Ctx, box: LayoutBox): Direction {
  return ctx.faults.rtlAsLtr ? 'ltr' : box.style.direction;
}

export type ContentsArgs = {
  /** Inline size of the containing block, the basis for percentage padding and margins. */
  readonly cbInline: LU;
  readonly borderBoxWidth: LU;
  /** A border-box height fixed by a flex container, or null. */
  readonly forcedBorderBoxHeight: LU | null;
  /** css-flexbox-1 §9.8: whether a forced height counts as definite for the box's percentage-height children. */
  readonly forcedHeightDefinite: boolean;
  /** The containing block's block size, for this box's percentage heights. */
  readonly heightBasis: HeightBasis;
  /** True when the box establishes an independent formatting context (root, flex item, scroll container). */
  readonly formattingContextRoot: boolean;
};

export type ContentsResult = {
  readonly frag: Frag;
  /** Margins of descendants that adjoin this box's top margin (CSS2 §8.3.1); for a collapse-through box, all of them. */
  readonly escapeTop: Strut;
  /** Margins of descendants that adjoin this box's bottom margin. */
  readonly escapeBottom: Strut;
  readonly collapseThrough: boolean;
};

/** A set of adjoining vertical margins, kept as Blink NGMarginStrut does: the largest positive and the most negative. */
export type Strut = { readonly positive: LU; readonly negative: LU };

export const EMPTY_STRUT: Strut = { positive: ZERO, negative: ZERO };

// CSS2 §8.3.1: a margin joins a collapsed set.
function joinMargin(s: Strut, margin: LU): Strut {
  return margin < 0 ? { positive: s.positive, negative: min(s.negative, margin) } : { positive: max(s.positive, margin), negative: s.negative };
}

function joinStruts(a: Strut, b: Strut): Strut {
  return { positive: max(a.positive, b.positive), negative: min(a.negative, b.negative) };
}

// CSS2 §8.3.1: the collapsed margin is the largest positive margin plus the most negative one (Blink NGMarginStrut::Sum).
function collapsed(s: Strut): LU {
  return add(s.positive, s.negative);
}

// css-align-3 §9.1 with css-overflow-3 §3: a scroll container's baseline is clamped to its border box (measured, notes/T035-slice-4a.md).
function clampScrollBaseline(box: LayoutBox, baseline: LU | null, height: LU): LU | null {
  if (baseline === null || !isScrollContainer(box.style)) return baseline;
  return min(baseline, height);
}

// CSS2 §10.6.3 and §10.7: lays out a box at a given border-box width and resolves its used height.
export function layoutContents(ctx: Ctx, box: LayoutBox, a: ContentsArgs): ContentsResult {
  const s = box.style;
  const pad = resolvePadding(s, a.cbInline);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const vbp = sumEdges(bor.top, bor.bottom, pad.top, pad.bottom);
  const contentWidth = contentBox(a.borderBoxWidth, hbp);
  const minMax = blockMinMax(box, a.heightBasis, vbp);
  const specified = a.forcedBorderBoxHeight === null ? specifiedBlockSize(box, a.heightBasis, vbp) : null;
  const fixedBorderBox = a.forcedBorderBoxHeight !== null
    ? a.forcedBorderBoxHeight
    : specified === null ? null : constrain(specified, minMax);
  const childBasis: HeightBasis = fixedBorderBox === null
    ? INDEFINITE
    : a.forcedBorderBoxHeight !== null && !a.forcedHeightDefinite ? { kind: 'flex-dependent' } : { kind: 'definite', value: contentBox(fixedBorderBox, vbp) };

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
      sizeIsFlexDependent: a.forcedBorderBoxHeight !== null && !a.forcedHeightDefinite,
    });
    const height = fixedBorderBox !== null ? fixedBorderBox : constrain(add(r.contentHeight, vbp), minMax);
    const frag: Frag = { id: box.id, width: a.borderBoxWidth, height, baseline: clampScrollBaseline(box, r.baseline, height), children: r.placed };
    return { frag, escapeTop: EMPTY_STRUT, escapeBottom: EMPTY_STRUT, collapseThrough: false };
  }

  const canCollapseTop = !a.formattingContextRoot && bor.top === 0 && pad.top === 0;
  const r = layoutBlockFlow(ctx, box, {
    contentWidth,
    origin: { x: add(bor.left, pad.left), y: add(bor.top, pad.top) },
    canCollapseTop,
    childBasis,
  });
  // CSS2 §10.6.3: the end margins count toward the height unless they can adjoin this box's bottom margin.
  const bottomAdjoins = !a.formattingContextRoot && bor.bottom === 0 && pad.bottom === 0 && fixedBorderBox === null;
  const intrinsic = bottomAdjoins ? r.cursor : add(r.cursor, collapsed(r.endStrut));
  const height = fixedBorderBox !== null ? fixedBorderBox : constrain(add(intrinsic, vbp), minMax);
  const baseline = clampScrollBaseline(box, r.baseline, height);
  const collapseThrough = !a.formattingContextRoot && !r.hasContent && height === 0 && vbp === 0;
  if (collapseThrough) {
    return { frag: { id: box.id, width: a.borderBoxWidth, height, baseline, children: r.placed }, escapeTop: joinStruts(r.escapeTop, r.endStrut), escapeBottom: EMPTY_STRUT, collapseThrough };
  }
  // Chrome deviation min-max-end-margin: when min-height or max-height changes the height, the end margins neither escape nor count.
  const escapeBottom = bottomAdjoins && height === add(intrinsic, vbp) ? r.endStrut : EMPTY_STRUT;
  return { frag: { id: box.id, width: a.borderBoxWidth, height, baseline, children: r.placed }, escapeTop: r.escapeTop, escapeBottom, collapseThrough };
}

export type BlockLevelResult = {
  readonly frag: Frag;
  readonly marginLeft: LU;
  readonly marginTop: LU;
  readonly marginBottom: LU;
  readonly contents: ContentsResult;
};

// CSS2 §10.3.3: block-level, non-replaced width and horizontal margins in normal flow. The containing block's direction decides
// which margin is the start margin; when over-constrained the end margin is ignored (margin-left in rtl).
export function blockLevelInlineSize(
  ctx: Ctx,
  box: LayoutBox,
  cbInline: LU,
  cbDirection: Direction,
): { readonly borderBoxWidth: LU; readonly marginLeft: LU; readonly marginTop: LU; readonly marginBottom: LU } {
  const s = box.style;
  const pad = resolvePadding(s, cbInline);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const ml = resolveMargin(s.marginLeft, cbInline);
  const mr = resolveMargin(s.marginRight, cbInline);
  const mt = resolveMargin(s.marginTop, cbInline);
  const mb = resolveMargin(s.marginBottom, cbInline);
  const specified = resolveInlineLength(s.width, cbInline);
  const stretched = sub(sub(cbInline, ml.value), mr.value);
  const raw = specified === null ? stretched : borderBoxFromSpecified(specified, hbp, s.boxSizing);
  const width = max(constrain(raw, inlineMinMax(s, cbInline, hbp)), hbp);
  // Blink ResolveInlineAutoMargins (ng_length_utils.cc), in the containing block's inline direction: both auto centre with
  // LayoutUnit / 2 on the start side, clamped at zero; a lone auto start margin takes the free space.
  const rtl = cbDirection === 'rtl';
  const startMargin = rtl ? mr : ml;
  const endMargin = rtl ? ml : mr;
  let start = startMargin.value;
  const available = sub(cbInline, add(width, add(ml.value, mr.value)));
  if (startMargin.auto && endMargin.auto) start = max(divInt(available, 2), ZERO);
  else if (startMargin.auto) start = max(available, ZERO);
  const marginLeft = rtl ? sub(sub(cbInline, start), width) : start;
  return { borderBoxWidth: width, marginLeft, marginTop: mt.value, marginBottom: mb.value };
}

type FlowArgs = {
  readonly contentWidth: LU;
  readonly origin: { readonly x: LU; readonly y: LU };
  readonly canCollapseTop: boolean;
  readonly childBasis: HeightBasis;
};

type FlowResult = {
  /** Bottom border edge of the last in-flow box with content, relative to the content box top. */
  readonly cursor: LU;
  readonly placed: readonly Placed[];
  readonly escapeTop: Strut;
  /** Margins after the last in-flow content, not yet resolved. */
  readonly endStrut: Strut;
  readonly hasContent: boolean;
  /** The first baseline relative to the border-box top, or null. */
  readonly baseline: LU | null;
};

// CSS2 §9.4.1 and §8.3.1: stacks block-level children, collapsing adjoining vertical margins. css-align-3 §9.1: the first
// baseline is the first line box's, or the first in-flow child's that has one.
function layoutBlockFlow(ctx: Ctx, box: LayoutBox, a: FlowArgs): FlowResult {
  const kids = box.children;
  const texts = kids.filter((k): k is TextLeaf => k.kind === 'text');
  if (texts.length > 0) {
    // CSS2 §9.2.1.1: the compiler wraps text beside block boxes in anonymous boxes; validateLayoutInput rejects anything else.
    if (texts.length !== kids.length) throw new Error(`${box.id} mixes text and boxes; validateLayoutInput rejects this input`);
    const r = layoutInline(ctx, box, texts, a.contentWidth, a.origin);
    return { cursor: r.height, placed: r.placed, escapeTop: EMPTY_STRUT, endStrut: EMPTY_STRUT, hasContent: true, baseline: r.firstBaseline === null ? null : add(a.origin.y, r.firstBaseline) };
  }
  const direction = directionOf(ctx, box);
  const placed: Placed[] = [];
  let strut = EMPTY_STRUT;
  let cursor = ZERO;
  let seen = false;
  let escapeTop = EMPTY_STRUT;
  let baseline: LU | null = null;
  for (const kid of kids) {
    if (kid.kind !== 'box') continue;
    const inline = blockLevelInlineSize(ctx, kid, a.contentWidth, direction);
    const c = layoutContents(ctx, kid, {
      cbInline: a.contentWidth,
      borderBoxWidth: inline.borderBoxWidth,
      forcedBorderBoxHeight: null,
      forcedHeightDefinite: false,
      heightBasis: a.childBasis,
      formattingContextRoot: kid.style.display !== 'block' || isScrollContainer(kid.style),
    });
    const before = joinStruts(joinMargin(strut, inline.marginTop), c.escapeTop);
    let y: LU;
    if (c.collapseThrough) {
      // CSS2 §8.3.1: a collapse-through box sits where it would with a non-zero bottom border, or at the parent's top.
      y = !seen && a.canCollapseTop ? ZERO : add(cursor, collapsed(before));
      strut = joinMargin(before, inline.marginBottom);
    } else {
      if (!seen && a.canCollapseTop) {
        escapeTop = before;
        y = ZERO;
      } else {
        y = add(cursor, collapsed(before));
      }
      cursor = add(y, c.frag.height);
      seen = true;
      strut = joinStruts(joinMargin(EMPTY_STRUT, inline.marginBottom), c.escapeBottom);
    }
    const at = { frag: c.frag, x: add(a.origin.x, inline.marginLeft), y: add(a.origin.y, y) };
    if (baseline === null && c.frag.baseline !== null) baseline = add(at.y, c.frag.baseline);
    placed.push(at);
  }
  if (!seen && a.canCollapseTop) return { cursor: ZERO, placed, escapeTop: strut, endStrut: EMPTY_STRUT, hasContent: false, baseline };
  return { cursor, placed, escapeTop, endStrut: strut, hasContent: seen, baseline };
}

export type { Edges };
