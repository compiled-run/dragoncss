// text-overflow: ellipsis (css-overflow-4 §3.1), ported from Blink's LineTruncator (line_truncator.cc, BSD; Chrome 145): an
// overflowing line of a block container whose overflow is not visible ends in an ellipsis shaped in the line's font. The text it
// cuts keeps its layout (a hidden fragment), the cut text is a second fragment, and the block's size does not change. In an rtl
// line the ellipsis goes on the left of the text it follows, and that text is cut from its logical start (inline.ts lays out the
// text of an rtl paragraph as one left-to-right run, checkRtlText).
import type { TextFont } from './input.ts';
import type { Ctx } from './block.ts';
import type { ShapeItem, ShapeResult } from './shaping.ts';
import { subView, viewSnappedWidth, wholeView } from './shaping.ts';
import { unsupported } from './unsupported.ts';
import type { LU } from './units.ts';
import { add, floatAdd, inlineToFloat, sub, toFloat, ZERO } from './units.ts';

/** One text child of the line, in visual order: code points [start, end) of text (its trailing hanging spaces left out), at x from the line start. */
export type TruncSource = { readonly text: string; readonly font: TextFont; readonly start: number; readonly end: number; readonly x: LU; readonly width: LU };

/**
 * What the truncator decided. Per child: the code points [paintStart, paintEnd) it paints (both its start when hidden), whether
 * it gained a truncated fragment, and that fragment's x and inline size. ellipsized is the child the ellipsis follows, or -1 when
 * no ellipsis fits.
 */
export type Truncation = {
  readonly paintStarts: readonly number[];
  readonly paintEnds: readonly number[];
  readonly truncated: readonly boolean[];
  readonly truncatedXs: readonly LU[];
  readonly truncatedWidths: readonly LU[];
  readonly ellipsized: number;
  readonly text: string;
  readonly x: LU;
  readonly width: LU;
  readonly font: TextFont;
};

/** The ellipsis text and SnappedWidth (LineTruncator::SetupEllipsis): U+2026 when the font maps it, else "...". */
export type EllipsisRun = { readonly text: string; readonly width: LU };

export function ellipsisOf(ctx: Ctx, nodeId: string, font: TextFont): EllipsisRun {
  const one = ctx.measurer.measure('…', font);
  if (one.ok) return { text: '…', width: one.measure.width };
  if (one.code !== 'text-glyph') unsupported('text-glyph', nodeId, 'css-overflow-4 §3.1', one.reason);
  // Planted fault noDotsFallback: a single dot instead of three.
  const dots = ctx.faults.noDotsFallback ? '.' : '...';
  const m = ctx.measurer.measure(dots, font);
  if (!m.ok) return unsupported('text-glyph', nodeId, 'css-overflow-4 §3.1', m.reason);
  return { text: dots, width: m.measure.width };
}

/** Code points [start, end) of text. */
function codePoints(text: string, start: number, end: number): string {
  let out = '';
  let k = 0;
  for (const ch of text) {
    if (k >= start && k < end) out += ch;
    k++;
  }
  return out;
}

type Fit = { readonly count: number; readonly width: LU };

/**
 * ShapeResult::OffsetToFit (shape_result.cc, left to right, without breaking glyphs): how many code points from start fit in
 * target, keeping a cluster only when its float end is at most target; and the truncated text's SnappedWidth. Font-data text
 * (Ahem) measures each prefix as its own item, whose SnappedWidth is at most target exactly when its float width is.
 */
function offsetToFit(ctx: Ctx, nodeId: string, s: TruncSource, shaped: boolean, target: LU): Fit {
  const length = s.end - s.start;
  if (target <= 0) return { count: 0, width: ZERO };
  if (!shaped) {
    let best: Fit = { count: 0, width: ZERO };
    for (let k = 1; k <= length; k++) {
      const m = ctx.measurer.measure(codePoints(s.text, s.start, s.start + k), s.font);
      if (!m.ok) return unsupported('text-glyph', nodeId, 'css-overflow-4 §3.1', m.reason);
      if (m.measure.width > target) break;
      best = { count: k, width: m.measure.width };
    }
    return best;
  }
  const item = ctx.measurer.shaped(s.text, s.font);
  if (!item.ok) return unsupported('text-glyph', nodeId, 'css-overflow-4 §3.1', item.reason);
  const result: ShapeResult = item.result;
  // The float end of each cluster that starts in [start, end), in visual (logical, ltr) order.
  const limit = toFloat(target);
  let pen = 0;
  let count = 0;
  let clusterStart = -1;
  let clusterEnd = 0;
  for (const run of result.runs) {
    for (const g of run.glyphs) {
      const at = run.start + g.ci;
      if (at < s.start || at >= s.end) continue;
      if (at !== clusterStart) {
        // A new cluster: the previous one is kept when it ends within target.
        if (clusterStart >= 0) {
          if (clusterEnd > limit) return fitOf(item.item, result, s, count);
          count = at - s.start;
        }
        clusterStart = at;
      }
      pen = floatAdd(pen, inlineToFloat(g.advance));
      clusterEnd = pen;
    }
  }
  if (clusterStart >= 0 && clusterEnd <= limit) count = length;
  return fitOf(item.item, result, s, count);
}

