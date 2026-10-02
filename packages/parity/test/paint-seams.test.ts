// EMS (notes/T046-paint-spec.md §2, §3 item 4 and §5.1): the paint-samples registry keeps every base point in order and adds
// nothing until a module fills it; the filter hook suppresses base points and module points follow the base ones; SAMPLE_RULES
// gains shadow and gradient, whose channel deltas are the allowances/ constants, equal to GATE_CHANNEL_DELTA, inside the
// lanes literal scan.
import { describe, expect, it } from 'vitest';
import { GRADIENT_CHANNEL_DELTA } from '../src/allowances/gradient.ts';
import { SHADOW_CHANNEL_DELTA } from '../src/allowances/shadow.ts';
import { GATE_CHANNEL_DELTA } from '../src/compare.ts';
import { LANE_FILES, laneSources, toleranceLiterals } from '../src/lanes.ts';
import { checkPixels, CHANNEL_DELTA_BY_KIND } from '../src/native-compare.ts';
import type { RgbaImage } from '../src/native-compare.ts';
import { PAINT_SAMPLES, withPaintSamples } from '../src/paint-samples/registry.ts';
import type { PaintSampleContext, PaintSamples } from '../src/paint-samples/registry.ts';
import { PAINT_SAMPLE_MODULES } from '../src/paint-samples/types.ts';
import type { SampleBox } from '../src/samples.ts';
import { generateSamples, SAMPLE_RULES } from '../src/samples.ts';

const SIZE = { width: 200, height: 120 };
const box: SampleBox = { id: 'n1', left: 20, top: 20, right: 120, bottom: 80, border: { top: 4, right: 4, bottom: 4, left: 4 }, radius: 0, clips: true };
const ctx = (): PaintSampleContext => ({ program: { version: 'v', backend: 'uikit', root: {} as never, rootFontSize: 16, nodes: [] }, viewport: { width: 100, height: 60 }, dpr: 2, size: SIZE, boxes: [box], base: generateSamples([box], SIZE) });

describe('EMS: paint samples', () => {
  it('registers every module once in the paint registry order, each a stub for now', () => {
    expect(PAINT_SAMPLES.map((m) => m.name)).toEqual([...PAINT_SAMPLE_MODULES]);
    expect([...PAINT_SAMPLE_MODULES]).toEqual(['background', 'border', 'clip', 'radius', 'shadow', 'effects', 'stacking', 'outline', 'transform', 'gradient', 'scroll', 'fixed', 'scrollbar', 'image', 'foreign-view', 'control']);
  });
  it('keeps the base points unchanged, in order, when no module adds or suppresses one', () => {
    const c = ctx();
    expect(withPaintSamples(c)).toEqual(c.base);
  });
  it('lets a module suppress base points and appends module points after the base ones', () => {
    const c = ctx();
    const plant: PaintSamples = { name: 'shadow', keep: (p) => !p.rule.startsWith('outside:'), points: () => [{ x: 1, y: 2, rule: 'shadow:n1:0' }] };
    const out = withPaintSamples(c, [...PAINT_SAMPLES, plant]);
    expect(out).toEqual([...c.base.filter((p) => !p.rule.startsWith('outside:')), { x: 1, y: 2, rule: 'shadow:n1:0' }]);
    expect(c.base.some((p) => p.rule.startsWith('outside:'))).toBe(true);
  });
});

describe('EMS: per-kind channel deltas', () => {
  it('appends shadow and gradient to SAMPLE_RULES and maps every kind to GATE_CHANNEL_DELTA', () => {
    expect(SAMPLE_RULES.slice(-2)).toEqual(['shadow', 'gradient']);
    expect(Object.keys(CHANNEL_DELTA_BY_KIND)).toEqual([...SAMPLE_RULES]);
    for (const k of SAMPLE_RULES) expect(CHANNEL_DELTA_BY_KIND[k], k).toBe(GATE_CHANNEL_DELTA);
    expect(SHADOW_CHANNEL_DELTA).toBe(GATE_CHANNEL_DELTA);
    expect(GRADIENT_CHANNEL_DELTA).toBe(GATE_CHANNEL_DELTA);
  });
  it('fails a shadow or gradient point one channel level off, as every other kind', () => {
    const chrome: RgbaImage = { width: 4, height: 1, data: new Uint8Array([10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255]) };
    for (const rule of ['shadow:n1:0', 'gradient:n1:0', 'interior:n1']) {
      const points = [{ x: 1, y: 0, rule }];
      expect(checkPixels([{ x: 1, y: 0, rule, rgba: [10, 20, 30, 255] }], points, chrome).problems, rule).toEqual([]);
      expect(checkPixels([{ x: 1, y: 0, rule, rgba: [11, 20, 30, 255] }], points, chrome).problems, rule).toHaveLength(1);
    }
  });
  it('puts the allowances inside the lanes literal scan, which catches a literal planted there', () => {
    expect(LANE_FILES).toEqual(expect.arrayContaining(['packages/parity/src/allowances/shadow.ts', 'packages/parity/src/allowances/gradient.ts']));
    const sources = laneSources();
    expect(toleranceLiterals(sources)).toEqual([]);
    const planted = sources.map((s) => (s.path.endsWith('allowances/shadow.ts') ? { ...s, text: s.text.replace('= GATE_CHANNEL_DELTA;', '= 2;') } : s));
    expect(toleranceLiterals(planted)).toEqual([expect.stringContaining('packages/parity/src/allowances/shadow.ts')]);
  });
});
