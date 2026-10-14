// resize (css-ui-4 §5.1): a longhand appended after text-transform, not inherited, with no layout or paint aspect. Chrome 145 parses
// none, both, horizontal, vertical, block, inline and auto (CSSResizeAuto), and computes auto to both. Chrome draws a resizer only on
// a scroll container or an iframe, so native refuses any other value than none there and compiles every value elsewhere.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { RESIZE_LONGHANDS } from '../src/css/properties/resize.ts';
import { TEXT_TRANSFORM_LONGHANDS } from '../src/css/properties/text-transform.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { ElementNode, Targets } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, text } from './helpers.ts';

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

describe('resize: native refuses it on a scroll container or an iframe', () => {
  it('any value but none on an overflow hidden, auto or scroll box is refused on ios and android, at the declaration, and compiles for web', () => {
    for (const [overflow, v] of [['hidden', 'both'], ['auto', 'vertical'], ['scroll', 'auto'], ['visible hidden', 'horizontal']] as const) {
      const css = `.a { overflow: ${overflow}; resize: ${v}; }`;
      const c = compile(css, NATIVE);
      const errs = errors(c);
      expect(errs.map((d) => [d.code, d.target]).sort(), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android'], ['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      const computed = v === 'auto' ? 'both' : v;
      expect(errs.find((d) => d.target === 'ios')?.message, css).toBe(`the scroll container a has resize ${computed}, so Chrome draws a resizer on it that the user can drag; ios draws no resizer, so Dragon compiles resize on a scroll container or an iframe at none only`);
      expect(c.outputs.web.kind, css).toBe('ready');
      expect(c.outputs.ios.kind, css).toBe('blocked');
      expectCatalogued(errs);
    }
  });

  it('none on a scroll container, and any value on an overflow clip or visible box, compiles', () => {
    for (const css of ['.a { overflow: hidden; resize: none; }', '.a { overflow: clip; resize: both; }', '.a { resize: both; }', '.a { resize: both; } .b { overflow: hidden; }']) {
      expect(errors(compile(css, NATIVE)), css).toEqual([]);
    }
  });

  it('a resize the cascade drops to none compiles; one the child inherits onto its scroll container is refused there only', () => {
    expect(errors(compile('.a { overflow: auto; resize: both; } .a { resize: none; }', NATIVE))).toEqual([]);
    const c = compile('.a { resize: both; } .b { overflow: hidden; resize: inherit; }', NATIVE);
    expect(errors(c).map((d) => d.message.slice(0, 27))).toEqual(['the scroll container b has ', 'the scroll container b has ']);
  });

  it('the root, whose overflow goes to the viewport, is no scroll container', () => {
    const input = inputFor('html { overflow: hidden; resize: both; } body { margin: 0; }', (r) => [div(r, 'a', ['a'])]);
    const c = createProjectWith({ projectId: 'test', targets: NATIVE }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
    expect(errors(c).filter((d) => d.message.includes('resize'))).toEqual([]);
  });

  it('an iframe with any value but none is refused on native', () => {
    const c = compile('.a { display: block; width: 100px; height: 50px; resize: both; }', NATIVE, 'iframe');
    expect(errors(c).filter((d) => d.message.includes('resize')).map((d) => [d.target, d.message.slice(0, 33)]).sort()).toEqual([['android', 'the iframe a has resize both, so '], ['ios', 'the iframe a has resize both, so ']]);
  });
});
