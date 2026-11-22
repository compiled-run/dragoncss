// The control module's sample points (FORM-b): a menulist-button select's drop-down arrow is a 2 device px stroke, so as for any
// SVG stroke every pixel within SVG_CLEAR_DEVICE_PX of its edges is indeterminate and no base point there is compared; with a
// stroke that thin none is left inside it. Chrome's arrow pixels are proven on the host (form-b-select.test.ts).
import type { ControlBox, LayoutBox, MenuListArrow } from '@dragon/layout';
import { effectiveZoom, menuListArrow, menuListArrowBox } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import type { SampleBox, SamplePoint } from '../samples.ts';
import { SVG_CLEAR_DEVICE_PX } from '../samples.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

/** A menulist-button select's arrow at a DPR, from its snapped border box and whole device px borders. */
export type SelectArrow = { readonly id: string; readonly arrow: MenuListArrow };

/** Every menulist-button select's arrow in device px at a DPR, from the program's engine input and the case's sample boxes. */
export function selectArrows(program: NativeProgram, boxes: readonly SampleBox[], dpr: number): SelectArrow[] {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const out: SelectArrow[] = [];
  const walk = (b: LayoutBox | ControlBox): void => {
    if (b.kind === 'control' && b.control.kind === 'select-menulist' && b.control.arrowWidth > 0) {
      const s = byId.get(b.id);
      if (s === undefined) throw new Error(`${b.id}: a menulist-button select with no laid-out box at DPR ${dpr}`);
      const box = menuListArrowBox(b.control.arrowWidth, effectiveZoom(dpr, b.style.zoom), dpr);
      out.push({ id: b.id, arrow: menuListArrow(s.left, s.top, s.right - s.left, s.bottom - s.top, s.border.left, s.border.right, box, b.control.arrowWidth, b.style.direction === 'rtl') });
    }
    for (const c of b.children) if (c.kind === 'box' || c.kind === 'control') walk(c);
  };
  walk(program.root);
  return out;
}

type Pt = { readonly x: number; readonly y: number };

/** The arrow's centreline as segments in device px. */
export function arrowSegments(a: MenuListArrow): (readonly [Pt, Pt])[] {
  const pts = a.shape.segments.flatMap((s) => (s.kind === 'move' || s.kind === 'line' ? [{ x: s.x, y: s.y }] : []));
  return pts.slice(1).map((p, k) => [pts[k] as Pt, p] as const);
}

/** The distance from a point to a segment. */
export function segmentDistance(p: Pt, [a, b]: readonly [Pt, Pt]): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Whether a device pixel's centre is within SVG_CLEAR_DEVICE_PX of the arrow's stroke outline or inside it, where its colour is
 * indeterminate: the band half the stroke width either side of the centreline, and the miter tip at the "v"'s vertex, half the
 * width times sqrt 2 from it (the arrow's sides meet at a right angle or wider, so the tip is no farther).
 */
export function nearArrow(a: MenuListArrow, x: number, y: number): boolean {
  const p = { x: x + 0.5, y: y + 0.5 };
  const segs = arrowSegments(a);
  const half = a.strokeWidth / 2;
  const vertex = segs[0]?.[1];
  if (vertex !== undefined && Math.hypot(p.x - vertex.x, p.y - vertex.y) < half * Math.SQRT2 + SVG_CLEAR_DEVICE_PX) return true;
  return segs.some((s) => segmentDistance(p, s) < half + SVG_CLEAR_DEVICE_PX);
}

const arrowsOf = new WeakMap<PaintSampleContext, readonly SelectArrow[]>();
function arrows(ctx: PaintSampleContext): readonly SelectArrow[] {
  let a = arrowsOf.get(ctx);
  if (a === undefined) {
    // The program's own select-arrow writes say whether any arrow is drawn; a program without one has no engine tree to walk for it.
    a = ctx.program.nodes.some((n) => n.writes.some((w) => w.kind === 'select-arrow')) ? selectArrows(ctx.program, ctx.boxes, ctx.dpr) : [];
    arrowsOf.set(ctx, a);
  }
  return a;
}

export const CONTROL_SAMPLES: PaintSamples = {
  name: 'control',
  keep: (p: SamplePoint, ctx: PaintSampleContext) => !arrows(ctx).some((a) => nearArrow(a.arrow, p.x, p.y)),
  points: () => [],
};
