// text-align: justify (css-text-3 §7.3, §7.4; Blink 145 justification_utils.cc and shape_result_spacing.cc) over 10px Ahem:
// every glyph advances 640 LU. Expected values follow the text-align-justify fixture's cases.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deviceShapedMeasurer } from '../src/platform.ts';
import type { GlyphShaper } from '../src/shaping.ts';
import { pieceGlyphs } from '../src/shaping.ts';
import { AHEM_FONT_DATA } from '../src/text.ts';
import { absoluteRects, ahemMeasurer, fromCssPx, layout, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines } from '../src/index.ts';
import type { LayoutBox, LayoutRect, LayoutResult, TextLeaf } from '../src/index.ts';
import { box, br, neutralEnvironment, px, span, text } from './helpers.ts';

const G = 640;

function run(root: LayoutBox): LayoutResult {
  return layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer);
}

function lines(r: LayoutResult, leaf: string): number[][] {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  const abs = absoluteRects(r.boxes);
  const out: number[][] = [];
  for (let j = 0; abs.has(`${leaf}:line${j}`); j++) {
    const l = abs.get(`${leaf}:line${j}`) as LayoutRect;
    out.push([l.x, l.y, l.width]);
  }
  return out;
}

const justified = (width: number, leaves: (TextLeaf | ReturnType<typeof span> | ReturnType<typeof br>)[], style: Partial<LayoutBox['style']> = {}): LayoutBox =>
  box('root', {}, [box('a', { width: px(width), textAlign: 'justify', ...style }, leaves)]);

const shifts = (width: number, leaves: TextLeaf[]): number[][] =>
  placeLines({ measurer: ahemMeasurer, devicePixelRatio: 1, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS }, justified(width, leaves).children[0] as LayoutBox, fromCssPx(width)).map((l) => [...(l.pieces[0]?.shifts ?? [])]);

describe('text-align: justify', () => {
  it('expands every line but the last at its spaces, from the line-left edge; the last line is start-aligned', () => {
    expect(lines(run(justified(55, [text('t', 'XX XX XXX X')])), 't')).toEqual([[0, 0, 55 * 64], [0, G, 5 * G]]);
    expect(lines(run(justified(55, [text('t', 'XX XX XXX X')], { direction: 'rtl' })), 't')).toEqual([[0, 0, 55 * 64], [5 * 64, G, 5 * G]]);
  });
  it('splits the free space evenly in 16.16 and gives the last opportunity the remainder', () => {
    // 70.3px is 4499 LU: 19 LU over "X X X X" with 3 spaces is 19456 / 3, so 6485, 6485 and 6486.
    expect(lines(run(justified(70.3, [text('t', 'X X X X X')])), 't')[0]).toEqual([0, 0, 4499]);
    expect(shifts(70.3, [text('t', 'X X X X X')])[0]).toEqual([0, 0, 6485 / 65536, 6485 / 65536, 12970 / 65536, 12970 / 65536, 19456 / 65536]);
    expect(shifts(70.3, [text('t', 'X X X X X')])[1]).toEqual([]);
  });
  it('does not expand a line ending in a forced break, a line without a space, or an overflowing line', () => {
    expect(lines(run(justified(55, [text('t0', 'XX X'), br('b'), text('t1', 'XX XX XXX')])), 't0')).toEqual([[0, 0, 4 * G]]);
    expect(lines(run(justified(25, [text('t', 'XXXXX XX')])), 't')).toEqual([[0, 0, 5 * G], [0, G, 2 * G]]);
    expect(lines(run(justified(25, [text('t', 'XXXXXX XX')])), 't')).toEqual([[0, 0, 6 * G], [0, G, 2 * G]]);
  });
  it('counts opportunities across the leaves and inline boxes of a line and moves each piece by the expansion before it', () => {
    const r = run(justified(73, [text('t0', 'XX '), span('s', [text('t1', 'X X ')]), text('t2', 'XXXX XX')]));
    // "XX X X" is 60px on 73px (the space after it hangs): 13px over its 2 spaces is 416 LU each.
    expect(lines(r, 't0')).toEqual([[0, 0, 3 * G + 416]]);
    expect(lines(r, 't1')[0]).toEqual([3 * G + 416, 0, 3 * G + 416]);
    expect(lines(r, 't2')[0]).toEqual([0, G, 7 * G]);
  });
});

// The real-font path (shaping.ts justifiedViewWidth) against the Ahem path: the bundled Ahem shaped by HarfBuzz under another
// face name goes through LineBreaker's text results, and must justify every line to the same rects and glyph shifts.
type HB = { createFace(bytes: Uint8Array): number; createFont(face: number, o: { size: number }): number; shape(font: number, text: string, offset: number, length: number, o: { script: string; language: string; direction?: 'ltr' | 'rtl' }): Int32Array };
const wasm = (await import(new URL('../../text-shaper/src/wasm.ts', import.meta.url).href)) as Record<string, unknown>;
const hb = (wasm.DragonHB as { load(): HB }).load();
const ahemFace = hb.createFace(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'vendor/fonts/Ahem.ttf')));
const SHAPED = 'AhemShaped';
const shaper: GlyphShaper = {
  shape(face: string, size: number, value: string, start: number, end: number, script: string, rtl: boolean, language: string): readonly number[] {
    if (face !== SHAPED) throw new Error(`no face ${face}`);
    return Array.from(hb.shape(hb.createFont(ahemFace, { size }), value, start, end - start, { script, direction: rtl ? 'rtl' : 'ltr', language }));
  },
};
const shapedMeasurer = deviceShapedMeasurer(new Map([[SHAPED, AHEM_FONT_DATA]]), shaper);

describe('text-align: justify on the real-font path', () => {
  const texts = ['XX XX XXX X', 'X X X X X X X X', 'XXX X XX XXXX X XX X X XXX', 'pq Xp XX pX qXX X'];
  it('justifies every line as the Ahem path does, to the LayoutUnit and the 16.16 glyph shift', () => {
    let justifiedLines = 0;
    for (const size of [10, 13, 26.25]) {
      for (const value of texts) {
        for (let width = 3 * size; width <= 12 * size; width += 0.7) {
          for (const direction of ['ltr', 'rtl'] as const) {
            const leaves = (family: string): TextLeaf[] => [text('t', value, { font: { family, size, specifiedSize: { kind: 'px', value: size }, absoluteSize: true } })];
            const make = (family: string): LayoutBox => box('a', { width: px(width), textAlign: 'justify', direction }, leaves(family));
            const ctx = (measurer: typeof ahemMeasurer) => ({ measurer, devicePixelRatio: 1, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS });
            const want = placeLines(ctx(ahemMeasurer), make('Ahem'), fromCssPx(width));
            const got = placeLines(ctx(shapedMeasurer), make(SHAPED), fromCssPx(width));
            expect(got, `${value} at ${width}px, ${size}px ${direction}`).toEqual(want);
            justifiedLines += want.filter((l) => (l.pieces[0]?.shifts.length ?? 0) > 0).length;
          }
        }
      }
    }
    expect(justifiedLines).toBeGreaterThan(500);
  });
  it('gives each shaped glyph its code point, so a device shifts it by that code point', () => {
    const g = pieceGlyphs(shapedMeasurer, 'XX XX', { family: SHAPED, size: 10 } as never, 1, 4);
    expect(g.ok && g.chars).toEqual([0, 1, 2]);
  });
});