/**
 * ShapeResult::OffsetToFit(Width() - space, rtl) on a left-to-right child of an rtl line (line_truncator.cc TruncateChild), which
 * TruncateText keeps from that offset to its end: count is how many code points from start are cut, the first cluster boundary
 * whose float x is at least the child's float width less space (OffsetForPosition: a target inside a cluster rounds to its end);
 * width is the SnappedWidth of what is kept. Font-data text (Ahem) measures each suffix as its own item instead.
 */
function offsetToFitFromEnd(ctx: Ctx, nodeId: string, s: TruncSource, shaped: boolean, space: LU): Fit {
  const length = s.end - s.start;
  if (!shaped) {
    for (let k = 0; k < length; k++) {
      const m = ctx.measurer.measure(codePoints(s.text, s.start + k, s.end), s.font);
      if (!m.ok) return unsupported('text-glyph', nodeId, 'css-overflow-4 §3.1', m.reason);
      if (m.measure.width <= space) return { count: k, width: m.measure.width };
    }
    return { count: length, width: ZERO };
  }
  const item = ctx.measurer.shaped(s.text, s.font);
  if (!item.ok) return unsupported('text-glyph', nodeId, 'css-overflow-4 §3.1', item.reason);
  const result: ShapeResult = item.result;
  // Each cluster's start offset and float x in [start, end), in visual (logical, ltr) order; pen ends at the float width.
  const starts: number[] = [];
  const xs: number[] = [];
  let pen = 0;
  let clusterStart = -1;
  for (const run of result.runs) {
    for (const g of run.glyphs) {
      const at = run.start + g.ci;
      if (at < s.start || at >= s.end) continue;
      if (at !== clusterStart) {
        starts.push(at - s.start);
        xs.push(pen);
        clusterStart = at;
      }
      pen = floatAdd(pen, inlineToFloat(g.advance));
    }
  }
  const target = floatAdd(pen, -toFloat(space));
  let count = length;
  if (target <= 0) count = 0;
  else {
    for (let c = 0; c < starts.length; c++) {
      if ((xs[c] as number) >= target) {
        count = starts[c] as number;
        break;
      }
    }
  }
  return { count, width: count === length ? ZERO : viewSnappedWidth(item.item, subView(wholeView(result), s.start + count, s.end)) };
}

function fitOf(item: ShapeItem, result: ShapeResult, s: TruncSource, count: number): Fit {
  if (count === 0) return { count: 0, width: ZERO };
  return { count, width: viewSnappedWidth(item, subView(wholeView(result), s.start, s.start + count)) };
}

/** The SnappedWidth of code points [start, start + count) of a child: the inline size of its truncated fragment. */
function truncatedWidth(ctx: Ctx, nodeId: string, s: TruncSource, shaped: boolean, count: number): LU {
  if (count === s.end - s.start) return s.width;
  if (!shaped) {
    const m = ctx.measurer.measure(codePoints(s.text, s.start, s.start + count), s.font);
    if (!m.ok) return unsupported('text-glyph', nodeId, 'css-overflow-4 §3.1', m.reason);
    return m.measure.width;
  }
  const item = ctx.measurer.shaped(s.text, s.font);
  if (!item.ok) return unsupported('text-glyph', nodeId, 'css-overflow-4 §3.1', item.reason);
  return viewSnappedWidth(item.item, subView(wholeView(item.result), s.start, s.start + count));
}

/** The SnappedWidth of code points [start + count, end) of a child: the inline size of its truncated fragment in an rtl line. */
function keptEndWidth(ctx: Ctx, nodeId: string, s: TruncSource, shaped: boolean, count: number): LU {
  if (count === 0) return s.width;
  if (!shaped) {
    const m = ctx.measurer.measure(codePoints(s.text, s.start + count, s.end), s.font);
    if (!m.ok) return unsupported('text-glyph', nodeId, 'css-overflow-4 §3.1', m.reason);
    return m.measure.width;
  }
  const item = ctx.measurer.shaped(s.text, s.font);
  if (!item.ok) return unsupported('text-glyph', nodeId, 'css-overflow-4 §3.1', item.reason);
  return viewSnappedWidth(item.item, subView(wholeView(item.result), s.start + count, s.end));
}

