// The outline module's sample points (T046 §2): every outline, resolved with the TS paint-radius.ts outlineRings (the reference the
// device runs translated), gets a colour point in the middle of each ring band at least 2 x SAMPLE_INSET_DEVICE_PX + 1 device px
// wide, at the middle of the side (rule border, kind border: colour-exact), and an edge scanline across the ring's outer edge at the
// middle of each side whose band holds the scanline's inner half (rule edge). A dotted, dashed or 3D outline is drawn by the TS
// paint-dash.ts outlinePaintOps, so its point and scanline move along the side, from the middle outwards, to the first place where
// every pixel is crisp: each drawing operation covers it wholly or not at all with SAMPLE_INSET_DEVICE_PX to spare along the side
// (dash ends and dot rims are anti-aliased); across the side, the band's edges are whole device px. A base colour point within
// SAMPLE_INSET_DEVICE_PX of a ring edge is suppressed, as is a base scanline that comes that near one: the ring's edge, not the
// point's own box, decides its colour there.
import type { BorderOp, DashFaults } from '@dragon/layout';
import { NO_DASH_FAULTS, outlineNeedsSidePainter, outlineOffsetPx, outlinePaintOps, outlineRings, outlineWidthPx } from '@dragon/layout';
import type { SampleBox, SamplePoint } from '../samples.ts';
import { ruleKind, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import type { Arc } from './radius.ts';
import { boxRadii, nearArc, rectArcs } from './radius.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

const STYLES: readonly string[] = ['solid', 'double', 'dotted', 'dashed', 'groove', 'ridge', 'inset', 'outset'];

type Rgba8Shape = { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number };
type OutlineWriteShape = { readonly kind: 'outline'; readonly style: string; readonly width: number; readonly offset: number; readonly color: Rgba8Shape; readonly tones: readonly [Rgba8Shape, Rgba8Shape] | null };

/** A ring: the outer and inner rect (left, top, right, bottom) in device px, and the rounded corners of each. */
export type Ring = { readonly outer: readonly [number, number, number, number]; readonly inner: readonly [number, number, number, number]; readonly arcs: readonly Arc[] };

/** The outline write of a node, checked; null when it has none. */
export function outlineWrite(ctx: PaintSampleContext, id: string): OutlineWriteShape | null {
  const n = ctx.program.nodes.find((x) => x.id === id);
  const w = n?.writes.find((x) => x.kind === 'outline') as unknown as OutlineWriteShape | undefined;
  if (w === undefined) return null;
  if (!STYLES.includes(w.style) || !(w.width > 0) || !Number.isFinite(w.offset)) throw new Error(`${id}: the outline write is malformed`);
  return w;
}

/** The side painter's operations of a box's dotted, dashed or 3D outline around its ring's outer rect, or null for a ring style. */
export function boxOutlineOps(ctx: PaintSampleContext, b: SampleBox, faults: DashFaults = NO_DASH_FAULTS, shift = 0): BorderOp[] | null {
  const w = outlineWrite(ctx, b.id);
  if (w === null || !outlineNeedsSidePainter(w.style)) return null;
  const rings = boxRings(ctx, b, shift);
  const r = rings[0];
  if (rings.length !== 1 || r === undefined) throw new Error(`${b.id}: a ${w.style} outline has ${rings.length} rings`);
  const [l, t, rr, bb] = r.outer;
  return outlinePaintOps(l, t, rr, bb, outlineWidthPx(w.width, ctx.dpr), w.style, w.color.r, w.color.g, w.color.b, w.color.alpha, faults);
}

type Pt = readonly [number, number];
const pairs = (pts: readonly number[]): Pt[] => Array.from({ length: pts.length / 2 }, (_, i) => [pts[2 * i] as number, pts[2 * i + 1] as number] as const);

/** Whether two convex polygons overlap (separating axis test); touching edges do not overlap. */
function overlaps(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Pt;
      const q = poly[(i + 1) % poly.length] as Pt;
      const nx = q[1] - p[1];
      const ny = p[0] - q[0];
      if (nx === 0 && ny === 0) continue;
      const proj = (xs: readonly Pt[]): [number, number] => {
        const v = xs.map(([x, y]) => x * nx + y * ny);
        return [Math.min(...v), Math.max(...v)];
      };
      const [a0, a1] = proj(a);
      const [b0, b1] = proj(b);
      if (a1 <= b0 + 1e-9 || b1 <= a0 + 1e-9) return false;
    }
  }
  return true;
}

