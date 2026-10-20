// GEN-d1 and GEN-d2: counter-reset, counter-increment, counter-set and quotes, appended after the table family with no layout or
// paint aspect. They render only through counter() and quotes in content and through list markers, which stay refused, so every
// value Chrome 145 parses compiles on every target and is kept as written.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { COUNTERS_LONGHANDS } from '../src/css/properties/counters.ts';
import { TABLE_LONGHANDS } from '../src/css/properties/table.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Targets } from '../src/types.ts';
import { div, explainOne, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/ct.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function parse(declaration: string): Diagnostic[] {
  const css = `.a { ${declaration}; }`;
  const diagnostics: Diagnostic[] = [];
  parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return diagnostics;
}

function compile(css: string) {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);
  return createProjectWith({ projectId: 'test', targets: NATIVE }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

const errors = (c: ReturnType<typeof compile>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');

describe('counters and quotes: registry and parse', () => {
  it('follow the table family, only quotes inherited, with no layout or paint aspect, discrete', () => {
    expect(LONGHANDS[LONGHANDS.indexOf('counter-reset') - 1]).toBe(TABLE_LONGHANDS[TABLE_LONGHANDS.length - 1]);
    for (const p of COUNTERS_LONGHANDS) {
      expect(INHERITED.has(p), p).toBe(p === 'quotes');
      expect(PROPERTY_ASPECTS[p], p).toEqual({ layout: false, paint: false });
      expect(ANIMATION_KINDS[p], p).toBe(DISCRETE);
    }
  });

  it('parses what Chrome 145 parses; reversed(), match-parent, a lone quote, a fraction and none before a name are invalid', () => {
    for (const d of ['counter-reset: x', 'counter-reset: x 3 y', 'counter-reset: x none', 'counter-reset: none', 'counter-increment: x -2', 'counter-increment: x calc(1 + 2)',
      'counter-set: x 99999999999', 'quotes: auto', 'quotes: none', 'quotes: "a" "b"', "quotes: '' '' 'c' 'd'", 'counter-reset: inherit']) expect(parse(d), d).toEqual([]);
    for (const d of ['counter-reset: reversed(x)', 'counter-reset: none x', 'counter-reset: x 1.5', 'counter-reset: default', 'quotes: match-parent', 'quotes: "a"', 'quotes: "a" "b" "c"']) {
      expect(parse(d).map((x) => x.code), d).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    }
  });
});

describe('counters and quotes: computed values', () => {
  for (const [css, prop, a, b] of [
    ['.a { counter-reset: x 2 y; }', 'counter-reset', 'x 2 y', 'none'],
    ['.a { counter-increment: x; } .b { counter-increment: inherit; }', 'counter-increment', 'x', 'x'],
    ['.a { quotes: "<" ">"; }', 'quotes', '"<" ">"', '"<" ">"'],
    ['.a { quotes: none; } .b { quotes: initial; }', 'quotes', 'none', 'auto'],
  ] as const) {
    it(`${css} computes ${prop} ${a} and ${b}, and compiles on every target`, () => {
      const c = compile(css);
      expect(errors(c)).toEqual([]);
      expect(explainOne(c, 'web', 'a', prop).value).toBe(a);
      expect(explainOne(c, 'web', 'b', prop).value).toBe(b);
    });
  }

  it('content: counter() and open-quote stay refused', () => {
    expect(errors(compile('.a { counter-reset: x; } .b { content: counter(x); }')).map((d) => d.code)).toContain('DRAGON_UNSUPPORTED_VALUE');
    expect(errors(compile('.a { quotes: "<" ">"; } .b { content: open-quote; }')).map((d) => d.code)).toContain('DRAGON_UNSUPPORTED_VALUE');
  });
});
