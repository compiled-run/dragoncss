// The outline part of the host paint model (pnt1-outline, pnt1-visibility): every solid or double outline painted last, each box's
// descendants' outlines before its own (Blink's BoxFragmentPainter paints kDescendantOutlinesOnly, then kSelfOutlineOnly), as the
// rings of the TS paint-radius.ts outlineRings: what the device draws in the root view.
import { outlineOffsetPx, outlineRings, outlineWidthPx } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { outlineWrite } from '../src/paint-samples/outline.ts';
import type { Box, Rgba } from './paint-model.ts';
import { insideRounded, modelAt, over } from './paint-model.ts';

export type Rings = { readonly box: Box; readonly rings: readonly number[]; readonly color: Rgba };

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

/** The rings of one outline of a box at a DPR (css px width and offset), shifted right by shift device px. */
export function boxOutline(b: Box, style: 'solid' | 'double', width: number, offset: number, color: Rgba, dpr: number, shift = 0): Rings {
  const radii = b.radii === null ? [0, 0, 0, 0, 0, 0, 0, 0] : b.radii.slice(0, 8);
  return { box: b, rings: outlineRings(b.l + shift, b.t, b.r + shift, b.b, radii, outlineWidthPx(width, dpr), outlineOffsetPx(offset, dpr), style === 'double'), color };
}

/** Every outline of a program at a DPR in outline-phase order, its rings shifted right by shift device px. */
export function outlines(p: NativeProgram, list: readonly Box[], dpr: number, shift: number): Rings[] {
  const out: Rings[] = [];
  for (const b of outlineOrder(list)) {
    const w = outlineWrite({ program: p } as never, b.node.id);
    if (w === null) continue;
    const full = b.node.writes.find((x) => x.kind === 'outline');
    if (full === undefined || full.kind !== 'outline') throw new Error(`${b.node.id}: no outline write`);
    out.push(boxOutline(b, w.style, w.width, w.offset, [full.color.r, full.color.g, full.color.b, full.color.alpha], dpr, shift));
  }
  return out;
}

/** A colour with every outline ring holding the centre of pixel (x, y) painted over it, in the order given. */
export function ringsOver(colour: Rgba, rings: readonly Rings[], x: number, y: number): Rgba {
  const cx = x + 0.5;
  const cy = y + 0.5;
  let out = colour;
  for (const o of rings) {
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
