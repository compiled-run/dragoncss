// Positioned boxes: relative offsets (CSS2 §9.4.3) and absolutely positioned boxes (CSS2 §10.3.7, §10.6.4, css-position-3 §4),
// placed in their containing block once it is laid out. Measured against Chrome 145 in notes/T037-slice-4b.md.
import type { Direction, InsetValue, LayoutBox } from './input.ts';
import type { LU } from './units.ts';
import { add, divInt, max, min, sub, ZERO } from './units.ts';
import type { Frag, HeightBasis, MarginResolved, StaticAxis, StaticEdge } from './box.ts';
import {
  blockMinMaxWith,
  borderBoxFromSpecified,
  constrain,
  hasPercent,
  inlineMinMaxWith,
  resolveBorder,
  resolveInlineLengthWith,
  resolveLength,
  resolveLengthOrNull,
  resolveMarginWith,
  resolvePaddingWith,
  sumEdges,
} from './box.ts';
import type { Ctx, EngineFaults } from './block.ts';
import { layoutContents, NO_ENGINE_FAULTS } from './block.ts';
import { intrinsicContentInlineSize } from './intrinsic.ts';
import { hasAspectRatio, ratioAbsoluteInlineSize, ratioSetsAbsoluteHeight } from './ratio.ts';
import { unsupported } from './unsupported.ts';

/** CSS2 §9.3.1: an absolutely positioned box leaves the flow (planted fault absposInFlow lays it out as static). */
export function isOutOfFlow(ctx: Ctx, box: LayoutBox): boolean {
  return box.style.position === 'absolute' && !ctx.faults.absposInFlow;
}

/**
 * The in-flow children of a box. An absolutely positioned box beside text would sit in the text's inline formatting context
 * (CSS2 §9.2.1.1: it does not end the run), which Dragon does not lay out, so a box holding both is refused.
 */
export function checkOutOfFlowSiblings(ctx: Ctx, box: LayoutBox): void {
  const oof = box.children.find((k): k is LayoutBox => k.kind === 'box' && isOutOfFlow(ctx, k));
  if (oof === undefined) return;
  if (box.children.some((k) => k.kind === 'text' || k.boxType === 'anonymous')) {
    unsupported('abspos-in-inline', oof.id, 'CSS2 §9.2.1.1, §10.3.7', `absolutely positioned ${oof.id} beside text in ${box.id} would take a static position in its inline formatting context`);
  }
}

function inset(v: InsetValue, basis: LU, faults: EngineFaults): LU | null {
  if (v.kind === 'auto') return null;
  return resolveLength(v, basis, faults);
}

// CSS2 §9.4.3 and §10.5: a vertical percentage offset against a containing block whose height is not definite behaves as auto.
function blockInset(box: LayoutBox, v: InsetValue, basis: HeightBasis, faults: EngineFaults): LU | null {
  if (v.kind === 'auto') return null;
  if (!hasPercent(v)) return resolveLength(v, ZERO, faults);
  if (basis.kind === 'definite') return resolveLength(v, basis.value, faults);
  if (basis.kind === 'flex-dependent') unsupported('percent-height-flex', box.id, 'css-flexbox-1 §9.8', 'percentage top or bottom against a flexed or stretched size that is not definite');
  return resolveLengthOrNull(v, null, faults);
}

/** A relative offset in LU. */
export type RelativeOffset = { readonly dx: LU; readonly dy: LU };

/**
 * CSS2 §9.4.3: the offset of a relatively positioned box from its in-flow position. top wins over bottom; left wins over right
 * when the containing block is ltr and right wins when it is rtl; one auto side is minus the other; both auto is zero.
 */
export function relativeOffset(box: LayoutBox, cbInline: LU, cbBlock: HeightBasis, cbDirection: Direction): RelativeOffset {
  return relativeOffsetWith(box, cbInline, cbBlock, cbDirection, NO_ENGINE_FAULTS);
}

/** relativeOffset with the planted engine faults the layout runs with. */
export function relativeOffsetWith(box: LayoutBox, cbInline: LU, cbBlock: HeightBasis, cbDirection: Direction, faults: EngineFaults): RelativeOffset {
  if (box.style.position !== 'relative') return { dx: ZERO, dy: ZERO };
  const s = box.style;
  const left = inset(s.left, cbInline, faults);
  const right = inset(s.right, cbInline, faults);
  const top = blockInset(box, s.top, cbBlock, faults);
  const bottom = blockInset(box, s.bottom, cbBlock, faults);
  let dx = ZERO;
  if (left !== null && (right === null || cbDirection === 'ltr')) dx = left;
  else if (right !== null) dx = sub(ZERO, right);
  let dy = ZERO;
  if (top !== null) dy = top;
  else if (bottom !== null) dy = sub(ZERO, bottom);
  return { dx, dy };
}

