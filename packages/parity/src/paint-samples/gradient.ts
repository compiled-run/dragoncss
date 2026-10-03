// BG2 gradient samples (notes/T074-bg2-spec.md §7): for every box with gradient layers, a grid of points the TS reference
// (paint-gradient.ts) rasterises exactly, inside a layer and two device px clear of every edge of the painted area, with rule
// gradient:<box>. Check (c) compares the device capture with Chrome's pixels there at GRADIENT_CHANNEL_DELTA. The reference
// equals Chrome at every such pixel (bg2-reference.test.ts), and the device runs the same code translated, so a device pixel
// that differs is a device fault. backgroundPlans is the same plan the device builds, for the host reference test.
import type { BackgroundLayer, BackgroundPaint, BackgroundPlan, GradientFaults, GradientImage, LayoutBox, LayoutRect } from '@dragon/layout';
import { absoluteRects, backgroundPixelExact, backgroundRow, fromCssPx, layout, measurerFor, NO_ENGINE_FAULTS, NO_GRADIENT_FAULTS, planBackground, referenceTileSize, resolveBorder, resolvePadding, zoomInput } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { programInput } from 'dragon';
import { REFERENCE_PLATFORM } from '../platform.ts';
import type { SamplePoint } from '../samples.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number };
type LoweredLayer = {
  readonly geometry: BackgroundLayer['geometry'];
  readonly gradient: Omit<GradientImage, 'stops'> & { readonly stops: readonly { readonly color: Rgba; readonly unit: 'auto' | 'percent' | 'px'; readonly value: number }[] };
};
/** The gradient module's write, as the program holds it (dragon lower/paint/gradient.ts GradientWrite). */
type GradientWrite = { readonly kind: 'background-layers'; readonly color: Rgba; readonly colorClip: BackgroundPaint['colorClip']; readonly obscures: readonly string[]; readonly layers: readonly LoweredLayer[]; readonly lastIsBottom: boolean; readonly layerOrigin: readonly [number, number] };

const stopColor = (c: Rgba): BackgroundPaint['color'] => ({ r: c.r, g: c.g, b: c.b, alpha: c.alpha });

/** One node's background plan at a DPR: the node id and the plan the device builds from the same write and engine geometry. */
export type NodePlan = { readonly id: string; readonly plan: BackgroundPlan };

/**
 * The paddings of every box of the zoomed engine input in LU (top, right, bottom, left), each against its containing block's
 * content width, as DragonTree.apply resolves them on the device.
 */
function paddings(root: LayoutBox, rects: ReadonlyMap<string, LayoutRect>, viewportWidth: number, dpr: number): Map<string, readonly number[]> {
  const out = new Map<string, readonly number[]>();
  const walk = (b: LayoutBox, cb: number): void => {
    const r = rects.get(b.id);
    const pad = resolvePadding(b.style, cb as never);
    out.set(b.id, [pad.top, pad.right, pad.bottom, pad.left]);
    const bor = resolveBorder(b.style, dpr);
    const content = r === undefined ? cb : r.width - bor.left - bor.right - pad.left - pad.right;
    for (const c of b.children) if (c.kind === 'box') walk(c, content);
  };
  walk(root, fromCssPx(viewportWidth));
  return out;
}

/**
 * The background plans of every box of a program with gradient layers, at a DPR: the engine lays the program out, and each box's
 * unsnapped border box, device-px borders (as box.ts resolves them), paddings and the write's layers and layer origin give
 * BackgroundPaint, as DragonPaintGradient does on the device.
 */
export function backgroundPlans(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number, borders: ReadonlyMap<string, readonly [number, number, number, number]>, faults: GradientFaults = NO_GRADIENT_FAULTS): NodePlan[] {
  const writes = p.nodes.flatMap((n) => n.writes.filter((w) => w.kind === 'background-layers').map((w) => ({ id: n.id, w: w as unknown as GradientWrite })));
  if (writes.length === 0) return [];
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  const input = programInput(p, viewport, dpr);
  const out = layout(input, m.measurer);
  if (out.kind !== 'ok') throw new Error(`the engine refused the program at ${dpr}`);
  const abs = absoluteRects(out.boxes);
  const rects = new Map(out.boxes.map((r) => [r.id, r] as const));
  const zoomed = zoomInput(input, NO_ENGINE_FAULTS);
  const pads = paddings(zoomed.root, rects, zoomed.viewport.width, zoomed.devicePixelRatio);
  return writes.map(({ id, w }) => {
    const r = abs.get(id) as LayoutRect | undefined;
    const b = borders.get(id);
    const pad = pads.get(id);
    if (r === undefined || b === undefined || pad === undefined) throw new Error(`${id}: no engine geometry for a gradient box`);
    const obscures = w.obscures.map((o, k) => o === 'always' || (o === 'double' && (b[k] as number) < 3));
    const paint: BackgroundPaint = {
      box: { x: r.x, y: r.y, width: r.width, height: r.height, borders: b.map((v) => v * 64), padding: pad, obscures },
      color: stopColor(w.color),
      colorClip: w.colorClip,
      layers: w.layers.map((l) => ({ geometry: l.geometry, image: { ...l.gradient, stops: l.gradient.stops.map((s) => ({ color: stopColor(s.color), unit: s.unit, value: s.value })) } })),
      lastIsBottom: w.lastIsBottom,
      zoom: dpr,
      tileSize: referenceTileSize(dpr),
      layerX: w.layerOrigin[0],
      layerY: w.layerOrigin[1],
    };
    return { id, plan: planBackground(paint, faults) };
  });
}

