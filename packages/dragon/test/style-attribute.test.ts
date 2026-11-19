// css-style-attr §3-§4 and css-cascade-5 §6.2: a style attribute is a declaration block attached to its element, beating every
// selector at the same importance; its values may follow state; what Dragon cannot read from it is refused by name, at the attribute.
// The Chrome comparisons are the parity fixtures attr-style-cascade and attr-style-visually-hidden.
import { describe, expect, it } from 'vitest';
import type { LinkedElement } from '../src/analysis/link.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { resolveTree } from '../src/analysis/resolve.ts';
import { rankLayers } from '../src/analysis/layers.ts';
import { parseStyleAttribute, parseStylesheet } from '../src/css/stylesheet.ts';
import { NO_FAULTS } from '../src/faults.ts';
import { createProject } from '../src/index.ts';
import type { ElementNode } from '../src/index.ts';
import type { AttributeBinding, Diagnostic, Span } from '../src/types.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { always, div, eq, expectCatalogued, inputFor, not } from './helpers.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const AT: Span = { source: { uri: 'a.tsrx', revision: 'r', hash: 'h' }, start: 10, end: 40 };
const styleAttr = (value: string): AttributeBinding => ({ name: 'style', value: [{ when: always, value }], origin: { kind: 'authored', span: AT } });
const el = (id: string, classes: string[], style: string | null, children: LinkedElement[] = [], tag = 'div', htmlId: string | null = null): LinkedElement => {
  const attributes: [string, string][] = [...(style === null ? [] : [['style', style] as [string, string]]), ...(htmlId === null ? [] : [['id', htmlId] as [string, string]])];
  return {
    kind: 'element', address: id, instance: 'doc', owner: 'App', tag, classes: classes.map((name) => ({ owner: 'o', sheet: 'sheet', name })), attributes: new Map(attributes), children,
    node: { kind: 'element', id, tag, classes: [], attributes: style === null ? [] : [styleAttr(style)], children: [], origin: { kind: 'unlocated', reason: 'test' } },
  };
};

function resolved(css: string, targets: LinkedElement[]): ResolvedElement[] {
  const diagnostics: Diagnostic[] = [];
  const layers: string[] = [];
  const parsed = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, diagnostics, [], [], [], [], NO_FAULTS, layers);
  const rules = rankLayers(parsed, layers, NO_FAULTS, diagnostics);
  expect(diagnostics).toEqual([]);
  const root = resolveTree(el('html', [], null, [el('body', [], null, targets, 'body')], 'html'), rules, NO_FAULTS, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
  return (root.children[0] as ResolvedElement).children as ResolvedElement[];
}
const value = (e: ResolvedElement, p: string): string => {
  const v = e.props.get(p as never)?.value;
  return v?.kind === 'length' ? `${v.value}${v.unit}` : JSON.stringify(v);
};

describe('the style attribute in the cascade', () => {
  it('beats every selector at the same importance, layered or not, and loses to an !important rule unless it is !important itself (Chrome 145 agrees)', () => {
    const css = '#x { width: 30px; } div#x.t.t { width: 40px; } .i { width: 50px !important; } @layer l { .l { width: 60px !important; } }';
    const [a, b, c, d, e] = resolved(css, [
      el('a', ['t'], 'width: 21px', [], 'div', 'x'),
      el('b', ['t'], 'width: 22px; width: 23px', [], 'div', 'x'),
      el('c', ['i'], 'width: 24px'),
      el('d', ['i'], 'width: 25px !important'),
      el('e', ['l'], 'width: 26px !important'),
    ]) as ResolvedElement[];
    expect([a, b, c, d, e].map((x) => value(x as ResolvedElement, 'width'))).toEqual(['21px', '23px', '50px', '25px', '26px']);
    expect((a as ResolvedElement).props.get('width')?.declaration?.attached).toBe(true);
  });

  it('declares custom properties its own element and its children read, and reads the ones its rules declare', () => {
    const [h] = resolved('.f { --w: 7px; } .k { width: var(--w); }', [el('h', ['f'], '--w: 9px; height: var(--w)', [el('k', ['k'], null)])]);
    expect(value(h as ResolvedElement, 'height')).toBe('9px');
    expect(value((h as ResolvedElement).children[0] as ResolvedElement, 'width')).toBe('9px');
  });

  it('rolls revert-layer back to the unlayered rules first, then to the layers below them, as Chrome 145 does', () => {
    // Chrome: 50px, red, blue, blue, and margin-left 50px.
    expect(value(resolved('div { width: 50px; }', [el('a', [], 'width: revert-layer')])[0] as ResolvedElement, 'width')).toBe('50px');
    const color = (css: string): string => value(resolved(css, [el('a', [], 'color: revert-layer')])[0] as ResolvedElement, 'color');
    expect(color('@layer l { div { color: blue; } } div { color: red; }')).toBe(value(resolved('div { color: red; }', [el('a', [], null)])[0] as ResolvedElement, 'color'));
    expect(color('@layer l { div { color: blue; } }')).toBe(value(resolved('div { color: blue; }', [el('a', [], null)])[0] as ResolvedElement, 'color'));
    expect(color('@layer l { div { color: blue; } } div { color: revert-layer; }')).toBe(color('@layer l { div { color: blue; } }'));
    expect(value(resolved('div { margin-left: 50px; }', [el('a', [], 'margin: revert-layer')])[0] as ResolvedElement, 'margin-left')).toBe('50px');
  });

  it('maps a flow-relative declaration to the physical side of the element direction, with no stylesheet rule using one', () => {
    const [g] = resolved('.g { margin-left: 4px; }', [el('g', ['g'], 'margin-inline-start: 12px')]);
    expect(value(g as ResolvedElement, 'margin-left')).toBe('12px');
  });
});

