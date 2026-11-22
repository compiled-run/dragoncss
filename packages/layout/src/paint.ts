// The paint seam of the engine package (notes/T046-paint-spec.md §3 item 4): the types the translated paint-*.ts references
// share. Layout-size-dependent paint geometry (percent radii, gradient lines, shadow rects, transform origins) runs on the
// device, so it lives in the paint-*.ts roots (translate/src/generate.ts), never in the compiler.
import type { ControlBox, LayoutBox, LayoutInput, ReplacedLeaf } from './input.ts';
import { NO_ENGINE_FAULTS } from './block.ts';
import { resolveBorder } from './box.ts';
import type { MenuListArrow } from './controls.ts';
import { menuListArrow, menuListArrowBox } from './controls.ts';
import type { LayoutRect } from './layout.ts';
import { absoluteRects, resolvedInput } from './layout.ts';
import { snapRect } from './snap.ts';
import { effectiveZoom, toPx } from './units.ts';
import type { ObjectRect, PixelRect } from './replaced.ts';
import { drawnObjectRect, naturalSizingOf, objectFitRect, pixelSnappedRect } from './replaced.ts';
import { floorOf, froundOf } from './rt-easing.ts';
import type { TextMeasurer } from './text.ts';

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

/** FORM-b: the drop-down arrow of a menulist-button select, in absolute device px, by the select's id. */
export type MenuListArrowPaint = { readonly id: string; readonly arrow: MenuListArrow };

/**
 * FORM-b: every menulist-button select's drop-down arrow (controls.ts menuListArrow) from a layout of the input: the select's
 * snapped border box, its whole device px borders and the arrow box at its effective zoom, with the input resolved by the layout's
 * measurer. The device calls this through the translated engine after layout, so it never measures the arrow itself; the host
 * lanes call it too.
 */
export function menuListArrows(input: LayoutInput, boxes: readonly LayoutRect[], measurer: TextMeasurer): MenuListArrowPaint[] {
  const zooms = new Map<string, number>();
  const out: MenuListArrowPaint[] = [];
  const selects = collectArrowZooms(input.root, input.devicePixelRatio, zooms);
  if (selects === 0) return out;
  const zoomed = resolvedInput(input, measurer, NO_ENGINE_FAULTS);
  collectArrows(zoomed.root, zoomed.devicePixelRatio, input.devicePixelRatio, zooms, absoluteRects(boxes), out);
  if (out.length !== selects) throw new Error(`FORM-b: ${selects} menulist-button selects but ${out.length} arrows in the zoomed input`);
  return out;
}

/** The effective zoom of every menulist-button select under b (an unzoomed box), by id; how many there are. */
function collectArrowZooms(b: LayoutBox | ControlBox, device: number, out: Map<string, number>): number {
  let found = 0;
  if (b.kind === 'control') {
    const c = b.control;
    if (c.kind === 'select-menulist' && c.arrowWidth > 0) {
      out.set(b.id, effectiveZoom(device, b.style.zoom));
      found = found + 1;
    }
  }
  for (const k of b.children) {
    if (k.kind === 'box' || k.kind === 'control') found = found + collectArrowZooms(k, device, out);
  }
  return found;
}

/** The arrows of the selects under b (a zoomed box), in tree order. */
function collectArrows(b: LayoutBox | ControlBox, zoomedRatio: number, device: number, zooms: Map<string, number>, abs: Map<string, LayoutRect>, out: MenuListArrowPaint[]): void {
  if (b.kind === 'control') {
    const c = b.control;
    const zoom = zooms.get(b.id);
    if (c.kind === 'select-menulist' && zoom !== undefined) {
      const r = abs.get(b.id);
      if (r === undefined) throw new Error(`FORM-b: the select ${b.id} has no laid-out box`);
      const s = snapRect(r);
      const border = resolveBorder(b.style, zoomedRatio);
      const arrow = menuListArrow(s.left, s.top, s.width, s.height, toPx(border.left), toPx(border.right), menuListArrowBox(c.arrowWidth, zoom, device), c.arrowWidth, b.style.direction === 'rtl');
      out.push({ id: b.id, arrow: arrow });
    }
  }
  for (const k of b.children) {
    if (k.kind === 'box' || k.kind === 'control') collectArrows(k, zoomedRatio, device, zooms, abs, out);
  }
}
