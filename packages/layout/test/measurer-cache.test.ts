// The device measurer's caches (shapedText's items by text then font, latinScopedMeasurer's script scope by text): one measurer
// asked again and again, as a layout plan asks it at every width, answers exactly as a fresh measurer does, and shapes once.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TextFont } from '../src/input.ts';
import { deviceShapedMeasurer } from '../src/platform.ts';
import type { GlyphShaper } from '../src/shaping.ts';
import { FEATURE_STRIDE } from '../src/shaping.ts';
import type { TextMeasurer } from '../src/text.ts';
import { AHEM_FACE_ID, AHEM_FONT_DATA } from '../src/text.ts';

// packages/text-shaper is loaded by relative path at run time, as in device-shaping.test.ts.
type Feature = { readonly tag: string; readonly value: number; readonly start?: number; readonly end?: number };
type HB = {
  createFace(bytes: Uint8Array): number;
  createFont(face: number, o: { size: number }): number;
  shape(font: number, text: string, offset: number, length: number, o: { script: string; language: string; direction?: 'ltr' | 'rtl'; features?: readonly Feature[] }): Int32Array;
};
const wasm = (await import(new URL('../../text-shaper/src/wasm.ts', import.meta.url).href)) as Record<string, unknown>;
const hb = (wasm.DragonHB as { load(): HB }).load();
const tagToString = wasm.tagToString as (tag: number) => string;
const ahemFace = hb.createFace(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'vendor/fonts/Ahem.ttf')));

/** HarfBuzz over Ahem, counting the calls that reach it. */
function countingShaper(): { readonly shaper: GlyphShaper; readonly calls: string[] } {
  const calls: string[] = [];
  const fonts = new Map<number, number>();
  const shaper: GlyphShaper = {
    fallback: (): string => '',
    shape(face, size, text, start, end, script, rtl, language, features) {
      calls.push(`${face} ${size} ${start}-${end} ${text}`);
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
  return { shaper, calls };
}

const fresh = (): TextMeasurer => deviceShapedMeasurer(new Map([[AHEM_FACE_ID, AHEM_FONT_DATA]]), countingShaper().shaper);
const font = (size: number, letterSpacing: number, wordSpacing: number, smallCaps = false): TextFont => ({ family: AHEM_FACE_ID, size, letterSpacing, wordSpacing, smallCaps }) as unknown as TextFont;

// Texts that share prefixes and differ by one code point, refused ones among them, so a cache keyed wrongly answers wrongly.
const texts = ['X', 'XX', 'XX X', 'X XX', 'É', 'Xé', 'X́', 'X—X', '日本', 'X日', 'Xα', 'α', 'X॑', ''];
// Small caps over Ahem is synthesized at a smaller size, and refused with spacing: each must be its own entry.
const fonts = [font(10, 0, 0), font(16, 0, 0), font(16, 2, 0), font(16, 0, 3), font(16, 2, 3), font(16, 0, 0, true), font(16, 2, 0, true)];

describe('one device measurer asked again answers as a fresh measurer', () => {
  it('measure, measureRange and shaped: every text in every font, three rounds in three orders', () => {
    const shared = fresh();
    const orders = [texts, [...texts].reverse(), texts.filter((_, i) => i % 2 === 1).concat(texts.filter((_, i) => i % 2 === 0))];
    let compared = 0;
    for (const order of orders) {
      for (const f of [...fonts].reverse()) for (const t of order) {
        const once = fresh();
        expect(shared.measure(t, f), `${t} ${f.size}/${f.letterSpacing}/${f.wordSpacing}/${String(f.smallCaps)}`).toEqual(once.measure(t, f));
        const end = [...t].length;
        expect(shared.measureRange(t, 0, end, f)).toEqual(fresh().measureRange(t, 0, end, f));
        const a = shared.shaped(t, f);
        const b = fresh().shaped(t, f);
        expect(a.ok).toBe(b.ok);
        if (a.ok && b.ok) expect(a.result).toEqual(b.result);
        else expect(a).toEqual(b);
        compared++;
      }
    }
    expect(compared).toBe(3 * texts.length * fonts.length);
  });

  it('refuses text outside Latin, Common and Inherited every time it is asked, naming the code point', () => {
    const shared = fresh();
    for (let round = 0; round < 3; round++) {
      expect(shared.measure('X', fonts[0] as TextFont).ok).toBe(true);
      expect(shared.measure('X日', fonts[0] as TextFont)).toEqual({ ok: false, code: 'text-script', reason: 'U+65E5 is outside Latin, Common and Inherited (R4)' });
      expect(shared.measureRange('Xα', 0, 1, fonts[0] as TextFont)).toEqual({ ok: false, code: 'text-script', reason: 'U+3B1 is outside Latin, Common and Inherited (R4)' });
    }
  });

  it('shapes each text in each font once, however often it is measured', () => {
    const { shaper, calls } = countingShaper();
    const m = deviceShapedMeasurer(new Map([[AHEM_FACE_ID, AHEM_FONT_DATA]]), shaper);
    const latin = texts.filter((t) => fresh().measure(t, fonts[0] as TextFont).ok);
    for (const f of fonts) for (const t of latin) m.measure(t, f);
    const first = calls.length;
    expect(first).toBeGreaterThan(0);
    for (let round = 0; round < 5; round++) for (const f of fonts) for (const t of latin) m.measure(t, f);
    expect(calls.length).toBe(first);
  });
});
