// Block formatting: box contents, block-level widths and heights, margin collapsing, and inline content (inline.ts).
import type { Direction, LayoutBox, LayoutNode, LayoutStyle } from './input.ts';
import type { LU } from './units.ts';
import { add, clampNegativeToZero, divInt, max, min, sub, ZERO } from './units.ts';
import type { Edges, Frag, HeightBasis, MarginResolved, OutOfFlow, Placed, Point } from './box.ts';
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
import type { GridFaults } from './grid.ts';
import { layoutGridContainer } from './grid.ts';
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
  /** A non-integer order rounds a tie to the even integer instead of toward +infinity (Blink RoundHalfTowardsPositiveInfinity). */
  readonly orderHalfEven: boolean;
  /** order is not clamped to the int range after rounding (Blink ClampToWithNaNTo0<int>). */
  readonly orderUnclamped: boolean;
  /** A scroll container reserves a classic 15px scrollbar gutter at its inline end and block end (overflow.ts). */
  readonly gutterReserved: boolean;
  /** A scroll container's scrollable overflow leaves out its end padding after the in-flow content (overflow.ts). */
  readonly overflowIgnoresPadding: boolean;
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
  orderHalfEven: false,
  orderUnclamped: false,
  gutterReserved: false,
  overflowIgnoresPadding: false,
};

/** gridFaults: seeded grid errors (grid.ts GridFaults), set only by the G-P differential test; NO_GRID_FAULTS otherwise. */
export type Ctx = { readonly measurer: TextMeasurer; readonly devicePixelRatio: number; readonly faults: EngineFaults; readonly gridFaults: GridFaults };

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
  /** The box's border-box line-left offset in its parent's block formatting context; a formatting context root's children start at 0. */
  readonly bfcLineOffset: LU;
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
    return { frag, escapeTop: EMPTY_STRUT, escapeBottom: EMPTY_STRUT, collapseThrough: false };
  }

  if (s.display === 'grid') {
    const r = layoutGridContainer(ctx, box, {
      pad,
      bor,
      contentWidth,
      definiteInnerHeight: fixedBorderBox === null ? null : contentBox(fixedBorderBox, vbp),
      innerHeightMinMax: {
        min: contentBox(minMax.min, vbp),
        max: minMax.max === null ? null : contentBox(minMax.max, vbp),
      },
    });
    const height = fromRatio !== null ? ratioFinalBlockSize(box, fromRatio, add(r.contentHeight, vbp), minMax) : fixedBorderBox !== null ? fixedBorderBox : constrain(add(r.contentHeight, vbp), minMax);
    const frag: Frag = { id: box.id, width: a.borderBoxWidth, height, baseline: clampScrollBaseline(box, r.baseline, height), children: r.placed, outOfFlow: r.outOfFlow };
    return { frag, escapeTop: EMPTY_STRUT, escapeBottom: EMPTY_STRUT, collapseThrough: false };
  }

  const canCollapseTop = !a.formattingContextRoot && bor.top === 0 && pad.top === 0;
  const r = layoutBlockFlow(ctx, box, {
    contentWidth,
    borderBoxWidth: a.borderBoxWidth,
    bfcLineOffset: a.formattingContextRoot ? ZERO : a.bfcLineOffset,
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
    return { frag: { id: box.id, width: a.borderBoxWidth, height, baseline, children: r.placed, outOfFlow: r.outOfFlow }, escapeTop: joinStruts(r.escapeTop, r.endStrut), escapeBottom: EMPTY_STRUT, collapseThrough };
  }
  // Chrome deviation min-max-end-margin: when min-height or max-height changes the height, the end margins neither escape nor count.
  const escapeBottom = bottomAdjoins && (height === add(intrinsic, vbp) || ctx.faults.minMaxEndMarginSpec) ? r.endStrut : EMPTY_STRUT;
  return { frag: { id: box.id, width: a.borderBoxWidth, height, baseline, children: r.placed, outOfFlow: r.outOfFlow }, escapeTop: r.escapeTop, escapeBottom, collapseThrough };
}

