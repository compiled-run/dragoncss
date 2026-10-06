// Selectors provable at build time (docs/decisions.md "Selectors and scrollbars"): parsing, Selectors-4 §17 specificity,
// precise refusals, and matching on the fixed tree of every reachable case.
import { describe, expect, it } from 'vitest';
import type { ElementNode, ExplainedCase, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { specificityOf } from '../src/css/selectors.ts';
import type { Selector } from '../src/css/selectors.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { always, DOC, div, eq, expectCatalogued, explainOne, inputFor, Sources, staticClass, text } from './helpers.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const parse = (css: string, scope: 'document' | 'component' = 'document'): { selectors: Selector[]; diagnostics: Diagnostic[] } => {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 's', owner: 'o', scope }, 0, diagnostics);
  return { selectors: rules.flatMap((r) => [...r.selectors]), diagnostics };
};
const specificity = (sel: string): readonly number[] => {
  const { selectors, diagnostics } = parse(`${sel} { width: 1px; }`);
  expect(diagnostics, sel).toEqual([]);
  return (selectors[0] as Selector).specificity;
};

describe('Selectors-4 §17 specificity', () => {
  it.each([
    ['*', [0, 0, 0]],
    ['div', [0, 0, 1]],
    ['*.a', [0, 1, 0]],
    ['[ui-x]', [0, 1, 0]],
    ['[ui-x^="a" i]', [0, 1, 0]],
    [':root', [0, 1, 0]],
    [':empty', [0, 1, 0]],
    ['div:first-child', [0, 1, 1]],
    [':only-of-type', [0, 1, 0]],
    ['div:nth-last-of-type(odd)', [0, 1, 1]],
    [':nth-child(2n of .a.b)', [0, 3, 0]],
    [':nth-child(2n of .a, div)', [0, 2, 0]],
    [':is(.a .b, div)', [0, 2, 0]],
    [':is(div, .a .b):is()', [0, 2, 0]],
    [':where(.a.b, div)', [0, 0, 0]],
    ['div:where(.a) .b', [0, 1, 1]],
    [':not(.a, div.b.c)', [0, 2, 1]],
    [':has(> .a .b, div)', [0, 2, 0]],
    [':not(:is(.a, :where(.b.c)))', [0, 1, 0]],
    ['.a + div ~ .b > :last-child', [0, 3, 1]],
  ])('%s is %j', (sel, expected) => {
    expect(specificity(sel)).toEqual(expected);
  });

  it('the planted fault gives :is() its first argument instead of its most specific one', () => {
    const sel = parse(':is(div, .a .b) { width: 1px; }').selectors[0] as Selector;
    expect(specificityOf(sel)).toEqual([0, 2, 0]);
    expect(specificityOf(sel, true)).toEqual([0, 0, 1]);
  });
});

