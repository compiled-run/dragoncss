// Block formatting: box contents, block-level widths and heights, margin collapsing, and inline content (inline.ts).
import type { Direction, LayoutBox, LayoutNode, LayoutStyle } from './input.ts';
import type { LU } from './units.ts';
import { add, divInt, max, min, sub, ZERO } from './units.ts';
import type { Edges, Frag, HeightBasis, OutOfFlow, Placed, Point } from './box.ts';
import {
  blockMinMaxWith,
  borderBoxFromSpecified,
  constrain,
  contentBox,
  inlineMinMaxWith,
  INDEFINITE,
  isScrollContainer,
  resolveBorder,
  resolveInlineLengthWith,
  resolveMarginWith,
  resolvePaddingWith,
  specifiedBlockSizeWith,
  sumEdges,
} from './box.ts';
import { layoutFlexContainer } from './flex.ts';
import { layoutInline } from './inline.ts';
import { checkOutOfFlowSiblings, isOutOfFlow, relativeOffsetWith } from './position.ts';
import { hasAspectRatio, ratioBlockLevelInlineSize, ratioFinalBlockSize, ratioInitialBlockSize } from './ratio.ts';
import { layoutReplacedInFlow } from './replaced.ts';
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
  /** An absolutely positioned box is laid out in flow, as if its position were static. */
  readonly absposInFlow: boolean;
  /** The containing block of an absolutely positioned box is its content box instead of its padding box (px padding only). */
  readonly cbIgnoresPadding: boolean;
  /** The static position in block flow ignores rtl: the box always starts at the parent's left content edge. */
  readonly staticPosLtr: boolean;
  /** A relative offset in block flow also moves the following siblings. */
  readonly relativeShiftsFlow: boolean;
  /** Ahem ascent and descent round exact halves up instead of down (platform rule ahem-metric-half-down off). */
  readonly metricHalfUp: boolean;
  /** Ahem advances and metrics use the computed font size instead of trunc(size x 100) / 100 (platform rule font-size-truncation off). */
  readonly untruncatedFontSize: boolean;
  /** Spec reading of Chrome deviation half-leading-floor: the top half-leading is not floored to a whole px (CSS2 §10.8.1). */
  readonly halfLeadingSpec: boolean;
  /** Spec reading of Chrome deviation min-max-end-margin: CSS 2.1 §8.3.1, the last child bottom margin collapses with the parent only when its min-height is zero; otherwise it counts toward the content height. */
  readonly minMaxEndMarginSpec: boolean;
  /** Spec reading of Chrome deviation wrap-reverse-baseline-line: the container baseline comes from the cross-start line (css-flexbox-1 §8.5). */
  readonly wrapReverseBaselineSpec: boolean;
  /** Spec reading of DPR Chrome deviation initial-line-width-unzoomed: an initial line width (device-px) is zoomed like CSS px (css-backgrounds-3 §3.3). */
  readonly initialLineWidthZoomed: boolean;
  /** A calculation's pixels and percent evaluate in the plain-percent order, pixels + float(basis * percent / 100). */
  readonly calcPercentPlainOrder: boolean;
  /** Layout-time calculations evaluate in double instead of float. */
  readonly calcDoubleEval: boolean;
  /** A negative result of a calculation in a non-negative property is kept instead of clamped to 0. */
  readonly calcNoNonNegClamp: boolean;
  /** A calculation with a percentage against an indefinite basis resolves against 0 instead of behaving as auto, 0 or none. */
  readonly calcPercentIndefiniteAsLength: boolean;
  /** clamp(MIN, VAL, MAX) is min(max(MIN, VAL), MAX), so MAX wins when MIN > MAX. */
  readonly clampMaxWins: boolean;
  /** A division by a number divides directly instead of multiplying by the float inverse Blink stores. */
  readonly divideDirect: boolean;
  /** The leaves of a calculation are not multiplied by the device zoom. */
  readonly calcLeafUnzoomed: boolean;
  /** Viewport units read the CSS viewport instead of the whole device-px window over the zoom (R6 off). */
  readonly viewportUnitsUnceiled: boolean;
  /** lh of a number line height uses the computed font size and product in float, without Blink's LayoutUnit truncation. */
  readonly lhUnsnapped: boolean;
  /** ex, ch and cap read the font at its computed size instead of the truncated instance size (platformFontSize). */
  readonly exUntruncatedFontSize: boolean;
  /** rem reads the initial 16px instead of the input's rootFontSize. */
  readonly rootFontSizeIgnored: boolean;
  /** env(safe-area-inset-*) reads 0 instead of the input's safe-area insets. */
  readonly safeAreaIgnored: boolean;
  /** lh of line-height normal sums the unrounded ascent, descent and line gap instead of the rounded line spacing. */
  readonly lhNormalUnrounded: boolean;
  /** Small and dynamic viewport units read the large viewport. */
  readonly viewportSizeKindIgnored: boolean;
  /** A font size that is not absolute ignores Chrome's minimum logical font size (6px). */
  readonly minimumFontSizeIgnored: boolean;
  /** Soft wrap opportunities only after a space or U+200B, as before UAX #14 was wired (linebreak.ts bypassed). */
  readonly spaceOnlyBreaks: boolean;
  /** A line fits only at or under the available width, without Blink's one-LayoutUnit epsilon (linefit.ts noEpsilon). */
  readonly fitWithoutEpsilon: boolean;
  /** A break is allowed after '/' before a letter or digit, as ICU does (linebreak.ts breakAfterSolidus). */
  readonly breakAfterSolidus: boolean;
  /** No break between '-' and a digit, as UAX #14 LB25 does (linebreak.ts noHyphenDigitBreak). */
  readonly noHyphenDigitBreak: boolean;
  /** The line box height comes from the strut only: inline boxes add no ascent or descent (CSS2 §10.8.1). */
  readonly lineHeightIgnoresInlineBoxes: boolean;
  /** An inline box's half-leading is not floored to a whole px (Chrome deviation half-leading-floor off for inline boxes only). */
  readonly halfLeadingUnflooredPerBox: boolean;
  /** A <br> forces no break. */
  readonly brIgnored: boolean;
  /** Every inline box boundary inside text is a soft wrap opportunity. */
  readonly breakAtBoxBoundary: boolean;
  /** A leaf's content area starts at its line top instead of the baseline minus its ascent. */
  readonly fragmentFromLineTop: boolean;
  /** Shaped glyph advances are summed as floats instead of 16.16 InlineLayoutUnits (shaping.ts). */
  readonly advanceNot16_16: boolean;
  /** Shaped run, part and line widths are kept in double instead of float, through FromFloatCeil (shaping.ts). */
  readonly doubleAccumulation: boolean;
  /** A wrapped line keeps the item's glyphs at both edges instead of reshaping there (shaping_line_breaker.cc). */
  readonly noReshapeAtBreak: boolean;
  /** HarfBuzz shapes with kern off. */
  readonly kerningDropped: boolean;
  /** Shaped advances round to whole pixels (Blink's path for fonts without subpixel positioning). */
  readonly wholePixelPositions: boolean;
  /** A soft hyphen break adds no generated hyphen. */
  readonly softHyphenWidthMissing: boolean;
  /** Shaped ascent and descent round the unquantised size * units / upem halves up instead of Core Text's 16.16 value (R5). */
  readonly metricRoundingSwapped: boolean;
  /** Text outside Latin, Common and Inherited is shaped instead of refused (R4). */
  readonly latinCheckSkipped: boolean;
  /** An inline-block's baseline is its first baseline instead of its last line box's (CSS2 §10.8.1). */
  readonly inlineBlockFirstBaseline: boolean;
  /** A scroll container inline-block keeps its content baseline instead of its bottom margin edge (CSS2 §10.8.1). */
  readonly overflowBaselineIgnored: boolean;
  /** An inline-flex box's baseline is its last item's instead of the flex container's first baseline (css-flexbox-1 §8.5). */
  readonly inlineFlexLastBaseline: boolean;
  /** An atomic inline's margins take no space: its border box is its advance and its line height contribution. */
  readonly atomicMarginExcluded: boolean;
  /** No soft wrap opportunity before or after an atomic inline (Blink line_breaker.cc allows both). */
  readonly noBreakAroundAtomic: boolean;
  /** An atomic inline with an auto width fills the available width instead of shrinking to fit (CSS2 §10.3.9). */
  readonly atomicShrinkToFitIgnored: boolean;
  /** overflow-wrap: anywhere and word-break: break-word leave min-content at its normal opportunities (css-text-3 §5.5). */
  readonly anywhereMinContentIgnored: boolean;
  /** overflow-wrap: break-word breaks anywhere in min-content too (Blink applies it in content mode only). */
  readonly breakWordShrinksMinContent: boolean;
  /** Break-character opportunities fall between every two code points instead of grapheme clusters (UAX #29). */
  readonly graphemeClusterSplit: boolean;
  /** overflow-wrap breaks at grapheme boundaries from the start instead of only when a line overflows. */
  readonly breakAnywhereAlways: boolean;
  /** An overflowing segment is broken at graphemes on the current line even though an earlier opportunity fits. */
  readonly emergencyBreakBeforeOpportunity: boolean;
  /** word-break: break-word is laid out as normal. */
  readonly wordBreakBreakWordIgnored: boolean;
  /** vertical-align top and bottom align to the aligned subtree as it is, without the second pass that extends it (Blink MetricsForTopAndBottomAlign). */
  readonly topBottomSinglePass: boolean;
  /** vertical-align: middle leaves out half the parent's x-height. */
  readonly middleWithoutXHeight: boolean;
  /** vertical-align sub and super shift by the box's own font size instead of its parent's. */
  readonly subShiftOwnFont: boolean;
};

