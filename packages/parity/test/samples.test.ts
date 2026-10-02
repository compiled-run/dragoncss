// The pixel sample generator (native-strategy.md 3.5; T002 section 6): deterministic points from snapped geometry, colour points
// clear of every edge by SAMPLE_INSET_DEVICE_PX, and edge scanlines that cross exactly one edge.
import { describe, expect, it } from 'vitest';
import type { GlyphBox, SampleBox, SamplePoint } from '../src/samples.ts';
import { ALONG_POSITIONS, CLEAR_SUFFIX, clearOfGlyphs, isScanlineRule, generateGlyphSamples, generateSamples, glyphClearance, ruleKind, SAMPLE_INSET_DEVICE_PX, SAMPLE_RULES, sampleBoxes, sampleGlyphs } from '../src/samples.ts';

const SIZE = { width: 1200, height: 900 };
const card: SampleBox = { id: 'n3', left: 60, top: 60, right: 420, bottom: 180, border: { top: 6, right: 6, bottom: 6, left: 6 }, radius: 24, clips: true };
const plain: SampleBox = { id: 'n4', left: 500, top: 300, right: 540, bottom: 330, border: { top: 0, right: 0, bottom: 0, left: 0 }, radius: 0, clips: false };
const I = SAMPLE_INSET_DEVICE_PX;

const clearOf = (v: number, e: number): boolean => v >= e + I || v + 1 <= e - I;

describe('sample generator', () => {
  it('the six rules, in order, shared by both targets', () => {
    expect(SAMPLE_RULES).toEqual(['interior', 'border', 'outside', 'radius', 'clip', 'edge', 'glyph', 'shadow', 'gradient']);
  });
  it('is deterministic and emits every rule for a bordered, rounded, clipping box', () => {
    const a = generateSamples([card, plain], SIZE);
    expect(generateSamples([card, plain], SIZE)).toEqual(a);
    expect([...new Set(a.filter((p) => p.rule.includes(':n3')).map((p) => ruleKind(p.rule)))]).toEqual(SAMPLE_RULES.filter((r) => r !== 'glyph' && r !== 'shadow' && r !== 'gradient'));
    expect(a.filter((p) => ruleKind(p.rule) === 'radius' && p.rule.startsWith('radius:n3')).length).toBe(8);
    expect(a.filter((p) => p.rule === 'interior:n3')).toEqual([{ x: 240, y: 120, rule: 'interior:n3' }]);
    expect(a.filter((p) => p.rule === 'border:n3:top')).toEqual([{ x: 240, y: 62, rule: 'border:n3:top' }]);
    expect(a.filter((p) => p.rule === 'outside:n3')).toEqual([{ x: 240, y: 57, rule: 'outside:n3' }]);
  });
  it('colour points are clear of the box edges by the inset; border points sit inside their band', () => {
    const pts = generateSamples([card, plain], SIZE);
    for (const p of pts) {
      const b = p.rule.includes(':n3') ? card : plain;
      const k = ruleKind(p.rule);
      if (k === 'interior') {
        for (const e of [b.left + b.border.left, b.right - b.border.right]) expect(clearOf(p.x, e), p.rule).toBe(true);
        for (const e of [b.top + b.border.top, b.bottom - b.border.bottom]) expect(clearOf(p.y, e), p.rule).toBe(true);
      }
      if (k === 'outside') expect(p.x < b.left - I || p.x >= b.right + I || p.y < b.top - I || p.y >= b.bottom + I, p.rule).toBe(true);
      if (k === 'border') {
        const side = p.rule.split(':')[2];
        if (side === 'top') expect(p.y >= b.top && p.y < b.top + b.border.top).toBe(true);
        if (side === 'left') expect(p.x >= b.left && p.x < b.left + b.border.left).toBe(true);
      }
      expect(p.x >= 0 && p.y >= 0 && p.x < SIZE.width && p.y < SIZE.height).toBe(true);
    }
  });
  it('radius points: one painted and one unpainted along each corner diagonal', () => {
    const tl = generateSamples([card], SIZE).filter((p) => p.rule === 'radius:n3:top-left');
    const cx = card.left + card.radius;
    const cy = card.top + card.radius;
    const dist = (p: SamplePoint): number => Math.hypot(p.x + 0.5 - cx, p.y + 0.5 - cy);
    expect(tl).toHaveLength(2);
    expect(dist(tl[0] as SamplePoint)).toBeLessThan(card.radius);
    expect(dist(tl[1] as SamplePoint)).toBeGreaterThan(card.radius);
  });
  it('edge scanlines cross exactly one edge, from a clear outside pixel to a clear inside pixel', () => {
    const pts = generateSamples([plain], SIZE);
    const left = pts.filter((p) => p.rule === 'edge:n4:left');
    expect(left.map((p) => p.x)).toEqual([plain.left - I - 1, plain.left - I, plain.left - 1, plain.left, plain.left + 1, plain.left + I]);
    const right = pts.filter((p) => p.rule === 'edge:n4:right');
    expect(right.map((p) => p.x)).toEqual([plain.right + I, plain.right + 1, plain.right, plain.right - 1, plain.right - I, plain.right - I - 1]);
    expect(pts.filter((p) => ruleKind(p.rule) === 'edge').length).toBe(4 * (2 * I + 2));
    expect(pts.some((p) => ruleKind(p.rule) === 'border' || ruleKind(p.rule) === 'radius' || ruleKind(p.rule) === 'clip')).toBe(false);
  });
  it('skips points outside the image and boxes too small to hold a clear point', () => {
    const tiny: SampleBox = { id: 't', left: 0, top: 0, right: 3, bottom: 3, border: { top: 1, right: 1, bottom: 1, left: 1 }, radius: 0, clips: true };
    const pts = generateSamples([tiny], { width: 10, height: 10 });
    expect(pts.map((p) => p.rule)).toEqual(['outside:t']);
    expect(pts[0]).toEqual({ x: 5, y: 1, rule: 'outside:t' });
  });
});