describe('precise refusals', () => {
  it.each([
    ['.a::before', 'pseudo-element ::before'],
    ['.a::after', 'pseudo-element ::after'],
    ['.a:focus-within', ':focus-within depends on user interaction'],
    ['.a:visited', ':visited depends on user interaction'],
    ['.a:checked', ':checked depends on user interaction'],
    [':is(.a:focus-within)', ':focus-within depends on user interaction'],
    ['.a:has(:has(.b))', ':has(.b) is invalid inside :has()'],
    ['.a:has(:is(:has(.b)))', ':has(.b) is invalid inside :has()'],
    ['[ui-x="a" s]', 'is invalid in Chrome 145, which does not implement the s flag'],
    ['svg|rect', 'namespaced selector'],
    ['.a:nth-of-type(2 of .b)', 'is invalid: only :nth-child() and :nth-last-child() take "of S"'],
    ['.a:checked', ':checked depends on user interaction'],
    ['.a:lang(en)', ':lang(en) is not supported'],
    ['.a:not()', 'needs a selector list argument'],
  ])('%s', (sel, message) => {
    const { selectors, diagnostics } = parse(`${sel} { width: 1px; }`);
    expect(selectors).toEqual([]);
    expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_SELECTOR']);
    expect((diagnostics[0] as Diagnostic).message).toContain(message);
    expectCatalogued(diagnostics);
  });

  it('[data-x] and #x are accepted: every attribute is element data, and an id selector matches the id attribute', () => {
    for (const [sel, sp] of [['[data-x]', [0, 1, 0]], ['#x', [1, 0, 0]]] as const) {
      const { selectors, diagnostics } = parse(`${sel} { width: 1px; }`);
      expect(diagnostics, sel).toEqual([]);
      expect((selectors[0] as Selector).specificity, sel).toEqual(sp);
    }
  });

  it('escaped ids, classes, attribute names, values and flags, type and pseudo-class names are read decoded (css-syntax-3 §4.3.7)', () => {
    const { selectors, diagnostics } = parse('\\64 iv#\\31 a.\\61 b[data-\\41][data-x=\\41  \\69]:\\72oot, [a\\|b] { width: 1px; }');
    expect(diagnostics).toEqual([]);
    expect(selectors.map((s) => s.parts.map((p) => p.compound))).toEqual([
      [{ tag: 'div', ids: ['1a'], classes: ['ab'], attributes: [{ name: 'data-a', value: null, matcher: null, caseInsensitive: false }, { name: 'data-x', value: 'A', matcher: '=', caseInsensitive: true }], pseudos: [{ kind: 'root' }] }],
      [{ tag: null, ids: [], classes: [], attributes: [{ name: 'a|b', value: null, matcher: null, caseInsensitive: false }], pseudos: [] }],
    ]);
  });

  it('a type or universal selector after another simple selector drops the rule, as in Chrome 145 (.a*)', () => {
    const { selectors, diagnostics } = parse('.b* { width: 1px; }');
    expect(selectors.every((s) => s.dropped)).toBe(true);
    expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_SELECTOR_DROPPED']);
  });

  it('a component-scoped sheet needs a class on the subject compound; other compounds may be structural', () => {
    expect(parse('div { width: 1px; }', 'component').diagnostics.map((d) => d.message)).toEqual(['the subject compound of "div" needs a class in a component-scoped sheet, so it can only style the owner\'s elements']);
    expect(parse('.a > * { width: 1px; }', 'component').diagnostics).toHaveLength(1);
    expect(parse(':is(.a, div) { width: 1px; }', 'component').diagnostics).toHaveLength(1);
    expect(parse(':root div + .a:first-child, :is(.a, .b):has(> div), :where(.c) { width: 1px; }', 'component').diagnostics).toEqual([]);
  });
});

const attr = (name: string, value: string) => ({ name, value: [{ when: always, value }], origin: { kind: 'unlocated', reason: 'test' } as const });
const project = (faults = NO_FAULTS) => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults, profiles: 'derive', direction: 'ltr' });

