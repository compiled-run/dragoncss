// The shadow module's sample points (T046 §2): the shadow layers of every box with a box-shadow, from the TS paint-shadow.ts the
// device runs translated. Points on each blur ramp (rule shadow) sit where the layer is smooth (its 5 x 5 neighbourhood spans at
// most a quarter of full alpha, so no antialiased edge is near) and at least SAMPLE_INSET_DEVICE_PX clear of the border box; they
// compare at the shadow allowance (allowances/shadow.ts). A base colour point a shadow layer paints over is suppressed, since its
// colour is the platform's composite of the shadow, which only the shadow rule's allowance covers.
import { insetShadowLayer, NO_SHADOW_FAULTS, outerShadowLayer } from '@dragon/layout';
import type { ShadowInput, ShadowLayer } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import type { SampleBox, SamplePoint } from '../samples.ts';
import { ruleKind, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import { boxRadii } from './radius.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

type ShadowFactsShape = { readonly shadows: readonly { readonly inset: boolean; readonly x: number; readonly y: number; readonly blur: number; readonly spread: number; readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number } }[] };

/** The shadow inputs of a node from its shadow facts (lower/paint/shadow.ts ShadowFacts), or null for none. */
export function shadowInputs(program: NativeProgram, id: string): ShadowInput[] | null {
  const f = program.nodes.find((n) => n.id === id)?.facts['shadow'] as ShadowFactsShape | undefined;
  if (f === undefined) return null;
  return f.shadows.map((s) => ({ inset: s.inset, x: s.x, y: s.y, blur: s.blur, spread: s.spread, r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.alpha }));
}

/** Whether a node paints an opaque background (BoxPainterBase's has_opaque_background). */
function opaqueBackground(program: NativeProgram, id: string): boolean {
  const w = program.nodes.find((n) => n.id === id)?.writes.find((x) => x.kind === 'background-color');
  return w !== undefined && w.kind === 'background-color' && w.color.alpha === 255;
}

export type BoxShadowLayers = { readonly box: SampleBox; readonly outer: ShadowLayer; readonly inset: ShadowLayer };

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
    const outer = outerShadowLayer(b.left, b.top, b.right, b.bottom, r === null ? [0, 0, 0, 0, 0, 0, 0, 0] : r.slice(0, 8), opaqueBackground(ctx.program, b.id), shadows, ctx.dpr, NO_SHADOW_FAULTS);
    const inset = insetShadowLayer(b.left, b.top, b.right, b.bottom, [b.border.top, b.border.right, b.border.bottom, b.border.left], r === null ? [0, 0, 0, 0, 0, 0, 0, 0] : r.slice(8, 16), shadows, ctx.dpr, NO_SHADOW_FAULTS);
    out.push({ box: b, outer, inset });
  }
  cache.set(ctx, out);
  return out;
}

/** A layer's alpha at page pixel (x, y), 0 outside it. */
export function layerAlpha(l: ShadowLayer, x: number, y: number): number {
  if (x < l.left || x >= l.right || y < l.top || y >= l.bottom) return 0;
  return l.rgba[4 * ((y - l.top) * (l.right - l.left) + (x - l.left)) + 3] as number;
}

/** Whether a layer is smooth around (x, y): its 5 x 5 neighbourhood's alpha spans at most 64 levels, so no sharp edge is near. */
function smooth(l: ShadowLayer, x: number, y: number): boolean {
  let lo = 255;
  let hi = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const a = layerAlpha(l, x + dx, y + dy);
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
  }
  return hi - lo <= 64;
}

const I = SAMPLE_INSET_DEVICE_PX;
const clearOutsideBox = (b: SampleBox, x: number, y: number): boolean => x + 1 <= b.left - I || x >= b.right + I || y + 1 <= b.top - I || y >= b.bottom + I;
const clearInsidePadding = (b: SampleBox, x: number, y: number): boolean => x >= b.left + b.border.left + I && x + 1 <= b.right - b.border.right - I && y >= b.top + b.border.top + I && y + 1 <= b.bottom - b.border.bottom - I;

/** Whether any shadow layer of the case paints pixel (x, y). */
export function underShadow(ctx: PaintSampleContext, x: number, y: number): boolean {
  return shadowLayers(ctx).some((s) => layerAlpha(s.outer, x, y) > 0 || layerAlpha(s.inset, x, y) > 0);
}

/** Up to two points of a layer along a line from (x0, y0) stepping (dx, dy): painted, smooth and passing the test. */
function along(l: ShadowLayer, x0: number, y0: number, dx: number, dy: number, steps: number, ok: (x: number, y: number) => boolean): SamplePoint[] {
  const out: SamplePoint[] = [];
  for (let k = 0; k < steps && out.length < 2; k++) {
    const x = x0 + k * dx;
    const y = y0 + k * dy;
    const a = layerAlpha(l, x, y);
    if (a > 0 && ok(x, y) && smooth(l, x, y)) out.push({ x, y, rule: '' });
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
        pts.push(...along(s.outer, cx, b.top - I - 1, 0, -2, 64, outside));
        pts.push(...along(s.outer, b.right + I, cy, 2, 0, 64, outside));
        pts.push(...along(s.outer, cx, b.bottom + I, 0, 2, 64, outside));
        pts.push(...along(s.outer, b.left - I - 1, cy, -2, 0, 64, outside));
      }
      // The inset ramp inward from the middle of each side of the padding box.
      const inside = (x: number, y: number): boolean => inImage(x, y) && clearInsidePadding(b, x, y);
      if (s.inset.rgba.length > 0) {
        pts.push(...along(s.inset, cx, b.top + b.border.top + I, 0, 2, 64, inside));
        pts.push(...along(s.inset, b.right - b.border.right - I - 1, cy, -2, 0, 64, inside));
        pts.push(...along(s.inset, cx, b.bottom - b.border.bottom - I - 1, 0, -2, 64, inside));
        pts.push(...along(s.inset, b.left + b.border.left + I, cy, 2, 0, 64, inside));
      }
      pts.forEach((p, k) => out.push({ x: p.x, y: p.y, rule: `shadow:${b.id}:${k}` }));
    }
    return out;
  },
};
