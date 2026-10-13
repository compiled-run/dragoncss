// The outline part of the host paint model (pnt1-outline, pnt1-visibility): every outline painted last, each box's descendants'
// outlines before its own (Blink's BoxFragmentPainter paints kDescendantOutlinesOnly, then kSelfOutlineOnly), what the device draws
// in the root view: a solid or double outline as the rings of the TS paint-radius.ts outlineRings, a dotted, dashed or 3D one as
// the TS paint-dash.ts outlinePaintOps around the ring's outer rect, evaluated at the pixel centre (clips, transparency layers
// composited at their alpha, the operations' colours from the write's colour and 3D tones). The centre decides only a crisp pixel,
// which is what the sample module picks for these styles.
import type { BorderOp, DashFaults } from '@dragon/layout';
import { NO_DASH_FAULTS, outlineNeedsSidePainter, outlineOffsetPx, outlinePaintOps, outlineRings, outlineWidthPx } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { insidePolygon, outlineWrite } from '../src/paint-samples/outline.ts';
import type { Box, Rgba } from './paint-model.ts';
import { insideRounded, modelAt, over } from './paint-model.ts';

/**
 * An outline: its rings, its colour, and for a side painter style its operations and their palette (indexed by an operation's side:
 * the colour, the lighter tone, the darker tone).
 */
export type Rings = { readonly box: Box; readonly rings: readonly number[]; readonly color: Rgba; readonly ops: readonly BorderOp[] | null; readonly palette: readonly Rgba[] };

/** The model's faults, the host twins of the device plants: the unfitted dash gap (outline-dash-unfitted), the tones swapped (outline-tones-swapped). */
export type OutlineFaults = { readonly dash: DashFaults; readonly tonesSwapped: boolean };
export const NO_OUTLINE_FAULTS: OutlineFaults = { dash: NO_DASH_FAULTS, tonesSwapped: false };

/** The boxes in Blink's outline-phase order: each box after its descendants, siblings in tree order. */
export function outlineOrder(list: readonly Box[]): Box[] {
  const ids = new Set(list.map((b) => b.node.id));
  const children = new Map<string, Box[]>();
  for (const b of list) if (b.node.parent !== null && ids.has(b.node.parent)) children.set(b.node.parent, [...(children.get(b.node.parent) ?? []), b]);
  const out: Box[] = [];
  const visit = (b: Box): void => {
    for (const c of children.get(b.node.id) ?? []) visit(c);
    out.push(b);
  };
  for (const b of list) if (b.node.parent === null || !ids.has(b.node.parent)) visit(b);
  if (out.length !== list.length) throw new Error(`outline order holds ${out.length} of ${list.length} boxes`);
  return out;
}

/**
 * One outline of a box at a DPR (css px width and offset), shifted right by shift device px. A 3D style takes its lighter and darker
 * tones (the write's), and a side painter style its operations under the faults.
 */
export function boxOutline(b: Box, style: string, width: number, offset: number, color: Rgba, dpr: number, shift = 0, tones: readonly [Rgba, Rgba] | null = null, faults: OutlineFaults = NO_OUTLINE_FAULTS): Rings {
  const radii = b.radii === null ? [0, 0, 0, 0, 0, 0, 0, 0] : b.radii.slice(0, 8);
  const w = outlineWidthPx(width, dpr);
  const rings = outlineRings(b.l + shift, b.t, b.r + shift, b.b, radii, w, outlineOffsetPx(offset, dpr), style === 'double');
  if (!outlineNeedsSidePainter(style)) return { box: b, rings, color, ops: null, palette: [color] };
  if (rings.length !== 24) throw new Error(`${b.node.id}: a ${style} outline has ${rings.length / 24} rings`);
  if (radii.some((r) => r > 0)) throw new Error(`${b.node.id}: a rounded ${style} outline is refused, so it is not modelled`);
  const [l, t, r, bb] = rings.slice(0, 4) as [number, number, number, number];
  const ops = outlinePaintOps(l, t, r, bb, w, style, color[0], color[1], color[2], color[3], faults.dash);
  const [light, dark] = tones ?? [color, color];
  return { box: b, rings, color, ops, palette: faults.tonesSwapped ? [color, dark, light] : [color, light, dark] };
}

const rgba = (c: { readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }): Rgba => [c.r, c.g, c.b, c.alpha];

/** Every outline of a program at a DPR in outline-phase order, shifted right by shift device px, under the faults. */
export function outlines(p: NativeProgram, list: readonly Box[], dpr: number, shift: number, faults: OutlineFaults = NO_OUTLINE_FAULTS): Rings[] {
  const out: Rings[] = [];
  for (const b of outlineOrder(list)) {
    const w = outlineWrite({ program: p } as never, b.node.id);
    if (w === null) continue;
    out.push(boxOutline(b, w.style, w.width, w.offset, rgba(w.color), dpr, shift, w.tones === null ? null : [rgba(w.tones[0]), rgba(w.tones[1])], faults));
  }
  return out;
}