/**
 * LineTruncator::TruncateLine for a line of text children in visual order (inline boxes are culled placeholders, which
 * EllipsizeChild skips). From the line's end child to its start child (the last to the first in ltr, the first to the last in
 * rtl): a child beyond the content box is hidden; a child that fits with the ellipsis after it (before it in rtl) takes the
 * ellipsis; one that fits partly is cut at OffsetToFit and takes it; the start child always keeps at least one character (css-ui:
 * the first character of a line is clipped, not ellipsed). In rtl a child's space runs from the content box's left edge to the
 * child's right edge, measured from lineEnd, the right edge of the line's content (EllipsizeChild's line_width less its
 * offset), and a cut child keeps its end, moved to its right edge (TruncateText, TruncateLine).
 */
export function truncateLine(ctx: Ctx, nodeId: string, available: LU, lineFont: TextFont, children: readonly TruncSource[], shaped: boolean, rtl: boolean, lineEnd: LU): Truncation {
  const last = children[children.length - 1];
  // Planted fault ellipsisInTextFont: the ellipsis takes the last text's font instead of the line's.
  const font = ctx.faults.ellipsisInTextFont && last !== undefined ? last.font : lineFont;
  const e = ellipsisOf(ctx, nodeId, font);
  // Every child after the ellipsized one is hidden (HideChild); without an ellipsis, every child but the first.
  // count is how many code points the cut child keeps from its start in ltr, and how many it cuts from its start in rtl.
  let ellipsized = -1;
  let count = -1;
  let cutWidth = ZERO;
  let x = ZERO;
  const startChild = rtl ? children.length - 1 : 0;
  for (let k = 0; k < children.length; k++) {
    const i = rtl ? k : children.length - 1 - k;
    const c = children[i] as TruncSource;
    const first = i === startChild;
    let space = rtl ? sub(available, sub(lineEnd, add(c.x, c.width))) : sub(available, c.x);
    if (space <= 0) continue;
    space = sub(space, e.width);
    if (space >= c.width) {
      ellipsized = i;
      x = rtl ? sub(c.x, e.width) : add(c.x, c.width);
      break;
    }
    // TruncateChild: not enough space for any of this child unless it is the first.
    if (space <= 0 && !first) continue;
    const length = c.end - c.start;
    const fit = rtl ? offsetToFitFromEnd(ctx, nodeId, c, shaped, space) : offsetToFit(ctx, nodeId, c, shaped, space);
    let n = fit.count;
    if (n === 0 || n === length) {
      if (!first) continue;
      n = n === 0 ? 1 : length - 1;
    }
    ellipsized = i;
    count = n;
    if (rtl) {
      cutWidth = n === fit.count ? fit.width : keptEndWidth(ctx, nodeId, c, shaped, n);
      x = sub(sub(add(c.x, c.width), cutWidth), e.width);
    } else {
      cutWidth = n === fit.count ? fit.width : truncatedWidth(ctx, nodeId, c, shaped, n);
      x = add(c.x, cutWidth);
    }
    break;
  }
  const paintStarts: number[] = [];
  const paintEnds: number[] = [];
  const truncated: boolean[] = [];
  const truncatedXs: LU[] = [];
  const truncatedWidths: LU[] = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i] as TruncSource;
    let hidden = ellipsized < 0 ? i > 0 : i > ellipsized;
    if (rtl) hidden = ellipsized < 0 ? i < startChild : i < ellipsized;
    const cut = i === ellipsized && count >= 0;
    if (hidden) {
      paintStarts.push(c.start);
      paintEnds.push(c.start);
    } else if (cut && rtl) {
      paintStarts.push(c.start + count);
      paintEnds.push(c.end);
    } else {
      paintStarts.push(c.start);
      paintEnds.push(cut ? c.start + count : c.end);
    }
    truncated.push(cut);
    truncatedXs.push(cut && rtl ? sub(add(c.x, c.width), cutWidth) : c.x);
    truncatedWidths.push(cut ? cutWidth : ZERO);
  }
  return { paintStarts, paintEnds, truncated, truncatedXs, truncatedWidths, ellipsized, text: e.text, x, width: e.width, font };
}
