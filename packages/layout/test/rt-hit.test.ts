// SELD-R1b: the hit test on synthetic tables (the Chrome proof over every layout case is packages/parity/test/hit-report.test.ts).
// Point semantics: the point floored to 1/64 px is a 1x1 px box with exclusive intersection; text against its pixel-snapped rect;
// a line against its rect and, inclusively, the block's snapped border box at the line's offset (T063J); paint order; plants.
import { describe, expect, it } from 'vitest';
import type { HitNode } from '../src/rt-hit.ts';
import { activationTarget, HitError, hitTest, NO_HIT_FAULTS } from '../src/rt-hit.ts';

const PX = 64;
const base = { clips: false, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0, layer: false, absolute: false, atomic: false, order: 0, line: -1, inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: 'auto' } as const;
const box = (parent: number, target: number, x: number, y: number, w: number, h: number, more: Partial<HitNode> = {}): HitNode => ({ ...base, kind: 'box', parent, target, x: x * PX, y: y * PX, width: w * PX, height: h * PX, ...more });
const at = (nodes: readonly HitNode[], x: number, y: number, faults = NO_HIT_FAULTS): number => hitTest(nodes, Math.floor(x * PX), Math.floor(y * PX), faults);

describe('point semantics', () => {
  const nodes = [box(-1, 0, 0, 0, 400, 300), box(0, 1, 10, 10, 10.5, 10.25)];
  it('hits a box when the 1x1 px box at the floored point overlaps it, exclusively', () => {
    expect(at(nodes, 9.015625, 15)).toBe(1);
    expect(at(nodes, 9, 15)).toBe(0);
    expect(at(nodes, 20.484375, 15)).toBe(1);
    expect(at(nodes, 20.5, 15)).toBe(0);
    expect(at(nodes, 15, 20.234375)).toBe(1);
    expect(at(nodes, 15, 20.25)).toBe(0);
  });
  it('never hits an empty box and names the root when nothing else is hit', () => {
    expect(at([box(-1, 0, 0, 0, 400, 300), box(0, 1, 10, 10, 0, 10)], 10, 12)).toBe(0);
  });
});

describe('inline content', () => {
  // A 30x10 block at (0,20); line-height 50: line 1 at y 70, its text 20 px wide at y 90.
  const block = box(0, 1, 0, 20, 30, 10);
  const line = (k: number, y: number, more: Partial<HitNode> = {}): HitNode => ({ ...box(1, 1, 0, y, 20, 50), kind: 'line', line: k, ...more });
  const text = (k: number, y: number): HitNode => ({ ...box(1, 1, 0, y, 20, 10), kind: 'text', line: k, inkLeft: 0, inkTop: y * PX, inkRight: 20 * PX, inkBottom: (y + 10) * PX });
  const nodes = [box(-1, 0, 0, 0, 400, 300), block, line(0, 20), text(0, 40), line(1, 70), text(1, 90)];
  it('hits the line within the block\'s border box placed at the line top, inclusively, then the text', () => {
    expect(at(nodes, 5, 69)).toBe(0);
    expect(at(nodes, 5, 69.015625)).toBe(1);
    expect(at(nodes, 5, 80)).toBe(1);
    expect(at(nodes, 5, 80.015625)).toBe(0);
    expect(at(nodes, 5, 89.015625)).toBe(1);
    expect(at(nodes, 5, 99.984375)).toBe(1);
    expect(at(nodes, 5, 100)).toBe(0);
    expect(at(nodes, 19.984375, 75)).toBe(1);
    expect(at(nodes, 20, 75)).toBe(0);
  });
  it('tests text against its pixel-snapped rect', () => {
    const t = { ...box(1, 1, 0, 40.25, 20, 10), kind: 'text' as const, line: 0, inkTop: 40 * PX, inkBottom: 51 * PX, inkRight: 20 * PX };
    const n = [box(-1, 0, 0, 0, 400, 300), box(0, 1, 0, 0, 30, 0), { ...box(1, 1, 0, 40, 20, 0), kind: 'line' as const, line: 0 }, t];
    expect(at(n, 5, 49.984375)).toBe(1);
    expect(at(n, 5, 50)).toBe(0);
  });
});

