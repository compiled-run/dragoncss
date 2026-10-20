// GEN-c (notes/T151-gen-spec.md R14): the native marker paint against Chrome 145.0.7632.6's symbol crops
// (docs/research/gen-spike/probe/family7-symbol-oracle.json, captured by scripts/capture-gen-probe.ts: an Ahem "x" in an li of
// font-size s inside a ul with margin-top 10px and padding-left 60px, at DPR 1, 2, 3 and 2.625, black on white).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layout, NO_ENGINE_FAULTS, NO_GRID_FAULTS, validateLayoutInput, zoomInput } from '../src/index.ts';
import type { LayoutBox, LayoutInput, ListMarker, MarkerSymbol } from '../src/index.ts';
import type { Ctx } from '../src/block.ts';
import { symbolPaintRect } from '../src/marker.ts';
import { markerSymbolPaint, symbolCoverage } from '../src/paint-marker.ts';
import { ahemFont, box, neutralEnvironment, px, text } from './helpers.ts';

type Crop = { readonly id: string; readonly symbol: MarkerSymbol; readonly fontSize: number; readonly dpr: number; readonly rect: readonly number[]; readonly crop: readonly number[]; readonly rows: readonly string[] };

const ORACLE = JSON.parse(readFileSync(new URL('../../../docs/research/gen-spike/probe/family7-symbol-oracle.json', import.meta.url), 'utf8')) as { readonly chrome: string; readonly crops: readonly Crop[] };
const crops = ORACLE.crops;
const VIEWPORT = { width: 120, height: 80 };

/** The oracle page at a DPR: html > body > ul (margin-top 10px, padding-left 60px) > li (the marker, font-size s) > "x". */
function oracleInput(symbol: MarkerSymbol, size: number, dpr: number): LayoutInput {
  const marker: ListMarker = { id: 'li::marker', kind: 'symbol', symbol, text: null, font: ahemFont(size), lineHeight: { kind: 'normal' } };
  const li: LayoutBox = { ...box('li', {}, [text('li:text0', 'x', { font: ahemFont(size) })]), marker };
  const root = box('html', {}, [box('body', {}, [box('ul', { marginTop: px(10), paddingLeft: px(60) }, [li])])]);
  const input: LayoutInput = { viewport: VIEWPORT, devicePixelRatio: dpr, ...neutralEnvironment(VIEWPORT), root };
  const valid = validateLayoutInput(input);
  if (!valid.ok) throw new Error(JSON.stringify(valid.errors));
  return input;
}

/** The paint the device computes after layout: the zoomed marker in the zoomed context, at the marker box's absolute LU origin. */
function devicePaint(c: Crop) {
  const input = oracleInput(c.symbol, c.fontSize, c.dpr);
  const out = layout(input, ahemMeasurer);
  if (out.kind !== 'ok') throw new Error(out.unsupported.code);
  const at = absoluteRects(out.boxes).get('li::marker');
  if (at === undefined) throw new Error(`${c.id}: no marker rect`);
  const zoomed = zoomInput(input, NO_ENGINE_FAULTS);
  const li = ((zoomed.root.children[0] as LayoutBox).children[0] as LayoutBox).children[0] as LayoutBox;
  if (li.marker === null) throw new Error(`${c.id}: the zoomed li lost its marker`);
  const ctx: Ctx = { measurer: ahemMeasurer, devicePixelRatio: zoomed.devicePixelRatio, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS };
  return { ctx, marker: li.marker, x: at.x, y: at.y };
}

/** Chrome's gray values of a crop, row-major. */
const grays = (c: Crop): number[] => c.rows.flatMap((row) => Array.from({ length: row.length / 2 }, (_, i) => Number.parseInt(row.slice(2 * i, 2 * i + 2), 16)));

/** A crop as the device draws it: the coverage of black over white inside the rect, white elsewhere. */
function drawn(c: Crop, coverage: readonly number[]): number[] {
  const [l, t, r, b] = c.crop as [number, number, number, number];
  const [rl, rt, rr, rb] = c.rect as [number, number, number, number];
  const out: number[] = [];
  for (let y = t; y < b; y++) for (let x = l; x < r; x++) out.push(x >= rl && x < rr && y >= rt && y < rb ? 255 - (coverage[(y - rt) * (rr - rl) + (x - rl)] as number) : 255);
  return out;
}

describe('the marker symbol paint (paint-marker.ts) against Chrome', () => {
  it('reads all 84 crops of Chrome 145.0.7632.6, 28 per symbol', () => {
    expect(ORACLE.chrome).toBe('145.0.7632.6');
    expect(crops.length).toBe(84);
    for (const s of ['disc', 'circle', 'square']) expect(crops.filter((c) => c.symbol === s).length, s).toBe(28);
  });

  it('places every symbol rect where Chrome does, from the engine layout at the device scale (symbolPaintRect)', () => {
    for (const c of crops) {
      const p = devicePaint(c);
      const r = symbolPaintRect(p.ctx, p.marker, p.x, p.y);
      expect([r.left, r.top, r.right, r.bottom], c.id).toEqual(c.rect);
    }
  });

  it('draws every disc and square crop pixel-exact (channel delta 0), only the 1px ones at DPR 1 empty', () => {
    let inked = 0;
    for (const c of crops.filter((k) => k.symbol !== 'circle')) {
      const d = devicePaint(c);
      const p = markerSymbolPaint(d.ctx, d.marker, d.x, d.y);
      expect([p.left, p.top, p.right, p.bottom], c.id).toEqual(c.rect);
      expect(p.coverage.length, c.id).toBe(Math.max(0, (p.right - p.left) * (p.bottom - p.top)));
      expect(drawn(c, p.coverage), c.id).toEqual(grays(c));
      if (p.coverage.some((v) => v > 0)) inked++;
    }
    expect(inked).toBe(54);
  });

  it('fills a square whole and leaves a disc\'s corners clear', () => {
    expect(symbolCoverage('square', 3, 4, 5, 6)).toEqual([255, 255, 255, 255]);
    const disc = symbolCoverage('disc', 35, 23, 44, 32);
    expect(disc.length).toBe(81);
    expect([disc[0], disc[8], disc[72], disc[80]]).toEqual([0, 0, 0, 0]);
    expect(disc[40]).toBe(255);
    expect(symbolCoverage('disc', 5, 5, 5, 5)).toEqual([]);
  });

  it('refuses a circle, the 1 device px hairline Dragon does not draw', () => {
    expect(() => symbolCoverage('circle', 35, 23, 44, 32)).toThrow('a circle marker is not drawn natively');
  });
});
