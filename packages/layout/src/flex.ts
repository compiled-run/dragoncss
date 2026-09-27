// css-flexbox-1 §9: flex layout (row and column, nowrap and wrap, auto margins; no order, reverse or baselines until S4).
import type { AlignItems, LayoutBox, LayoutStyle } from './input.ts';
import type { FactorSum, LU } from './units.ts';
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
import type { Edges, HeightBasis, MinMax, Placed } from './box.ts';
import {
  borderBoxFromSpecified,
  constrain,
  contentBox,
  resolveBorder,
  resolveMargin,
  resolvePadding,
  sumEdges,
  visibleChildren,
} from './box.ts';
import type { Ctx } from './block.ts';
import { layoutContents } from './block.ts';
import { intrinsicContentInlineSize } from './intrinsic.ts';
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

export type FlexResult = { readonly contentHeight: LU; readonly placed: readonly Placed[] };

type AutoMargins = { readonly top: boolean; readonly right: boolean; readonly bottom: boolean; readonly left: boolean };

type Item = {
  readonly box: LayoutBox;
  /** Margins with auto treated as zero (css-flexbox-1 §9.2); auto ones are resolved in §9.5 and §9.6. */
  readonly margin: Edges;
  readonly auto: AutoMargins;
  readonly pad: Edges;
  readonly bor: Edges;
  readonly mainBp: LU;
  readonly crossBp: LU;
  readonly mainMargins: LU;
  readonly crossMargins: LU;
  readonly grow: number;
  readonly shrink: number;
  readonly base: LU;
  readonly hypothetical: LU;
  readonly mainMinMax: MinMax;
  readonly align: 'stretch' | 'flex-start' | 'flex-end' | 'center';
  /** Column only: the border-box width used to size the item's height. */
  readonly columnCross: LU;
  frozen: boolean;
  target: LU;
};

type Line = { readonly items: Item[]; cross: LU; offset: LU };

