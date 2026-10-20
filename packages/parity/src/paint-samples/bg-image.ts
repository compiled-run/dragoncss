// BG2-u part 2 (notes/T074-bg2-spec.md R10): the device lanes' samples of a url() background layer, part of the gradient module's
// samples. The tile geometry is the device's arithmetic (dragon emit/paint/bg-image.ts dragonAfterLayoutBackgroundImage) on the
// engine's snapped border box, device-px borders and paddings. Resampling filters differ between Skia, CoreGraphics and Android, so,
// as REPL-a R8 rules for an img (paint-samples/image.ts), a pixel drawn from the image is compared only where the source is uniform
// over every filter's support, ceil(1 / scale) + 2 source px on every side, and that support lies inside one tile (the platforms
// filter across a tile seam differently): image-flat points at delta 0, with no allowance. Each tile edge inside the clip box gets
// one edge scanline across it (compared by position, as every edge rule is): a no-repeat axis's tile edge against the colour, a
// repeating axis's seam between two tiles. A base point of any box whose pixel the image may paint is dropped, with its whole rule,
// unless the pixel is flat image content clear inside the clip box.
import { inflateSync } from 'node:zlib';
import type { SnappedRect } from '@dragon/layout';
import { LU_PER_PX, snapEdges } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { programInput } from 'dragon';
import { decodePng } from '../../../dragon/src/images/png.ts';
import type { RgbaImage } from '../native-compare.ts';
import { expectedEngine } from '../native-host.ts';
import { ALONG_POSITIONS, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import type { SamplePoint } from '../samples.ts';
import { IMAGE_FLAT_MARGIN_SOURCE_PX } from './image.ts';
import { backgroundOnly, paddings } from './gradient.ts';
import type { PaintSampleContext } from './types.ts';

type Box = 'border-box' | 'padding-box' | 'content-box';
type Position = { readonly unit: 'px' | 'percent'; readonly value: number };

/** The gradient module's url() layer write, as the program holds it (dragon lower/paint/bg-image.ts BackgroundImageWrite). */
export type BackgroundImageWrite = {
  readonly kind: 'background-image';
  readonly data: string;
  readonly width: number;
  readonly height: number;
  readonly repeatX: 'repeat' | 'no-repeat';
  readonly repeatY: 'repeat' | 'no-repeat';
  readonly positionX: Position;
  readonly positionY: Position;
  readonly origin: Box;
  readonly clip: Box;
  readonly layer: boolean;
};

/** One layout's geometry in the view's device px: the clip box (left, top, right, bottom) and the tile (x, y, width, height). */
export type TileGeometry = { readonly clip: readonly [number, number, number, number]; readonly tile: readonly [number, number, number, number] };

/**
 * The device's tile geometry (dragonAfterLayoutBackgroundImage), operation for operation: edges are the snapped border box in
 * device px, borders the device-px borders and padding the paddings in LU (top, right, bottom, left); scale is the device scale.
 */
export function tileGeometry(w: BackgroundImageWrite, edges: readonly [number, number, number, number], borders: readonly number[], padding: readonly number[], scale: number): TileGeometry {
  const insets = (box: Box): readonly number[] => (box === 'border-box' ? [0, 0, 0, 0] : box === 'padding-box' ? borders : [0, 1, 2, 3].map((k) => (borders[k] as number) + (padding[k] as number) / LU_PER_PX));
  const width = edges[2] - edges[0];
  const height = edges[3] - edges[1];
  const o = insets(w.origin);
  const c = insets(w.clip);
  const area = [o[3] as number, o[0] as number, width - (o[1] as number), height - (o[2] as number)];
  const size = [w.width * scale, w.height * scale];
  const start = [0, 1].map((k) => {
    const p = k === 0 ? w.positionX : w.positionY;
    const lo = area[k] as number;
    const free = ((area[k + 2] as number) - lo) - (size[k] as number);
    const at = p.unit === 'px' ? lo + p.value * scale : lo + (p.value / 100) * free;
    return (k === 0 ? w.repeatX : w.repeatY) === 'repeat' ? at : Math.floor(at + 0.5);
  });
  return { clip: [c[3] as number, c[0] as number, width - (c[1] as number), height - (c[2] as number)], tile: [start[0] as number, start[1] as number, size[0] as number, size[1] as number] };
}

/** A url() box at one DPR: its write, decoded image, page device-px clip box and tile, the region it shows in, and what lies over it. */
export type TileBox = {
  readonly id: string;
  readonly w: BackgroundImageWrite;
  readonly image: RgbaImage;
  /** Page device px. */
  readonly clip: readonly [number, number, number, number];
  readonly tile: readonly [number, number, number, number];
  readonly repeats: readonly [boolean, boolean];
  /** The border box less every side whose opaque solid border hides the background under it (left, top, right, bottom). */
  readonly visible: readonly [number, number, number, number];
  /** The boxes and lines laid out after it, which paint over it. */
  readonly later: readonly SnappedRect[];
  /** The padding boxes of its clipping ancestors (left, top, right, bottom). */
  readonly clippers: readonly (readonly [number, number, number, number])[];
  /** Whether a text node lies in it (its glyphs paint over the image). */
  readonly text: boolean;
};

const cache = new WeakMap<PaintSampleContext, readonly TileBox[]>();

function writesOf(p: NativeProgram): { readonly id: string; readonly w: BackgroundImageWrite }[] {
  return p.nodes.flatMap((n) => n.writes.filter((x) => x.kind === 'background-image').map((x) => ({ id: n.id, w: x as unknown as BackgroundImageWrite })));
}

/** The url() boxes of a sample context, computed once. */
export function tileBoxes(ctx: PaintSampleContext): readonly TileBox[] {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const writes = writesOf(ctx.program);
  if (writes.length === 0) {
    cache.set(ctx, []);
    return [];
  }
  const engine = expectedEngine();
  const input = programInput(ctx.program, ctx.viewport, ctx.dpr);
  const out = engine.layout(input, engine.measurer);
  if (out.kind !== 'ok') throw new Error(`the engine refused the program at ${ctx.dpr}`);
  const zoomed = engine.zoomInput(input, engine.noFaults);
  const pads = paddings(zoomed.root, new Map(out.boxes.map((r) => [r.id, r] as const)), zoomed.viewport.width, ctx.dpr);
  const snapped = snapEdges(out.boxes);
  const order = new Map(out.boxes.map((b, i) => [b.id, i]));
  const byId = new Map(ctx.program.nodes.map((n) => [n.id, n]));
  const sample = new Map(ctx.boxes.map((b) => [b.id, b]));
  const result = writes.map(({ id, w }): TileBox => {
    const b = sample.get(id);
    const pad = pads.get(id);
    const at = order.get(id);
    if (b === undefined || pad === undefined || at === undefined) throw new Error(`${id}: a background-image write on a box with no engine geometry at DPR ${ctx.dpr}`);
    const borders = [b.border.top, b.border.right, b.border.bottom, b.border.left];
    const g = tileGeometry(w, [b.left, b.top, b.right, b.bottom], borders, pad, ctx.dpr);
    const image = decodePng(new Uint8Array(Buffer.from(w.data, 'base64')), (d) => new Uint8Array(inflateSync(d)));
    if (image.width !== w.width || image.height !== w.height) throw new Error(`${id}: the background image decodes to ${image.width}x${image.height}, not its natural ${w.width}x${w.height}`);
    const node = byId.get(id);
    const styles = node?.writes.find((x) => x.kind === 'border-styles');
    const colors = node?.writes.find((x) => x.kind === 'border-colors');
    const hides = [0, 1, 2, 3].map((k) => styles !== undefined && styles.kind === 'border-styles' && colors !== undefined && colors.kind === 'border-colors' && styles.styles[k] === 'solid' && colors.colors[k]?.alpha === 255 && (borders[k] as number) > 0);
    const clippers: (readonly [number, number, number, number])[] = [];
    for (let a = node?.parent === null || node === undefined ? undefined : byId.get(node.parent); a !== undefined; a = a.parent === null ? undefined : byId.get(a.parent)) {
      if (!a.writes.some((x) => x.kind === 'padding-box-clip')) continue;
      const cb = sample.get(a.id);
      if (cb === undefined) throw new Error(`${id}: its clipping ancestor ${a.id} has no sample box`);
      clippers.push([cb.left + cb.border.left, cb.top + cb.border.top, cb.right - cb.border.right, cb.bottom - cb.border.bottom]);
    }
    const inside = (n: { readonly parent: string | null }): boolean => {
      for (let p = n.parent; p !== null; p = byId.get(p)?.parent ?? null) if (p === id) return true;
      return false;
    };
    return {
      id,
      w,
      image,
      clip: [b.left + g.clip[0], b.top + g.clip[1], b.left + g.clip[2], b.top + g.clip[3]],
      tile: [b.left + g.tile[0], b.top + g.tile[1], g.tile[2], g.tile[3]],
      repeats: [w.repeatX === 'repeat', w.repeatY === 'repeat'],
      visible: [b.left + (hides[3] ? b.border.left : 0), b.top + (hides[0] ? b.border.top : 0), b.right - (hides[1] ? b.border.right : 0), b.bottom - (hides[2] ? b.border.bottom : 0)],
      later: snapped.slice(at + 1),
      clippers,
      text: ctx.program.nodes.some((n) => n.kind === 'text' && inside(n)),
    };
  });
  cache.set(ctx, result);
  return result;
}

/** The tile index and the position in that tile (device px) of a device pixel's centre on one axis; null outside a no-repeat tile. */
function localOn(t: TileBox, axis: 0 | 1, c: number): { readonly index: number; readonly u: number } | null {
  const at = t.tile[axis] as number;
  const size = t.tile[axis + 2] as number;
  const d = c + 0.5 - at;
  if (t.repeats[axis]) {
    const index = Math.floor(d / size);
    return { index, u: d - index * size };
  }
  return d >= 0 && d < size ? { index: 0, u: d } : null;
}

/** The source pixel nearest a device pixel's centre (the crisp drawing of the tile geometry), or null outside the tiles. */
export function nearestSource(t: TileBox, x: number, y: number): readonly [number, number, number, number] | null {
  const lx = localOn(t, 0, x);
  const ly = localOn(t, 1, y);
  if (lx === null || ly === null) return null;
  const sx = Math.min(t.image.width - 1, Math.floor((lx.u * t.image.width) / (t.tile[2] as number)));
  const sy = Math.min(t.image.height - 1, Math.floor((ly.u * t.image.height) / (t.tile[3] as number)));
  const i = (sy * t.image.width + sx) * 4;
  return [t.image.data[i] as number, t.image.data[i + 1] as number, t.image.data[i + 2] as number, t.image.data[i + 3] as number];
}

function uniform(img: RgbaImage, x0: number, y0: number, x1: number, y1: number): boolean {
  const first = (y0 * img.width + x0) * 4;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 4;
      for (let k = 0; k < 4; k++) if (img.data[i + k] !== img.data[first + k]) return false;
    }
  }
  return true;
}

