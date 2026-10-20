// GEN-c (notes/T151-gen-spec.md R14): the outside list marker. Its size and inline offset port Blink list_marker.cc
// (WidthOfSymbol, InlineMarginsForOutside) and unpositioned_list_marker.cc (InlineOffset); block.ts places it against the content's
// first baseline (BlockLayoutAlgorithm PositionOrPropagateListMarker). The engine lays out in zoomed px, so the ascent is rounded
// and the 7 and 1 px paddings are taken in device px, as Chrome does (docs/research/gen-spike/blink-notes.md R14).
import type { Direction, ListMarker } from './input.ts';
import type { LU } from './units.ts';
import { add, floorToInt, fromWholePx, intDiv, neg, snapEdge, sub, ZERO } from './units.ts';
import type { Ctx } from './block.ts';
import { fontMetricsOf, fontOf, metricsOf } from './inline.ts';
import { unsupported } from './unsupported.ts';

/** list_marker.cc kCMarkerPaddingPx: the gap between a symbol marker and the list item's border box. */
export const MARKER_PADDING_PX = 7;

/**
 * A text marker's text fragment in its marker box, as a text leaf's piece on its line: at x 0, the marker's width, its top the line's
 * baseline less the font's ascent and its height the font's ascent plus descent. id is "<list item>::marker:text0".
 */
export type MarkerText = { readonly id: string; readonly top: LU; readonly height: LU };

/** A laid-out marker box: its inline-block size and its baseline from its top (its own line's ascent with half-leading). */
export type MarkerBox = { readonly id: string; readonly width: LU; readonly height: LU; readonly ascent: LU; readonly marginStart: LU; readonly text: MarkerText | null };

/** The id of a text marker's text fragment ("<list item>::marker:text0"), and of its one line ("...:text0:line0"). */
export function markerTextId(markerId: string): string {
  return `${markerId}:text0`;
}

/** list_marker.cc WidthOfSymbol: (ascent * 2 / 3 + 1) / 2 + 2 in int arithmetic on the rounded ascent; 0 at a zero font size. */
export function symbolWidthPx(ascentPx: number, fontSize: number): number {
  if (fontSize === 0) return 0;
  return intDiv(intDiv(ascentPx * 2, 3) + 1, 2) + 2;
}

/** list_marker.cc InlineMarginsForOutside: a symbol's start margin, -(ascent * 2 / 3) - 7 - 1, in whole px. */
export function symbolMarginStartPx(ascentPx: number): number {
  return -intDiv(ascentPx * 2, 3) - MARKER_PADDING_PX - 1;
}

/** The marker's box: a symbol's width from the font's ascent, a text's its measured text (trailing space included). */
export function layoutMarker(ctx: Ctx, m: ListMarker): MarkerBox {
  const line = metricsOf(ctx, m.id, m.font, m.lineHeight, false);
  const height = add(line.above, line.below);
  if (m.kind === 'symbol') {
    const ascentPx = floorToInt(fontMetricsOf(ctx, m.id, m.font).ascent);
    return { id: m.id, width: fromWholePx(symbolWidthPx(ascentPx, m.font.size)), height, ascent: line.above, marginStart: fromWholePx(symbolMarginStartPx(ascentPx)), text: null };
  }
  const text = m.text === null ? '' : m.text;
  const r = ctx.measurer.measure(text, fontOf(m.font));
  if (!r.ok) {
    if (r.code === 'text-script') unsupported('text-script', m.id, 'notes/T056-txt1a-spec.md R4', r.reason);
    unsupported('text-glyph', m.id, 'css-fonts-4 §5', r.reason);
  }
  const font = fontMetricsOf(ctx, m.id, m.font);
  const own: MarkerText = { id: markerTextId(m.id), top: sub(line.above, font.ascent), height: add(font.ascent, font.descent) };
  return { id: m.id, width: r.measure.width, height, ascent: line.above, marginStart: neg(r.measure.width), text: own };
}

/**
 * unpositioned_list_marker.cc InlineOffset: the marker's x from the list item's border-box left. ltr puts its start margin before
 * the border-box start; rtl mirrors it past the border-box end.
 */
export function markerX(marker: MarkerBox, borderBoxWidth: LU, direction: Direction): LU {
  if (direction === 'ltr') return marker.marginStart;
  return sub(sub(borderBoxWidth, marker.marginStart), marker.width);
}

/** A marker's y, and how far the content moves down so the two baselines align. */
export type MarkerAlignment = { readonly y: LU; readonly push: LU };

/** A marker's y for content whose first baseline is at baseline: their baselines align, and the push the content needs below it. */
export function alignMarker(marker: MarkerBox, contentTop: LU, baseline: LU): MarkerAlignment {
  const adjust = sub(baseline, add(contentTop, marker.ascent));
  if (adjust >= ZERO) return { y: add(contentTop, adjust), push: ZERO };
  return { y: contentTop, push: neg(adjust) };
}

/** A symbol's paint rect in whole device px from the root: left, top, right, bottom (empty at a zero side). */
export type SymbolRect = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/**
 * text_fragment_painter.cc PaintSymbol: list_marker.cc RelativeSymbolMarkerRect (x 1, y 3 * (a - a * 2 / 3) / 2, side
 * (a * 2 / 3 + 1) / 2 in int arithmetic on the rounded ascent a) moved by the marker text's origin and pixel-snapped. The marker box
 * is at (x, y) in LU from the root; its text sits on the box's baseline, so the text top is the baseline less the font's ascent.
 */
export function symbolPaintRect(ctx: Ctx, m: ListMarker, x: LU, y: LU): SymbolRect {
  const font = fontMetricsOf(ctx, m.id, m.font);
  const line = metricsOf(ctx, m.id, m.font, m.lineHeight, false);
  const a = floorToInt(font.ascent);
  const third = intDiv(a * 2, 3);
  const side = intDiv(third + 1, 2);
  const textTop = sub(add(y, line.above), font.ascent);
  const top = add(textTop, fromWholePx(intDiv(3 * (a - third), 2)));
  const left = add(x, fromWholePx(1));
  return { left: snapEdge(left), top: snapEdge(top), right: snapEdge(add(left, fromWholePx(side))), bottom: snapEdge(add(top, fromWholePx(side))) };
}