// css-flexbox-1 §9: the flex layout algorithm for one container, positions relative to its border box.
export function layoutFlexContainer(ctx: Ctx, box: LayoutBox, a: FlexArgs): FlexResult {
  const s = box.style;
  checkContainer(box);
  const isRow = s.flexDirection === 'row';
  const kids = visibleChildren(box);
  const boxes: LayoutBox[] = [];
  for (const k of kids) {
    // css-flexbox-1 §4: the compiler wraps text in anonymous flex items; validateLayoutInput rejects text in a flex container.
    if (k.kind === 'text') throw new Error(`${k.id} is text directly in flex container ${box.id}; validateLayoutInput rejects this input`);
    boxes.push(k);
  }
  const mainGap = gapValue(box, isRow ? s.columnGap : s.rowGap);
  const crossGap = gapValue(box, isRow ? s.rowGap : s.columnGap);
  const crossInner: LU | null = isRow ? a.definiteInnerHeight : a.contentWidth;
  const singleLine = s.flexWrap === 'nowrap';
  const itemHeightBasis: HeightBasis = a.definiteInnerHeight === null
    ? { kind: 'indefinite' }
    : a.sizeIsFlexDependent ? { kind: 'flex-dependent' } : { kind: 'definite', value: a.definiteInnerHeight };

  // §9.2 and §9.3: flex base sizes, hypothetical main sizes and the main inner size.
  let mainInner: LU | null = isRow ? a.contentWidth : a.definiteInnerHeight;
  const items = boxes.map((b) => buildItem(ctx, box, b, isRow, a, mainInner, crossInner, singleLine, itemHeightBasis));
  if (mainInner === null) {
    if (!singleLine) unsupported('flex-wrap-indefinite-main', box.id, 'css-flexbox-1 §9.3', 'multi-line column flex container with an indefinite height (not yet supported)');
    const hypo = add(sum(items.map((i) => outerHypothetical(i))), gapsFor(items.length, mainGap));
    mainInner = constrain(hypo, a.innerHeightMinMax);
  }
  const lines = collectLines(items, mainInner, mainGap, singleLine);

  // §9.7: resolve flexible lengths per line.
  for (const line of lines) resolveFlexibleLengths(line.items, mainInner, mainGap);

  // §9.4: hypothetical cross sizes.
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
      hypoCross.set(item, r.frag.height);
    } else {
      hypoCross.set(item, item.columnCross);
    }
  }
  const crossOf = (i: Item): LU => hypoCross.get(i) as LU;

  // §9.4 steps 7-8: line cross sizes; a single-line container with a definite cross size uses it.
  for (const line of lines) {
    if (singleLine && crossInner !== null) {
      line.cross = crossInner;
    } else {
      let tallest = ZERO;
      for (const i of line.items) tallest = max(tallest, add(crossOf(i), i.crossMargins));
      line.cross = singleLine && isRow ? constrain(tallest, a.innerHeightMinMax) : tallest;
    }
  }
  const linesCross = add(sum(lines.map((l) => l.cross)), gapsFor(lines.length, crossGap));
  const containerCross = crossInner !== null ? crossInner : singleLine ? linesCross : constrain(linesCross, a.innerHeightMinMax);
  if (!singleLine) alignContent(box, lines, sub(containerCross, linesCross), crossGap);
  else if (lines[0] !== undefined) lines[0].offset = ZERO;
  const containerMainDefinite = !isRow && a.definiteInnerHeight !== null && !a.sizeIsFlexDependent;
  const stretchDefinite = isRow && singleLine && a.definiteInnerHeight !== null && !a.sizeIsFlexDependent;
  const crossPercentBasis: HeightBasis = isRow ? itemHeightBasis : { kind: 'definite', value: a.contentWidth };

  // §9.4 step 11, §9.5 and §9.6: stretch, main-axis and cross-axis alignment, then final layout.
  const placed: Placed[] = [];
  const contentLeft = add(a.bor.left, a.pad.left);
  const contentTop = add(a.bor.top, a.pad.top);
  for (const line of lines) {
    const n = line.items.length;
    const used = add(sum(line.items.map((i) => add(add(i.target, i.mainBp), i.mainMargins))), gapsFor(n, mainGap));
    const free = sub(mainInner, used);
    // §9.5 step 12: positive free space goes to main-axis auto margins, which leaves none for justify-content.
    let autoCount = 0;
    for (const i of line.items) autoCount += Number(isRow ? i.auto.left : i.auto.top) + Number(isRow ? i.auto.right : i.auto.bottom);
    const autoFree = autoCount > 0 && free > 0;
    let autoSeen = 0;
    const autoShare = (): LU => {
      if (!autoFree) return ZERO;
      autoSeen++;
      return sub(cumulativeShareRounded(free, autoSeen, autoCount), cumulativeShareRounded(free, autoSeen - 1, autoCount));
    };
    let cursor = ZERO;
    for (let k = 0; k < n; k++) {
      const item = line.items[k] as Item;
      if (isRow ? item.auto.left : item.auto.top) cursor = add(cursor, autoShare());
      const mainOffset = add(cursor, autoFree ? ZERO : justifyOffset(box, s.justifyContent, free, n, k));
      const stretched = item.align === 'stretch' && stretchesCross(item, isRow);
      const crossSize = stretched ? stretchedCrossSize(item, line.cross, isRow, crossPercentBasis) : crossOf(item);
      const crossOffset = crossAxisOffset(item, sub(line.cross, add(crossSize, item.crossMargins)), isRow);
      const mainBorderBox = add(item.target, item.mainBp);
      const r = layoutContents(ctx, item.box, {
        cbInline: a.contentWidth,
        borderBoxWidth: isRow ? mainBorderBox : crossSize,
        forcedBorderBoxHeight: isRow ? (stretched ? crossSize : null) : mainBorderBox,
        forcedHeightDefinite: isRow ? stretchDefinite : containerMainDefinite,
        heightBasis: itemHeightBasis,
        formattingContextRoot: true,
      });
      const mainPos = add(mainOffset, isRow ? item.margin.left : item.margin.top);
      const crossPos = add(add(line.offset, crossOffset), isRow ? item.margin.top : item.margin.left);
      placed.push({
        frag: r.frag,
        x: add(contentLeft, isRow ? mainPos : crossPos),
        y: add(contentTop, isRow ? crossPos : mainPos),
      });
      cursor = add(cursor, add(mainBorderBox, item.mainMargins));
      if (isRow ? item.auto.right : item.auto.bottom) cursor = add(cursor, autoShare());
      cursor = add(cursor, mainGap);
    }
  }
  return { contentHeight: isRow ? containerCross : mainInner, placed };
}

