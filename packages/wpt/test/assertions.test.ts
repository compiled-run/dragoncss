import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { roundLu, withinTolerance } from '../src/assertions.ts';
import { runTranslation } from '../src/dragon.ts';
import { translate } from '../src/translate.ts';

describe('check-layout tolerance and DOM rounding', () => {
  it('assert_tolerance: under 1 CSS px passes, otherwise exact equality with Number(expected)', () => {
    expect(withinTolerance(50, '50.99')).toBe(true);
    expect(withinTolerance(50, '49.01')).toBe(true);
    expect(withinTolerance(50, '51')).toBe(false);
    expect(withinTolerance(50, '49')).toBe(false);
    expect(withinTolerance(50, 'fifty')).toBe(false);
  });

  it('offset values round half up, negative values too (LayoutUnit::Round, measured in Chrome 145)', () => {
    expect([roundLu(32), roundLu(31), roundLu(-32), roundLu(-33), roundLu(-96), roundLu(10.5 * 64)]).toEqual([1, 0, 0, -1, -1, 11]);
  });
});

describe('a synthetic page through the engine (expected values measured in Chrome 145)', () => {
  // offsetParent: .p is position: relative, so its children measure from its padding edge (after its 3px left and 2px top
  // borders); .q is static, so its child measures from the initial containing block, like children of body. Sizes and
  // positions are fractional, so every value is rounded.
  const html = readFileSync(new URL('./data/offsets.html', import.meta.url), 'utf8');

  it('every offset, size, client, total and bounding-rect value matches check-layout', () => {
    const t = translate('css/x/offsets.html', html, 'c0ffee');
    if (t.kind !== 'fixture') throw new Error(t.missing);
    const o = runTranslation(t, 'web').outcome;
    if (o.status === 'not-runnable') throw new Error(o.missing);
    const values = Object.fromEntries(o.results.flatMap((s) => s.checks.map((c) => [`${c.check.node}.${c.check.attribute}`, c.actual])));
    expect(values).toEqual({
      'n8.offset-x': 19, 'n8.offset-y': 8, 'n8.width': 108, 'n8.height': 23,
      'n9.offset-x': 5, 'n9.offset-y': 2, 'n9.width': 41, 'n9.height': 11, 'n9.total-x': 5, 'n9.client-width': 41, 'n9.bounding-client-rect-width': 40.5,
      'n10.offset-x': 5, 'n10.offset-y': 12, 'n10.width': 8, 'n10.height': 8,
      'n11.offset-y': 31, 'n11.height': 32, 'n11.total-y': 32, 'n11.client-height': 31,
      'n12.offset-x': 8, 'n12.offset-y': 32, 'n12.height': 8,
    });
    expect(o.status).toBe('pass');
  });
});