describe('matching on the fixed tree', () => {
  const items = (r: SourceRef): TreeNode[] => [
    div(r, 'list', ['list'], [div(r, 'i1', ['item']), div(r, 'i2', ['item', 'mark']), div(r, 'i3', ['item']), div(r, 'i4', ['item']), div(r, 'i5', ['item'])]),
    div(r, 'e1', ['e']),
    div(r, 'e2', ['e'], [text(r, 't', ' ')]),
  ];
  const widths = (css: string, faults = NO_FAULTS): Record<string, string> => {
    const c = project(faults).compile(inputFor(css, items));
    expect(c.diagnostics).toEqual([]);
    return Object.fromEntries(['list', 'i1', 'i2', 'i3', 'i4', 'i5', 'e1', 'e2'].map((n) => [n, explainOne(c, 'ios', n, 'width').value]));
  };
  const hit = (css: string, faults = NO_FAULTS): string[] => Object.entries(widths(`${css} { width: 7px; }`, faults)).filter(([, v]) => v === '7px').map(([k]) => k);

  it.each([
    ['.item:first-child', ['i1']],
    ['.item:last-child', ['i5']],
    ['.item:only-child', []],
    ['.item:nth-child(2n+1)', ['i1', 'i3', 'i5']],
    ['.item:nth-child(-n+2)', ['i1', 'i2']],
    ['.item:nth-last-child(2)', ['i4']],
    ['.item:nth-child(even of :not(.mark))', ['i3', 'i5']],
    ['.item:nth-last-child(1 of .mark)', ['i2']],
    ['div:first-of-type', ['list', 'i1']],
    ['.item:nth-last-of-type(odd)', ['i1', 'i3', 'i5']],
    ['.mark + .item', ['i3']],
    ['.mark ~ .item', ['i3', 'i4', 'i5']],
    ['.item + .item + .item', ['i3', 'i4', 'i5']],
    ['.list:has(> .mark)', ['list']],
    ['.list:has(.mark + .item + .item)', ['list']],
    ['.item:has(+ .mark)', ['i1']],
    ['.item:has(~ .mark)', ['i1']],
    ['.item:not(:has(~ .item))', ['i5']],
    [':has(+ .e)', ['list', 'e1']],
    ['.e:empty', ['e1']],
    [':is(.list > .item, .e):not(:nth-child(n+3))', ['i1', 'i2', 'e1']],
    ['*:where(.e)', ['e1', 'e2']],
    ['body > :first-child', ['list']],
    ['body > :nth-child(2)', ['e1']],
    [':root > :last-child > .list', ['list']],
  ])('%s', (sel, expected) => {
    expect(hit(sel).sort()).toEqual([...expected].sort());
  });

  it('the <head> is the first child of <html> and body is its last', () => {
    const c = project().compile(inputFor('body:first-child { width: 1px; } body:nth-child(2):last-child:first-of-type { height: 2px; } :root:first-child:only-child { width: 3px; }', items));
    expect(explainOne(c, 'ios', 'body', 'width').value).toBe('auto');
    expect(explainOne(c, 'ios', 'body', 'height').value).toBe('2px');
    expect(explainOne(c, 'ios', 'html', 'width').value).toBe('3px');
  });

  it(':empty counts whitespace-only text as content (Chrome); the planted spec-reading fault does not', () => {
    expect(hit('.e:empty')).toEqual(['e1']);
    expect(hit('.e:empty', { ...NO_FAULTS, emptyIgnoresWhitespace: true }).sort()).toEqual(['e1', 'e2']);
  });

  it('specificity orders :is() by its most specific argument; the planted fault does not', () => {
    const css = ':is(div, .list .mark) { width: 1px; } div.mark { width: 2px; }';
    expect(widths(css).i2).toBe('1px');
    expect(widths(css, { ...NO_FAULTS, isSpecificityFirstArgument: true }).i2).toBe('2px');
  });

  it('attribute operators and the i flag (Selectors-4 §6)', () => {
    const el = (r: SourceRef, id: string, value: string): ElementNode => ({ ...div(r, id, ['a']), attributes: [attr('ui-x', value)] });
    const cases: [string, string[]][] = [
      ['[ui-x="Ab-c d"]', ['a1']],
      ['[ui-x="ab-c d" i]', ['a1']],
      ['[ui-x~="d"]', ['a1', 'a3']],
      ['[ui-x~=""]', []],
      ['[ui-x|="Ab"]', ['a1', 'a2']],
      ['[ui-x|="ab" i]', ['a1', 'a2']],
      ['[ui-x^="Ab"]', ['a1', 'a2']],
      ['[ui-x^=""]', []],
      ['[ui-x$="d"]', ['a1', 'a3']],
      ['[ui-x*="-c"]', ['a1']],
      ['[ui-x*="B" i]', ['a1', 'a2']],
      ['[UI-X]', ['a1', 'a2', 'a3']],
    ];
    for (const [sel, expected] of cases) {
      const input = inputFor(`.a${sel} { width: 7px; }`, (r) => [el(r, 'a1', 'Ab-c d'), el(r, 'a2', 'Ab'), el(r, 'a3', 'x d')]);
      const c = project().compile(input);
      expect(c.diagnostics, sel).toEqual([]);
      expect(['a1', 'a2', 'a3'].filter((n) => explainOne(c, 'ios', n, 'width').value === '7px'), sel).toEqual(expected);
    }
  });

  it('state-dependent siblings: every reachable case is matched on its own tree', () => {
    const s = new Sources({
      'view.dg': 'component App(extra: boolean = false) { <html><body><div list class="list"><div a class="item" />{extra ? <div x class="item" /> : null}<div b class="item" /></div></body></html> }',
      'app.css': '.item:last-child { width: 9px; } .item:nth-child(2) { height: 5px; } .list:has(> :nth-child(3)) { width: 50px; }',
    });
    const at = (find: string) => s.at('view.dg', find);
    const item = (id: string): ElementNode => ({ kind: 'element', id, tag: 'div', classes: [staticClass({ owner: DOC, sheet: 'app', name: 'item' }, at(`<div ${id}`))], attributes: [], children: [], origin: at(`<div ${id}`) });
    const input = s.input({
      modules: [{ id: 'view', source: s.ref('view.dg').uri }],
      components: [{
        id: 'App', module: 'view', params: [], slots: [], origin: at('component App'),
        states: [{ id: 'extra', domain: [false, true], initial: false, origin: at('extra: boolean = false') }],
        root: [{ kind: 'element', id: 'html', tag: 'html', classes: [], attributes: [], origin: at('<html>'), children: [{ kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], origin: at('<body>'), children: [{
          kind: 'element', id: 'list', tag: 'div', classes: [staticClass({ owner: DOC, sheet: 'app', name: 'list' }, at('<div list'))], attributes: [], origin: at('<div list'),
          children: [item('a'), { kind: 'branch', id: 'br', when: eq('extra', true), then: [item('x')], else: [], origin: at('{extra') }, item('b')],
        }] }] }],
      }],
      documents: [{ id: DOC, rootInstance: 'App', documentElement: 'html', styles: ['app'], initial: [] }],
      styles: [{ id: 'app', css: s.whole('app.css'), scope: { kind: 'document' } }],
    });
    const c = project().compile(input);
    expect(c.diagnostics).toEqual([]);
    const all = (node: string, property: string) => {
      const r = c.explain({ target: 'ios', at: { node, instance: DOC }, property });
      if (r.kind !== 'found') throw new Error(JSON.stringify(r));
      return r.cases.map((k: ExplainedCase) => [JSON.stringify(k.assignment.map((a) => a.value)), k.value]);
    };
    expect(all('b', 'width')).toEqual([['[false]', '9px'], ['[true]', '9px']]);
    expect(all('b', 'height')).toEqual([['[false]', '5px'], ['[true]', 'auto']]);
    expect(all('x', 'height')).toEqual([['[true]', '5px']]);
    expect(all('list', 'width')).toEqual([['[false]', 'auto'], ['[true]', '50px']]);
  });
});

