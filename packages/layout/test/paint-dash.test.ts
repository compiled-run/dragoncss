// P6a: the dashed and dotted border reference (src/paint-dash.ts), Blink 145's side painter in device px. The paint vectors
// (packages/layout/paint-vectors/dash) carry its results to the Swift and Kotlin translations bit for bit; these tests pin the
// Blink and Skia rules it ports and prove each planted fault changes the drawing.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BorderOp, DashFaults } from '../src/paint-dash.ts';
import { borderNeedsSidePainter, borderPaintOps, innerBorderRect, NO_DASH_FAULTS, selectBestDashGap } from '../src/paint-dash.ts';

const INPUTS = new URL('../paint-vectors/dash/inputs.jsonl', import.meta.url);
const black = (n: number): number[] => Array.from({ length: n }, () => [0, 0, 0, 255]).flat();
const uniform = <T>(v: T): T[] => [v, v, v, v];
const ops = (l: number, t: number, r: number, b: number, w: readonly number[], s: readonly string[], c: readonly number[] = black(4), f: DashFaults = NO_DASH_FAULTS): BorderOp[] => borderPaintOps(l, t, r, b, w, s, c, f);
const fills = (xs: readonly BorderOp[], side: number): number[][] => xs.filter((o) => o.op === 'fill' && o.side === side).map((o) => [...o.points]);
/** The along-side extents [start, end] of the fills of a horizontal side. */
const runs = (xs: readonly BorderOp[], side: number): number[][] => fills(xs, side).map((p) => [Math.min(p[0] as number, p[2] as number), Math.max(p[0] as number, p[2] as number)]);

// ---------------------------------------------------------------- the committed vector inputs

const view = new DataView(new ArrayBuffer(8));
/** A double as its IEEE bit pattern in hex, as the translated harness reads arguments (translate/harness/host.ts bitsHex). */
const h = (x: number): string => {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
};
const COLORS: readonly (readonly number[])[] = [
  black(4),
  [0, 0, 170, 255, 0, 0, 170, 255, 0, 0, 170, 255, 0, 0, 170, 255],
  [0, 170, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255],
  [255, 0, 0, 128, 0, 128, 0, 255, 0, 0, 255, 64, 0, 0, 0, 255],
  [10, 20, 30, 0, 10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255],
];
const STYLE_SETS: readonly (readonly string[])[] = [
  uniform('dashed'),
  uniform('dotted'),
  ['dashed', 'solid', 'solid', 'solid'],
  ['solid', 'dotted', 'solid', 'solid'],
  ['dotted', 'solid', 'double', 'solid'],
  ['solid', 'double', 'solid', 'dashed'],
  ['dashed', 'none', 'dotted', 'hidden'],
  ['dotted', 'dashed', 'dotted', 'dashed'],
  ['double', 'dotted', 'double', 'dotted'],
];

