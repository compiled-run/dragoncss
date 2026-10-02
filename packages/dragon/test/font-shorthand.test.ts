// TXT-W2 (T147 part 2): the font and font-synthesis shorthands' expansion, CSS-wide keywords and refusals. Their agreement with
// Chrome is packages/parity/test/font-shorthand.test.ts.
import { describe, expect, it } from 'vitest';
import { valueToString } from '../src/analysis/resolve.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };

function longhands(decl: string): { set: string[]; codes: string[] } {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const set = (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}=${valueToString(l.value)}${l.explicit ? '' : ' (reset)'}`);
  return { set, codes: diagnostics.map((d) => d.code) };
}

describe('the font shorthand', () => {
  it('sets style, weight, size, line height and family, resetting what the value omits, and never font-synthesis', () => {
    expect(longhands('font: 12px x').set).toEqual(['font-style=normal (reset)', 'font-weight=normal (reset)', 'font-size=12px', 'line-height=normal (reset)', 'font-family=x']);
    expect(longhands('font: oblique 20deg 600 12px/1.5 "a b", serif').set).toEqual(['font-style=oblique 20deg', 'font-weight=600', 'font-size=12px', 'line-height=1.5', 'font-family="a b" , serif']);
    expect(longhands('font: normal bold normal 2em x').set).toEqual(['font-style=normal (reset)', 'font-weight=bold', 'font-size=2em', 'line-height=normal (reset)', 'font-family=x']);
  });
  it('a CSS-wide keyword sets each modelled longhand', () => {
    for (const k of ['inherit', 'initial', 'unset']) expect(longhands(`font: ${k}`).set, k).toEqual(['font-style', 'font-weight', 'font-size', 'line-height', 'font-family'].map((p) => `${p}=${k}`));
  });
  it('refuses small-caps, a width and the system fonts; drops what Chrome does not parse', () => {
    for (const v of ['small-caps 12px x', 'condensed 12px x', 'caption', 'status-bar', 'oblique 2turn 12px x']) expect(longhands(`font: ${v}`).codes, v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    for (const v of ['left 12px x', 'oblique 91deg 12px x', '12px', 'x', '0 12px x']) expect(longhands(`font: ${v}`).codes, v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
});

describe('font-synthesis', () => {
  it('none, or the listed kinds on and the rest off; position and oblique-only are not Chrome values', () => {
    expect(longhands('font-synthesis: none').set).toEqual(['font-synthesis-weight=none', 'font-synthesis-style=none', 'font-synthesis-small-caps=none']);
    expect(longhands('font-synthesis: style weight').set).toEqual(['font-synthesis-weight=auto', 'font-synthesis-style=auto', 'font-synthesis-small-caps=none']);
    expect(longhands('font-synthesis: weight position').codes).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(longhands('font-synthesis-style: oblique-only').codes).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
});
