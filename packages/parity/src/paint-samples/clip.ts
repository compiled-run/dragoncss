// The clip module's sample points (MASK-CLIP): for every box with a clip-path inset() write, a pair of points across each side of its
// clip rect (dragon clipPathRect, the device's rect in device px), SAMPLE_INSET_DEVICE_PX inside and outside the edge, at the
// middle of the side: the inside point shows the box's paint, the outside one what lies under the clipped part. A side whose
// rect is too narrow across for a clear inside point, and a rect the insets leave empty, get none. For a circle() or ellipse(), a pair
// across the curve at each end of its two axes, where the curve crosses the axis square to it; for a polygon(), a pair across the
// middle of each edge, along its normal, kept only where the pixel's centre is clear of every edge of the polygon. The shape's
// outline is antialiased, so a base colour point within the inset of any shape outline is dropped, and so is an edge scanline with
// a pixel there.
import { clipPathInsets, clipPathRect, clipShapeGeometry, clipShapeKind, clipShapeValues } from 'dragon';
import type { SamplePoint } from '../samples.ts';
import { ruleKind, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** A shape outline in page device px: an ellipse (a circle has rx = ry) or a closed polygon. */
type Outline = { readonly kind: 'oval'; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number } | { readonly kind: 'polygon'; readonly points: readonly (readonly [number, number])[] };

const outlinesOf = new WeakMap<PaintSampleContext, readonly Outline[]>();

/** The outline of every box's clip-path shape. */
function outlines(ctx: PaintSampleContext): readonly Outline[] {
  const hit = outlinesOf.get(ctx);
  if (hit !== undefined) return hit;
  const nodes = new Map(ctx.program.nodes.map((n) => [n.id, n]));
  const out: Outline[] = [];
  for (const b of ctx.boxes) {
    const w = nodes.get(b.id)?.writes.find((x) => x.kind === 'clip-path-shape');
    if (w === undefined || w.kind !== 'clip-path-shape') continue;
    const kind = clipShapeKind(w.shape);
    const g = clipShapeGeometry(kind, clipShapeValues(w.shape), b.size, ctx.dpr);
    if (kind === 2) {
      const points: [number, number][] = [];
      for (let i = 1; i + 1 < g.length; i += 2) points.push([b.left + (g[i] as number), b.top + (g[i + 1] as number)]);
      out.push({ kind: 'polygon', points });
    } else out.push({ kind: 'oval', cx: b.left + (g[0] as number), cy: b.top + (g[1] as number), rx: g[2] as number, ry: (kind === 0 ? g[2] : g[3]) as number });
  }
  outlinesOf.set(ctx, out);
  return out;
}

/** Whether the pixel [x, x + 1) x [y, y + 1) lies within d of an outline (its corners and centre bound it for an oval). */
function nearOutline(o: Outline, x: number, y: number, d: number): boolean {
  if (o.kind === 'oval') {
    const at = (rx: number, ry: number, px: number, py: number): number => (rx <= 0 || ry <= 0 ? Infinity : ((px - o.cx) / rx) ** 2 + ((py - o.cy) / ry) ** 2);
    const corners = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]] as const;
    // Clear inside: every corner inside the oval shrunk by d; clear outside: the pixel's nearest point outside the oval grown by d.
    if (corners.every(([px, py]) => at(o.rx - d, o.ry - d, px, py) <= 1)) return false;
    const nx = Math.max(x, Math.min(o.cx, x + 1));
    const ny = Math.max(y, Math.min(o.cy, y + 1));
    return at(o.rx + d, o.ry + d, nx, ny) <= 1;
  }
  const n = o.points.length;
  return o.points.some(([ax, ay], i) => {
    const [bx, by] = o.points[(i + 1) % n] as readonly [number, number];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const cx = x + 0.5;
    const cy = y + 0.5;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2));
    // The centre within d plus the pixel's half diagonal of the segment.
    return Math.hypot(cx - (ax + t * dx), cy - (ay + t * dy)) < d + Math.SQRT1_2;
  });
}

const nearAnyOutline = (ctx: PaintSampleContext, x: number, y: number): boolean => outlines(ctx).some((o) => nearOutline(o, x, y, SAMPLE_INSET_DEVICE_PX));

const crossedOf = new WeakMap<PaintSampleContext, ReadonlySet<string>>();

/** The edge scanline rules with a pixel near a shape outline. */
function scanlinesNearOutlines(ctx: PaintSampleContext): ReadonlySet<string> {
  const hit = crossedOf.get(ctx);
  if (hit !== undefined) return hit;
  const out = new Set<string>();
  if (outlines(ctx).length > 0) for (const p of ctx.base) if (ruleKind(p.rule) === 'edge' && !out.has(p.rule) && nearAnyOutline(ctx, p.x, p.y)) out.add(p.rule);
  crossedOf.set(ctx, out);
  return out;
}

