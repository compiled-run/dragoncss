// BG2 pixel-lane wiring: the gradient sample points (paint-samples/gradient.ts) and the gradient-offset-1 raster plant's case and
// verdict (device-run.ts PLANT_CASES, device-lanes.ts PLANT_RULES).
import { describe, expect, it } from 'vitest';
import type { LaneFailure } from '../src/device-lanes.ts';
import { PLANT_RULES, plantVerdict } from '../src/device-lanes.ts';
import { PLANT_CASE, PLANT_CASES } from '../src/device-run.ts';
import { BACKEND_OF, nativeCases } from '../src/native-host.ts';
import { casePoints } from '../src/pixel-reference.ts';

const byId = (id: string) => {
  const n = nativeCases().find((c) => c.case.id === id);
  if (n === undefined) throw new Error(`no case ${id}`);
  return n;
};

describe('BG2 gradient sample points', () => {
  it('sample every gradient box of the gradient cases at every device DPR, inside the box', () => {
    const n = byId('gradient-linear');
    const p = n.programs[BACKEND_OF.ios];
    const gradientBoxes = p.nodes.filter((node) => node.writes.some((w) => w.kind === 'background-layers')).map((node) => node.id);
    expect(gradientBoxes.length).toBe(26);
    for (const dpr of [2, 3, 2.625]) {
      const points = casePoints(p, n.case.environment.viewport, dpr).filter((q) => q.rule.startsWith('gradient:'));
      const sampled = new Set(points.map((q) => q.rule.slice('gradient:'.length)));
      expect([...sampled].sort()).toEqual([...gradientBoxes].sort());
      expect(points.length).toBeGreaterThan(gradientBoxes.length * 4);
    }
  }, 600_000);
  it('add no point to a case without gradient layers', () => {
    const n = byId('color-border-sides');
    expect(casePoints(n.programs[BACKEND_OF.android], n.case.environment.viewport, 2).filter((q) => q.rule.startsWith('gradient:'))).toEqual([]);
  }, 600_000);
});

describe('the gradient-offset-1 raster plant', () => {
  const f = (lane: LaneFailure['lane'], kind: string, node: string): LaneFailure => ({ lane, case: 'c', dpr: 2, node, kind, detail: '' }) as LaneFailure;
  it('runs on gradient-linear, a case with gradients, and glyph-offset-1 keeps its case', () => {
    expect(PLANT_CASES['glyph-offset-1']).toBe(PLANT_CASE);
    expect(PLANT_CASES['gradient-offset-1']).toBe('gradient-linear');
    expect(byId('gradient-linear').programs[BACKEND_OF.android].nodes.some((node) => node.writes.some((w) => w.kind === 'background-layers'))).toBe(true);
  }, 600_000);
  it('is caught only by device-pixels failures on gradient rules, with frames and lines passing', () => {
    const rules = PLANT_RULES['gradient-offset-1'];
    expect(plantVerdict([f('device-pixels', 'pixel', 'gradient:right')], null, rules).caught).toBe(true);
    expect(plantVerdict([f('device-pixels', 'pixel', 'glyph:w1:text0:line0:0')], null, rules).caught).toBe(false);
    expect(plantVerdict([f('device-pixels', 'pixel', 'gradient:right'), f('device-frames', 'frame-engine', 'right')], null, rules).caught).toBe(false);
    expect(plantVerdict([f('device-pixels', 'pixel', 'gradient:right')], 'timed out', rules).caught).toBe(false);
  });
});