/**
 * The source pixel a device pixel shows, when the source is uniform over every filter's support around it, or null. strict: the
 * support must lie inside one tile (an image-flat point); otherwise it is clamped to the tile (an edge scanline's pixel, compared
 * by position). Null outside the tiles.
 */
export function flatSource(t: TileBox, x: number, y: number, strict: boolean): readonly [number, number, number, number] | null {
  const lx = localOn(t, 0, x);
  const ly = localOn(t, 1, y);
  if (lx === null || ly === null) return null;
  const nat = [t.image.width, t.image.height];
  const range = [lx.u, ly.u].map((u, k) => {
    const n = nat[k] as number;
    const size = t.tile[k + 2] as number;
    const s = Math.floor((u * n) / size);
    const r = Math.ceil(n / size) + IMAGE_FLAT_MARGIN_SOURCE_PX;
    return { s, lo: s - r, hi: s + r, n };
  });
  if (range.some((a) => a.s < 0 || a.s >= a.n)) return null;
  if (strict && range.some((a) => a.lo < 0 || a.hi >= a.n)) return null;
  const [rx, ry] = range as [{ s: number; lo: number; hi: number; n: number }, { s: number; lo: number; hi: number; n: number }];
  if (!uniform(t.image, Math.max(0, rx.lo), Math.max(0, ry.lo), Math.min(rx.n - 1, rx.hi), Math.min(ry.n - 1, ry.hi))) return null;
  const i = (ry.s * t.image.width + rx.s) * 4;
  return [t.image.data[i] as number, t.image.data[i + 1] as number, t.image.data[i + 2] as number, t.image.data[i + 3] as number];
}

