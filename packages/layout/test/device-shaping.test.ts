// The device apps' text path (TXT1a-2 phase R): deviceShapedMeasurer, which each app's bridge builds over its HarfBuzz shim, and
// pieceGlyphs, which gives a line piece's glyph ids and pen x from the shaped item. Over the bundled Ahem the shaped measurer
// must measure every width as the font-data measurer the apps used before, so the device layouts do not move.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '../src/block.ts';
import type { TextFont } from '../src/input.ts';
import { deviceShapedMeasurer, REFERENCE_LANGUAGE, REFERENCE_PLATFORM, shapedMeasurerFor } from '../src/platform.ts';
import type { GlyphShaper } from '../src/shaping.ts';
import { FEATURE_STRIDE, GLYPH_STRIDE, NO_HAN_KERNING, pieceGlyphs } from '../src/shaping.ts';
import type { MeasureResult } from '../src/text.ts';
import { AHEM_FACE_ID, AHEM_FONT_DATA, AHEM_SHA256, ahemMeasurer, coveredCodePoints, coveredIndex } from '../src/text.ts';
import { platformFontSize, zoomFontSize } from '../src/units.ts';

// packages/text-shaper is loaded by relative path at run time (no package.json change), as in shaping-gate.test.ts.
type Feature = { readonly tag: string; readonly value: number; readonly start?: number; readonly end?: number };
type HB = {
  createFace(bytes: Uint8Array): number;
  createFont(face: number, o: { size: number }): number;
  shape(font: number, text: string, offset: number, length: number, o: { script: string; language: string; direction?: 'ltr' | 'rtl'; features?: readonly Feature[] }): Int32Array;
};
const load = async (rel: string): Promise<Record<string, unknown>> => (await import(new URL(rel, import.meta.url).href)) as Record<string, unknown>;
const wasm = await load('../../text-shaper/src/wasm.ts');
const hb = (wasm.DragonHB as { load(): HB }).load();
const tagToString = wasm.tagToString as (tag: number) => string;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ahemBytes = readFileSync(join(root, 'vendor/fonts/Ahem.ttf'));
const ahemFace = hb.createFace(ahemBytes);
const fonts = new Map<number, number>();

/** The host side of R1 over the bundled Ahem, as each app's shim answers the bridge. */
const ahemShaper: GlyphShaper = {
  shape(face: string, size: number, text: string, start: number, end: number, script: string, rtl: boolean, language: string, features: readonly number[]): readonly number[] {
    if (face !== AHEM_FACE_ID) throw new Error(`no face ${face}`);
    let font = fonts.get(size);
    if (font === undefined) {
      font = hb.createFont(ahemFace, { size });
      fonts.set(size, font);
    }
    const fs: Feature[] = [];
    for (let i = 0; i < features.length; i += FEATURE_STRIDE) fs.push({ tag: tagToString(features[i] as number), value: features[i + 1] as number, start: features[i + 2] as number, end: features[i + 3] as number });
    return Array.from(hb.shape(font, text, start, end - start, { script, direction: rtl ? 'rtl' : 'ltr', language, features: fs }));
  },
};

const font = (size: number): TextFont => ({ family: AHEM_FACE_ID, size }) as unknown as TextFont;
const device = deviceShapedMeasurer(new Map([[AHEM_FACE_ID, AHEM_FONT_DATA]]), ahemShaper);

/** Computed sizes of the native cases' kinds: whole, fractional (the Ahem fractional-size fixtures) and zoomed to the device DPRs. */
const SIZES = [...new Set([10, 12, 13.37, 16, 20, 24, 32, 48, 7.77, 9.99, 11.1111, 17.3, 23.3, 33.33].flatMap((s) => [s, ...[2, 2.625, 3].map((d) => zoomFontSize(s, d))]))];
const covered = String.fromCodePoint(...coveredCodePoints());
const TEXTS = [covered, 'X', 'XX X', 'Ahem text wraps here', `pq X${String.fromCharCode(0x200b)}X`, ' leading and trailing ', 'X-X'];

