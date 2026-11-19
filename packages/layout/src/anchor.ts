// css-anchor-position-1: an absolutely positioned box placed against anchor boxes laid out before it. Ported from Chrome 145.0.7632.6
// (BSD, The Chromium Authors): third_party/blink/renderer/core/layout/absolute_utils.cc 51-416 (inset bias, the unclamped and clamped
// inset-modified containing block, margins and ComputeInsets), 467-603 (insets, alignment and the anchor-center offset),
// 622-945 (inline and block dimensions); layout/anchor_evaluator_impl.cc 60-213 and 545-656 (anchor() and anchor-size() values,
// the position-area offsets); style/position_area.cc 207-292 (default alignment of a position area); out_of_flow_layout_part.cc 65-107
// and 2276-2470 (the non-overflow check and the position options). Every axis is in the containing block's writing direction; the
// compiler refuses an anchored box whose own direction differs from it, so the box's direction is the containing block's.
import type { AnchorEdge, AnchorOption, AnchorSizeRef, AreaTrack, BlockSizeValue, InlineSizeValue, LayoutBox, LayoutStyle, MaxBlockSizeValue, MaxInlineSizeValue, MinBlockSizeValue, Px } from './input.ts';
import type { LU } from './units.ts';
import { add, anchorPercentOffset, divInt, fromFloatRound, max, min, sub, toPx, ZERO } from './units.ts';
import type { MarginResolved, StaticAxis } from './box.ts';
import {
  blockMinMaxWith,
  borderBoxFromSpecified,
  constrain,
  inlineMinMaxOf,
  lengthWidth,
  NO_STRETCH,
  resolveBorder,
  resolveInlineLengthWith,
  resolveLength,
  resolveMarginWith,
  resolvePaddingWith,
  sumEdges,
} from './box.ts';
import type { Ctx } from './block.ts';
import { layoutContents } from './block.ts';
import { intrinsicContentInlineSize } from './intrinsic.ts';
import { hasAspectRatio, ratioAbsoluteInlineSize, ratioSetsAbsoluteHeight } from './ratio.ts';
import type { AbsoluteResult, ContainingBlock } from './position.ts';
import { unsupported } from './unsupported.ts';

