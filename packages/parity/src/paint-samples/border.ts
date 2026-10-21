// The border module's samples: MISC-PAINT part 1's gradient border images. For every box with a border-image write, the points the
// TS reference (paint-gradient.ts planBorderImage and backgroundRow) rasterises exactly inside one of its nine pieces, each with a
// (2 * INSET + 1)^2 neighbourhood the pieces paint exactly and opaquely, with rule gradient:<box> (check (c) compares the device
// capture with Chrome's pixels there at GRADIENT_CHANNEL_DELTA, as it does a gradient background). The reference equals Chrome at
// every such pixel (border-image-reference.test.ts), and the device runs the same code translated, so a device pixel that differs is
// a device fault. A border image box's base border, edge, interior and radius points are dropped: the image, not the border style
// or the box's colour, decides them. borderImagePlans is the plan the device builds, for the host reference test.
import type { BackgroundPlan, BorderImagePaint, GradientFaults, GradientImage, LayoutRect } from '@dragon/layout';
import { absoluteRects, backgroundPixelExact, backgroundRow, layout, measurerFor, NO_GRADIENT_FAULTS, planBorderImage, referenceTileSize } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { programInput } from 'dragon';
import { REFERENCE_PLATFORM } from '../platform.ts';
import type { SamplePoint } from '../samples.ts';
import { caseRootX } from './gradient.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number };
/** The border module's border image write, as the program holds it (dragon lower/paint/border.ts BorderImageWrite). */
type BorderImageWrite = {
  readonly kind: 'border-image';
  readonly gradient: Omit<GradientImage, 'stops'> & { readonly stops: readonly { readonly color: Rgba; readonly unit: 'auto' | 'percent' | 'px'; readonly value: number }[] };
  readonly slices: BorderImagePaint['slices'];
  readonly fill: boolean;
  readonly widths: BorderImagePaint['widths'];
  readonly layerOrigin: readonly [number, number];
};

/** The ids of a program's boxes with a border image. */
export function borderImageIds(p: NativeProgram): Set<string> {
  return new Set(p.nodes.filter((n) => n.writes.some((w) => w.kind === 'border-image')).map((n) => n.id));
}

/**
 * The border image plans of every box of a program with a border-image write, at a DPR: the engine lays the program out, and each
 * box's unsnapped border box, device-px borders (as box.ts resolves them) and the write give BorderImagePaint, as
 * dragonAfterLayoutBorderImage does on the device (layer origin moved to the root scroll origin, gradient.ts rootScrollX).
 */
export function borderImagePlans(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number, borders: ReadonlyMap<string, readonly [number, number, number, number]>, faults: GradientFaults = NO_GRADIENT_FAULTS): { readonly id: string; readonly plan: BackgroundPlan }[] {
  const writes = p.nodes.flatMap((n) => n.writes.filter((w) => w.kind === 'border-image').map((w) => ({ id: n.id, w: w as unknown as BorderImageWrite })));
  if (writes.length === 0) return [];
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  const out = layout(programInput(p, viewport, dpr), m.measurer);
  if (out.kind !== 'ok') throw new Error(`the engine refused the program at ${dpr}`);
  const abs = absoluteRects(out.boxes);
  const rootX = caseRootX(p, viewport, dpr);
  return writes.map(({ id, w }) => {
    const r = abs.get(id) as LayoutRect | undefined;
    const b = borders.get(id);
    if (r === undefined || b === undefined) throw new Error(`${id}: no engine geometry for a border image box`);
    const paint: BorderImagePaint = {
      box: { x: r.x, y: r.y, width: r.width, height: r.height, borders: b.map((v) => v * 64), padding: [0, 0, 0, 0], obscures: [false, false, false, false] },
      image: { ...w.gradient, stops: w.gradient.stops.map((s) => ({ color: { r: s.color.r, g: s.color.g, b: s.color.b, alpha: s.color.alpha }, unit: s.unit, value: s.value })) },
      slices: w.slices,
      fill: w.fill,
      widths: w.widths,
      zoom: dpr,
      tileSize: referenceTileSize(dpr),
      layerX: w.layerOrigin[0] + rootX,
      layerY: w.layerOrigin[1],
    };
    const plan = planBorderImage(paint, faults);
    // The checks refuse every border image the plan does not model, so one here is a compiler fault (a planted fault may leave
    // the plan unmodelled on purpose).
    if (!plan.modelled && !Object.values(faults).some((v) => v === true)) throw new Error(`${id}: the border image plan at ${dpr}x is not modelled`);
    return { id, plan };
  });
}