describe('TREE: ids, every attribute name, HTML case-insensitive attribute values and Chrome-invalid rule drops', () => {
  const el = (r: SourceRef, id: string, attrs: [string, string][]): ElementNode => ({ ...div(r, id, ['a']), attributes: attrs.map(([n, v]) => attr(n, v)) });
  const tree = (r: SourceRef): TreeNode[] => [el(r, 'a1', [['id', 'x'], ['rel', 'foo'], ['data-x', 'foo'], ['title', '']]), el(r, 'a2', [['id', 'X'], ['rel', 'FOO'], ['data-x', 'FOO']]), el(r, 'a3', [['id', 'x y']])];
  const hitsOf = (css: string, faults = NO_FAULTS): string[] => {
    const c = project(faults).compile(inputFor(css, tree));
    expect(c.diagnostics.filter((d) => d.severity === 'error'), css).toEqual([]);
    return ['a1', 'a2', 'a3'].filter((n) => explainOne(c, 'ios', n, 'width').value === '7px');
  };

  it.each([
    ['#x', ['a1']],
    ['.a#X', ['a2']],
    ['[rel=FOO]', ['a1', 'a2']],
    ['[rel~=foo]', ['a1', 'a2']],
    ['[data-x=FOO]', ['a2']],
    ['[data-x=FOO i]', ['a1', 'a2']],
    ['[title]', ['a1']],
    ['[id="x y"]', ['a3']],
  ])('%s', (sel, expected) => {
    expect(hitsOf(`${sel} { width: 7px; }`)).toEqual(expected);
  });

  it('an id beats any number of classes; the planted fault idSpecificityAsClass counts it as a class', () => {
    const css = '#x { width: 7px; } .a.a.a { width: 8px; }';
    expect(hitsOf(css)).toEqual(['a1']);
    expect(hitsOf(css, { ...NO_FAULTS, idSpecificityAsClass: true })).toEqual([]);
    expect(specificity('div#x.a')).toEqual([1, 1, 1]);
  });

  it('the planted fault attributeCaseAlwaysSensitive ignores HTML\'s list', () => {
    expect(hitsOf('[rel=FOO] { width: 7px; }', { ...NO_FAULTS, attributeCaseAlwaysSensitive: true })).toEqual(['a2']);
  });

  it('a list with a selector Chrome does not parse drops the whole rule with one warning; the planted fault keeps the rest', () => {
    const css = '.a, .a::-moz-range-thumb { width: 7px; }';
    const { selectors, diagnostics } = parse(css);
    expect(diagnostics.map((d) => [d.code, d.severity])).toEqual([['DRAGON_SELECTOR_DROPPED', 'warning']]);
    expect(diagnostics[0]?.message).toContain('::-moz-range-thumb');
    expectCatalogued(diagnostics);
    expect(selectors.map((s) => s.dropped)).toEqual([true]);
    expect(hitsOf(css)).toEqual([]);
    expect(hitsOf(css, { ...NO_FAULTS, invalidSelectorListKept: true })).toEqual(['a1', 'a2', 'a3']);
    // Chrome drops the rule, so a Dragon refusal elsewhere in the list is moot.
    expect(parse('.a:hover, .a:-moz-focusring { width: 1px; }').diagnostics.map((d) => d.code)).toEqual(['DRAGON_SELECTOR_DROPPED']);
    // Chrome never parses the block of a dropped rule, so unsupported declarations in it are not errors.
    expect(parse('.a, .a::-moz-range-thumb { -webkit-appearance: none; display: grid; @media (width > 1px) {} }').diagnostics.map((d) => d.code)).toEqual(['DRAGON_SELECTOR_DROPPED']);
    expect(hitsOf('.a, .a::-moz-range-thumb { width: 7px; background: transparent; border: none; }')).toEqual([]);
  });

  it('Chrome-valid pseudo-elements stay refused and name their owner package; inside :is() an invalid one is refused', () => {
    const msg = (css: string): string[] => parse(css).diagnostics.map((d) => `${d.code} ${d.message}`);
    // FORM-a A4 handles the range's thumb and track pseudo-elements at the end of a top-level selector; elsewhere they stay refused.
    expect(msg('.a::-webkit-slider-thumb { width: 1px; }')).toEqual([]);
    expect(msg('.a::-webkit-slider-runnable-track { width: 1px; }')).toEqual([]);
    expect(parse('input.a::-webkit-slider-thumb { width: 1px; }').selectors.map((x) => [x.pseudoElement, x.specificity])).toEqual([['thumb', [0, 1, 2]]]);
    expect(parse('.a::-webkit-slider-runnable-track, .a { width: 1px; }').selectors.map((x) => x.pseudoElement)).toEqual(['track', null]);
    expect(msg(':not(.a::-webkit-slider-thumb) { width: 1px; }')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*inside a selector argument/)]);
    expect(msg('.a::-webkit-slider-thumb .b { width: 1px; }')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*range pseudo-element is not supported/)]);
    expect(msg('.a::-webkit-slider-container { width: 1px; }')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR /)]);
    expect(msg('.a::-webkit-scrollbar-thumb { width: 1px; }')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*OVFL-s/)]);
    expect(msg(':is(.a::-moz-range-thumb) { width: 1px; }')).toEqual([expect.stringMatching(/^DRAGON_UNSUPPORTED_SELECTOR .*forgiving/)]);
    expect(parse('[ns|x] { width: 1px; }').diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_SELECTOR']);
  });
});

