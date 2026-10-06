// GEN-b (notes/T151-gen-spec.md R13): content and the list-style longhands, the list-style shorthand's none rule, content on
// elements (accepted for normal, none and strings, with no effect), list items whose marker generates no box, and the four plants.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, explainOne, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/lists.css', revision: 'r1', hash: 'sha256:0' };
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ahem' } as const;
const FONT = 'body { font-family: Ahem; }';

/** The longhands one declaration sets, as [property, value, explicit], or its diagnostic. */
function parsed(property: string, value: string): { readonly longhands: readonly (readonly [string, string, boolean])[] } | { readonly code: string; readonly message: string; readonly span: string } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const d = diagnostics[0];
  if (d !== undefined) {
    if (diagnostics.length > 1) throw new Error(`${property}: ${value}: more than one diagnostic`);
    const span = d.origin.kind === 'authored' ? css.slice(d.origin.span.start, d.origin.span.end) : '';
    return { code: d.code, message: d.message, span };
  }
  return { longhands: (rules[0]?.declarations[0]?.longhands ?? []).map((l) => [l.property, valueToString(l.value), l.explicit] as const) };
}

const project = (faults: CompilerFaults = NO_FAULTS) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** The Tailwind preflight shape: a list with list-style: none, its items holding text and a nested padded block. */
const preflight = (r: SourceRef): TreeNode[] => [el(r, 'ul', 'ul', ['n'], [el(r, 'li1', 'li', [], [text(r, 't1', 'XX')]), el(r, 'li2', 'li', [], [el(r, 'b', 'div', ['p'], [text(r, 't2', 'X')])])])];
const PREFLIGHT_CSS = `${FONT} .n { list-style: none; margin: 0; padding: 0; } .p { padding: 2px; }`;

const messages = (faults: CompilerFaults, css: string, body: (r: SourceRef) => TreeNode[]): string[] => project(faults).compile(inputFor(css, body)).diagnostics.map((d) => `${d.code} ${String(d.target)} ${d.message}`);

describe('content (css-content-3 §2)', () => {
  it('parses normal, none and strings; adjacent strings join into one string, serialized as Chrome does', () => {
    expect(parsed('content', 'normal')).toEqual({ longhands: [['content', 'normal', true]] });
    expect(parsed('content', 'NONE')).toEqual({ longhands: [['content', 'none', true]] });
    expect(parsed('content', "'a'")).toEqual({ longhands: [['content', '"a"', true]] });
    expect(parsed('content', `'a' "b" ''`)).toEqual({ longhands: [['content', '"ab"', true]] });
    expect(parsed('content', `'say "hi"\\\\'`)).toEqual({ longhands: [['content', '"say \\"hi\\"\\\\"', true]] });
  });
  it('refuses counters, quotes, attr(), images and alternative text at the token, naming the package that owns each', () => {
    const refused = (v: string) => {
      const p = parsed('content', v);
      return 'code' in p ? [p.code, p.span, p.message] : p;
    };
    expect(refused('counter(x)')).toEqual(['DRAGON_UNSUPPORTED_VALUE', 'counter(x)', 'content: counter(x) is not supported yet: counters and their scopes (GEN-d1)']);
    expect(refused("'a' counters(x, '.')")).toEqual(['DRAGON_UNSUPPORTED_VALUE', "counters(x, '.')", `content: counters(x,".") is not supported yet: counters and their scopes (GEN-d1)`]);
    expect(refused('open-quote')).toEqual(['DRAGON_UNSUPPORTED_VALUE', 'open-quote', 'content: open-quote is not supported yet: quotes and the quote depth (GEN-d2)']);
    expect(refused('attr(data-x)')).toEqual(['DRAGON_UNSUPPORTED_VALUE', 'attr(data-x)', 'content: attr(data-x) is not supported yet: attr() (GEN-d3)']);
    expect(refused('url(x.png)')).toEqual(['DRAGON_UNSUPPORTED_VALUE', 'url(x.png)', 'content: url(x.png) is not supported yet: an image in content: images in generated content and list-style-image (GEN-d4)']);
    expect(refused("'a' / 'alt'")).toEqual(['DRAGON_UNSUPPORTED_VALUE', '/', 'content: / is not supported yet: alternative text after "/": the accessible name of generated content (GEN-d5)']);
  });
  it('on an element: none computes to normal and strings are kept, with no diagnostic; the plant contentNoneOnElementKept keeps none', () => {
    const tree = (r: SourceRef) => [el(r, 'a', 'div', ['none'], [text(r, 't', 'X')]), el(r, 'b', 'div', ['str']), el(r, 'c', 'div', ['normal'])];
    const css = `${FONT} .none { content: none; } .str { content: 'a' 'b'; } .normal { content: normal; }`;
    const c = project().compile(inputFor(css, tree));
    expect(c.diagnostics).toEqual([]);
    expect(['a', 'b', 'c'].map((id) => explainOne(c, 'ios', id, 'content').value)).toEqual(['normal', '"ab"', 'normal']);
    const planted = project({ ...NO_FAULTS, contentNoneOnElementKept: true }).compile(inputFor(css, tree));
    expect(explainOne(planted, 'ios', 'a', 'content').value).toBe('none');
  });
});