/** Whether a point is inside a convex polygon (either winding), its boundary included. */
export function insidePolygon(poly: readonly Pt[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    const c = (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/** Device px each side of a dot's circle that Skia's conic-flattened, anti-aliased rim may colour in part (as P6a's oracle rules). */
const DOT_RIM = 0.5;

/** How an operation's shape covers a rect: wholly, not at all, or in part. */
function cover(o: BorderOp, l: number, t: number, r: number, b: number): 'full' | 'none' | 'part' {
  const corners: Pt[] = [[l, t], [r, t], [r, b], [l, b]];
  if (o.op === 'dot') {
    const [cx, cy, rad] = o.points as [number, number, number];
    if (corners.every(([px, py]) => Math.hypot(px - cx, py - cy) <= rad - DOT_RIM)) return 'full';
    const nx = Math.max(l, Math.min(cx, r));
    const ny = Math.max(t, Math.min(cy, b));
    return Math.hypot(nx - cx, ny - cy) >= rad + DOT_RIM ? 'none' : 'part';
  }
  const poly = pairs(o.points);
  if (!overlaps(poly, corners)) return 'none';
  return corners.every(([px, py]) => insidePolygon(poly, px, py)) ? 'full' : 'part';
}

/**
 * Whether pixel (x, y), grown by gx device px along x and gy along y, is crisp under the operations: every clip holds it wholly or
 * not at all, and every fill or dot inside its clips covers it wholly or not at all.
 */
export function crispUnder(ops: readonly BorderOp[], x: number, y: number, gx: number, gy: number): boolean {
  const [l, t, r, b] = [x - gx, y - gy, x + 1 + gx, y + 1 + gy];
  const clips: BorderOp[][] = [[]];
  for (const o of ops) {
    const top = clips[clips.length - 1] as BorderOp[];
    if (o.op === 'save') clips.push([...top]);
    else if (o.op === 'restore') clips.pop();
    else if (o.op === 'clip') top.push(o);
    else if (o.op === 'fill' || o.op === 'dot') {
      const c = cover(o, l, t, r, b);
      if (c === 'none') continue;
      const clipped = top.map((k) => cover(k, l, t, r, b));
      if (clipped.includes('none')) continue;
      if (c === 'part' || clipped.includes('part')) return false;
    }
  }
  return true;
}

/** The rings of a sample box's outline at the case's DPR, shifted right by shift device px, or none. */
export function boxRings(ctx: PaintSampleContext, b: SampleBox, shift = 0): Ring[] {
  const w = outlineWrite(ctx, b.id);
  if (w === null) return [];
  const radii = boxRadii(ctx.program, b, ctx.dpr)?.slice(0, 8) ?? [0, 0, 0, 0, 0, 0, 0, 0];
  const v = outlineRings(b.left + shift, b.top, b.right + shift, b.bottom, radii, outlineWidthPx(w.width, ctx.dpr), outlineOffsetPx(w.offset, ctx.dpr), w.style === 'double');
  const out: Ring[] = [];
  for (let k = 0; k + 24 <= v.length; k += 24) {
    const at = (j: number): number => v[k + j] as number;
    const radii = (from: number): number[] => v.slice(k + from, k + from + 8) as number[];
    out.push({ outer: [at(0), at(1), at(2), at(3)], inner: [at(4), at(5), at(6), at(7)], arcs: [...rectArcs(at(0), at(1), at(2), at(3), radii(8)), ...rectArcs(at(4), at(5), at(6), at(7), radii(16))] });
  }
  return out;
}

type Outlined = { readonly box: SampleBox; readonly rings: readonly Ring[]; readonly ops: readonly BorderOp[] | null };
const cache = new WeakMap<PaintSampleContext, readonly Outlined[]>();

function outlined(ctx: PaintSampleContext): readonly Outlined[] {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const out = ctx.boxes.map((box) => ({ box, rings: boxRings(ctx, box), ops: boxOutlineOps(ctx, box) })).filter((o) => o.rings.length > 0);
  cache.set(ctx, out);
  return out;
}

/** Whether the pixel [x, x + 1) x [y, y + 1) comes within the inset of an edge of a rect (inside or outside it). */
function nearRect(x: number, y: number, r: readonly [number, number, number, number], inset: number): boolean {
  const [l, t, rr, b] = r;
  const inBand = (p: number, lo: number, hi: number): boolean => p + 1 > lo - inset && p < hi + inset;
  const nearEdge = (p: number, e: number): boolean => p + 1 > e - inset && p < e + inset;
  return (inBand(y, t, b) && (nearEdge(x, l) || nearEdge(x, rr))) || (inBand(x, l, rr) && (nearEdge(y, t) || nearEdge(y, b)));
}

/** Whether a pixel is near an edge or a rounded corner of any outline ring of the case (rounded ring corners are antialiased). */
export function nearRing(ctx: PaintSampleContext, x: number, y: number): boolean {
  return outlined(ctx).some((o) => o.rings.some((r) => nearRect(x, y, r.outer, SAMPLE_INSET_DEVICE_PX) || nearRect(x, y, r.inner, SAMPLE_INSET_DEVICE_PX) || r.arcs.some((a) => nearArc(a, x, y))));
}

const near = new WeakMap<PaintSampleContext, ReadonlySet<string>>();

/** The base edge scanlines that come near a ring edge (edge rules are judged per scanline, so the whole scanline goes). */
function scanlinesNearRings(ctx: PaintSampleContext): ReadonlySet<string> {
  const hit = near.get(ctx);
  if (hit !== undefined) return hit;
  const out = new Set<string>();
  for (const p of ctx.base) if (ruleKind(p.rule) === 'edge' && !out.has(p.rule) && nearRing(ctx, p.x, p.y)) out.add(p.rule);
  near.set(ctx, out);
  return out;
}

export const OUTLINE_SAMPLES: PaintSamples = {
  name: 'outline',
  keep: (p: SamplePoint, ctx: PaintSampleContext) => (ruleKind(p.rule) === 'edge' ? !scanlinesNearRings(ctx).has(p.rule) : !nearRing(ctx, p.x, p.y)),
  points: (ctx: PaintSampleContext) => {
    const inset = SAMPLE_INSET_DEVICE_PX;
    const inImage = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < ctx.size.width && y < ctx.size.height;
    const out: SamplePoint[] = [];
    for (const { box, rings, ops } of outlined(ctx)) {
      rings.forEach((r, k) => {
        const [ol, ot, or, ob] = r.outer;
        const [il, it, ir, ib] = r.inner;
        for (const side of SIDES) {
          const horizontal = side === 'top' || side === 'bottom';
          const band = side === 'top' ? it - ot : side === 'bottom' ? ob - ib : side === 'left' ? il - ol : or - ir;
          const middle = horizontal ? Math.floor((il + ir) / 2) : Math.floor((it + ib) / 2);
          // A ring style takes the middle of the side; the side painter's styles try every position of the side's straight part
          // (between the inner corners, clear of them by the inset), nearest the middle first.
          const [lo, hi] = horizontal ? [il + inset, ir - inset - 1] : [it + inset, ib - inset - 1];
          const alongs = ops === null ? [middle] : Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i).sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b);
          const crisp = (pts: readonly (readonly [number, number])[]): boolean => ops === null || pts.every(([x, y]) => crispUnder(ops, x, y, horizontal ? inset : 0, horizontal ? 0 : inset));
          const outerEdge = side === 'top' ? ot : side === 'bottom' ? ob : side === 'left' ? ol : or;
          const inward = side === 'top' || side === 'left' ? 1 : -1;
          if (band >= 2 * inset + 1) {
            const across = inward > 0 ? outerEdge + Math.floor((band - 1) / 2) : outerEdge - 1 - Math.floor((band - 1) / 2);
            const along = alongs.find((a) => {
              const [x, y] = horizontal ? [a, across] : [across, a];
              return inImage(x, y) && crisp([[x, y]]);
            });
            if (along !== undefined) {
              const [x, y] = horizontal ? [along, across] : [across, along];
              out.push({ x, y, rule: `border:${box.id}:outline-${k}-${side}` });
            }
          }
          if (band >= inset + 1) {
            const first = inward > 0 ? outerEdge - inset - 1 : outerEdge + inset;
            const lineAt = (along: number): (readonly [number, number])[] => Array.from({ length: 2 * inset + 2 }, (_, j) => (horizontal ? [along, first + inward * j] : [first + inward * j, along]) as [number, number]);
            const along = alongs.find((a) => lineAt(a).every(([x, y]) => inImage(x, y)) && crisp(lineAt(a)));
            if (along !== undefined) for (const [x, y] of lineAt(along)) out.push({ x, y, rule: `edge:${box.id}:outline-${k}-${side}` });
          }
        }
      });
    }
    return out;
  },
};