describe('glyph clearance (T093 ruling A)', () => {
  const g: GlyphBox = { left: 10.5, top: 20, right: 40.5, bottom: 50 };
  it('a pixel is as clear as the box shrunk or grown by that much allows; on an edge it is 0; a seam is an edge of both glyphs', () => {
    expect(glyphClearance(20, 30, g)).toBe(9.5);
    expect(glyphClearance(12, 30, g)).toBe(1.5);
    expect(glyphClearance(10, 30, g)).toBe(0);
    expect(glyphClearance(7, 30, g)).toBe(2.5);
    expect(glyphClearance(20, 17, g)).toBe(2);
    expect(glyphClearance(5, 5, g)).toBe(14);
    const next: GlyphBox = { left: 40.5, top: 20, right: 70.5, bottom: 50 };
    expect(clearOfGlyphs(40, 30, [g, next])).toBe(false);
    expect(clearOfGlyphs(38, 30, [g, next])).toBe(false);
    expect(clearOfGlyphs(37, 30, [g, next])).toBe(true);
    expect(clearOfGlyphs(43, 30, [g, next])).toBe(true);
    // Deep inside a glyph is clear: the ink there is the glyph's colour on every renderer.
    expect(clearOfGlyphs(55, 35, [g, next])).toBe(true);
  });
  it('box rules try the along-positions 1/2, 1/4, 3/4, 1/8, 7/8 in order and take the first clear one', () => {
    expect(ALONG_POSITIONS).toEqual([1 / 2, 1 / 4, 3 / 4, 1 / 8, 7 / 8]);
    const b: SampleBox = { id: 'p', left: 100, top: 100, right: 300, bottom: 200, border: { top: 4, right: 4, bottom: 4, left: 4 }, radius: 0, clips: true };
    // A narrow glyph down the middle of the box, across its top and bottom edges: no pixel near it is clear.
    const glyph: GlyphBox = { left: 198.5, top: 90, right: 202.5, bottom: 210 };
    const plain = generateSamples([b], SIZE);
    const r = sampleBoxes([b], SIZE, [glyph]);
    expect(r.dropped).toEqual([]);
    expect(r.points.map((p) => p.rule)).toEqual(plain.map((p) => p.rule));
    const at = (rule: string) => r.points.filter((p) => p.rule === rule);
    expect(at('interior:p')).toEqual([{ x: 152, y: 150, rule: 'interior:p' }]);
    expect(at('border:p:top')).toEqual([{ x: 150, y: 101, rule: 'border:p:top' }]);
    expect(at('border:p:left')).toEqual(plain.filter((p) => p.rule === 'border:p:left'));
    expect(at('outside:p')).toEqual([{ x: 150, y: 97, rule: 'outside:p' }]);
    expect(at('edge:p:bottom').map((p) => p.x)).toEqual(Array(2 * I + 2).fill(150));
    expect(at('clip:p:top').map((p) => p.x)).toEqual([152, 152]);
    for (const p of r.points) expect(clearOfGlyphs(p.x, p.y, [glyph]), `${p.rule} at ${p.x},${p.y}`).toBe(true);
  });
  it('a point with no clear along-position is dropped and named; with no glyph boxes nothing is dropped and the points are unchanged', () => {
    const b: SampleBox = { id: 'q', left: 100, top: 100, right: 160, bottom: 140, border: { top: 0, right: 0, bottom: 0, left: 0 }, radius: 0, clips: false };
    // A row of 3 device px glyphs over the box: every pixel there is within 1.5 device px of a glyph edge.
    const row: GlyphBox[] = Array.from({ length: 27 }, (_, k) => ({ left: 90.5 + 3 * k, top: 95, right: 93.5 + 3 * k, bottom: 145 }));
    const r = sampleBoxes([b], SIZE, row);
    expect(r.points).toEqual([]);
    expect(r.dropped).toEqual(['interior:q', 'outside:q', 'edge:q:top', 'edge:q:right', 'edge:q:bottom', 'edge:q:left']);
    expect(sampleBoxes([card, plain], SIZE)).toEqual({ points: generateSamples([card, plain], SIZE), dropped: [], rescued: [] });
  });
  it('a dropped edge scanline or border point keeps each pixel that is itself clear, as "<rule>:clear" (addendum F2)', () => {
    // position-absolute-out-of-flow@3: i2's bottom edge lies on the top edge of the Y glyph below it.
    const i2: SampleBox = { id: 'i2', left: 63, top: 81, right: 75, bottom: 105, border: { top: 3, right: 3, bottom: 3, left: 3 }, radius: 0, clips: false };
    const y: GlyphBox = { left: 30, top: 105, right: 90, bottom: 165 };
    const r = sampleBoxes([i2], SIZE, [y]);
    expect(r.dropped).toEqual(['border:i2:bottom', 'edge:i2:bottom']);
    expect(r.rescued).toEqual(['border:i2:bottom', 'edge:i2:bottom']);
    expect(r.points.filter((p) => p.rule.endsWith(CLEAR_SUFFIX))).toEqual([
      { x: 69, y: 102, rule: 'border:i2:bottom:clear' },
      { x: 69, y: 107, rule: 'edge:i2:bottom:clear' },
      { x: 69, y: 102, rule: 'edge:i2:bottom:clear' },
    ]);
    for (const p of r.points) expect(clearOfGlyphs(p.x, p.y, [y]), `${p.rule} at ${p.x},${p.y}`).toBe(true);
    expect([isScanlineRule('edge:i2:bottom'), isScanlineRule('edge:i2:bottom:clear'), isScanlineRule('border:i2:bottom:clear')]).toEqual([true, false, false]);
  });
  it('glyph points and glyph-edge scanlines stay clear of every other glyph box; a line abutting another text loses the scanline at the seam', () => {
    const a = { id: 'a:text0:line0', glyphs: [{ left: 10.25, top: 10, right: 40.25, bottom: 40 }, { left: 40.25, top: 10, right: 70.25, bottom: 40 }] };
    const b = { id: 'b:text0:line0', glyphs: [{ left: 70.25, top: 10, right: 100.25, bottom: 40 }] };
    const r = sampleGlyphs([a, b], { width: 200, height: 100 });
    expect(r.dropped).toEqual(['edge:a:text0:line0:glyph-right', 'edge:b:text0:line0:glyph-left']);
    const rules = [...new Set(r.points.map((p) => p.rule))];
    expect(rules).toEqual(['glyph:a:text0:line0:0', 'glyph:a:text0:line0:1', 'edge:a:text0:line0:glyph-left', 'edge:a:text0:line0:glyph-top', 'edge:a:text0:line0:glyph-bottom', 'glyph:b:text0:line0:0', 'edge:b:text0:line0:glyph-right', 'edge:b:text0:line0:glyph-top', 'edge:b:text0:line0:glyph-bottom']);
    const top = r.points.filter((p) => p.rule === 'edge:a:text0:line0:glyph-top');
    expect(top.map((p) => p.y)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(new Set(top.map((p) => p.x))).toEqual(new Set([25]));
    const bottom = r.points.filter((p) => p.rule === 'edge:a:text0:line0:glyph-bottom');
    expect(bottom.map((p) => p.y)).toEqual([42, 41, 40, 39, 38, 37]);
    expect(generateGlyphSamples([a, b], { width: 200, height: 100 })).toEqual(r.points);
    // The P5 rule, without the clearance, keeps both seam scanlines and has no vertical ones.
    const p5 = sampleGlyphs([a, b], { width: 200, height: 100 }, I, false);
    expect(p5.dropped).toEqual([]);
    expect(p5.points.some((p) => p.rule === 'edge:a:text0:line0:glyph-right')).toBe(true);
    expect(p5.points.some((p) => p.rule.endsWith(':glyph-top'))).toBe(false);
  });
});