/** Sample geometry: a point's neighbourhood reaches this far, as the gradient points' does. */
const INSET = 2;
/** Points per piece axis, spread across its exact interior. */
const PER_AXIS = 2;

/** Whether pixel (x, y) is inside a box other than id that is not one of id's ancestors (its paint may cover the border image). */
function underOther(ctx: PaintSampleContext, id: string, x: number, y: number): boolean {
  const own = ctx.boxes.find((b) => b.id === id);
  if (own === undefined) return true;
  return ctx.boxes.some((b) => b.id !== id && x >= b.left && x < b.right && y >= b.top && y < b.bottom && !(b.left <= own.left && b.top <= own.top && b.right >= own.right && b.bottom >= own.bottom));
}

/** The border image points of a case: per box, up to PER_AXIS^2 points in each drawn piece, every neighbourhood pixel exact and opaque. */
export function borderImagePoints(ctx: PaintSampleContext): SamplePoint[] {
  const borders = new Map(ctx.boxes.map((b) => [b.id, [b.border.top, b.border.right, b.border.bottom, b.border.left] as [number, number, number, number]]));
  const out: SamplePoint[] = [];
  for (const { id, plan } of borderImagePlans(ctx.program, ctx.viewport, ctx.dpr, borders)) {
    const rows = new Map<number, readonly number[]>();
    const row = (y: number): readonly number[] => {
      const hit = rows.get(y);
      if (hit !== undefined) return hit;
      const r = backgroundRow(plan, y, NO_GRADIENT_FAULTS);
      rows.set(y, r);
      return r;
    };
    const painted = (x: number, y: number): boolean => x >= plan.left && x < plan.right && y >= plan.top && y < plan.bottom && row(y)[(x - plan.left) * 4 + 3] === 255 && backgroundPixelExact(plan, x, y);
    for (const l of plan.layers) {
      const p = l.placement;
      // The piece's whole device pixels in page px, one INSET clear of its edges (a neighbour piece may meet it there).
      const left = plan.originX + Math.max(Math.ceil(p.destX / 64), p.clipLeft) + INSET;
      const right = plan.originX + Math.min(Math.floor((p.destX + p.destWidth) / 64), p.clipRight) - INSET;
      const top = plan.originY + Math.max(Math.ceil(p.destY / 64), p.clipTop) + INSET;
      const bottom = plan.originY + Math.min(Math.floor((p.destY + p.destHeight) / 64), p.clipBottom) - INSET;
      if (right <= left || bottom <= top) continue;
      for (let j = 0; j < PER_AXIS; j++) {
        for (let i = 0; i < PER_AXIS; i++) {
          const x = Math.floor(left + ((right - left) * (2 * i + 1)) / (2 * PER_AXIS));
          const y = Math.floor(top + ((bottom - top) * (2 * j + 1)) / (2 * PER_AXIS));
          if (x < 0 || y < 0 || x >= ctx.size.width || y >= ctx.size.height || out.some((q) => q.x === x && q.y === y)) continue;
          let clear = true;
          for (let dy = -INSET; dy <= INSET && clear; dy++) for (let dx = -INSET; dx <= INSET && clear; dx++) if (!painted(x + dx, y + dy) || underOther(ctx, id, x + dx, y + dy)) clear = false;
          if (clear) out.push({ x, y, rule: `gradient:${id}` });
        }
      }
    }
  }
  return out;
}

/** The base rule kinds a border image decides inside its box: its border bands and edges, its interior and its corners. */
const REPLACED = new Set(['border', 'edge', 'interior', 'radius']);

export const BORDER_SAMPLES: PaintSamples = {
  name: 'border',
  keep: (pt, ctx) => {
    const [kind, id] = pt.rule.split(':');
    return !(REPLACED.has(kind ?? '') && id !== undefined && borderImageIds(ctx.program).has(id));
  },
  points: borderImagePoints,
};
