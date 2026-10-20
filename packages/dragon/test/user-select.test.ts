// T154 (css-ui-4 §6.1): user-select is a longhand appended after visibility, inherited as Blink declares it, with no layout or
// paint aspect. Chrome 145 parses auto, text, none and all (contain only under a test-status flag). Unenforced, web compiles all
// four, and iOS and Android compile none and any value whose used value is the default's (analysis/selection.ts); the rest wait for
// package P6c (T077) to build selection.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { SELECTION_LONGHANDS } from '../src/css/properties/selection.ts';
import { FLOAT_LONGHANDS } from '../src/css/properties/float.ts';
import { SVG_LONGHANDS } from '../src/css/properties/svg.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Targets } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/us.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function parse(value: string): Diagnostic[] {
  const css = `.a { user-select: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return diagnostics;
}

function compile(css: string, targets: Targets = { web: {} }) {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

const errors = (c: ReturnType<typeof compile>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');

describe('user-select: registry and parse', () => {
  it('follows the float family and precedes the svg family, inherited, with no layout or paint aspect, initial auto', () => {
    expect([...SELECTION_LONGHANDS]).toEqual(['user-select']);
    // FAMILIES runs visibility, inline, float, selection, svg (properties.ts).
    expect(LONGHANDS[LONGHANDS.indexOf('user-select') - 1]).toBe(FLOAT_LONGHANDS[FLOAT_LONGHANDS.length - 1]);
    expect(LONGHANDS[LONGHANDS.indexOf('user-select') + 1]).toBe(SVG_LONGHANDS[0]);
    expect(INHERITED.has('user-select')).toBe(true);
    expect(PROPERTY_ASPECTS['user-select']).toEqual({ layout: false, paint: false });
    expect(grammar['user-select']?.initial).toBe('auto');
  });

  it('parses the four keywords Chrome 145 parses, in any case, and the CSS-wide keywords; contain and the rest are invalid', () => {
    for (const v of ['auto', 'text', 'none', 'all', 'NONE', 'Text', 'inherit', 'initial', 'unset', 'revert']) expect(parse(v), v).toEqual([]);
    for (const v of ['contain', 'element', '1px', 'none text']) expect(parse(v).map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
});

describe('user-select: web computes every value as specified and inherits it', () => {
  for (const [css, a, b] of [
    ['.a { user-select: none; }', 'none', 'none'],
    ['.a { user-select: text; }', 'text', 'text'],
    ['.a { user-select: all; } .b { user-select: auto; }', 'all', 'auto'],
    ['.a { user-select: none; } .b { user-select: initial; }', 'none', 'auto'],
    ['.a { -webkit-user-select: none; }', 'none', 'none'],
    ['.a { user-select: none; -webkit-user-select: text; }', 'text', 'text'],
  ] as const) {
    it(css, () => {
      const c = compile(css);
      expect(errors(c)).toEqual([]);
      expect(explainOne(c, 'web', 'a', 'user-select').value).toBe(a);
      expect(explainOne(c, 'web', 'b', 'user-select').value).toBe(b);
    });
  }
});

describe('user-select: native compiles none and the values that change nothing (P6c)', () => {
  it('none, through the alias, var(), inherit and unset from none, compiles on ios and android', () => {
    for (const css of ['.a { user-select: none; }', '.a { -webkit-user-select: NONE; }', '.a { --u: none; user-select: var(--u); }', '.a { user-select: none; } .b { user-select: inherit; }', '.a { user-select: none; } .b { user-select: unset; }']) {
      const c = compile(css, NATIVE);
      expect(errors(c), css).toEqual([]);
      expect(c.outputs.ios.kind, css).not.toBe('blocked');
      expect(c.outputs.android.kind, css).not.toBe('blocked');
    }
  });

  it('auto, initial, text, inherit or unset under a text parent compile on ios and android: their used value is the default\'s', () => {
    for (const css of ['.a { user-select: auto; }', '.a { user-select: initial; }', '.a { user-select: text; }', '.a { user-select: text; } .b { user-select: inherit; }', '.b { user-select: unset; }', '.a { -webkit-user-select: TEXT; } .b { user-select: auto; }']) {
      const c = compile(css, NATIVE);
      expect(errors(c), css).toEqual([]);
      expect(c.outputs.ios.kind, css).not.toBe('blocked');
      expect(c.outputs.android.kind, css).not.toBe('blocked');
    }
  });

  it('text or inherit under none, and all anywhere, are refused on ios and android at the declaration, naming P6c, and compile for web', () => {
    for (const [css, el, k, used, def] of [
      ['.a { user-select: none; } .b { user-select: text; }', 'b', 'text', 'text', 'none'],
      ['.a { user-select: all; }', 'a', 'all', 'all', 'text'],
      ['.a { user-select: none; } .b { user-select: all; }', 'b', 'all', 'all', 'none'],
    ] as const) {
      const c = compile(css, NATIVE);
      const errs = errors(c);
      expect(errs.map((d) => [d.code, d.target]), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios'], ['DRAGON_UNSUPPORTED_VALUE', 'android']]);
      expect(errs[0]?.message, css).toBe(`${el} has user-select ${k}, whose used value in Chrome is ${used} where the default's is ${def}; no ios text is selectable until package P6c (T077) builds selection, so Dragon compiles user-select only where it is none or changes nothing`);
      expect(c.outputs.web.kind, css).toBe('ready');
      expect(c.outputs.ios.kind, css).toBe('blocked');
      expectCatalogued(errs);
    }
  });

  it('auto or initial under none is refused on ios and android: Chrome selects it when a selection starts outside the none subtree', () => {
    for (const css of ['.a { user-select: none; } .b { user-select: auto; }', '.a { user-select: none; } .b { user-select: initial; }', '.a { user-select: none; } .b { -webkit-user-select: auto; }']) {
      const c = compile(css, NATIVE);
      const errs = errors(c);
      expect(errs.map((d) => [d.code, d.target]), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios'], ['DRAGON_UNSUPPORTED_VALUE', 'android']]);
      expect(errs[0]?.message, css).toBe('b has user-select auto, which Chrome selects under a none parent when a selection starts outside it; no ios text is selectable until package P6c (T077) builds selection, so Dragon compiles user-select only where it is none or changes nothing');
      expect(c.outputs.web.kind, css).toBe('ready');
      expectCatalogued(errs);
    }
  });

  it('refuses only the element that declares the value: its inheriting child is not reported again', () => {
    const c = compile('.a { user-select: all; }', NATIVE);
    expect(errors(c).map((d) => d.message.slice(0, 21))).toEqual(['a has user-select all', 'a has user-select all']);
  });

  it('a value that loses the cascade to none compiles; the -webkit- alias that wins is refused', () => {
    expect(errors(compile('.a { user-select: text; } .a { user-select: none; }', NATIVE))).toEqual([]);
    expect(errors(compile('.a { user-select: none; -webkit-user-select: all; }', NATIVE)).map((d) => d.target)).toEqual(['ios', 'android']);
  });
});
