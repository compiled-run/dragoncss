// css-display-3 §2.5: a display: contents element generates no box; its children take its place in its parent's box, and its text
// collapses in its parent's inline formatting context (parity fixture display-contents checks the boxes against Chrome).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import type { LayoutBox } from '@dragon/layout';
import { createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const CSS = 'body { font-family: Ahem; } .ct { display: contents; } .f { display: flex; } .b::before { content: "b"; }';

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

function lowered(tree: (r: SourceRef) => TreeNode[]): ReturnType<typeof iosLayoutProjection> {
  const project = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });
  return iosLayoutProjection(project.compile(inputFor(CSS, tree)), ENV, []);
}

/** The children of box c as ids and texts. */
function shape(tree: (r: SourceRef) => TreeNode[]): unknown {
  const p = lowered(tree);
  if (p.kind !== 'ready') throw new Error(`projection blocked: ${p.reason}`);
  const find = (b: LayoutBox): LayoutBox | null => (b.id === 'c' ? b : b.children.flatMap((k) => (k.kind === 'box' ? [find(k)] : [])).find((x) => x !== null) ?? null);
  const c = find(p.input.root);
  if (c === null) throw new Error('no box c');
  const of = (k: LayoutBox['children'][number]): unknown => (k.kind === 'box' ? { box: k.id, children: k.children.map(of) } : k.kind === 'text' ? { text: k.id, value: k.text } : { [k.kind]: k.id, ...(k.kind === 'inline' ? { children: k.children.map(of) } : {}) });
  return c.children.map(of);
}

describe('display: contents', () => {
  it('its text joins the parent\'s inline formatting context, so the spaces around it collapse as without the element', () => {
    expect(shape((r) => [el(r, 'c', 'div', [], [text(r, 't0', 'xx '), el(r, 's', 'span', ['ct'], [text(r, 't1', ' yy ')]), text(r, 't2', ' ww')])])).toEqual([
      { text: 'c:text0', value: 'xx ' },
      { text: 's:text0', value: 'yy ' },
      { text: 'c:text1', value: 'ww' },
    ]);
  });
  it('its block children are the parent\'s, nested contents too, and a flex container\'s become its flex items', () => {
    expect(shape((r) => [el(r, 'c', 'div', [], [el(r, 'k', 'div', ['ct'], [el(r, 'a', 'div'), el(r, 'n', 'div', ['ct'], [el(r, 'b', 'div')])])])])).toEqual([
      { box: 'a', children: [] },
      { box: 'b', children: [] },
    ]);
    expect(shape((r) => [el(r, 'c', 'div', ['f'], [el(r, 'k', 'span', ['ct'], [text(r, 't', 'loose'), el(r, 's', 'b', [], [text(r, 'u', 'x')])])])])).toEqual([
      { box: 'c:anon0', children: [{ text: 'k:text0', value: 'loose' }] },
      { box: 's', children: [{ text: 's:text0', value: 'x' }] },
    ]);
  });
  it('its ::before is generated in its place', () => {
    expect(shape((r) => [el(r, 'c', 'div', [], [el(r, 'k', 'span', ['ct', 'b'], [text(r, 't', 'q')])])])).toEqual([
      { inline: 'k::before', children: [{ text: 'k::before:text0', value: 'b' }] },
      { text: 'k:text0', value: 'q' },
    ]);
  });
  it('on a replaced element is refused on every target (Chrome computes it to none)', () => {
    const project = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });
    const c = project.compile(inputFor(CSS, (r) => [el(r, 'c', 'div', [], [el(r, 'i', 'img', ['ct'])])]));
    expect(c.diagnostics.filter((d) => d.message.startsWith('display: contents')).map((d) => `${d.code} ${String(d.target)}`)).toEqual(['DRAGON_UNSUPPORTED_VALUE ios', 'DRAGON_UNSUPPORTED_VALUE web']);
  });
});
