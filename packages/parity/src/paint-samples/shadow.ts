// The shadow module's sample points (T046 §2): the shadow layers of every box with a box-shadow, from the TS paint-shadow.ts the
// device runs translated. Points on each blur ramp (rule shadow) sit where every shadow of the box is smooth (the coverage of each
// shadow alone spans at most a quarter of full coverage over the point's 5 x 5 neighbourhood, so no antialiased shadow edge is near,
// whatever the shadow's colour alpha), where no other box's layers paint and no other box (ancestors aside) comes within
// SAMPLE_INSET_DEVICE_PX, and at least SAMPLE_INSET_DEVICE_PX clear of the box's own border box or inside its padding box; they
// compare at the shadow allowance (allowances/shadow.ts). A base colour point a shadow layer paints over is suppressed, since its
// colour is the platform's composite of the shadow, which only the shadow rule's allowance covers.
import { insetShadowLayer, NO_SHADOW_FAULTS, outerShadowLayer } from '@dragon/layout';
import type { ShadowInput, ShadowLayer } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import type { SampleBox, SamplePoint } from '../samples.ts';
import { ruleKind, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import { boxRadii, nearAnyArc } from './radius.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

const I = SAMPLE_INSET_DEVICE_PX;

type ShadowFactsShape = { readonly shadows: readonly { readonly inset: boolean; readonly x: number; readonly y: number; readonly blur: number; readonly spread: number; readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number } }[] };

/** The shadow inputs of a node from its shadow facts (lower/paint/shadow.ts ShadowFacts), or null for none. */
export function shadowInputs(program: NativeProgram, id: string): ShadowInput[] | null {
  const f = program.nodes.find((n) => n.id === id)?.facts['shadow'] as ShadowFactsShape | undefined;
  if (f === undefined) return null;
  if (!Array.isArray(f.shadows) || f.shadows.length === 0) throw new Error(`${id}: shadow facts hold no shadow list`);
  return f.shadows.map((s, i) => {
    const nums = [s.x, s.y, s.blur, s.spread, s.color?.r, s.color?.g, s.color?.b, s.color?.alpha];
    if (typeof s.inset !== 'boolean' || !nums.every((v) => typeof v === 'number' && Number.isFinite(v)) || !(s.blur >= 0)) throw new Error(`${id}: shadow ${i} of the facts is malformed: ${JSON.stringify(s)}`);
    return { inset: s.inset, x: s.x, y: s.y, blur: s.blur, spread: s.spread, r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.alpha };
  });
}

/** Whether a node paints an opaque background (BoxPainterBase's has_opaque_background). */
function opaqueBackground(program: NativeProgram, id: string): boolean {
  const w = program.nodes.find((n) => n.id === id)?.writes.find((x) => x.kind === 'background-color');
  return w !== undefined && w.kind === 'background-color' && w.color.alpha === 255;
}

/** A box's outer and inset layers, and the coverage of each of its shadows alone (drawn opaque black) for the smoothness test. */
export type BoxShadowLayers = { readonly box: SampleBox; readonly outer: ShadowLayer; readonly inset: ShadowLayer; readonly coverage: readonly ShadowLayer[] };

const cache = new WeakMap<PaintSampleContext, readonly BoxShadowLayers[]>();

/** The outer and inset shadow layers of every box of a case with shadows, as the device rasters them. */
export function shadowLayers(ctx: PaintSampleContext): readonly BoxShadowLayers[] {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const out: BoxShadowLayers[] = [];
  for (const b of ctx.boxes) {
    const shadows = shadowInputs(ctx.program, b.id);
    if (shadows === null) continue;
    const r = boxRadii(ctx.program, b, ctx.dpr);
    const outerRadii = r === null ? [0, 0, 0, 0, 0, 0, 0, 0] : r.slice(0, 8);
    const innerRadii = r === null ? [0, 0, 0, 0, 0, 0, 0, 0] : r.slice(8, 16);
    const opaque = opaqueBackground(ctx.program, b.id);
    const borders = [b.border.top, b.border.right, b.border.bottom, b.border.left];
    const layerOf = (list: readonly ShadowInput[]): ShadowLayer[] => [
      outerShadowLayer(b.left, b.top, b.right, b.bottom, outerRadii, opaque, list, ctx.dpr, NO_SHADOW_FAULTS),
      insetShadowLayer(b.left, b.top, b.right, b.bottom, borders, innerRadii, list, ctx.dpr, NO_SHADOW_FAULTS),
    ];
    const [outer, inset] = layerOf(shadows) as [ShadowLayer, ShadowLayer];
    const coverage = shadows.flatMap((s) => layerOf([{ ...s, r: 0, g: 0, b: 0, a: 255 }]));
    out.push({ box: b, outer, inset, coverage });
  }
  cache.set(ctx, out);
  return out;
}

/** A layer's alpha at page pixel (x, y), 0 outside it. */
export function layerAlpha(l: ShadowLayer, x: number, y: number): number {
  if (x < l.left || x >= l.right || y < l.top || y >= l.bottom) return 0;
  return l.rgba[4 * ((y - l.top) * (l.right - l.left) + (x - l.left)) + 3] as number;
}

/** Whether every shadow of a box is smooth around (x, y): each one's coverage over the 5 x 5 neighbourhood spans at most 64 levels. */
export function coverageSmooth(s: BoxShadowLayers, x: number, y: number): boolean {
  for (const l of s.coverage) {
    let lo = 255;
    let hi = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const a = layerAlpha(l, x + dx, y + dy);
        lo = Math.min(lo, a);
        hi = Math.max(hi, a);
      }
    }
    if (hi - lo > 64) return false;
  }
  return true;
}

