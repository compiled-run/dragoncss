// TXT2-b (notes/T149-txt2-spec.md R4): word-spacing in the engine. ShapeResultSpacing::ComputeSpacing adds the word spacing after
// every Character::TreatAsSpace character but the tab (space, line feed, NBSP), as 16.16, beside any letter spacing. The Ahem
// measurer adds it after each space glyph; the shaped path adds it after the last glyph of a cluster that starts with a space. The
// Chrome checks are packages/parity/test/word-spacing.test.ts.
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layout, NO_ENGINE_FAULTS, NO_SHAPING_FAULTS, textRunLayoutUnit, wordSpacingAfter } from '../src/index.ts';
import type { LayoutBox, LayoutRect, ShapingFaults, TextLeaf } from '../src/index.ts';
import type { GlyphShaper } from '../src/shaping.ts';
import { GLYPH_STRIDE, NO_HAN_KERNING, shapedMeasurer } from '../src/shaping.ts';
import { AHEM_FONT_DATA } from '../src/text.ts';
import { box, neutralEnvironment, px, text } from './helpers.ts';

const LU = 64;

function rects(root: LayoutBox, zoom = 1): Map<string, LayoutRect> {
  const r = layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: zoom, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return new Map(absoluteRects(r.boxes));
}
const widthOf = (leaf: TextLeaf, zoom = 1): number => (rects(box('root', {}, [box('p', {}, [leaf])]), zoom).get(`${leaf.id}`) as LayoutRect).width;
const refusal = (leaf: TextLeaf): string => {
  const r = layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root: box('root', {}, [box('p', {}, [leaf])]) }, ahemMeasurer);
  return r.kind === 'unsupported' ? r.unsupported.code : r.kind;
};

describe('word-spacing over Ahem', () => {
  it('adds the spacing after every space: XX XX XX at 10px with 7px is 94px, and -15px is 50px', () => {
    expect(widthOf(text('t', 'XX XX XX', { wordSpacing: px(7) }))).toBe(94 * LU);
    expect(widthOf(text('t', 'XX XX XX', { wordSpacing: px(-15) }))).toBe(50 * LU);
    expect(widthOf(text('t', 'XX XX XX'))).toBe(80 * LU);
  });
  it('adds it beside letter spacing: XX XX with 2px and 5px is 5 * 12 + 5 = 65px', () => {
    expect(widthOf(text('t', 'XX XX', { letterSpacing: px(2), wordSpacing: px(5) }))).toBe(65 * LU);
  });
  it('wraps where the spaced words no longer fit: XX XX with 7px fits 57px on one line and breaks at 56px', () => {
    const at = (w: number) => rects(box('root', {}, [box('p', { width: px(w) }, [text('t', 'XX XX', { wordSpacing: px(7) })])])).get('p') as LayoutRect;
    expect(at(57).height).toBe(10 * LU);
    expect(at(56).height).toBe(20 * LU);
  });
  it('spaces only space, line feed and NBSP; never a tab or a letter', () => {
    const s = textRunLayoutUnit(7);
    expect([0x20, 0x0a, 0xa0].map((cp) => wordSpacingAfter(cp, s))).toEqual([s, s, s]);
    expect([0x09, 0x58, 0x200b, 0x2002, 0x3000].map((cp) => wordSpacingAfter(cp, s))).toEqual([0, 0, 0, 0, 0]);
    expect(wordSpacingAfter(0x20, 0)).toBe(0);
  });
});

describe('the environment pass resolves word-spacing', () => {
  it('zooms a px value and resolves em against the font size', () => {
    expect(widthOf(text('t', 'XX XX', { wordSpacing: px(7) }), 2)).toBe(2 * 57 * LU);
    expect(widthOf(text('t', 'XX XX', { wordSpacing: { kind: 'em', value: 0.7, fontSize: px(10) } }))).toBe(57 * LU);
  });
  it('refuses a percentage (of the font size) with the word-spacing code', () => {
    expect(refusal(text('t', 'XX XX', { wordSpacing: { kind: 'percent', value: 10 } }))).toBe('word-spacing');
  });
  it('refuses word spacing on text with a soft hyphen, and on preserved white space', () => {
    expect(refusal(text('t', 'XX­XX XX', { wordSpacing: px(1) }))).toBe('word-spacing');
    expect(refusal(text('t', 'XX  XX', { wordSpacing: px(1), whiteSpaceCollapse: 'preserve' }))).toBe('word-spacing');
  });
});

describe('word-spacing on the shaped path', () => {
  // A face whose every code unit is one 10px glyph in its own cluster.
  const shaper: GlyphShaper = {
    shape(_face, size, t, start, end) {
      const out: number[] = [];
      for (let i = start; i < end; i++) out.push(t.charCodeAt(i) === 0x20 ? 3 : 1, i, size * 65536, 0, 0, 0, 0);
      expect(out.length % GLYPH_STRIDE).toBe(0);
      return out;
    },
  };
  const width = (faults: ShapingFaults, value: string, spacing: number): number => {
    const m = shapedMeasurer(new Map([['Fake', { id: 'Fake', data: AHEM_FONT_DATA, hanKerning: NO_HAN_KERNING }]]), shaper, faults, 'en');
    const r = m.measure(value, { family: 'Fake', size: 10, letterSpacing: 0, wordSpacing: spacing, smallCaps: false });
    if (!r.ok) throw new Error(r.reason);
    return r.measure.width / LU;
  };

  it('adds the spacing after each space and NBSP, an item-initial space included', () => {
    expect(width(NO_SHAPING_FAULTS, ' ab c d', 0)).toBe(70);
    expect(width(NO_SHAPING_FAULTS, ' ab c d', 4)).toBe(82);
  });
  it('wordSpacingAtItemStart drops the spacing after an item-initial space: 78px', () => {
    expect(width({ ...NO_SHAPING_FAULTS, wordSpacingAtItemStart: true }, ' ab c d', 4)).toBe(78);
  });
  it('wordSpacingSkipsNbsp drops the spacing after the NBSP: 78px', () => {
    expect(width({ ...NO_SHAPING_FAULTS, wordSpacingSkipsNbsp: true }, ' ab c d', 4)).toBe(78);
  });
  it('the engine faults reach the shaping plants', () => {
    expect(Object.keys(NO_ENGINE_FAULTS)).toEqual(expect.arrayContaining(['wordSpacingAtItemStart', 'wordSpacingSkipsNbsp']));
  });
});
