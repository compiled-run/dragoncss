// The host paint model of the PNT1 tests (pnt1-radius, pnt1-shadow): boxes in tree order, each filling its rounded border box,
// borders between the rounded border-box and padding-edge shapes (a corner's side by the outer-to-inner diagonal; a rounded double
// border's two rings), replaced images inside their drawn part and padding-edge curve, rounded overflow clips of ancestors, and
// Skia's 8-bit source-over. It predicts the colour of a sample pixel from the program and the TS paint-radius.ts geometry, for
// comparison with the committed Chrome PNGs.
import { inflateSync } from 'node:zlib';
import type { ReplacedPaint } from '@dragon/layout';
import { borderDoubleRings, hasRoundedCorner, LU_PER_PX, NO_RADIUS_FAULTS, roundedShape, snapEdges } from '@dragon/layout';
import type { NativeProgram, ProgramNode } from 'dragon';
import { borderDevicePx, programInput, replacedGeometries } from 'dragon';
import { decodePng } from '../../dragon/src/images/png.ts';
import type { RgbaImage } from '../src/native-compare.ts';
import { expectedEngine } from '../src/native-host.ts';

export type Rgba = readonly [number, number, number, number];
/** A replaced image's paint rects (device px) and decoded pixels. */
export type ModelImage = { readonly paint: ReplacedPaint; readonly pixels: RgbaImage };
/** size: the layout border-box size in device px before snapping (what percentages resolve against). */
export type Box = { readonly node: ProgramNode; readonly l: number; readonly t: number; readonly r: number; readonly b: number; readonly border: readonly number[]; readonly radii: readonly number[] | null; readonly size?: readonly [number, number]; readonly image?: ModelImage };

/** SkMulDiv255Round. */
const mul255 = (a: number, b: number): number => {
  const p = a * b + 128;
  return (p + (p >> 8)) >> 8;
};

/** Skia's 8-bit source-over of an unpremultiplied colour onto an opaque destination. */
export function over(dst: Rgba, src: Rgba): Rgba {
  const a = src[3];
  if (a === 255) return src;
  if (a === 0) return dst;
  const k = 255 - a;
  return [mul255(src[0], a) + mul255(dst[0], k), mul255(src[1], a) + mul255(dst[1], k), mul255(src[2], a) + mul255(dst[2], k), 255];
}

/** Whether (x, y) is inside a rect with eight corner radii (a corner with a zero component is square). */
export function insideRounded(x: number, y: number, l: number, t: number, r: number, b: number, radii: readonly number[] | null): boolean {
  if (x < l || x > r || y < t || y > b) return false;
  if (radii === null) return true;
  const corners: readonly [number, number, number, number][] = [[l, t, -1, -1], [r, t, 1, -1], [r, b, 1, 1], [l, b, -1, 1]];
  for (let k = 0; k < 4; k++) {
    const rx = radii[k] as number;
    const ry = radii[k + 4] as number;
    if (!(rx > 0 && ry > 0)) continue;
    const [px, py, sx, sy] = corners[k] as [number, number, number, number];
    const cx = px - sx * rx;
    const cy = py - sy * ry;
    if ((x - cx) * sx > 0 && (y - cy) * sy > 0 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) return false;
  }
  return true;
}

const channels = (c: { r: number; g: number; b: number; alpha: number }): Rgba => [c.r, c.g, c.b, c.alpha];

