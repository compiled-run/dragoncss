// color-scheme: parsed as Chrome 145 parses it, and accepted on every target where its scheme recolours nothing: any value that names
// no dark scheme, and one that names dark on a box that is not the root, a link, a form control, a box whose colour is initial or, on
// the web, a scroll container. The Chrome cases are color-scheme-plain and the reject-color-scheme ones (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { INHERITED, LONGHANDS } from '../src/css/properties.ts';
import { parseColorScheme } from '../src/css/properties/color-scheme.ts';
import { parse } from 'css-tree';
import type { ElementNode, SourceRef } from '../src/types.ts';
import { always, div, inputFor, spanTextOf } from './helpers.ts';

const project = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });

const link = (r: SourceRef, id: string): ElementNode => {
  const origin = { kind: 'authored', span: { source: r, start: 0, end: 0 } } as const;
  return { ...div(r, id, []), tag: 'a', attributes: [{ name: 'href', value: [{ when: always, value: '#x' }], origin }] };
};

/** Each color-scheme diagnostic of `.a { color-scheme: <v> } .c { <child> }` as `<target> <code>`, with .c a div (or a link). */
const at = (v: string, child = '', kid: 'div' | 'link' = 'div'): string[] =>
  project.compile(inputFor(`.a { height: 5px; color-scheme: ${v}; } .c { ${child} }`, (r) => [div(r, 'a', ['a'], [kid === 'link' ? link(r, 'c') : div(r, 'c', ['c'])])])).diagnostics
    .filter((d) => d.severity !== 'info' && d.message.includes('color-scheme')).map((d) => `${String(d.target)} ${d.code}`).sort();

/** The computed value Dragon's parser gives a color-scheme value, or null where it drops it. */
const parsed = (v: string): string | null => {
  const tokens = ((parse(v, { context: 'value' }) as unknown as { children: { toArray(): never[] } }).children.toArray());
  const r = parseColorScheme(tokens, { source: { uri: 'x', revision: 'r', hash: 'h' }, start: 0, end: 0 } as never);
  return r.kind === 'ok' ? String((r.longhands[0]?.value as { value: string }).value) : null;
};

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('color-scheme', () => {
  it('is a registered, inherited longhand after the border image longhands, discrete in animations', () => {
    expect(LONGHANDS[LONGHANDS.indexOf('color-scheme') - 1]).toBe('border-image-repeat');
    expect(INHERITED.has('color-scheme')).toBe(true);
    expect(ANIMATION_KINDS['color-scheme']).toBe(DISCRETE);
  });
  it('parses as Chrome 145 does (measured with getComputedStyle)', () => {
    const chrome: [string, string | null][] = [
      ['normal', 'normal'], ['light', 'light'], ['dark', 'dark'], ['light dark', 'light dark'], ['dark light', 'dark light'],
      ['only light', 'light only'], ['light only', 'light only'], ['only dark', 'dark only'], ['LIGHT ONLY', 'light only'], ['Dark', 'dark'],
      ['light light', 'light light'], ['foo', 'foo'], ['dark foo', 'dark foo'], ['none', 'none'], ['auto', 'auto'],
      ['only', null], ['light only dark', null], ['only only light', null], ['normal light', null], ['default', null], ['light 3', null],
    ];
    for (const [v, want] of chrome) expect(parsed(v), v).toBe(want);
  });
  it('compiles on every target where it names no dark, whatever the subtree', () => {
    for (const v of ['normal', 'light', 'light only', 'brand', 'initial', 'unset']) expect(at(v, '', 'link'), v).toEqual([]);
  });
  it('compiles on every target where it names dark on boxes it does not recolour, also through var() and inherit', () => {
    for (const v of ['dark', 'light dark', 'dark only', 'only dark', 'brand dark', 'var(--s, dark)']) expect(at(v), v).toEqual([]);
    expect(at('dark', 'color-scheme: inherit; color: red')).toEqual([]);
  });
  it('is refused where a dark scheme recolours: a link, a box whose colour is initial and, on the web, a scroll container', () => {
    expect(at('dark', '', 'link')).toEqual(REFUSED);
    expect(at('light dark', 'color: initial')).toEqual(REFUSED);
    expect(at('dark', 'overflow: auto')).toEqual(['web DRAGON_UNSUPPORTED_VALUE']);
    expect(at('dark', 'overflow: hidden')).toEqual([]);
  });
  it('is refused on the root, at the declaration', () => {
    const input = inputFor(':root { color-scheme: light dark; }', (r) => [div(r, 'a', [])]);
    const ds = project.compile(input).diagnostics.filter((d) => d.severity !== 'info');
    expect(ds.map((d) => `${String(d.target)} ${d.code}`).sort()).toEqual(REFUSED);
    expect(ds.map((d) => spanTextOf(input, d))).toEqual(['light dark', 'light dark', 'light dark']);
  });
});