/** The vector inputs: selectBestDashGap over a grid, the painter routing, and borderPaintOps over thicknesses, lengths, styles, colours and faults. */
export function dashVectorInputs(): string[] {
  const out: string[] = [];
  for (const len of [12, 20, 137, 676]) for (const [d, g] of [[6, 4], [9, 3], [5, 5]] as const) out.push(JSON.stringify(['paint:dash:selectBestDashGap', h(len), h(d), h(g)]));
  for (const s of STYLE_SETS) out.push(JSON.stringify(['paint:dash:borderNeedsSidePainter', [2, 0, 3, 1].map(h), s, (COLORS[STYLE_SETS.indexOf(s) % COLORS.length] as number[]).map(h)]));
  const box = (l: number, t: number, r: number, b: number, w: readonly number[], s: readonly string[], c: readonly number[], f: DashFaults): string =>
    JSON.stringify(['paint:dash:borderPaintOps', h(l), h(t), h(r), h(b), w.map(h), s, c.map(h), f.phase1, f.gapUnfitted]);
  // Thicknesses on both sides of the 3 device px rules, dashed and dotted, over a two-dash and a fitted length, at an odd offset.
  for (const style of ['dashed', 'dotted']) for (const t of [1, 2, 3, 4, 7]) for (const len of [7, 23]) out.push(box(21, 109, 21 + len + 2 * t, 109 + 2 * t + 5, uniform(t), uniform(style), COLORS[0] as number[], NO_DASH_FAULTS));
  // Mixed styles, colours and translucency (miters, clips, layers), one colour set each.
  STYLE_SETS.forEach((s, i) => out.push(box(16, 396, 61, 427, [6, 4, 10, 3], s, COLORS[i % COLORS.length] as number[], NO_DASH_FAULTS)));
  // Both faults, on a dashed and a dotted box.
  for (const f of [{ phase1: true, gapUnfitted: false }, { phase1: false, gapUnfitted: true }]) for (const s of ['dashed', 'dotted']) out.push(box(21, 21, 97, 40, uniform(s === 'dotted' ? 5 : 2), uniform(s), COLORS[0] as number[], f));
  // Widths wider than the box (ClampWidth), zero widths and a zero-size box.
  out.push(box(0, 0, 8, 6, [10, 10, 10, 10], uniform('dotted'), COLORS[0] as number[], NO_DASH_FAULTS));
  out.push(box(0, 0, 8, 6, [10, 9, 7, 6], ['dotted', 'solid', 'dashed', 'double'], COLORS[2] as number[], NO_DASH_FAULTS));
  out.push(box(0, 0, 40, 30, [0, 5, 0, 5], uniform('dashed'), COLORS[0] as number[], NO_DASH_FAULTS));
  out.push(box(5, 5, 5, 5, [2, 2, 2, 2], uniform('dashed'), COLORS[0] as number[], NO_DASH_FAULTS));
  return out;
}

describe('paint-vectors/dash inputs', () => {
  it('the committed inputs are dashVectorInputs() (write them with DRAGON_WRITE_DASH_INPUTS=1, then pnpm run layout:paint-vectors)', () => {
    const want = `${dashVectorInputs().join('\n')}\n`;
    if (process.env.DRAGON_WRITE_DASH_INPUTS === '1') writeFileSync(INPUTS, want);
    expect(existsSync(INPUTS)).toBe(true);
    expect(readFileSync(INPUTS, 'utf8')).toBe(want);
  });
  it('the committed vectors cover every input line', () => {
    const v = JSON.parse(readFileSync(new URL('../paint-vectors/dash/vectors.json', import.meta.url), 'utf8')) as { lines: string[]; expected: string[] };
    expect(v.lines).toEqual(dashVectorInputs());
    expect(v.expected.every((e) => e.startsWith('["ok"'))).toBe(true);
  });
});

// ---------------------------------------------------------------- Blink's rules