/** Whether the device pixel lies at least m device px inside a rect (left, top, right, bottom). */
const within = (r: readonly number[], x: number, y: number, m: number): boolean => x >= (r[0] as number) + m && x + 1 <= (r[2] as number) - m && y >= (r[1] as number) + m && y + 1 <= (r[3] as number) - m;

/** Device px past a tile's edge that a filter may still paint (Chrome's resampling), on a no-repeat axis. */
const BLEED_DEVICE_PX = 2;

/** Whether the image may decide the pixel: inside the clip box and the visible region (with a pixel of slack), near or on a tile. */
function touches(t: TileBox, x: number, y: number): boolean {
  const slack = -1;
  if (!within(t.clip, x, y, slack) || !within(t.visible, x, y, slack)) return false;
  for (const axis of [0, 1] as const) {
    if (t.repeats[axis]) continue;
    const c = (axis === 0 ? x : y) + 0.5;
    const at = t.tile[axis] as number;
    if (c < at - BLEED_DEVICE_PX || c > at + (t.tile[axis + 2] as number) + BLEED_DEVICE_PX) return false;
  }
  return true;
}

/** Whether a base point stays: its pixel is one the image does not decide, or flat image content clear inside the clip box. */
function keepsPixel(t: TileBox, x: number, y: number): boolean {
  if (!touches(t, x, y)) return true;
  return within(t.clip, x, y, 1) && flatSource(t, x, y, true) !== null;
}

