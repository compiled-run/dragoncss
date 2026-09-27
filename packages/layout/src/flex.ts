// css-flexbox-1 §9: flex layout with order (§5.4), reverse directions (§5.1), wrap-reverse (§5.2), rtl, auto margins and baseline
// alignment (§8.3, §9.4 step 8). Chrome 145 computes every offset in flow coordinates, from the writing-mode start edge of each
// axis: a reverse direction reverses the items and swaps flex-start and flex-end, and wrap-reverse does the same for the lines and
// the cross axis (measured, notes/T035-slice-4a.md). Flow offsets are then mapped to physical ones.
import type { AlignItems, JustifyContent, LayoutBox, LayoutStyle } from './input.ts';
import type { DistributedMode, FactorSum, LU } from './units.ts';
import {
  add,
  clampNegativeToZero,
  cumulativeShareRounded,
  distributedOffset,
  divInt,
  FACTOR_ZERO,
  factorAdd,
  factorSubClampZero,
  factorValue,
  fractionalFreeSpace,
  fromCssPx,
  growShare,
  isFiniteFactorSum,
  max,
  min,
  mulInt,
  percentOf,
  shrinkShare,
  shrinkWeight,
  sub,
  sum,
  ZERO,
} from './units.ts';
import type { Edges, Frag, HeightBasis, MinMax, OutOfFlow, Placed, StaticAxis } from './box.ts';
import {
  borderBoxFromSpecified,
  constrain,
  contentBox,
  isScrollContainer,
  resolveBorder,
  resolveMargin,
  resolvePadding,
  sumEdges,
} from './box.ts';
import type { Ctx } from './block.ts';
import { directionOf, layoutContents } from './block.ts';
import { intrinsicContentInlineSize } from './intrinsic.ts';
import { isOutOfFlow, relativeOffset } from './position.ts';
import { unsupported } from './unsupported.ts';

export type FlexArgs = {
  readonly pad: Edges;
  readonly bor: Edges;
  readonly contentWidth: LU;
  readonly definiteInnerHeight: LU | null;
  readonly innerHeightMinMax: MinMax;
  readonly childBasis: HeightBasis;
  readonly sizeIsFlexDependent: boolean;
};

/** baseline: the container's first baseline (css-flexbox-1 §8.5) from its content-box top, or null with no items. */
export type FlexResult = { readonly contentHeight: LU; readonly placed: readonly Placed[]; readonly baseline: LU | null; readonly outOfFlow: readonly OutOfFlow[] };

/** A position along one axis in flow terms: from the writing-mode start edge of that axis. */
type FlowPosition = 'start' | 'end' | 'center';

/** Where the item goes in its line, in flow terms of the cross axis. */
type ItemAlign = FlowPosition | 'stretch' | 'baseline';

/** One flex item. Margins are named by flow side: main-start is the inline start (row) or top (column), cross-start the top (row)
 * or inline start (column), whatever the reverse or wrap-reverse. */
type Item = {
  readonly box: LayoutBox;
  readonly margin: Edges;
  readonly pad: Edges;
  readonly bor: Edges;
  readonly mainStart: LU;
  readonly mainEnd: LU;
  readonly crossStart: LU;
  readonly autoMainStart: boolean;
  readonly autoMainEnd: boolean;
  readonly autoCrossStart: boolean;
  readonly autoCrossEnd: boolean;
  readonly mainBp: LU;
  readonly crossBp: LU;
  readonly mainMargins: LU;
  readonly crossMargins: LU;
  readonly grow: number;
  readonly shrink: number;
  readonly base: LU;
  readonly hypothetical: LU;
  readonly mainMinMax: MinMax;
  readonly align: ItemAlign;
  /** Column only: the border-box width used to size the item's height. */
  readonly columnCross: LU;
  frozen: boolean;
  target: LU;
};

type Line = { readonly items: Item[]; cross: LU; flowOffset: LU };

/** The flex container's axes: which physical side each flow start is on, and how reverse and wrap-reverse remap alignment. */
type Axes = {
  readonly isRow: boolean;
  readonly ltr: boolean;
  readonly reverse: boolean;
  readonly wrapReverse: boolean;
  /** True when the main-axis flow start is the physical left (row) or top (column). */
  readonly mainStartIsPhysical: boolean;
  /** True when the cross-axis flow start is the physical top (row) or left (column). */
  readonly crossStartIsPhysical: boolean;
};

