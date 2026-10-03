// BG2-a3 pixel-lane wiring (notes/T074-bg2-spec.md §7): the gradient sample points (paint-samples/gradient.ts) cover every gradient
// box of the gradient cases at every device DPR, and the two device plants run on their cases, judged on their rules.
import { describe, expect, it } from 'vitest';
import type { LaneFailure } from '../src/device-lanes.ts';
import { plantVerdict } from '../src/device-lanes.ts';
import { PLANT_CASES, PLANT_LANES, PLANT_RULES } from '../src/device-run.ts';
import { BACKEND_OF, nativeCases } from '../src/native-host.ts';
import { casePoints } from '../src/pixel-reference.ts';
import { caseRootX, rootScrollX } from '../src/paint-samples/gradient.ts';

const byId = (id: string) => {
  const n = nativeCases().find((c) => c.case.id === id);
  if (n === undefined) throw new Error(`no case ${id}`);
  return n;
};

describe('BG2 gradient sample points', () => {
  for (const id of ['gradient-linear', 'gradient-angles', 'bg-geometry']) {
    it(`sample every gradient box of ${id} at every device DPR`, () => {
      const n = byId(id);
      const p = n.programs[BACKEND_OF.ios];
      const gradientBoxes = p.nodes.filter((node) => node.writes.some((w) => w.kind === 'background-layers')).map((node) => node.id);
      expect(gradientBoxes.length).toBeGreaterThan(5);
      for (const dpr of [2, 3, 2.625]) {
        const points = casePoints(p, n.case.environment.viewport, dpr).filter((q) => q.rule.startsWith('gradient:'));
        const sampled = new Set(points.map((q) => q.rule.slice('gradient:'.length)));
        expect([...sampled].sort(), `${id}@${dpr}`).toEqual([...gradientBoxes].sort());
      }
    }, 600_000);
  }
  it('add no point to a case without gradient layers', () => {
    const n = byId('color-border-sides');
    expect(casePoints(n.programs[BACKEND_OF.android], n.case.environment.viewport, 2).filter((q) => q.rule.startsWith('gradient:'))).toEqual([]);
  }, 600_000);
});

describe('the gradient device plants', () => {
  const f = (lane: LaneFailure['lane'], kind: LaneFailure['kind'], node: string): LaneFailure => ({ lane, case: 'c', dpr: 2, node, kind, detail: '' });
  it('run on cases that hold their rules', () => {
    expect(PLANT_CASES['gradient-offset-1']).toEqual(['gradient-linear']);
    expect(PLANT_CASES['gradient-unpremultiplied-upload']).toEqual(['gradient-backdrop']);
    expect([PLANT_LANES['gradient-offset-1'], PLANT_LANES['gradient-unpremultiplied-upload']]).toEqual(['device-pixels', 'device-pixels']);
    const backdrop = byId('gradient-backdrop').programs[BACKEND_OF.android];
    const points = casePoints(backdrop, byId('gradient-backdrop').case.environment.viewport, 2);
    expect(points.some((q) => PLANT_RULES['gradient-unpremultiplied-upload'].test(q.rule))).toBe(true);
    const linear = byId('gradient-linear').programs[BACKEND_OF.ios];
    expect(casePoints(linear, byId('gradient-linear').case.environment.viewport, 3).some((q) => PLANT_RULES['gradient-offset-1'].test(q.rule))).toBe(true);
  }, 600_000);
  it('are caught only by device-pixels failures on their rules, with frames and lines passing', () => {
    const rule = PLANT_RULES['gradient-offset-1'];
    expect(plantVerdict([f('device-pixels', 'pixel', 'gradient:right')], null, rule).caught).toBe(true);
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:right')], null, rule).caught).toBe(false);
    expect(plantVerdict([f('device-pixels', 'pixel', 'gradient:right'), f('device-frames', 'frame-chrome', 'right')], null, rule).caught).toBe(false);
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:grad-group')], null, PLANT_RULES['gradient-unpremultiplied-upload']).caught).toBe(true);
  });
});

describe('the root scroller\'s contents origin (R4, rootScrollX)', () => {
  const r = (id: string, parent: string | null, x: number) => ({ id, parent, x, y: 0, width: 64, height: 64 });
  const boxes = [r('html', null, 0), r('body', 'html', 0), r('row', 'body', -2048), r('clip', 'body', 0), r('wide', 'clip', -4096)];
  const abs = new Map(boxes.map((b) => [b.id, b] as const));
  it('is the leftmost box no clipping box holds in rtl, and 0 in ltr', () => {
    expect(rootScrollX(boxes as never, abs as never, () => false, true)).toBe(-4096);
    expect(rootScrollX(boxes as never, abs as never, (id) => id === 'clip', true)).toBe(-2048);
    expect(rootScrollX(boxes as never, abs as never, (id) => id === 'clip', false)).toBe(0);
    // html and body never clip here: their overflow propagates to the viewport.
    expect(rootScrollX(boxes as never, abs as never, (id) => id === 'body' || id === 'html', true)).toBe(-4096);
  });
  it('moves the root layer of gradient-rounded-rtl by its 16px overflow, at every device DPR, and of no ltr case', () => {
    const n = byId('gradient-rounded-rtl');
    for (const dpr of [2, 3, 2.625]) expect(caseRootX(n.programs[BACKEND_OF.ios], n.case.environment.viewport, dpr)).toBe(-16 * dpr);
    const l = byId('gradient-rounded');
    expect(caseRootX(l.programs[BACKEND_OF.ios], l.case.environment.viewport, 2)).toBe(0);
  }, 600_000);
});
