// REPL-a Phase B (R8, sample rule image-flat): resampling filters differ between Skia, CoreGraphics and Android, so a pixel drawn
// from an image is compared only where the decoded source is uniform over every filter's support: at least 2 source px beyond
// ceil(1 / scale) on every side, where a normalised filter reproduces the constant exactly. The module drops every base rule, of
// any box, with a pixel on non-flat drawn image content, adds image-flat points on a grid over the drawn part, and adds edge scanlines
// across each side of the destination rect that lies inside the content box (compared by position, as every edge rule is).
// Non-flat content is not compared. No allowance is introduced.
import { viewBoxTransform } from '@dragon/layout';
import type { RgbaImage } from '../native-compare.ts';
import { ALONG_POSITIONS, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import type { SamplePoint } from '../samples.ts';
import type { ReplacedSamplesBox } from './replaced-geometry.ts';
import { replacedBoxes } from './replaced-geometry.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

/** Source px beyond ceil(1 / scale) that must be uniform around a sampled pixel (R8). */
export const IMAGE_FLAT_MARGIN_SOURCE_PX = 2;

/** Whether the device pixel [x, x + 1) x [y, y + 1) shows uniform source content: inside the drawn part, under no later box. */
export function flatAt(b: ReplacedSamplesBox, x: number, y: number): boolean {
  return flatWithin(b, x, y, false);
}

/**
 * flatAt for a pixel at an image edge: the support may run past the image's own edge (the platforms extend it differently), so
 * only the part inside the image must be uniform; an edge scanline is compared by position, never by colour.
 */
export function flatAtImageEdge(b: ReplacedSamplesBox, x: number, y: number): boolean {
  return flatWithin(b, x, y, true);
}

/** Whether a later box with an opaque background hides the device pixel, so the pixel shows that box, not the image. */
export function coveredAt(b: ReplacedSamplesBox, x: number, y: number): boolean {
  return b.cover.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom);
}

/**
 * Whether a base rule's pixel must be dropped: inside the drawn image, not hidden by an opaque later box, on source content that
 * is not flat. A pixel under a transparent later box still shows the image, so it is judged by the source alone.
 */
export function dropsBaseAt(b: ReplacedSamplesBox, x: number, y: number): boolean {
  const d = b.paint.drawn;
  if (b.image === null || d === null || x < d.x || y < d.y || x >= d.x + d.width || y >= d.y + d.height) return false;
  return !coveredAt(b, x, y) && !flatWithin(b, x, y, false, false);
}

function flatWithin(b: ReplacedSamplesBox, x: number, y: number, clampToImage: boolean, underNoLaterBox = true): boolean {
  const img = b.image;
  const d = b.paint.drawn;
  if (img === null || d === null) return false;
  if (x < d.x || y < d.y || x >= d.x + d.width || y >= d.y + d.height) return false;
  // An image-flat point shows only the image: a later box, even a transparent one, may paint over it.
  if (underNoLaterBox && b.later.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom)) return false;
  const dest = b.paint.dest;
  const sx = ((x + 0.5 - dest.x) * img.width) / dest.width;
  const sy = ((y + 0.5 - dest.y) * img.height) / dest.height;
  const rx = Math.ceil(img.width / dest.width) + IMAGE_FLAT_MARGIN_SOURCE_PX;
  const ry = Math.ceil(img.height / dest.height) + IMAGE_FLAT_MARGIN_SOURCE_PX;
  const cx = Math.floor(sx);
  const cy = Math.floor(sy);
  if (clampToImage) return uniform(img, Math.max(0, cx - rx), Math.max(0, cy - ry), Math.min(img.width - 1, cx + rx), Math.min(img.height - 1, cy + ry));
  // The support must lie inside the image: an edge pixel's filter reads past it, which the platforms clamp differently.
  if (cx - rx < 0 || cy - ry < 0 || cx + rx >= img.width || cy + ry >= img.height) return false;
  return uniform(img, cx - rx, cy - ry, cx + rx, cy + ry);
}

