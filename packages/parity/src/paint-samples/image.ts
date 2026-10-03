// REPL-a Phase B (R8, sample rule image-flat): resampling filters differ between Skia, CoreGraphics and Android, so a pixel drawn
// from an image is compared only where the decoded source is uniform over every filter's support: at least 2 source px beyond
// ceil(1 / scale) on every side, where a normalised filter reproduces the constant exactly. The module drops every base rule, of
// any box, with a pixel on non-flat drawn image content, adds image-flat points on a grid over the drawn part, and adds edge scanlines
// across each side of the destination rect that lies inside the content box (compared by position, as every edge rule is).
// Non-flat content is not compared. No allowance is introduced.
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

/** The base rules, of any box, that touch a pixel inside a drawn image where the source is not flat and no opaque later box hides it. */
const dropped = new WeakMap<PaintSampleContext, ReadonlySet<string>>();
function droppedRules(ctx: PaintSampleContext): ReadonlySet<string> {
  const hit = dropped.get(ctx);
  if (hit !== undefined) return hit;
  const images = [...replacedBoxes(ctx).values()].filter((b) => b.image !== null && b.paint.drawn !== null);
  const out = new Set<string>();
  for (const p of ctx.base) {
    for (const b of images) {
      if (dropsBaseAt(b, p.x, p.y)) out.add(p.rule);
    }
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
  points: (ctx) => imagePointsOf(replacedBoxes(ctx), ctx.size),
};
