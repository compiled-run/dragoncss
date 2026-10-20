// css-writing-modes-4 §2.2: unicode-bidi is a longhand appended after color-scheme, not inherited, with a layout aspect, parsed from
// webref's grammar (Chrome 145's six keywords). Web compiles every value; iOS and Android compile an author value only where Chrome's
// UAX #9 run order is the one normal gives (analysis/bidi.ts). The Chrome cases are fixture-groups/bidi.ts.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Targets } from '../src/types.ts';
import type { TreeNode } from '../src/internal.ts';
import { div, expectCatalogued, explainOne, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/ub.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function parse(value: string): Diagnostic[] {
  const css = `.a { unicode-bidi: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return diagnostics;
}

/** <div a><div b>XX <span s>YY</span> ZZ</div></div>, with the b text given. */
function compile(css: string, targets: Targets = { web: {} }, words = 'XX ', direction: 'ltr' | 'rtl' = 'ltr') {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [
    text(r, 't0', words), { ...(div(r, 's', ['s'], [text(r, 't1', 'YY')]) as object), tag: 'span' } as TreeNode, text(r, 't2', ' ZZ'),
  ])])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction }).compile(input);
}

const errors = (c: ReturnType<typeof compile>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');
const VALUES = ['normal', 'embed', 'isolate', 'bidi-override', 'isolate-override', 'plaintext'] as const;

describe('unicode-bidi: registry and parse', () => {
  it('is the last longhand, not inherited, with a layout aspect, initial normal, discrete in animations', () => {
    expect(LONGHANDS[LONGHANDS.length - 1]).toBe('unicode-bidi');
    expect(LONGHANDS[LONGHANDS.length - 2]).toBe('color-scheme');
    expect(INHERITED.has('unicode-bidi')).toBe(false);
    expect(PROPERTY_ASPECTS['unicode-bidi']).toEqual({ layout: true, paint: false });
    expect(grammar['unicode-bidi']?.initial).toBe('normal');
    expect(ANIMATION_KINDS['unicode-bidi']).toBe(DISCRETE);
  });
  it('parses the six keywords in any case and the CSS-wide keywords; anything else is invalid', () => {
    for (const v of [...VALUES, 'ISOLATE', 'Plaintext', 'inherit', 'initial', 'unset', 'revert']) expect(parse(v), v).toEqual([]);
    for (const v of ['auto', 'override', 'isolate embed', '1px', 'ltr']) expect(parse(v).map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
});

describe('unicode-bidi: web compiles every value as specified', () => {
  for (const v of VALUES) {
    it(v, () => {
      const c = compile(`.b { unicode-bidi: ${v}; } .s { unicode-bidi: ${v}; }`, NATIVE, 'XX ', 'rtl');
      expect(c.outputs.web.kind).toBe('ready');
      expect(explainOne(c, 'web', 'b', 'unicode-bidi').value).toBe(v);
      expect(explainOne(c, 'web', 's', 'unicode-bidi').value).toBe(v);
    });
  }
  it('is not inherited: a child of an isolate takes normal', () => {
    expect(explainOne(compile('.a { unicode-bidi: plaintext; }'), 'web', 'b', 'unicode-bidi').value).toBe('isolate');
    expect(explainOne(compile('.a { display: inline; unicode-bidi: plaintext; } .b { display: inline; }'), 'web', 's', 'unicode-bidi').value).toBe('normal');
  });
});

describe('unicode-bidi: native compiles it where Chrome reorders nothing', () => {
  it('every value on ltr Latin text, on a block and on an inline box', () => {
    for (const v of VALUES) {
      const c = compile(`.b { unicode-bidi: ${v}; } .s { unicode-bidi: ${v}; }`, NATIVE);
      expect(errors(c), v).toEqual([]);
      expect(c.outputs.ios.kind, v).not.toBe('blocked');
    }
  });
  it('normal, embed and isolate on a block in an rtl context', () => {
    for (const v of ['normal', 'embed', 'isolate']) expect(errors(compile(`.b { unicode-bidi: ${v}; } .s { unicode-bidi: normal; }`, NATIVE, 'XX ', 'rtl')), v).toEqual([]);
  });
  it('refuses on iOS and Android, at the declaration, an inline value in an rtl context and an override or plaintext block there', () => {
    for (const [css, id] of [['.s { unicode-bidi: isolate; }', 's'], ['.s { unicode-bidi: embed; }', 's'], ['.b { unicode-bidi: bidi-override; }', 'b'], ['.b { unicode-bidi: plaintext; }', 'b'], ['.b { unicode-bidi: isolate-override; }', 'b']] as const) {
      const c = compile(css, NATIVE, 'XX ', 'rtl');
      const errs = errors(c);
      expect(errs.map((d) => [d.code, d.target]), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios'], ['DRAGON_UNSUPPORTED_VALUE', 'android']]);
      expect(errs[0]?.message.startsWith(`unicode-bidi: ${css.slice(css.indexOf(': ') + 2, -3)} on <${id === 's' ? 'span' : 'div'}> ${id} can reorder its text in Chrome`), css).toBe(true);
      expect(c.outputs.web.kind, css).toBe('ready');
      expectCatalogued(errs);
    }
  });
  it('refuses an ltr box with an rtl parent, an ltr paragraph that holds a right-to-left character, and an inline box in another', () => {
    expect(errors(compile('.b { direction: rtl; } .s { direction: ltr; unicode-bidi: isolate; }', NATIVE)).length).toBe(2);
    expect(errors(compile('.s { unicode-bidi: isolate; }', NATIVE, '\u05D0 ')).length).toBe(2);
    expect(errors(compile('.b { unicode-bidi: plaintext; }', NATIVE, '\u200F')).length).toBe(2);
    expect(errors(compile('.b { display: inline; } .s { unicode-bidi: embed; }', NATIVE)).length).toBe(2);
  });
  it('never refuses the UA isolate of a block, nor a value that loses the cascade', () => {
    expect(errors(compile('.b { display: inline; }', NATIVE, 'XX ', 'rtl'))).toEqual([]);
    expect(errors(compile('.s { unicode-bidi: isolate; } .s { unicode-bidi: normal; }', NATIVE, 'XX ', 'rtl'))).toEqual([]);
  });
});