export const CLIP_SAMPLES: PaintSamples = {
  name: 'clip',
  keep: (p, ctx) => (outlines(ctx).length === 0 ? true : ruleKind(p.rule) === 'edge' ? !scanlinesNearOutlines(ctx).has(p.rule) : !nearAnyOutline(ctx, p.x, p.y)),
  points: (ctx) => {
    const inset = SAMPLE_INSET_DEVICE_PX;
    const out: SamplePoint[] = [];
    const inImage = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < ctx.size.width && y < ctx.size.height;
    const nodes = new Map(ctx.program.nodes.map((n) => [n.id, n]));
    for (const b of ctx.boxes) {
      const shape = nodes.get(b.id)?.writes.find((x) => x.kind === 'clip-path-shape');
      if (shape !== undefined && shape.kind === 'clip-path-shape') {
        const kind = clipShapeKind(shape.shape);
        const g = clipShapeGeometry(kind, clipShapeValues(shape.shape), b.size, ctx.dpr);
        const push = (x: number, y: number, label: string): void => {
          if (inImage(x, y)) out.push({ x, y, rule: `clip:${b.id}:shape-${label}` });
        };
        if (kind !== 2) {
          const [cx, cy, rx] = g as [number, number, number];
          const ry = kind === 0 ? rx : (g[3] as number);
          const x = b.left + cx;
          const y = b.top + cy;
          // Each axis end: the inside point stays inset clear of the curve (and of the centre's other side), the outside one past it.
          for (const [axis, r] of [['x', rx], ['y', ry]] as const) {
            if (r < 2 * inset + 1) continue;
            for (const dir of [1, -1] as const) {
              const edge = (axis === 'x' ? x : y) + dir * r;
              const inner = dir > 0 ? Math.floor(edge) - inset - 1 : Math.ceil(edge) + inset;
              const outer = dir > 0 ? Math.ceil(edge) + inset : Math.floor(edge) - inset - 1;
              const across = Math.floor(axis === 'x' ? y : x);
              for (const [p, side] of [[inner, 'in'], [outer, 'out']] as const) push(axis === 'x' ? p : across, axis === 'x' ? across : p, `${axis}${dir > 0 ? '+' : '-'}-${side}`);
            }
          }
          continue;
        }
        const pts: [number, number][] = [];
        for (let i = 1; i + 1 < g.length; i += 2) pts.push([b.left + (g[i] as number), b.top + (g[i + 1] as number)]);
        const edges = pts.map((p, i) => [p, pts[(i + 1) % pts.length] as [number, number]] as const);
        const clear = (px: number, py: number): boolean => edges.every(([[ax, ay], [bx, by]]) => {
          const dx = bx - ax;
          const dy = by - ay;
          const len2 = dx * dx + dy * dy;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
          return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) >= inset + 1;
        });
        edges.forEach(([[ax, ay], [bx, by]], i) => {
          const len = Math.hypot(bx - ax, by - ay);
          if (len < 2 * inset + 2) return;
          const [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
          const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
          for (const [dir, side] of [[1, 'a'], [-1, 'b']] as const) {
            const x = Math.floor(mx + dir * nx * (inset + 1.5));
            const y = Math.floor(my + dir * ny * (inset + 1.5));
            if (clear(x + 0.5, y + 0.5)) push(x, y, `edge${i}-${side}`);
          }
        });
        continue;
      }
      const w = nodes.get(b.id)?.writes.find((x) => x.kind === 'clip-path-inset');
      if (w === undefined || w.kind !== 'clip-path-inset') continue;
      const [l, t, r, bt] = clipPathRect(clipPathInsets(w.edges), b, b.size, ctx.dpr);
      if (r <= l || bt <= t) continue;
      const rect = { left: b.left + l, top: b.top + t, right: b.left + r, bottom: b.top + bt };
      for (const side of SIDES) {
        const horizontal = side === 'top' || side === 'bottom';
        const [lo, hi] = horizontal ? [rect.top, rect.bottom] : [rect.left, rect.right];
        if (hi - lo < 2 * inset + 1) continue;
        const edge = rect[side];
        const inward = side === 'top' || side === 'left' ? 1 : -1;
        // A fractional edge (a percentage inset) rounds away from the pixel it cuts, so neither point lands on an antialiased pixel.
        const inner = inward > 0 ? Math.ceil(edge) + inset : Math.floor(edge) - inset - 1;
        const outer = inward > 0 ? Math.floor(edge) - inset - 1 : Math.ceil(edge) + inset;
        const a = horizontal ? Math.floor((rect.left + rect.right) / 2) : Math.floor((rect.top + rect.bottom) / 2);
        for (const p of [inner, outer]) {
          const [x, y] = horizontal ? [a, p] : [p, a];
          if (inImage(x, y)) out.push({ x, y, rule: `clip:${b.id}:path-${side}` });
        }
      }
    }
    return out;
  },
};