// css-flexbox-1 §9: the flex layout algorithm for one container, positions relative to its border box.
export function layoutFlexContainer(ctx: Ctx, box: LayoutBox, a: FlexArgs): FlexResult {
  const s = box.style;
  const isRow = s.flexDirection === 'row' || s.flexDirection === 'row-reverse';
  const ltr = directionOf(ctx, box) === 'ltr';
  const axes: Axes = {
    isRow,
    ltr,
    reverse: s.flexDirection === 'row-reverse' || s.flexDirection === 'column-reverse',
    wrapReverse: s.flexWrap === 'wrap-reverse',
    mainStartIsPhysical: isRow ? ltr : true,
    crossStartIsPhysical: isRow ? true : ltr,
  };
  const boxes: LayoutBox[] = [];
  const absolute: LayoutBox[] = [];
  for (const k of box.children) {
    // css-flexbox-1 §4: the compiler wraps text in anonymous flex items; validateLayoutInput rejects text in a flex container.
    if (k.kind === 'text') throw new Error(`${k.id} is text directly in flex container ${box.id}; validateLayoutInput rejects this input`);
    // css-flexbox-1 §4.1: an absolutely positioned child is not a flex item.
    if (isOutOfFlow(ctx, k)) absolute.push(k);
    else boxes.push(k);
  }
  // css-flexbox-1 §5.4: order-modified document order, stable for equal values (planted fault ignoreOrder keeps document order).
  const ordered = ctx.faults.ignoreOrder ? boxes : boxes.map((b, i) => ({ b, i })).sort((x, y) => x.b.style.order - y.b.style.order || x.i - y.i).map((x) => x.b);
  const mainGap = gapValue(box, isRow ? s.columnGap : s.rowGap);
  const crossGap = gapValue(box, isRow ? s.rowGap : s.columnGap);
  const crossInner: LU | null = isRow ? a.definiteInnerHeight : a.contentWidth;
  const singleLine = s.flexWrap === 'nowrap';
  const itemHeightBasis: HeightBasis = a.definiteInnerHeight === null
    ? { kind: 'indefinite' }
    : a.sizeIsFlexDependent ? { kind: 'flex-dependent' } : { kind: 'definite', value: a.definiteInnerHeight };

  // §9.2 and §9.3: flex base sizes, hypothetical main sizes and the main inner size.
  let mainInner: LU | null = isRow ? a.contentWidth : a.definiteInnerHeight;
  const items = ordered.map((b) => buildItem(ctx, box, b, axes, a, mainInner, crossInner, singleLine, itemHeightBasis));
  if (mainInner === null) {
    if (!singleLine) unsupported('flex-wrap-indefinite-main', box.id, 'css-flexbox-1 §9.3', 'multi-line column flex container with an indefinite height (not yet supported)');
    const hypo = add(sum(items.map((i) => outerHypothetical(i))), gapsFor(items.length, mainGap));
    mainInner = constrain(hypo, a.innerHeightMinMax);
  }
  const lines = collectLines(items, mainInner, mainGap, singleLine);

  // §9.7: resolve flexible lengths per line.
  for (const line of lines) resolveFlexibleLengths(line.items, mainInner, mainGap);

  // §9.4: hypothetical cross sizes; row items are laid out at their main size, which also gives their baselines.
  const hypoFrag = new Map<Item, Frag>();
  const hypoCross = new Map<Item, LU>();
  for (const item of items) {
    if (isRow) {
      const r = layoutContents(ctx, item.box, {
        cbInline: a.contentWidth,
        borderBoxWidth: add(item.target, item.mainBp),
        forcedBorderBoxHeight: null,
        forcedHeightDefinite: false,
        heightBasis: itemHeightBasis,
        formattingContextRoot: true,
      });
      hypoFrag.set(item, r.frag);
      hypoCross.set(item, r.frag.height);
    } else {
      hypoCross.set(item, item.columnCross);
    }
  }
  const crossOf = (i: Item): LU => hypoCross.get(i) as LU;
  const participates = (i: Item): boolean => i.align === 'baseline' && !i.autoCrossStart && !i.autoCrossEnd;
  const baselineOf = (i: Item): { toStart: LU; toEnd: LU; offset: LU } => itemBaseline(ctx, i, axes, isRow ? (hypoFrag.get(i) as Frag) : null, crossOf(i));

  // §9.4 steps 7-8: line cross sizes; a single-line container with a definite cross size uses it. In a row container the
  // baseline-sharing group needs its largest distances to the cross-start and cross-end margin edges.
  for (const line of lines) {
    if (singleLine && crossInner !== null) {
      line.cross = crossInner;
      continue;
    }
    let tallest = ZERO;
    let toStart = ZERO;
    let toEnd = ZERO;
    for (const i of line.items) {
      if (isRow && participates(i)) {
        const b = baselineOf(i);
        toStart = max(toStart, b.toStart);
        toEnd = max(toEnd, b.toEnd);
      } else {
        tallest = max(tallest, add(crossOf(i), i.crossMargins));
      }
    }
    tallest = max(tallest, add(toStart, toEnd));
    line.cross = singleLine && isRow ? constrain(tallest, a.innerHeightMinMax) : tallest;
  }
  const linesCross = add(sum(lines.map((l) => l.cross)), gapsFor(lines.length, crossGap));
  const containerCross = crossInner !== null ? crossInner : singleLine ? linesCross : constrain(linesCross, a.innerHeightMinMax);
  if (!singleLine) alignContent(box, axes, lines, sub(containerCross, linesCross), crossGap);
  else if (lines[0] !== undefined) lines[0].flowOffset = ZERO;
  const containerMainDefinite = !isRow && a.definiteInnerHeight !== null && !a.sizeIsFlexDependent;
  const stretchDefinite = isRow && singleLine && a.definiteInnerHeight !== null && !a.sizeIsFlexDependent;
  const crossPercentBasis: HeightBasis = isRow ? itemHeightBasis : { kind: 'definite', value: a.contentWidth };

  // §9.4 step 11, §9.5 and §9.6: stretch, main-axis and cross-axis alignment, then final layout.
  const placed: Placed[] = [];
  const contentLeft = add(a.bor.left, a.pad.left);
  const contentTop = add(a.bor.top, a.pad.top);
  let containerBaseline: LU | null = null;
  // Chrome deviation wrap-reverse-baseline-line: a row container's baseline comes from its block-start (top) line, which is the
  // last flex line under wrap-reverse.
  const baselineLine = isRow && axes.wrapReverse ? lines.length - 1 : 0;
  lines.forEach((line, lineIndex) => {
    const flowItems = axes.reverse ? [...line.items].reverse() : line.items;
    const n = flowItems.length;
    const used = add(sum(flowItems.map((i) => add(add(i.target, i.mainBp), i.mainMargins))), gapsFor(n, mainGap));
    const free = sub(mainInner as LU, used);
    // §9.5 step 12: positive free space goes to main-axis auto margins, which leaves none for justify-content.
    let autoCount = 0;
    for (const i of flowItems) autoCount += Number(i.autoMainStart) + Number(i.autoMainEnd);
    const autoFree = autoCount > 0 && free > 0;
    let autoSeen = 0;
    const autoShare = (): LU => {
      if (!autoFree) return ZERO;
      autoSeen++;
      return sub(cumulativeShareRounded(free, autoSeen, autoCount), cumulativeShareRounded(free, autoSeen - 1, autoCount));
    };
    const justify = justifyFlow(s.justifyContent, axes);
    const linePhysical = axes.crossStartIsPhysical ? line.flowOffset : sub(sub(containerCross, line.flowOffset), line.cross);
    // The baseline-sharing group of the line (css-align-3 §9.3): its shared baseline, from the line's physical start edge.
    let groupToStart = ZERO;
    let groupCount = 0;
    for (const i of flowItems) {
      if (!participates(i)) continue;
      groupToStart = max(groupToStart, baselineOf(i).toStart);
      groupCount++;
    }
    const crossStartAtPhysicalStart = isRow ? !axes.wrapReverse : axes.ltr !== axes.wrapReverse;
    const groupBaseline = crossStartAtPhysicalStart ? groupToStart : sub(line.cross, groupToStart);
    let cursor = ZERO;
    flowItems.forEach((item, k) => {
      if (item.autoMainStart) cursor = add(cursor, autoShare());
      const mainOffset = add(cursor, autoFree ? ZERO : justifyOffset(justify, free, n, k));
      const mainBorderBox = add(item.target, item.mainBp);
      const mainFlow = add(mainOffset, item.mainStart);
      const mainPos = axes.mainStartIsPhysical ? mainFlow : sub(sub(mainInner as LU, mainFlow), mainBorderBox);
      const stretched = item.align === 'stretch' && stretchesCross(item, isRow);
      const crossSize = stretched ? stretchedCrossSize(item, line.cross, isRow, crossPercentBasis) : crossOf(item);
      let crossInLine: LU;
      if (participates(item)) {
        crossInLine = sub(groupBaseline, baselineOf(item).offset);
      } else {
        const flow = add(crossAxisOffset(item, sub(line.cross, add(crossSize, item.crossMargins)), axes), item.crossStart);
        crossInLine = axes.crossStartIsPhysical ? flow : sub(sub(line.cross, flow), crossSize);
      }
      const r = layoutContents(ctx, item.box, {
        cbInline: a.contentWidth,
        borderBoxWidth: isRow ? mainBorderBox : crossSize,
        forcedBorderBoxHeight: isRow ? (stretched ? crossSize : null) : mainBorderBox,
        forcedHeightDefinite: isRow ? stretchDefinite : containerMainDefinite,
        heightBasis: itemHeightBasis,
        formattingContextRoot: true,
      });
      const crossPos = add(linePhysical, crossInLine);
      const at: Placed = {
        frag: r.frag,
        x: add(contentLeft, isRow ? mainPos : crossPos),
        y: add(contentTop, isRow ? crossPos : mainPos),
      };
      // css-flexbox-1 §8.5: the baseline line's shared baseline, or else the baseline of its first item in flow order.
      if (lineIndex === baselineLine && containerBaseline === null) {
        if (isRow && groupCount > 0) containerBaseline = add(contentTop, add(linePhysical, groupBaseline));
        else if (k === 0) containerBaseline = add(at.y, sub(ownBaseline(r.frag), baselineFault(ctx, item)));
      }
      // CSS2 §9.4.3 against the container's content box: a relative offset moves the item after alignment, never the baselines.
      const offset = relativeOffset(item.box, a.contentWidth, itemHeightBasis, directionOf(ctx, box));
      placed.push({ frag: at.frag, x: add(at.x, offset.dx), y: add(at.y, offset.dy) });
      cursor = add(cursor, add(mainBorderBox, item.mainMargins));
      if (item.autoMainEnd) cursor = add(cursor, autoShare());
      cursor = add(cursor, mainGap);
    });
  });
  const content = { left: contentLeft, top: contentTop, width: a.contentWidth, height: isRow ? containerCross : (mainInner as LU) };
  const outOfFlow = absolute.map((child) => staticPosition(ctx, box, child, axes, content));
  return { contentHeight: isRow ? containerCross : mainInner, placed, baseline: containerBaseline, outOfFlow };
}

