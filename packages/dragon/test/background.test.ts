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

const LAYER_LONGHANDS = ['background-image', 'background-position-x', 'background-position-y', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'];
const initialLayers = (): unknown[] => [
  { property: 'background-image', value: { kind: 'keyword', value: 'none' }, explicit: false },
  { property: 'background-position-x', value: { kind: 'percentage', value: 0 }, explicit: false },
  { property: 'background-position-y', value: { kind: 'percentage', value: 0 }, explicit: false },
  { property: 'background-size', value: { kind: 'keyword', value: 'auto' }, explicit: false },
  { property: 'background-repeat', value: { kind: 'keyword', value: 'repeat' }, explicit: false },
  { property: 'background-attachment', value: { kind: 'keyword', value: 'scroll' }, explicit: false },
  { property: 'background-origin', value: { kind: 'keyword', value: 'padding-box' }, explicit: false },
  { property: 'background-clip', value: { kind: 'keyword', value: 'border-box' }, explicit: false },
];
const byProperty = (d: Declaration | null): Record<string, { value: unknown; explicit: boolean }> => Object.fromEntries((d?.longhands ?? []).map((l) => [l.property, { value: l.value, explicit: l.explicit }]));

describe('background shorthand: parse and expansion', () => {
  it('lists the eight non-colour longhands with their initial values as Chrome 145 serializes them', () => {
    expect(BACKGROUND_RESET_LONGHANDS).toEqual({
      'background-image': 'none', 'background-position-x': '0%', 'background-position-y': '0%', 'background-size': 'auto',
      'background-repeat': 'repeat', 'background-attachment': 'scroll', 'background-origin': 'padding-box', 'background-clip': 'border-box',
    });
    expect(Object.keys(BACKGROUND_RESET_LONGHANDS)).toEqual(LAYER_LONGHANDS);
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
    it(`background: ${value} sets background-color explicitly and every layer longhand to its initial value`, () => {
      const { declaration, diagnostics } = declare(value);
      expect(diagnostics).toEqual([]);
      expect(declaration?.property).toBe('background');
      expect(declaration?.longhands).toEqual([...initialLayers(), { property: 'background-color', value: expected, explicit: true }]);
    });
  }

  it('background: none sets background-image explicitly and fills background-color with its initial transparent', () => {
    const { declaration, diagnostics } = declare('none');
    expect(diagnostics).toEqual([]);
    expect(declaration?.longhands).toEqual([
      { property: 'background-image', value: { kind: 'keyword', value: 'none' }, explicit: true },
      ...initialLayers().slice(1),
      { property: 'background-color', value: { kind: 'keyword', value: 'transparent' }, explicit: false },
    ]);
  });

  // [value, the explicit layer longhands and their values]
  const components: [string, Record<string, unknown>][] = [
    ['left top red', { 'background-position-x': { kind: 'keyword', value: 'left' }, 'background-position-y': { kind: 'keyword', value: 'top' } }],
    ['top red', { 'background-position-x': { kind: 'keyword', value: 'center' }, 'background-position-y': { kind: 'keyword', value: 'top' } }],
    ['10px 25% red', { 'background-position-x': { kind: 'length', value: 10, unit: 'px' }, 'background-position-y': { kind: 'percentage', value: 25 } }],
    ['left 5px top 3px red', { 'background-position-x': { kind: 'other', type: 'position-x', text: 'left 5px' }, 'background-position-y': { kind: 'other', type: 'position-y', text: 'top 3px' } }],
    ['0% 0% / cover red', { 'background-position-x': { kind: 'percentage', value: 0 }, 'background-position-y': { kind: 'percentage', value: 0 }, 'background-size': { kind: 'keyword', value: 'cover' } }],
    ['0 0 / 10px auto red', { 'background-position-x': { kind: 'length', value: 0, unit: 'px' }, 'background-position-y': { kind: 'length', value: 0, unit: 'px' }, 'background-size': { kind: 'other', type: 'size', text: '10px auto' } }],
    ['no-repeat red', { 'background-repeat': { kind: 'keyword', value: 'no-repeat' } }],
    ['repeat-x red', { 'background-repeat': { kind: 'keyword', value: 'repeat-x' } }],
    ['padding-box red', { 'background-origin': { kind: 'keyword', value: 'padding-box' }, 'background-clip': { kind: 'keyword', value: 'padding-box' } }],
    ['border-box content-box red', { 'background-origin': { kind: 'keyword', value: 'border-box' }, 'background-clip': { kind: 'keyword', value: 'content-box' } }],
    ['scroll red', { 'background-attachment': { kind: 'keyword', value: 'scroll' } }],
    ['linear-gradient(red, blue)', { 'background-image': { kind: 'other', type: 'linear-gradient()', text: 'linear-gradient(red,blue)' } }],
  ];
  for (const [value, set] of components) {
    it(`background: ${value} sets exactly its components explicitly`, () => {
      const { declaration, diagnostics } = declare(value);
      expect(diagnostics).toEqual([]);
      const got = byProperty(declaration);
      for (const l of LAYER_LONGHANDS) {
        expect(got[l]?.explicit, l).toBe(l in set);
        if (l in set) expect(got[l]?.value, l).toEqual(set[l]);
      }
    });
  }

  it('expands the music player\'s two-layer record background into a list per longhand', () => {
    const { declaration, diagnostics } = declare('radial-gradient(circle at center, #343b47 0 8%, #0b0d12 8.5% 12%, transparent 12.5%), repeating-radial-gradient(circle at center, #141820 0 7px, #080a0e 8px 12px)');
    expect(diagnostics).toEqual([]);
    const got = byProperty(declaration);
    expect(got['background-image']).toEqual({ explicit: true, value: { kind: 'other', type: 'list', text: 'radial-gradient(circle at center,#343b47 0 8%,#0b0d12 8.5% 12%,transparent 12.5%), repeating-radial-gradient(circle at center,#141820 0 7px,#080a0e 8px 12px)' } });
    expect(got['background-position-x']).toEqual({ explicit: false, value: { kind: 'other', type: 'list', text: '0%, 0%' } });
    expect(got['background-clip']).toEqual({ explicit: false, value: { kind: 'other', type: 'list', text: 'border-box, border-box' } });
    expect(got['background-color']).toEqual({ explicit: false, value: { kind: 'keyword', value: 'transparent' } });
  });

  it('CSS-wide keywords set every longhand to the keyword', () => {
    for (const wide of ['inherit', 'initial', 'unset', 'revert', 'revert-layer']) {
      const { declaration, diagnostics } = declare(wide);
      expect(diagnostics).toEqual([]);
      expect(declaration?.longhands).toEqual([...LAYER_LONGHANDS, 'background-color'].map((property) => ({ property, value: { kind: 'keyword', value: wide }, explicit: true })));
    }
  });
});

describe('background layer longhands and background-position', () => {
  const declareAs = (property: string, value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; css: string } => {
    const css = `.a { ${property}: ${value}; }`;
    const diagnostics: Diagnostic[] = [];
    const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
    return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, css };
  };
  it('each longhand takes a comma-separated list, one item per layer', () => {
    expect(declareAs('background-image', 'linear-gradient(red, blue), none').declaration?.longhands).toEqual([{ property: 'background-image', value: { kind: 'other', type: 'list', text: 'linear-gradient(red,blue), none' }, explicit: true }]);
    expect(declareAs('background-size', '50% auto').declaration?.longhands).toEqual([{ property: 'background-size', value: { kind: 'other', type: 'size', text: '50% auto' }, explicit: true }]);
    expect(declareAs('background-repeat', 'repeat no-repeat, repeat-y').declaration?.longhands).toEqual([{ property: 'background-repeat', value: { kind: 'other', type: 'list', text: 'repeat no-repeat, repeat-y' }, explicit: true }]);
    expect(declareAs('background-clip', 'content-box').declaration?.longhands).toEqual([{ property: 'background-clip', value: { kind: 'keyword', value: 'content-box' }, explicit: true }]);
  });
  it('background-position sets both position longhands, per layer', () => {
    expect(declareAs('background-position', 'right 30%, 10px').declaration?.longhands).toEqual([
      { property: 'background-position-x', value: { kind: 'other', type: 'list', text: 'right, 10px' }, explicit: true },
      { property: 'background-position-y', value: { kind: 'other', type: 'list', text: '30%, center' }, explicit: true },
    ]);
  });
});

describe('background shorthand: refusals', () => {
  // [property, value, the span the diagnostic points at, a part of its reason]
  const unsupported: [string, string, string, string][] = [
    ['background', 'url(a.png) red', 'url(a.png)', 'REPL'],
    ['background', 'image-set("a.png" 1x)', 'image-set("a.png" 1x)', 'BG2b'],
    ['background', 'conic-gradient(red, blue)', 'conic-gradient(red, blue)', 'BG2b'],
    ['background', 'linear-gradient(in oklab, red, blue)', 'linear-gradient(in oklab, red, blue)', 'BG2b'],
    ['background', 'linear-gradient(red, 30%, blue)', '30%', 'BG2b'],
    ['background', 'linear-gradient(red 1em, blue)', '1em', 'BG2c'],
    ['background', 'radial-gradient(circle calc(10px + 5%), red, blue)', 'calc(10px + 5%)', 'BG2c'],
    ['background', 'right 10px top red', '10px', 'BG2c'],
    ['background', 'repeat space red', 'space', 'BG2c'],
    ['background', 'round red', 'round', 'BG2c'],
    ['background', 'fixed red', 'fixed', 'BG2b'],
    ['background', 'local red', 'local', 'BG2b'],
    ['background', 'text red', 'text', 'BG2c'],
    ['background-image', 'url(a.png), linear-gradient(red, blue)', 'url(a.png)', 'REPL'],
    ['background-position-x', 'right 5px', '5px', 'BG2c'],
    ['background-size', '2em', '2em', 'BG2c'],
    ['background-attachment', 'scroll, fixed', 'fixed', 'BG2b'],
  ];
  for (const [property, value, span, reason] of unsupported) {
    it(`${property}: ${value} is DRAGON_UNSUPPORTED_VALUE at ${span} (${reason})`, () => {
      const css = `.a { ${property}: ${value}; }`;
      const diagnostics: Diagnostic[] = [];
      const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
      expect(rules[0]?.declarations).toEqual([]);
      expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      const d = diagnostics[0] as Diagnostic;
      expect(spanOf(css, d)).toBe(span);
      expect(d.message).toContain(reason);
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

  it('!important on background is accepted and marks the declaration important (css-cascade-5 §6.4; parity background-important)', () => {
    const { declaration, diagnostics } = declare('red !important');
    expect(diagnostics).toEqual([]);
    expect(declaration?.important).toBe(true);
    expect(declaration?.longhands.find((l) => l.property === 'background-color')?.value).toMatchObject({ kind: 'color' });
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
