// Font fallback in the shaping core (HarfBuzzShaper::ShapeSegment): the clusters a face draws with .notdef are shaped again in the
// face the platform falls back to, as their own run; a platform with no fallback face leaves them refused, as before.
import { describe, expect, it } from 'vitest';
import type { GlyphShaper } from '../src/shaping.ts';
import { NO_HAN_KERNING, pieceGlyphs, shapedMeasurer } from '../src/shaping.ts';
import { absoluteRects, layout, NO_SHAPING_FAULTS } from '../src/index.ts';
import { box, neutralEnvironment, text } from './helpers.ts';
import { AHEM_FONT_DATA, NORMAL_NUMERIC } from '../src/text.ts';

const LU = 64;
const RING = 0x25ce;

// Face A draws every code unit as a 10px glyph 1 but has no glyph for ◎; face B draws ◎ as a 13px glyph 7.
function shaperWith(fallbackFace: string): { readonly shaper: GlyphShaper; readonly asked: string[] } {
  const asked: string[] = [];
  const shaper: GlyphShaper = {
    fallback(face, text, start, end) {
      asked.push(`${face}:${text.slice(start, end)}`);
      return fallbackFace;
    },
    shape(face, size, t, start, end) {
      const out: number[] = [];
      for (let i = start; i < end; i++) {
        const ring = t.charCodeAt(i) === RING;
        const glyph = face === 'B' ? (ring ? 7 : 0) : ring ? 0 : 1;
        out.push(glyph, i, (face === 'B' ? 13 : size) * 65536, 0, 0, 0, 0);
      }
      return out;
    },
  };
  return { shaper, asked };
}

const font = { family: 'A', size: 10, letterSpacing: 0, wordSpacing: 0, smallCaps: false, variantNumeric: NORMAL_NUMERIC };
const faces = new Map([['A', { id: 'A', data: AHEM_FONT_DATA, hanKerning: NO_HAN_KERNING }]]);

describe('font fallback in the shaping core', () => {
  it('shapes the cluster the face lacks in the fallback face, as a run of its own, and measures the line with it', () => {
    const { shaper, asked } = shaperWith('B');
    const m = shapedMeasurer(faces, shaper, NO_SHAPING_FAULTS, 'en');
    const r = m.measure('ab◎cd', font);
    if (!r.ok) throw new Error(r.reason);
    expect(r.measure.width / LU).toBe(4 * 10 + 13);
    expect(asked).toEqual(['A:◎']);
    const s = m.shaped('ab◎cd', font);
    if (!s.ok) throw new Error(s.reason);
    expect(s.result.runs.map((run) => [run.face, run.start, run.numChars])).toEqual([['A', 0, 2], ['B', 2, 1], ['A', 3, 2]]);
  });

  it('gives the device each glyph with its own face', () => {
    const { shaper } = shaperWith('B');
    const m = shapedMeasurer(faces, shaper, NO_SHAPING_FAULTS, 'en');
    const p = pieceGlyphs(m, 'ab◎cd', font, 0, 5);
    if (!p.ok) throw new Error(p.reason);
    expect(p.glyphs).toEqual([1, 1, 7, 1, 1]);
    expect(p.faces).toEqual(['A', 'A', 'B', 'A', 'A']);
    expect(p.xs).toEqual([0, 10, 20, 33, 43]);
  });

  it('still refuses the text when the platform has no fallback face for it', () => {
    const { shaper } = shaperWith('');
    const r = shapedMeasurer(faces, shaper, NO_SHAPING_FAULTS, 'en').measure('ab◎cd', font);
    expect(r.ok ? 'ok' : r.reason).toBe('U+25CE has no glyph; font fallback is outside the shaping core');
  });
});

describe('font fallback in layout', () => {
  const lay = (lineHeight: { kind: 'normal' } | { kind: 'number'; value: number }, justify = false, value = 'ab◎cd') => {
    const m = shapedMeasurer(faces, shaperWith('B').shaper, NO_SHAPING_FAULTS, 'en');
    const leaf = text('t', value, { font: { family: 'A', size: 10, specifiedSize: { kind: 'px', value: 10 }, absoluteSize: true }, lineHeight });
    return layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root: box('root', {}, [box('p', justify ? { textAlign: 'justify', width: { kind: 'px', value: 60 } } : {}, [leaf])]) }, m);
  };

  it('lays out a fallback run under a line height that is not normal, as wide as the fallback glyph', () => {
    const r = lay({ kind: 'number', value: 1 });
    if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
    expect((new Map(absoluteRects(r.boxes)).get('t') as { width: number }).width / LU).toBe(53);
  });

  it('refuses it under line-height: normal, whose line box takes in the fallback face', () => {
    const r = lay({ kind: 'normal' });
    expect(r.kind === 'unsupported' ? [r.unsupported.code, r.unsupported.detail] : r.kind).toEqual(['text-glyph', expect.stringContaining('fallback face B under line-height: normal')]);
  });

  it('refuses a justified line holding the icon, which Chrome expands around as a CJK symbol', () => {
    // The first line, ab ◎ (43px of 60px), is justified; the last is not.
    const r = lay({ kind: 'number', value: 1 }, true, 'ab ◎ cd ef gh');
    expect(r.kind === 'unsupported' ? r.unsupported.code : r.kind).toBe('text-align');
  });
});