export const NO_ENGINE_FAULTS: EngineFaults = {
  breakOffByOne: false,
  rtlAsLtr: false,
  ignoreOrder: false,
  baselineFromBorderTop: false,
  scrollMinAuto: false,
  absposInFlow: false,
  cbIgnoresPadding: false,
  staticPosLtr: false,
  relativeShiftsFlow: false,
  metricHalfUp: false,
  untruncatedFontSize: false,
  halfLeadingSpec: false,
  minMaxEndMarginSpec: false,
  wrapReverseBaselineSpec: false,
  initialLineWidthZoomed: false,
  calcPercentPlainOrder: false,
  calcDoubleEval: false,
  calcNoNonNegClamp: false,
  calcPercentIndefiniteAsLength: false,
  clampMaxWins: false,
  divideDirect: false,
  calcLeafUnzoomed: false,
  viewportUnitsUnceiled: false,
  lhUnsnapped: false,
  exUntruncatedFontSize: false,
  rootFontSizeIgnored: false,
  safeAreaIgnored: false,
  lhNormalUnrounded: false,
  viewportSizeKindIgnored: false,
  minimumFontSizeIgnored: false,
  spaceOnlyBreaks: false,
  fitWithoutEpsilon: false,
  breakAfterSolidus: false,
  noHyphenDigitBreak: false,
  lineHeightIgnoresInlineBoxes: false,
  halfLeadingUnflooredPerBox: false,
  brIgnored: false,
  breakAtBoxBoundary: false,
  fragmentFromLineTop: false,
  advanceNot16_16: false,
  doubleAccumulation: false,
  noReshapeAtBreak: false,
  kerningDropped: false,
  wholePixelPositions: false,
  softHyphenWidthMissing: false,
  metricRoundingSwapped: false,
  latinCheckSkipped: false,
  inlineBlockFirstBaseline: false,
  overflowBaselineIgnored: false,
  inlineFlexLastBaseline: false,
  atomicMarginExcluded: false,
  noBreakAroundAtomic: false,
  atomicShrinkToFitIgnored: false,
  anywhereMinContentIgnored: false,
  breakWordShrinksMinContent: false,
  graphemeClusterSplit: false,
  breakAnywhereAlways: false,
  emergencyBreakBeforeOpportunity: false,
  wordBreakBreakWordIgnored: false,
  topBottomSinglePass: false,
  middleWithoutXHeight: false,
  subShiftOwnFont: false,
};

