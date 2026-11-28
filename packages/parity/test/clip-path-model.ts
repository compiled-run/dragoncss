// The device-px clip a clip-path write gives a box (dragon clipPathRect, clipShapeGeometry), shared by the paint models.
import type { ProgramNode } from 'dragon';
import { clipPathInsets, clipPathRect, clipShapeGeometry, clipShapeKind, clipShapeValues } from 'dragon';

/** A clip in page device px: whether a point is inside it. */
export type Clip = (x: number, y: number) => boolean;

/** A laid-out box in page device px with its layout size in CSS px. */
export type ClipBox = { readonly node: ProgramNode; readonly l: number; readonly t: number; readonly r: number; readonly b: number; readonly size?: readonly [number, number] };

/** Whether (x, y) is inside a closed polygon under its fill rule. */
function inPolygon(points: readonly (readonly [number, number])[], evenodd: boolean, x: number, y: number): boolean {
  let winding = 0;
  let crossings = 0;
  points.forEach(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length] as readonly [number, number];
    if ((ay <= y) === (by <= y)) return;
    const at = ax + ((y - ay) / (by - ay)) * (bx - ax);
    if (at > x) {
      crossings++;
      winding += by > ay ? 1 : -1;
    }
  });
  return evenodd ? crossings % 2 === 1 : winding !== 0;
}

/** The device-px clip of every node with a clip-path write, in page coordinates. */
export function clipRects(list: readonly ClipBox[], dpr: number): Map<string, Clip> {
  const out = new Map<string, Clip>();
  for (const b of list) {
    const w = b.node.writes.find((x) => x.kind === 'clip-path-inset' || x.kind === 'clip-path-shape');
    if (w === undefined || (w.kind !== 'clip-path-inset' && w.kind !== 'clip-path-shape')) continue;
    if (b.size === undefined) throw new Error(`${b.node.id}: no layout size`);
    if (w.kind === 'clip-path-inset') {
      const [l, t, r, bt] = clipPathRect(clipPathInsets(w.edges), { left: b.l, top: b.t, right: b.r, bottom: b.b }, b.size, dpr);
      out.set(b.node.id, (x, y) => x >= b.l + l && x < b.l + r && y >= b.t + t && y < b.t + bt);
      continue;
    }
    const kind = clipShapeKind(w.shape);
    const g = clipShapeGeometry(kind, clipShapeValues(w.shape), b.size, dpr);
    if (kind === 2) {
      const points: [number, number][] = [];
      for (let i = 1; i + 1 < g.length; i += 2) points.push([b.l + (g[i] as number), b.t + (g[i + 1] as number)]);
      out.set(b.node.id, (x, y) => inPolygon(points, g[0] === 1, x, y));
      continue;
    }
    const [cx, cy, rx] = [b.l + (g[0] as number), b.t + (g[1] as number), g[2] as number];
    const ry = (kind === 0 ? g[2] : g[3]) as number;
    out.set(b.node.id, (x, y) => rx > 0 && ry > 0 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1);
  }
  return out;
}
