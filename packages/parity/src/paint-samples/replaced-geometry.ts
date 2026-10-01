// REPL-a: the paint rects of a case's replaced boxes at one DPR (absolute device px), from the engine as the device computes them
// (dragon expected-dump.ts replacedGeometries), and the decoded image of each image write. Computed once per sample context.
import type { ReplacedPaint, SnappedRect } from '@dragon/layout';
import { snapEdges } from '@dragon/layout';
import { programInput, replacedGeometries } from 'dragon';
import { expectedEngine } from '../native-host.ts';
import { inflateSync } from 'node:zlib';
import { decodePng } from '../../../dragon/src/images/png.ts';
import type { RgbaImage } from '../native-compare.ts';
import type { PaintSampleContext } from './types.ts';

/**
 * A replaced box: its paint rects, its decoded image (null for a web view) and the snapped rects of every box and line laid out
 * after it, which paint over it (CSS2 Appendix E: later boxes in tree order paint later; positioned boxes are placed last).
 */
export type ReplacedSamplesBox = { readonly paint: ReplacedPaint; readonly image: RgbaImage | null; readonly later: readonly SnappedRect[] };

const cache = new WeakMap<PaintSampleContext, ReadonlyMap<string, ReplacedSamplesBox>>();

/** The replaced boxes of a sample context by id: their paint rects and, for an image, its decoded pixels. */
export function replacedBoxes(ctx: PaintSampleContext): ReadonlyMap<string, ReplacedSamplesBox> {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  // A case with no image and no foreign view needs no geometry, and runs no layout for it.
  if (!ctx.program.nodes.some((n) => n.writes.some((w) => w.kind === 'replaced-image' || w.kind === 'foreign-view'))) {
    const none = new Map<string, ReplacedSamplesBox>();
    cache.set(ctx, none);
    return none;
  }
  const engine = expectedEngine();
  const input = programInput(ctx.program, ctx.viewport, ctx.dpr);
  const out = engine.layout(input, engine.measurer);
  if (out.kind !== 'ok') throw new Error(`the engine refused the program at ${ctx.dpr}`);
  const paints = replacedGeometries(engine, input, out.boxes);
  const snapped = snapEdges(out.boxes);
  const order = new Map(out.boxes.map((b, i) => [b.id, i]));
  const boxes = new Map<string, ReplacedSamplesBox>();
  for (const n of ctx.program.nodes) {
    const paint = paints.get(n.id);
    if (paint === undefined) continue;
    const w = n.writes.find((x) => x.kind === 'replaced-image');
    const image = w === undefined || w.kind !== 'replaced-image' ? null : decodePng(new Uint8Array(Buffer.from(w.data, 'base64')), (d) => new Uint8Array(inflateSync(d)));
    boxes.set(n.id, { paint, image, later: snapped.slice((order.get(n.id) as number) + 1) });
  }
  cache.set(ctx, boxes);
  return boxes;
}
