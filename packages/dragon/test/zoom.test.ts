// ZOOM: zoom parses as Chrome 145 parses it (normal and non-negative numbers and percentages; a negative value, auto and reset are
// dropped). The web output keeps it, so web compiles any zoom; native lays a zoomed subtree out with its lengths multiplied by the
// effective zoom and refuses, on iOS and Android, a zoomed element holding a length or a feature it does not scale. The Chrome
// cases are zoom-one and zoom-scaled (packages/parity/fixtures).
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

const NATIVE_REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE'];

/** The messages of the iOS diagnostics of `.a { zoom: <v>; <own> } .c { <child> }`. */
const iosMessages = (v: string, own: string, child = ''): string[] =>
  project.compile(inputFor(`.a { zoom: ${v}; ${own} } .c { ${child} }`, (r) => [div(r, 'a', ['a'], [div(r, 'c', ['c'])])])).diagnostics
    .filter((d) => d.severity !== 'info' && d.target === 'ios').map((d) => d.message);

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
  it('compiles on every target elsewhere when native scales every length it holds, also through var() and inherit', () => {
    for (const v of ['1.5', '2', '50%', '0.5', 'calc(2 * 1)', 'var(--z, 2)']) expect(at(v), v).toEqual([]);
    expect(at('2', 'zoom: inherit; width: 3px; border: thick solid; letter-spacing: 1px')).toEqual([]);
  });
  it('is refused on iOS and Android alone, once per element, where native does not scale what the zoomed element holds', () => {
    expect(at('2', 'border-top-left-radius: 3px')).toEqual(NATIVE_REFUSED);
    expect(at('2', 'width: calc(10px + 1em)')).toEqual(NATIVE_REFUSED);
    expect(at('2', 'overflow: auto')).toEqual(NATIVE_REFUSED);
    expect(at('2', 'outline: thin solid')).toEqual(NATIVE_REFUSED);
    expect(at('2', 'transition: width 1s')).toEqual(NATIVE_REFUSED);
    expect(at('1.5', 'zoom: inherit; box-shadow: 1px 1px red; border-top-left-radius: 2px')).toEqual(NATIVE_REFUSED);
    expect(iosMessages('2', '', 'border-top-left-radius: 3px')).toEqual(['<div> c is laid out at zoom 2 and border-top-left-radius: 3px is a length native does not zoom yet (ZOOM)']);
    expect(iosMessages('2', 'overflow: auto')).toEqual(['<div> a is laid out at zoom 2 and overflow-x: auto makes it a scroll container, which native does not zoom yet (ZOOM)']);
  });
  it('checks no length where the effective zoom is 1, and scales the lengths a zoomed element inherits only where native lays them out', () => {
    expect(at('1', 'border-top-left-radius: 3px')).toEqual([]);
    const inherits = (own: string): string[] => project.compile(inputFor(`.a { ${own} } .c { zoom: 2; }`, (r) => [div(r, 'a', ['a'], [div(r, 'c', ['c'])])])).diagnostics
      .filter((d) => d.severity !== 'info').map((d) => `${String(d.target)} ${d.code}`).sort();
    expect(inherits('letter-spacing: 1px; line-height: 20px')).toEqual([]);
    // Chrome zooms an inherited text-shadow again (an offset of 20px under zoom: 2 draws at 40px); native paints it at 1.
    expect(inherits('text-shadow: 0 20px red')).toEqual(NATIVE_REFUSED);
  });
  it('is refused on every target where an element at a zoom other than its parent\'s inherits a length explicitly', () => {
    const ALL_REFUSED = [...NATIVE_REFUSED, 'web DRAGON_UNSUPPORTED_VALUE'].sort();
    const explicit = (parent: string, child: string): string[] => project.compile(inputFor(`.a { ${parent} } .c { ${child} }`, (r) => [div(r, 'a', ['a'], [div(r, 'c', ['c'])])])).diagnostics
      .filter((d) => d.severity !== 'info').map((d) => `${String(d.target)} ${d.code}`).sort();
    expect(explicit('padding: 3px; margin-left: 7px; width: 60px', 'zoom: 2; padding: inherit; margin-left: inherit; height: 5px')).toEqual(ALL_REFUSED);
    expect(explicit('zoom: 2; padding: 3px', 'zoom: 0.5; padding: inherit')).toEqual(ALL_REFUSED);
    expect(explicit('letter-spacing: 1px', 'zoom: 2; letter-spacing: unset')).toEqual(ALL_REFUSED);
    // At the parent's zoom an inherited length is the parent's own.
    expect(explicit('zoom: 2; padding: 3px', 'padding: inherit')).toEqual([]);
    expect(explicit('padding: 0', 'zoom: 2; padding: inherit')).toEqual([]);
  });
  it('lays out a math function of percentages alone at any zoom, as a percentage does not zoom', () => {
    expect(at('2', 'width: min(50%, 100%)')).toEqual([]);
    expect(at('2', 'width: calc(50% + 0px)')).toEqual([]);
  });
  it('drops what Chrome drops: a negative value, auto, reset, a length and two values', () => {
    for (const v of ['-1', '-50%', 'auto', 'reset', '1px', '1 1']) expect(at(v), v).toEqual(['null DRAGON_CSS_INVALID_VALUE']);
  });
});
