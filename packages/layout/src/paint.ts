// The paint seam of the engine package (notes/T046-paint-spec.md §3 item 4): the types the translated paint-*.ts references
// share. Layout-size-dependent paint geometry (percent radii, gradient lines, shadow rects, transform origins) runs on the
// device, so it lives in the paint-*.ts roots (translate/src/generate.ts), never in the compiler.
import { floorOf, froundOf } from './rt-easing.ts';

/** A box's paint shape in device px: the snapped border-box edges, the border widths and the eight corner radii (horizontal then vertical, top-left first). */
export type BoxShape = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly borders: readonly number[];
  readonly radii: readonly number[];
};

/**
 * Skia's paint alpha of a Blink opacity (Skia 2ab8add5 include/core/SkPaint.h:264-266 getAlpha, sk_float_round2int(alpha * 255),
 * every step in float): Chrome composites an opacity group, or a draw its alpha folds into (cc PlaybackFoldingIterator), with it.
 */
export function opacityAlpha8(opacity: number): number {
  const o = froundOf(opacity < 0 ? 0 : opacity > 1 ? 1 : opacity);
  return floorOf(froundOf(froundOf(o * 255) + 0.5));
}
