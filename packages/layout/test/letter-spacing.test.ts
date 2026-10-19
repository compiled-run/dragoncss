// TXT2-b (notes/T149-txt2-spec.md R4 and R5): letter-spacing in the engine. The Ahem measurer adds the 16.16 spacing after every
// glyph; the shaped path ports ShapeResult::ApplySpacingOrExpansion (spacing after each HarfBuzz cluster, the last one included,
// none after a zero-width space) and turns liga, clig and calt off (font_features.cc). The fake shaper below forms an "fi"
// ligature unless liga is off, so each shaping plant changes a width here; the Chrome checks are packages/parity/test/text-spacing.test.ts.
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layout, letterSpacingAfter, NO_ENGINE_FAULTS, NO_SHAPING_FAULTS, textRunLayoutUnit } from '../src/index.ts';
import type { LayoutBox, LayoutRect, ShapingFaults, TextLeaf } from '../src/index.ts';
import type { GlyphShaper } from '../src/shaping.ts';
import { FEATURE_STRIDE, GLYPH_STRIDE, NO_HAN_KERNING, shapedMeasurer, TAG_LIGA } from '../src/shaping.ts';
import { AHEM_FONT_DATA } from '../src/text.ts';
import { box, neutralEnvironment, px, text } from './helpers.ts';

const LU = 64;

function rects(root: LayoutBox, zoom = 1): Map<string, LayoutRect> {
  const r = layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: zoom, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return new Map(absoluteRects(r.boxes));
}
const widthOf = (leaf: TextLeaf, zoom = 1): number => (rects(box('root', {}, [box('p', {}, [leaf])]), zoom).get(`${leaf.id}`) as LayoutRect).width;

