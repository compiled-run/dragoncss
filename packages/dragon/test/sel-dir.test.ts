// SEL-dir: :dir(ltr) and :dir(rtl), parsed and matched as Chrome 145 does (css/selector-validity.generated.ts holds the capture).
import { describe, expect, it } from 'vitest';
import type { PseudoClass, Selector } from '../src/css/selectors.ts';
import { DIR_ARGUMENT_VALID, DIR_ATTRIBUTE_DIRECTIONALITY } from '../src/css/selector-validity.generated.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { dirKeyword, directionality } from '../src/analysis/elements/dir.ts';
import type { Diagnostic } from '../src/types.ts';
import { NO_FAULTS } from '../src/internal.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const parse = (css: string): { selectors: Selector[]; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 's', owner: 'o', scope: 'document' }, 0, diagnostics);
  return { selectors: rules.flatMap((r) => [...r.selectors]), diagnostics };
};
const dirOf = (sel: string): PseudoClass | undefined => {
  const { selectors, diagnostics } = parse(`.a${sel} { width: 1px; }`);
  expect(diagnostics, sel).toEqual([]);
  return selectors[0]?.parts[0]?.compound.pseudos.find((p) => p.kind === 'dir');
};
const codes = (css: string): string[] => parse(css).diagnostics.map((d) => d.code);

describe('the :dir() capture', () => {
  it('an argument that differs only in ASCII case matches what its lowercase row matches', () => {
    for (const [arg, row] of Object.entries(DIR_ARGUMENT_VALID)) {
      const lower = DIR_ARGUMENT_VALID[arg.toLowerCase()];
      if (lower !== undefined && /^[A-Za-z]+$/.test(arg)) expect(row, arg).toEqual(lower);
    }
  });
  it('dirKeyword agrees with the directionality Chrome gives every captured dir value, under either parent', () => {
    for (const [value, row] of Object.entries(DIR_ATTRIBUTE_DIRECTIONALITY)) {
      const d = dirKeyword(value);
      if (d === null) expect(row, JSON.stringify(value)).toEqual({ underLtr: 'ltr', underRtl: 'rtl' });
      else expect(row, value).toEqual({ underLtr: d, underRtl: d });
    }
    expect(dirKeyword(' rtl')).toBeNull();
    expect(dirKeyword('RTL')).toBe('rtl');
  });
});

describe(':dir() parsing (Chrome 145 ConsumePseudo kPseudoDir)', () => {
  it.each([
    [':dir(rtl)', 'rtl'],
    [':dir(ltr)', 'ltr'],
    [':dir(RTL)', 'rtl'],
    [':dir(Ltr)', 'ltr'],
    [':dir( rtl )', 'rtl'],
    [':dir(\\72 tl)', 'rtl'],
    [':d\\ir(rtl)', 'rtl'],
    [':dir(auto)', null],
    [':dir(foo)', null],
  ])('%s matches directionality %s', (sel, direction) => {
    expect(dirOf(sel)).toEqual({ kind: 'dir', direction });
  });
  it('specificity is a pseudo-class\'s (0,1,0)', () => {
    expect(parse(':dir(rtl) { width: 1px; }').selectors[0]?.specificity).toEqual([0, 1, 0]);
    expect(parse('.a:dir(foo) { width: 1px; }').selectors[0]?.specificity).toEqual([0, 2, 0]);
  });
  it(':dir() and a bare :dir are invalid, so Chrome drops the rule; inside a forgiving :is() they are refused', () => {
    for (const sel of [':dir()', ':dir']) {
      const { selectors, diagnostics } = parse(`.a${sel}, .b { width: 1px; }`);
      expect(diagnostics.map((d) => d.code), sel).toEqual(['DRAGON_SELECTOR_DROPPED']);
      expect(selectors.every((s) => s.dropped), sel).toBe(true);
    }
    expect(codes(':is(:dir(), .a) { width: 1px; }')).toEqual(['DRAGON_UNSUPPORTED_SELECTOR']);
  });
  it('a quoted argument, two identifiers, or a list fail css-tree\'s parse', () => {
    for (const sel of [':dir("rtl")', ':dir(ltr rtl)', ':dir(ltr, rtl)', ':is(:dir("rtl"), .a)']) expect(codes(`.a${sel} { width: 1px; }`), sel).toContain('DRAGON_CSS_PARSE');
  });
  it('an identifier the capture has no row for is refused as missing data', () => {
    const d = parse('.a:dir(bar) { width: 1px; }').diagnostics;
    expect(d.map((x) => x.code)).toEqual(['DRAGON_UNSUPPORTED_SELECTOR']);
    expect(d[0]?.message).toContain('not captured');
  });
});

describe('directionality (HTML §3.2.6.4)', () => {
  const el = (dir?: string): { attributes: ReadonlyMap<string, string> } => ({ attributes: new Map(dir === undefined ? [] : [['dir', dir]]) });
  it('is the nearest ancestor-or-self dir of ltr or rtl, else ltr; an invalid value is skipped', () => {
    expect(directionality([el(), el()], NO_FAULTS)).toBe('ltr');
    expect(directionality([el(), el('rtl'), el()], NO_FAULTS)).toBe('rtl');
    expect(directionality([el(), el('rtl'), el('ltr')], NO_FAULTS)).toBe('ltr');
    expect(directionality([el(), el('rtl'), el('foo')], NO_FAULTS)).toBe('rtl');
    expect(directionality([el(), el('RTL')], NO_FAULTS)).toBe('rtl');
  });
  it('the planted faults: dirNotInherited reads only the element\'s own dir, dirCaseSensitive skips dir=RTL', () => {
    expect(directionality([el(), el('rtl'), el()], { ...NO_FAULTS, dirNotInherited: true })).toBe('ltr');
    expect(directionality([el(), el('RTL')], { ...NO_FAULTS, dirCaseSensitive: true })).toBe('ltr');
  });
});