/** Whether box a is an ancestor of box b in the program. */
function ancestor(program: NativeProgram, a: string, b: string): boolean {
  const byId = new Map(program.nodes.map((n) => [n.id, n]));
  for (let p = byId.get(b)?.parent ?? null; p !== null; p = byId.get(p)?.parent ?? null) if (p === a) return true;
  return false;
}

/**
 * Whether (x, y) is a clear shadow pixel of s: only s's layers paint it, every shadow of s is smooth there, no later box (s's
 * descendants and every later subtree) comes within SAMPLE_INSET_DEVICE_PX of it, and every earlier box (painted beneath the shadow:
 * its ancestors and every earlier subtree, whose backgrounds the device bakes the shadow against) has no edge or rounded arc
 * within SAMPLE_INSET_DEVICE_PX of it, so the backdrop is one colour there.
 */
export function clearShadowPixel(ctx: PaintSampleContext, s: BoxShadowLayers, x: number, y: number): boolean {
  const all = shadowLayers(ctx);
  if (all.some((o) => o !== s && (layerAlpha(o.outer, x, y) > 0 || layerAlpha(o.inset, x, y) > 0))) return false;
  if (!coverageSmooth(s, x, y)) return false;
  const at = ctx.boxes.findIndex((b) => b.id === s.box.id);
  return ctx.boxes.every((b, i) => {
    if (i === at || ancestor(ctx.program, b.id, s.box.id)) return true;
    if (i > at) return clearOutsideBox(b, x, y);
    return (clearOutsideBox(b, x, y) || (x >= b.left + I && x + 1 <= b.right - I && y >= b.top + I && y + 1 <= b.bottom - I)) && !nearAnyArc(ctx, x, y);
  });
}

const clearOutsideBox = (b: SampleBox, x: number, y: number): boolean => x + 1 <= b.left - I || x >= b.right + I || y + 1 <= b.top - I || y >= b.bottom + I;
const clearInsidePadding = (b: SampleBox, x: number, y: number): boolean => x >= b.left + b.border.left + I && x + 1 <= b.right - b.border.right - I && y >= b.top + b.border.top + I && y + 1 <= b.bottom - b.border.bottom - I;

/** Whether any shadow layer of the case paints pixel (x, y). */
export function underShadow(ctx: PaintSampleContext, x: number, y: number): boolean {
  return shadowLayers(ctx).some((s) => layerAlpha(s.outer, x, y) > 0 || layerAlpha(s.inset, x, y) > 0);
}

/** Up to two points of a layer along a line from (x0, y0) stepping (dx, dy): painted, clear and passing the test. */
function along(ctx: PaintSampleContext, s: BoxShadowLayers, l: ShadowLayer, x0: number, y0: number, dx: number, dy: number, steps: number, ok: (x: number, y: number) => boolean): SamplePoint[] {
  const out: SamplePoint[] = [];
  for (let k = 0; k < steps && out.length < 2; k++) {
    const x = x0 + k * dx;
    const y = y0 + k * dy;
    if (layerAlpha(l, x, y) > 0 && ok(x, y) && clearShadowPixel(ctx, s, x, y)) out.push({ x, y, rule: '' });
  }
  return out;
}

export const SHADOW_SAMPLES: PaintSamples = {
  name: 'shadow',
  keep: (p: SamplePoint, ctx: PaintSampleContext) => ruleKind(p.rule) === 'edge' || !underShadow(ctx, p.x, p.y),
  points: (ctx: PaintSampleContext) => {
    const out: SamplePoint[] = [];
    const inImage = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < ctx.size.width && y < ctx.size.height;
    for (const s of shadowLayers(ctx)) {
      const b = s.box;
      const cx = Math.floor((b.left + b.right) / 2);
      const cy = Math.floor((b.top + b.bottom) / 2);
      const pts: SamplePoint[] = [];
      // The outer ramp outward from the middle of each side, every other pixel.
      const outside = (x: number, y: number): boolean => inImage(x, y) && clearOutsideBox(b, x, y);
      if (s.outer.rgba.length > 0) {
        pts.push(...along(ctx, s, s.outer, cx, b.top - I - 1, 0, -2, 64, outside));
        pts.push(...along(ctx, s, s.outer, b.right + I, cy, 2, 0, 64, outside));
        pts.push(...along(ctx, s, s.outer, cx, b.bottom + I, 0, 2, 64, outside));
        pts.push(...along(ctx, s, s.outer, b.left - I - 1, cy, -2, 0, 64, outside));
      }
      // The inset ramp inward from the middle of each side of the padding box.
      const inside = (x: number, y: number): boolean => inImage(x, y) && clearInsidePadding(b, x, y);
      if (s.inset.rgba.length > 0) {
        pts.push(...along(ctx, s, s.inset, cx, b.top + b.border.top + I, 0, 2, 64, inside));
        pts.push(...along(ctx, s, s.inset, b.right - b.border.right - I - 1, cy, -2, 0, 64, inside));
        pts.push(...along(ctx, s, s.inset, cx, b.bottom - b.border.bottom - I - 1, 0, -2, 64, inside));
        pts.push(...along(ctx, s, s.inset, b.left + b.border.left + I, cy, 2, 0, 64, inside));
      }
      pts.forEach((p, k) => out.push({ x: p.x, y: p.y, rule: `shadow:${b.id}:${k}` }));
    }
    return out;
  },
};