/** Columns and rows of the candidate grid in each gradient box. */
const GRID = [5, 3] as const;
/** Sample geometry, as samples.ts SAMPLE_INSET_DEVICE_PX: a point stays this far from any edge of the painted area. */
const INSET = 2;

/** The gradient points of a case: per gradient box, the grid points whose (2 * INSET + 1)^2 neighbourhood the layers paint exactly. */
export function gradientPoints(ctx: PaintSampleContext): SamplePoint[] {
  const borders = new Map(ctx.boxes.map((b) => [b.id, [b.border.top, b.border.right, b.border.bottom, b.border.left] as [number, number, number, number]]));
  const out: SamplePoint[] = [];
  for (const { id, plan } of backgroundPlans(ctx.program, ctx.viewport, ctx.dpr, borders)) {
    const rows = new Map<number, readonly number[]>();
    const row = (y: number): readonly number[] => {
      const hit = rows.get(y);
      if (hit !== undefined) return hit;
      const r = backgroundRow(plan, y, NO_GRADIENT_FAULTS);
      rows.set(y, r);
      return r;
    };
    const painted = (x: number, y: number): boolean => x >= plan.left && x < plan.right && y >= plan.top && y < plan.bottom && row(y)[(x - plan.left) * 4 + 3] === 255 && backgroundPixelExact(plan, x, y);
    const [cols, rowsN] = GRID;
    for (let j = 0; j < rowsN; j++) {
      for (let i = 0; i < cols; i++) {
        const x = Math.floor(plan.left + ((plan.right - plan.left) * (2 * i + 1)) / (2 * cols));
        const y = Math.floor(plan.top + ((plan.bottom - plan.top) * (2 * j + 1)) / (2 * rowsN));
        if (x < 0 || y < 0 || x >= ctx.size.width || y >= ctx.size.height) continue;
        let clear = true;
        for (let dy = -INSET; dy <= INSET && clear; dy++) for (let dx = -INSET; dx <= INSET && clear; dx++) if (!painted(x + dx, y + dy)) clear = false;
        if (clear) out.push({ x, y, rule: `gradient:${id}` });
      }
    }
    // A small layer the grid misses (a no-repeat tile): the middle of each layer's drawn area, when its neighbourhood is exact.
    if (!out.some((q) => q.rule === `gradient:${id}`)) {
      for (const l of plan.layers) {
        const p = l.placement;
        const left = Math.max(Math.ceil(p.destX / 64), p.clipLeft);
        const right = Math.min(Math.floor((p.destX + p.destWidth) / 64), p.clipRight);
        const top = Math.max(Math.ceil(p.destY / 64), p.clipTop);
        const bottom = Math.min(Math.floor((p.destY + p.destHeight) / 64), p.clipBottom);
        const x = plan.originX + Math.floor((left + right) / 2);
        const y = plan.originY + Math.floor((top + bottom) / 2);
        if (right - left < 2 * INSET + 1 || bottom - top < 2 * INSET + 1 || x < 0 || y < 0 || x >= ctx.size.width || y >= ctx.size.height) continue;
        let clear = true;
        for (let dy = -INSET; dy <= INSET && clear; dy++) for (let dx = -INSET; dx <= INSET && clear; dx++) if (!painted(x + dx, y + dy)) clear = false;
        if (clear) {
          out.push({ x, y, rule: `gradient:${id}` });
          break;
        }
      }
    }
  }
  return out;
}

export const GRADIENT_SAMPLES: PaintSamples = { name: 'gradient', keep: () => true, points: gradientPoints };
