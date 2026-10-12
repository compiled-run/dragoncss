// text-align: justify (css-text-3 §7.3, §7.4; Blink 145 justification_utils.cc and shape_result_spacing.cc) over 10px Ahem:
// every glyph advances 640 LU. Expected values follow the text-align-justify fixture's cases.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deviceShapedMeasurer } from '../src/platform.ts';
import type { GlyphShaper } from '../src/shaping.ts';
import { pieceGlyphs } from '../src/shaping.ts';
import { latinBreakClass, maybeCjkIdeographOrSymbol } from '../src/inline.ts';
import { coveredIndex } from '../src/text.ts';
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
  it('refuses a justified line holding a CJK ideograph or symbol Chrome expands around, its hanging end included', () => {
    const ctx = { measurer: shapedMeasurer, devicePixelRatio: 1, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS };
    const font = { family: SHAPED, size: 10, specifiedSize: { kind: 'px' as const, value: 10 }, absoluteSize: true };
    const make = (value: string): LayoutBox => box('a', { width: px(55), textAlign: 'justify' }, [text('t', value, { font })]);
    const refusal = (value: string): string | null => {
      try {
        placeLines(ctx, make(value), fromCssPx(55));
        return null;
      } catch (e) {
        const u = (e as { unsupported?: { code: string } }).unsupported;
        if (u === undefined) throw e;
        return u.code;
      }
    };
    // Today both line breakers refuse every such code point first (line-break; text-script outside Latin scope; text-glyph without a glyph), so justifyLine's own text-align refusal is the
    // second guard; either way the line is refused with a typed diagnostic, never justified with Latin-only opportunities.
    for (const value of ['XX \u2020 XX XX X', 'XX\u3000XX XX X', 'X \u4E00 XX XX X', 'XX \u{1F600} XX XX']) expect(refusal(value), value).toMatch(/^text-(script|glyph|align)$|^line-break$/);
    expect(refusal('XX XX XXX X')).toBeNull();
    const reachable: number[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) if (maybeCjkIdeographOrSymbol(cp) && (latinBreakClass(cp) >= 0 || coveredIndex(cp) >= 0)) reachable.push(cp);
    expect(reachable).toEqual([]);
  });
  it('treats every code point of Blink 145 IsCJKIdeographOrSymbol as one, and Latin punctuation as not', () => {
    const exactRanges = [
      0x2695, 0x2696, 0x2e80, 0x2fdf, 0x31c0, 0x31ef, 0x3400, 0x4dbf, 0x4e00, 0x9fff, 0xf900, 0xfaff, 0x20000, 0x2ffff, 0x2156, 0x215a,
      0x2160, 0x216b, 0x2170, 0x217b, 0x231a, 0x231b, 0x23e9, 0x23ec, 0x23be, 0x23cc, 0x2460, 0x2492, 0x249c, 0x24ff, 0x25ce, 0x25d3,
      0x25e2, 0x25e6, 0x25fd, 0x25fe, 0x2600, 0x2603, 0x2660, 0x266f, 0x2614, 0x2615, 0x2648, 0x2653, 0x26aa, 0x26ab, 0x26c4, 0x26c5,
      0x26f2, 0x26f3, 0x2753, 0x2757, 0x2763, 0x2764, 0x2672, 0x267d, 0x2776, 0x277f, 0x2795, 0x2797, 0x270a, 0x270d, 0x2ff0, 0x302d,
      0x3031, 0x312f, 0x3190, 0x31bf, 0x3200, 0x33ff, 0x4dc0, 0x4dff, 0xf860, 0xf862, 0xfe30, 0xfe6f, 0xff00, 0xff0c, 0xff0e, 0xff1a,
      0xff1f, 0xffef, 0x16fe0, 0x16fff, 0x17000, 0x187ff, 0x18800, 0x18aff, 0x1b000, 0x1b0ff, 0x1b100, 0x1b12f, 0x1b170, 0x1b2ff,
      0x1f110, 0x1f129, 0x1f130, 0x1f149, 0x1f150, 0x1f169, 0x1f170, 0x1f189, 0x1f191, 0x1f19a, 0x1f1e6, 0x1f1ff, 0x1f200, 0x1f6ff,
      0x1f3fb, 0x1f3ff, 0x1f6dc, 0x1f6df, 0x1f7e0, 0x1f7eb, 0x1f7f0, 0x1f7f0, 0x1f900, 0x1f90f, 0x1f910, 0x1f918, 0x1f919, 0x1f97f,
      0x1f980, 0x1f9bf, 0x1f9c0, 0x1f9ff, 0x1fa70, 0x1fa7c, 0x1fa80, 0x1fa8a, 0x1fa8e, 0x1fac6, 0x1fac8, 0x1fadc, 0x1fadf, 0x1faea,
      0x1faef, 0x1faf8,
    ];
    const exactValues = [
      0x2c7, 0x2ca, 0x2cb, 0x2d9, 0x2020, 0x2021, 0x2030, 0x203b, 0x203c, 0x2042, 0x2047, 0x2048, 0x2049, 0x2051, 0x20dd, 0x20de,
      0x2100, 0x2103, 0x2105, 0x2109, 0x210a, 0x2113, 0x2116, 0x2121, 0x212b, 0x213b, 0x2150, 0x2151, 0x2152, 0x217f, 0x2189, 0x2307,
      0x23f0, 0x23f3, 0x2312, 0x23ce, 0x2423, 0x25a0, 0x25a1, 0x25a2, 0x25aa, 0x25ab, 0x25b1, 0x25b2, 0x25b3, 0x25b6, 0x25b7, 0x25bc,
      0x25bd, 0x25c0, 0x25c1, 0x25c6, 0x25c7, 0x25c9, 0x25cb, 0x25cc, 0x25ef, 0x2605, 0x2606, 0x260e, 0x2616, 0x2617, 0x261d, 0x2640,
      0x2642, 0x267f, 0x2693, 0x26a0, 0x26a1, 0x26bd, 0x26be, 0x26ce, 0x26d4, 0x26ea, 0x26f5, 0x26f9, 0x26fa, 0x26fd, 0x2705, 0x2708,
      0x2713, 0x271a, 0x2728, 0x273f, 0x2740, 0x274c, 0x274e, 0x27b0, 0x27bf, 0x2b1a, 0x2b1b, 0x2b1c, 0x2b50, 0x2b55, 0xfe10, 0xfe11,
      0xfe12, 0xfe19, 0xff1d, 0x1f100, 0x1f004, 0x1f0cf, 0x1f18e,
    ];
    const missed: number[] = [];
    for (let k = 0; k < exactRanges.length; k += 2) for (let cp = exactRanges[k] as number; cp <= (exactRanges[k + 1] as number); cp++) if (!maybeCjkIdeographOrSymbol(cp)) missed.push(cp);
    for (const cp of exactValues) if (!maybeCjkIdeographOrSymbol(cp)) missed.push(cp);
    for (let cp = 0; cp <= 0x10ffff; cp++) if (/\p{Emoji_Presentation}/u.test(String.fromCodePoint(cp)) && !maybeCjkIdeographOrSymbol(cp)) missed.push(cp);
    expect(missed).toEqual([]);
    for (const cp of [0x20, 0x41, 0xe9, 0x2c6, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x20ac]) expect(maybeCjkIdeographOrSymbol(cp), cp.toString(16)).toBe(false);
  });
  it('gives each shaped glyph its code point, so a device shifts it by that code point', () => {
    const g = pieceGlyphs(shapedMeasurer, 'XX XX', { family: SHAPED, size: 10 } as never, 1, 4);
    expect(g.ok && g.chars).toEqual([0, 1, 2]);
  });
});
