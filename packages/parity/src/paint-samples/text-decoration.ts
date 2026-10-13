// The text-decoration module's sample points (TDEC-b, notes/T148J-tdec.md): the 'decoration' kind. The rects are the ones the
// device places (decoration-rects.ts placedDecorations). Each rect is whole device rows; a column is fully covered (columnAlpha 256)
// or a partial end. Along each rect, every maximal run of fully covered columns at least SAMPLE_INSET_DEVICE_PX clear of every
// glyph box edge on the rect's rows and of every other rect's partial end, with one clip state and one side of the glyph boxes, gets
// its middle column sampled on every row of the rect (rule decoration:<text>:line<j>:<n>:<state>, the state row, ink, gap or
// gap-ink: a clipped column is a skip-ink gap, an ink column lies inside a glyph box) and on the row just above and just below the
// rect where that row is clear of the glyph edges (states above and below). An under or overline paints beneath the glyphs it crosses, a line-through over them, so the ink
// points prove the paint order; the rows and the rows beside them prove the snapped rows; a gap proves the skip-ink clip. A base
// colour point within SAMPLE_INSET_DEVICE_PX of a rect's edge is suppressed, as is a base scanline that comes that near one.
import { textDecoration as td } from '@dragon/layout';
import { glyphLines } from '../pixel-reference.ts';
import type { GlyphBox, SamplePoint } from '../samples.ts';
import { glyphClearance, ruleKind, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import type { PlacedDecoration } from './decoration-rects.ts';
import { placedDecorations } from './decoration-rects.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';

type Placed = { readonly rects: readonly PlacedDecoration[]; readonly glyphs: readonly GlyphBox[] };

const cache = new WeakMap<PaintSampleContext, Placed>();

function placed(ctx: PaintSampleContext): Placed {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  const rects = placedDecorations(ctx.program, ctx.viewport, ctx.dpr);
  const out = { rects, glyphs: rects.length === 0 ? [] : glyphLines(ctx.program, ctx.viewport, ctx.dpr).flatMap((l) => l.glyphs) };
  cache.set(ctx, out);
  return out;
}

/** Whether column x of a rect's rows is a partial end of the rect (anti-aliased: neither 0 nor 256). */
const partialAt = (r: td.DecorationRect, x: number): boolean => {
  const a = td.columnAlpha(x, r.left, r.right, r.height);
  return a > 0 && a < 256;
};

/** Whether the pixel [x, x + 1) x [y, y + 1) comes within the inset of an edge of a rect (inside or outside it). */
function nearRectEdge(x: number, y: number, r: td.DecorationRect, inset: number): boolean {
  const right = r.right;
  const bottom = r.top + r.height;
  const inBand = (v: number, lo: number, hi: number): boolean => v + 1 > lo - inset && v < hi + inset;
  const nearEdge = (v: number, e: number): boolean => v + 1 > e - inset && v < e + inset;
  return (inBand(y, r.top, bottom) && (nearEdge(x, r.left) || nearEdge(x, right))) || (inBand(x, r.left, right) && (nearEdge(y, r.top) || nearEdge(y, bottom)));
}

/** Whether a pixel is near an edge of any decoration rect of the case. */
export function nearDecoration(ctx: PaintSampleContext, x: number, y: number): boolean {
  return placed(ctx).rects.some((r) => nearRectEdge(x, y, r, SAMPLE_INSET_DEVICE_PX));
}

const near = new WeakMap<PaintSampleContext, ReadonlySet<string>>();

/** The base edge scanlines that come near a decoration rect (edge rules are judged per scanline, so the whole scanline goes). */
function scanlinesNearDecorations(ctx: PaintSampleContext): ReadonlySet<string> {
  const hit = near.get(ctx);
  if (hit !== undefined) return hit;
  const out = new Set<string>();
  if (placed(ctx).rects.length > 0) for (const p of ctx.base) if (ruleKind(p.rule) === 'edge' && !out.has(p.rule) && nearDecoration(ctx, p.x, p.y)) out.add(p.rule);
  near.set(ctx, out);
  return out;
}

/** Whether a pixel lies inside a glyph box by at least the inset (0 outside every box: the caller checks the clearance). */
const insideGlyph = (x: number, y: number, glyphs: readonly GlyphBox[]): boolean => glyphs.some((g) => x >= g.left && x + 1 <= g.right && y >= g.top && y + 1 <= g.bottom);

/** The decoration points of a case: per rect, the middle column of every eligible run, on its rows and the clear rows beside them. */
export function decorationPoints(ctx: PaintSampleContext): SamplePoint[] {
  const { rects, glyphs } = placed(ctx);
  const inset = SAMPLE_INSET_DEVICE_PX;
  const inImage = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < ctx.size.width && y < ctx.size.height;
  const clear = (x: number, y: number): boolean => glyphs.every((g) => glyphClearance(x, y, g) >= inset);
  const inRows = (r: td.DecorationRect, y: number): boolean => y >= r.top && y < r.top + r.height;
  const out: SamplePoint[] = [];
  for (const r of rects) {
    const bottom = r.top + r.height;
    const rows = [...Array(r.height).keys()].map((k) => r.top + k);
    // A column is eligible when the rect fully covers it, it is clear of every glyph edge on the rect's rows, and no rect whose
    // rows reach those rows or the rows beside them has a partial end there.
    const state = (x: number): string | null => {
      if (td.columnAlpha(x, r.left, r.right, r.height) !== 256) return null;
      if (!rows.every((y) => clear(x, y))) return null;
      if (rects.some((o) => o.top <= bottom && o.top + o.height >= r.top - 1 && partialAt(o, x))) return null;
      const ink = rows.every((y) => insideGlyph(x, y, glyphs));
      if (!ink && rows.some((y) => insideGlyph(x, y, glyphs))) return null;
      const gap = td.columnClipped(x, r.clips);
      return gap ? (ink ? 'gap-ink' : 'gap') : ink ? 'ink' : 'row';
    };
    const runs: { readonly from: number; readonly to: number; readonly state: string }[] = [];
    for (let x = Math.floor(r.left); x < Math.ceil(r.right); x++) {
      const s = state(x);
      const last = runs[runs.length - 1];
      if (s !== null && last !== undefined && last.state === s && last.to === x) runs[runs.length - 1] = { ...last, to: x + 1 };
      else if (s !== null) runs.push({ from: x, to: x + 1, state: s });
    }
    const rule = `decoration:${r.text}:line${r.lineIndex}:${r.index}`;
    for (const run of runs) {
      const x = Math.floor((run.from + run.to - 1) / 2);
      for (const y of rows) if (inImage(x, y)) out.push({ x, y, rule: `${rule}:${run.state}` });
      // The rows beside the rect where they are clear of the glyph edges, unless another rect paints them.
      for (const [y, side] of [[r.top - 1, 'above'], [bottom, 'below']] as const) {
        if (inImage(x, y) && clear(x, y) && !rects.some((o) => inRows(o, y) && x + 1 > o.left && x < o.right)) out.push({ x, y, rule: `${rule}:${side}` });
      }
    }
  }
  return out;
}

export const TEXT_DECORATION_SAMPLES: PaintSamples = {
  name: 'text-decoration',
  keep: (p: SamplePoint, ctx: PaintSampleContext) => {
    if (placed(ctx).rects.length === 0) return true;
    return ruleKind(p.rule) === 'edge' ? !scanlinesNearDecorations(ctx).has(p.rule) : !nearDecoration(ctx, p.x, p.y);
  },
  points: (ctx: PaintSampleContext) => decorationPoints(ctx),
};