export type BlockLevelResult = {
  readonly frag: Frag;
  readonly marginLeft: LU;
  readonly marginTop: LU;
  readonly marginBottom: LU;
  readonly contents: ContentsResult;
};

/** The used border-box width and margins of a block-level box, and where it sits in its container. */
export type BlockLevelInline = {
  readonly borderBoxWidth: LU;
  /** The border-box x relative to the container's border box. */
  readonly x: LU;
  /** The border box's line-left offset in the block formatting context, which its own in-flow children start from. */
  readonly bfcLineOffset: LU;
  readonly marginTop: LU;
  readonly marginBottom: LU;
};

/** The container a block-level box is placed in, as Blink's BlockLayoutAlgorithm sees it. */
export type InlineContainer = {
  /** The container's border-box line-left offset in its block formatting context (ContainerBfcOffset().line_offset). */
  readonly bfcLineOffset: LU;
  /** The container's border-box width (container_builder_.InlineSize()). */
  readonly borderBoxWidth: LU;
  /** The container's left border and padding (BorderScrollbarPadding().LineLeft()). */
  readonly lineLeft: LU;
  /** Whether the box establishes a new formatting context, which Blink places in a layout opportunity (LayoutNewFormattingContext). */
  readonly newFormattingContext: boolean;
};

// CSS2 §10.3.3: block-level, non-replaced width and horizontal margins in normal flow. The containing block's direction decides
// which margin is the start margin; when over-constrained the end margin is ignored (margin-left in rtl). Every step is Blink's
// LayoutUnit arithmetic in Blink's order, so a saturated sum lands where Chrome's does (block_layout_algorithm.cc and
// length_utils.cc at 145.0.7632.6: ComputeChildData 3283-3304, the in-flow line offset 2799-2804, LayoutNewFormattingContext
// 2054-2169, LogicalFromBfcLineOffset 197-213, ResolveInlineAutoMargins 1555-1574, the stretch size 46-65; and
// writing_mode_converter.cc SlowToPhysical 71-79).
export function blockLevelInlineSize(ctx: Ctx, box: LayoutBox, cbInline: LU, cbDirection: Direction, container: InlineContainer): BlockLevelInline {
  const s = box.style;
  const pad = resolvePaddingWith(s, cbInline, ctx.faults);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const m = inlineMargins(ctx, s, cbInline, cbDirection, container);
  const specified = resolveInlineLengthWith(s.width, cbInline, ctx.faults);
  const stretched = max(hbp, sub(sub(m.available, m.start.value), m.end.value));
  const raw = specified === null ? stretched : borderBoxFromSpecified(specified, hbp, s.boxSizing);
  const width = specified === null && hasAspectRatio(s) ? ratioBlockLevelInlineSize(ctx, box, cbInline, raw) : max(constrain(raw, inlineMinMaxWith(s, cbInline, hbp, ctx.faults)), hbp);
  return placeWithMargins(m, container, width);
}

/** Where a block-level box of a used border-box width sits (CSS2 §10.3.3, and §10.3.4 for a replaced box), in Blink's order. */
export function placeBlockLevel(ctx: Ctx, s: LayoutStyle, cbInline: LU, cbDirection: Direction, container: InlineContainer, width: LU): BlockLevelInline {
  return placeWithMargins(inlineMargins(ctx, s, cbInline, cbDirection, container), container, width);
}

type InlineMargins = {
  readonly rtl: boolean;
  readonly cbInline: LU;
  readonly start: MarginResolved;
  readonly end: MarginResolved;
  readonly lineLeftMargin: LU;
  readonly lineRightMargin: LU;
  readonly origin: LU;
  /** The inline size the box and its margins share: the containing block's, or a new formatting context's layout opportunity. */
  readonly available: LU;
  readonly lineLeftOffset: LU;
  readonly lineRightOffset: LU;
  readonly marginTop: LU;
  readonly marginBottom: LU;
};