describe('list-style-type, list-style-position, list-style-image (css-lists-3 §3)', () => {
  it('list-style-type takes a counter-style name, a string or none; list-style-position inside or outside', () => {
    expect(parsed('list-style-type', 'Square')).toEqual({ longhands: [['list-style-type', 'square', true]] });
    expect(parsed('list-style-type', "'>> '")).toEqual({ longhands: [['list-style-type', '">> "', true]] });
    expect(parsed('list-style-type', 'none')).toEqual({ longhands: [['list-style-type', 'none', true]] });
    expect(parsed('list-style-position', 'inside')).toEqual({ longhands: [['list-style-position', 'inside', true]] });
  });
  it('list-style-image: none is accepted and an image refused, naming GEN-d4', () => {
    expect(parsed('list-style-image', 'none')).toEqual({ longhands: [['list-style-image', 'none', true]] });
    expect(parsed('list-style-image', 'url(x.png)')).toMatchObject({ code: 'DRAGON_UNSUPPORTED_VALUE', span: 'url(x.png)', message: 'list-style-image: url(x.png) is not supported yet: images in generated content and list-style-image (GEN-d4)' });
  });
  it('the list-style shorthand: a none sets whichever of image and type nothing else set, and a lone none sets both (§3.4)', () => {
    const ls = (v: string) => parsed('list-style', v);
    const all = (position: string, pe: boolean, image: string, ie: boolean, type: string, te: boolean) => ({ longhands: [['list-style-position', position, pe], ['list-style-image', image, ie], ['list-style-type', type, te]] });
    expect(ls('none')).toEqual(all('outside', false, 'none', true, 'none', true));
    expect(ls('none inside')).toEqual(all('inside', true, 'none', true, 'none', true));
    expect(ls('inside none')).toEqual(all('inside', true, 'none', true, 'none', true));
    expect(ls('none none')).toEqual(all('outside', false, 'none', true, 'none', true));
    expect(ls('square none')).toEqual(all('outside', false, 'none', true, 'square', true));
    expect(ls('none square')).toEqual(all('outside', false, 'none', true, 'square', true));
    expect(ls("'>> ' inside")).toEqual(all('inside', true, 'none', false, '">> "', true));
    expect(ls('inside')).toEqual(all('inside', true, 'none', false, 'disc', false));
    expect(ls('url(x.png) none')).toMatchObject({ code: 'DRAGON_UNSUPPORTED_VALUE', span: 'url(x.png)' });
    expect(ls('none none none')).toMatchObject({ code: 'DRAGON_CSS_INVALID_VALUE' });
  });
});

