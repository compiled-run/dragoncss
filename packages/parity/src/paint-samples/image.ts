// REPL-a Phase B (R8, sample rule image-flat): resampling filters differ between Skia, CoreGraphics and Android, so a pixel drawn
// from an image is compared only where the decoded source is uniform over every filter's support: at least 2 source px beyond
// ceil(1 / scale) on every side, where a normalised filter reproduces the constant exactly. The module drops every base rule, of
// any box, with a pixel on non-flat drawn image content, adds image-flat points on a grid over the drawn part, and adds edge scanlines
// across each side of the destination rect that lies inside the content box (compared by position, as every edge rule is).
// Non-flat content is not compared. A rounded img's image is clipped to its padding-edge curve: image points and scanlines keep
// clear inside it, and a base point clear outside it shows what is under the image. No allowance is introduced.
// image-rendering: pixelated (image-flat points named nearest-<n>): Chrome 145 and both native stages sample a pixelated image
// nearest-neighbour, the texel under each device pixel's centre (Skia kNearest, CoreGraphics interpolationQuality .none, Android an
// unfiltered Paint), so such a pixel is also determinate where its centre keeps IMAGE_NEAREST_CLEAR_DEVICE_PX from every texel
// boundary. Chrome maps the texels from the unsnapped destination and Dragon from the snapped one, at most 0.5 device px apart.
// The nearest points sit a quarter of a texel inside its corners, where a filtered draw would blend the neighbours in.
import { viewBoxTransform } from '@dragon/layout';
import type { RgbaImage } from '../native-compare.ts';
import { ALONG_POSITIONS, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import type { SamplePoint } from '../samples.ts';
import { clearInside, clearOutside } from './radius.ts';
import type { ReplacedSamplesBox } from './replaced-geometry.ts';
import { replacedBoxes } from './replaced-geometry.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

/** Source px beyond ceil(1 / scale) that must be uniform around a sampled pixel (R8). */
export const IMAGE_FLAT_MARGIN_SOURCE_PX = 2;

/**
 * Device px a pixelated image's pixel centre keeps from every texel boundary of the snapped destination: the 0.5 device px between
 * Chrome's unsnapped mapping and Dragon's snapped one, and a quarter pixel for each platform's sample position rounding. A centre
 * on a boundary is a tie, which Chrome 145 breaks towards the lower texel.
 */
export const IMAGE_NEAREST_CLEAR_DEVICE_PX = 0.75;

/** The texels per axis an image's nearest points cover at most (every k-th texel past that). */
const IMAGE_NEAREST_TEXELS = 8;

/** Whether a pixelated image's device pixel centre keeps IMAGE_NEAREST_CLEAR_DEVICE_PX from every texel boundary, so it shows one texel. */
export function nearestAt(b: ReplacedSamplesBox, x: number, y: number): boolean {
  const img = b.image;
  if (!b.pixelated || img === null) return false;
  const dest = b.paint.dest;
  const clear = (c: number, origin: number, extent: number, texels: number): boolean => {
    const step = extent / texels;
    const t = (c - origin) / step;
    if (t < 0 || t >= texels) return false;
    const k = Math.floor(t);
    return (t - k) * step >= IMAGE_NEAREST_CLEAR_DEVICE_PX && (k + 1 - t) * step >= IMAGE_NEAREST_CLEAR_DEVICE_PX;
  };
  return clear(x + 0.5, dest.x, dest.width, img.width) && clear(y + 0.5, dest.y, dest.height, img.height);
}

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
  // Outside a rounded img's curve the pixel shows what is under the image (the radius module drops the pixels near the curve).
  if (b.clip.some((a) => clearOutside(a, x, y, 0))) return false;
  return !coveredAt(b, x, y) && !flatWithin(b, x, y, false, false);
}

function flatWithin(b: ReplacedSamplesBox, x: number, y: number, clampToImage: boolean, underNoLaterBox = true): boolean {
  const img = b.image;
  const d = b.paint.drawn;
  if (img === null || d === null) return false;
  if (x < d.x || y < d.y || x >= d.x + d.width || y >= d.y + d.height) return false;
  if (!clearOfCurve(b, x, y)) return false;
  // An image-flat point shows only the image: a later box, even a transparent one, may paint over it.
  if (underNoLaterBox && b.later.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom)) return false;
  if (nearestAt(b, x, y)) return true;
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