function inlineMargins(ctx: Ctx, s: LayoutStyle, cbInline: LU, cbDirection: Direction, container: InlineContainer): InlineMargins {
  const ml = resolveMarginWith(s.marginLeft, cbInline, ctx.faults);
  const mr = resolveMarginWith(s.marginRight, cbInline, ctx.faults);
  const mt = resolveMarginWith(s.marginTop, cbInline, ctx.faults);
  const mb = resolveMarginWith(s.marginBottom, cbInline, ctx.faults);
  const rtl = cbDirection === 'rtl';
  const start = rtl ? mr : ml;
  const end = rtl ? ml : mr;
  const inlineSum = add(start.value, end.value);
  const origin = add(container.bfcLineOffset, container.lineLeft);
  // The line-left and line-right margins of BoxStrut::LineLeft and LineRight.
  const lineLeftMargin = rtl ? end.value : start.value;
  const lineRightMargin = rtl ? start.value : end.value;
  let available = cbInline;
  let lineLeftOffset = ZERO;
  let lineRightOffset = ZERO;
  if (container.newFormattingContext) {
    // With no floats the opportunity is the content box, adjusted by the margins.
    lineLeftOffset = add(origin, lineLeftMargin);
    lineRightOffset = sub(add(origin, cbInline), lineRightMargin);
    const opportunity = clampNegativeToZero(sub(lineRightOffset, lineLeftOffset));
    available = clampNegativeToZero(add(opportunity, inlineSum));
  }
  return { rtl, cbInline, start, end, lineLeftMargin, lineRightMargin, origin, available, lineLeftOffset, lineRightOffset, marginTop: mt.value, marginBottom: mb.value };
}

function placeWithMargins(m: InlineMargins, container: InlineContainer, width: LU): BlockLevelInline {
  const rtl = m.rtl;
  const available = m.available;
  const inlineSum = add(m.start.value, m.end.value);
  // Blink ResolveInlineAutoMargins: both auto centre with LayoutUnit / 2 on the start side, clamped at zero; a lone auto start
  // margin takes the free space; a lone auto end margin takes the rest.
  let usedStart = m.start.value;
  let usedEnd = m.end.value;
  const free = sub(available, add(width, inlineSum));
  if (m.start.auto && m.end.auto) {
    usedStart = clampNegativeToZero(divInt(free, 2));
    usedEnd = sub(sub(available, width), usedStart);
  } else if (m.start.auto) {
    usedStart = clampNegativeToZero(free);
  } else if (m.end.auto) {
    usedEnd = sub(sub(available, width), usedStart);
  }
  let bfcLineOffset: LU;
  if (container.newFormattingContext) {
    bfcLineOffset = rtl
      ? sub(sub(m.lineRightOffset, sub(usedStart, m.lineRightMargin)), width)
      : add(m.lineLeftOffset, sub(usedStart, m.lineLeftMargin));
  } else {
    const additional = rtl ? sub(sub(m.cbInline, width), add(usedStart, usedEnd)) : ZERO;
    bfcLineOffset = add(add(m.origin, additional), rtl ? usedEnd : usedStart);
  }
  const relative = sub(bfcLineOffset, container.bfcLineOffset);
  const x = rtl ? sub(sub(container.borderBoxWidth, sub(sub(container.borderBoxWidth, relative), width)), width) : relative;
  return { borderBoxWidth: width, x, bfcLineOffset, marginTop: m.marginTop, marginBottom: m.marginBottom };
}

type FlowArgs = {
  readonly contentWidth: LU;
  readonly borderBoxWidth: LU;
  /** The box's border-box line-left offset in the block formatting context its in-flow children are placed in. */
  readonly bfcLineOffset: LU;
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
};

