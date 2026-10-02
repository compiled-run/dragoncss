// TDEC-a (notes/T148J-tdec.md): the text-decoration longhands and shorthand, the a:any-link UA rule, propagation (css-text-decor-3
// §2.1) and the refusals. Chrome agreement is in packages/parity/test/text-decoration.test.ts.
import { describe, expect, it } from 'vitest';
import type { AttributeBinding, ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { LinkedElement, LinkedText } from '../src/analysis/link.ts';
import type { ResolvedElement, ResolvedValue } from '../src/analysis/resolve.ts';
import { resolveTree, valueToString } from '../src/analysis/resolve.ts';
import { analyzeDecorations, applyAnyLink } from '../src/analysis/text-decoration.ts';
import type { Longhand } from '../src/css/properties.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { always, DOC, inputFor, staticClass, text } from './helpers.ts';

const SRC: SourceRef = { uri: 's.css', revision: 'r', hash: 'h' };
const ORIGIN: Origin = { kind: 'unlocated', reason: 'test' };

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = [], attrs: Record<string, string> = {}): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  const attributes: AttributeBinding[] = Object.entries(attrs).map(([name, value]) => ({ name, value: [{ when: always, value }], origin }) as unknown as AttributeBinding);
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes, children, origin };
}

function declare(decl: string): { set: string[]; codes: string[] } {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 's', owner: DOC, scope: 'document' }, 0, diagnostics);
  return { set: (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}=${valueToString(l.value)}${l.explicit ? '' : ' (reset)'}`), codes: diagnostics.map((d) => d.code) };
}

function resolve(css: string, tree: (r: SourceRef) => TreeNode[]): ResolvedElement {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 'sheet', owner: DOC, scope: 'document' }, 0, diagnostics);
  expect(diagnostics).toEqual([]);
  // Text nodes get the address the linker gives them: <parent>:text<n>.
  const linked = (n: TreeNode, parent: string, i: number): LinkedElement | LinkedText | null => n.kind === 'text'
    ? { kind: 'text', address: `${parent}:text${i}`, node: n, instance: DOC, owner: DOC, text: n.text }
    : n.kind !== 'element' ? null : {
      kind: 'element', address: n.id, instance: DOC, owner: DOC, tag: n.tag, node: n,
      attributes: new Map(n.attributes.map((a) => [a.name, (a.value[0] as { value: string }).value])),
      classes: n.classes.map((c) => ({ owner: DOC, sheet: 'sheet', name: (c.value[0] as { value: { name: string } }).value.name })),
      children: kids(n.children, n.id),
    } as LinkedElement;
  const kids = (ns: readonly TreeNode[], parent: string): (LinkedElement | LinkedText)[] => {
    let t = 0;
    return ns.map((n) => linked(n, parent, n.kind === 'text' ? t++ : 0)).filter((c): c is LinkedElement | LinkedText => c !== null);
  };
  const body = { kind: 'element', address: 'body', instance: DOC, owner: DOC, tag: 'body', classes: [], attributes: new Map(), children: kids(tree(SRC), 'body'), node: { kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], children: [], origin: ORIGIN } } as unknown as LinkedElement;
  return resolveTree({ ...body, address: 'html', tag: 'html', children: [body] } as LinkedElement, rules, NO_FAULTS, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
}

const find = (root: ResolvedElement, id: string): ResolvedElement => {
  const go = (e: ResolvedElement): ResolvedElement | null => {
    if (e.element.address === id) return e;
    for (const c of e.children) if (c.kind === 'element') {
      const hit = go(c);
      if (hit !== null) return hit;
    }
    return null;
  };
  const hit = go(root);
  if (hit === null) throw new Error(id);
  return hit;
};
const v = (e: ResolvedElement, p: Longhand): string => valueToString((e.props.get(p) as ResolvedValue).value);

describe('the text-decoration longhands and shorthand', () => {
  it('expands line || thickness || style || color, resetting what the value omits; lines keep Chrome\'s order', () => {
    expect(declare('text-decoration: overline underline 2px red').set).toEqual(['text-decoration-line=underline overline', 'text-decoration-thickness=2px', 'text-decoration-style=solid (reset)', 'text-decoration-color=rgb(255, 0, 0)']);
    expect(declare('text-decoration: none').set).toEqual(['text-decoration-line=none', 'text-decoration-thickness=auto (reset)', 'text-decoration-style=solid (reset)', 'text-decoration-color=currentcolor (reset)']);
    expect(declare('text-decoration-line: line-through overline underline').set).toEqual(['text-decoration-line=underline overline line-through']);
  });
  it('refuses what TDEC-a does not draw and drops what Chrome does not parse', () => {
    for (const d of ['text-decoration-line: blink', 'text-decoration-line: spelling-error', 'text-decoration-style: wavy', 'text-decoration-style: dotted', 'text-decoration-thickness: from-font', 'text-underline-position: under', 'text-decoration: underline wavy', 'text-decoration: underline from-font']) expect(declare(d).codes, d).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    for (const d of ['text-decoration-thickness: thin', 'text-decoration-skip-ink: all', 'text-decoration-line: underline underline', 'text-decoration-line: none underline', 'text-underline-offset: from-font']) expect(declare(d).codes, d).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    for (const d of ['text-decoration-thickness: 10%', 'text-underline-offset: -2px', 'text-decoration-skip-ink: none', 'text-decoration-color: rgba(167, 175, 189, 0.45)', 'text-decoration: underline 0.1em solid currentcolor']) expect(declare(d).codes, d).toEqual([]);
  });
});

describe('a:any-link (html.css:1501-1505)', () => {
  it('an a with an href computes the captured link colour and an underline unless the author sets them', () => {
    const root = resolve('body { color: rgb(1, 2, 3); } .c { color: rgb(9, 9, 9); } .n { text-decoration: none; }', (r) => [
      el(r, 'l', 'a', [], [text(r, 't', 'X')], { href: 'https://example.com/' }),
      el(r, 'c', 'a', ['c', 'n'], [], { href: '#' }),
      el(r, 'p', 'a', [], []),
    ]);
    expect([v(find(root, 'l'), 'color'), v(find(root, 'l'), 'text-decoration-line')]).toEqual(['rgb(0, 0, 238)', 'underline']);
    expect(find(root, 'l').props.get('color')?.origin).toBe('user-agent');
    expect([v(find(root, 'c'), 'color'), v(find(root, 'c'), 'text-decoration-line')]).toEqual(['rgb(9, 9, 9)', 'none']);
    expect([v(find(root, 'p'), 'color'), v(find(root, 'p'), 'text-decoration-line')]).toEqual(['rgb(1, 2, 3)', 'none']);
  });
  it('identity: on an element that is not a hyperlink the hook changes no longhand', () => {
    const root = resolve('.x { color: rgb(4, 5, 6); text-decoration: underline; }', (r) => [el(r, 'd', 'div', ['x'], [el(r, 's', 'span'), el(r, 'a', 'a'), el(r, 'h', 'span', [], [], { href: '#' })])]);
    for (const id of ['d', 's', 'a', 'h']) {
      const e = find(root, id);
      const before = new Map(e.props);
      applyAnyLink(e.element, new Map(e.props), new Set(LONGHANDS), referenceDataset());
      const after = new Map(e.props);
      applyAnyLink(e.element, after, new Set(LONGHANDS), referenceDataset());
      for (const p of LONGHANDS) expect(after.get(p), `${id} ${p}`).toBe(before.get(p));
    }
  });
});

describe('propagation (css-text-decor-3 §2.1)', () => {
  const css = 'body { font-family: Ahem; } .u { text-decoration: underline red; } .o { text-decoration: overline; } .f { display: flex; } .ab { position: absolute; } .if { display: inline-flex; } .ib { display: inline-block; }';
  const tree = (r: SourceRef) => [el(r, 'u', 'div', ['u'], [
    text(r, 'ut', 'A'),
    el(r, 'b', 'div', [], [text(r, 'bt', 'B')]),
    el(r, 'i', 'span', ['o'], [text(r, 'it', 'C')]),
    el(r, 'f', 'div', ['f'], [el(r, 'fi', 'div', [], [text(r, 'fit', 'D')])]),
    el(r, 'ab', 'div', ['ab'], [text(r, 'abt', 'E')]),
    el(r, 'if', 'div', ['if'], [text(r, 'ift', 'F')]),
  ])];
  it('reaches in-flow block children, inline boxes and flex items, outermost first, and never out-of-flow boxes or atomic inlines', () => {
    const { applied, unproven } = analyzeDecorations(resolve(css, tree));
    const of = (t: string): string[] => (applied.get(t) ?? []).map((d) => `${d.box}:${d.lines.join('+')}`);
    expect(of('u:text0')).toEqual(['u:underline']);
    expect(of('b:text0')).toEqual(['u:underline']);
    expect(of('i:text0')).toEqual(['u:underline', 'i:overline']);
    expect(of('fi:text0')).toEqual(['u:underline']);
    expect(of('ab:text0')).toEqual([]);
    expect(of('if:text0')).toEqual([]);
    // An atomic inline takes none either, but with no Chrome case it is refused as unproven.
    expect(unproven).toEqual([{ address: 'if', box: 'u' }]);
    expect(applied.get('u:text0')?.[0]?.color).toEqual({ r: 255, g: 0, b: 0, alpha: 255 });
  });
  it('the propagatedIntoOutOfFlow plant decorates the absolutely positioned box', () => {
    const { applied } = analyzeDecorations(resolve(css, tree), undefined, { propagatedIntoOutOfFlow: true });
    expect((applied.get('ab:text0') ?? []).map((d) => d.box)).toEqual(['u']);
  });
});

describe('the targets', () => {
  const project = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });
  it('web accepts decorated text; ios refuses it naming TDEC-b; undecorated text compiles on ios', () => {
    const c = project().compile(inputFor('body { font-family: Ahem; } .u { text-decoration: underline; }', (r) => [el(r, 'u', 'div', ['u'], [text(r, 't', 'XX')]), el(r, 'p', 'div', [], [text(r, 'q', 'XX')])]));
    expect(c.diagnostics.map((d) => `${d.code} ${String(d.target)} ${d.message}`)).toEqual(['DRAGON_UNSUPPORTED_VALUE ios text u:text0 draws text-decoration (underline from u); ios draws decorations from TDEC-b']);
    expect(c.outputs.web.kind).toBe('ready');
    expect(c.outputs.ios.kind).toBe('blocked');
  });
});
