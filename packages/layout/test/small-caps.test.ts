// TXT-FONTFEAT: font-variant-caps: small-caps in the engine. Over a face without smcp Blink splits the text where a code point's
// case behaviour changes (SmallCapsIterator) and shapes each lowercase run uppercased in SimpleFontData::SmallCapsFontData, whose
// size is lroundf(computed size * 0.7f); line metrics stay the primary font's. The Ahem measurer and the shaped measurer both do so,
// and the shaped path tells the device each glyph's size (pieceGlyphs). The Chrome checks are packages/parity/test/text-font-variant-caps-ahem.test.ts.
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layout, pieceGlyphs, smallCapsCodePoint, smallCapsFontSize } from '../src/index.ts';
import type { LayoutBox, LayoutRect, TextFont, TextLeaf } from '../src/index.ts';
import type { GlyphShaper } from '../src/shaping.ts';
import { GLYPH_STRIDE, NO_HAN_KERNING, NO_SHAPING_FAULTS, shapedMeasurer } from '../src/shaping.ts';
import { AHEM_FONT_DATA } from '../src/text.ts';
import { box, neutralEnvironment, px, text } from './helpers.ts';

const LU = 64;
const font = (size: number, smallCaps = true): TextFont => ({ family: 'Ahem', size, letterSpacing: 0, wordSpacing: 0, smallCaps });

function run(root: LayoutBox, zoom = 1) {
  return layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: zoom, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer);
}
function rects(root: LayoutBox, zoom = 1): Map<string, LayoutRect> {
  const r = run(root, zoom);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return new Map(absoluteRects(r.boxes));
}
const refusal = (leaf: TextLeaf, style = {}): string => {
  const r = run(box('root', {}, [box('p', style, [leaf])]));
  return r.kind === 'unsupported' ? r.unsupported.code : r.kind;
};

describe('the small-caps size', () => {
  it('is the computed size times 0.7f, rounded half away from zero to whole px', () => {
    expect([10, 15, 16, 20, 13, 26.25, 10.625, 0.7, 0].map(smallCapsFontSize)).toEqual([7, 11, 11, 14, 9, 18, 7, 0, 0]);
  });
  it('uppercases a to z only, keeps the rest of ASCII and U+200B, and has no mapping for anything else', () => {
    expect([0x61, 0x7a, 0x70, 0x41, 0x20, 0x2d, 0x200b, 0xe9, 0xdf].map(smallCapsCodePoint)).toEqual([0x41, 0x5a, 0x50, 0x41, 0x20, 0x2d, 0x200b, -1, -1]);
  });
});

describe('small caps over the Ahem measurer', () => {
  const width = (t: string, size: number, smallCaps = true): number => {
    const m = ahemMeasurer.measure(t, font(size, smallCaps));
    if (!m.ok) throw new Error(m.reason);
    return m.measure.width / LU;
  };
  it('draws each lowercase letter at the small-caps size: Ab cd at 20px is 20 + 14 + 20 + 14 + 14', () => {
    expect(width('Ab cd', 20)).toBe(82);
    expect(width('Ab cd', 20, false)).toBe(100);
    expect(width('XX XX', 20)).toBe(100);
    expect(width('abc', 15)).toBe(33);
  });
  it('measures a range as the difference of the ceiled positions, at 26.25px (DPR 2.625) with 18px small capitals', () => {
    const r = ahemMeasurer.measureRange('Ab cd', 1, 4, font(26.25));
    expect(r.ok && r.measure.width / LU).toBe(18 + 26.25 + 18);
    expect(width('Ab cd', 26.25)).toBe(26.25 + 18 + 26.25 + 18 + 18);
  });
  it('keeps the primary font metrics', () => {
    expect(ahemMeasurer.metrics(font(20))).toEqual(ahemMeasurer.metrics(font(20, false)));
  });
  it('refuses a code point whose case mapping is not ported', () => {
    expect(ahemMeasurer.measure('Abé', font(10)).ok).toBe(false);
  });
});