describe('letter-spacing over Ahem', () => {
  it('adds the spacing after every glyph, the last one included: XXX at 10px with 3px is 39px', () => {
    expect(widthOf(text('t', 'XXX', { letterSpacing: px(3) }))).toBe(39 * LU);
    expect(widthOf(text('t', 'XXX', { letterSpacing: px(-2) }))).toBe(24 * LU);
    expect(widthOf(text('t', 'XXX'))).toBe(30 * LU);
  });
  it('converts the spacing to 16.16 by truncation (TextRunLayoutUnit) and ceils the float width', () => {
    expect(textRunLayoutUnit(0.7)).toBe(Math.trunc(Math.fround(Math.fround(0.7) * 65536)));
    // 10 glyphs of 10px plus 10 * 0.7px in 16.16 is 106.99997px, ceiled to the next LayoutUnit.
    expect(widthOf(text('t', 'XXXXXXXXXX', { letterSpacing: px(0.7) }))).toBe(Math.ceil(((10 * 10 * 65536 + 10 * textRunLayoutUnit(0.7)) / 65536) * LU));
  });
  it('wraps where the spaced words no longer fit: XX XX with 3px fits 65px on one line and breaks at 64px', () => {
    const at = (w: number) => rects(box('root', {}, [box('p', { width: px(w) }, [text('t', 'XX XX', { letterSpacing: px(3) })])])).get('p') as LayoutRect;
    expect(at(65).height).toBe(10 * LU);
    expect(at(64).height).toBe(20 * LU);
  });
  it('adds no spacing after a zero-width space or joiner (Character::TreatAsZeroWidthSpace)', () => {
    const s = textRunLayoutUnit(3);
    expect([0x58, 0x20, 0xa0].map((cp) => letterSpacingAfter(cp, s))).toEqual([s, s, s]);
    expect([0x200b, 0x200c, 0x200d, 0xfeff, 0x0c, 0x0d, 0xfffc, 0x2060, 0xe0001].map((cp) => letterSpacingAfter(cp, s))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('the environment pass resolves letter-spacing', () => {
  it('zooms a px value and resolves em against the font size', () => {
    expect(widthOf(text('t', 'XX', { letterSpacing: px(3) }), 2)).toBe(2 * 26 * LU);
    expect(widthOf(text('t', 'XX', { letterSpacing: { kind: 'em', value: 0.3, fontSize: px(10) } }))).toBe(26 * LU);
    expect(widthOf(text('t', 'XX', { letterSpacing: { kind: 'em', value: 0.3, fontSize: px(10) } }), 2)).toBe(2 * 26 * LU);
  });
  it('refuses a percentage (of the font size) with the letter-spacing code', () => {
    const r = layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root: box('root', {}, [box('p', {}, [text('t', 'XX', { letterSpacing: { kind: 'percent', value: 10 } })])]) }, ahemMeasurer);
    expect(r.kind === 'unsupported' ? r.unsupported.code : r.kind).toBe('letter-spacing');
  });
  it('refuses spacing on text with a soft hyphen (the generated hyphen is not spaced yet)', () => {
    const r = layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root: box('root', {}, [box('p', {}, [text('t', 'XX­XX', { letterSpacing: px(1) })])]) }, ahemMeasurer);
    expect(r.kind === 'unsupported' ? r.unsupported.code : r.kind).toBe('letter-spacing');
  });
});

describe('letter-spacing on the shaped path', () => {
  // A face whose every code unit is one 10px glyph, except "fi", which is one ligature glyph (cluster at the f) unless liga is off.
  const shaper: GlyphShaper = {
    shape(_face, size, t, start, end, _script, _rtl, _language, features) {
      let ligaOff = false;
      for (let i = 0; i < features.length; i += FEATURE_STRIDE) if (features[i] === TAG_LIGA && features[i + 1] === 0) ligaOff = true;
      const out: number[] = [];
      for (let i = start; i < end; i++) {
        const lig = !ligaOff && t[i] === 'f' && t[i + 1] === 'i' && i + 1 < end;
        out.push(lig ? 2 : 1, i, size * 65536, 0, 0, 0, 0);
        if (lig) i++;
      }
      expect(out.length % GLYPH_STRIDE).toBe(0);
      return out;
    },
  };
  const width = (faults: ShapingFaults, spacing: number): number => {
    const m = shapedMeasurer(new Map([['Fake', { id: 'Fake', data: AHEM_FONT_DATA, hanKerning: NO_HAN_KERNING }]]), shaper, faults, 'en');
    const r = m.measure('office', { family: 'Fake', size: 10, letterSpacing: spacing, wordSpacing: 0 });
    if (!r.ok) throw new Error(r.reason);
    return r.measure.width / LU;
  };

  it('turns liga off and adds the spacing after each of the six clusters: 6 * 13px', () => {
    expect(width(NO_SHAPING_FAULTS, 0)).toBe(50);
    expect(width(NO_SHAPING_FAULTS, 3)).toBe(78);
  });
  it('ligaturesKept keeps the fi ligature: five clusters, 65px', () => {
    expect(width({ ...NO_SHAPING_FAULTS, ligaturesKept: true }, 3)).toBe(65);
  });
  it('trailingSpacingDropped drops the spacing after the last cluster: 75px', () => {
    expect(width({ ...NO_SHAPING_FAULTS, trailingSpacingDropped: true }, 3)).toBe(75);
  });
  it('spacingPerCodePoint spaces each code point of a multi-character cluster, which only a kept ligature forms here: 68px', () => {
    // Dormant on the Chrome cases: with liga, clig and calt off no Latin text in the reference faces shapes a cluster of two.
    expect(width({ ...NO_SHAPING_FAULTS, ligaturesKept: true, spacingPerCodePoint: true }, 3)).toBe(68);
    expect(width({ ...NO_SHAPING_FAULTS, spacingPerCodePoint: true }, 3)).toBe(78);
  });
  it('the engine faults reach the shaping plants', () => {
    expect(Object.keys(NO_ENGINE_FAULTS)).toEqual(expect.arrayContaining(['trailingSpacingDropped', 'spacingPerCodePoint', 'ligaturesKept']));
  });
});
