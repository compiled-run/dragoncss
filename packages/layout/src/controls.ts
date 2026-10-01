// Form controls (FORM-a), ported from Blink at 145.0.7632.6 (BSD). A control is laid out as Chrome's own UA shadow structure:
// - input[type=range]: the input is a flex container (range_input_type.cc:285-288 CreateLayoutObject returns LayoutFlexibleBox)
//   holding the slider container (flex), the track (a block flex item, align-self center) and the thumb (the track's block
//   child), whose inline offset is moved by the value (block_layout_algorithm.cc:2652-2654 and 3936-3945
//   AdjustSliderThumbInlineOffset); its default content inline size is 129 px (layout_box.cc:295-298 SliderIntrinsicInlineSize).
// - button: a block container whose in-flow contents are centred in the block axis, safely (html.css
//   `-internal-align-content-block: center`, block_layout_algorithm_utils.cc:185-203 AlignBlockContent), or the flex container
//   its display says (html_button_element.cc:59-74 CreateLayoutObject). There is no anonymous inner box.
import type { Direction } from './input.ts';
import type { LU } from './units.ts';
import { add, clampNegativeToZero, divInt, doubleMul, float32, fromCssPx, fromDouble, sub, toPx } from './units.ts';

/** layout_box.cc:296 kDefaultTrackLength, in CSS px. */
export const SLIDER_DEFAULT_TRACK_LENGTH = 129;

/** layout_box.cc:295-298: LayoutUnit(kDefaultTrackLength * EffectiveZoom()), an int times a float, truncated to LU. */
export function sliderIntrinsicInlineSize(zoom: number): LU {
  return fromCssPx(float32(SLIDER_DEFAULT_TRACK_LENGTH * float32(zoom)));
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
 * The physical left edge of a thumb with zero inline margins, from the track's content box: the offset is logical, so in rtl it
 * runs from the content box's right edge.
 */
export function sliderThumbLeft(trackContentLeft: LU, trackContentWidth: LU, thumbWidth: LU, ratio: number, direction: Direction): LU {
  const offset = sliderThumbInlineOffset(ratio, trackContentWidth, thumbWidth);
  if (direction === 'ltr') return add(trackContentLeft, offset);
  return sub(sub(add(trackContentLeft, trackContentWidth), thumbWidth), offset);
}

/**
 * block_layout_algorithm_utils.cc:194-201: a block button's in-flow contents move down by free space / 2, where free space is the
 * content box block size less the contents' block size, clamped at 0 because buttons align safely.
 */
export function buttonContentShift(contentBoxBlockSize: LU, contentsBlockSize: LU): LU {
  return divInt(clampNegativeToZero(sub(contentBoxBlockSize, contentsBlockSize)), 2);
}
