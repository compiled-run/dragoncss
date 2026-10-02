// Form controls (FORM-a), ported from Blink's BSD files at 145.0.7632.6. The compiler writes a control as Chrome's own UA shadow
// structure, with a ControlBox (input.ts) where Blink's layout treats the box specially:
// - input[type=range] (range): a flex container (range_input_type.cc:285-288 CreateLayoutObject returns LayoutFlexibleBox) holding
//   the slider container (flex), the track (a block flex item, align-self center) and the thumb (slider-thumb, the track's block
//   child), whose inline offset is moved by the value (block_layout_algorithm.cc:2652-2654 and 3936-3945
//   AdjustSliderThumbInlineOffset); its default content inline size is 129 CSS px times the zoom, a Chrome observation pinned by
//   FORM-0's boxes (Blink computes it in layout_box.cc, which is LGPL: a reference only, nothing here follows its code).
// - a block button (button-block): its in-flow contents are centred in the block axis, safely (html.css
//   `-internal-align-content-block: center`, block_layout_algorithm_utils.cc:185-203 AlignBlockContent). A flex or grid button is
//   the plain container its display says (html_button_element.cc:59-74 CreateLayoutObject). There is no anonymous inner box.
import type { ControlBox, ControlKind, Direction, LayoutBox } from './input.ts';
import type { LU } from './units.ts';
import { clampNegativeToZero, divInt, doubleMul, float32, floatMul, fromCssPx, fromDouble, sub, toPx, ZERO } from './units.ts';

/** A range's default track length in CSS px: Chrome 145 lays out an auto-width range with a 129 px content box (FORM-0 boxes). */
export const SLIDER_DEFAULT_TRACK_LENGTH = 129;

/** The track length at a zoom, multiplied in float like every px length environment.ts zooms; environment.ts zooms a range with it. */
export function zoomTrackLength(px: number, zoom: number): number {
  return floatMul(px, float32(zoom));
}

/** The default track length at a zoom, in LU (fromCssPx), as FORM-0's boxes give it at zoom 1, 2, 3 and 2.625. */
export function sliderIntrinsicInlineSize(zoom: number): LU {
  return fromCssPx(zoomTrackLength(SLIDER_DEFAULT_TRACK_LENGTH, zoom));
}

/** A control box laid out as the plain box it is, without its control facts. */
export function controlAsBox(c: ControlBox): LayoutBox {
  return { kind: 'box', id: c.id, boxType: c.boxType, style: c.style, children: c.children };
}

/** The control facts of a box, or null for a plain box. */
export function controlOf(box: LayoutBox | ControlBox): ControlKind | null {
  return box.kind === 'control' ? box.control : null;
}

/** The plain box of a box or control box. */
export function plainBox(box: LayoutBox | ControlBox): LayoutBox {
  return box.kind === 'control' ? controlAsBox(box) : box;
}

/**
 * block_layout_algorithm.cc:3936-3945: the thumb moves along the track's inline axis by
 * LayoutUnit(RatioValue().ToDouble() * (ChildAvailableSize().inline_size - fragment.InlineSize())); LayoutUnit(double) truncates.
 * The ratio is the input's (value - min) / (max - min), 0 when max equals min, which the compiler derives in Blink's Decimal.
 */
export function sliderThumbInlineOffset(ratio: number, trackContentInline: LU, thumbInline: LU): LU {
  return fromDouble(doubleMul(ratio, toPx(sub(trackContentInline, thumbInline))));
}

/**
 * block_layout_algorithm.cc:2652-2654: the physical move of a thumb placed in a block container of the given direction; the
 * logical offset runs leftward in rtl.
 */
export function sliderThumbShift(ratio: number, trackContentWidth: LU, thumbWidth: LU, direction: Direction): LU {
  const offset = sliderThumbInlineOffset(ratio, trackContentWidth, thumbWidth);
  return direction === 'rtl' ? sub(ZERO, offset) : offset;
}

/**
 * block_layout_algorithm_utils.cc:194-201: a block button's in-flow contents move down by free space / 2, where free space is the
 * content box block size less the contents' block size, clamped at 0 because buttons align safely.
 */
export function buttonContentShift(contentBoxBlockSize: LU, contentsBlockSize: LU): LU {
  return divInt(clampNegativeToZero(sub(contentBoxBlockSize, contentsBlockSize)), 2);
}