/** One axis of a static position in flow terms: the flow position along a content-box range whose flow start is near or far. */
function staticAxis(position: FlowPosition, lo: LU, size: LU, startIsNear: boolean): StaticAxis {
  if (position === 'center') return { offset: startIsNear ? add(lo, divInt(size, 2)) : sub(add(lo, size), divInt(size, 2)), edge: 'center' };
  const near = (position === 'start') === startIsNear;
  return near ? { offset: lo, edge: 'near' } : { offset: add(lo, size), edge: 'far' };
}

/**
 * css-flexbox-1 §4.1: the static position of an absolutely positioned child is that of the sole flex item of a container of its
 * used size: justify-content on the main axis and align-self on the cross axis, from the flow start of each axis. Measured in
 * Chrome 145: space-between acts as flex-start and space-around and space-evenly as center; stretch acts as flex-start and
 * baseline as start; align-content has no effect. A centre is the content box start plus LayoutUnit / 2 from the flow start.
 */
function staticPosition(ctx: Ctx, container: LayoutBox, child: LayoutBox, axes: Axes, content: { readonly left: LU; readonly top: LU; readonly width: LU; readonly height: LU }): OutOfFlow {
  const flexStart: FlowPosition = axes.reverse ? 'end' : 'start';
  const j = justifyFlow(container.style.justifyContent, axes);
  const main: FlowPosition = j === 'space-between' ? flexStart : j === 'space-around' || j === 'space-evenly' ? 'center' : j;
  const align = effectiveAlign(ctx, container, child, axes);
  const cross: FlowPosition = align === 'stretch' ? (axes.wrapReverse ? 'end' : 'start') : align === 'baseline' ? 'start' : align;
  const xAxis = axes.isRow ? staticAxis(main, content.left, content.width, axes.mainStartIsPhysical) : staticAxis(cross, content.left, content.width, axes.crossStartIsPhysical);
  const yAxis = axes.isRow ? staticAxis(cross, content.top, content.height, axes.crossStartIsPhysical) : staticAxis(main, content.top, content.height, axes.mainStartIsPhysical);
  return { box: child, x: xAxis, y: yAxis };
}

