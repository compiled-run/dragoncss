// -webkit-user-modify (TOUCH): a longhand appended after caret-color and accent-color, inherited, initial read-only, discrete, with no
// layout or paint aspect. Dragon accepts read-only in any case, refuses read-write and read-write-plaintext-only (they make the
// content editable) and drops every other value, as Chrome 145 does; web output never writes it.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Targets } from '../src/types.ts';
import { div, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/um.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
const P = '-webkit-user-modify';

function parse(value: string) {
  const css = `.a { ${P}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const lh = rules[0]?.declarations[0]?.longhands[0];
  return { codes: diagnostics.map((d) => d.code), value: lh?.value.kind === 'keyword' ? lh.value.value : null };
}

function compile(css: string, targets: Targets = { web: {} }) {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

describe('-webkit-user-modify', () => {
  it('follows accent-color, inherited, with no layout or paint aspect, discrete, initial read-only', () => {
    expect(LONGHANDS[LONGHANDS.indexOf(P) - 1]).toBe('accent-color');
    expect(INHERITED.has(P)).toBe(true);
    expect(PROPERTY_ASPECTS[P]).toEqual({ layout: false, paint: false });
    expect(ANIMATION_KINDS[P]).toBe(DISCRETE);
    expect(grammar[P]).toEqual({ syntax: '<any-value>', initial: 'read-only', inherited: 'yes' });
  });

  it('accepts read-only in any case, refuses the read-write keywords and drops the rest', () => {
    for (const v of ['read-only', 'READ-ONLY', 'Read-Only']) expect(parse(v), v).toEqual({ codes: [], value: 'read-only' });
    for (const v of ['inherit', 'initial', 'unset', 'var(--x)']) expect(parse(v).codes, v).toEqual([]);
    for (const v of ['read-write', 'READ-WRITE', 'read-write-plaintext-only']) expect(parse(v).codes, v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    for (const v of ['write-only', 'auto', 'none', 'read-only read-only', '1px', '"read-only"']) expect(parse(v).codes, v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('compiles read-only on every target and is never written to web output', () => {
    const c = compile(`.a { ${P}: read-only; }`, NATIVE);
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const out = compile(`.a { ${P}: read-only; }`).outputs.web;
    if (out.kind !== 'ready') throw new Error(out.kind);
    expect((out.files[0] as { text: string }).text).not.toContain('user-modify');
  });
});
