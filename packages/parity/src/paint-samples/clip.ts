// The clip module's sample points (MASK-CLIP): for every box with a clip-path inset() write, a pair of points across each side of its
// clip rect (dragon clipPathRect, the device's rect in device px), SAMPLE_INSET_DEVICE_PX inside and outside the edge, at the
// middle of the side: the inside point shows the box's paint, the outside one what lies under the clipped part. A side whose
// rect is too narrow across for a clear inside point, and a rect the insets leave empty, get none.
import { clipPathInsets, clipPathRect } from 'dragon';
import type { SamplePoint } from '../samples.ts';
import { SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import type { PaintSamples } from './types.ts';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export const CLIP_SAMPLES: PaintSamples = {
  name: 'clip',
  keep: () => true,
  points: (ctx) => {
    const inset = SAMPLE_INSET_DEVICE_PX;
    const out: SamplePoint[] = [];
    const inImage = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < ctx.size.width && y < ctx.size.height;
    const nodes = new Map(ctx.program.nodes.map((n) => [n.id, n]));
    for (const b of ctx.boxes) {
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
