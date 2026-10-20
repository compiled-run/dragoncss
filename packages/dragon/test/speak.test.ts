// speak (NA-NATIVE-2): a longhand appended after the color-scheme family, inherited, initial normal, discrete, with no layout or paint
// aspect. Dragon accepts Chrome 145's six keywords in any case and drops every other value, as Chrome does; it draws nothing on any
// target, and web output writes it only on cases that set it away from normal.
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

const SOURCE = { uri: 'dragon-source://test/speak.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function parse(value: string) {
  const css = `.a { speak: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const lh = rules[0]?.declarations[0]?.longhands[0];
  return { codes: diagnostics.map((d) => d.code), value: lh?.value.kind === 'keyword' ? lh.value.value : null };
}

function compile(css: string, targets: Targets = { web: {} }) {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

function webText(css: string): string {
  const out = compile(css).outputs.web;
  if (out.kind !== 'ready') throw new Error(out.kind);
  return (out.files[0] as { text: string }).text;
}

describe('speak', () => {
  it('is the last longhand, inherited, with no layout or paint aspect, discrete, initial normal', () => {
    expect(LONGHANDS.includes('speak')).toBe(true);
    expect(INHERITED.has('speak')).toBe(true);
    expect(PROPERTY_ASPECTS['speak']).toEqual({ layout: false, paint: false });
    expect(ANIMATION_KINDS['speak']).toBe(DISCRETE);
    expect(grammar['speak']).toEqual({ syntax: '<any-value>', initial: 'normal', inherited: 'yes' });
  });

  it("accepts Chrome's six keywords in any case and drops the rest", () => {
    for (const v of ['none', 'normal', 'spell-out', 'digits', 'literal-punctuation', 'no-punctuation']) expect(parse(v), v).toEqual({ codes: [], value: v });
    for (const v of ['NONE', 'Spell-Out', 'DIGITS']) expect(parse(v), v).toEqual({ codes: [], value: v.toLowerCase() });
    for (const v of ['inherit', 'initial', 'unset', 'var(--x)']) expect(parse(v).codes, v).toEqual([]);
    for (const v of ['auto', 'never', 'always', 'none none', '1px', '"none"', 'none, normal']) expect(parse(v).codes, v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('compiles on every target, and web output writes it only where a case sets it', () => {
    const c = compile('.a { speak: spell-out; }', NATIVE);
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(webText('.a { speak: spell-out; }')).toContain('speak: spell-out');
    expect(webText('.a { color: red; }')).not.toContain('speak');
  });
});