describe('small caps in layout', () => {
  it('breaks lines by the small advances: abcdefg hi fits 49px of 50 on the first line', () => {
    const r = rects(box('root', {}, [box('p', { width: px(50) }, [text('t', 'abcdefg hi', { smallCaps: true })])]));
    expect((r.get('p') as LayoutRect).height).toBe(20 * LU);
    expect((r.get('t:line0') as LayoutRect).width).toBe(49 * LU);
    expect((r.get('t:line1') as LayoutRect).width).toBe(14 * LU);
  });
  it('lays out at the zoomed size: Ab at DPR 2 is 20 + 14 device px', () => {
    expect((rects(box('root', {}, [box('p', {}, [text('t', 'Ab', { smallCaps: true })])]), 2).get('t') as LayoutRect).width).toBe(34 * LU);
  });
  it('refuses small caps with letter or word spacing, preserved white space and justification', () => {
    expect(refusal(text('t', 'Ab cd', { smallCaps: true, letterSpacing: px(1) }))).toBe('font-variant-caps');
    expect(refusal(text('t', 'Ab cd', { smallCaps: true, wordSpacing: px(1) }))).toBe('font-variant-caps');
    expect(refusal(text('t', 'Ab cd', { smallCaps: true, whiteSpaceCollapse: 'preserve' }))).toBe('font-variant-caps');
    expect(refusal(text('t', 'Ab cd ab cd ab cd', { smallCaps: true }), { width: px(60), textAlign: 'justify' })).toBe('text-align');
    expect(refusal(text('t', 'Ab cd', { smallCaps: true, font: { family: 'sha256:00', size: 10, specifiedSize: px(10), absoluteSize: true } }))).toBe('font-variant-caps');
  });
});

describe('small caps on the shaped path', () => {
  // A face whose every code unit is one glyph (its code unit) of the size's advance, in its own cluster.
  const calls: string[] = [];
  const shaper: GlyphShaper = {
    shape(_face, size, t, start, end) {
      calls.push(`${size}:${t.slice(start, end)}`);
      const out: number[] = [];
      for (let i = start; i < end; i++) out.push(t.charCodeAt(i), i, size * 65536, 0, 0, 0, 0);
      expect(out.length % GLYPH_STRIDE).toBe(0);
      return out;
    },
  };
  const m = shapedMeasurer(new Map([['Ahem', { id: 'Ahem', data: AHEM_FONT_DATA, hanKerning: NO_HAN_KERNING }]]), shaper, NO_SHAPING_FAULTS, 'en');
  it('shapes each lowercase run uppercased at the small-caps size, and the rest at the font size', () => {
    calls.length = 0;
    const r = m.measure('Ab cdE', font(20));
    expect(r.ok && r.measure.width / LU).toBe(20 + 14 + 20 + 14 + 14 + 20);
    expect(calls).toEqual(['20:A', '14:B', '20: ', '14:CD', '20:E']);
  });
  it('gives the device each glyph, its pen and its size', () => {
    const g = pieceGlyphs(m, 'Ab cd', font(20), 1, 4);
    expect(g).toEqual({ ok: true, glyphs: [0x42, 0x20, 0x43], xs: [0, 14, 34], chars: [0, 1, 2], sizes: [14, 20, 14] });
  });
  it('shapes as one run without small caps', () => {
    calls.length = 0;
    expect(m.measure('Ab cd', font(20, false)).ok).toBe(true);
    expect(calls).toEqual(['20:Ab cd']);
  });
  it('refuses small caps in another face, beside spacing, and over a code point whose case mapping is not ported', () => {
    const real = shapedMeasurer(new Map([['sha256:00', { id: 'sha256:00', data: AHEM_FONT_DATA, hanKerning: NO_HAN_KERNING }]]), shaper, NO_SHAPING_FAULTS, 'en');
    expect(real.measure('Ab', { ...font(20), family: 'sha256:00' }).ok).toBe(false);
    expect(m.measure('Ab', { ...font(20), letterSpacing: 1 }).ok).toBe(false);
    expect(m.measure('Abé', font(20)).ok).toBe(false);
  });
});