// CSS2 §9.4.1 and §8.3.1: stacks block-level children, collapsing adjoining vertical margins. css-align-3 §9.1: the first
// baseline is the first line box's, or the first in-flow child's that has one.
function layoutBlockFlow(ctx: Ctx, box: LayoutBox, a: FlowArgs): FlowResult {
  const kids = box.children;
  if (box.strut !== null) {
    // CSS2 §9.2.1.1: the compiler wraps inline content beside block boxes in anonymous boxes; validateLayoutInput rejects anything else.
    const r = layoutInline(ctx, box, a.contentWidth, a.origin);
    // CSS2 §9.4.2: a formatting context with no line boxes (only empty inline boxes) is empty, so margins collapse through it.
    return { cursor: r.height, placed: r.placed, escapeTop: EMPTY_STRUT, endStrut: EMPTY_STRUT, hasContent: r.lines > 0, baseline: r.firstBaseline === null ? null : add(a.origin.y, r.firstBaseline), outOfFlow: [] };
  }
  if (kids.some((k) => k.kind !== 'box' && k.kind !== 'replaced')) throw new Error(`${box.id}: inline content without a strut (validateLayoutInput rejects it)`);
  const direction = directionOf(ctx, box);
  const placed: Placed[] = [];
  let strut = EMPTY_STRUT;
  let cursor = ZERO;
  let seen = false;
  let escapeTop = EMPTY_STRUT;
  let baseline: LU | null = null;
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
    // A replaced box is not a block container, so Blink places it as a new formatting context (LayoutBox::CreatesNewFormattingContext).
    const newFormattingContext = kid.kind === 'replaced' || kid.style.display !== 'block' || isScrollContainer(kid.style);
    const container: InlineContainer = { bfcLineOffset: a.bfcLineOffset, borderBoxWidth: a.borderBoxWidth, lineLeft: a.origin.x, newFormattingContext };
    if (kid.kind === 'replaced') {
      // CSS 2.2 §10.3.4 and §10.6.2: a block-level replaced box sizes itself and never collapses through (replaced.ts).
      const frag = layoutReplacedInFlow(ctx, kid, a.contentWidth, a.childBasis);
      inline = placeBlockLevel(ctx, kid.style, a.contentWidth, direction, container, frag.width);
      c = { frag, escapeTop: EMPTY_STRUT, escapeBottom: EMPTY_STRUT, collapseThrough: false };
    } else {
      inline = blockLevelInlineSize(ctx, kid, a.contentWidth, direction, container);
      c = layoutContents(ctx, kid, {
        cbInline: a.contentWidth,
        borderBoxWidth: inline.borderBoxWidth,
        forcedBorderBoxHeight: null,
        forcedHeightDefinite: false,
        heightBasis: a.childBasis,
        formattingContextRoot: newFormattingContext,
        bfcLineOffset: inline.bfcLineOffset,
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
    const at: Placed = { frag: c.frag, x: inline.x, y: add(a.origin.y, y) };
    if (baseline === null && c.frag.baseline !== null) baseline = add(at.y, c.frag.baseline);
    // CSS2 §9.4.3: a relative offset moves the box after layout; the flow, margins and baselines keep its in-flow position.
    const offset = relativeOffsetWith(kid, a.contentWidth, a.childBasis, direction, ctx.faults);
    placed.push({ frag: at.frag, x: add(at.x, offset.dx), y: add(at.y, offset.dy) });
    if (ctx.faults.relativeShiftsFlow && !c.collapseThrough) cursor = add(cursor, offset.dy);
  }
  if (!seen && a.canCollapseTop) return { cursor: ZERO, placed, escapeTop: strut, endStrut: EMPTY_STRUT, hasContent: false, baseline, outOfFlow };
  return { cursor, placed, escapeTop, endStrut: strut, hasContent: seen, baseline, outOfFlow };
}

export type { Edges };