/** The boxes of a program at a DPR with their snapped edges, device-px borders and rounded shapes (16 radii) or null. */
export function boxes(p: NativeProgram, viewport: { width: number; height: number }, dpr: number): Box[] {
  const engine = expectedEngine();
  const input = programInput(p, viewport, dpr);
  const out = engine.layout(input, engine.measurer);
  if (out.kind !== 'ok') throw new Error('the engine refused the case');
  const snapped = snapEdges(out.boxes);
  const borders = borderDevicePx(engine, input);
  const paints = replacedGeometries(engine, input, out.boxes);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const list: Box[] = [];
  out.boxes.forEach((r, i) => {
    const n = byId.get(r.id);
    if (n === undefined || n.kind === 'text') return;
    const s = snapped[i] as { left: number; top: number; right: number; bottom: number };
    const border = borders.get(r.id) ?? [0, 0, 0, 0];
    const facts = n.facts['radius'] as { lengths: { percent: boolean; value: number }[] } | undefined;
    const shape = facts === undefined ? null : roundedShape(s.left, s.top, s.right, s.bottom, r.width / LU_PER_PX, r.height / LU_PER_PX, border, facts.lengths, dpr, NO_RADIUS_FAULTS);
    const w = n.writes.find((x) => x.kind === 'replaced-image');
    const paint = paints.get(r.id);
    if (w !== undefined && paint === undefined) throw new Error(`${r.id}: an image write with no replaced paint`);
    const radii = shape !== null && hasRoundedCorner(shape.slice(0, 8)) ? shape : null;
    const size: [number, number] = [r.width / LU_PER_PX, r.height / LU_PER_PX];
    if (w === undefined || w.kind !== 'replaced-image' || paint === undefined) list.push({ node: n, l: s.left, t: s.top, r: s.right, b: s.bottom, border, radii, size });
    else list.push({ node: n, l: s.left, t: s.top, r: s.right, b: s.bottom, border, radii, size, image: { paint, pixels: decodePng(new Uint8Array(Buffer.from(w.data, 'base64')), (d) => new Uint8Array(inflateSync(d))) } });
  });
  return list;
}

/**
 * The model's colour at the centre of pixel (x, y): white canvas, then every box in tree order, clipped by clipping ancestors; with
 * a stop, only the boxes before the stop's index (and the stop box's background when asked). doubleSolid is the double-solid plant's
 * fault: a rounded double border painted as one solid band.
 */
export function modelAt(list: readonly Box[], x: number, y: number, stop: { readonly index: number; readonly background: boolean } | null = null, doubleSolid = false): Rgba {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const byId = new Map(list.map((b) => [b.node.id, b]));
  const padding = (b: Box): [number, number, number, number] => [b.l + (b.border[3] as number), b.t + (b.border[0] as number), b.r - (b.border[1] as number), b.b - (b.border[2] as number)];
  let colour: Rgba = [255, 255, 255, 255];
  for (const [index, b] of list.entries()) {
    if (stop !== null && index > stop.index) break;
    if (stop !== null && index === stop.index && !stop.background) break;
    let clipped = false;
    for (let a = b.node.parent === null ? undefined : byId.get(b.node.parent); a !== undefined; a = a.node.parent === null ? undefined : byId.get(a.node.parent)) {
      if (!a.node.clips) continue;
      const [pl, pt, pr, pb] = padding(a);
      if (!insideRounded(cx, cy, pl, pt, pr, pb, a.radii === null ? null : a.radii.slice(8, 16))) clipped = true;
    }
    if (clipped || !insideRounded(cx, cy, b.l, b.t, b.r, b.b, b.radii === null ? null : b.radii.slice(0, 8))) continue;
    // T150a: a box that is not visible paints no background or border of its own (html's and body's background is the canvas's).
    const hidden = b.node.writes.find((w) => w.kind === 'visibility');
    if (hidden !== undefined && hidden.kind === 'visibility' && !hidden.canvas) continue;
    const bg = b.node.writes.find((w) => w.kind === 'background-color');
    if (bg !== undefined && bg.kind === 'background-color') colour = over(colour, channels(bg.color));
    if (stop !== null && index === stop.index) break;
    if (hidden !== undefined) continue;
    const [pl, pt, pr, pb] = padding(b);
    if (insideRounded(cx, cy, pl, pt, pr, pb, b.radii === null ? null : b.radii.slice(8, 16))) {
      // A replaced image over its background, inside its drawn part and its padding-edge curve (a rounded img has no padding).
      if (b.image !== undefined) colour = over(colour, imageAt(b.image, x, y) ?? [0, 0, 0, 0]);
      continue;
    }
    const styles = b.node.writes.find((w) => w.kind === 'border-styles');
    const colours = b.node.writes.find((w) => w.kind === 'border-colors');
    if (styles === undefined || styles.kind !== 'border-styles' || colours === undefined || colours.kind !== 'border-colors') continue;
    // The side whose trapezoid (outer corner to inner corner diagonals) holds the point.
    const side = sideOf(cx, cy, b, [pl, pt, pr, pb]);
    const style = styles.styles[side];
    if (style === 'none' || style === 'hidden' || (b.border[side] as number) === 0) continue;
    // A rounded box with four double sides of 3 device px or more paints Blink's two rings (borderDoubleRings); the gap shows through.
    if (!doubleSolid && b.radii !== null && styles.styles.every((st, k) => st === 'double' && (b.border[k] as number) >= 3)) {
      const v = borderDoubleRings(b.l, b.t, b.r, b.b, b.border, b.radii.slice(0, 8));
      const ring = (o: number): boolean => insideRounded(cx, cy, v[o] as number, v[o + 1] as number, v[o + 2] as number, v[o + 3] as number, v.slice(o + 8, o + 16)) && !insideRounded(cx, cy, v[o + 4] as number, v[o + 5] as number, v[o + 6] as number, v[o + 7] as number, v.slice(o + 16, o + 24));
      if (!ring(0) && !ring(24)) continue;
    }
    colour = over(colour, channels(colours.colors[side] as { r: number; g: number; b: number; alpha: number }));
  }
  return colour;
}