/** css-align-3 §9.3: a box with no baseline set synthesizes one from its border box: the line-under (bottom) edge. */
function ownBaseline(frag: Frag): LU {
  return frag.baseline === null ? frag.height : frag.baseline;
}

/** Planted fault baselineFromBorderTop: the item's baseline loses its top border and padding. */
function baselineFault(ctx: Ctx, item: Item): LU {
  return ctx.faults.baselineFromBorderTop ? add(item.bor.top, item.pad.top) : ZERO;
}

/**
 * css-flexbox-1 §8.3 and §9.4 step 8: an item's baseline in the cross axis. offset: from the border-box start edge (top for a row
 * container, left for a column one); toStart and toEnd: to the cross-start and cross-end margin edges. In a row container the
 * first baseline comes from the item's content (bottom border edge when it has none); in a column container Chrome synthesizes
 * it at the left border edge for every item (measured, notes/T035-slice-4a.md).
 */
function itemBaseline(ctx: Ctx, item: Item, axes: Axes, frag: Frag | null, crossSize: LU): { toStart: LU; toEnd: LU; offset: LU } {
  const m = item.margin;
  if (axes.isRow) {
    const b = sub(ownBaseline(frag as Frag), baselineFault(ctx, item));
    const fromTop = add(m.top, b);
    const toBottom = sub(add(add(m.top, crossSize), m.bottom), fromTop);
    return axes.wrapReverse ? { toStart: toBottom, toEnd: fromTop, offset: b } : { toStart: fromTop, toEnd: toBottom, offset: b };
  }
  const fromLeft = m.left;
  const toRight = add(crossSize, m.right);
  const crossStartIsLeft = axes.ltr !== axes.wrapReverse;
  return crossStartIsLeft ? { toStart: fromLeft, toEnd: toRight, offset: ZERO } : { toStart: toRight, toEnd: fromLeft, offset: ZERO };
}

function gapValue(box: LayoutBox, v: LayoutStyle['rowGap']): LU {
  if (v.kind === 'percent') unsupported('percent-gap', box.id, 'css-align-3 §8.1', 'percentage gap (not yet supported)');
  return v.kind === 'px' ? fromCssPx(v.value) : ZERO;
}

function gapsFor(n: number, gap: LU): LU {
  return n > 1 ? mulInt(gap, n - 1) : ZERO;
}

// css-align-3 §6.1 with css-flexbox-1 §8.3: align-self auto takes the container's align-items; normal behaves as stretch; each
// value maps to a flow position. flex-start and flex-end follow wrap-reverse; start and end follow the container's writing mode;
// self-start and self-end the item's own (the inline axis in a column container).
function effectiveAlign(ctx: Ctx, container: LayoutBox, item: LayoutBox, axes: Axes): ItemAlign {
  const raw: AlignItems = item.style.alignSelf === 'auto' ? container.style.alignItems : item.style.alignSelf;
  const flexStart: FlowPosition = axes.wrapReverse ? 'end' : 'start';
  const flexEnd: FlowPosition = axes.wrapReverse ? 'start' : 'end';
  const selfSame = axes.isRow || directionOf(ctx, item) === directionOf(ctx, container);
  switch (raw) {
    case 'normal':
    case 'stretch':
      return 'stretch';
    case 'flex-start':
      return flexStart;
    case 'flex-end':
      return flexEnd;
    case 'start':
      return 'start';
    case 'end':
      return 'end';
    case 'self-start':
      return selfSame ? 'start' : 'end';
    case 'self-end':
      return selfSame ? 'end' : 'start';
    case 'center':
      return 'center';
    case 'baseline':
      return 'baseline';
  }
}

