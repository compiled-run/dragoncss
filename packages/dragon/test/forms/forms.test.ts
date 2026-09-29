import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_PROBE } from '../../src/forms/appearance.generated.ts';
import {
  authorStyleOf,
  compareForms,
  Decimal,
  expectedButtonChildren,
  FORM_FAULT_NAMES,
  NO_FORM_FAULTS,
  rangeValue,
  thumbOffset,
} from '../../src/forms/index.ts';
import type { ButtonCapture, Captures, DevolveCapture, RangeGeometryCapture, RangeValueCapture } from '../../src/forms/index.ts';
import { RANGE_NONE_THUMB, RANGE_THEME_THUMB, RANGE_UA_SHADOW } from '../../src/forms/ua-shadow.generated.ts';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./chrome-145/${name}`, import.meta.url), 'utf8')) as T;

const captures: Captures = {
  rangeValue: read<RangeValueCapture>('range-value.json'),
  rangeGeometry: read<RangeGeometryCapture>('range-geometry.json'),
  button: read<ButtonCapture>('button.json'),
  devolve: read<DevolveCapture>('devolve.json'),
};

describe('forms reference functions against Chrome 145', () => {
  it('captures come from Chrome 145.0.7632.6', () => {
    for (const c of [captures.rangeValue, captures.rangeGeometry, captures.button, captures.devolve]) expect(c.chrome).toBe('145.0.7632.6');
  });

  it('equals Chrome on every comparison, N/N', () => {
    const r = compareForms(captures);
    expect(r.mismatches).toEqual([]);
    expect(r.counts['range-value']).toBe(captures.rangeValue.rows.length + captures.rangeGeometry.cases.length);
    expect(r.counts['range-geometry']).toBe(2 * captures.rangeGeometry.cases.length);
    expect(r.counts['button-inner']).toBeGreaterThan(1000);
    expect(r.counts.appearance).toBe(9);
  });

  it('plants the three faults', () => {
    expect(FORM_FAULT_NAMES).toEqual(['thumbUnmirrored', 'stepTieDown', 'devolveIgnored']);
  });

  it.each(FORM_FAULT_NAMES)('%s flips at least one captured comparison', (name) => {
    expect(compareForms(captures, { ...NO_FORM_FAULTS, [name]: true }).mismatches.length).toBeGreaterThan(0);
  });

  it('the matrix tells the block-centred and container button models apart', () => {
    const swapped: ButtonCapture = {
      ...captures.button,
      cases: captures.button.cases.map((c) => ({
        ...c,
        computed: { ...c.computed, display: c.computed.display === 'flex' ? 'block' : 'flex', flexDirection: c.computed.display === 'flex' ? c.computed.flexDirection : 'row' },
      })),
    };
    expect(compareForms({ ...captures, button: swapped }).mismatches.length).toBeGreaterThan(100);
  });

  it('the matrix sees the safe clamp and the truncating half', () => {
    const shifted = captures.button.cases.filter((c) => c.css.includes('height:12px') && c.children === 'both');
    expect(shifted.length).toBeGreaterThan(0);
    for (const c of shifted) expect(expectedButtonChildren(c).text?.[1]).toBe(c.rects.text?.[1]);
    const odd = captures.button.cases.filter((c) => c.css.includes('min-height:60.046875px') && c.computed.display === 'block');
    expect(odd.some((c) => ((c.rects.text ?? c.rects.element) as readonly number[])[1] as number % 32 !== 0)).toBe(true);
  });
});

describe('R11 devolve table', () => {
  it('the probe reproduces R11 and the Blink rule', () => {
    expect(APPEARANCE_PROBE).toEqual({
      button: { none: 'theme', 'background-color': 'css', border: 'css', 'appearance-none': 'css' },
      range: { none: 'theme', 'background-color': 'theme', border: 'theme', 'appearance-none': 'css', 'input-none-thumb-auto': 'theme' },
    });
  });

  it('a themed case differs from its CSS twin at some probe point and a CSS case at none', () => {
    for (const c of captures.devolve.cases) {
      const differs = c.points.some((p) => p.control !== p.twin);
      expect(differs).toBe(c.result === 'theme');
    }
    expect(authorStyleOf('input-none-thumb-auto')).toEqual({ appearance: 'none', background: false, border: false, thumbAppearance: 'auto' });
  });
});

describe('UA shadow of input[type=range]', () => {
  const decl = (part: keyof typeof RANGE_UA_SHADOW, name: string): string | undefined => {
    let v: string | undefined;
    for (const r of RANGE_UA_SHADOW[part]) for (const d of r.declarations) if (d[0] === name) v = d[1];
    return v;
  };

  it('container is flex, track is a centred flex:1 block, thumb is a themed block', () => {
    expect(decl('container', 'display')).toBe('flex');
    expect(decl('container', 'flex-grow')).toBe('1');
    expect(decl('track', 'align-self')).toBe('center');
    expect(decl('track', 'display')).toBe('block');
    expect(decl('thumb', 'appearance')).toBe('auto');
    expect(decl('thumb', 'box-sizing')).toBe('border-box');
    expect(RANGE_THEME_THUMB).toEqual({ width: 16, height: 16 });
    // An appearance:none thumb with no author size is an empty block: it fills the track's width and has no height.
    expect(RANGE_NONE_THUMB.height).toBe(0);
    expect(RANGE_NONE_THUMB.width).toBeGreaterThan(0);
  });
});

describe('Blink Decimal and the range value model', () => {
  it('serialises as Blink does', () => {
    expect(Decimal.fromString('1e1').toString()).toBe('1e+1');
    expect(Decimal.fromString('0.1').mul(Decimal.int(3)).toString()).toBe('0.3');
    expect(Decimal.fromString('0.00000123').toString()).toBe('0.00000123');
    expect(Decimal.fromString('2.5').round().toString()).toBe('3');
    expect(Decimal.fromString('-2.5').round().toString()).toBe('-3');
    expect(Decimal.int(1).div(Decimal.int(3)).toString()).toBe('0.333333333333333');
  });

  it('follows the HTML range state', () => {
    expect(rangeValue({ min: null, max: null, step: null, value: null })).toBe('50');
    expect(rangeValue({ min: '50', max: '10', step: null, value: null })).toBe('50');
    expect(rangeValue({ min: '0', max: '100', step: '3', value: '7.5' })).toBe('9');
    expect(rangeValue({ min: null, max: null, step: '10', value: '33' })).toBe('33');
    expect(rangeValue({ min: null, max: null, step: null, value: '+5' })).toBe('50');
  });

  it('truncates the thumb offset to a LayoutUnit', () => {
    expect(thumbOffset(0.3, 64 * 113 + 1, 0)).toBe(Math.trunc(0.3 * (113 + 1 / 64) * 64));
    expect(thumbOffset(1, 100 * 64, 16 * 64)).toBe(84 * 64);
  });
});