describe('list items (display: list-item) whose marker generates no box', () => {
  it('the preflight shape compiles on every target and lays the items out as blocks', () => {
    expect(messages(NO_FAULTS, PREFLIGHT_CSS, preflight)).toEqual([]);
    const p = iosLayoutProjection(project().compile(inputFor(PREFLIGHT_CSS, preflight)), ENV, []);
    if (p.kind !== 'ready') throw new Error(`projection blocked: ${p.reason}`);
    const ul = p.input.root.children.flatMap((b) => (b.kind === 'box' ? b.children : [])).find((b) => b.kind === 'box' && b.id === 'ul') as LayoutBox | undefined;
    expect(ul?.children.map((b) => (b.kind === 'box' ? [b.id, b.style.display] : [b.kind]))).toEqual([['li1', 'block'], ['li2', 'block']]);
  });
  it('list-style-type: none on the item itself, or on a list-item div, is enough; an li in a flex list is a flex item', () => {
    expect(messages(NO_FAULTS, `${FONT} .n { list-style-type: none; } .d { display: list-item; list-style-type: none; } .f { display: flex; }`, (r) => [
      el(r, 'ul', 'ul', [], [el(r, 'li', 'li', ['n'], [text(r, 't', 'X')])]),
      el(r, 'd', 'div', ['d'], [text(r, 'u', 'X')]),
      el(r, 'e', 'div', ['d']),
      el(r, 'fl', 'ul', ['f', 'n'], [el(r, 'fi', 'li', [], [text(r, 'v', 'X')])]),
    ])).toEqual([]);
  });
  it('an item with a marker is refused on every target, naming its type and GEN-c', () => {
    const want = (type: string, id = 'li') => [`DRAGON_UNSUPPORTED_VALUE ios display: list-item on <li> ${id} generates a ${type} marker (::marker, css-lists-3 §3), which Dragon draws from the GEN-c package`, `DRAGON_UNSUPPORTED_VALUE web display: list-item on <li> ${id} generates a ${type} marker (::marker, css-lists-3 §3), which Dragon draws from the GEN-c package`];
    expect(messages(NO_FAULTS, FONT, (r) => [el(r, 'ul', 'ul', [], [el(r, 'li', 'li')])])).toEqual(want('disc'));
    expect(messages(NO_FAULTS, `${FONT} .s { list-style: '>> '; }`, (r) => [el(r, 'ul', 'ul', ['s'], [el(r, 'li', 'li')])])).toEqual(want('">> "'));
    expect(messages(NO_FAULTS, `${FONT} .s { list-style: square inside; }`, (r) => [el(r, 'ul', 'ul', ['s'], [el(r, 'li', 'li')])])).toEqual(want('square'));
  });
  it('an inline or flow-root list item stays refused as a multi-keyword display', () => {
    expect(messages(NO_FAULTS, `${FONT} .i { display: flow-root list-item; list-style: none; }`, (r) => [el(r, 'd', 'div', ['i'])])).toEqual(['DRAGON_UNSUPPORTED_VALUE null multi-token value "flow-root list-item" for display is not supported in milestone 1']);
  });
  it('plants: listItemNoneMarkerRefused refuses the preflight shape, listStyleNoneSetsImageOnly leaves its items a disc marker, and listItemDiscAccepted accepts the UA disc', () => {
    expect(messages({ ...NO_FAULTS, listItemNoneMarkerRefused: true }, PREFLIGHT_CSS, preflight).filter((m) => m.includes('generates a none marker'))).toHaveLength(4);
    expect(messages({ ...NO_FAULTS, listStyleNoneSetsImageOnly: true }, PREFLIGHT_CSS, preflight).filter((m) => m.includes('generates a disc marker'))).toHaveLength(4);
    expect(messages({ ...NO_FAULTS, listItemDiscAccepted: true }, FONT, (r) => [el(r, 'ul', 'ul', [], [el(r, 'li', 'li')])])).toEqual([]);
  });
});
