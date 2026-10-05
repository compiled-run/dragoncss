// The paint seam of the engine package (notes/T046-paint-spec.md §3 item 4): the types the translated paint-*.ts references
// share. Layout-size-dependent paint geometry (percent radii, gradient lines, shadow rects, transform origins) runs on the
// device, so it lives in the paint-*.ts roots (translate/src/generate.ts), never in the compiler.
import type { ReplacedLeaf } from './input.ts';
import { NO_ENGINE_FAULTS } from './block.ts';
import type { ObjectRect, PixelRect } from './replaced.ts';
import { drawnObjectRect, naturalSizingOf, objectFitRect, pixelSnappedRect } from './replaced.ts';

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