export type Ctx = { readonly measurer: TextMeasurer; readonly devicePixelRatio: number; readonly faults: EngineFaults };

/** css-writing-modes-4 §2.1: the box's inline base direction. */
export function directionOf(ctx: Ctx, box: LayoutNode): Direction {
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
  /** The last baseline from the border-box top (INL2a, inline-block baselines), or null when the box has none. */
  readonly lastBaseline: LU | null;
  /** The id of the flex container whose last baseline would decide lastBaseline, or '' when none does (Dragon refuses that case). */
  readonly lastBaselineFlex: string;
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
  checkOutOfFlowSiblings(ctx, box);
  const pad = resolvePaddingWith(s, a.cbInline, ctx.faults);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const vbp = sumEdges(bor.top, bor.bottom, pad.top, pad.bottom);
  const contentWidth = contentBox(a.borderBoxWidth, hbp);
  const minMax = blockMinMaxWith(box, a.heightBasis, vbp, ctx.faults);
  const specified = a.forcedBorderBoxHeight === null ? specifiedBlockSizeWith(box, a.heightBasis, vbp, ctx.faults) : null;
  // css-sizing-4 §5.1: an auto height comes from the ratio; it is definite for the children before content (ratio.ts).
  const fromRatio = a.forcedBorderBoxHeight === null && specified === null ? ratioInitialBlockSize(box, a.borderBoxWidth, hbp, vbp) : null;
  const fixedBorderBox = a.forcedBorderBoxHeight !== null
    ? a.forcedBorderBoxHeight
    : specified !== null ? constrain(specified, minMax) : fromRatio === null ? null : constrain(fromRatio, minMax);
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
    const height = fromRatio !== null ? ratioFinalBlockSize(box, fromRatio, add(r.contentHeight, vbp), minMax) : fixedBorderBox !== null ? fixedBorderBox : constrain(add(r.contentHeight, vbp), minMax);
    const frag: Frag = { id: box.id, width: a.borderBoxWidth, height, baseline: clampScrollBaseline(box, r.baseline, height), children: r.placed, outOfFlow: r.outOfFlow };
    return { frag, escapeTop: EMPTY_STRUT, escapeBottom: EMPTY_STRUT, collapseThrough: false, lastBaseline: null, lastBaselineFlex: box.id };
  }

  const canCollapseTop = !a.formattingContextRoot && bor.top === 0 && pad.top === 0;
  const r = layoutBlockFlow(ctx, box, {
    contentWidth,
    origin: { x: add(bor.left, pad.left), y: add(bor.top, pad.top) },
    canCollapseTop,
    childBasis,
  });
  // CSS2 §10.6.3: the end margins count toward the height unless they can adjoin this box's bottom margin. Under the planted
  // spec reading of min-max-end-margin (CSS 2.1 §8.3.1), a non-zero min-height also keeps them from adjoining.
  const specNoCollapse = ctx.faults.minMaxEndMarginSpec && minMax.min > vbp;
  const bottomAdjoins = !a.formattingContextRoot && bor.bottom === 0 && pad.bottom === 0 && fixedBorderBox === null && !specNoCollapse;
  const intrinsic = bottomAdjoins ? r.cursor : add(r.cursor, collapsed(r.endStrut));
  // Blink: with a definite initial block size the end margins neither escape nor count toward the content height.
  const height = fromRatio !== null
    ? ratioFinalBlockSize(box, fromRatio, add(a.formattingContextRoot || bor.bottom !== 0 || pad.bottom !== 0 ? intrinsic : r.cursor, vbp), minMax)
    : fixedBorderBox !== null ? fixedBorderBox : constrain(add(intrinsic, vbp), minMax);
  const baseline = clampScrollBaseline(box, r.baseline, height);
  const collapseThrough = !a.formattingContextRoot && !r.hasContent && height === 0 && vbp === 0;
  if (collapseThrough) {
    return { frag: { id: box.id, width: a.borderBoxWidth, height, baseline, children: r.placed, outOfFlow: r.outOfFlow }, escapeTop: joinStruts(r.escapeTop, r.endStrut), escapeBottom: EMPTY_STRUT, collapseThrough, lastBaseline: r.lastBaseline, lastBaselineFlex: r.lastBaselineFlex };
  }
  // Chrome deviation min-max-end-margin: when min-height or max-height changes the height, the end margins neither escape nor count.
  const escapeBottom = bottomAdjoins && (height === add(intrinsic, vbp) || ctx.faults.minMaxEndMarginSpec) ? r.endStrut : EMPTY_STRUT;
  return { frag: { id: box.id, width: a.borderBoxWidth, height, baseline, children: r.placed, outOfFlow: r.outOfFlow }, escapeTop: r.escapeTop, escapeBottom, collapseThrough, lastBaseline: r.lastBaseline, lastBaselineFlex: r.lastBaselineFlex };
}