/** Whether a pixel is clear inside a rounded img's curve (antialiased within SAMPLE_INSET_DEVICE_PX), or the img is square. */
export function clearOfCurve(b: ReplacedSamplesBox, x: number, y: number): boolean {
  return b.clip.every((a) => clearInside(a, x, y));
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
    // image-flat nearest points: for a pixelated image, the pixel a quarter texel inside each corner of every sampled texel, kept where it shows
    // one texel and no flat point took it.
    if (b.pixelated) {
      const img = b.image;
      const dest = b.paint.dest;
      const sx = dest.width / img.width;
      const sy = dest.height / img.height;
      const strideX = Math.ceil(img.width / IMAGE_NEAREST_TEXELS);
      const strideY = Math.ceil(img.height / IMAGE_NEAREST_TEXELS);
      let n = 0;
      for (let ty = 0; ty < img.height; ty += strideY) {
        for (let tx = 0; tx < img.width; tx += strideX) {
          for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
            const x = Math.floor(dest.x + (tx + fx) * sx);
            const y = Math.floor(dest.y + (ty + fy) * sy);
            if (x < d.x + inset || x + 1 > d.x + d.width - inset || y < d.y + inset || y + 1 > d.y + d.height - inset) continue;
            if (x < 0 || y < 0 || x >= size.width || y >= size.height || seen.has(`${x},${y}`) || !flatAt(b, x, y)) continue;
            seen.add(`${x},${y}`);
            out.push({ x, y, rule: `image-flat:${id}:nearest-${n++}` });
          }
        }
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
        return inside.every(([x, y]) => flatAtImageEdge(b, x, y)) && pts.every(([x, y]) => x >= 0 && y >= 0 && x < size.width && y < size.height && clearOfCurve(b, x, y)) ? pts : null;
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

/** A miter ratio within this share of the miter limit is too close to call: Skia's and the platforms' float tests may differ. */
const MITER_LIMIT_MARGIN = 0.01;

type Cap = 'butt' | 'round' | 'square';
type Join = 'miter' | 'round' | 'bevel';

/**
 * SVG-stroke: the geometry a stroke adds at its ends and joins, past the band half its width either side of the centreline (whose
 * edge svgPointsOf finds by distance, which is also the edge of a round cap or join).
 *
 * - edges: the straight edges of the stroke outline there. A butt cap ends at the line across its end point; a square cap at the
 *   three sides of the half-width square past it. A bevel join is the line between the two outer corners; a miter join meets at
 *   its tip, half / sin(theta / 2) from the vertex (theta the angle between the segments), and is cut to a bevel past the miter
 *   limit (SVG 2 §13.6.4, as Skia's SkStroke and CoreGraphics both draw it).
 * - discs: where the outline is not modelled (a zero-length step, or a miter ratio within MITER_LIMIT_MARGIN of the limit), a disc
 *   that holds every outline the stroke could have there.
 * - probes: points inside a square cap and outside a butt or round one, past every cap, inside a miter tip and outside a bevel,
 *   and inside a round join and outside a bevel, where a cap, join or limit drawn wrong shows.
 */
export function strokeFeatures(segments: readonly Segment[], half: number, cap: Cap, join: Join, miterLimit: number): { readonly edges: Segment[]; readonly discs: { readonly at: Pt; readonly reach: number }[]; readonly probes: Pt[] } {
  const edges: Segment[] = [];
  const discs: { at: Pt; reach: number }[] = [];
  const probes: Pt[] = [];
  const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;
  const unit = (s: Segment): Pt | null => {
    const len = Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y);
    return len === 0 ? null : { x: (s[1].x - s[0].x) / len, y: (s[1].y - s[0].y) / len };
  };
  const at = (o: Pt, ...terms: (readonly [Pt, number])[]): Pt => terms.reduce((p, [v, k]) => ({ x: p.x + v.x * k, y: p.y + v.y * k }), o);
  // An end point and the direction the path leaves it in.
  const end = (e: Pt, d: Pt | null): void => {
    if (d === null) {
      discs.push({ at: e, reach: half * Math.SQRT2 });
      return;
    }
    const n = { x: -d.y, y: d.x };
    if (cap === 'butt') edges.push([at(e, [n, half]), at(e, [n, -half])]);
    if (cap === 'square') {
      const [a, b, c, f] = [at(e, [n, half]), at(e, [n, half], [d, half]), at(e, [n, -half], [d, half]), at(e, [n, -half])];
      edges.push([a, b], [b, c], [c, f]);
    }
    probes.push(at(e, [d, half * 0.5]), at(e, [d, half * 0.6], [n, half * 0.9]), at(e, [d, half * 0.6], [n, -half * 0.9]), at(e, [d, half * 1.5]));
  };
  segments.forEach((s, i) => {
    const prev = segments.find((q) => same(q[1], s[0]) && q !== s);
    if (prev === undefined) {
      const d = unit(s);
      end(s[0], d === null ? null : { x: -d.x, y: -d.y });
    } else {
      const a = unit(prev);
      const b = unit(s);
      if (a === null || b === null) {
        discs.push({ at: s[0], reach: half * Math.max(Math.SQRT2, join === 'miter' ? miterLimit : 1) });
      } else {
        const cross = a.x * b.y - a.y * b.x;
        const turn = Math.abs(Math.atan2(cross, a.x * b.x + a.y * b.y));
        if (turn > JOIN_TURN) {
          // The outer side is opposite the turn: the right of the path for a positive cross product, else its left.
          const side = cross > 0 ? -1 : 1;
          const n1 = { x: -a.y * side, y: a.x * side };
          const n2 = { x: -b.y * side, y: b.x * side };
          const v = s[0];
          const [p1, p2] = [at(v, [n1, half]), at(v, [n2, half])];
          const bl = Math.hypot(n1.x + n2.x, n1.y + n2.y);
          const ratio = 1 / Math.max(Math.sin((Math.PI - turn) / 2), 1e-9);
          if (bl < 1e-9 || (join === 'miter' && Math.abs(ratio - miterLimit) <= MITER_LIMIT_MARGIN * miterLimit)) {
            // A path that doubles back, or a miter at its limit: nothing modelled, so a disc holds whatever is drawn.
            discs.push({ at: v, reach: half * Math.max(Math.SQRT2, join === 'miter' ? Math.min(ratio, miterLimit * (1 + MITER_LIMIT_MARGIN)) : 1) });
          } else {
            const bis = { x: (n1.x + n2.x) / bl, y: (n1.y + n2.y) / bl };
            if (join === 'miter' && ratio < miterLimit) {
              const tip = at(v, [bis, half * ratio]);
              edges.push([p1, tip], [tip, p2]);
            } else if (join !== 'round') {
              edges.push([p1, p2]);
            }
            // Inside a round join and outside its bevel (the bevel's middle is half cos(turn / 2) from the vertex); inside a miter tip.
            probes.push(at(v, [bis, (half * (1 + Math.cos(turn / 2))) / 2]));
            if (ratio > 1.2) probes.push(at(v, [bis, (half * (1 + ratio)) / 2]));
          }
        }
      }
    }
    if (!segments.some((q, j) => j !== i && same(q[0], s[1]))) end(s[1], unit(s));
  });
  return { edges, discs, probes };
}

/**
 * The distance from a point to a stroke segment whose open ends are butt or square capped: past such an end the stroke is not the
 * round band distance draws but the cap, whose edges strokeFeatures gives, so a point there is not measured from this segment.
 * An end another segment of the centreline meets is a join, and measured as distanceToSegment measures it.
 */
function distanceInsideCaps(p: Pt, s: Segment, all: readonly Segment[]): number {
  const [a, b] = s;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
  const same = (u: Pt, v: Pt): boolean => u.x === v.x && u.y === v.y;
  if (t < 0 && !all.some((q) => q !== s && same(q[1], a))) return Infinity;
  if (t > 1 && !all.some((q) => q !== s && same(q[0], b))) return Infinity;
  return distanceToSegment(p, s);
}

function distanceToSegment(p: Pt, [a, b]: Segment): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Device px a dash end on a curve may sit from where the sampler measures it, plus this share of the arc length before it. */
const DASH_CURVE_SLACK_DEVICE_PX = 1;
const DASH_CURVE_SLACK_SHARE = 0.005;

/**
 * SVG-dash: a shape's stroke centreline cut into its dashes, in device px, from the verb-coded path through the device transform:
 * the drawn pieces (each dash's run of segments, in path order, so strokeFeatures sees a dash's joins and its two ends as caps;
 * each run apart, since a stroke edge is half a width from its own dash's centreline but may lie nearer another dash's),
 * and discs where a dash end or join is not modelled. The pattern restarts at each subpath's start at the phase (Skia's
 * SkDashPath per contour, and the PDF imaging model CoreGraphics follows). Lines are measured exactly; a dash end on a curve
 * is measured along its flattening, which is not how Skia or the platforms measure arc length, so it gets a disc that grows with
 * the arc length before it. Skia joins a closed subpath's last dash to its first where both cover the start, which is not
 * proven on native, so the start of such a subpath gets a disc too.
 */
export function svgDashPieces(path: readonly number[], map: (x: number, y: number) => Pt, dashes: readonly number[], phase: number, half: number, join: Join, miterLimit: number): { readonly pieces: Segment[][]; readonly discs: { readonly at: Pt; readonly reach: number }[] } {
  type Step = { readonly a: Pt; readonly b: Pt; readonly curved: boolean };
  const subpaths: { steps: Step[]; closed: boolean }[] = [];
  let steps: Step[] = [];
  let start: Pt | null = null;
  let cur: Pt | null = null;
  let user = { x: 0, y: 0 };
  let startUser = { x: 0, y: 0 };
  const end = (closed: boolean): void => {
    if (closed && start !== null && cur !== null && (cur.x !== start.x || cur.y !== start.y)) steps.push({ a: cur, b: start, curved: false });
    if (steps.length > 0) subpaths.push({ steps, closed });
    steps = [];
  };
  const curve = (f: (t: number) => { x: number; y: number }): void => {
    for (let k = 1; k <= FLATTEN_STEPS; k++) {
      const u = f(k / FLATTEN_STEPS);
      const q = map(u.x, u.y);
      steps.push({ a: cur as Pt, b: q, curved: true });
      cur = q;
    }
  };
  for (let i = 0; i < path.length;) {
    const v = path[i] as number;
    const a = (k: number): number => path[i + k] as number;
    if (v === 0) {
      end(false);
      user = startUser = { x: a(1), y: a(2) };
      start = cur = map(a(1), a(2));
      i += 3;
    } else if (v === 1) {
      const q = map(a(1), a(2));
      steps.push({ a: cur as Pt, b: q, curved: false });
      cur = q;
      user = { x: a(1), y: a(2) };
      i += 3;
    } else if (v === 2) {
      const p0 = user;
      const [x1, y1, x, y] = [a(1), a(2), a(3), a(4)];
      curve((t) => ({ x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * x1 + t ** 2 * x, y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * y1 + t ** 2 * y }));
      user = { x, y };
      i += 5;
    } else if (v === 3) {
      const p0 = user;
      const [x1, y1, x2, y2, x, y] = [a(1), a(2), a(3), a(4), a(5), a(6)];
      curve((t) => ({ x: (1 - t) ** 3 * p0.x + 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3 * x, y: (1 - t) ** 3 * p0.y + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * y }));
      user = { x, y };
      i += 7;
    } else if (v === 4) {
      end(true);
      cur = start;
      user = startUser;
      i += 1;
    } else {
      // A circle: where its dashes start is refused on native (computed-checks.ts), so every dash end on it is a disc.
      end(false);
      const [cx, cy, r] = [a(1), a(2), a(3)];
      start = cur = map(cx + r, cy);
      for (let k = 1; k <= 4 * FLATTEN_STEPS; k++) {
        const t = (2 * Math.PI * k) / (4 * FLATTEN_STEPS);
        const q = map(cx + r * Math.cos(t), cy + r * Math.sin(t));
        steps.push({ a: cur, b: q, curved: true });
        cur = q;
      }
      end(false);
      start = cur = null;
      i += 4;
    }
  }
  end(false);
  const pieces: Segment[][] = [];
  const discs: { at: Pt; reach: number }[] = [];
  const endReach = half * Math.SQRT2;
  const joinReach = half * Math.max(Math.SQRT2, join === 'miter' ? miterLimit : 1);
  for (const sp of subpaths) {
    // Where the phase falls: the interval it is in and what of that interval is left.
    let k = 0;
    let left = phase;
    while (left >= (dashes[k] as number)) {
      left -= dashes[k] as number;
      k = (k + 1) % dashes.length;
    }
    left = (dashes[k] as number) - left;
    const onAtStart = k % 2 === 0;
    let walked = 0;
    let curved = false;
    let dashStart = true;
    for (const s of sp.steps) {
      const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      curved ||= s.curved;
      let at = 0;
      while (at < len) {
        const take = Math.min(left, len - at);
        // A step's own ends exactly, so the pieces of one dash meet where strokeFeatures looks for its joins.
        const p = (d: number): Pt => (d === 0 ? s.a : d === len ? s.b : { x: s.a.x + ((s.b.x - s.a.x) * d) / len, y: s.a.y + ((s.b.y - s.a.y) * d) / len });
        if (k % 2 === 0 && take > 0) {
          if (dashStart) pieces.push([]);
          dashStart = false;
          (pieces[pieces.length - 1] as Segment[]).push([p(at), p(at + take)]);
        }
        at += take;
        left -= take;
        if (left <= 0) {
          // A dash starts or ends here.
          if (curved) discs.push({ at: p(at), reach: endReach + DASH_CURVE_SLACK_DEVICE_PX + DASH_CURVE_SLACK_SHARE * (walked + at) });
          k = (k + 1) % dashes.length;
          left = dashes[k] as number;
          dashStart = true;
        }
      }
      walked += len;
    }
    if (sp.closed && onAtStart && k % 2 === 0) discs.push({ at: (sp.steps[0] as Step).a, reach: joinReach });
  }
  return { pieces, discs };
}

/**
 * The drawn stroke centreline of a shape in device px: its outline's (svgOutline), one run, or its dashes (svgDashPieces), a run
 * each, with the discs they leave unmodelled. scale takes user units to device px.
 */
function strokeCentre(sh: { readonly path: readonly number[]; readonly join: Join; readonly miterLimit: number; readonly dashes: readonly number[]; readonly dashPhase: number }, map: (x: number, y: number) => Pt, scale: number, half: number): { readonly segments: Segment[]; readonly runs: Segment[][]; readonly discs: { readonly at: Pt; readonly reach: number }[] } {
  if (sh.dashes.length === 0) {
    const segments = svgOutline(sh.path, map).stroke;
    return { segments, runs: [segments], discs: [] };
  }
  const d = svgDashPieces(sh.path, map, sh.dashes.map((x) => x * scale), sh.dashPhase * scale, half, sh.join, sh.miterLimit);
  return { segments: d.pieces.flat(), runs: d.pieces, discs: d.discs };
}

/** The CSS px of a shape's stroke width and dashes per user unit: the viewBox scale, or 1 for SVG-vector-effect's non-scaling-stroke. */
function strokeScale(sh: { readonly nonScalingStroke: boolean }, viewBoxScale: number): number {
  return sh.nonScalingStroke ? 1 : viewBoxScale;
}

/**
 * The svg points of a case: a grid over each svg's content box, points a quarter stroke width either side of each wide stroke's
 * centreline, and the cap and join probes of strokeFeatures, kept where the pixel is SVG_CLEAR_DEVICE_PX clear of every fill
 * boundary, both stroke edges (half the device stroke width each side of the centreline), every cap and join edge and unmodelled
 * disc, and the content box, inside the raster and under no later box.
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
    const edges: { readonly segments: Segment[]; readonly offset: number; readonly capped?: boolean }[] = [];
    const corners: { readonly at: Pt; readonly reach: number }[] = [];
    const probes: Pt[] = [];
    for (const sh of w.shapes) {
      const o = svgOutline(sh.path, map);
      // A shape with fill: none, or a fill of alpha 0 (fill-opacity: 0), paints no fill boundary, so its stroke band is one colour
      // across the centreline.
      if (sh.fill !== null && sh.fill.alpha > 0) edges.push({ segments: o.fill, offset: 0 });
      if (sh.stroke !== null && sh.width > 0) {
        const scale = strokeScale(sh, m.a) * dpr;
        const half = (sh.width * scale) / 2;
        const centre = strokeCentre(sh, map, scale, half);
        corners.push(...centre.discs);
        for (const run of centre.runs) if (run.length > 0) edges.push({ segments: run, offset: half, capped: sh.cap !== 'round' });
        const f = strokeFeatures(centre.segments, half, sh.cap, sh.join, sh.miterLimit);
        if (f.edges.length > 0) edges.push({ segments: f.edges, offset: 0 });
        corners.push(...f.discs);
        probes.push(...f.probes);
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
      const nearEdge = edges.some((e) => Math.abs(Math.min(...e.segments.map((s) => (e.capped === true ? distanceInsideCaps(p, s, e.segments) : distanceToSegment(p, s)))) - e.offset) < SVG_CLEAR_DEVICE_PX);
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
      const scale = strokeScale(sh, m.a) * dpr;
      const half = (sh.width * scale) / 2;
      const segs = strokeCentre(sh, map, scale, half).segments;
      for (let j = 0; j < 8 && segs.length > 0; j++) {
        const [a, z] = segs[Math.floor((j * segs.length) / 8)] as Segment;
        const len = Math.hypot(z.x - a.x, z.y - a.y);
        if (len === 0) continue;
        const [nx, ny] = [-(z.y - a.y) / len, (z.x - a.x) / len];
        const mid = { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 };
        for (const side of sh.fill === null ? [1, 0, -1] : [1, -1]) tryPixel(Math.floor(mid.x + side * nx * (half / 2) - 0.5), Math.floor(mid.y + side * ny * (half / 2) - 0.5));
      }
    }
    // SVG-stroke: at each cap and join, the points where another cap, join or miter limit would paint a different colour.
    for (const q of probes) tryPixel(Math.floor(q.x), Math.floor(q.y));
  }
  return out;
}
