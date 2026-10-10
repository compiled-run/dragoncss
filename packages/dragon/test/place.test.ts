// GRID G1c: place-content, place-items and place-self (css/place.ts and the parse driver); the Chrome comparison is
// packages/parity/test/place-computed.test.ts.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { valueToString } from '../src/analysis/resolve.ts';
import { splitPlace } from '../src/css/place.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/place.css', revision: 'r1', hash: 'sha256:0' };

function parse(property: string, value: string): { longhands: string[]; diagnostics: Diagnostic[]; span: string | null } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const d = diagnostics[0];
  const span = d !== undefined && d.origin.kind === 'authored' ? css.slice(d.origin.span.start, d.origin.span.end) : null;
  return { longhands: (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`), diagnostics, span };
}

describe('splitPlace', () => {
  it('splits one or two alignment values, a leading word taking the next', () => {
    expect(splitPlace('place-items', ['center'])).toEqual({ align: ['center'], justify: ['center'] });
    expect(splitPlace('place-items', ['safe', 'center', 'legacy', 'left'])).toEqual({ align: ['safe', 'center'], justify: ['legacy', 'left'] });
    expect(splitPlace('place-self', ['end', 'unsafe', 'start'])).toEqual({ align: ['end'], justify: ['unsafe', 'start'] });
    expect(splitPlace('place-items', [])).toBeNull();
    expect(splitPlace('place-items', ['a', 'b', 'c', 'd', 'e'])).toBeNull();
  });
  it('gives place-content start, not baseline, for justify-content when only a baseline is written', () => {
    expect(splitPlace('place-content', ['baseline'])).toEqual({ align: ['baseline'], justify: ['start'] });
    expect(splitPlace('place-content', ['first', 'baseline'])).toEqual({ align: ['first', 'baseline'], justify: ['start'] });
    expect(splitPlace('place-items', ['baseline'])).toEqual({ align: ['baseline'], justify: ['baseline'] });
  });
});

describe('the parse driver', () => {
  it('expands each place-* shorthand into its two longhands, explicitly', () => {
    expect(parse('place-content', 'space-between center').longhands).toEqual(['align-content: space-between', 'justify-content: center']);
    expect(parse('place-content', 'baseline').longhands).toEqual(['align-content: baseline', 'justify-content: start']);
    expect(parse('place-items', 'END').longhands).toEqual(['align-items: end', 'justify-items: end']);
    expect(parse('place-items', 'center legacy').longhands).toEqual(['align-items: center', 'justify-items: legacy']);
    expect(parse('place-self', 'auto right').longhands).toEqual(['align-self: auto', 'justify-self: right']);
  });
  it('drops a value either longhand rejects, as Chrome does', () => {
    for (const [p, v] of [['place-items', 'left'], ['place-items', 'legacy'], ['place-content', 'left'], ['place-content', 'center baseline'], ['place-self', 'center center center'], ['place-content', 'last baseline']]) {
      expect(parse(p as string, v as string).diagnostics.map((d) => d.code), `${p}: ${v}`).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    }
  });
  it('refuses a part its longhand cannot express, pointing at that part', () => {
    const got = parse('place-items', 'safe center end');
    expect(got.diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    expect(got.span).toBe('safe center');
    expect(got.diagnostics[0]?.message).toContain('its align-items part "safe center"');
  });
  it('takes a CSS-wide keyword for both longhands', () => {
    expect(parse('place-self', 'inherit').longhands).toEqual(['align-self: inherit', 'justify-self: inherit']);
  });
});

describe('align-content: last baseline', () => {
  it('is invalid, since Chrome parses only baseline or first baseline there', () => {
    expect(parse('align-content', 'last baseline').diagnostics.map((d) => d.code)).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(parse('align-items', 'last baseline').diagnostics).toEqual([]);
  });
});