/**
 * The source pixel a device pixel of a drawn image maps to (nearest, as replaced-paint.test.ts reads flat content), or null outside
 * the drawn part. Sample points on an image are only on flat content (paint-samples/image.ts), so the nearest source pixel is exact.
 */
function imageAt(m: ModelImage, x: number, y: number): Rgba | null {
  const d = m.paint.drawn;
  if (d === null || x < d.x || y < d.y || x >= d.x + d.width || y >= d.y + d.height) return null;
  const dest = m.paint.dest;
  const img = m.pixels;
  const sx = Math.floor(((x + 0.5 - dest.x) * img.width) / dest.width);
  const sy = Math.floor(((y + 0.5 - dest.y) * img.height) / dest.height);
  if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) throw new Error(`image pixel (${x}, ${y}) maps outside the source at (${sx}, ${sy})`);
  const i = (sy * img.width + sx) * 4;
  return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number, img.data[i + 3] as number];
}

/** The border side a point of the border band paints: the band it lies in, or across a corner the side of the outer-to-inner diagonal. */
function sideOf(x: number, y: number, b: Box, inner: readonly [number, number, number, number]): number {
  const [il, it, ir, ib] = inner;
  const bands = [y < it, x >= ir, y >= ib, x < il];
  const inBands = [0, 1, 2, 3].filter((k) => bands[k]);
  if (inBands.length === 1) return inBands[0] as number;
  // A corner: the side of the diagonal from the outer corner to the inner corner (across a rounded corner, the nearer corner).
  const right = inBands.length === 0 ? x >= (il + ir) / 2 : bands[1] === true;
  const bottom = inBands.length === 0 ? y >= (it + ib) / 2 : bands[2] === true;
  const ox = right ? b.r : b.l;
  const oy = bottom ? b.b : b.t;
  const ix = right ? ir : il;
  const iy = bottom ? ib : it;
  const vertical = right ? 1 : 3;
  const horizontal = bottom ? 2 : 0;
  // Along the diagonal, the horizontal side owns the points nearer its edge than the diagonal is.
  const t = Math.abs(ix - ox) === 0 ? Infinity : Math.abs(x - ox) / Math.abs(ix - ox);
  const u = Math.abs(iy - oy) === 0 ? Infinity : Math.abs(y - oy) / Math.abs(iy - oy);
  return u < t ? horizontal : vertical;
}

