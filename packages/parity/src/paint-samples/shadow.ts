// The shadow module's sample points (T046 §2): the shadow layers of every box with a box-shadow, from the TS paint-shadow.ts the
// device runs translated. Points on each blur ramp (rule shadow) sit where every shadow of the box is smooth (the coverage of each
// shadow alone spans at most a quarter of full coverage over the point's 5 x 5 neighbourhood, so no antialiased shadow edge is near,
// whatever the shadow's colour alpha), where no other box's layers paint and no other box (ancestors aside) comes within
// SAMPLE_INSET_DEVICE_PX, and at least SAMPLE_INSET_DEVICE_PX clear of the box's own border box or inside its padding box; they
// compare at the shadow allowance (allowances/shadow.ts). A base colour point a shadow layer paints over is suppressed, since its
// colour is the platform's composite of the shadow, which only the shadow rule's allowance covers. A box with its own scale and
// translate has its outer layers drawn under it (paint-shadow.ts shadowTransform), and its points keep clear of its mapped box.
import { IDENTITY_SHADOW_TRANSFORM, insetShadowLayer, mapPoint, NO_SHADOW_FAULTS, outerShadowLayerMapped, paintTransformMatrix, shadowTransform } from '@dragon/layout';
import type { Matrix2D, ShadowInput, ShadowLayer, ShadowTransform, TransformOp, TransformOrigin } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import type { SampleBox, SamplePoint } from '../samples.ts';
import { ruleKind, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import { boxRadii } from './radius.ts';
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

/** The scale and translate of a box from its transform facts (dragon lower/paint/transform.ts), or the identity without one. */
export function ownShadowTransform(program: NativeProgram, id: string, left: number, top: number, right: number, bottom: number, dpr: number): ShadowTransform {
  const f = program.nodes.find((n) => n.id === id)?.facts['transform'] as TransformFacts | undefined;
  if (f === undefined || f.ops.length === 0) return IDENTITY_SHADOW_TRANSFORM;
  return shadowTransform(f.ops, f.origin, left, top, right, bottom, dpr, { sin: Math.sin, cos: Math.cos });
}

type TransformFacts = { readonly ops: readonly TransformOp[]; readonly origin: TransformOrigin };

/** Where a box paints: the bounds of its box mapped by its own and its ancestors' transforms (each about its origin, in device px). */
function deviceBounds(ctx: PaintSampleContext, b: SampleBox): SampleBox {
  const nodes = new Map(ctx.program.nodes.map((n) => [n.id, n]));
  const boxes = new Map(ctx.boxes.map((x) => [x.id, x]));
  let corners = [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]];
  for (let id: string | null = b.id; id !== null; id = nodes.get(id)?.parent ?? null) {
    const f = nodes.get(id)?.facts['transform'] as TransformFacts | undefined;
    const o = boxes.get(id);
    if (f === undefined || f.ops.length === 0 || o === undefined) continue;
    const m = paintTransformMatrix(f.ops, f.origin, (o.right - o.left) / ctx.dpr, (o.bottom - o.top) / ctx.dpr, { sin: Math.sin, cos: Math.cos });
    const d: Matrix2D = { full: true, a: m.a, b: m.b, c: m.c, d: m.d, e: o.left + m.e * ctx.dpr - m.a * o.left - m.c * o.top, f: o.top + m.f * ctx.dpr - m.b * o.left - m.d * o.top };
    corners = corners.map(([x, y]) => { const p = mapPoint(d, x as number, y as number); return [p.x, p.y]; });
  }
  const xs = corners.map((c) => c[0] as number);
  const ys = corners.map((c) => c[1] as number);
  return { ...b, left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** A box mapped by a scale and translate. */
function mappedBox(b: SampleBox, m: ShadowTransform): SampleBox {
  return { ...b, left: m.sx * b.left + m.tx, top: m.sy * b.top + m.ty, right: m.sx * b.right + m.tx, bottom: m.sy * b.bottom + m.ty, border: { top: m.sy * b.border.top, right: m.sx * b.border.right, bottom: m.sy * b.border.bottom, left: m.sx * b.border.left } };
}

/**
 * A box's outer and inset layers, and the coverage of each of its shadows alone (drawn opaque black) for the smoothness test; box is
 * where the box paints (its layout box mapped by its own scale and translate).
 */
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
    const map = ownShadowTransform(ctx.program, b.id, b.left, b.top, b.right, b.bottom, ctx.dpr);
    const layerOf = (list: readonly ShadowInput[]): ShadowLayer[] => [
      outerShadowLayerMapped(b.left, b.top, b.right, b.bottom, outerRadii, opaque, list, ctx.dpr, NO_SHADOW_FAULTS, map),
      insetShadowLayer(b.left, b.top, b.right, b.bottom, borders, innerRadii, list, ctx.dpr, NO_SHADOW_FAULTS),
    ];
    const [outer, inset] = layerOf(shadows) as [ShadowLayer, ShadowLayer];
    if (map !== IDENTITY_SHADOW_TRANSFORM && shadows.some((x) => x.inset)) throw new Error(`${b.id}: an inset shadow on a transformed box, which the compiler refuses`);
    const coverage = shadows.flatMap((s) => layerOf([{ ...s, r: 0, g: 0, b: 0, a: 255 }]));
    out.push({ box: mappedBox(b, map), outer, inset, coverage });
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
 * Whether (x, y) is a clear shadow pixel of s: only s's layers paint it, every shadow of s is smooth there, and no other box
 * (s's ancestors aside) comes within SAMPLE_INSET_DEVICE_PX of it.
 */
export function clearShadowPixel(ctx: PaintSampleContext, s: BoxShadowLayers, x: number, y: number): boolean {
  const all = shadowLayers(ctx);
  if (all.some((o) => o !== s && (layerAlpha(o.outer, x, y) > 0 || layerAlpha(o.inset, x, y) > 0))) return false;
  if (!coverageSmooth(s, x, y)) return false;
  return ctx.boxes.every((o) => {
    if (o.id === s.box.id || ancestor(ctx.program, o.id, s.box.id)) return true;
    const b = deviceBounds(ctx, o);
    return x + 1 <= b.left - I || x >= b.right + I || y + 1 <= b.top - I || y >= b.bottom + I;
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