describe('TW-SWEEP: class tokens that are not identifiers, and escaped class selectors', () => {
  const tree = (r: SourceRef): TreeNode[] => [div(r, 'half', ['w-1/2']), div(r, 'dot', ['p-0.5']), div(r, 'at', ['@container']), div(r, 'a', ['a'])];
  const width = (css: string, node: string): string => {
    const c = project().compile(inputFor(`${css} { width: 7px; }`, tree));
    expect(c.diagnostics).toEqual([]);
    return explainOne(c, 'ios', node, 'width').value;
  };

  it.each([
    ['.w-1\\/2', 'half'],
    ['.p-0\\.5', 'dot'],
    ['.\\@container', 'at'],
    ['.\\61', 'a'],
    ['.\\000061', 'a'],
    [':where(.w-1\\/2)', 'half'],
  ])('%s matches the class Chrome matches (css-syntax-3 §4.3.7 escapes)', (sel, node) => {
    expect(width(sel, node)).toBe('7px');
  });

  it('an escape that spells another class does not match the written text', () => {
    expect(width('.w-1\\/3', 'half')).toBe('auto');
    expect(width('.\\62', 'a')).toBe('auto');
  });

  it('a class symbol name is one class token: any text without ASCII white space', () => {
    const named = (name: string) => project().compile(inputFor('.x { width: 1px; }', (r) => [{ ...div(r, 'n', []), classes: [staticClass({ owner: DOC, sheet: 's', name }, { kind: 'authored', span: { source: r, start: 0, end: 0 } })] }]));
    expect(named('w-1/2').diagnostics).toEqual([]);
    for (const bad of ['', 'a b', 'a\tb', 'a\nb']) expect(named(bad).diagnostics.map((d) => d.code), JSON.stringify(bad)).toEqual(['DRAGON_INPUT_INVALID']);
  });
});