export type BlockLevelResult = {
  readonly frag: Frag;
  readonly marginLeft: LU;
  readonly marginTop: LU;
  readonly marginBottom: LU;
  readonly contents: ContentsResult;
};

/** The used border-box width and margins of a block-level box. */
export type BlockLevelInline = { readonly borderBoxWidth: LU; readonly marginLeft: LU; readonly marginTop: LU; readonly marginBottom: LU };

// CSS2 §10.3.3: block-level, non-replaced width and horizontal margins in normal flow. The containing block's direction decides
// which margin is the start margin; when over-constrained the end margin is ignored (margin-left in rtl).
export function blockLevelInlineSize(ctx: Ctx, box: LayoutBox, cbInline: LU, cbDirection: Direction): BlockLevelInline {
  const s = box.style;
  const pad = resolvePaddingWith(s, cbInline, ctx.faults);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const ml = resolveMarginWith(s.marginLeft, cbInline, ctx.faults);
  const mr = resolveMarginWith(s.marginRight, cbInline, ctx.faults);
  const specified = resolveInlineLengthWith(s.width, cbInline, ctx.faults);
  const stretched = sub(sub(cbInline, ml.value), mr.value);
  const raw = specified === null ? stretched : borderBoxFromSpecified(specified, hbp, s.boxSizing);
  const width = specified === null && hasAspectRatio(s) ? ratioBlockLevelInlineSize(ctx, box, cbInline, raw) : max(constrain(raw, inlineMinMaxWith(s, cbInline, hbp, ctx.faults)), hbp);
  return placeBlockLevel(ctx, s, cbInline, cbDirection, width);
}

