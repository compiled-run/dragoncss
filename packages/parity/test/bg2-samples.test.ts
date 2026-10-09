// BG2-a3 pixel-lane wiring (notes/T074-bg2-spec.md §7): the gradient sample points (paint-samples/gradient.ts) cover every gradient
// box of the gradient cases at every device DPR, and the two device plants run on their cases, judged on their rules.
import { describe, expect, it } from 'vitest';
import type { LaneFailure } from '../src/device-lanes.ts';
import { plantVerdict } from '../src/device-lanes.ts';
import { PLANT_CASES, PLANT_RULES } from '../src/device-run.ts';
import { BACKEND_OF, nativeCases } from '../src/native-host.ts';
import { casePoints } from '../src/pixel-reference.ts';
import { caseRootX, paddings, rootScrollX } from '../src/paint-samples/gradient.ts';
import { layout, measurerFor, NO_ENGINE_FAULTS, zoomInput } from '@dragon/layout';
import { programInput } from 'dragon';
import { REFERENCE_PLATFORM } from '../src/platform.ts';

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
    // Retargeted from interior:grad-group: gradient-backdrop lost its opacity groups when R6(b) was refused, and the dormant plant
    // (DORMANT_PLANTS) now names the gradient points of the R6(a) stacks it would darken once a translucent raster returns.
    expect(plantVerdict([f('device-pixels', 'pixel', 'gradient:beneath')], null, PLANT_RULES['gradient-unpremultiplied-upload']).caught).toBe(true);
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:beneath')], null, PLANT_RULES['gradient-unpremultiplied-upload']).caught).toBe(false);
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
    // A box without an absolute rect is a broken engine output, never a box that cannot overflow.
    expect(() => rootScrollX(boxes as never, new Map([...abs].filter(([id]) => id !== 'row')) as never, () => false, true)).toThrow('row: no absolute rect');
  });
  it('moves the root layer of gradient-rounded-rtl by its 16px overflow, at every device DPR, and of no ltr case', () => {
    const n = byId('gradient-rounded-rtl');
    for (const dpr of [2, 3, 2.625]) expect(caseRootX(n.programs[BACKEND_OF.ios], n.case.environment.viewport, dpr)).toBe(-16 * dpr);
    const l = byId('gradient-rounded');
    expect(caseRootX(l.programs[BACKEND_OF.ios], l.case.environment.viewport, 2)).toBe(0);
  }, 600_000);
});

describe('the paddings a gradient raster takes (paint-samples/gradient.ts paddings, DragonTree.apply on the device)', () => {
  it('resolve an absolutely positioned box\'s percentages against its containing block\'s padding box, or the initial one', () => {
    const n = byId('gradient-abspos');
    const p = n.programs[BACKEND_OF.android];
    const input = programInput(p, n.case.environment.viewport, 2);
    const m = measurerFor(REFERENCE_PLATFORM);
    if (m.kind !== 'ok') throw new Error(m.detail);
    const out = layout(input, m.measurer);
    if (out.kind !== 'ok') throw new Error('the engine refused gradient-abspos');
    const zoomed = zoomInput(input, NO_ENGINE_FAULTS);
    const pads = paddings(zoomed.root, new Map(out.boxes.map((r) => [r.id, r] as const)), zoomed.viewport.width, 2);
    // .rel's padding box is 240 CSS px (480 device px): 10% is 48 device px. .flow is in flow: 10% of .rel's 200px content box.
    expect(pads.get('abs')).toEqual([48 * 64, 48 * 64, 48 * 64, 48 * 64]);
    expect(pads.get('flow')).toEqual([40 * 64, 40 * 64, 40 * 64, 40 * 64]);
    // .abs-icb has no positioned ancestor: the initial containing block, the 400px viewport (800 device px).
    expect(pads.get('abs-icb')).toEqual([40 * 64, 16 * 64, 40 * 64, 16 * 64]);
  }, 600_000);
});
