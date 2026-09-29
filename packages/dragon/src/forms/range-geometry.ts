// Thumb placement of input[type=range] in Chrome 145 (block_layout_algorithm.cc AdjustSliderThumbInlineOffset): the thumb is a
// block child of the track, moved along the inline axis by LayoutUnit(ratio * (track content inline size - thumb inline size)).
// All lengths are LayoutUnits (1/64 CSS px), as integers.
import { NO_FORM_FAULTS } from './faults.ts';
import type { FormFaults } from './faults.ts';

export const LU_PER_PX = 64;

/** Truncation toward zero, as C++ integer division and LayoutUnit(double) do; x % 1 keeps the sign of x. */
export function truncate(x: number): number {
  return x - (x % 1);
}

/** LayoutUnit divided by an integer: the raw value divided with truncation. */
export function divLU(a: number, n: number): number {
  return truncate(a / n);
}

/** LayoutUnit(double): truncates toward zero at 1/64 px; NaN is 0. */
export function layoutUnitFromPx(px: number): number {
  const raw = px * LU_PER_PX;
  if (Number.isNaN(raw)) return 0;
  return Math.max(-(2 ** 31), Math.min(2 ** 31 - 1, truncate(raw)));
}

/** The inline offset of the thumb from its static position, in LU. */
export function thumbOffset(ratio: number, trackContentInline: number, thumbInline: number): number {
  const available = trackContentInline - thumbInline;
  return layoutUnitFromPx(ratio * (available / LU_PER_PX));
}

/**
 * The physical left edge of the thumb's border box, in LU, for a horizontal range whose thumb has zero inline margins:
 * inline-start of the track content box plus the offset, mirrored in rtl.
 */
export function thumbLeft(
  track: { readonly contentLeft: number; readonly contentWidth: number },
  thumbWidth: number,
  ratio: number,
  direction: 'ltr' | 'rtl',
  faults: FormFaults = NO_FORM_FAULTS,
): number {
  const offset = thumbOffset(ratio, track.contentWidth, thumbWidth);
  if (direction === 'ltr' || faults.thumbUnmirrored) return track.contentLeft + offset;
  return track.contentLeft + track.contentWidth - thumbWidth - offset;
}
