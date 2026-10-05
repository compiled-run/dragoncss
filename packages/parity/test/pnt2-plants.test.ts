// PNT2: the transform raster plants run as P6a's paint plants do (native:devices --plant): each names the cases it runs on
// (device-run.ts PLANT_CASES) and the sample rules it must fail (PLANT_RULES); plantVerdict catches it on a colour-rule pixel failure
// while the frames and the lines pass and the host finished.
import { describe, expect, it } from 'vitest';
import { SUPPORT_PLANTS } from 'dragon';
import type { LaneFailure } from '../src/device-lanes.ts';
import { plantVerdict } from '../src/device-lanes.ts';
import { isGlyphPlant, PLANT_CASES, PLANT_RULES } from '../src/device-run.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';

const f = (lane: LaneFailure['lane'], kind: LaneFailure['kind'], node: string): LaneFailure => ({ lane, case: 'c', dpr: 2, node, kind, detail: '' });

describe('PNT2: transform raster plants', () => {
  it('run on the origin and translate fixtures of the transforms group', () => {
    // Both transform plants are paint plants, in the transform emitter's order (other modules' plants may follow them).
    const paint = SUPPORT_PLANTS.filter((p) => !isGlyphPlant(p));
    const at = paint.indexOf('transform-origin-ignored');
    expect(paint.slice(at, at + 2)).toEqual(['transform-origin-ignored', 'translate-percent-of-parent']);
    expect([PLANT_CASES['transform-origin-ignored'], PLANT_CASES['translate-percent-of-parent']]).toEqual([['transform-origin'], ['transform-translate']]);
    const transforms = (FIXTURE_GROUPS.find((g) => g.id === 'transforms')?.fixtures ?? []).map((x) => x.id);
    for (const c of [...PLANT_CASES['transform-origin-ignored'], ...PLANT_CASES['translate-percent-of-parent']]) expect(transforms).toContain(c);
  });
  it('are caught on a colour rule only while the frames and the lines pass and the host finished', () => {
    const rule = PLANT_RULES['transform-origin-ignored'];
    expect(PLANT_RULES['translate-percent-of-parent']).toEqual(rule);
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:a0')], null, rule).caught).toBe(true);
    expect(plantVerdict([f('device-pixels', 'pixel', 'glyph:a:text0:line0:1')], null, rule).caught).toBe(true);
    expect(plantVerdict([f('device-pixels', 'pixel', 'edge:a0:top')], null, rule).caught).toBe(false);
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:a0'), f('device-frames', 'frame-chrome', 'a0')], null, rule).caught).toBe(false);
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:a0'), f('device-lines', 'line-chrome', 'a0')], null, rule).caught).toBe(false);
    expect(plantVerdict([f('device-pixels', 'pixel', 'interior:a0')], 'timed out', rule).caught).toBe(false);
  });
});