const dropped = new WeakMap<PaintSampleContext, ReadonlySet<string>>();

/** The base rules, of any box, with a pixel the url() image may decide that is not flat image content (the rule goes whole). */
export function keepsTiles(p: SamplePoint, ctx: PaintSampleContext): boolean {
  let set = dropped.get(ctx);
  if (set === undefined) {
    const boxes = tileBoxes(ctx);
    const out = new Set<string>();
    if (boxes.length > 0) for (const q of ctx.base) if (boxes.some((t) => !keepsPixel(t, q.x, q.y))) out.add(q.rule);
    set = out;
    dropped.set(ctx, set);
  }
  return !set.has(p.rule);
}

/** Whether a sample pixel shows the box's own background: inside the raster and the clippers, under no later box or line. */
function clearOfOthers(t: TileBox, ctx: PaintSampleContext, only: (id: string, x: number, y: number) => boolean, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= ctx.size.width || y >= ctx.size.height) return false;
  if (!only(t.id, x, y) || !within(t.visible, x, y, 0)) return false;
  if (t.clippers.some((r) => !within(r, x, y, SAMPLE_INSET_DEVICE_PX))) return false;
  return !t.later.some((r) => x + 1 > r.left - SAMPLE_INSET_DEVICE_PX && x < r.right + SAMPLE_INSET_DEVICE_PX && y + 1 > r.top - SAMPLE_INSET_DEVICE_PX && y < r.bottom + SAMPLE_INSET_DEVICE_PX);
}

/** Candidate positions across [lo, hi): the middles of GRID equal parts. */
const GRID = 10;
const across = (lo: number, hi: number): number[] => Array.from({ length: GRID }, (_, i) => Math.floor(lo + ((hi - lo) * (2 * i + 1)) / (2 * GRID)));

/** The drawn part of a url() box on an axis: the clip box, narrowed to the tile on a no-repeat axis. */
function drawnOn(t: TileBox, axis: 0 | 1): readonly [number, number] {
  const lo = t.clip[axis] as number;
  const hi = t.clip[axis + 2] as number;
  if (t.repeats[axis]) return [lo, hi];
  return [Math.max(lo, t.tile[axis] as number), Math.min(hi, (t.tile[axis] as number) + (t.tile[axis + 2] as number))];
}

