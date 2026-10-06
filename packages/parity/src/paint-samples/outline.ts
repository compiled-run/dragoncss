// The outline module's sample points (T046 §2): every solid or double outline, resolved with the TS paint-outline.ts outlineRings
// (the reference the device runs translated), gets a colour point in the middle of each ring band at least 2 x SAMPLE_INSET_DEVICE_PX
// + 1 device px wide, at the middle of the side (rule border, kind border: colour-exact), and an edge scanline across the ring's outer
// edge at the middle of each side whose band holds the scanline's inner half (rule edge). A base colour point within
// SAMPLE_INSET_DEVICE_PX of a ring edge is suppressed, as is a base scanline that comes that near one: the ring's edge, not the
// point's own box, decides its colour there.
import { outlineOffsetPx, outlineRings, outlineWidthPx } from '@dragon/layout';
import type { SampleBox, SamplePoint } from '../samples.ts';
import { ruleKind, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

type OutlineWriteShape = { readonly kind: 'outline'; readonly style: 'solid' | 'double'; readonly width: number; readonly offset: number };

/** A ring: the outer and inner rect (left, top, right, bottom) in device px (square corners until the radius module lands). */
export type Ring = { readonly outer: readonly [number, number, number, number]; readonly inner: readonly [number, number, number, number] };

/** The outline write of a node, checked; null when it has none. */
export function outlineWrite(ctx: PaintSampleContext, id: string): OutlineWriteShape | null {
  const n = ctx.program.nodes.find((x) => x.id === id);
  const w = n?.writes.find((x) => x.kind === 'outline') as unknown as OutlineWriteShape | undefined;
  if (w === undefined) return null;
  if ((w.style !== 'solid' && w.style !== 'double') || !(w.width > 0) || !Number.isFinite(w.offset)) throw new Error(`${id}: the outline write is malformed`);
  return w;
}

/** The rings of a sample box's outline at the case's DPR, or none. */
export function boxRings(ctx: PaintSampleContext, b: SampleBox): Ring[] {
  const w = outlineWrite(ctx, b.id);
  if (w === null) return [];
  const v = outlineRings(b.left, b.top, b.right, b.bottom, outlineWidthPx(w.width, ctx.dpr), outlineOffsetPx(w.offset, ctx.dpr), w.style === 'double');
  const out: Ring[] = [];
  for (let k = 0; k + 8 <= v.length; k += 8) {
    const at = (j: number): number => v[k + j] as number;
    out.push({ outer: [at(0), at(1), at(2), at(3)], inner: [at(4), at(5), at(6), at(7)] });
  }
  return out;
}

const cache = new WeakMap<PaintSampleContext, readonly { readonly box: SampleBox; readonly rings: readonly Ring[] }[]>();

function outlined(ctx: PaintSampleContext): readonly { readonly box: SampleBox; readonly rings: readonly Ring[] }[] {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const out = ctx.boxes.map((box) => ({ box, rings: boxRings(ctx, box) })).filter((o) => o.rings.length > 0);
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

/** Whether a pixel is near an edge of any outline ring of the case. */
export function nearRing(ctx: PaintSampleContext, x: number, y: number): boolean {
  return outlined(ctx).some((o) => o.rings.some((r) => nearRect(x, y, r.outer, SAMPLE_INSET_DEVICE_PX) || nearRect(x, y, r.inner, SAMPLE_INSET_DEVICE_PX)));
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
    for (const { box, rings } of outlined(ctx)) {
      rings.forEach((r, k) => {
        const [ol, ot, or, ob] = r.outer;
        const [il, it, ir, ib] = r.inner;
        for (const side of SIDES) {
          const horizontal = side === 'top' || side === 'bottom';
          const band = side === 'top' ? it - ot : side === 'bottom' ? ob - ib : side === 'left' ? il - ol : or - ir;
          const along = horizontal ? Math.floor((il + ir) / 2) : Math.floor((it + ib) / 2);
          const outerEdge = side === 'top' ? ot : side === 'bottom' ? ob : side === 'left' ? ol : or;
          const inward = side === 'top' || side === 'left' ? 1 : -1;
          if (band >= 2 * inset + 1) {
            const across = inward > 0 ? outerEdge + Math.floor((band - 1) / 2) : outerEdge - 1 - Math.floor((band - 1) / 2);
            const [x, y] = horizontal ? [along, across] : [across, along];
            if (inImage(x, y)) out.push({ x, y, rule: `border:${box.id}:outline-${k}-${side}` });
          }
          if (band >= inset + 1) {
            const first = inward > 0 ? outerEdge - inset - 1 : outerEdge + inset;
            const line: SamplePoint[] = [];
            for (let j = 0; j < 2 * inset + 2; j++) {
              const p = first + inward * j;
              const [x, y] = horizontal ? [along, p] : [p, along];
              line.push({ x, y, rule: `edge:${box.id}:outline-${k}-${side}` });
            }
            if (line.every((q) => inImage(q.x, q.y))) out.push(...line);
          }
        }
      });
    }
    return out;
  },
};
