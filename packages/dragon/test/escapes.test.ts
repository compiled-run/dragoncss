// CSS-ESC: css-syntax-3 §4.3.7 decoding, CSSOM identifier serialization and the in-place input preprocessing (escapes.ts). The
// differential check against Chrome 145 is packages/parity/test/css-escapes.test.ts.
import { parse } from 'css-tree';
import { describe, expect, it } from 'vitest';
import { canonicalizeEscapes, decodeName, preprocessInput, serializeIdentifier } from '../src/css/escapes.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { expectCatalogued } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/escapes.css', revision: 'r1', hash: 'sha256:0' };
const sheet = (css: string): { rules: ReturnType<typeof parseStylesheet>; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { rules, diagnostics };
};

describe('CSS escapes', () => {
  it('decodes hex escapes with one white space (CRLF is one), identity escapes, and U+FFFD for zero, surrogates, past U+10FFFF and EOF', () => {
    expect(decodeName('\\62 lock')).toBe('block');
    expect(decodeName('\\62\tlock')).toBe('block');
    expect(decodeName('\\62\r\nlock')).toBe('block');
    expect(decodeName('\\62\n\nlock')).toBe('b\nlock');
    expect(decodeName('\\000062lock')).toBe('block');
    expect(decodeName('\\0000062')).toBe('\u00062');
    expect(decodeName('a\\-b\\ c\\\\')).toBe('a-b c\\');
    expect(decodeName('\\0 x\\D800\\DFFF\\110000\\FFFFFF')).toBe('\uFFFDx\uFFFD\uFFFD\uFFFD\uFFFD');
    expect(decodeName('\\1F600 x\\10FFFF')).toBe('\u{1F600}x\u{10FFFF}');
    expect(decodeName('\\\u{1F600}')).toBe('\u{1F600}');
    expect(decodeName('a\\')).toBe('a\uFFFD');
    expect(decodeName('a\u0000')).toBe('a\uFFFD');
    expect(decodeName('a\uD800')).toBe('a\uD800');
    expect(decodeName('plain')).toBe('plain');
  });

  it('serializes identifiers by the CSSOM rules', () => {
    expect(['block', '1x', '-1', '-', '--', 'a b', 'a\u0001', '\u{1F600}', 'a:b', '\uFFFD', '_x'].map(serializeIdentifier)).toEqual([
      'block', '\\31 x', '-\\31 ', '\\-', '--', 'a\\ b', 'a\\1 ', '\u{1F600}', 'a\\:b', '\uFFFD', '_x',
    ]);
  });

  it('rewrites a parsed tree to the serialization of each decoded name; a unit that would read as an exponent keeps its escape', () => {
    const node = parse('\\62 lock c\\61lc(1\\70 x) 1\\65 3 1\\45 -2 #\\66 00 \\31 x', { context: 'value' });
    canonicalizeEscapes(node);
    const round = (css: string): string => {
      const n = parse(css, { context: 'value' });
      canonicalizeEscapes(n);
      return JSON.stringify(n, (k, v: unknown) => (k === 'loc' ? undefined : v));
    };
    const text = JSON.stringify(node, (k, v: unknown) => (k === 'loc' ? undefined : v));
    expect(text).toContain('"name":"block"');
    expect(text).toContain('"name":"calc"');
    expect(text).toContain('"unit":"px"');
    expect(text).toContain('"unit":"\\\\65 3"');
    expect(text).toContain('"unit":"\\\\45 -2"');
    expect(text).toContain('"value":"f00"');
    expect(text).toContain('"name":"\\\\31 x"');
    // The serialization tokenizes back to the same names.
    expect(round('1\\65 3 \\31 x')).toBe(round('1\\65 3 \\31 x'.replace('\\65 3', '\\000065 3')));
  });

  it('rewrites deep and wide trees without recursion', () => {
    const deep = parse(`${'f('.repeat(1000)}\\61${')'.repeat(1000)}`, { context: 'value' });
    canonicalizeEscapes(deep);
    let n = deep;
    for (let i = 0; i <= 1000; i++) n = (n['children'] as { toArray(): typeof n[] }).toArray()[0] as typeof n;
    expect(n['name']).toBe('a');
    const wide = parse(Array.from({ length: 200000 }, () => '\\62').join('  '), { context: 'value' });
    canonicalizeEscapes(wide);
    expect((wide['children'] as { toArray(): { name?: string }[] }).toArray().filter((c) => c.name === 'b')).toHaveLength(200000);
  });

  it('preprocesses the input in place: U+0000 and an escape at the end of the input become U+FFFD, outside strings and comments', () => {
    expect(preprocessInput('a\\')).toBe('a\uFFFD');
    expect(preprocessInput('a\\\\')).toBe('a\\\\');
    expect(preprocessInput('a\\\\\\')).toBe('a\\\\\uFFFD');
    expect(preprocessInput('"a\\')).toBe('"a\\');
    expect(preprocessInput('"a"\\')).toBe('"a"\uFFFD');
    expect(preprocessInput('"a\nb\\')).toBe('"a\nb\uFFFD');
    expect(preprocessInput('/* a\\')).toBe('/* a\\');
    expect(preprocessInput('/* a */\\')).toBe('/* a */\uFFFD');
    expect(preprocessInput('a\u0000b')).toBe('a\uFFFDb');
    expect(preprocessInput('\\')).toBe('\uFFFD');
  });

  it('a declaration ending in an escape at the end of the stylesheet reads it as U+FFFD', () => {
    const { rules, diagnostics } = sheet('.a{--x: a\\');
    expect(rules[0]?.declarations.map((d) => [d.property, d.text])).toEqual([['--x', 'a\uFFFD']]);
    expect(diagnostics.map((d) => d.code)).toEqual([]);
  });

  it('reports a literal U+0000, which Chrome 145 reads differently by position', () => {
    const { diagnostics } = sheet('.a{display:block}\n.b\u0000{color:red}');
    const nul = diagnostics.find((d) => d.message.includes('U+0000'));
    expect(nul?.code).toBe('DRAGON_CSS_PARSE');
    expect(nul?.origin.kind === 'authored' ? [nul.origin.span.start, nul.origin.span.end] : null).toEqual([20, 21]);
    expectCatalogued(diagnostics);
  });

  it('escaped property names, !important and CSS-wide keywords read decoded', () => {
    const { rules, diagnostics } = sheet('.a{\\63 olor: r\\65 d !\\69mportant; W\\49 DTH: \\69nherit; display: \\62 lock}');
    expect(diagnostics).toEqual([]);
    expect(rules[0]?.declarations.map((d) => [d.property, d.text, d.important === true])).toEqual([['color', 'red', true], ['width', 'inherit', false], ['display', 'block', false]]);
  });
});