describe('StyledStrokeData dash selection (styled_stroke_data.cc)', () => {
  it('SelectBestDashGap picks the dash count whose gap is nearest the nominal one, so a dash ends each side', () => {
    // 408 px of 8 px dashes: 34 dashes give a gap of 4.1212, 35 give 3.7647; 4.1212 is nearer 4.
    expect(selectBestDashGap(408, 8, 4)).toBe(Math.fround(136 / 33));
    // 20 px of 6 px dashes: 2 dashes leave a gap of 8, 3 leave 1; 1 is nearer 4.
    expect(selectBestDashGap(20, 6, 4)).toBe(1);
    // With one dash too many the gap would be negative: the smaller count wins.
    expect(selectBestDashGap(16, 6, 4)).toBe(4);
  });
  it('dashes are 3x the thickness with 2x gaps under 3 device px, 2x and 1x from 3 device px (T069 §2 runs)', () => {
    // DPR 2, 1px dashed (t=2): X6 .4 fitted; t=6: X12 .6.
    const thin = runs(ops(0, 0, 200, 20, uniform(2), uniform('dashed')), 0);
    expect(thin[0]).toEqual([0, 6]);
    expect(thin.every(([a, b]) => Math.abs((b as number) - (a as number) - 6) < 1e-4)).toBe(true);
    expect(thin[thin.length - 1]?.[1]).toBe(200);
    const thick = runs(ops(0, 0, 200, 40, uniform(6), uniform('dashed')), 0);
    expect(thick[0]).toEqual([0, 12]);
    expect(thick[thick.length - 1]?.[1]).toBe(200);
  });
  it('a side no longer than two dashes is one solid line; up to two dashes and a gap it is exactly two scaled dashes', () => {
    expect(runs(ops(0, 0, 12, 20, uniform(2), uniform('dashed')), 0)).toEqual([[0, 12]]);
    const two = runs(ops(0, 0, 14, 20, uniform(2), uniform('dashed')), 0);
    expect(two.length).toBe(2);
    expect(two[1]?.[1]).toBe(14);
  });
  it('dotted sides over 3 device px are round dots of the thickness with a fitted gap, the first and last a radius in from the ends', () => {
    const d = ops(0, 0, 100, 40, uniform(8), uniform('dotted')).filter((o) => o.op === 'dot' && o.side === 0);
    expect(d[0]?.points).toEqual([4, 4, 4]);
    expect((d[d.length - 1]?.points[0] as number) > 95.9 && (d[d.length - 1]?.points[0] as number) <= 96).toBe(true);
  });
  it('dotted sides of 3 device px or less are square dots of the thickness with whole end dots (EnforceDotsAtEndpoints)', () => {
    // t = 2, length 100 (mod 4 = 0): a start dot and an end dot drawn as rects without anti-aliasing.
    const top = ops(0, 0, 100, 20, uniform(2), uniform('dotted')).filter((o) => o.side === 0);
    expect(top[0]).toMatchObject({ op: 'fill', antialias: false, points: [0, 0, 2, 0, 2, 2, 0, 2] });
    expect(top[1]).toMatchObject({ op: 'fill', antialias: false, points: [98, 0, 100, 0, 100, 2, 98, 2] });
  });
  it('odd thicknesses stroke half a pixel down so the band stays on whole pixels', () => {
    const f = fills(ops(0, 0, 100, 20, uniform(3), uniform('dashed')), 0);
    expect(f[0]?.[1]).toBe(0);
    expect(f[0]?.[5]).toBe(3);
  });
});

describe("BoxBorderPainter's complex path (box_border_painter.cc)", () => {
  it('sides paint by alpha, then style priority (dashed, dotted and double before solid), then top, bottom, right, left', () => {
    const order = ops(0, 0, 100, 50, [4, 4, 4, 4], ['solid', 'dashed', 'solid', 'dotted']).filter((o) => o.op === 'fill' || o.op === 'dot').map((o) => o.side);
    const firsts = order.filter((s, i) => order.indexOf(s) === i);
    expect(firsts).toEqual([1, 3, 0, 2]);
  });
  it('dashed and dotted sides are clipped at corners they share with an unpainted side of another colour (soft, anti-aliased miters)', () => {
    const colors = [0, 170, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255];
    const o = ops(16, 396, 428, 456, [6, 6, 6, 6], ['dashed', 'dotted', 'solid', 'solid'], colors);
    const e = Math.fround(0.1);
    // The top paints first: the solid left side will overdraw its left corner (no miter); the dotted right side will not, and
    // differs in colour, so the top is clipped at the right corner only (the second miter's quad, extended 0.1 px).
    expect(o.slice(0, 2)).toMatchObject([{ op: 'save' }, { op: 'clip', antialias: true, points: [16, 396, 16, 402, Math.fround(422 + e), 402, Math.fround(428 + e), 396] }]);
    // The dotted right side then clips at the finished top corner.
    const right = o.findIndex((x) => x.op === 'dot' && x.side === 1);
    expect(o[right - 1]).toMatchObject({ op: 'clip', antialias: true, points: [428, Math.fround(396 - e), 422, Math.fround(402 - e), 422, 456, 428, 456] });
    // The solid bottom meets the finished dotted right side in the same colour: a hard (aliased) miter.
    const bottom = o.findIndex((x) => x.op === 'fill' && x.side === 2);
    expect(o[bottom - 1]).toMatchObject({ op: 'clip', antialias: false });
  });
  it('a uniform dashed border needs no clip: each side strokes its whole outer side', () => {
    const o = ops(0, 0, 100, 50, uniform(4), uniform('dashed'));
    expect(o.some((x) => x.op === 'clip')).toBe(false);
  });
  it('double sides in the complex path draw thirds of (thickness + 1) / 3', () => {
    const o = ops(0, 0, 100, 50, [4, 2, 5, 2], ['dotted', 'solid', 'double', 'solid']);
    const bottom = fills(o, 2);
    expect(bottom.length).toBe(2);
    expect(bottom.map((p) => (p[5] as number) - (p[1] as number))).toEqual([2, 2]);
  });
  it('translucent sides paint inside transparency layers, most opaque group outermost', () => {
    const colors = [255, 0, 0, 128, 0, 128, 0, 255, 0, 0, 255, 64, 0, 0, 0, 255];
    const o = ops(0, 0, 100, 50, uniform(4), uniform('dashed'), colors);
    expect(o.filter((x) => x.op === 'begin-layer').length).toBe(o.filter((x) => x.op === 'end-layer').length);
    expect(o.filter((x) => x.op === 'begin-layer').length).toBeGreaterThan(0);
  });
  it('routes to the side painter only when a visible side is dashed or dotted', () => {
    expect(borderNeedsSidePainter(uniform(2), uniform('dashed'), black(4))).toBe(true);
    expect(borderNeedsSidePainter(uniform(2), ['solid', 'double', 'solid', 'solid'], black(4))).toBe(false);
    expect(borderNeedsSidePainter([0, 2, 2, 2], ['dashed', 'solid', 'solid', 'solid'], black(4))).toBe(false);
    expect(borderNeedsSidePainter(uniform(2), ['dotted', 'solid', 'solid', 'solid'], [0, 0, 0, 0, ...black(3)])).toBe(false);
  });
  it('refuses a border style it has no painter for', () => {
    expect(() => ops(0, 0, 10, 10, uniform(2), ['groove', 'solid', 'solid', 'solid'])).toThrow(/groove/);
  });
});