function uniform(img: RgbaImage, x0: number, y0: number, x1: number, y1: number): boolean {
  const at = (x: number, y: number): number => (y * img.width + x) * 4;
  const first = at(x0, y0);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = at(x, y);
      for (let k = 0; k < 4; k++) if (img.data[i + k] !== img.data[first + k]) return false;
    }
  }
  return true;
}

/**
 * The replaced boxes with neither an image nor a foreign view (an <svg>): every base rule with a pixel inside one is dropped, as
 * the box's base points assume no content there; the svg's own points (svgPointsOf) sample its shapes instead.
 */
function undrawnReplaced(ctx: PaintSampleContext): readonly { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }[] {
  const byId = new Map(ctx.program.nodes.map((n) => [n.id, n]));
  const ids = new Set<string>();
  const walk = (b: { readonly kind: string; readonly id: string; readonly children?: readonly unknown[] }): void => {
    if (b.kind === 'replaced' && !(byId.get(b.id)?.writes ?? []).some((w) => w.kind === 'replaced-image' || w.kind === 'foreign-view')) ids.add(b.id);
    for (const c of b.children ?? []) walk(c as { readonly kind: string; readonly id: string; readonly children?: readonly unknown[] });
  };
  walk(ctx.program.root as unknown as { readonly kind: string; readonly id: string; readonly children?: readonly unknown[] });
  return ctx.boxes.filter((b) => ids.has(b.id));
}

/** The base rules, of any box, that touch a pixel inside a drawn image where the source is not flat and no opaque later box hides it. */
const dropped = new WeakMap<PaintSampleContext, ReadonlySet<string>>();
function droppedRules(ctx: PaintSampleContext): ReadonlySet<string> {
  const hit = dropped.get(ctx);
  if (hit !== undefined) return hit;
  const images = [...replacedBoxes(ctx).values()].filter((b) => b.image !== null && b.paint.drawn !== null);
  const undrawn = undrawnReplaced(ctx);
  const out = new Set<string>();
  for (const p of ctx.base) {
    for (const b of images) {
      if (dropsBaseAt(b, p.x, p.y)) out.add(p.rule);
    }
    if (undrawn.some((b) => p.x >= b.left && p.x < b.right && p.y >= b.top && p.y < b.bottom)) out.add(p.rule);
  }
  dropped.set(ctx, out);
  return out;
}

const along = (lo: number, hi: number, f: number): number => Math.floor(lo + (hi - lo) * f);

/** The image module's points for replaced boxes in a raster of the given size (device px). */
export function imagePointsOf(boxes: ReadonlyMap<string, ReplacedSamplesBox>, size: { readonly width: number; readonly height: number }): SamplePoint[] {
  const out: SamplePoint[] = [];
  const inset = SAMPLE_INSET_DEVICE_PX;
  for (const [id, b] of boxes) {
    const d = b.paint.drawn;
    if (b.image === null || d === null) continue;
    // image-flat: a grid over the drawn part, inset from its edges, kept where the source is flat.
    const seen = new Set<string>();
    let k = 0;
    for (const fy of ALONG_POSITIONS) {
      for (const fx of ALONG_POSITIONS) {
        const x = along(d.x, d.x + d.width, fx);
        const y = along(d.y, d.y + d.height, fy);
        if (x < d.x + inset || x + 1 > d.x + d.width - inset || y < d.y + inset || y + 1 > d.y + d.height - inset) continue;
        // The drawn part may run past any edge of the raster (a negative object-position); only pixels inside it are sampled.
        if (x < 0 || y < 0 || x >= size.width || y >= size.height || seen.has(`${x},${y}`) || !flatAt(b, x, y)) continue;
        seen.add(`${x},${y}`);
        out.push({ x, y, rule: `image-flat:${id}:${k++}` });
      }
    }
    // edge: across each side of the destination rect that is inside the content box with room on both sides.
    const dest = b.paint.dest;
    const c = b.paint.content;
    const span = 2 * inset + 2;
    const sides = [
      { side: 'left', edge: dest.x, horizontal: false, inward: 1, lo: c.x, hi: c.x + c.width },
      { side: 'right', edge: dest.x + dest.width, horizontal: false, inward: -1, lo: c.x, hi: c.x + c.width },
      { side: 'top', edge: dest.y, horizontal: true, inward: 1, lo: c.y, hi: c.y + c.height },
      { side: 'bottom', edge: dest.y + dest.height, horizontal: true, inward: -1, lo: c.y, hi: c.y + c.height },
    ] as const;
    for (const s of sides) {
      if (s.edge - span < s.lo || s.edge + span > s.hi) continue;
      const first = s.inward > 0 ? s.edge - inset - 1 : s.edge + inset;
      const [lo, hi] = s.horizontal ? [d.x, d.x + d.width] : [d.y, d.y + d.height];
      const line = ALONG_POSITIONS.map((f) => along(lo, hi, f)).map((a) => {
        if (a < lo + inset || a + 1 > hi - inset) return null;
        const pts: (readonly [number, number])[] = [];
        for (let q = 0; q < span; q++) {
          const p = first + s.inward * q;
          pts.push(s.horizontal ? [a, p] : [p, a]);
        }
        const inside = pts.slice(inset + 1);
        return inside.every(([x, y]) => flatAtImageEdge(b, x, y)) && pts.every(([x, y]) => x >= 0 && y >= 0 && x < size.width && y < size.height) ? pts : null;
      }).find((l) => l !== null);
      if (line === undefined || line === null) continue;
      for (const [x, y] of line) out.push({ x, y, rule: `edge:${id}:image-${s.side}` });
    }
  }
  return out;
}

