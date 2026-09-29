// The pixel sample generator (native-strategy.md 3.5; T002 section 6): deterministic points from snapped geometry, colour points
// clear of every edge by SAMPLE_INSET_DEVICE_PX, and edge scanlines that cross exactly one edge.
import { describe, expect, it } from 'vitest';
import type { SampleBox, SamplePoint } from '../src/samples.ts';
import { generateSamples, ruleKind, SAMPLE_INSET_DEVICE_PX, SAMPLE_RULES } from '../src/samples.ts';

const SIZE = { width: 1200, height: 900 };
const card: SampleBox = { id: 'n3', left: 60, top: 60, right: 420, bottom: 180, border: { top: 6, right: 6, bottom: 6, left: 6 }, radius: 24, clips: true };
const plain: SampleBox = { id: 'n4', left: 500, top: 300, right: 540, bottom: 330, border: { top: 0, right: 0, bottom: 0, left: 0 }, radius: 0, clips: false };
const I = SAMPLE_INSET_DEVICE_PX;

const clearOf = (v: number, e: number): boolean => v >= e + I || v + 1 <= e - I;

describe('sample generator', () => {
  it('the six rules, in order, shared by both targets', () => {
    expect(SAMPLE_RULES).toEqual(['interior', 'border', 'outside', 'radius', 'clip', 'edge', 'glyph']);
  });
  it('is deterministic and emits every rule for a bordered, rounded, clipping box', () => {
    const a = generateSamples([card, plain], SIZE);
    expect(generateSamples([card, plain], SIZE)).toEqual(a);
    expect([...new Set(a.filter((p) => p.rule.includes(':n3')).map((p) => ruleKind(p.rule)))]).toEqual(SAMPLE_RULES.filter((r) => r !== 'glyph'));
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
