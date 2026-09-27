// The one pixel-snap rule (docs/research/native-strategy.md section 3.3): engine LU are 1/64 device px, and every edge is snapped
// from its absolute position, so a box's snapped size is the distance between its snapped edges. Results stay numbers (Double).
import type { LayoutRect } from './layout.ts';
import { absoluteRects } from './layout.ts';
import { add, snapEdge } from './units.ts';

/** A box's absolute border-box edges in whole device px; width and height come from the snapped edges. */
export type SnappedRect = {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
};

/** Snaps one rect with absolute LU coordinates (the fixture root sits at device origin 0, 0). */
export function snapRect(r: LayoutRect): SnappedRect {
  const left = snapEdge(r.x);
  const top = snapEdge(r.y);
  const right = snapEdge(add(r.x, r.width));
  const bottom = snapEdge(add(r.y, r.height));
  return { id: r.id, left, top, right, bottom, width: right - left, height: bottom - top };
}

/** The snapped device-px edges of every rect of a layout result, in result order. */
export function snapEdges(boxes: readonly LayoutRect[]): SnappedRect[] {
  const abs = absoluteRects(boxes);
  const out: SnappedRect[] = [];
  for (const b of boxes) {
    const r = abs.get(b.id);
    if (r === undefined) throw new Error(`no absolute rect for ${b.id}`);
    out.push(snapRect(r));
  }
  return out;
}
