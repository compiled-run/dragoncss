// css-backgrounds-3 §3.10: the background shorthand, parsed, expanded and refused where it sets a longhand Dragon does not model.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, resolvedColors } from '../src/internal.ts';
import { BACKGROUND_RESET_LONGHANDS } from '../src/css/properties/background.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { div, expectCatalogued, explainOne, inputFor, spanTextOf } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/bg.css', revision: 'r1', hash: 'sha256:0' };

function declare(value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; css: string } {
  const css = `.a { background: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, css };
}

const spanOf = (css: string, d: Diagnostic): string => (d.origin.kind === 'authored' ? css.slice(d.origin.span.start, d.origin.span.end) : '<unlocated>');

describe('background shorthand: parse and expansion', () => {
  it('lists the eight non-colour longhands with their initial values as Chrome 145 serializes them', () => {
    expect(BACKGROUND_RESET_LONGHANDS).toEqual({
      'background-image': 'none', 'background-position-x': '0%', 'background-position-y': '0%', 'background-size': 'auto',
      'background-repeat': 'repeat', 'background-attachment': 'scroll', 'background-origin': 'padding-box', 'background-clip': 'border-box',
    });
  });

  const colours: [string, unknown][] = [
    ['red', { kind: 'color', value: { r: 255, g: 0, b: 0, alpha: 255 }, syntax: 'named-color' }],
    ['#0f0', { kind: 'color', value: { r: 0, g: 255, b: 0, alpha: 255 }, syntax: 'hex-color' }],
    ['rgb(1 2 3 / 50%)', { kind: 'color', value: { r: 1, g: 2, b: 3, alpha: 128 }, syntax: 'rgb()' }],
    ['hsla(120, 100%, 25%, 0.5)', { kind: 'color', value: { r: 0, g: 128, b: 0, alpha: 128 }, syntax: 'hsla()' }],
    ['transparent', { kind: 'keyword', value: 'transparent' }],
    ['currentcolor', { kind: 'keyword', value: 'currentcolor' }],
  ];
  for (const [value, expected] of colours) {
    it(`background: ${value} sets background-color explicitly and nothing else`, () => {
      const { declaration, diagnostics } = declare(value);
      expect(diagnostics).toEqual([]);
      expect(declaration?.property).toBe('background');
      expect(declaration?.longhands).toEqual([{ property: 'background-color', value: expected, explicit: true }]);
    });
  }

  it('background: none fills background-color with its initial transparent, implicitly', () => {
    const { declaration, diagnostics } = declare('none');
    expect(diagnostics).toEqual([]);
    expect(declaration?.longhands).toEqual([{ property: 'background-color', value: { kind: 'keyword', value: 'transparent' }, explicit: false }]);
  });

  const initialForms = [
    'none red', 'red none', '0% 0% red', 'left top red', 'top left red', 'left 0% top 0% red', 'top 0% left red', '0% 0% / auto red',
    'left top / auto auto red', 'repeat red', 'repeat repeat red', 'scroll red', 'padding-box border-box red',
    'none repeat scroll 0% 0% / auto padding-box border-box red', 'red padding-box scroll border-box',
  ];
  for (const value of initialForms) {
    it(`background: ${value} spells out only initial values, so it compiles to the colour`, () => {
      const { declaration, diagnostics } = declare(value);
      expect(diagnostics).toEqual([]);
      expect(declaration?.longhands).toEqual([{ property: 'background-color', value: { kind: 'color', value: { r: 255, g: 0, b: 0, alpha: 255 }, syntax: 'named-color' }, explicit: true }]);
    });
  }

  it('CSS-wide keywords set background-color to the keyword', () => {
    for (const wide of ['inherit', 'initial', 'unset', 'revert', 'revert-layer']) {
      const { declaration, diagnostics } = declare(wide);
      expect(diagnostics).toEqual([]);
      expect(declaration?.longhands).toEqual([{ property: 'background-color', value: { kind: 'keyword', value: wide }, explicit: true }]);
    }
  });
});

describe('background shorthand: refusals', () => {
  // [value, the span the diagnostic points at, the longhands the message names]
  const unsupported: [string, string, string[]][] = [
    ['url(a.png) red', 'url(a.png)', ['background-image']],
    ['linear-gradient(red, blue)', 'linear-gradient(red, blue)', ['background-image']],
    ['image-set("a.png" 1x)', 'image-set("a.png" 1x)', ['background-image']],
    ['center red', 'center', ['background-position-x', 'background-position-y']],
    ['left red', 'left', ['background-position-y']],
    ['top red', 'top', ['background-position-x']],
    ['0% red', '0%', ['background-position-y']],
    ['0 0 red', '0 0', ['background-position-x', 'background-position-y']],
    ['0px 0% red', '0px 0%', ['background-position-x']],
    ['right bottom red', 'right bottom', ['background-position-x', 'background-position-y']],
    ['left 5px top red', 'left 5px top', ['background-position-x']],
    ['0% 0% / cover red', '/ cover', ['background-size']],
    ['0% 0% / 10px auto red', '/ 10px auto', ['background-size']],
    ['no-repeat red', 'no-repeat', ['background-repeat']],
    ['repeat-x red', 'repeat-x', ['background-repeat']],
    ['repeat space red', 'repeat space', ['background-repeat']],
    ['fixed red', 'fixed', ['background-attachment']],
    ['local red', 'local', ['background-attachment']],
    ['padding-box red', 'padding-box', ['background-clip']],
    ['border-box red', 'border-box', ['background-origin']],
    ['content-box red', 'content-box', ['background-origin', 'background-clip']],
    ['border-box padding-box red', 'border-box padding-box', ['background-origin', 'background-clip']],
    ['none, red', 'none, red', Object.keys(BACKGROUND_RESET_LONGHANDS)],
    ['url(a.png), url(b.png) red', 'url(a.png), url(b.png) red', Object.keys(BACKGROUND_RESET_LONGHANDS)],
  ];
  for (const [value, span, longhands] of unsupported) {
    it(`background: ${value} is DRAGON_UNSUPPORTED_VALUE naming ${longhands.join(', ')}`, () => {
      const { declaration, diagnostics, css } = declare(value);
      expect(declaration).toBeNull();
      expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      const d = diagnostics[0] as Diagnostic;
      expect(spanOf(css, d)).toBe(span);
      expect(d.message.startsWith(`background: "${span}" `)).toBe(true);
      for (const l of longhands) expect(d.message).toContain(`${l} (initial ${BACKGROUND_RESET_LONGHANDS[l as keyof typeof BACKGROUND_RESET_LONGHANDS]})`);
      const named = Object.keys(BACKGROUND_RESET_LONGHANDS).filter((l) => d.message.includes(`${l} (initial`));
      expect(named.sort()).toEqual([...longhands].sort());
      expect(d.fix !== null && 'manual' in d.fix && d.fix.manual).toMatch(/background-color/);
      expectCatalogued(diagnostics);
    });
  }

  it('a colour outside the subset is refused on the colour token with the colour fix', () => {
    const { declaration, diagnostics, css } = declare('none lab(50% 40 59)');
    expect(declaration).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    expect(spanOf(css, diagnostics[0] as Diagnostic)).toBe('lab(50% 40 59)');
    expect((diagnostics[0] as Diagnostic).message).toMatch(/^background: lab\(50% 40 59\) is unsupported/);
  });

  it('invalid syntax is DRAGON_CSS_INVALID_VALUE: colour outside the final layer, size without a position, three boxes, two colours', () => {
    for (const value of ['red, none', '/ auto red', 'padding-box border-box content-box', 'red blue', 'red / auto', 'none none', 'scroll fixed']) {
      const { declaration, diagnostics, css } = declare(value);
      expect(declaration, value).toBeNull();
      expect(diagnostics.map((d) => d.code), value).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expect(spanOf(css, diagnostics[0] as Diagnostic)).toBe(value);
      expect((diagnostics[0] as Diagnostic).message).toMatch(/ is not a valid value for background \(@webref\/css grammar\)$/);
    }
  });

  it('!important on background is DRAGON_UNSUPPORTED_IMPORTANT with an edit removing it', () => {
    const { declaration, diagnostics } = declare('red !important');
    expect(declaration).toBeNull();
    expect(diagnostics.map((d) => [d.code, d.message])).toEqual([['DRAGON_UNSUPPORTED_IMPORTANT', '!important on background is not supported']]);
  });

  it('a refused background blocks both targets through the public compile', () => {
    const css = '.a { width: 10px; height: 10px; background: url(a.png) red; }';
    const input = inputFor(css, (r) => [div(r, 'a', ['a'])]);
    const c = createProject({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' } } }).compile(input);
    expect(c.ok).toBe(false);
    expect(c.outputs.web.kind).toBe('blocked');
    expect(c.outputs.ios.kind).toBe('blocked');
    const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE') as Diagnostic;
    expect(spanTextOf(input, d)).toBe('url(a.png)');
    expectCatalogued(c.diagnostics);
  });
});

describe('background shorthand: cascade', () => {
  const derive = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });
  const colorOf = (css: string, id = 'a', tree = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'a', ['a', 'b'], [div(r, 'c', ['c'])])]) => {
    const c = derive().compile(inputFor(css, tree));
    expect(c.diagnostics).toEqual([]);
    return { c, color: resolvedColors(c, [])?.get(id)?.['background-color'] };
  };

  it('a later background-color overrides the shorthand; the shorthand overrides an earlier longhand', () => {
    expect(colorOf('.a { background: red; background-color: blue; }').color).toEqual({ r: 0, g: 0, b: 255, alpha: 255 });
    expect(colorOf('.a { background-color: blue; background: red; }').color).toEqual({ r: 255, g: 0, b: 0, alpha: 255 });
    expect(colorOf('.a { background-color: blue; } .b { background: none; }').color).toEqual({ r: 0, g: 0, b: 0, alpha: 0 });
    expect(colorOf('.a.b { background-color: blue; } .b { background: red; }').color).toEqual({ r: 0, g: 0, b: 255, alpha: 255 });
  });

  it('background: none resets background-color to its initial value by provenance', () => {
    const { c } = colorOf('.a { background-color: blue; background: none; }');
    expect(explainOne(c, 'ios', 'a', 'background-color')).toMatchObject({ value: 'transparent', cascade: 'author' });
  });

  it('background is not inherited: a child keeps transparent', () => {
    expect(colorOf('.a { background: red; }', 'c').color).toEqual({ r: 0, g: 0, b: 0, alpha: 0 });
    expect(colorOf('.a { background: red; } .c { background: inherit; }', 'c').color).toEqual({ r: 255, g: 0, b: 0, alpha: 255 });
  });

  it('currentcolor in the shorthand resolves against the element colour', () => {
    expect(colorOf('.a { color: #102030; background: currentcolor; }').color).toEqual({ r: 16, g: 32, b: 48, alpha: 255 });
  });
});
