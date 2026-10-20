// ZOOM: zoom is accepted where it is 1 (1, normal, 100%, 0, a calculation, var()), on every target, parsed as Chrome 145 parses it
// (normal and non-negative numbers and percentages; a negative value, auto and reset are dropped), and refused elsewhere, since
// Dragon scales no subtree yet. The Chrome cases are zoom-one and reject-zoom (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import { zoomOf } from '../src/css/properties/zoom.ts';
import { div, inputFor } from './helpers.ts';

const project = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });

/** Each non-info diagnostic of `.a { zoom: <v> }` as `<target> <code>`. */
const at = (v: string, child = ''): string[] =>
  project.compile(inputFor(`.a { height: 5px; zoom: ${v}; } .c { ${child} }`, (r) => [div(r, 'a', ['a'], [div(r, 'c', ['c'])])])).diagnostics
    .filter((d) => d.severity !== 'info').map((d) => `${String(d.target)} ${d.code}`).sort();

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('zoom', () => {
  it('is a registered longhand after the 3D transform longhands, discrete in animations', () => {
    expect(LONGHANDS[LONGHANDS.indexOf('zoom') - 1]).toBe('perspective-origin');
    expect(ANIMATION_KINDS.zoom).toBe(DISCRETE);
  });
  it('computes a percentage to its number, and 0 and normal to 1', () => {
    expect(zoomOf({ kind: 'keyword', value: 'normal' })).toBe(1);
    expect(zoomOf({ kind: 'percentage', value: 100 })).toBe(1);
    expect(zoomOf({ kind: 'number', value: 0 })).toBe(1);
    expect(zoomOf({ kind: 'percentage', value: 0 })).toBe(1);
    expect(zoomOf({ kind: 'number', value: 1.5 })).toBe(1.5);
    expect(zoomOf({ kind: 'percentage', value: 50 })).toBe(0.5);
  });
  it('compiles on every target where it is 1', () => {
    for (const v of ['1', 'normal', 'NORMAL', '100%', '1.0', '+1', '1e0', '0', '0%', 'calc(1)', 'calc(0.5 + 0.5)', 'initial', 'unset', 'var(--z, 1)']) expect(at(v), v).toEqual([]);
    expect(at('1', 'zoom: inherit')).toEqual([]);
  });
  it('is refused on every target elsewhere, once per element, also through var() and inherit', () => {
    for (const v of ['1.5', '2', '50%', '0.5', 'calc(2 * 1)', 'var(--z, 2)']) expect(at(v), v).toEqual(REFUSED);
    expect(at('2', 'zoom: inherit')).toEqual([...REFUSED, ...REFUSED].sort());
  });
  it('drops what Chrome drops: a negative value, auto, reset, a length and two values', () => {
    for (const v of ['-1', '-50%', 'auto', 'reset', '1px', '1 1']) expect(at(v), v).toEqual(['null DRAGON_CSS_INVALID_VALUE']);
  });
});
