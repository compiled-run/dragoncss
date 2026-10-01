// REPL-a Phase B (R9, the foreign-view mask): a platform web view's own pixels are not Dragon's, so every base rule, of any box,
// with a pixel inside a web view's snapped content box is dropped; the iframe's border and the points outside its content box
// stay. The module adds no points: the web view is proven by its frame and configuration (device-frames, device-applied).
import { replacedBoxes } from './replaced-geometry.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

const masked = new WeakMap<PaintSampleContext, ReadonlySet<string>>();
function maskedRules(ctx: PaintSampleContext): ReadonlySet<string> {
  const hit = masked.get(ctx);
  if (hit !== undefined) return hit;
  const boxes = replacedBoxes(ctx);
  const views = ctx.program.nodes.filter((n) => n.writes.some((w) => w.kind === 'foreign-view')).map((n) => {
    const c = boxes.get(n.id)?.paint.content;
    if (c === undefined) throw new Error(`foreign view ${n.id} has no content box`);
    return c;
  });
  const out = new Set<string>();
  for (const p of ctx.base) {
    for (const c of views) if (p.x >= c.x && p.y >= c.y && p.x < c.x + c.width && p.y < c.y + c.height) out.add(p.rule);
  }
  masked.set(ctx, out);
  return out;
}

export const FOREIGN_VIEW_SAMPLES: PaintSamples = {
  name: 'foreign-view',
  keep: (p, ctx) => !maskedRules(ctx).has(p.rule),
  points: () => [],
};