// css-flexbox-1 §9.4 step 11: stretch needs an auto cross size and no auto cross-axis margin.
function stretchesCross(item: Item, isRow: boolean): boolean {
  const size = isRow ? item.box.style.height : item.box.style.width;
  return size.kind === 'auto' && !item.autoCrossStart && !item.autoCrossEnd;
}

// css-flexbox-1 §9.2 step 3 and §4.5: flex base size, automatic minimum size and hypothetical main size.
function buildItem(
  ctx: Ctx,
  container: LayoutBox,
  box: LayoutBox,
  axes: Axes,
  a: FlexArgs,
  mainInner: LU | null,
  crossInner: LU | null,
  singleLine: boolean,
  heightBasis: HeightBasis,
): Item {
  const s = box.style;
  const isRow = axes.isRow;
  const cbInline = a.contentWidth;
  const pad = resolvePadding(s, cbInline);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const ml = resolveMargin(s.marginLeft, cbInline);
  const mr = resolveMargin(s.marginRight, cbInline);
  const mt = resolveMargin(s.marginTop, cbInline);
  const mb = resolveMargin(s.marginBottom, cbInline);
  const margin: Edges = { top: mt.value, right: mr.value, bottom: mb.value, left: ml.value };
  // Flow sides: the inline start is the left in ltr and the right in rtl; the block start is the top.
  const inlineStart = axes.ltr ? ml : mr;
  const inlineEnd = axes.ltr ? mr : ml;
  const mainStart = isRow ? inlineStart : mt;
  const mainEnd = isRow ? inlineEnd : mb;
  const crossStart = isRow ? mt : inlineStart;
  const crossEnd = isRow ? mb : inlineEnd;
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const vbp = sumEdges(bor.top, bor.bottom, pad.top, pad.bottom);
  const mainBp = isRow ? hbp : vbp;
  const crossBp = isRow ? vbp : hbp;
  const align = effectiveAlign(ctx, container, box, axes);

  // Column items need their width before their height: definite stretch (§9.8 rule 1), a specified width, or fit-content.
  let columnCross = ZERO;
  if (!isRow) {
    const crossMin = s.minWidth.kind === 'auto' ? hbp : borderBoxFromSpecified(lengthAgainst(s.minWidth, cbInline), hbp, s.boxSizing);
    const crossMax = s.maxWidth.kind === 'none' ? null : borderBoxFromSpecified(lengthAgainst(s.maxWidth, cbInline), hbp, s.boxSizing);
    const mm: MinMax = { min: crossMin, max: crossMax };
    const avail = sub(cbInline, add(ml.value, mr.value));
    let w: LU;
    if (s.width.kind !== 'auto') w = borderBoxFromSpecified(lengthAgainst(s.width, cbInline), hbp, s.boxSizing);
    else if (align === 'stretch' && singleLine && crossInner !== null && !ml.auto && !mr.auto) w = avail;
    else {
      const minC = add(intrinsicContentInlineSize(ctx, box, 'min'), hbp);
      const maxC = add(intrinsicContentInlineSize(ctx, box, 'max'), hbp);
      w = min(maxC, max(minC, avail));
    }
    columnCross = max(constrain(w, mm), hbp);
  }

  const mainSizeProp = isRow ? s.width : s.height;
  const specifiedMain = mainSizeContent(box, mainSizeProp, isRow, mainInner, mainBp, heightBasis);
  let contentSized: LU | null = null;
  const contentMain = (): LU => {
    if (contentSized !== null) return contentSized;
    if (isRow) contentSized = intrinsicContentInlineSize(ctx, box, 'max');
    else {
      const r = layoutContents(ctx, box, {
        cbInline,
        borderBoxWidth: columnCross,
        forcedBorderBoxHeight: null,
        forcedHeightDefinite: false,
        heightBasis,
        formattingContextRoot: true,
      });
      contentSized = contentBox(r.frag.height, vbp);
    }
    return contentSized;
  };

  let base: LU;
  const basis = s.flexBasis;
  if (basis.kind === 'content') {
    return unsupported('flex-basis-content', box.id, 'css-flexbox-1 §7.2.3', 'flex-basis: content (not yet supported)');
  } else if (basis.kind === 'px') {
    base = contentBox(borderBoxFromSpecified(fromCssPx(basis.value), mainBp, s.boxSizing), mainBp);
  } else if (basis.kind === 'percent') {
    if (mainInner === null) return unsupported('flex-basis-content', box.id, 'css-flexbox-1 §7.2.3', 'percentage flex-basis against an indefinite main size is treated as content (not yet supported)');
    base = contentBox(borderBoxFromSpecified(percentOf(mainInner, basis.value), mainBp, s.boxSizing), mainBp);
  } else {
    base = specifiedMain !== null ? specifiedMain : contentMain();
  }

  // Main-axis min and max in content-box terms; min auto is the automatic minimum size (§4.5), which is 0 for a scroll container
  // (planted fault scrollMinAuto keeps the content-based minimum).
  const minProp = isRow ? s.minWidth : s.minHeight;
  const maxProp = isRow ? s.maxWidth : s.maxHeight;
  let maxMain: LU | null = null;
  if (maxProp.kind === 'px') maxMain = contentBox(borderBoxFromSpecified(fromCssPx(maxProp.value), mainBp, s.boxSizing), mainBp);
  else if (maxProp.kind === 'percent') {
    const basisLu = isRow ? cbInline : percentMainHeight(box, heightBasis, 'max-height');
    if (basisLu !== null) maxMain = contentBox(borderBoxFromSpecified(percentOf(basisLu, maxProp.value), mainBp, s.boxSizing), mainBp);
  }
  let minMain: LU;
  if (minProp.kind === 'px') minMain = contentBox(borderBoxFromSpecified(fromCssPx(minProp.value), mainBp, s.boxSizing), mainBp);
  else if (minProp.kind === 'percent') {
    const basisLu = isRow ? cbInline : percentMainHeight(box, heightBasis, 'min-height');
    minMain = basisLu === null ? ZERO : contentBox(borderBoxFromSpecified(percentOf(basisLu, minProp.value), mainBp, s.boxSizing), mainBp);
  } else if (isScrollContainer(s) && !ctx.faults.scrollMinAuto) {
    minMain = ZERO;
  } else {
    const suggestionSource = isRow ? intrinsicContentInlineSize(ctx, box, 'min') : contentMain();
    const contentSuggestion = maxMain === null ? suggestionSource : min(suggestionSource, maxMain);
    minMain = specifiedMain === null ? contentSuggestion : min(specifiedMain, contentSuggestion);
  }
  const mainMinMax: MinMax = { min: minMain, max: maxMain };
  const hypothetical = constrain(base, mainMinMax);
  return {
    box,
    margin,
    pad,
    bor,
    mainStart: mainStart.value,
    mainEnd: mainEnd.value,
    crossStart: crossStart.value,
    autoMainStart: mainStart.auto,
    autoMainEnd: mainEnd.auto,
    autoCrossStart: crossStart.auto,
    autoCrossEnd: crossEnd.auto,
    mainBp,
    crossBp,
    mainMargins: add(mainStart.value, mainEnd.value),
    crossMargins: add(crossStart.value, crossEnd.value),
    grow: s.flexGrow,
    shrink: s.flexShrink,
    base,
    hypothetical,
    mainMinMax,
    align,
    columnCross,
    frozen: false,
    target: hypothetical,
  };
}

