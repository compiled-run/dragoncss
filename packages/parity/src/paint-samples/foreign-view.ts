// REPL-a Phase B (R9, the foreign-view mask): a platform web view's own pixels are not Dragon's, so every base rule, of any box,
// with a pixel inside a web view's snapped content box is dropped, unless a later box with an opaque background hides it there;
// the iframe's border and the points outside its content box stay. The module adds no points: the web view is proven by its
// frame and configuration (device-frames, device-applied).
// MEDIA-EL: a video player's pixels are the platform decoder's, so the same mask covers the part of a video's content box its
// stream is drawn into (the snapped destination rect clipped to the content box, as Chrome's VideoPainter draws it); the rest of
// the box shows its background in Chrome (the letterbox is transparent), and those points stay. Base rules rarely land there
// (a box's interior and edge rules cross the drawn rect and are dropped whole), so the module adds an interior point in the middle
// of each letterbox band wide enough for one: interior:<id>:letterbox-<side>, which shows the video's background.
import type { ReplacedSamplesBox } from './replaced-geometry.ts';
import { replacedBoxes } from './replaced-geometry.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';
import type { SamplePoint } from '../samples.ts';
import { SAMPLE_INSET_DEVICE_PX } from '../samples.ts';

/**
 * Whether a device pixel shows the platform view: inside its content box (a video's drawn rect) and not hidden by a later box with
 * an opaque background. A video whose destination misses its content box draws nothing.
 */
export function maskedAt(b: ReplacedSamplesBox, x: number, y: number): boolean {
  const c = b.video ? b.paint.drawn : b.paint.content;
  return c !== null && x >= c.x && y >= c.y && x < c.x + c.width && y < c.y + c.height && !b.cover.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom);
}

const masked = new WeakMap<PaintSampleContext, ReadonlySet<string>>();
function maskedRules(ctx: PaintSampleContext): ReadonlySet<string> {
  const hit = masked.get(ctx);
  if (hit !== undefined) return hit;
  const boxes = replacedBoxes(ctx);
  const views = ctx.program.nodes.filter((n) => n.writes.some((w) => w.kind === 'foreign-view' || w.kind === 'video-view')).map((n) => {
    const b = boxes.get(n.id);
    if (b === undefined) throw new Error(`foreign view ${n.id} has no content box`);
    return b;
  });
  const out = new Set<string>();
  for (const p of ctx.base) {
    for (const b of views) if (maskedAt(b, p.x, p.y)) out.add(p.rule);
  }
  masked.set(ctx, out);
  return out;
}

/**
 * The letterbox points of the video players: for each side of a drawn rect that leaves a band of the content box, the middle pixel
 * of the band, at least SAMPLE_INSET_DEVICE_PX from the drawn rect and from the content edge on every side, inside the raster and
 * under no later box.
 */
export function letterboxPointsOf(boxes: ReadonlyMap<string, ReplacedSamplesBox>, size: { readonly width: number; readonly height: number }): SamplePoint[] {
  const out: SamplePoint[] = [];
  const inset = SAMPLE_INSET_DEVICE_PX;
  for (const [id, b] of boxes) {
    const d = b.paint.drawn;
    const c = b.paint.content;
    if (!b.video || d === null) continue;
    const bands = [
      { side: 'left', x0: c.x, x1: d.x, y0: c.y, y1: c.y + c.height },
      { side: 'right', x0: d.x + d.width, x1: c.x + c.width, y0: c.y, y1: c.y + c.height },
      { side: 'top', x0: c.x, x1: c.x + c.width, y0: c.y, y1: d.y },
      { side: 'bottom', x0: c.x, x1: c.x + c.width, y0: d.y + d.height, y1: c.y + c.height },
    ];
    for (const band of bands) {
      if (band.x1 - band.x0 < 2 * inset + 1 || band.y1 - band.y0 < 2 * inset + 1) continue;
      const x = Math.floor((band.x0 + band.x1 - 1) / 2);
      const y = Math.floor((band.y0 + band.y1 - 1) / 2);
      if (x < 0 || y < 0 || x >= size.width || y >= size.height) continue;
      if (b.later.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom)) continue;
      out.push({ x, y, rule: `interior:${id}:letterbox-${band.side}` });
    }
  }
  return out;
}

export const FOREIGN_VIEW_SAMPLES: PaintSamples = {
  name: 'foreign-view',
  keep: (p, ctx) => !maskedRules(ctx).has(p.rule),
  points: (ctx) => letterboxPointsOf(replacedBoxes(ctx), ctx.size),
};
