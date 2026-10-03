// The radius module's sample points (T046 §2): every rounded box, resolved with the TS paint-radius.ts (the reference the device
// runs translated), gets one point clear inside and one clear outside each rounded corner's arc along the corner diagonal (rule
// radius); an overflow: hidden rounded box gets the same pair at its padding-edge arcs (rule clip). A base colour point within
// SAMPLE_INSET_DEVICE_PX of any rounded arc is suppressed, since arc pixels are antialiased (edge samples, decisions.md Paint);
// edge scanlines stay, since they sit at mid-side where their own box's arc meets its side tangentially, unless they come near
// another box's arc, whose antialiasing then decides their colours (the whole scanline is dropped).
import { hasRoundedCorner, NO_RADIUS_FAULTS, roundedShape } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import type { SampleBox, SamplePoint } from '../samples.ts';
import { ruleKind, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import { nearRing } from './outline.ts';
import { underShadow } from './shadow.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

/** One corner's elliptical arc: the ellipse centre, its radii, the corner of the rect it rounds, and the rect's other corner direction. */
export type Arc = { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number; readonly sx: -1 | 1; readonly sy: -1 | 1; readonly corner: (typeof CORNERS)[number] };

type RadiusFactsShape = { readonly lengths: readonly { readonly percent: boolean; readonly value: number }[] };

/** The radius facts of a node (lower/paint/radius.ts RadiusFacts), or null for square corners. */
export function radiusFacts(program: NativeProgram, id: string): RadiusFactsShape | null {
  const n = program.nodes.find((x) => x.id === id);
  const f = n?.facts['radius'];
  if (f === undefined) return null;
  const lengths = (f as RadiusFactsShape).lengths;
  if (!Array.isArray(lengths) || lengths.length !== 8) throw new Error(`${id}: radius facts hold ${String(lengths?.length)} components, not 8`);
  return f as RadiusFactsShape;
}

/** The outer and padding-edge radii (16, device px) of a sample box with radius facts, or null when no corner is rounded. */
export function boxRadii(program: NativeProgram, b: SampleBox, dpr: number): number[] | null {
  const f = radiusFacts(program, b.id);
  if (f === null) return null;
  const r = roundedShape(b.left, b.top, b.right, b.bottom, b.size[0], b.size[1], [b.border.top, b.border.right, b.border.bottom, b.border.left], f.lengths, dpr, NO_RADIUS_FAULTS);
  return hasRoundedCorner(r.slice(0, 8)) ? r : null;
}

/** The rounded corners of a rect (left, top, right, bottom) with eight radii (horizontal then vertical, top-left first). */
export function rectArcs(l: number, t: number, r: number, b: number, radii: readonly number[]): Arc[] {
  const out: Arc[] = [];
  CORNERS.forEach((corner, k) => {
    const rx = radii[k] as number;
    const ry = radii[k + 4] as number;
    if (!(rx > 0 && ry > 0)) return;
    const sx = corner.endsWith('left') ? -1 : 1;
    const sy = corner.startsWith('top') ? -1 : 1;
    out.push({ cx: sx < 0 ? l + rx : r - rx, cy: sy < 0 ? t + ry : b - ry, rx, ry, sx, sy, corner });
  });
  return out;
}

/** The normalized distances of a pixel's four corners from an arc's centre, toward its corner; null when the pixel misses the corner region. */
function cornerMetrics(a: Arc, x: number, y: number, grow: number): number[] | null {
  const inRegion = a.sx < 0 ? x < a.cx : x + 1 > a.cx;
  const inRegionY = a.sy < 0 ? y < a.cy : y + 1 > a.cy;
  const withinX = a.sx < 0 ? x + 1 > a.cx - a.rx - 1 : x < a.cx + a.rx + 1;
  const withinY = a.sy < 0 ? y + 1 > a.cy - a.ry - 1 : y < a.cy + a.ry + 1;
  if (!inRegion || !inRegionY || !withinX || !withinY) return null;
  const rx = a.rx + grow;
  const ry = a.ry + grow;
  const out: number[] = [];
  for (const px of [x, x + 1]) {
    for (const py of [y, y + 1]) {
      const dx = Math.max(0, (px - a.cx) * a.sx);
      const dy = Math.max(0, (py - a.cy) * a.sy);
      out.push(rx <= 0 || ry <= 0 ? Infinity : (dx / rx) ** 2 + (dy / ry) ** 2);
    }
  }
  return out;
}

/** Whether a pixel is at least inset clear inside the arc's ellipse (every corner inside the ellipse shrunk by the inset). */
export function clearInside(a: Arc, x: number, y: number, inset: number = SAMPLE_INSET_DEVICE_PX): boolean {
  const m = cornerMetrics(a, x, y, -inset);
  return m === null || Math.max(...m) <= 1;
}

/** Whether a pixel is at least inset clear outside the arc's ellipse, inside its corner region. */
export function clearOutside(a: Arc, x: number, y: number, inset: number = SAMPLE_INSET_DEVICE_PX): boolean {
  const m = cornerMetrics(a, x, y, inset);
  return m !== null && Math.min(...m) >= 1;
}

/** Whether a pixel is within the inset of an arc (neither clear inside nor clear outside, in its corner region). */
export function nearArc(a: Arc, x: number, y: number, inset: number = SAMPLE_INSET_DEVICE_PX): boolean {
  if (cornerMetrics(a, x, y, 0) === null) return false;
  return !clearInside(a, x, y, inset) && !clearOutside(a, x, y, inset);
}

type Rounded = { readonly box: SampleBox; readonly outer: readonly Arc[]; readonly inner: readonly Arc[]; readonly innerRect: readonly [number, number, number, number] };

const cache = new WeakMap<PaintSampleContext, readonly Rounded[]>();

/** Every rounded box of a case with its outer arcs and padding-edge arcs. */
export function roundedBoxes(ctx: PaintSampleContext): readonly Rounded[] {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const out: Rounded[] = [];
  for (const b of ctx.boxes) {
    const r = boxRadii(ctx.program, b, ctx.dpr);
    if (r === null) continue;
    const il = b.left + b.border.left;
    const it = b.top + b.border.top;
    const ir = Math.max(il, b.right - b.border.right);
    const ib = Math.max(it, b.bottom - b.border.bottom);
    out.push({ box: b, outer: rectArcs(b.left, b.top, b.right, b.bottom, r.slice(0, 8)), inner: rectArcs(il, it, ir, ib, r.slice(8, 16)), innerRect: [il, it, ir, ib] });
  }
  cache.set(ctx, out);
  return out;
}

/** Whether a pixel is near any rounded arc of the case: an outer arc, or a padding-edge arc of a box with a border or a clip. */
export function nearAnyArc(ctx: PaintSampleContext, x: number, y: number): boolean {
  for (const rb of roundedBoxes(ctx)) {
    if (rb.outer.some((a) => nearArc(a, x, y))) return true;
    const b = rb.box;
    const bordered = b.border.top + b.border.right + b.border.bottom + b.border.left > 0;
    if ((bordered || b.clips) && rb.inner.some((a) => nearArc(a, x, y))) return true;
  }
  return false;
}

/** Along the corner diagonal of an arc, from the rect corner inward: the last pixel clear outside and the first clear inside. */
function diagonalPair(ctx: PaintSampleContext, a: Arc, rect: readonly [number, number, number, number]): readonly SamplePoint[] | null {
  const [l, t, r, b] = rect;
  const x0 = a.sx < 0 ? l : r - 1;
  const y0 = a.sy < 0 ? t : b - 1;
  let outside: readonly [number, number] | null = null;
  const steps = Math.ceil(Math.min(a.rx, a.ry)) + 1;
  for (let k = 0; k <= steps; k++) {
    const x = x0 - a.sx * k;
    const y = y0 - a.sy * k;
    if (x < l || x >= r || y < t || y >= b) return null;
    if (clearOutside(a, x, y)) outside = [x, y];
    else if (clearInside(a, x, y)) {
      if (outside === null) return null;
      return [{ x: outside[0], y: outside[1], rule: '' }, { x, y, rule: '' }];
    }
  }
  return null;
}

/** Whether the two border sides meeting at a corner paint the same (both absent, or the same width-bearing style and colour). */
function sidesAgree(program: NativeProgram, b: SampleBox, corner: Arc['corner']): boolean {
  const n = program.nodes.find((x) => x.id === b.id);
  const styles = n?.writes.find((w) => w.kind === 'border-styles');
  const colours = n?.writes.find((w) => w.kind === 'border-colors');
  if (styles === undefined || styles.kind !== 'border-styles' || colours === undefined || colours.kind !== 'border-colors') return true;
  const widths = [b.border.top, b.border.right, b.border.bottom, b.border.left];
  const sides = [corner.startsWith('top') ? 0 : 2, corner.endsWith('left') ? 3 : 1];
  const paint = (k: number): string => {
    const style = styles.styles[k] as string;
    const c = colours.colors[k] as { r: number; g: number; b: number; alpha: number };
    return (widths[k] as number) === 0 || style === 'none' || style === 'hidden' || c.alpha === 0 ? 'none' : `${style} ${c.r},${c.g},${c.b},${c.alpha}`;
  };
  return paint(sides[0] as number) === paint(sides[1] as number);
}

/** Whether a pixel of a rounded box lies outside its padding-edge shape (in the border band). */
function inBorderBand(rb: Rounded, x: number, y: number): boolean {
  const [l, t, r, b] = rb.innerRect;
  if (x + 1 <= l || x >= r || y + 1 <= t || y >= b) return true;
  return rb.inner.some((a) => !clearInside(a, x, y, 0));
}

const inImage = (ctx: PaintSampleContext, x: number, y: number): boolean => x >= 0 && y >= 0 && x < ctx.size.width && y < ctx.size.height;

/** Whether a pixel is near a rounded arc of a box other than id (as nearAnyArc). */
export function nearOtherArc(ctx: PaintSampleContext, id: string, x: number, y: number): boolean {
  for (const rb of roundedBoxes(ctx)) {
    if (rb.box.id === id) continue;
    if (rb.outer.some((a) => nearArc(a, x, y))) return true;
    const b = rb.box;
    const bordered = b.border.top + b.border.right + b.border.bottom + b.border.left > 0;
    if ((bordered || b.clips) && rb.inner.some((a) => nearArc(a, x, y))) return true;
  }
  return false;
}

const crossed = new WeakMap<PaintSampleContext, ReadonlySet<string>>();

/**
 * The edge scanlines of a case that come near another box's rounded arc: that arc's antialiasing, not the scanline's own edge,
 * decides its colours there, so the whole scanline is dropped (edge rules are judged per scanline).
 */
function edgesCrossingArcs(ctx: PaintSampleContext): ReadonlySet<string> {
  const hit = crossed.get(ctx);
  if (hit !== undefined) return hit;
  const out = new Set<string>();
  for (const p of ctx.base) {
    if (ruleKind(p.rule) !== 'edge' || out.has(p.rule)) continue;
    const id = p.rule.split(':')[1] as string;
    if (nearOtherArc(ctx, id, p.x, p.y)) out.add(p.rule);
  }
  crossed.set(ctx, out);
  return out;
}

export const RADIUS_SAMPLES: PaintSamples = {
  name: 'radius',
  keep: (p: SamplePoint, ctx: PaintSampleContext) => (ruleKind(p.rule) === 'edge' ? !edgesCrossingArcs(ctx).has(p.rule) : !nearAnyArc(ctx, p.x, p.y)),
  points: (ctx: PaintSampleContext) => {
    const out: SamplePoint[] = [];
    const push = (pair: readonly SamplePoint[] | null, rule: string): void => {
      if (pair === null) return;
      // Each point must also be clear of every other arc of the case, so its colour is exact on both sides, and of every shadow
      // layer, whose composite only the shadow rule's allowance covers.
      // and of every outline ring's edges and rounded corners (PNT1 outline).
      if (!pair.every((p) => inImage(ctx, p.x, p.y) && !nearAnyArc(ctx, p.x, p.y) && !underShadow(ctx, p.x, p.y) && !nearRing(ctx, p.x, p.y))) return;
      for (const p of pair) out.push({ x: p.x, y: p.y, rule });
    };
    for (const rb of roundedBoxes(ctx)) {
      const b = rb.box;
      for (const a of rb.outer) {
        const pair = diagonalPair(ctx, a, [b.left, b.top, b.right, b.bottom]);
        // The corner diagonal is where two border sides join; when they paint differently the join is antialiased, so a point on
        // it in the border band is not colour-exact.
        const inside = pair?.[1];
        if (inside !== undefined && !sidesAgree(ctx.program, b, a.corner) && inBorderBand(rb, inside.x, inside.y)) continue;
        push(pair, `radius:${b.id}:${a.corner}`);
      }
      if (b.clips) for (const a of rb.inner) push(diagonalPair(ctx, a, rb.innerRect), `clip:${b.id}:${a.corner}`);
    }
    return out;
  },
};