describe('parseStyleAttribute', () => {
  it('reads a declaration block with no braces, every span the attribute', () => {
    const out: Diagnostic[] = [];
    const ds = parseStyleAttribute('color: red; ; margin: 1px 2px', AT, out);
    expect(out).toEqual([]);
    expect(ds.map((d) => d.property)).toEqual(['color', 'margin']);
    expect(ds.every((d) => d.attached === true && d.span === AT && d.valueSpan === AT)).toBe(true);
  });

  it('drops an at-rule or a stray token with a parse error at the attribute, keeping the declarations after it', () => {
    const out: Diagnostic[] = [];
    const ds = parseStyleAttribute('@unsupported { splines: reticulating } color: green', AT, out);
    expect(ds.map((d) => d.property)).toEqual(['color']);
    expect(out.map((d) => d.code)).toContain('DRAGON_CSS_PARSE');
    expect(out.every((d) => d.origin.kind === 'authored' && d.origin.span === AT)).toBe(true);
  });

  it('refuses a property Dragon does not resolve as the attribute, with a manual fix', () => {
    const out: Diagnostic[] = [];
    expect(parseStyleAttribute('frobnicate: 1px; width: 1px', AT, out).map((d) => d.property)).toEqual(['width']);
    expect(out.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_ATTRIBUTE']);
    expect(out[0]?.message).toContain('frobnicate');
    expectCatalogued(out);
  });
});

describe('a compiled style attribute', () => {
  const project = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } });
  const withStyle = (style: AttributeBinding['value'], states: { id: string; domain: boolean[]; initial: boolean }[] = []) => {
    const input = inputFor('body { margin: 0; } .a { width: 1px; height: 2px; }', (r) => [{ ...div(r, 'a', ['a']), attributes: [{ name: 'style', value: style, origin: { kind: 'authored', span: { source: r, start: 0, end: 0 } } }] } as ElementNode]);
    const tree = input.tree as NonNullable<typeof input.tree>;
    const origin = { kind: 'unlocated', reason: 'test' } as const;
    return { ...input, tree: { ...tree, components: tree.components.map((c) => ({ ...c, states: states.map((s) => ({ ...s, origin })) })) } };
  };

  it('compiles, and a value that follows a state gives each case its own width', () => {
    const c = project.compile(withStyle([{ when: eq('on', true), value: 'width: 5px' }, { when: not(eq('on', true)), value: 'width: 6px' }], [{ id: 'on', domain: [false, true], initial: false }]));
    expect(c.diagnostics).toEqual([]);
    const r = c.explain({ target: 'ios', at: { node: 'a', instance: 'doc' }, property: 'width' });
    if (r.kind !== 'found') throw new Error(JSON.stringify(r));
    expect(r.cases.map((x) => x.value).sort()).toEqual(['5px', '6px']);
  });

  it('refuses what Dragon reads from stylesheet rules only, by name, at the attribute', () => {
    for (const [style, what] of [['transition: width 1s', 'transition'], ['direction: rtl', 'direction'], ['animation: none', 'animation'], ['width: revert-layer !important', 'width'], ['width: var(--u, revert-layer)', 'width'], ['--w: revert-layer', '--w']] as const) {
      const c = project.compile(withStyle([{ when: always, value: style }]));
      const refusal = c.diagnostics.find((d) => d.code === 'DRAGON_UNSUPPORTED_ATTRIBUTE');
      expect(refusal?.message, style).toContain(`its ${what} declaration`);
      expectCatalogued(c.diagnostics);
    }
  });

  it('checks a value no profile proves as a stylesheet value is checked', () => {
    const c = project.compile(withStyle([{ when: always, value: 'width: 1px; float: left' }]));
    const sheet = project.compile(inputFor('body { margin: 0; } .a { width: 1px; height: 2px; float: left; }', (r) => [div(r, 'a', ['a'])]));
    expect(c.diagnostics.map((d) => `${d.code} ${d.target}`).sort()).toEqual(sheet.diagnostics.map((d) => `${d.code} ${d.target}`).sort());
  });
});
