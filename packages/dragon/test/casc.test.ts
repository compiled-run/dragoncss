// CASC: @supports decided at build time (css/at-rules/supports.ts) and revert / revert-layer rolled back to the user-agent origin
// (analysis/resolve.ts). packages/parity's casc group proves both against Chrome 145; these pin the decisions and refusals.
import { describe, expect, it } from 'vitest';
import type { Compiled, FrontEndResult } from '../src/index.ts';
import type { CompilerFaults } from '../src/internal.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { evaluateSupports, parseSupportsCondition } from '../src/css/at-rules/supports.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, spanTextOf } from './helpers.ts';

type K = 'ios' | 'android' | 'web';
const compile = (css: string, opts: { faults?: CompilerFaults; profiles?: 'enforce' | 'derive'; tag?: string } = {}): { input: FrontEndResult; c: Compiled<K> } => {
  const input = inputFor(`body { margin: 0; } ${css}`, (r) => [{ ...div(r, 'a', ['a']), tag: opts.tag ?? 'div' }]);
  const project = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: opts.faults ?? NO_FAULTS, profiles: opts.profiles ?? 'derive', direction: 'ltr' });
  return { input, c: project.compile(input) };
};
const value = (c: Compiled<K>, property: string): string => explainOne(c, 'web', 'a', property).value;
const decide = (prelude: string): boolean | string => {
  const c = parseSupportsCondition(prelude);
  return typeof c === 'string' ? `undecided: ${c}` : evaluateSupports(c);
};

describe('@supports conditions', () => {
  it('a declaration Chrome keeps holds and one it drops does not, through not, and, or and nested parentheses', () => {
    expect(decide('(display: flex)')).toBe(true);
    expect(decide('(width: 1px 2px)')).toBe(false);
    expect(decide('not (color: 12px)')).toBe(true);
    expect(decide('(display: flex) and (color: 12px)')).toBe(false);
    expect(decide('(width: 1px 2px) or (margin-left: 3px)')).toBe(true);
    expect(decide('((display: block))')).toBe(true);
    expect(decide('(not (display: block))')).toBe(false);
    expect(decide('(DISPLAY: Flex)')).toBe(true);
    expect(decide('(color: red !important)')).toBe(true);
    expect(decide('(--x: 1)')).toBe(true);
    expect(decide('(width: var(--w))')).toBe(true);
    expect(decide('(width: 1px 2px)')).toBe(false);
    expect(decide('(display: flex) AND (width: 1px) and (height: 2px)')).toBe(true);
  });

  it('a form Dragon does not evaluate is undecided, with the reason', () => {
    expect(decide('selector(a > b)')).toBe('undecided: selector() is not evaluated');
    expect(decide('font-tech(color-COLRv1)')).toBe('undecided: font-tech() is not evaluated');
    expect(decide('display: grid')).toBe('undecided: "display" is not a parenthesized condition or declaration');
    expect(decide('(x)')).toBe('undecided: "(x)" is <general-enclosed>, which Dragon does not evaluate');
    expect(decide('(width: 1px) and (height: 1px) or (color: red)')).toBe('undecided: "and" and "or" mixed without parentheses');
    expect(decide('(display: flex)and (width: 1px)')).toBe('undecided: an operator without white space before it');
    expect(decide('not(display: flex)')).toBe('undecided: not() is not evaluated');
    expect(decide('(display: flex) and')).toBe('undecided: "and" not followed by white space');
    expect(decide('')).toBe('undecided: an empty condition');
    // A kept value is trusted only when a web profile row proves it: the grammar lists values Chrome 145 has not shipped.
    for (const decl of ['text-align: match-parent', 'text-align: justify-all', 'display: grid', 'transition: opacity 1s']) {
      expect(decide(`(${decl})`), decl).toMatch(/^Dragon cannot tell whether Chrome keeps .* is not a value Dragon has proven Chrome 145 keeps\)$/);
    }
    // A grammar naming a type it does not define is undecided, not a crash.
    expect(decide('(width: calc-size(auto, size))')).toMatch(/names a type it does not define/);
    // A dropped value is trusted only when the grammar lists every keyword in it: Chrome keeps legacy keywords the grammar lacks.
    for (const decl of ['overflow: overlay', 'height: -webkit-fill-available', 'width: -webkit-fit-content', 'text-align: -webkit-center', 'color: -webkit-link', 'position: -webkit-sticky', 'width: foo']) {
      const keyword = (decl.split(': ')[1] as string);
      expect(decide(`not (${decl})`), decl).toBe(`Dragon cannot tell whether Chrome keeps (${decl}) (Chrome may keep "${keyword}" for ${decl.split(':')[0]}, a keyword the CSS grammar Dragon checks does not list)`);
    }
    expect(decide('(foo: bar)')).toMatch(/^Dragon cannot tell whether Chrome keeps \(foo: bar\) \(foo is not supported/);
    // An undecidable operand refuses the condition even where the decided one settles it.
    expect(decide('(width: 1px 2px) and (foo: bar)')).toMatch(/^Dragon cannot tell whether Chrome keeps \(foo: bar\)/);
  });
});