export const IMAGE_SAMPLES: PaintSamples = {
  name: 'image',
  keep: (p, ctx) => !droppedRules(ctx).has(p.rule),
  points: (ctx) => [...imagePointsOf(replacedBoxes(ctx), ctx.size), ...svgPointsOf(ctx)],
};

// ---------------------------------------------------------------- SVG-a2

/** Device px a svg colour point keeps from every shape edge, stroke edge, vertex and clip edge: the inset plus a pixel's half diagonal. */
export const SVG_CLEAR_DEVICE_PX = SAMPLE_INSET_DEVICE_PX + Math.SQRT1_2;
/** Steps a curve or circle is flattened into when measuring distances to it (each step is far below a device px at fixture sizes). */
const FLATTEN_STEPS = 64;
/** The grid of candidate points over an svg's content box, per axis. */
const SVG_GRID = 12;

type Pt = { readonly x: number; readonly y: number };
type Segment = readonly [Pt, Pt];

/**
 * A shape's outline in device px: its fill boundary (every subpath closed), its stroke centreline (closed subpaths closed) and
 * its vertices (where joins and caps reach past half the stroke width), from the verb-coded path through the device transform.
 */
export function svgOutline(path: readonly number[], map: (x: number, y: number) => Pt): { readonly fill: Segment[]; readonly stroke: Segment[]; readonly vertices: Pt[] } {
  const fill: Segment[] = [];
  const stroke: Segment[] = [];
  const vertices: Pt[] = [];
  let start: Pt | null = null;
  let cur: Pt | null = null;
  let curUser = { x: 0, y: 0 };
  let startUser = { x: 0, y: 0 };
  let sub: Segment[] = [];
  const flush = (closed: boolean): void => {
    if (start !== null && cur !== null && (cur.x !== start.x || cur.y !== start.y)) {
      fill.push([cur, start]);
      if (closed) stroke.push([cur, start]);
    }
    fill.push(...sub);
    stroke.push(...sub);
    sub = [];
  };
  const curve = (f: (t: number) => { x: number; y: number }): void => {
    for (let k = 1; k <= FLATTEN_STEPS; k++) {
      const u = f(k / FLATTEN_STEPS);
      const q = map(u.x, u.y);
      sub.push([cur as Pt, q]);
      cur = q;
    }
  };
  for (let i = 0; i < path.length;) {
    const v = path[i] as number;
    const a = (k: number): number => path[i + k] as number;
    if (v === 0) {
      flush(false);
      curUser = startUser = { x: a(1), y: a(2) };
      start = cur = map(a(1), a(2));
      vertices.push(cur);
      i += 3;
    } else if (v === 1) {
      const q = map(a(1), a(2));
      sub.push([cur as Pt, q]);
      cur = q;
      curUser = { x: a(1), y: a(2) };
      vertices.push(q);
      i += 3;
    } else if (v === 2) {
      const p0 = curUser;
      const [x1, y1, x, y] = [a(1), a(2), a(3), a(4)];
      curve((t) => ({ x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * x1 + t ** 2 * x, y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * y1 + t ** 2 * y }));
      curUser = { x, y };
      vertices.push(cur as Pt);
      i += 5;
    } else if (v === 3) {
      const p0 = curUser;
      const [x1, y1, x2, y2, x, y] = [a(1), a(2), a(3), a(4), a(5), a(6)];
      curve((t) => ({ x: (1 - t) ** 3 * p0.x + 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3 * x, y: (1 - t) ** 3 * p0.y + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * y }));
      curUser = { x, y };
      vertices.push(cur as Pt);
      i += 7;
    } else if (v === 4) {
      flush(true);
      cur = start;
      curUser = startUser;
      i += 1;
    } else {
      const [cx, cy, r] = [a(1), a(2), a(3)];
      flush(false);
      const ring: Segment[] = [];
      let prev = map(cx + r, cy);
      for (let k = 1; k <= 4 * FLATTEN_STEPS; k++) {
        const t = (2 * Math.PI * k) / (4 * FLATTEN_STEPS);
        const q = map(cx + r * Math.cos(t), cy + r * Math.sin(t));
        ring.push([prev, q]);
        prev = q;
      }
      fill.push(...ring);
      stroke.push(...ring);
      start = cur = null;
      i += 4;
    }
  }
  flush(false);
  return { fill, stroke, vertices };
}