/** The margins of a block-level box of a used border-box width (CSS2 §10.3.3, and §10.3.4 for a replaced box). */
export function placeBlockLevel(ctx: Ctx, s: LayoutStyle, cbInline: LU, cbDirection: Direction, width: LU): BlockLevelInline {
  const ml = resolveMarginWith(s.marginLeft, cbInline, ctx.faults);
  const mr = resolveMarginWith(s.marginRight, cbInline, ctx.faults);
  const mt = resolveMarginWith(s.marginTop, cbInline, ctx.faults);
  const mb = resolveMarginWith(s.marginBottom, cbInline, ctx.faults);
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
  readonly origin: Point;
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
  readonly outOfFlow: readonly OutOfFlow[];
  /** The last baseline relative to the border-box top, and the flex container that would decide it instead (ContentsResult). */
  readonly lastBaseline: LU | null;
  readonly lastBaselineFlex: string;
};

// CSS2 §9.4.1 and §8.3.1: stacks block-level children, collapsing adjoining vertical margins. css-align-3 §9.1: the first
// baseline is the first line box's, or the first in-flow child's that has one.
function layoutBlockFlow(ctx: Ctx, box: LayoutBox, a: FlowArgs): FlowResult {
  const kids = box.children;
  if (box.strut !== null) {
    // CSS2 §9.2.1.1: the compiler wraps inline content beside block boxes in anonymous boxes; validateLayoutInput rejects anything else.
    const r = layoutInline(ctx, box, a.contentWidth, a.origin);
    // CSS2 §9.4.2: a formatting context with no line boxes (only empty inline boxes) is empty, so margins collapse through it.
    const last = r.lastBaseline === null ? null : add(a.origin.y, r.lastBaseline);
    return { cursor: r.height, placed: r.placed, escapeTop: EMPTY_STRUT, endStrut: EMPTY_STRUT, hasContent: r.lines > 0, baseline: r.firstBaseline === null ? null : add(a.origin.y, r.firstBaseline), outOfFlow: [], lastBaseline: last, lastBaselineFlex: '' };
  }
  if (kids.some((k) => k.kind !== 'box' && k.kind !== 'replaced')) throw new Error(`${box.id}: inline content without a strut (validateLayoutInput rejects it)`);
  const direction = directionOf(ctx, box);
  const placed: Placed[] = [];
  let strut = EMPTY_STRUT;
  let cursor = ZERO;
  let seen = false;
  let escapeTop = EMPTY_STRUT;
  let baseline: LU | null = null;
  let lastBaseline: LU | null = null;
  let lastBaselineFlex = '';
  const outOfFlow: OutOfFlow[] = [];
  for (const kid of kids) {
    if (kid.kind !== 'box' && kid.kind !== 'replaced') continue;
    if (kid.kind === 'box' && isOutOfFlow(ctx, kid)) {
      // CSS2 §10.3.7 static position (Blink HandleOutOfFlowPositioned): the parent's content start edge in its direction, at the
      // flow position, which includes the pending margins once the parent's block offset is fixed (measured).
      const rtl = direction === 'rtl' && !ctx.faults.staticPosLtr;
      const sy = !seen && a.canCollapseTop ? ZERO : add(cursor, collapsed(strut));
      outOfFlow.push({
        box: kid,
        x: rtl ? { offset: add(a.origin.x, a.contentWidth), edge: 'far' } : { offset: a.origin.x, edge: 'near' },
        y: { offset: add(a.origin.y, sy), edge: 'near' },
      });
      continue;
    }
    let inline: BlockLevelInline;
    let c: ContentsResult;
    if (kid.kind === 'replaced') {
      // CSS 2.2 §10.3.4 and §10.6.2: a block-level replaced box sizes itself and never collapses through (replaced.ts).
      const frag = layoutReplacedInFlow(ctx, kid, a.contentWidth, a.childBasis);
      inline = placeBlockLevel(ctx, kid.style, a.contentWidth, direction, frag.width);
      // A replaced box has no line boxes, so it gives an inline-block no last baseline (CSS2 §10.8.1).
      c = { frag, escapeTop: EMPTY_STRUT, escapeBottom: EMPTY_STRUT, collapseThrough: false, lastBaseline: null, lastBaselineFlex: '' };
    } else {
      inline = blockLevelInlineSize(ctx, kid, a.contentWidth, direction);
      c = layoutContents(ctx, kid, {
        cbInline: a.contentWidth,
        borderBoxWidth: inline.borderBoxWidth,
        forcedBorderBoxHeight: null,
        forcedHeightDefinite: false,
        heightBasis: a.childBasis,
        formattingContextRoot: kid.style.display !== 'block' || isScrollContainer(kid.style),
      });
    }
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
    const at: Placed = { frag: c.frag, x: add(a.origin.x, inline.marginLeft), y: add(a.origin.y, y) };
    if (baseline === null && c.frag.baseline !== null) baseline = add(at.y, c.frag.baseline);
    // Blink's last baseline (block_layout_algorithm.cc:3622-3647, measured in notes/T059-inl2.md): the last in-flow child with
    // one; a scroll container child gives its bottom margin edge, and a flex child's last baseline is not modelled.
    if (isScrollContainer(kid.style)) {
      lastBaseline = add(add(at.y, c.frag.height), inline.marginBottom);
      lastBaselineFlex = '';
    } else if (c.lastBaselineFlex !== '') {
      lastBaseline = null;
      lastBaselineFlex = c.lastBaselineFlex;
    } else if (c.lastBaseline !== null) {
      lastBaseline = add(at.y, c.lastBaseline);
      lastBaselineFlex = '';
    }
    // CSS2 §9.4.3: a relative offset moves the box after layout; the flow, margins and baselines keep its in-flow position.
    const offset = relativeOffsetWith(kid, a.contentWidth, a.childBasis, direction, ctx.faults);
    placed.push({ frag: at.frag, x: add(at.x, offset.dx), y: add(at.y, offset.dy) });
    if (ctx.faults.relativeShiftsFlow && !c.collapseThrough) cursor = add(cursor, offset.dy);
  }
  if (!seen && a.canCollapseTop) return { cursor: ZERO, placed, escapeTop: strut, endStrut: EMPTY_STRUT, hasContent: false, baseline, outOfFlow, lastBaseline, lastBaselineFlex };
  return { cursor, placed, escapeTop, endStrut: strut, hasContent: seen, baseline, outOfFlow, lastBaseline, lastBaselineFlex };
}

export type { Edges };
