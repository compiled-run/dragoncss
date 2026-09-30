// PNT2: the transform raster plants run like glyph-offset-1 (native:devices --plant): each support plant names the case it runs on,
// and a paint plant is caught by a colour-rule pixel failure while device-frames and device-lines pass.
import { describe, expect, it } from 'vitest';
import { SUPPORT_PLANTS } from 'dragon';
import type { LaneFailure } from '../src/device-lanes.ts';
import { GLYPH_PLANT_RULES, PAINT_PLANT_RULES, plantVerdict } from '../src/device-lanes.ts';
import { PLANT_CASE, PLANT_CASES } from '../src/device-run.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';

const f = (lane: LaneFailure['lane'], kind: LaneFailure['kind'], node: string): LaneFailure => ({ lane, case: 'c', dpr: 2, node, kind, detail: '' });

describe('PNT2: transform raster plants', () => {
  it('give every support plant a case: glyph-offset-1 its own, the transform plants the origin and translate fixtures', () => {
    expect(Object.keys(PLANT_CASES)).toEqual([...SUPPORT_PLANTS]);
    expect(PLANT_CASES['glyph-offset-1']).toBe(PLANT_CASE);
    const transforms = (FIXTURE_GROUPS.find((g) => g.id === 'transforms')?.fixtures ?? []).map((x) => x.id);
    expect(transforms).toContain(PLANT_CASES['transform-origin-ignored']);
    expect(transforms).toContain(PLANT_CASES['translate-percent-of-parent']);
  });
  it('catch a paint plant on a colour rule only while frames and lines pass', () => {
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:a0')], null, PAINT_PLANT_RULES).caught).toBe(true);
    expect(plantVerdict([f('device-pixels', 'pixel', 'glyph:a:text0:line0:1')], null, PAINT_PLANT_RULES).caught).toBe(true);
    expect(plantVerdict([f('device-pixels', 'pixel', 'edge:a0:top')], null, PAINT_PLANT_RULES).caught).toBe(false);
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:a0'), f('device-frames', 'frame-chrome', 'a0')], null, PAINT_PLANT_RULES).caught).toBe(false);
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:a0')], 'timed out', PAINT_PLANT_RULES).caught).toBe(false);
    // The glyph plant keeps its own rule set, the default.
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:a0')], null).caught).toBe(false);
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:a0')], null, GLYPH_PLANT_RULES).caught).toBe(false);
  });
});
