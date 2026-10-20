// The mask module's sample points (MASK-CLIP): the 'mask' kind and the mask's edge scanlines. Chrome paints a masked subtree into a
// layer over transparent, paints the mask's gradient into a kDstIn layer over it (as a background layer: one tile over the border
// box), and composites the result; the device masks the box view with the same gradient, rasterised by the translated
// paint-gradient.ts (dragon emit/paint/mask.ts). Where the mask's alpha is 255 a pixel is the unmasked paint, and where it is 0 the
// backdrop, on both, exactly, since the native targets refuse every translucent paint inside a mask (dragon
// analysis/paint-values/mask.ts); a pixel the mask makes partly transparent is composited with each platform's own rounding and is
// never compared. So:
// - a base point inside a masked box is kept only when the mask's alpha is 255 over its whole (2 * INSET + 1)^2 neighbourhood, or 0
//   over it, and a base scanline only when every pixel of it is kept so;
// - each masked box adds a grid of such points (rule mask:<box>), clear of its text by INSET, and a scanline across each hard stop
//   of the mask (a step from 255 to 0 within one pixel) at a row or column clear of its text and of every box edge inside it (rule
//   edge:<box>:mask-x or mask-y), whose position check (c) reads as an edge's.
// maskPlans is the plan the device builds, for the host test (packages/parity/test/mask-gradient.test.ts).
import type { BackgroundPaint, BackgroundPlan, GradientImage, LayerGeometry, LayoutRect } from '@dragon/layout';
import { absoluteRects, backgroundRow, layout, measurerFor, NO_ENGINE_FAULTS, NO_GRADIENT_FAULTS, planBackground, referenceTileSize, snapEdges, zoomInput } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { programInput } from 'dragon';
import { REFERENCE_PLATFORM } from '../platform.ts';
import type { SamplePoint } from '../samples.ts';
import { ALONG_POSITIONS, isScanlineRule, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import { caseRootX, paddings } from './gradient.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

const INSET = SAMPLE_INSET_DEVICE_PX;

type Rgba = { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number };
/** The mask module's write, as the program holds it (dragon lower/paint/mask.ts MaskWrite). */
type MaskWrite = {
  readonly kind: 'mask-image';
  readonly gradient: Omit<GradientImage, 'stops'> & { readonly stops: readonly { readonly color: Rgba; readonly unit: 'auto' | 'percent' | 'px'; readonly value: number }[] };
  readonly layerOrigin: readonly [number, number];
};

/** The one layer of every mask Dragon draws: the initial mask longhands (dragon emit/paint/mask.ts dragonMaskGeometry). */
export const MASK_GEOMETRY: LayerGeometry = {
  sizeKind: 'length',
  sizeX: { unit: 'auto', value: 0 },
  sizeY: { unit: 'auto', value: 0 },
  positionX: { unit: 'percent', value: 0 },
  positionY: { unit: 'percent', value: 0 },
  repeatX: 'repeat',
  repeatY: 'repeat',
  origin: 'border-box',
  clip: 'border-box',
};

/** One masked box at a DPR: its id, the mask's plan, the ids of its subtree (itself included) and its subtree's snapped rects. */
export type MaskPlan = { readonly id: string; readonly plan: BackgroundPlan; readonly subtree: ReadonlySet<string> };

/**
 * The mask plans of every masked box of a program at a DPR: the engine lays the program out, and each box's unsnapped border box,
 * device-px borders and paddings, its gradient as one layer over a transparent colour, and the layer origin moved to the root scroll
 * origin give BackgroundPaint, as dragonAfterLayoutMask does on the device.
 */
export function maskPlans(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number, borders: ReadonlyMap<string, readonly [number, number, number, number]>): MaskPlan[] {
  const writes = p.nodes.flatMap((n) => n.writes.filter((w) => w.kind === 'mask-image').map((w) => ({ id: n.id, w: w as unknown as MaskWrite })));
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
  const rootX = caseRootX(p, viewport, dpr);
  const children = new Map<string, string[]>();
  for (const n of p.nodes) if (n.parent !== null) children.set(n.parent, [...(children.get(n.parent) ?? []), n.id]);
  return writes.map(({ id, w }) => {
    const r = abs.get(id) as LayoutRect | undefined;
    const b = borders.get(id);
    const pad = pads.get(id);
    if (r === undefined || b === undefined || pad === undefined) throw new Error(`${id}: no engine geometry for a masked box`);
    const paint: BackgroundPaint = {
      box: { x: r.x, y: r.y, width: r.width, height: r.height, borders: b.map((v) => v * 64), padding: pad, obscures: [false, false, false, false] },
      color: { r: 0, g: 0, b: 0, alpha: 0 },
      colorClip: 'border-box',
      layers: [{ geometry: MASK_GEOMETRY, image: { ...w.gradient, stops: w.gradient.stops.map((s) => ({ color: { r: s.color.r, g: s.color.g, b: s.color.b, alpha: s.color.alpha }, unit: s.unit, value: s.value })) } }],
      lastIsBottom: true,
      zoom: dpr,
      tileSize: referenceTileSize(dpr),
      layerX: w.layerOrigin[0] + rootX,
      layerY: w.layerOrigin[1],
    };
    const plan = planBackground(paint, NO_GRADIENT_FAULTS);
    if (!plan.modelled) throw new Error(`${id}: the mask plan at ${dpr}x is not modelled (layer origin ${paint.layerX}, ${paint.layerY})`);
    const subtree = new Set<string>();
    const add = (n: string): void => {
      subtree.add(n);
      for (const c of children.get(n) ?? []) add(c);
    };
    add(id);
    return { id, plan, subtree };
  });
}

/**
 * The mask's alpha at page pixel (x, y): the raster's, and 0 outside the border box (Chrome masks out what lies outside the mask
 * painting area). flip reads the raster bottom to top, as the mask-gradient-flip plant draws it.
 */
export function maskAlpha(plan: BackgroundPlan, x: number, y: number, rows: Map<number, readonly number[]>, flip = false): number {
  if (x < plan.left || x >= plan.right || y < plan.top || y >= plan.bottom) return 0;
  const sy = flip ? plan.top + plan.bottom - 1 - y : y;
  let row = rows.get(sy);
  if (row === undefined) {
    row = backgroundRow(plan, sy, NO_GRADIENT_FAULTS);
    rows.set(sy, row);
  }
  return row[(x - plan.left) * 4 + 3] as number;
}

/**
 * The alpha the mask has over every pixel of the (2 * INSET + 1)^2 neighbourhood of (x, y) inside the border box: 255 or 0, or
 * null when it is not one of them throughout. A pixel outside the border box shows what the masked subtree does not paint, on
 * both sides, so it constrains nothing; a neighbourhood wholly outside reads as 0.
 */
function flatAlpha(plan: BackgroundPlan, x: number, y: number, rows: Map<number, readonly number[]>): 0 | 255 | null {
  let seen: number | null = null;
  for (let dy = -INSET; dy <= INSET; dy++) {
    for (let dx = -INSET; dx <= INSET; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px < plan.left || px >= plan.right || py < plan.top || py >= plan.bottom) continue;
      const a = maskAlpha(plan, px, py, rows);
      if ((a !== 0 && a !== 255) || (seen !== null && a !== seen)) return null;
      seen = a;
    }
  }
  return seen === 255 ? 255 : 0;
}