function lengthAgainst(v: { readonly kind: 'px' | 'percent'; readonly value: number }, basis: LU): LU {
  return v.kind === 'px' ? fromCssPx(v.value) : percentOf(basis, v.value);
}

// CSS2 §10.5 and css-flexbox-1 §9.8: a percentage block size resolves against a definite basis; indefinite behaves as auto (null).
function percentMainHeight(box: LayoutBox, basis: HeightBasis, prop: string): LU | null {
  if (basis.kind === 'indefinite') return null;
  if (basis.kind === 'definite') return basis.value;
  return unsupported('percent-height-flex', box.id, 'css-flexbox-1 §9.8', `${prop} percentage against a flexed or stretched size that is not definite`);
}

// css-sizing-3 §4: the definite main size property in content-box terms, or null when auto or indefinite.
function mainSizeContent(
  box: LayoutBox,
  v: LayoutStyle['width'],
  isRow: boolean,
  mainInner: LU | null,
  mainBp: LU,
  heightBasis: HeightBasis,
): LU | null {
  if (v.kind === 'auto') return null;
  if (v.kind === 'px') return contentBox(borderBoxFromSpecified(fromCssPx(v.value), mainBp, box.style.boxSizing), mainBp);
  if (isRow) {
    if (mainInner === null) return null;
    return contentBox(borderBoxFromSpecified(percentOf(mainInner, v.value), mainBp, box.style.boxSizing), mainBp);
  }
  const basis = percentMainHeight(box, heightBasis, 'height');
  return basis === null ? null : contentBox(borderBoxFromSpecified(percentOf(basis, v.value), mainBp, box.style.boxSizing), mainBp);
}

function outerHypothetical(i: Item): LU {
  return add(add(i.hypothetical, i.mainBp), i.mainMargins);
}

function outerBase(i: Item): LU {
  return add(add(i.base, i.mainBp), i.mainMargins);
}

// css-flexbox-1 §9.3 step 5: collect items into lines in order-modified document order (Blink FlexLayoutAlgorithm ComputeNextFlexLine).
function collectLines(items: readonly Item[], mainInner: LU, gap: LU, singleLine: boolean): Line[] {
  if (singleLine) return [{ items: [...items], cross: ZERO, flowOffset: ZERO }];
  const lines: Line[] = [];
  let current: Item[] = [];
  let used = ZERO;
  for (const item of items) {
    const outer = outerHypothetical(item);
    if (current.length > 0 && add(used, outer) > mainInner) {
      lines.push({ items: current, cross: ZERO, flowOffset: ZERO });
      current = [];
      used = ZERO;
    }
    current.push(item);
    used = add(add(used, outer), gap);
  }
  if (current.length > 0) lines.push({ items: current, cross: ZERO, flowOffset: ZERO });
  return lines;
}