describe('deviceShapedMeasurer over the bundled Ahem', () => {
  it('reads the Ahem the engine names', () => {
    expect(AHEM_SHA256).toBe('b719ecb31c5b21fc573c03f6421c74ac63c271a5a3ff841e34f9705fb94b8448');
  });
  it(`measures every metric and length as the font-data measurer, and every width at whole sizes (${SIZES.length} sizes, ${TEXTS.length} texts)`, () => {
    // At a fractional size the two may part by one LayoutUnit: the shaped measurer sums HarfBuzz's 16.16 advances, as Chrome does
    // (text-latin.test.ts: it equals Chrome on T082's 1,680 Ahem runs, where the font-data measurer misses 40), and the font-data
    // measurer multiplies the em count in float. native-shaped.test.ts proves no native case's layout moves.
    const width = (r: MeasureResult, what: string): number => {
      if (!r.ok) throw new Error(`${what}: ${r.reason}`);
      return r.measure.width;
    };
    let checked = 0;
    let parted = 0;
    for (const size of SIZES) {
      const f = font(size);
      const whole = Number.isInteger(platformFontSize(size));
      expect(device.metrics(f), `metrics at ${size}`).toEqual(ahemMeasurer.metrics(f));
      expect(device.lengths(f), `lengths at ${size}`).toEqual(ahemMeasurer.lengths(f));
      for (const text of TEXTS) {
        const n = [...text].length;
        const what = (start: number, end: number): string => `${JSON.stringify(text)} [${start}, ${end}) at ${size}`;
        // The whole width and each cached position (the range from the start).
        const pairs: [MeasureResult, MeasureResult, string][] = [[device.measure(text, f), ahemMeasurer.measure(text, f), what(0, n)]];
        for (let k = 0; k <= n; k++) pairs.push([device.measureRange(text, 0, k, f), ahemMeasurer.measureRange(text, 0, k, f), what(0, k)]);
        for (const [got, was, w] of pairs) {
          const d = width(was, w) - width(got, w);
          if (whole) expect(d, w).toBe(0);
          else expect(Math.abs(d), w).toBeLessThanOrEqual(1);
          if (d !== 0) parted++;
          checked++;
        }
        // Every range is the difference of its cached positions.
        for (let start = 0; start <= n; start++) {
          for (let end = start; end <= n; end++) {
            const pos = (k: number): number => width(device.measureRange(text, 0, k, f), what(0, k));
            expect(width(device.measureRange(text, start, end, f), what(start, end)), what(start, end)).toBe(pos(end) - pos(start));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100000);
    expect(parted).toBeGreaterThan(0);
  });
  it('holds the face it was given and no other, and refuses text outside Latin, Common and Inherited (R4)', () => {
    expect(device.hasFace(AHEM_FACE_ID)).toBe(true);
    expect(device.hasFace('Lato')).toBe(false);
    expect(device.measure('XΩ', font(16))).toEqual({ ok: false, code: 'text-script', reason: 'U+3A9 is outside Latin, Common and Inherited (R4)' });
    expect(device.shaped('XΩ', font(16))).toEqual({ ok: false, code: 'text-script', reason: 'U+3A9 is outside Latin, Common and Inherited (R4)' });
    // The bundled Ahem maps more code points than the font-data measurer's covered set: HarfBuzz measures U+00E9, which the
    // font-data measurer refuses, and both refuse a code point the font has no glyph for.
    expect(device.measure('Xé', font(16))).toEqual(ahemMeasurer.measure('XX', font(16)));
    expect(ahemMeasurer.measure('Xé', font(16))).toMatchObject({ ok: false, code: 'text-glyph' });
    expect(device.measure('X\u2603', font(16))).toMatchObject({ ok: false, code: 'text-glyph' });
    expect(ahemMeasurer.measure('X\u2603', font(16))).toMatchObject({ ok: false, code: 'text-glyph' });
  });
  it('is shapedMeasurerFor at the reference platform and language with no plants, over HanKerning-free faces', () => {
    const host = shapedMeasurerFor(REFERENCE_PLATFORM, new Map([[AHEM_FACE_ID, { id: AHEM_FACE_ID, data: AHEM_FONT_DATA, hanKerning: NO_HAN_KERNING }]]), ahemShaper, REFERENCE_LANGUAGE, NO_ENGINE_FAULTS);
    if (host.kind !== 'ok') throw new Error(host.detail);
    expect(REFERENCE_LANGUAGE).toBe('en-US');
    for (const size of [16, 13.37, zoomFontSize(17.3, 2.625)]) {
      for (const text of TEXTS) {
        expect(device.measure(text, font(size))).toEqual(host.measurer.measure(text, font(size)));
        expect(device.shaped(text, font(size))).toEqual(host.measurer.shaped(text, font(size)));
      }
    }
  });
});

describe('pieceGlyphs', () => {
  it("draws HarfBuzz's Ahem glyph ids at their summed 16.16 advances, each a whole number of the font's ems", () => {
    const cps = [...covered];
    for (const size of SIZES) {
      const instance = platformFontSize(size);
      const shaped = ahemShaper.shape(AHEM_FACE_ID, instance, covered, 0, covered.length, 'Latn', false, REFERENCE_LANGUAGE, []);
      expect(shaped.length).toBe(cps.length * GLYPH_STRIDE);
      const em = ahemShaper.shape(AHEM_FACE_ID, instance, 'X', 0, 1, 'Latn', false, REFERENCE_LANGUAGE, [])[2] as number;
      for (const [start, end] of [[0, cps.length], [3, 17], [cps.length - 1, cps.length], [5, 5]] as const) {
        const g = pieceGlyphs(device, covered, font(size), start, end);
        if (!g.ok) throw new Error(g.reason);
        expect(g.glyphs, `glyphs [${start}, ${end}) at ${size}`).toEqual(cps.slice(start, end).map((_ch, k) => shaped[(start + k) * GLYPH_STRIDE] as number));
        expect(g.glyphs.every((x) => x > 0)).toBe(true);
        // The pen before each glyph: the ems of the glyphs before it in the piece (AHEM_FONT_DATA) times one em's 16.16 advance.
        let ems = 0;
        const xs: number[] = [];
        for (const ch of cps.slice(start, end)) {
          xs.push((ems * em) / 65536);
          ems += (AHEM_FONT_DATA.advances[coveredIndex(ch.codePointAt(0) as number)] as number) / AHEM_FONT_DATA.unitsPerEm;
        }
        expect(g.xs, `xs [${start}, ${end}) at ${size}`).toEqual(xs);
      }
    }
  });
  it('takes code point offsets, keeps a cluster of several units as one glyph, and starts its pen at the piece', () => {
    // A scripted shaper: "fi" is one ligature glyph (cluster 0), a supplementary code point one glyph of two units.
    const scripted: GlyphShaper = {
      shape(_face: string, _size: number, text: string, start: number, end: number): readonly number[] {
        expect([start, end]).toEqual([0, text.length]);
        return [
          [7, 0, 65536 * 3, 0, 0, 0, 0],
          [8, 2, 65536 + 32768, 0, 0, 0, 0],
          [9, 3, 65536 * 2, 0, 0, 0, 0],
          [10, 5, 98304, 0, 0, 0, 0],
        ].flat();
      },
    };
    const m = deviceShapedMeasurer(new Map([[AHEM_FACE_ID, AHEM_FONT_DATA]]), scripted);
    const text = 'fi \u{1d400}X';
    expect(pieceGlyphs(m, text, font(16), 0, 5)).toEqual({ ok: true, glyphs: [7, 8, 9, 10], xs: [0, 3, 4.5, 6.5] });
    // Code points [2, 4) are the space and U+1D400: UTF-16 [2, 5).
    expect(pieceGlyphs(m, text, font(16), 2, 4)).toEqual({ ok: true, glyphs: [8, 9], xs: [0, 1.5] });
    // A piece that starts inside the ligature's cluster draws none of it.
    expect(pieceGlyphs(m, text, font(16), 1, 3)).toEqual({ ok: true, glyphs: [8], xs: [0] });
    expect(pieceGlyphs(m, text, font(16), 4, 4)).toEqual({ ok: true, glyphs: [], xs: [] });
  });
  it('passes a refusal of the measurer through, with its reason', () => {
    expect(pieceGlyphs(device, 'XΩ', font(16), 0, 1)).toEqual({ ok: false, reason: 'U+3A9 is outside Latin, Common and Inherited (R4)' });
    expect(pieceGlyphs(device, 'X', { family: 'Lato', size: 16 } as unknown as TextFont, 0, 1)).toEqual({ ok: false, reason: 'no bundled face Lato' });
    expect(pieceGlyphs(ahemMeasurer, 'X', font(16), 0, 1).ok).toBe(false);
  });
});