// css-flexbox-1 §4, §5 and §8: container features outside the supported subset are refused rather than approximated.
function checkContainer(box: LayoutBox): void {
  const s = box.style;
  if (s.flexDirection === 'row-reverse' || s.flexDirection === 'column-reverse') {
    unsupported('flex-reverse', box.id, 'css-flexbox-1 §5.1', `flex-direction: ${s.flexDirection} (S4)`);
  }
  if (s.flexWrap === 'wrap-reverse') unsupported('flex-wrap-reverse', box.id, 'css-flexbox-1 §5.2', 'flex-wrap: wrap-reverse (S4)');
  const justify = s.justifyContent;
  if (justify === 'start' || justify === 'end' || justify === 'left' || justify === 'right') {
    unsupported('flex-justify-value', box.id, 'css-align-3 §5.1', `justify-content: ${justify} (not yet supported)`);
  }
}

function gapValue(box: LayoutBox, v: LayoutStyle['rowGap']): LU {
  if (v.kind === 'percent') unsupported('percent-gap', box.id, 'css-align-3 §8.1', 'percentage gap (not yet supported)');
  return v.kind === 'px' ? fromCssPx(v.value) : ZERO;
}

function gapsFor(n: number, gap: LU): LU {
  return n > 1 ? mulInt(gap, n - 1) : ZERO;
}

// css-align-3 §6.1: align-self auto takes the container's align-items; normal behaves as stretch on flex items.
function effectiveAlign(container: LayoutStyle, item: LayoutBox): Item['align'] {
  const raw: AlignItems = item.style.alignSelf === 'auto' ? container.alignItems : item.style.alignSelf;
  if (raw === 'normal' || raw === 'stretch') return 'stretch';
  if (raw === 'flex-start' || raw === 'flex-end' || raw === 'center') return raw;
  if (raw === 'baseline') return unsupported('flex-baseline', item.id, 'css-flexbox-1 §8.3', 'baseline alignment (S4)');
  return unsupported('flex-align-value', item.id, 'css-align-3 §6.1', `align-self: ${raw} (not yet supported)`);
}

// css-flexbox-1 §9.4 step 11: stretch needs an auto cross size and no auto cross-axis margin.
function stretchesCross(item: Item, isRow: boolean): boolean {
  const size = isRow ? item.box.style.height : item.box.style.width;
  const autoMargin = isRow ? item.auto.top || item.auto.bottom : item.auto.left || item.auto.right;
  return size.kind === 'auto' && !autoMargin;
}