type Rect = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
const near = (r: Rect, x: number, y: number, margin: number): boolean => x + 1 + margin > r.left && x - margin < r.right && y + 1 + margin > r.top && y - margin < r.bottom;

type Masks = { readonly plans: readonly (MaskPlan & { readonly rows: Map<number, readonly number[]> })[]; readonly text: readonly Rect[]; readonly boxes: ReadonlyMap<string, Rect>; readonly dropped: ReadonlySet<string> };

const cache = new WeakMap<PaintSampleContext, Masks>();

/** The masks of a case at a DPR, with the snapped rects of its text and boxes and the base rules a mask drops. */
function masksOf(ctx: PaintSampleContext): Masks {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const borders = new Map(ctx.boxes.map((b) => [b.id, [b.border.top, b.border.right, b.border.bottom, b.border.left] as [number, number, number, number]]));
  const plans = maskPlans(ctx.program, ctx.viewport, ctx.dpr, borders).map((m) => ({ ...m, rows: new Map<number, readonly number[]>() }));
  let text: Rect[] = [];
  const boxes = new Map(ctx.boxes.map((b) => [b.id, b as Rect] as const));
  if (plans.length > 0) {
    const m = measurerFor(REFERENCE_PLATFORM);
    if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
    const out = layout(programInput(ctx.program, ctx.viewport, ctx.dpr), m.measurer);
    if (out.kind !== 'ok') throw new Error(`the engine refused the program at ${ctx.dpr}`);
    const snapped = snapEdges(out.boxes);
    text = out.boxes.flatMap((r, i) => (boxes.has(r.id) ? [] : [snapped[i] as Rect]));
  }
  const kept = (x: number, y: number): boolean => plans.every((mp) => !near(mp.plan, x, y, INSET) || flatAlpha(mp.plan, x, y, mp.rows) !== null);
  const dropped = new Set<string>();
  for (const q of ctx.base) if (!kept(q.x, q.y)) dropped.add(q.rule);
  const masks: Masks = { plans, text, boxes, dropped };
  cache.set(ctx, masks);
  return masks;
}