/** Turns below this (radians) are a flattened curve's own steps, not joins. */
const JOIN_TURN = (5 * Math.PI) / 180;

/**
 * Where a stroke reaches past half its width: a miter join reaches half / sin(theta / 2) from its vertex (theta the angle between
 * the two segments), at most 4 half widths (the miter limit), and a butt cap's corners half a width times the square root of two.
 */
function strokeCorners(segments: readonly Segment[], half: number): { readonly at: Pt; readonly reach: number }[] {
  const out: { at: Pt; reach: number }[] = [];
  const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;
  segments.forEach((s, i) => {
    const prev = segments.find((q) => same(q[1], s[0]) && q !== s);
    if (prev === undefined) {
      out.push({ at: s[0], reach: half * Math.SQRT2 });
    } else {
      const a1 = Math.atan2(prev[1].y - prev[0].y, prev[1].x - prev[0].x);
      const a2 = Math.atan2(s[1].y - s[0].y, s[1].x - s[0].x);
      const turn = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
      if (turn > JOIN_TURN) out.push({ at: s[0], reach: half * Math.min(4, 1 / Math.max(Math.sin((Math.PI - turn) / 2), 1e-9)) });
    }
    if (!segments.some((q, j) => j !== i && same(q[0], s[1]))) out.push({ at: s[1], reach: half * Math.SQRT2 });
  });
  return out;
}

function distanceToSegment(p: Pt, [a, b]: Segment): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The svg points of a case: a grid over each svg's content box, and points a quarter stroke width either side of each wide stroke's
 * centreline, kept where the pixel is SVG_CLEAR_DEVICE_PX clear of every fill boundary, both stroke edges (half the device stroke
 * width each side of the centreline), every vertex's miter reach and the content box, inside the raster and under no later box.
 * Chrome's pixel there is one shape's solid paint or the svg's backdrop.
 */
