// CASC 2: @property registrations (css-properties-values-api-1). Every expectation here was read from Chrome 145.0.7632.6 on the
// same CSS; the parity fixture casc-property (packages/parity/src/fixture-groups/casc-property.ts) proves them against Chrome.
import { describe, expect, it } from 'vitest';
import type { LinkedElement } from '../src/analysis/link.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { resolveTree, valueToString } from '../src/analysis/resolve.ts';
import { computeCustoms } from '../src/analysis/variables.ts';
import type { PropertySource, Registration } from '../src/css/at-rules/property.ts';
import { computeRegistered, parsePropertyRules } from '../src/css/at-rules/property.ts';
import { atRuleHandler } from '../src/css/at-rules.ts';
import { propertyAtRule } from '../src/css/at-rules/property.ts';
import type { Longhand } from '../src/css/properties.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { NO_FAULTS } from '../src/faults.ts';
import type { Diagnostic } from '../src/types.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { createProject } from '../src/index.ts';
import { registrationsOf } from '../src/analysis/registered.ts';
import { div, inputFor } from './helpers.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const origin = { kind: 'unlocated', reason: 'test' } as const;
const el = (id: string, classes: string[], children: LinkedElement[] = [], tag = 'div'): LinkedElement => ({
  kind: 'element', address: id, instance: 'doc', owner: 'App', tag, classes: classes.map((name) => ({ owner: 'o', sheet: 'sheet', name })), attributes: new Map(), children,
  node: { kind: 'element', id, tag, classes: [], attributes: [], children: [], origin },
});

function parse(css: string, faults = NO_FAULTS): { rules: ReturnType<typeof parseStylesheet>; diagnostics: Diagnostic[]; registered: Map<string, Registration> } {
  const diagnostics: Diagnostic[] = [];
  const properties: PropertySource[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, diagnostics, [], [], [], properties);
  const registered = registrationsOf(properties, rules, faults, diagnostics);
  return { rules, diagnostics, registered };
}

/** Resolves html > body > (tree) and reads values by address. */
function resolve(css: string, tree: LinkedElement[], faults = NO_FAULTS): (id: string, p: Longhand) => string {
  const { rules, diagnostics, registered } = parse(css, faults);
  expect(diagnostics.map((d) => d.message)).toEqual([]);
  const root = resolveTree(el('html', [], [el('body', [], tree, 'body')], 'html'), rules, faults, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset(), registered });
  const find = (e: ResolvedElement, id: string): ResolvedElement | null => {
    if (e.element.address === id) return e;
    for (const c of e.children) if (c.kind === 'element') {
      const hit = find(c, id);
      if (hit !== null) return hit;
    }
    return null;
  };
  return (id, p) => valueToString(((find(root, id) as ResolvedElement).props.get(p) as { value: Parameters<typeof valueToString>[0] }).value);
}

const SHEET = `
@property --w { syntax: "<length>"; inherits: false; initial-value: 40px; }
@property --h { syntax: "*"; inherits: true; initial-value: 6px; }
@property --c { syntax: "<color>"; inherits: true; initial-value: #00aa00; }
@property --d { syntax: "<length>"; inherits: true; initial-value: 10px; }
@property --d { syntax: "<length>"; inherits: false; initial-value: 20px; }
@property --u { syntax: "*"; inherits: false; }
.box { height: var(--h); }
.outer { --w: 100px; --d: 30px; --u: 14px; --c: rgb(10, 20, 30); width: var(--w); background-color: var(--c); padding-left: var(--d); }
.inner { width: var(--w, 77px); padding-left: var(--d, 1px); margin-left: var(--u, 9px); background-color: var(--c); }
.keep { --w: inherit; --d: inherit; width: var(--w); padding-left: var(--d); }
.bad { --w: red; --c: 5px; width: var(--w, 11px); background-color: var(--c); }
.reset { --h: 12px; --c: #ff0000; }
.reset2 { --h: initial; --c: unset; background-color: var(--c); }
`;
const TREE = (): LinkedElement[] => [
  el('outer', ['box', 'outer'], [el('inner', ['box', 'inner']), el('keep', ['box', 'keep']), el('bad', ['box', 'bad'])]),
  el('reset', ['box', 'reset'], [el('reset2', ['box', 'reset2'])]),
];

