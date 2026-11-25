// resize (css-ui-4 §5.1): a longhand appended after text-transform, not inherited, with no layout or paint aspect. Chrome 145 parses
// none, both, horizontal, vertical, block, inline and auto (CSSResizeAuto), and computes auto to both. Desktop Chrome draws a resizer
// only on a scroll container or an iframe; a phone draws none, so native compiles every value everywhere and does nothing with it.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { RESIZE_LONGHANDS } from '../src/css/properties/resize.ts';
import { TEXT_TRANSFORM_LONGHANDS } from '../src/css/properties/text-transform.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { ElementNode, Targets } from '../src/types.ts';
import { div, explainOne, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/rz.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function parse(value: string): Diagnostic[] {
  const css = `.a { resize: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return diagnostics;
}

function compile(css: string, targets: Targets = { web: {} }, tag = 'div') {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [{ ...div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])]), tag } as ElementNode]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

const errors = (c: ReturnType<typeof compile>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');

describe('resize: registry and parse', () => {
  it('follows text-transform, last, not inherited, with no layout or paint aspect, discrete, initial none', () => {
    expect([...RESIZE_LONGHANDS]).toEqual(['resize']);
    expect(LONGHANDS[LONGHANDS.indexOf('resize') - 1]).toBe(TEXT_TRANSFORM_LONGHANDS[TEXT_TRANSFORM_LONGHANDS.length - 1]);
    expect(INHERITED.has('resize')).toBe(false);
    expect(PROPERTY_ASPECTS['resize']).toEqual({ layout: false, paint: false });
    expect(ANIMATION_KINDS['resize']).toBe(DISCRETE);
    expect(grammar['resize']?.initial).toBe('none');
  });

  it('parses the seven keywords Chrome 145 parses, in any case, and the CSS-wide keywords; the rest is invalid', () => {
    for (const v of ['none', 'both', 'horizontal', 'vertical', 'block', 'inline', 'auto', 'BOTH', 'Vertical', 'inherit', 'initial', 'unset', 'revert']) expect(parse(v), v).toEqual([]);
    for (const v of ['x', 'y', 'resize', '1px', 'both none', 'textarea']) expect(parse(v).map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
});

describe('resize: computed values', () => {
  for (const [css, a, b] of [
    ['.a { resize: vertical; }', 'vertical', 'none'],
    ['.a { resize: auto; } .b { resize: inherit; }', 'both', 'both'],
    ['.a { resize: AUTO; } .b { resize: block; }', 'both', 'block'],
    ['.a { resize: inline; } .b { resize: unset; }', 'inline', 'none'],
    ['.a { --r: horizontal; resize: var(--r); } .b { resize: initial; }', 'horizontal', 'none'],
  ] as const) {
    it(`${css} computes ${a} and ${b}, and compiles on every target`, () => {
      const c = compile(css, NATIVE);
      expect(errors(c)).toEqual([]);
      expect(explainOne(c, 'web', 'a', 'resize').value).toBe(a);
      expect(explainOne(c, 'web', 'b', 'resize').value).toBe(b);
      expect(c.outputs.ios.kind).not.toBe('blocked');
      expect(c.outputs.android.kind).not.toBe('blocked');
    });
  }
});

describe('resize: a phone has no resizer, so native accepts it on a scroll container or an iframe and does nothing', () => {
  // The planner's ruling (Markless #974): Chrome on Android and Safari on iOS draw no resize handle, so iOS and Android accept the
  // declaration wherever desktop Chrome would draw a resizer, and lower the box exactly as at resize: none.
  const programs = (c: ReturnType<typeof compile>) => {
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };

  it('every value on an overflow hidden, auto or scroll box compiles on ios and android, with the native programs of resize: none', () => {
    for (const [overflow, v] of [['hidden', 'both'], ['auto', 'vertical'], ['scroll', 'auto'], ['visible hidden', 'horizontal'], ['auto', 'block'], ['auto', 'inline']] as const) {
      const css = `.a { overflow: ${overflow}; resize: ${v}; }`;
      const c = compile(css, NATIVE);
      expect(errors(c), css).toEqual([]);
      expect([c.outputs.web.kind, c.outputs.ios.kind, c.outputs.android.kind], css).toEqual(['ready', 'analysis-only', 'analysis-only']);
      expect(explainOne(c, 'web', 'a', 'resize').value, css).toBe(v === 'auto' ? 'both' : v);
      expect(programs(c), css).toEqual(programs(compile(`.a { overflow: ${overflow}; resize: none; }`, NATIVE)));
    }
  });

  it('a resize the child inherits onto its scroll container compiles, and lowers as without it', () => {
    const c = compile('.a { resize: both; } .b { overflow: hidden; resize: inherit; }', NATIVE);
    expect(errors(c)).toEqual([]);
    expect(programs(c)).toEqual(programs(compile('.b { overflow: hidden; }', NATIVE)));
  });

  it('an iframe with any value but none compiles on native', () => {
    const c = compile('.a { display: block; width: 100px; height: 50px; resize: both; }', NATIVE, 'iframe');
    expect(errors(c).filter((d) => d.message.includes('resize'))).toEqual([]);
  });
});