/** A border box in absolute LU. */
export type AnchorRect = { readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

/** Blink InsetBias: the edge an inset-modified containing block grows from, or both equally. */
type Bias = 'start' | 'end' | 'equal';

/** Blink ItemPosition, as far as an anchored box's used self-alignment reaches. */
type Align = 'normal' | 'start' | 'end' | 'center' | 'anchor-center';

/** One axis of an anchored box, in the containing block's writing direction. */
type Axis = {
  /** The position-area-modified containing block's size and its offsets from the containing block's start and end edges. */
  readonly size: LU;
  readonly containerStart: LU;
  readonly containerEnd: LU;
  readonly insetStart: LU | null;
  readonly insetEnd: LU | null;
  readonly marginStart: MarginResolved;
  readonly marginEnd: MarginResolved;
  readonly align: Align;
  /** The anchor box's centre from the modified containing block's start edge, when anchor-center applies in this axis. */
  readonly anchorCenter: LU | null;
  readonly anchorPositioning: boolean;
  readonly staticOffset: LU;
  readonly staticEdge: Bias;
};

/** Two offsets along one axis, from its start and its end. */
type Span = { readonly start: LU; readonly end: LU };

/** Resolved margins in one axis, and whether auto margins took the free space. */
type AxisMargins = { readonly start: LU; readonly end: LU; readonly applied: boolean };

/** The inset-modified containing block in one axis: its start and end insets and the edge free space goes to. */
type Imcb = { readonly start: LU; readonly end: LU; readonly bias: Bias; readonly defaultBias: Bias | null; readonly hasAutoInset: boolean };

/** One option laid out: the border box from the containing block's padding-box origin, and whether its margin box overflows. */
type Placed = { readonly result: AbsoluteResult; readonly overflows: boolean; readonly imcbWidth: LU; readonly imcbHeight: LU };

function anchorOf(anchors: Map<string, AnchorRect>, id: string, box: string): AnchorRect {
  const r = anchors.get(id);
  if (r === undefined) unsupported('anchor-order', box, 'css-anchor-position-1 §2.3', `the anchor ${id} of ${box} is not laid out before it`);
  return r as AnchorRect;
}

/** Blink ResolveAnchorValue for a physical side: the edge at fraction along the anchor box, from the containing block's start. */
function edgeAt(start: LU, size: LU, fraction: number): LU {
  if (fraction === 0) return start;
  if (fraction === 1) return add(start, size);
  if (fraction === 0.5) return add(start, fromFloatRound(toPx(size) * 0.5));
  return add(start, anchorPercentOffset(size, fraction));
}

/**
 * anchor_evaluator_impl.cc ComputePositionAreaOffsetsForLayout: the inset of each grid line of a position area from its side of
 * the containing block. A side of the containing block itself is 0, or the anchor's own edge when the anchor reaches past it.
 */
function areaOffsets(startTrack: AreaTrack, endTrack: AreaTrack, anchorStart: LU, anchorEnd: LU, size: LU): Span {
  const start = startTrack === 'start' ? min(anchorStart, ZERO) : startTrack === 'center' ? anchorStart : anchorEnd;
  const end = endTrack === 'end' ? min(sub(size, anchorEnd), ZERO) : endTrack === 'center' ? sub(size, anchorEnd) : sub(size, anchorStart);
  const out: Span = { start, end };
  return out;
}

/** position_area.cc AlignJustifySelfFromPhysical in one physical axis: towards the anchor, centred, or anchor-center over all three. */
function areaAlign(startTrack: AreaTrack, endTrack: AreaTrack, reversed: boolean): Align {
  if (startTrack === 'start' && endTrack === 'end') return 'anchor-center';
  if (startTrack === 'center' && endTrack === 'center') return 'center';
  const towardStart = startTrack === 'start';
  return towardStart !== reversed ? 'end' : 'start';
}

/** absolute_utils.cc GetAlignmentInsetBias with one writing direction. */
function alignBias(a: Align): Bias {
  if (a === 'center' || a === 'anchor-center') return 'equal';
  return a === 'end' ? 'end' : 'start';
}

/** absolute_utils.cc ResizeIMCBInOneAxis. */
function resize(bias: Bias, amount: LU, start: LU, end: LU): Span {
  if (bias === 'start') return { start, end: add(end, amount) };
  if (bias === 'end') return { start: add(start, amount), end };
  const half = divInt(amount, 2);
  return { start: add(start, half), end: add(end, half) };
}

/** absolute_utils.cc ComputeUnclampedIMCBInOneAxis. */
function unclampedImcb(a: Axis): Imcb {
  if (a.insetStart === null && a.insetEnd === null) {
    if (a.staticEdge === 'start') return { start: a.staticOffset, end: ZERO, bias: 'start', defaultBias: null, hasAutoInset: true };
    if (a.staticEdge === 'end') return { start: ZERO, end: sub(a.size, a.staticOffset), bias: 'end', defaultBias: null, hasAutoInset: true };
    const half = min(a.staticOffset, sub(a.size, a.staticOffset));
    return { start: sub(a.staticOffset, half), end: sub(sub(a.size, a.staticOffset), half), bias: 'equal', defaultBias: null, hasAutoInset: true };
  }
  const start = a.insetStart === null ? ZERO : a.insetStart;
  const end = a.insetEnd === null ? ZERO : a.insetEnd;
  if (a.insetStart === null || a.insetEnd === null) return { start, end, bias: a.insetStart !== null ? 'start' : 'end', defaultBias: null, hasAutoInset: true };
  return { start, end, bias: alignBias(a.align), defaultBias: 'start', hasAutoInset: false };
}

/** absolute_utils.cc ComputeInsetModifiedContainingBlock: a negative size shrinks to 0 from its weaker edge. */
function clampedImcb(m: Imcb, size: LU): Imcb {
  const extent = sub(sub(size, m.start), m.end);
  if (extent >= 0) return m;
  const r = resize(m.defaultBias === null ? m.bias : m.defaultBias, extent, m.start, m.end);
  return { start: r.start, end: r.end, bias: m.bias, defaultBias: m.defaultBias, hasAutoInset: m.hasAutoInset };
}

/** absolute_utils.cc ComputeMargins: auto margins are 0 beside an auto inset or anchor positioning, and otherwise share the free space. */
function margins(a: Axis, m: Imcb, size: LU, inline: boolean): AxisMargins {
  const ms = a.marginStart;
  const me = a.marginEnd;
  if (m.hasAutoInset || a.anchorPositioning || (!ms.auto && !me.auto)) return { start: ms.value, end: me.value, applied: false };
  const free = sub(sub(sub(sub(sub(a.size, m.start), m.end), size), ms.auto ? ZERO : ms.value), me.auto ? ZERO : me.value);
  if (ms.auto && me.auto) {
    if (free > 0 || !inline) {
      const start = divInt(free, 2);
      return { start, end: sub(free, start), applied: true };
    }
    return { start: ZERO, end: free, applied: true };
  }
  if (ms.auto) return { start: free, end: me.value, applied: true };
  return { start: ms.value, end: free, applied: true };
}

/** absolute_utils.cc ComputeInsets: the margin box aligned in the inset-modified containing block, kept inside the containing block. */
function insetStartOf(a: Axis, m: Imcb, marginStart: LU, marginEnd: LU, size: LU): LU {
  const box = add(add(marginStart, size), marginEnd);
  let start = m.start;
  let end = m.end;
  if (a.anchorCenter !== null) {
    const half = sub(a.anchorCenter, start);
    start = sub(a.anchorCenter, half);
    end = sub(sub(a.size, a.anchorCenter), half);
  }
  const free = sub(sub(sub(a.size, start), end), box);
  const r = resize(m.bias, free, start, end);
  start = r.start;
  end = r.end;
  if (a.align !== 'normal' && m.defaultBias !== null) {
    const useImcb = box <= sub(sub(a.size, m.start), m.end);
    const safeStart = useImcb ? m.start : min(m.start, sub(ZERO, a.containerStart));
    const safeEnd = useImcb ? m.end : min(m.end, sub(ZERO, a.containerEnd));
    const adjustStart = (): void => {
      if (start < safeStart) {
        end = add(end, sub(start, safeStart));
        start = safeStart;
      }
    };
    const adjustEnd = (): void => {
      if (end < safeEnd) {
        start = add(start, sub(end, safeEnd));
        end = safeEnd;
      }
    };
    adjustEnd();
    adjustStart();
  }
  return add(start, marginStart);
}

/** An anchor-size() as the px length it resolves to (anchor_evaluator_impl.cc ResolveAnchorSizeValue), or null when there is none. */
function anchorSizePx(ref: AnchorSizeRef | null, anchors: Map<string, AnchorRect>, box: string): Px | null {
  if (ref === null) return null;
  const r = anchorOf(anchors, ref.anchor, box);
  const out: Px = { kind: 'px', value: toPx(ref.axis === 'width' ? r.width : r.height) };
  return out;
}

function inlineSizeOf(v: InlineSizeValue, ref: AnchorSizeRef | null, anchors: Map<string, AnchorRect>, box: string): InlineSizeValue {
  const px = anchorSizePx(ref, anchors, box);
  return px === null ? v : px;
}

function blockSizeOf(v: BlockSizeValue, ref: AnchorSizeRef | null, anchors: Map<string, AnchorRect>, box: string): BlockSizeValue {
  const px = anchorSizePx(ref, anchors, box);
  return px === null ? v : px;
}

function minBlockSizeOf(v: MinBlockSizeValue, ref: AnchorSizeRef | null, anchors: Map<string, AnchorRect>, box: string): MinBlockSizeValue {
  const px = anchorSizePx(ref, anchors, box);
  return px === null ? v : px;
}

function maxInlineSizeOf(v: MaxInlineSizeValue, ref: AnchorSizeRef | null, anchors: Map<string, AnchorRect>, box: string): MaxInlineSizeValue {
  const px = anchorSizePx(ref, anchors, box);
  return px === null ? v : px;
}

function maxBlockSizeOf(v: MaxBlockSizeValue, ref: AnchorSizeRef | null, anchors: Map<string, AnchorRect>, box: string): MaxBlockSizeValue {
  const px = anchorSizePx(ref, anchors, box);
  return px === null ? v : px;
}

/** The box's style with one option's accepted @position-try properties, its anchor-size() functions as px. */
function optionStyle(s: LayoutStyle, o: AnchorOption, anchors: Map<string, AnchorRect>, box: string): LayoutStyle {
  return {
    ...s,
    width: inlineSizeOf(o.width, o.widthAnchor, anchors, box),
    height: blockSizeOf(o.height, o.heightAnchor, anchors, box),
    minWidth: inlineSizeOf(o.minWidth, o.minWidthAnchor, anchors, box),
    minHeight: minBlockSizeOf(o.minHeight, o.minHeightAnchor, anchors, box),
    maxWidth: maxInlineSizeOf(o.maxWidth, o.maxWidthAnchor, anchors, box),
    maxHeight: maxBlockSizeOf(o.maxHeight, o.maxHeightAnchor, anchors, box),
    marginTop: o.marginTop,
    marginRight: o.marginRight,
    marginBottom: o.marginBottom,
    marginLeft: o.marginLeft,
  };
}

/** An inset in px or %, or an anchor() resolved against the modified containing block (anchor_evaluator_impl.cc ResolveAnchorValue). */
function insetOf(ctx: Ctx, v: AnchorOption['top'], edge: AnchorEdge | null, endSide: boolean, regionStart: LU, size: LU, anchors: Map<string, AnchorRect>, cbStart: LU, vertical: boolean, box: string): LU | null {
  if (edge !== null) {
    const r = anchorOf(anchors, edge.anchor, box);
    const at = sub(edgeAt(vertical ? sub(r.y, cbStart) : sub(r.x, cbStart), vertical ? r.height : r.width, edge.fraction), regionStart);
    return endSide ? sub(size, at) : at;
  }
  if (v.kind === 'auto') return null;
  return resolveLength(v, size, ctx.faults);
}

function staticBias(edge: StaticAxis['edge'], reversed: boolean): Bias {
  if (edge === 'center') return 'equal';
  return (edge === 'near') !== reversed ? 'start' : 'end';
}

/** One position option laid out (out_of_flow_layout_part.cc TryCalculateOffset). */
function placeOption(ctx: Ctx, box: LayoutBox, o: AnchorOption, defaultAnchor: string | null, cb: ContainingBlock, staticX: StaticAxis, staticY: StaticAxis, anchors: Map<string, AnchorRect>): Placed {
  const rtl = cb.direction === 'rtl';
  const s = optionStyle(box.style, o, anchors, box.id);
  const def = defaultAnchor === null ? null : anchorOf(anchors, defaultAnchor, box.id);
  // A position area aligns the box whether or not it has a default anchor (absolute_utils.cc ComputeAlignment); its offsets need one.
  const area = o.area;
  const offsetArea = def === null ? null : area;
  // The position area's offsets from the containing block's physical sides (anchor_evaluator_impl.cc 545-641).
  let top = ZERO;
  let bottom = ZERO;
  let left = ZERO;
  let right = ZERO;
  if (offsetArea !== null && def !== null) {
    const rows = areaOffsets(offsetArea.rowStart, offsetArea.rowEnd, sub(def.y, cb.y), add(sub(def.y, cb.y), def.height), cb.height);
    const columns = areaOffsets(offsetArea.columnStart, offsetArea.columnEnd, sub(def.x, cb.x), add(sub(def.x, cb.x), def.width), cb.width);
    top = rows.start;
    bottom = rows.end;
    left = columns.start;
    right = columns.end;
  }
  const regionWidth = max(sub(sub(cb.width, left), right), ZERO);
  const regionHeight = max(sub(sub(cb.height, top), bottom), ZERO);
  // Used self-alignment: the author's anchor-center, else the position area's default (position_area.cc 207-292).
  const xAlign: Align = o.justifySelf === 'anchor-center' ? 'anchor-center' : area !== null ? areaAlign(area.columnStart, area.columnEnd, rtl) : 'normal';
  const yAlign: Align = o.alignSelf === 'anchor-center' ? 'anchor-center' : area !== null ? areaAlign(area.rowStart, area.rowEnd, false) : 'normal';
  // ComputeOutOfFlowInsets: auto insets are 0 beside position-area offsets, and in an axis whose alignment is anchor-center.
  const forceX = offsetArea !== null || xAlign === 'anchor-center';
  const forceY = offsetArea !== null || yAlign === 'anchor-center';
  const zeroIfForced = (v: LU | null, force: boolean): LU | null => (v === null && force ? ZERO : v);
  const leftInset = zeroIfForced(insetOf(ctx, o.left, o.leftAnchor, false, left, regionWidth, anchors, cb.x, false, box.id), forceX);
  const rightInset = zeroIfForced(insetOf(ctx, o.right, o.rightAnchor, true, left, regionWidth, anchors, cb.x, false, box.id), forceX);
  const topInset = zeroIfForced(insetOf(ctx, o.top, o.topAnchor, false, top, regionHeight, anchors, cb.y, true, box.id), forceY);
  const bottomInset = zeroIfForced(insetOf(ctx, o.bottom, o.bottomAnchor, true, top, regionHeight, anchors, cb.y, true, box.id), forceY);
  const center = (start: LU, size: LU, regionStart: LU): LU => sub(edgeAt(start, size, 0.5), regionStart);
  const xCenter = xAlign === 'anchor-center' && def !== null ? center(sub(def.x, cb.x), def.width, left) : null;
  const yCenter = yAlign === 'anchor-center' && def !== null ? center(sub(def.y, cb.y), def.height, top) : null;
  const ml = resolveMarginWith(s.marginLeft, regionWidth, ctx.faults);
  const mr = resolveMarginWith(s.marginRight, regionWidth, ctx.faults);
  const mt = resolveMarginWith(s.marginTop, regionWidth, ctx.faults);
  const mb = resolveMarginWith(s.marginBottom, regionWidth, ctx.faults);
  const xAxis: Axis = {
    size: regionWidth,
    containerStart: rtl ? right : left,
    containerEnd: rtl ? left : right,
    insetStart: rtl ? rightInset : leftInset,
    insetEnd: rtl ? leftInset : rightInset,
    marginStart: rtl ? mr : ml,
    marginEnd: rtl ? ml : mr,
    align: xAlign,
    anchorCenter: xCenter === null ? null : rtl ? sub(regionWidth, xCenter) : xCenter,
    anchorPositioning: offsetArea !== null || xCenter !== null,
    staticOffset: rtl ? sub(add(cb.x, cb.width), staticX.offset) : sub(staticX.offset, cb.x),
    staticEdge: staticBias(staticX.edge, rtl),
  };
  const yAxis: Axis = {
    size: regionHeight,
    containerStart: top,
    containerEnd: bottom,
    insetStart: topInset,
    insetEnd: bottomInset,
    marginStart: mt,
    marginEnd: mb,
    align: yAlign,
    anchorCenter: yCenter,
    anchorPositioning: offsetArea !== null || yCenter !== null,
    staticOffset: sub(staticY.offset, cb.y),
    staticEdge: staticBias(staticY.edge, false),
  };
  const xUnclamped = unclampedImcb(xAxis);
  const yUnclamped = unclampedImcb(yAxis);
  const xm = clampedImcb(xUnclamped, xAxis.size);
  const ym = clampedImcb(yUnclamped, yAxis.size);
  const pad = resolvePaddingWith(s, regionWidth, ctx.faults);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const vbp = sumEdges(bor.top, bor.bottom, pad.top, pad.bottom);

  // Width (absolute_utils.cc ComputeOofInlineDimensions): specified, stretched with normal alignment between two insets, or fit-content.
  const xAvailable = sub(sub(xAxis.size, xm.start), xm.end);
  const xMarginSum = add(xAxis.marginStart.value, xAxis.marginEnd.value);
  const yAvailable = sub(sub(yAxis.size, ym.start), ym.end);
  const xStretch = !xm.hasAutoInset && xAxis.align === 'normal';
  const yStretch = !ym.hasAutoInset && yAxis.align === 'normal';
  const styled: LayoutBox = { ...box, style: s };
  const sizeKeyword = (k: string): boolean => k === 'min-content' || k === 'max-content' || k === 'fit-content' || k === 'stretch';
  if (hasAspectRatio(s) && (sizeKeyword(s.width.kind) || sizeKeyword(s.height.kind))) unsupported('intrinsic-size-keyword', box.id, 'css-sizing-4 §5.1', `an intrinsic size keyword with an aspect-ratio on the anchored ${box.id}`);
  if (s.height.kind === 'stretch') unsupported('intrinsic-size-keyword', box.id, 'css-sizing-4 §3.1', `height: stretch on the anchored ${box.id}`);
  const specified = sizeKeyword(s.width.kind) ? null : resolveInlineLengthWith(lengthWidth(box.id, s.width), regionWidth, ctx.faults);
  let width: LU;
  // css-sizing-3 §3.2 and css-sizing-4 §3.1: min-content, max-content, fit-content against the inset-modified containing block, or stretch.
  if (sizeKeyword(s.width.kind)) {
    const minContent = add(intrinsicContentInlineSize(ctx, styled, 'min'), hbp);
    const maxContent = add(intrinsicContentInlineSize(ctx, styled, 'max'), hbp);
    const available = sub(xAvailable, xMarginSum);
    width = s.width.kind === 'stretch' ? available : s.width.kind === 'min-content' ? minContent : s.width.kind === 'max-content' ? maxContent : min(maxContent, max(minContent, available));
  } else if (specified !== null) width = borderBoxFromSpecified(specified, hbp, s.boxSizing);
  // css-sizing-4 §5.1 (ratio.ts): an auto width may come through the ratio from a height or a stretched block size.
  else if (hasAspectRatio(s)) width = ratioAbsoluteInlineSize(ctx, styled, regionWidth, xStretch ? sub(xAvailable, xMarginSum) : null, sub(xAvailable, xMarginSum), yStretch ? sub(yAvailable, add(mt.value, mb.value)) : null);
  else if (xStretch) width = sub(xAvailable, xMarginSum);
  else {
    const minContent = add(intrinsicContentInlineSize(ctx, styled, 'min'), hbp);
    const maxContent = add(intrinsicContentInlineSize(ctx, styled, 'max'), hbp);
    width = min(maxContent, max(minContent, sub(xAvailable, xMarginSum)));
  }
  width = max(constrain(width, inlineMinMaxOf(box.id, s, regionWidth, hbp, ctx.faults)), hbp);

  // Height (ComputeOofBlockDimensions): auto stretches between two insets with normal alignment; otherwise the contents decide, a
  // min-content, max-content or fit-content height as auto does.
  let forced: LU | null = null;
  if (s.height.kind === 'auto' && yStretch && !ratioSetsAbsoluteHeight(styled, xStretch)) {
    forced = max(constrain(sub(yAvailable, add(mt.value, mb.value)), blockMinMaxWith(styled, { kind: 'definite', value: regionHeight }, vbp, ctx.faults, NO_STRETCH)), vbp);
  }
  const contentHeight = s.height.kind === 'min-content' || s.height.kind === 'max-content' || s.height.kind === 'fit-content';
  const r = layoutContents(ctx, contentHeight ? { ...styled, style: { ...s, height: { kind: 'auto' } } } : styled, {
    cbInline: regionWidth,
    borderBoxWidth: width,
    forcedBorderBoxHeight: forced,
    forcedHeightDefinite: true,
    heightBasis: { kind: 'definite', value: regionHeight },
    formattingContextRoot: true,
    bfcLineOffset: ZERO,
    blockStretch: NO_STRETCH,
  });
  const height = r.frag.height;

  const xMargins = margins(xAxis, xm, width, true);
  const yMargins = margins(yAxis, ym, height, false);
  const u = xMargins.applied ? add(xm.start, xMargins.start) : insetStartOf(xAxis, xm, xMargins.start, xMargins.end, width);
  const v = yMargins.applied ? add(ym.start, yMargins.start) : insetStartOf(yAxis, ym, yMargins.start, yMargins.end, height);
  // CalculateNonOverflowingRangeInOneAxis: the margin box inside the unclamped inset-modified containing block, in each axis.
  const overflowsAxis = (m: Imcb, size: LU, start: LU, marginStart: LU, marginEnd: LU, extent: LU): boolean => sub(start, marginStart) < m.start || sub(size, m.end) < add(add(start, extent), marginEnd);
  const overflows = overflowsAxis(xUnclamped, xAxis.size, u, xMargins.start, xMargins.end, width) || overflowsAxis(yUnclamped, yAxis.size, v, yMargins.start, yMargins.end, height);
  const x = rtl ? sub(add(cb.x, add(left, regionWidth)), add(u, width)) : add(cb.x, add(left, u));
  const y = add(cb.y, add(top, v));
  return {
    result: { x, y, frag: r.frag },
    overflows,
    imcbWidth: sub(sub(xAxis.size, xUnclamped.start), xUnclamped.end),
    imcbHeight: sub(sub(yAxis.size, yUnclamped.start), yUnclamped.end),
  };
}

/** Whether every anchor box a style reads (its default anchor, its anchor() and anchor-size() functions) is laid out. */
export function anchorsPlaced(s: LayoutStyle, anchors: Map<string, AnchorRect>): boolean {
  const a = s.anchor;
  if (a === null) return true;
  if (a.anchor !== null && !anchors.has(a.anchor)) return false;
  for (const o of a.options) {
    for (const e of [o.topAnchor, o.rightAnchor, o.bottomAnchor, o.leftAnchor]) if (e !== null && !anchors.has(e.anchor)) return false;
    for (const r of [o.widthAnchor, o.heightAnchor, o.minWidthAnchor, o.minHeightAnchor, o.maxWidthAnchor, o.maxHeightAnchor]) if (r !== null && !anchors.has(r.anchor)) return false;
  }
  return true;
}

/** Chrome's limit on the options tried after the base style (out_of_flow_layout_part.cc kMaxTryAttempts, 5 + 1). */
const MAX_TRY_ATTEMPTS = 6;

/**
 * css-anchor-position-1 §6.5: the first position option whose margin box stays inside its inset-modified containing block, in
 * position-try-order (a stable sort by the inset-modified containing block's size, largest first), else the base style.
 */
export function layoutAnchored(ctx: Ctx, box: LayoutBox, cb: ContainingBlock, staticX: StaticAxis, staticY: StaticAxis, anchors: Map<string, AnchorRect>): AbsoluteResult {
  const a = box.style.anchor;
  if (a === null) throw new Error(`${box.id} is not anchored`);
  const options = a.options;
  const base = placeOption(ctx, box, options[0] as AnchorOption, a.anchor, cb, staticX, staticY, anchors);
  if (options.length === 1) return base.result;
  const fits: Placed[] = [];
  const tried = options.length < MAX_TRY_ATTEMPTS ? options.length : MAX_TRY_ATTEMPTS;
  for (let i = 0; i < tried; i++) {
    const p = i === 0 ? base : placeOption(ctx, box, options[i] as AnchorOption, a.anchor, cb, staticX, staticY, anchors);
    if (p.overflows) continue;
    if (a.order === 'normal') return p.result;
    fits.push(p);
  }
  if (fits.length === 0) return base.result;
  let best = fits[0] as Placed;
  for (const p of fits) {
    const size = a.order === 'most-width' ? p.imcbWidth : p.imcbHeight;
    const bestSize = a.order === 'most-width' ? best.imcbWidth : best.imcbHeight;
    if (size > bestSize) best = p;
  }
  return best.result;
}