describe('CASC 2: @property in the cascade', () => {
  it('a registered name takes its initial value, inherits only when registered so, and the last valid rule wins (as Chrome 145)', () => {
    const v = resolve(SHEET, TREE());
    expect([v('outer', 'width'), v('outer', 'height'), v('outer', 'padding-left'), v('outer', 'background-color')]).toEqual(['100px', '6px', '30px', 'rgb(10, 20, 30)']);
    // --w and --d (the second rule) do not inherit, so the initial value wins over the fallback; --u has none, so the fallback is used.
    expect([v('inner', 'width'), v('inner', 'padding-left'), v('inner', 'margin-left'), v('inner', 'background-color')]).toEqual(['40px', '20px', '9px', 'rgb(10, 20, 30)']);
    expect([v('keep', 'width'), v('keep', 'padding-left')]).toEqual(['100px', '30px']);
    // A value that does not match the syntax is invalid at computed-value time: unset, so the initial value (--w) or the parent's (--c).
    expect([v('bad', 'width'), v('bad', 'background-color')]).toEqual(['40px', 'rgb(10, 20, 30)']);
    expect([v('reset2', 'height'), v('reset2', 'background-color')]).toEqual(['6px', 'rgb(255, 0, 0)']);
  });
  it('the planted faults move the values they target', () => {
    const inherits = resolve(SHEET, TREE(), { ...NO_FAULTS, propertyInheritsIgnored: true });
    expect([inherits('inner', 'width'), inherits('inner', 'padding-left'), inherits('inner', 'margin-left')]).toEqual(['100px', '30px', '14px']);
    const initial = resolve(SHEET, TREE(), { ...NO_FAULTS, propertyInitialIgnored: true });
    expect([initial('inner', 'width'), initial('inner', 'padding-left'), initial('bad', 'width')]).toEqual(['77px', '1px', '11px']);
  });
  it('computeCustoms: a root with no parent takes the initial value for every registration, and inherit there is the initial value', () => {
    const { registered } = parse('@property --a { syntax: "<number>"; inherits: true; initial-value: 1.50; } @property --b { syntax: "*"; inherits: false; }');
    expect([...computeCustoms(new Map(), new Map(), registered)]).toEqual([['--a', '1.5']]);
    const { rules } = parse('.x { --a: inherit; --b: inherit; }');
    const winners = new Map(rules[0]?.declarations.map((d) => [d.custom?.name as string, d]));
    expect([...computeCustoms(winners, new Map(), registered)]).toEqual([['--a', '1.5']]);
  });
});

describe('CASC 2: computed values of the registered syntaxes', () => {
  it('computes px lengths, numbers, integers, percentages and colours; other units, math and currentcolor are refused', () => {
    const cases: [Parameters<typeof computeRegistered>[0], string, unknown][] = [
      ['<length>', '10.50px', { kind: 'ok', text: '10.5px' }],
      ['<length>', '0', { kind: 'ok', text: '0px' }],
      ['<length>', '5', { kind: 'invalid' }],
      ['<length>', 'red', { kind: 'invalid' }],
      ['<length>', '1px 2px', { kind: 'invalid' }],
      ['<length>', '2em', { kind: 'refused', reason: '2em is not a px length, which Dragon does not compute for a registered property yet' }],
      ['<length>', 'calc(1px + 2px)', { kind: 'refused', reason: 'calc() in the value of a <length> registered property is not computed yet' }],
      ['<length-percentage>', '25%', { kind: 'ok', text: '25%' }],
      ['<percentage>', '10px', { kind: 'invalid' }],
      ['<number>', '1.50', { kind: 'ok', text: '1.5' }],
      ['<number>', '1e400', { kind: 'refused', reason: '1e400 is out of range, and Chrome clamps it' }],
      ['<integer>', '3', { kind: 'ok', text: '3' }],
      ['<integer>', '1.5', { kind: 'invalid' }],
      ['<color>', 'red', { kind: 'ok', text: 'rgb(255, 0, 0)' }],
      ['<color>', 'transparent', { kind: 'ok', text: 'rgba(0, 0, 0, 0)' }],
      ['<color>', 'rgb(10 20 30 / 50%)', { kind: 'ok', text: 'rgba(10, 20, 30, 0.5)' }],
      ['<color>', '5px', { kind: 'invalid' }],
      ['<color>', 'currentcolor', { kind: 'refused', reason: 'currentcolor in a registered <color> computes against the element, which is not built yet' }],
      ['<color>', 'var(--x)', { kind: 'refused', reason: 'var() in the value of a typed registered property is not substituted yet' }],
      ['*', 'a b  c', { kind: 'ok', text: 'a b  c' }],
    ];
    for (const [syntax, text, want] of cases) expect(computeRegistered(syntax, text), `${syntax} ${text}`).toEqual(want);
  });
});

