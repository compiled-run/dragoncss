// The paint seam of the engine package (notes/T046-paint-spec.md §3 item 4): the types the translated paint-*.ts references
// share. Layout-size-dependent paint geometry (percent radii, gradient lines, shadow rects, transform origins) runs on the
// device, so it lives in the paint-*.ts roots (translate/src/generate.ts), never in the compiler.
import type { ReplacedLeaf } from './input.ts';
import { NO_ENGINE_FAULTS } from './block.ts';
import type { ObjectRect, PixelRect } from './replaced.ts';
import { drawnObjectRect, naturalSizingOf, objectFitRect, pixelSnappedRect } from './replaced.ts';
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
 * REPL-a: where a replaced image is drawn, from its zoomed leaf and its content box in absolute LU: the destination rect snapped
 * to device px (Blink ToPixelSnappedRect) and the part of it inside the snapped content box, null when nothing is drawn
 * (ImagePainter::PaintIntoRect). The device calls this through the translated engine after layout; the host lanes call it too.
 */
export function replacedPaint(leaf: ReplacedLeaf, content: ObjectRect): ReplacedPaint {
  const dest = objectFitRect(content, naturalSizingOf(leaf), leaf.objectFit, { x: leaf.objectPositionX, y: leaf.objectPositionY }, NO_ENGINE_FAULTS);
  return { dest: pixelSnappedRect(dest), content: pixelSnappedRect(content), drawn: drawnObjectRect(dest, content) };
}

/** A replaced box's paint rects in absolute device px: the destination, the content box, and the drawn part (null for none). */
export type ReplacedPaint = { readonly dest: PixelRect; readonly content: PixelRect; readonly drawn: PixelRect | null };

/**
 * Skia's paint alpha of a Blink opacity (Skia 2ab8add5 include/core/SkPaint.h:264-266 getAlpha, sk_float_round2int(alpha * 255),
 * every step in float): Chrome composites an opacity group, or a draw its alpha folds into (cc PlaybackFoldingIterator), with it.
 */
export function opacityAlpha8(opacity: number): number {
  const o = froundOf(opacity < 0 ? 0 : opacity > 1 ? 1 : opacity);
  return floorOf(froundOf(froundOf(o * 255) + 0.5));
}

/** Skia's SkMulDiv255Round: a * b / 255 rounded, in integers (pnt1-effects.test.ts measures it with the blits below). */
export function mulDiv255Round(a: number, b: number): number {
  const prod = a * b + 128;
  return floorOf((prod + floorOf(prod / 256)) / 256);
}

/**
 * PNT1-opacity-b: Chrome's paint alpha of a colour of alpha byte colorAlpha8 drawn with an opacity folded into it: the paint
 * holds the colour as a byte (SkColor), cc PlaybackFoldingIterator multiplies its float alpha (byte / 255) by the opacity, and
 * SkPaint getAlpha rounds the product * 255, every step in float.
 */
export function foldedAlpha8(colorAlpha8: number, opacity: number): number {
  const o = opacity < 0 ? 0 : opacity > 1 ? 1 : opacity;
  return opacityAlpha8(froundOf(froundOf(colorAlpha8 / 255) * froundOf(o)));
}

/**
 * PNT1-opacity-b: one channel of a solid colour's blit (Skia 2ab8add5 src/opts/SkBlitRow_opts.h:243-270 blit_row_color32): the
 * premultiplied colour channel plus (dst * (256 - srcAlpha8)) >> 8. A colour channel c of alpha A draws as
 * srcOver8(mulDiv255Round(c, A), A, dst).
 */
export function srcOver8(src: number, srcAlpha8: number, dst: number): number {
  return src + floorOf((dst * (256 - srcAlpha8)) / 256);
}

/**
 * PNT1-opacity-b: one channel of how Chrome composites an opacity group's layer (a saveLayer restored with paint alpha alpha8)
 * onto what is below it (Skia 2ab8add5 src/core/SkBlitRow_D32.cpp:204-301 blit_row_s32a_blend, src/core/SkColorData.h:134-137
 * SkAlphaMulInv256): src_scale = alpha8 + 1, dst_scale = SkAlphaMulInv256(layerAlpha8, src_scale), and
 * ((layer * src_scale + dst * dst_scale) & 0xffff) >> 8, each channel a 16-bit lane of the packed blend. `layer` is premultiplied.
 */
export function groupBlend8(layer: number, layerAlpha8: number, dst: number, alpha8: number): number {
  const srcScale = alpha8 + 1;
  const prod = 65535 - layerAlpha8 * srcScale;
  const dstScale = floorOf((prod + floorOf(prod / 256)) / 256);
  const lane = layer * srcScale + dst * dstScale;
  return floorOf((lane - floorOf(lane / 65536) * 65536) / 256);
}
