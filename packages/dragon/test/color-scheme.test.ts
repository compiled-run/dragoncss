// color-scheme: parsed as Chrome 145 parses it, and accepted on every target where its scheme recolours nothing: any value that names
// no dark scheme, and one that names dark on a box that is not the root, a link, a form control, a box whose colour is initial or, on
// the web, a scroll container. The Chrome cases are color-scheme-plain and the reject-color-scheme ones (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import { createProjectWith, nativeBands, NO_FAULTS } from '../src/internal.ts';
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
    expect(LONGHANDS[LONGHANDS.indexOf('color-scheme') - 1]).toBe('quotes');
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
  it('is refused on an SVG shape whose colour is initial, and on an auto outline, which Chrome recolours under dark', () => {
    const shape = (r: SourceRef): ElementNode => {
      const rect: ElementNode = { ...div(r, 'r', ['r']), tag: 'rect', attributes: [{ name: 'width', value: [{ when: always, value: '10' }], origin: div(r, 'x', []).origin }, { name: 'height', value: [{ when: always, value: '10' }], origin: div(r, 'x', []).origin }] };
      return { ...div(r, 'd', ['d']), children: [{ ...div(r, 's', ['s']), tag: 'svg', attributes: [{ name: 'width', value: [{ when: always, value: '20' }], origin: div(r, 'x', []).origin }, { name: 'height', value: [{ when: always, value: '20' }], origin: div(r, 'x', []).origin }], children: [rect] }] };
    };
    const svg = (css: string): string[] => project.compile(inputFor(css, (r) => [shape(r)])).diagnostics
      .filter((d) => d.severity !== 'info' && d.message.includes('color-scheme')).map((d) => `${String(d.target)} ${d.code}`).sort();
    expect(svg('.d { color-scheme: dark; } .s { display: block; } .r { color: initial; fill: currentcolor; }')).toEqual(REFUSED);
    expect(svg('.d { color-scheme: light; } .s { display: block; } .r { color: initial; fill: currentcolor; }')).toEqual([]);
    expect(at('dark', 'outline: auto 2px')).toEqual(REFUSED);
    expect(at('dark', 'outline: auto 2px red')).toEqual(REFUSED);
    expect(at('dark', 'outline: 2px solid red')).toEqual([]);
  });
  it('is refused on the root, at the declaration', () => {
    const input = inputFor(':root { color-scheme: light dark; }', (r) => [div(r, 'a', [])]);
    const ds = project.compile(input).diagnostics.filter((d) => d.severity !== 'info');
    expect(ds.map((d) => `${String(d.target)} ${d.code}`).sort()).toEqual(REFUSED);
    expect(ds.map((d) => spanTextOf(input, d))).toEqual(['light dark', 'light dark', 'light dark']);
  });
});

describe('color-scheme where the host paints the canvas', () => {
  const hosted = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', hostCanvas: true });
  const compile = (css: string, child = '', kid: 'div' | 'link' = 'div') => hosted.compile(inputFor(`${css} .a { height: 5px; } .c { ${child} }`, (r) => [div(r, 'a', ['a'], [kid === 'link' ? link(r, 'c') : div(r, 'c', ['c'])])]));
  const refusals = (c: ReturnType<typeof compile>): string[] => c.diagnostics.filter((d) => d.severity !== 'info' && d.message.includes('color-scheme')).map((d) => `${String(d.target)} ${d.code}`).sort();
  // One per refused element and target: the web output refuses the root and the child as before.
  const WEB = ['web DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];
  const NATIVE = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE'];

  it('draws a root that opts into dark, with its links, on native; the web output stays refused', () => {
    for (const css of [':root { color-scheme: light dark; }', 'html { color-scheme: dark; }', ':root { --s: light dark; color-scheme: var(--s); }']) {
      expect(refusals(compile(css, '', 'link')), css).toEqual(WEB);
      expect(refusals(compile(css, 'color: initial')), css).toEqual(WEB);
    }
  });
  it('splits the bands on the preference where the root follows it, and only there', () => {
    expect(nativeBands(compile(':root { color-scheme: light dark; }'))?.conditions).toEqual(['(not (prefers-color-scheme: dark))', '(prefers-color-scheme: dark)']);
    expect(nativeBands(compile(':root { color-scheme: dark; }'))).toBeNull();
    expect(nativeBands(compile('.c { color-scheme: light dark; }'))).toBeNull();
  });
  it('refuses on native what the dark scheme recolours and Dragon does not draw in it: an auto outline, a box whose scheme is not the root\'s', () => {
    expect(refusals(compile('html { color-scheme: dark; }', 'outline: auto 2px'))).toEqual([...NATIVE, ...WEB].sort());
    expect(refusals(compile('html { color-scheme: dark; } .a { color-scheme: light; }', '', 'link'))).toEqual([...NATIVE, 'web DRAGON_UNSUPPORTED_VALUE'].sort());
    expect(refusals(compile('html { color-scheme: light; } .a { color-scheme: dark; }', '', 'link'))).toEqual([...NATIVE, 'web DRAGON_UNSUPPORTED_VALUE'].sort());
    expect(refusals(compile('html { color-scheme: dark; } .a { color-scheme: dark only; }', '', 'link'))).toEqual(WEB);
  });
});
