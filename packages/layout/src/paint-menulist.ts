// FORM-b: a menulist-button select's drop-down arrow from a layout, an engine root (translate/src/generate.ts engineRoots) the device runs after layout.
import type { ControlBox, LayoutBox, LayoutInput } from './input.ts';
import { NO_ENGINE_FAULTS } from './block.ts';
import { resolveBorder } from './box.ts';
import type { MenuListArrow } from './controls.ts';
import { menuListArrow, menuListArrowBox } from './controls.ts';
import type { LayoutRect } from './layout.ts';
import { absoluteRects, resolvedInput } from './layout.ts';
import { snapRect } from './snap.ts';
import type { TextMeasurer } from './text.ts';
import { effectiveZoom, toPx } from './units.ts';

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