// css-flexbox-1 §9.7: resolve flexible lengths with Blink's freeze loop and its reverse-order share rounding.
function resolveFlexibleLengths(items: readonly Item[], mainInner: LU, gap: LU): void {
  const gaps = gapsFor(items.length, gap);
  const sumHypothetical = add(sum(items.map(outerHypothetical)), gaps);
  const sumBase = add(sum(items.map(outerBase)), gaps);
  const growing = sumHypothetical < mainInner;
  let totalGrow: FactorSum = FACTOR_ZERO;
  let totalShrink: FactorSum = FACTOR_ZERO;
  let totalWeighted: FactorSum = FACTOR_ZERO;
  for (const i of items) {
    i.frozen = false;
    totalGrow = factorAdd(totalGrow, i.grow);
    totalShrink = factorAdd(totalShrink, i.shrink);
    totalWeighted = factorAdd(totalWeighted, shrinkWeight(i.shrink, i.base));
  }
  let remaining = sub(mainInner, sumBase);
  const freeze = (list: readonly Item[]): void => {
    for (const i of list) {
      remaining = sub(remaining, sub(i.target, i.base));
      totalGrow = factorSubClampZero(totalGrow, i.grow);
      totalShrink = factorSubClampZero(totalShrink, i.shrink);
      totalWeighted = factorSubClampZero(totalWeighted, shrinkWeight(i.shrink, i.base));
      i.frozen = true;
    }
  };
  // Step 2: freeze inflexible items at their hypothetical size (Blink FreezeInflexibleItems).
  const inflexible: Item[] = [];
  for (const i of items) {
    const factor = growing ? i.grow : i.shrink;
    if (factor === 0 || (growing && i.base > i.hypothetical) || (!growing && i.base < i.hypothetical)) {
      i.target = i.hypothetical;
      inflexible.push(i);
    }
  }
  freeze(inflexible);
  const initialFree = remaining;

  // Steps 4-5: loop until no min/max violations (Blink ResolveFlexibleLengths).
  for (;;) {
    const unfrozen = items.filter((i) => !i.frozen);
    if (unfrozen.length === 0) return;
    const factorSum = growing ? totalGrow : totalShrink;
    if (factorValue(factorSum) > 0 && factorValue(factorSum) < 1) {
      const fractional = fractionalFreeSpace(initialFree, factorSum);
      if (abs(fractional) < abs(remaining)) remaining = fractional;
    }
    // Chrome 145 (measured, notes/T023-slice-1.md) hands out shares from the last unfrozen item backwards, each from what remains.
    let shareLeft = remaining;
    let growLeft = totalGrow;
    let weightLeft = totalWeighted;
    let totalViolation = ZERO;
    const minViolations: Item[] = [];
    const maxViolations: Item[] = [];
    for (let k = unfrozen.length - 1; k >= 0; k--) {
      const i = unfrozen[k] as Item;
      let extra = ZERO;
      if (shareLeft > 0 && growing && factorValue(growLeft) > 0 && isFiniteFactorSum(growLeft)) {
        extra = growShare(shareLeft, i.grow, growLeft);
      } else if (shareLeft < 0 && !growing && factorValue(weightLeft) > 0 && isFiniteFactorSum(weightLeft) && i.shrink !== 0) {
        extra = shrinkShare(shareLeft, i.shrink, i.base, weightLeft);
      }
      shareLeft = sub(shareLeft, extra);
      growLeft = factorSubClampZero(growLeft, i.grow);
      weightLeft = factorSubClampZero(weightLeft, shrinkWeight(i.shrink, i.base));
      const unclamped = add(i.base, extra);
      const clamped = clampNegativeToZero(constrain(unclamped, i.mainMinMax));
      i.target = clamped;
      const violation = sub(clamped, unclamped);
      if (violation > 0) minViolations.push(i);
      else if (violation < 0) maxViolations.push(i);
      totalViolation = add(totalViolation, violation);
    }
    if (totalViolation === 0) return;
    freeze(totalViolation < 0 ? maxViolations : minViolations);
  }
}

function abs(v: LU): LU {
  return v < 0 ? sub(ZERO, v) : v;
}

// css-flexbox-1 §9.4 step 11: a stretched item's cross size is the line's, minus margins, clamped by min/max (percentages too).
function stretchedCrossSize(item: Item, lineCross: LU, isRow: boolean, percentBasis: HeightBasis): LU {
  const s = item.box.style;
  const minProp = isRow ? s.minHeight : s.minWidth;
  const maxProp = isRow ? s.maxHeight : s.maxWidth;
  const resolve = (v: { readonly kind: 'px' | 'percent'; readonly value: number }, prop: string): LU | null => {
    if (v.kind === 'px') return fromCssPx(v.value);
    const basis = percentMainHeight(item.box, percentBasis, prop);
    return basis === null ? null : percentOf(basis, v.value);
  };
  const lo = minProp.kind === 'auto' ? null : resolve(minProp, isRow ? 'min-height' : 'min-width');
  const hi = maxProp.kind === 'none' ? null : resolve(maxProp, isRow ? 'max-height' : 'max-width');
  const mm: MinMax = {
    min: lo === null ? item.crossBp : borderBoxFromSpecified(lo, item.crossBp, s.boxSizing),
    max: hi === null ? null : borderBoxFromSpecified(hi, item.crossBp, s.boxSizing),
  };
  return max(constrain(sub(lineCross, item.crossMargins), mm), item.crossBp);
}