/** A base point stays unless a mask is partly transparent around it, or around another pixel of its scanline. */
function keep(q: SamplePoint, ctx: PaintSampleContext): boolean {
  const { plans, dropped } = masksOf(ctx);
  if (plans.length === 0) return true;
  if (isScanlineRule(q.rule)) return !dropped.has(q.rule);
  return plans.every((mp) => !near(mp.plan, q.x, q.y, INSET) || flatAlpha(mp.plan, q.x, q.y, mp.rows) !== null);
}

/** Columns and rows of the candidate grid in each masked box. */
const GRID = [8, 6] as const;

/** The mask points and scanlines of a case. */
export function maskPoints(ctx: PaintSampleContext): SamplePoint[] {
  const { plans, text, boxes } = masksOf(ctx);
  const out: SamplePoint[] = [];
  const inImage = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < ctx.size.width && y < ctx.size.height;
  for (const mp of plans) {
    const { plan, rows } = mp;
    const clearOfText = (x: number, y: number): boolean => !text.some((t) => near(t, x, y, INSET));
    // Every box inside the mask other than the masked box itself: a scanline's colour must be the masked box's own paint.
    const inner = [...mp.subtree].flatMap((id) => (id === mp.id ? [] : boxes.has(id) ? [boxes.get(id) as Rect] : []));
    const own = boxes.get(mp.id);
    const [cols, rowsN] = GRID;
    for (let j = 0; j < rowsN; j++) {
      for (let i = 0; i < cols; i++) {
        const x = Math.floor(plan.left + ((plan.right - plan.left) * (2 * i + 1)) / (2 * cols));
        const y = Math.floor(plan.top + ((plan.bottom - plan.top) * (2 * j + 1)) / (2 * rowsN));
        if (!inImage(x, y) || !clearOfText(x, y) || flatAlpha(plan, x, y, rows) === null || x - INSET < plan.left || x + INSET >= plan.right || y - INSET < plan.top || y + INSET >= plan.bottom) continue;
        out.push({ x, y, rule: `mask:${mp.id}` });
      }
    }
    if (own === undefined) continue;
    // The scanlines: across the first hard stop on the middle-most row (mask-x) and column (mask-y) that holds one cleanly, inside the
    // box's padding edge, clear of its text and of every box edge inside it.
    const clearAt = (x: number, y: number): boolean => inImage(x, y) && clearOfText(x, y) && inner.every((r) => !near(r, x, y, INSET));
    const insidePadding = (x: number, y: number): boolean => {
      const b = ctx.boxes.find((sb) => sb.id === mp.id);
      if (b === undefined) return false;
      return x - INSET >= b.left + b.border.left && x + 1 + INSET <= b.right - b.border.right && y - INSET >= b.top + b.border.top && y + 1 + INSET <= b.bottom - b.border.bottom;
    };
    for (const axis of ['x', 'y'] as const) {
      const [lo, hi] = axis === 'x' ? [plan.top, plan.bottom] : [plan.left, plan.right];
      const [from, to] = axis === 'x' ? [plan.left, plan.right] : [plan.top, plan.bottom];
      let found: [number, number][] | null = null;
      for (const f of ALONG_POSITIONS) {
        const across = Math.floor(lo + (hi - lo) * f);
        const at = (k: number): [number, number] => (axis === 'x' ? [k, across] : [across, k]);
        for (let t = from + INSET + 1; t + INSET < to && found === null; t++) {
          const line = [-INSET - 1, -INSET, -INSET + 1, 0, 1, INSET].map((d) => at(t + d));
          const alphas = line.map(([x, y]) => maskAlpha(plan, x, y, rows));
          const a = alphas[0] as number;
          const b = alphas[alphas.length - 1] as number;
          if (!((a === 255 && b === 0) || (a === 0 && b === 255))) continue;
          if (!alphas.slice(0, INSET + 1).every((v) => v === a) || !alphas.slice(INSET + 2).every((v) => v === b)) continue;
          // A straight stop: the same alphas on every row (or column) within INSET of the scanline, and every pixel clear.
          let straight = true;
          for (let d = -INSET; d <= INSET && straight; d++) {
            for (let k = 0; k < line.length && straight; k++) {
              const [x, y] = line[k] as [number, number];
              const [nx, ny] = axis === 'x' ? [x, y + d] : [x + d, y];
              if (maskAlpha(plan, nx, ny, rows) !== alphas[k] || !clearAt(nx, ny) || !insidePadding(nx, ny)) straight = false;
            }
          }
          if (straight) found = line;
        }
        if (found !== null) break;
      }
      if (found !== null) for (const [x, y] of found) out.push({ x, y, rule: `edge:${mp.id}:mask-${axis}` });
    }
  }
  return out;
}

export const MASK_SAMPLES: PaintSamples = { name: 'mask', keep, points: maskPoints };