/** The padding box of a containing block in absolute LU, and its direction (CSS2 §10.1). */
export type ContainingBlock = { readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU; readonly direction: Direction };

/** A static position edge in the containing block's writing mode. */
type LogicalEdge = 'start' | 'center' | 'end';

/** A range along one axis of the containing block. */
type StaticRange = { readonly start: LU; readonly size: LU };

/**
 * css-position-3 §4.1 with both insets auto: the inset-modified containing block from the static position. A start edge gives
 * [static, size], an end edge [0, static], a centre the largest range centred on it (Blink: twice the smaller distance).
 */
function staticRange(s: LU, edge: LogicalEdge, size: LU): StaticRange {
  if (edge === 'start') return { start: s, size: sub(size, s) };
  if (edge === 'end') return { start: ZERO, size: s };
  const half = min(s, sub(size, s));
  return { start: sub(s, half), size: add(half, half) };
}

type AxisIn = {
  /** Containing block size along the axis. */
  readonly size: LU;
  readonly insetStart: LU | null;
  readonly insetEnd: LU | null;
  readonly marginStart: MarginResolved;
  readonly marginEnd: MarginResolved;
  readonly staticOffset: LU;
  readonly staticEdge: LogicalEdge;
  /** CSS2 §10.3.7: two auto inline margins never go negative on the start side; §10.6.4 has no such rule for block margins. */
  readonly clampStartMargin: boolean;
};

/** The offset of the border box from the containing block's start edge along one axis, for a border-box size. */
function axisOffset(a: AxisIn, size: LU): LU {
  const ms = a.marginStart.value;
  const me = a.marginEnd.value;
  if (a.insetStart === null && a.insetEnd === null) {
    // Auto margins are zero here; the box aligns to its static position (start, end, or centred with Blink LayoutUnit / 2).
    const r = staticRange(a.staticOffset, a.staticEdge, a.size);
    if (a.staticEdge === 'start') return add(r.start, ms);
    if (a.staticEdge === 'end') return sub(sub(add(r.start, r.size), me), size);
    return add(add(r.start, divInt(sub(r.size, add(add(ms, size), me)), 2)), ms);
  }
  if (a.insetEnd === null) return add(a.insetStart as LU, ms);
  if (a.insetStart === null) return sub(sub(sub(a.size, a.insetEnd), me), size);
  const free = sub(sub(sub(sub(sub(a.size, a.insetStart), a.insetEnd), size), ms), me);
  let start = ms;
  if (a.marginStart.auto && a.marginEnd.auto) start = a.clampStartMargin && free < 0 ? ZERO : divInt(free, 2);
  else if (a.marginStart.auto) start = free;
  // Over-constrained with no auto margin: the end inset is ignored.
  return add(a.insetStart, start);
}

/** The space the box's margin box may take when it is not stretched: the inset-modified containing block. */
function axisAvailable(a: AxisIn): LU {
  if (a.insetStart === null && a.insetEnd === null) return staticRange(a.staticOffset, a.staticEdge, a.size).size;
  return sub(sub(a.size, a.insetStart === null ? ZERO : a.insetStart), a.insetEnd === null ? ZERO : a.insetEnd);
}

function logicalEdge(edge: StaticEdge, reversed: boolean): LogicalEdge {
  if (edge === 'center') return 'center';
  return (edge === 'near') !== reversed ? 'start' : 'end';
}

/** An absolutely positioned border box in absolute LU, with its fragment. */
export type AbsoluteResult = { readonly x: LU; readonly y: LU; readonly frag: Frag };

/**
 * CSS2 §10.3.7 and §10.6.4 with css-position-3 §4: lays out an absolutely positioned box in its containing block (padding box),
 * given its static position in absolute LU. Inline sizes and offsets are solved in the containing block's direction; auto
 * widths shrink to fit the inset-modified containing block, auto heights with both insets set stretch (and are definite).
 * Returns the border box in absolute LU and its fragment.
 */