describe('the inner border rect (contoured_border_geometry.cc PixelSnappedContouredInnerBorder)', () => {
  it('is the box less the widths, its size clamped at zero at the inset origin when the widths exceed the box', () => {
    expect(innerBorderRect(10, 20, 50, 60, [1, 2, 3, 4])).toEqual([14, 21, 48, 57]);
    expect(innerBorderRect(0, 0, 8, 6, [10, 10, 10, 10])).toEqual([10, 10, 10, 10]);
    expect(innerBorderRect(0, 0, 40, 6, [4, 5, 4, 5])).toEqual([5, 4, 35, 4]);
  });
  it('keeps every clip corner of a box whose widths exceed it out of the inverted rect (mixed styles, so the sides are clipped)', () => {
    const o = ops(0, 0, 8, 6, [10, 9, 7, 6], ['dotted', 'solid', 'dashed', 'double'], [0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255]);
    const clips = o.filter((x) => x.op === 'clip');
    expect(clips.length).toBeGreaterThan(0);
    // The unclamped inner corners would be at x 6 and 9 - 9 = -1 (right edge 8 - 9) and y 10 and -1: inverted. Clamped, the inner
    // rect is the point (6, 10), so no clip point lies left of the inset origin's x or above its y unless it is an outer corner.
    for (const c of clips) for (let i = 0; i < c.points.length; i += 2) {
      const x = c.points[i] as number;
      const y = c.points[i + 1] as number;
      expect(x === -1 || y === -1, `clip point ${x},${y}`).toBe(false);
    }
  });
});

describe('planted faults change the drawing', () => {
  for (const [name, f] of [['phase1', { phase1: true, gapUnfitted: false }], ['gapUnfitted', { phase1: false, gapUnfitted: true }]] as const) {
    it(`${name}: dashed and dotted sides draw differently`, () => {
      for (const s of ['dashed', 'dotted']) {
        const clean = ops(21, 21, 697, 88, uniform(s === 'dotted' ? 5 : 2), uniform(s));
        const planted = ops(21, 21, 697, 88, uniform(s === 'dotted' ? 5 : 2), uniform(s), black(4), f);
        expect(JSON.stringify(planted)).not.toBe(JSON.stringify(clean));
      }
    });
  }
});