// css-flexbox-1 §8.1 and §9.6 step 13, in flow terms: auto cross margins take positive space (Blink LayoutUnit / 2 when both are
// auto) and otherwise the item aligns by align-self (css-align-3 §6.1, unsafe; Blink LayoutUnit / 2 for center). A stretch item
// that cannot stretch sits at flex-start, which wrap-reverse puts at the flow end.
function crossAxisOffset(item: Item, available: LU, axes: Axes): LU {
  if (item.autoCrossStart || item.autoCrossEnd) {
    // Chrome deviation auto-margin-overflow-cross-start: with no positive space the item sits at the cross-start edge.
    if (available <= 0) return axes.wrapReverse ? available : ZERO;
    if (item.autoCrossStart && item.autoCrossEnd) return divInt(available, 2);
    return item.autoCrossStart ? available : ZERO;
  }
  if (item.align === 'end' || (item.align === 'stretch' && axes.wrapReverse)) return available;
  if (item.align === 'center') return divInt(available, 2);
  return ZERO;
}

type FlowJustify = FlowPosition | DistributedMode;

// css-align-3 §5.1 for flex containers: justify-content in flow terms. flex-start and flex-end follow the flex direction (reverse
// swaps them); start and end follow the writing mode; left and right are physical in a row container and act as start in a
// column one; normal and stretch act as flex-start.
function justifyFlow(value: JustifyContent, axes: Axes): FlowJustify {
  const flexStart: FlowPosition = axes.reverse ? 'end' : 'start';
  switch (value) {
    case 'normal':
    case 'stretch':
    case 'flex-start':
      return flexStart;
    case 'flex-end':
      return axes.reverse ? 'start' : 'end';
    case 'start':
      return 'start';
    case 'end':
      return 'end';
    case 'left':
      return axes.isRow && !axes.ltr ? 'end' : 'start';
    case 'right':
      return axes.isRow && axes.ltr ? 'end' : 'start';
    case 'center':
      return 'center';
    case 'space-between':
    case 'space-around':
    case 'space-evenly':
      return value;
  }
}

// css-flexbox-1 §9.5 with css-align-3 §5.3: offset before flow item k. With negative free space space-between falls back to
// flex-start, and space-around and space-evenly to safe center, which is start.
function justifyOffset(justify: FlowJustify, free: LU, n: number, k: number): LU {
  if (justify === 'start') return ZERO;
  if (justify === 'end') return free;
  if (justify === 'center') return divInt(free, 2);
  if (free > 0) return distributedOffset(justify, free, n, k);
  return ZERO;
}

// css-flexbox-1 §9.4 step 15 with css-align-3 §5.3: align-content for multi-line containers, in flow terms: the lines stack from
// the cross-axis flow start, reversed by wrap-reverse. Negative free space: stretch and space-between fall back to flex-start,
// space-around and space-evenly to safe center (start); center and end stay unsafe.
function alignContent(box: LayoutBox, axes: Axes, lines: Line[], free: LU, gap: LU): void {
  const v = box.style.alignContent;
  if (v === 'baseline') unsupported('flex-baseline', box.id, 'css-align-3 §9.3', 'align-content: baseline (not yet supported)');
  const flowLines = axes.wrapReverse ? [...lines].reverse() : lines;
  const n = flowLines.length;
  // A container whose children are all absolutely positioned has no flex lines to align.
  if (n === 0) return;
  const flexStart: FlowPosition = axes.wrapReverse ? 'end' : 'start';
  let position: FlowPosition | DistributedMode | 'stretch';
  if (v === 'normal' || v === 'stretch') position = free > 0 ? 'stretch' : flexStart;
  else if (v === 'flex-start') position = flexStart;
  else if (v === 'flex-end') position = axes.wrapReverse ? 'start' : 'end';
  else if (v === 'start' || v === 'end' || v === 'center') position = v;
  else if (free > 0) position = v;
  else position = v === 'space-between' ? flexStart : 'start';
  if (position === 'stretch') {
    // Blink: each line grows by LayoutUnit / line count; the remainder is dropped.
    const extra = divInt(free, n);
    for (const l of flowLines) l.cross = add(l.cross, extra);
  }
  let cursor = ZERO;
  flowLines.forEach((l, k) => {
    let shift = ZERO;
    if (position === 'center') shift = divInt(free, 2);
    else if (position === 'end') shift = free;
    else if (position === 'space-between' || position === 'space-around' || position === 'space-evenly') shift = distributedOffset(position, free, n, k);
    l.flowOffset = add(cursor, shift);
    cursor = add(add(cursor, l.cross), gap);
  });
}