const alpha8 = (a: number): number => Math.round(a * 255);

/**
 * A transparency layer's opaque pixel composited onto an opaque colour at the layer's 8-bit alpha a, as Chrome's committed pixels
 * show it (Skia's legacy S32A_Blend row blit, not the paint source-over of `over`): each channel src * (a + 1) >> 8 plus
 * dst * (255 - a) >> 8. Observed on the translucent dashed and ridge outlines of outline-dashed and outline-3d (rgba alpha 0.5 and
 * 0.6), where `over` is one high on every channel the two roundings differ.
 */
function layerOver(dst: Rgba, src: Rgba, a: number): Rgba {
  if (src[3] !== 255 || dst[3] !== 255) throw new Error('outline ops: a layer composite of a translucent pixel is not modelled');
  if (a === 255) return src;
  if (a === 0) return dst;
  const ch = (s: number, d: number): number => ((s * (a + 1)) >> 8) + ((d * (255 - a)) >> 8);
  return [ch(src[0], dst[0]), ch(src[1], dst[1]), ch(src[2], dst[2]), 255];
}

/** The colour of a pixel centre under the side painter's operations, painted over colour. */
export function opsOver(colour: Rgba, ops: readonly BorderOp[], palette: readonly Rgba[], cx: number, cy: number): Rgba {
  // Each frame: the root (an opaque colour) or a transparency layer (null while nothing has painted there) with its alpha.
  const frames: { c: Rgba | null; readonly alpha: number }[] = [{ c: colour, alpha: 1 }];
  const clips: boolean[] = [true];
  for (const o of ops) {
    const f = frames[frames.length - 1];
    if (f === undefined) throw new Error('outline ops: an end-layer without its begin-layer');
    if (o.op === 'begin-layer') frames.push({ c: null, alpha: o.alpha });
    else if (o.op === 'end-layer') {
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent === undefined || parent.c === null) throw new Error('outline ops: a layer composited onto nothing');
      if (f.c !== null) parent.c = layerOver(parent.c, f.c, alpha8(f.alpha));
    } else if (o.op === 'save') clips.push(clips[clips.length - 1] as boolean);
    else if (o.op === 'restore') {
      clips.pop();
      if (clips.length === 0) throw new Error('outline ops: a restore without its save');
    } else if (o.op === 'clip') {
      const pts = Array.from({ length: o.points.length / 2 }, (_, i) => [o.points[2 * i] as number, o.points[2 * i + 1] as number] as const);
      clips[clips.length - 1] = (clips[clips.length - 1] as boolean) && insidePolygon(pts, cx, cy);
    } else {
      const pts = o.points;
      const covers = o.op === 'dot' ? Math.hypot(cx - (pts[0] as number), cy - (pts[1] as number)) <= (pts[2] as number) : insidePolygon(Array.from({ length: pts.length / 2 }, (_, i) => [pts[2 * i] as number, pts[2 * i + 1] as number] as const), cx, cy);
      if (!covers || !(clips[clips.length - 1] as boolean)) continue;
      const p = palette[o.side];
      if (p === undefined) throw new Error(`outline ops: no colour ${o.side}`);
      const src: Rgba = [p[0], p[1], p[2], alpha8(o.alpha)];
      if (f.c !== null) f.c = over(f.c, src);
      else if (src[3] === 255) f.c = src;
      else throw new Error('outline ops: a translucent fill in an empty layer is not modelled');
    }
  }
  if (frames.length !== 1 || clips.length !== 1) throw new Error('outline ops: unbalanced layers or clips');
  return frames[0]?.c as Rgba;
}

/** A colour with every outline ring holding the centre of pixel (x, y) painted over it, in the order given. */
export function ringsOver(colour: Rgba, rings: readonly Rings[], x: number, y: number): Rgba {
  const cx = x + 0.5;
  const cy = y + 0.5;
  let out = colour;
  for (const o of rings) {
    if (o.ops !== null) {
      out = opsOver(out, o.ops, o.palette, cx, cy);
      continue;
    }
    const r = o.rings;
    for (let k = 0; k + 24 <= r.length; k += 24) {
      const v = (j: number): number => r[k + j] as number;
      if (insideRounded(cx, cy, v(0), v(1), v(2), v(3), r.slice(k + 8, k + 16)) && !insideRounded(cx, cy, v(4), v(5), v(6), v(7), r.slice(k + 16, k + 24))) out = over(out, o.color);
    }
  }
  return out;
}

/** The model's colour at pixel (x, y): the boxes (modelAt), then every outline ring holding the pixel centre, in outline-phase order. */
export function outlineModelAt(list: readonly Box[], rings: readonly Rings[], x: number, y: number): Rgba {
  return ringsOver(modelAt(list, x, y), rings, x, y);
}