export function svgPointsOf(ctx: PaintSampleContext): SamplePoint[] {
  const out: SamplePoint[] = [];
  const boxes = replacedBoxes(ctx);
  for (const n of ctx.program.nodes) {
    const w = n.writes.find((x) => x.kind === 'svg-shapes');
    const b = boxes.get(n.id);
    if (w === undefined || w.kind !== 'svg-shapes') continue;
    if (b === undefined) throw new Error(`${n.id}: an svg-shapes write on a box with no replaced paint geometry at DPR ${ctx.dpr}`);
    const c = b.paint.content;
    // User units are CSS px: the viewBox maps into the content box in CSS px, and the DPR takes that to device px.
    const dpr = ctx.dpr;
    const m = viewBoxTransform(w.viewBox === null ? null : { x: w.viewBox[0] as number, y: w.viewBox[1] as number, width: w.viewBox[2] as number, height: w.viewBox[3] as number }, c.width / dpr, c.height / dpr, false);
    const map = (x: number, y: number): Pt => ({ x: c.x + dpr * (m.a * x + m.e), y: c.y + dpr * (m.d * y + m.f) });
    const edges: { readonly segments: Segment[]; readonly offset: number }[] = [];
    const corners: { readonly at: Pt; readonly reach: number }[] = [];
    for (const sh of w.shapes) {
      const o = svgOutline(sh.path, map);
      // A shape with fill: none paints no fill boundary, so its stroke band is one colour across the centreline.
      if (sh.fill !== null) edges.push({ segments: o.fill, offset: 0 });
      if (sh.stroke !== null && sh.width > 0) {
        const half = (sh.width * m.a * dpr) / 2;
        edges.push({ segments: o.stroke, offset: half });
        corners.push(...strokeCorners(o.stroke, half));
      }
    }
    let k = 0;
    const seen = new Set<string>();
    const tryPixel = (x: number, y: number): void => {
      const p = { x: x + 0.5, y: y + 0.5 };
      if (seen.has(`${x},${y}`) || x < 0 || y < 0 || x >= ctx.size.width || y >= ctx.size.height) return;
      if (p.x - c.x < SVG_CLEAR_DEVICE_PX || c.x + c.width - p.x < SVG_CLEAR_DEVICE_PX || p.y - c.y < SVG_CLEAR_DEVICE_PX || c.y + c.height - p.y < SVG_CLEAR_DEVICE_PX) return;
      if (b.later.some((r) => p.x > r.left - SVG_CLEAR_DEVICE_PX && p.x < r.right + SVG_CLEAR_DEVICE_PX && p.y > r.top - SVG_CLEAR_DEVICE_PX && p.y < r.bottom + SVG_CLEAR_DEVICE_PX)) return;
      // A stroke edge lies half a width from the nearest point of the centreline, so the offset applies to the distance to the
      // whole outline, not to each segment.
      const nearEdge = edges.some((e) => Math.abs(Math.min(...e.segments.map((s) => distanceToSegment(p, s))) - e.offset) < SVG_CLEAR_DEVICE_PX);
      const nearCorner = corners.some((q) => Math.hypot(p.x - q.at.x, p.y - q.at.y) < q.reach + SVG_CLEAR_DEVICE_PX);
      if (nearEdge || nearCorner) return;
      seen.add(`${x},${y}`);
      out.push({ x, y, rule: `svg:${n.id}:${k++}` });
    };
    for (let gy = 1; gy < SVG_GRID; gy++) {
      for (let gx = 1; gx < SVG_GRID; gx++) tryPixel(Math.floor(c.x + (c.width * gx) / SVG_GRID), Math.floor(c.y + (c.height * gy) / SVG_GRID));
    }
    // Inside each wide stroke band: a point a quarter width either side of the centreline (inside and outside the fill), and on the
    // centreline of an unfilled shape, where the stroke's colour shows unless it is drawn under the fill, swapped or at another width.
    for (const sh of w.shapes) {
      if (sh.stroke === null || !(sh.width > 0)) continue;
      const half = (sh.width * m.a * dpr) / 2;
      const segs = svgOutline(sh.path, map).stroke;
      for (let j = 0; j < 8 && segs.length > 0; j++) {
        const [a, z] = segs[Math.floor((j * segs.length) / 8)] as Segment;
        const len = Math.hypot(z.x - a.x, z.y - a.y);
        if (len === 0) continue;
        const [nx, ny] = [-(z.y - a.y) / len, (z.x - a.x) / len];
        const mid = { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 };
        for (const side of sh.fill === null ? [1, 0, -1] : [1, -1]) tryPixel(Math.floor(mid.x + side * nx * (half / 2) - 0.5), Math.floor(mid.y + side * ny * (half / 2) - 0.5));
      }
    }
  }
  return out;
}