// css-flexbox-1 §9.2 step 3 and §4.5: flex base size, automatic minimum size and hypothetical main size.
function buildItem(
  ctx: Ctx,
  container: LayoutBox,
  box: LayoutBox,
  isRow: boolean,
  a: FlexArgs,
  mainInner: LU | null,
  crossInner: LU | null,
  singleLine: boolean,
  heightBasis: HeightBasis,
): Item {
  const s = box.style;
  if (s.order !== 0) unsupported('flex-order', box.id, 'css-flexbox-1 §5.4', 'order other than 0 (S4)');
  const cbInline = a.contentWidth;
  const pad = resolvePadding(s, cbInline);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const ml = resolveMargin(s.marginLeft, cbInline);
  const mr = resolveMargin(s.marginRight, cbInline);
  const mt = resolveMargin(s.marginTop, cbInline);
  const mb = resolveMargin(s.marginBottom, cbInline);
  const margin: Edges = { top: mt.value, right: mr.value, bottom: mb.value, left: ml.value };
  const auto: AutoMargins = { top: mt.auto, right: mr.auto, bottom: mb.auto, left: ml.auto };
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const vbp = sumEdges(bor.top, bor.bottom, pad.top, pad.bottom);
  const mainBp = isRow ? hbp : vbp;
  const crossBp = isRow ? vbp : hbp;
  const align = effectiveAlign(container.style, box);

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

  // Main-axis min and max in content-box terms; min auto is the automatic minimum size (§4.5).
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
    auto,
    pad,
    bor,
    mainBp,
    crossBp,
    mainMargins: isRow ? add(ml.value, mr.value) : add(mt.value, mb.value),
    crossMargins: isRow ? add(mt.value, mb.value) : add(ml.value, mr.value),
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

// css-flexbox-1 §9.3 step 5: collect items into lines (Blink FlexLayoutAlgorithm ComputeNextFlexLine).
function collectLines(items: readonly Item[], mainInner: LU, gap: LU, singleLine: boolean): Line[] {
  if (singleLine) return [{ items: [...items], cross: ZERO, offset: ZERO }];
  const lines: Line[] = [];
  let current: Item[] = [];
  let used = ZERO;
  for (const item of items) {
    const outer = outerHypothetical(item);
    if (current.length > 0 && add(used, outer) > mainInner) {
      lines.push({ items: current, cross: ZERO, offset: ZERO });
      current = [];
      used = ZERO;
    }
    current.push(item);
    used = add(add(used, outer), gap);
  }
  if (current.length > 0) lines.push({ items: current, cross: ZERO, offset: ZERO });
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
    let usedFree = ZERO;
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
      usedFree = add(usedFree, sub(clamped, i.base));
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

// css-flexbox-1 §8.1 and §9.6 step 13: auto cross margins take positive space (Blink LayoutUnit / 2 when both are auto) and
// otherwise the item aligns by align-self (css-align-3 §6.1, unsafe; Blink LayoutUnit / 2 for center).
function crossAxisOffset(item: Item, available: LU, isRow: boolean): LU {
  const startAuto = isRow ? item.auto.top : item.auto.left;
  const endAuto = isRow ? item.auto.bottom : item.auto.right;
  if (startAuto || endAuto) {
    if (available <= 0) return ZERO;
    if (startAuto && endAuto) return divInt(available, 2);
    return startAuto ? available : ZERO;
  }
  if (item.align === 'flex-end') return available;
  if (item.align === 'center') return divInt(available, 2);
  return ZERO;
}

// css-flexbox-1 §9.5 with css-align-3 §5.3: offset before item k; distributed values fall back to start when free space is negative.
function justifyOffset(box: LayoutBox, justify: LayoutStyle['justifyContent'], free: LU, n: number, k: number): LU {
  switch (justify) {
    case 'flex-end':
      return free;
    case 'center':
      return divInt(free, 2);
    case 'space-between':
    case 'space-around':
    case 'space-evenly':
      return free > 0 ? distributedOffset(justify, free, n, k) : ZERO;
    case 'normal':
    case 'flex-start':
    case 'stretch':
      return ZERO;
    default:
      return unsupported('flex-justify-value', box.id, 'css-align-3 §5.1', `justify-content: ${justify} (not yet supported)`);
  }
}

// css-flexbox-1 §9.4 step 15 with css-align-3 §5.3: align-content for multi-line containers. Negative free space: stretch and
// the distributed values fall back to start (space-around and space-evenly to safe center); center and end stay unsafe.
function alignContent(box: LayoutBox, lines: Line[], free: LU, gap: LU): void {
  const v = box.style.alignContent;
  const n = lines.length;
  if (v === 'baseline') unsupported('flex-baseline', box.id, 'css-align-3 §9.3', 'align-content: baseline (S4)');
  if ((v === 'normal' || v === 'stretch') && free > 0) {
    // Blink: each line grows by LayoutUnit / line count; the remainder is dropped.
    const extra = divInt(free, n);
    for (const l of lines) l.cross = add(l.cross, extra);
  }
  let cursor = ZERO;
  lines.forEach((l, k) => {
    let shift = ZERO;
    if (v === 'center') shift = divInt(free, 2);
    else if (v === 'flex-end' || v === 'end') shift = free;
    else if ((v === 'space-between' || v === 'space-around' || v === 'space-evenly') && free > 0) shift = distributedOffset(v, free, n, k);
    l.offset = add(cursor, shift);
    cursor = add(add(cursor, l.cross), gap);
  });
}