describe('paint order', () => {
  it('hits the later sibling, a positioned box before normal flow, and text before a later background', () => {
    const root = box(-1, 0, 0, 0, 400, 300);
    expect(at([root, box(0, 1, 0, 0, 100, 20), box(0, 2, 0, 10, 100, 20)], 5, 15)).toBe(2);
    expect(at([root, box(0, 1, 0, 0, 100, 20, { layer: true }), box(0, 2, 0, 10, 100, 20)], 5, 15)).toBe(1);
    const t = [root, box(0, 1, 0, 0, 40, 10), { ...box(1, 1, 0, 0, 30, 10), kind: 'line' as const, line: 0 }, { ...box(1, 1, 0, 0, 30, 10), kind: 'text' as const, line: 0, inkRight: 30 * PX, inkBottom: 10 * PX }, box(0, 4, 0, 0, 100, 40)];
    expect(at(t, 5, 5)).toBe(1);
  });
  it('tests flex items whole, in order-modified order', () => {
    const root = box(-1, 0, 0, 0, 400, 300);
    const flex = box(0, 1, 0, 0, 200, 30);
    const a = box(1, 2, 0, 0, 60, 30, { atomic: true, order: 1 });
    const b = box(1, 3, 30, 0, 60, 30, { atomic: true, order: 0 });
    expect(at([root, flex, a, b], 40, 10)).toBe(2);
  });
  it('clips in-flow descendants to the padding box, and a layer only along its containing-block chain', () => {
    const root = box(-1, 0, 0, 0, 400, 300);
    const clip = box(0, 1, 0, 0, 50, 20, { clips: true, borderTop: 2 * PX, borderRight: 2 * PX, borderBottom: 2 * PX, borderLeft: 2 * PX });
    const child = box(1, 2, 0, 0, 100, 40);
    expect(at([root, clip, child], 10, 10)).toBe(2);
    expect(at([root, clip, child], 10, 30)).toBe(0);
    expect(at([root, clip, child], 10, 18.5)).toBe(1);
    const escaped = box(1, 2, 0, 0, 100, 100, { layer: true, absolute: true });
    expect(at([root, clip, escaped], 10, 50)).toBe(2);
    const held = box(1, 2, 0, 0, 100, 100, { layer: true });
    expect(at([root, clip, held], 10, 50)).toBe(0);
  });
});

describe('pointer-events and plants', () => {
  const root = box(-1, 0, 0, 0, 400, 300);
  const under = box(0, 1, 0, 0, 100, 30);
  const over = box(0, 2, 0, 0, 100, 20, { pointerEvents: 'none' });
  const child = box(2, 3, 0, 0, 20, 10);
  it('skips a none box and keeps its auto descendants hittable', () => {
    expect(at([root, under, over, child], 50, 10)).toBe(1);
    expect(at([root, under, over, child], 5, 5)).toBe(3);
  });
  it('plants hitIgnoresPointerEventsNone and hitReversedOrder change the answer', () => {
    expect(at([root, under, over, child], 50, 10, { ignorePointerEventsNone: true, reversedOrder: false })).toBe(2);
    expect(at([root, box(0, 1, 0, 0, 100, 20), box(0, 2, 0, 10, 100, 20)], 5, 15, { ignorePointerEventsNone: false, reversedOrder: true })).toBe(1);
  });
  it('dispatches a tap to the nearest inclusive ancestor with an activation handler', () => {
    const nodes = [root, under, over, child];
    expect(activationTarget(nodes, [false, false, true, false], 3)).toBe(2);
    expect(activationTarget(nodes, [false, false, false, false], 3)).toBe(-1);
    expect(() => activationTarget(nodes, [false], 3)).toThrow(HitError);
  });
  it('refuses a malformed table', () => {
    expect(() => hitTest([], 0, 0, NO_HIT_FAULTS)).toThrow(HitError);
    expect(() => hitTest([root, box(2, 1, 0, 0, 1, 1)], 0, 0, NO_HIT_FAULTS)).toThrow(/not an earlier node/);
  });
});