export function layoutAbsolute(ctx: Ctx, box: LayoutBox, cb: ContainingBlock, staticX: StaticAxis, staticY: StaticAxis): AbsoluteResult {
  const s = box.style;
  const rtl = cb.direction === 'rtl';
  const pad = resolvePaddingWith(s, cb.width, ctx.faults);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const vbp = sumEdges(bor.top, bor.bottom, pad.top, pad.bottom);
  const ml = resolveMarginWith(s.marginLeft, cb.width, ctx.faults);
  const mr = resolveMarginWith(s.marginRight, cb.width, ctx.faults);
  const mt = resolveMarginWith(s.marginTop, cb.width, ctx.faults);
  const mb = resolveMarginWith(s.marginBottom, cb.width, ctx.faults);
  const left = inset(s.left, cb.width, ctx.faults);
  const right = inset(s.right, cb.width, ctx.faults);
  const inlineAxis: AxisIn = {
    size: cb.width,
    insetStart: rtl ? right : left,
    insetEnd: rtl ? left : right,
    marginStart: rtl ? mr : ml,
    marginEnd: rtl ? ml : mr,
    staticOffset: rtl ? sub(add(cb.x, cb.width), staticX.offset) : sub(staticX.offset, cb.x),
    staticEdge: logicalEdge(staticX.edge, rtl),
    clampStartMargin: true,
  };
  const blockAxis: AxisIn = {
    size: cb.height,
    insetStart: inset(s.top, cb.height, ctx.faults),
    insetEnd: inset(s.bottom, cb.height, ctx.faults),
    marginStart: mt,
    marginEnd: mb,
    staticOffset: sub(staticY.offset, cb.y),
    staticEdge: logicalEdge(staticY.edge, false),
    clampStartMargin: false,
  };

  // Width: specified, stretched between two insets, or shrink-to-fit (min(max(min-content, available), max-content)); then min/max.
  const margins = add(inlineAxis.marginStart.value, inlineAxis.marginEnd.value);
  const specified = resolveInlineLengthWith(s.width, cb.width, ctx.faults);
  let width: LU;
  const bothBlockInsets = blockAxis.insetStart !== null && blockAxis.insetEnd !== null;
  // css-sizing-4 §5.1 (ratio.ts): an auto width may come through the ratio from a height or a stretched block size.
  if (specified === null && hasAspectRatio(s)) width = ratioAbsoluteInlineSize(ctx, box, cb.width, inlineAxis.insetStart !== null && inlineAxis.insetEnd !== null ? sub(axisAvailable(inlineAxis), margins) : null, sub(axisAvailable(inlineAxis), margins), bothBlockInsets ? sub(axisAvailable(blockAxis), add(mt.value, mb.value)) : null);
  else if (specified !== null) width = borderBoxFromSpecified(specified, hbp, s.boxSizing);
  else if (inlineAxis.insetStart !== null && inlineAxis.insetEnd !== null) width = sub(axisAvailable(inlineAxis), margins);
  else {
    const minContent = add(intrinsicContentInlineSize(ctx, box, 'min'), hbp);
    const maxContent = add(intrinsicContentInlineSize(ctx, box, 'max'), hbp);
    width = min(maxContent, max(minContent, sub(axisAvailable(inlineAxis), margins)));
  }
  width = max(constrain(width, inlineMinMaxWith(s, cb.width, hbp, ctx.faults)), hbp);

  // Height: auto with both insets set stretches; otherwise the contents decide (layoutContents applies height and min/max).
  const heightBasis: HeightBasis = { kind: 'definite', value: cb.height };
  let forced: LU | null = null;
  if (s.height.kind === 'auto' && bothBlockInsets && !ratioSetsAbsoluteHeight(box)) {
    forced = max(constrain(sub(axisAvailable(blockAxis), add(mt.value, mb.value)), blockMinMaxWith(box, heightBasis, vbp, ctx.faults)), vbp);
  }
  const r = layoutContents(ctx, box, {
    cbInline: cb.width,
    borderBoxWidth: width,
    forcedBorderBoxHeight: forced,
    forcedHeightDefinite: true,
    heightBasis,
    formattingContextRoot: true,
    bfcLineOffset: ZERO,
  });
  const u = axisOffset(inlineAxis, width);
  const v = axisOffset(blockAxis, r.frag.height);
  return { x: rtl ? sub(add(cb.x, cb.width), add(u, width)) : add(cb.x, u), y: add(cb.y, v), frag: r.frag };
}