describe('CASC 2: refusals', () => {
  const messages = (css: string): string[] => parse(css).diagnostics.map((d) => `${d.code}: ${d.message}`);
  it('the handler table registers propertyAtRule', () => {
    expect(atRuleHandler('PROPERTY')).toBe(propertyAtRule);
  });
  it('refuses each rule Chrome ignores or Dragon does not register, and registers nothing for it', () => {
    const rules: [string, string][] = [
      ['@property x { syntax: "*"; inherits: true; }', 'the prelude must be one custom property name, or Chrome ignores the rule'],
      ['@property --x { inherits: true; initial-value: 1px; }', 'it has no syntax descriptor holding one string, so Chrome ignores the rule'],
      ['@property --x { syntax: "<length>+"; inherits: true; initial-value: 1px; }', 'syntax "<length>+" is not supported (supported: "*", "<length>", "<number>", "<integer>", "<percentage>", "<length-percentage>", "<color>")'],
      ['@property --x { syntax: "<length>"; initial-value: 1px; }', 'it has no inherits descriptor of true or false, so Chrome ignores the rule'],
      ['@property --x { syntax: "<length>"; inherits: maybe; initial-value: 1px; }', 'it has no inherits descriptor of true or false, so Chrome ignores the rule'],
      ['@property --x { syntax: "<length>"; inherits: true; }', 'syntax "<length>" needs an initial-value, so Chrome ignores the rule'],
      ['@property --x { syntax: "<length>"; inherits: true; initial-value: red; }', 'the initial-value red does not match syntax "<length>", so Chrome ignores the rule'],
      ['@property --x { syntax: "<length>"; inherits: true; initial-value: 2em; }', 'the initial-value 2em: 2em is not a px length, which Dragon does not compute for a registered property yet'],
      ['@property --x { syntax: "*"; inherits: true; initial-value: var(--y); }', 'the initial-value holds var(), which is not computationally independent, so Chrome ignores the rule'],
      ['@property --x { syntax: "*"; inherits: true; initial-value: inherit; }', 'the initial-value inherit is a CSS-wide keyword, which no syntax accepts, so Chrome ignores the rule'],
      ['@property --x { syntax: "*"; inherits: true !important; }', '!important on a descriptor is invalid, so Chrome drops it'],
    ];
    for (const [css, why] of rules) {
      const { diagnostics, registered } = parse(css);
      expect(diagnostics.map((d) => `${d.code}: ${d.message}`), css).toEqual([`DRAGON_UNSUPPORTED_AT_RULE: ${css.split(' {')[0]} is not supported: ${why}`]);
      expect(registered.size, css).toBe(0);
    }
  });
  it('refuses @property outside the top level, and a typed value or transition Dragon does not compute', () => {
    expect(messages('.a { @property --x { syntax: "*"; inherits: true; } }')).toEqual(['DRAGON_UNSUPPORTED_AT_RULE: @property in a rule block is not supported; register custom properties at the top level of a stylesheet']);
    expect(messages('@property --x { syntax: "<length>"; inherits: false; initial-value: 1px; } .a { --x: 2em; } .b { --x: 3px; transition: all 1s; } .c { transition-property: --x; } .d { transition-property: width; }')).toEqual([
      'DRAGON_UNSUPPORTED_VALUE: --x: 2em is unsupported: --x is registered with syntax "<length>", and 2em is not a px length, which Dragon does not compute for a registered property yet',
      'DRAGON_UNSUPPORTED_VALUE: transition is unsupported here: it transitions --x, registered with a typed syntax, which Chrome interpolates and Dragon has no writer for yet',
      'DRAGON_UNSUPPORTED_VALUE: transition-property is unsupported here: it transitions --x, registered with a typed syntax, which Chrome interpolates and Dragon has no writer for yet',
    ]);
  });
  it('a sheet with valid registrations compiles for every target', () => {
    const css = SHEET;
    const project = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } });
    const c = project.compile(inputFor(css, (r) => [div(r, 'a', ['box', 'outer'], [div(r, 'b', ['box', 'inner'])])]));
    expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
  });
});