describe('@supports in a stylesheet', () => {
  it('a true condition keeps its rules as plain rules, and a false one drops them without a diagnostic', () => {
    const { c } = compile('.a { width: 10px; } @supports (display: flex) { .a { width: 20px; } } @supports (width: 1px 2px) { .a { height: 9px; } }');
    expect(c.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    expect(value(c, 'width')).toBe('20px');
    expect(value(c, 'height')).toBe('auto');
  });

  it('a value whose grammar names a type it does not define is refused in a style rule, not a crash', () => {
    const { c } = compile('.a { width: calc-size(auto, size); }', { profiles: 'enforce' });
    expect(c.diagnostics.map((d) => [d.code, /names a type it does not define/.test(d.message)])).toEqual([['DRAGON_UNSUPPORTED_VALUE', true]]);
  });

  it('a false condition\'s rules are never analysed: a refused value inside it reports nothing', () => {
    const { c } = compile('@supports not (display: block) { .a { foo: bar; width: 1px 2px; } }');
    expect(c.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('a true condition\'s rules keep their order in the cascade, and !important inside it wins', () => {
    const { c } = compile('@supports (width: 1px) { .a { width: 35px !important; height: 3px; } } .a { width: 36px; height: 4px; }');
    expect(value(c, 'width')).toBe('35px');
    expect(value(c, 'height')).toBe('4px');
  });

  it('@supports inside @media keeps the @media condition, and @media inside @supports too', () => {
    const css = '@media (min-width: 1px) { @supports (display: flex) { .a { width: 30px; } } } @supports (display: flex) { @media (min-width: 2px) { .a { height: 31px; } } }';
    const diagnostics: Diagnostic[] = [];
    const rules = parseStylesheet(css, { source: { uri: 'test', revision: 'r', hash: 'h' }, start: 0, end: css.length }, { id: 's', owner: 'o', scope: 'document' }, 0, diagnostics);
    expect(diagnostics).toEqual([]);
    expect(rules.map((r) => [r.declarations.map((d) => d.text), (r.condition ?? []).map((c) => c.text)])).toEqual([[['30px'], ['(min-width: 1px)']], [['31px'], ['(min-width: 2px)']]]);
  });

  for (const [css, span, message] of [
    ['@supports selector(a > b) { .a { width: 20px; } }', '@supports selector(a > b) { .a { width: 20px; } }', '@supports selector(a > b) in the stylesheet is not supported: selector() is not evaluated'],
    ['.a { @supports (display: flex) { width: 20px; } }', '@supports (display: flex) { width: 20px; }', '@supports in a rule block is not supported in milestone 1'],
    ['@supports (display: flex);', '@supports (display: flex);', '@supports in the stylesheet is not supported in milestone 1'],
  ] as const) {
    it(`refuses ${css}`, () => {
      const { input, c } = compile(css, { profiles: 'enforce' });
      const refusals = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_AT_RULE');
      expect(refusals.length).toBe(1);
      expect(refusals[0]?.message.startsWith(message), refusals[0]?.message).toBe(true);
      expect(spanTextOf(input, refusals[0] as (typeof refusals)[number])).toBe(span);
      expectCatalogued(c.diagnostics);
    });
  }

  it('planted fault supportsConditionIgnored applies a false condition\'s rules', () => {
    const css = '.a { width: 10px; } @supports (width: 1px 2px) { .a { width: 90px; } }';
    expect(value(compile(css).c, 'width')).toBe('10px');
    expect(value(compile(css, { faults: { ...NO_FAULTS, supportsConditionIgnored: true } }).c, 'width')).toBe('90px');
  });
});

describe('revert and revert-layer', () => {
  it('roll an author declaration back to the user-agent value: a p\'s margins, a div\'s display', () => {
    const p = compile('.a { margin: 0; display: flex; } .a { margin: revert; display: revert-layer; }', { tag: 'p' }).c;
    expect(value(p, 'margin-top')).toBe('16px');
    expect(value(p, 'margin-left')).toBe('0px');
    expect(value(p, 'display')).toBe('block');
    const d = compile('.a { display: flex; padding: 3px; } .a { display: revert; padding: revert; }').c;
    expect(value(d, 'display')).toBe('block');
    expect(value(d, 'padding-top')).toBe('0px');
  });

  it('an inherited property with no user-agent value takes the parent\'s, as unset does', () => {
    const { c } = compile('body { color: #123456; } .a { color: #654321; } .a { color: revert; }');
    expect(value(c, 'color')).toBe('rgb(18, 52, 86)');
  });

  it('explain reports a reverted value as the user agent one', () => {
    const { c } = compile('.a { display: flex; } .a { display: revert; }');
    expect(explainOne(c, 'web', 'a', 'display').cascade).toBe('user-agent');
  });

  it('planted fault revertAsUnset: a p\'s reverted margin falls to its initial 0', () => {
    const css = '.a { margin: 0; } .a { margin: revert; }';
    expect(value(compile(css, { tag: 'p', faults: { ...NO_FAULTS, revertAsUnset: true } }).c, 'margin-top')).toBe('0px');
  });
});
