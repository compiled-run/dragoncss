// How Chrome 145 lays out a button's contents (the Blink rule FORM-a moves into the engine), as HTML's button rendering section
// describes it and forms.test.ts checks against Chrome:
// - a button whose display is flex, inline-flex, grid or inline-grid is an ordinary container of that kind; every other button
//   lays out as a block with no anonymous inner box (Chrome makes this choice in html_button_element.cc).
// - html.css `button { -internal-align-content-block: center }`, applied by block_layout_algorithm_utils.cc AlignBlockContent:
//   the block button's in-flow contents move down by free space / 2, free space clamped at 0 for buttons (safe centring),
//   whatever the author's align-content.
import { divLU } from './range-geometry.ts';

export type ButtonContentModel =
  /** The button lays out its children as the flex or grid container its display says. */
  | { readonly kind: 'container' }
  /** A block container whose contents are centred in the block axis, safely. */
  | { readonly kind: 'block-centred' };

const CONTAINER_DISPLAYS = new Set(['flex', 'inline-flex', 'grid', 'inline-grid', 'grid-lanes', 'inline-grid-lanes']);

/** The content model of a button from its computed display. */
export function buttonContentModel(display: string): ButtonContentModel {
  return CONTAINER_DISPLAYS.has(display) ? { kind: 'container' } : { kind: 'block-centred' };
}

/** The block-axis shift of a block button's contents, in LU: max(0, content box block size - contents block size) / 2, truncated. */
export function buttonContentShift(contentBoxBlockSize: number, contentsBlockSize: number): number {
  return divLU(Math.max(0, contentBoxBlockSize - contentsBlockSize), 2);
}
