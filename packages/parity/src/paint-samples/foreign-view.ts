// REPL-a Phase B (R9, the foreign-view mask): a platform web view's own pixels are not Dragon's, so every base rule, of any box,
// with a pixel inside a web view's snapped content box is dropped, unless a later box with an opaque background hides it there;
// the iframe's border and the points outside its content box stay. The module adds no points: the web view is proven by its
// frame and configuration (device-frames, device-applied).
import type { ReplacedSamplesBox } from './replaced-geometry.ts';
import { replacedBoxes } from './replaced-geometry.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

/** Whether a device pixel shows the web view: inside its content box and not hidden by a later box with an opaque background. */
export function maskedAt(b: ReplacedSamplesBox, x: number, y: number): boolean {
  const c = b.paint.content;
  return x >= c.x && y >= c.y && x < c.x + c.width && y < c.y + c.height && !b.cover.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom);
}

const masked = new WeakMap<PaintSampleContext, ReadonlySet<string>>();
function maskedRules(ctx: PaintSampleContext): ReadonlySet<string> {
  const hit = masked.get(ctx);
  if (hit !== undefined) return hit;
  const boxes = replacedBoxes(ctx);
  const views = ctx.program.nodes.filter((n) => n.writes.some((w) => w.kind === 'foreign-view')).map((n) => {
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

export const FOREIGN_VIEW_SAMPLES: PaintSamples = {
  name: 'foreign-view',
  keep: (p, ctx) => !maskedRules(ctx).has(p.rule),
  points: () => [],
};