/** The tile edges on an axis inside the drawn part: every seam on a repeating axis, the tile's two edges on the other. */
type TileEdge = { readonly at: number; readonly seam: boolean; readonly inward: 1 | -1 };
function edgesOn(t: TileBox, axis: 0 | 1): TileEdge[] {
  const at = t.tile[axis] as number;
  const size = t.tile[axis + 2] as number;
  const lo = t.clip[axis] as number;
  const hi = t.clip[axis + 2] as number;
  if (!t.repeats[axis]) return ([{ at, seam: false, inward: 1 }, { at: at + size, seam: false, inward: -1 }] as TileEdge[]).filter((e) => e.at > lo && e.at < hi);
  const out: TileEdge[] = [];
  for (let k = Math.ceil((lo - at) / size); at + k * size < hi; k++) out.push({ at: at + k * size, seam: true, inward: 1 });
  return out;
}

/** The url() layers' points of a case: image-flat points on a grid over each drawn part, and an edge scanline across each tile edge. */
export function tilePoints(ctx: PaintSampleContext): SamplePoint[] {
  const boxes = tileBoxes(ctx);
  if (boxes.length === 0) return [];
  const only = backgroundOnly(ctx.program, ctx.boxes, ctx.dpr);
  const out: SamplePoint[] = [];
  const inset = SAMPLE_INSET_DEVICE_PX;
  for (const t of boxes) {
    // Text inside the box paints its glyphs over the image; such a box keeps no tile points (its base points are judged as usual).
    if (t.text) continue;
    const clear = (x: number, y: number): boolean => clearOfOthers(t, ctx, only, x, y) && within(t.clip, x, y, inset);
    const [x0, x1] = drawnOn(t, 0);
    const [y0, y1] = drawnOn(t, 1);
    let k = 0;
    const seen = new Set<string>();
    for (const y of across(y0, y1)) {
      for (const x of across(x0, x1)) {
        if (seen.has(`${x},${y}`) || !clear(x, y) || flatSource(t, x, y, true) === null) continue;
        seen.add(`${x},${y}`);
        out.push({ x, y, rule: `image-flat:${t.id}:tile-${k++}` });
      }
    }
    // One scanline across each tile edge, at the first along-position whose pixels are all clear, with flat content on both sides.
    const span = 2 * inset + 2;
    let e = 0;
    for (const axis of [0, 1] as const) {
      const [alo, ahi] = axis === 0 ? [y0, y1] : [x0, x1];
      for (const edge of edgesOn(t, axis)) {
        const centre = Math.round(edge.at);
        const first = edge.inward > 0 ? centre - inset - 1 : centre + inset;
        const line = ALONG_POSITIONS.map((f) => Math.floor(alo + (ahi - alo) * f)).map((a) => {
          if (a < alo + inset || a + 1 > ahi - inset) return null;
          const pts: (readonly [number, number])[] = [];
          for (let q = 0; q < span; q++) {
            const p = first + edge.inward * q;
            pts.push(axis === 0 ? [p, a] : [a, p]);
          }
          if (!pts.every(([x, y]) => clearOfOthers(t, ctx, only, x, y) && within(t.clip, x, y, 1))) return null;
          const inner = pts.slice(inset + 1).map(([x, y]) => flatSource(t, x, y, false));
          const outer = pts.slice(0, inset + 1).map(([x, y]) => (edge.seam ? flatSource(t, x, y, false) : localOn(t, axis, axis === 0 ? x : y) === null ? 'colour' : null));
          if (inner.some((c) => c === null) || outer.some((c) => c === null)) return null;
          // A seam between two tiles of one colour shows no edge to place.
          if (edge.seam && JSON.stringify(inner[inner.length - 1]) === JSON.stringify(outer[0])) return null;
          return pts;
        }).find((l) => l !== null);
        if (line === undefined || line === null) continue;
        const rule = `edge:${t.id}:tile-${e++}`;
        for (const [x, y] of line) out.push({ x, y, rule });
      }
    }
  }
  return out;
}
