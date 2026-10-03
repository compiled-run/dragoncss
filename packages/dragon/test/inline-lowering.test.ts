// INL1a compiler theme (notes/T044-inl-spec.md §3): inline boxes and <br>s lowered into the engine input, the anonymous wrapping of
// maximal inline-level runs (CSS2 §9.2.1.1), the two compiler plants, and the refusals of what the inline core does not lay out.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const CSS = 'body { font-family: Ahem; font-size: 10px; } .f20 { font-size: 20px; } .blk { height: 10px; } .pre { white-space-collapse: preserve; } .nw { white-space: nowrap; }';

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const project = (faults: CompilerFaults = NO_FAULTS) => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });
const compile = (tree: (r: SourceRef) => TreeNode[], faults: CompilerFaults = NO_FAULTS) => project(faults).compile(inputFor(CSS, tree));

/** The lowered children of box id: boxes, inline boxes (with their children), <br>s and text leaves (with their text). */
function shapeOf(tree: (r: SourceRef) => TreeNode[], id: string, faults: CompilerFaults = NO_FAULTS): unknown {
  const p = iosLayoutProjection(compile(tree, faults), ENV, []);
  if (p.kind !== 'ready') throw new Error(`projection blocked: ${p.reason}`);
  const find = (b: LayoutBox): LayoutBox | null => (b.id === id ? b : b.children.flatMap((k) => (k.kind === 'box' ? [find(k)] : [])).find((x) => x !== null) ?? null);
  const box = find(p.input.root);
  if (box === null) throw new Error(`no box ${id}`);
  const shape = (k: LayoutBox['children'][number]): unknown => {
    if (k.kind === 'box') return { box: k.id, strut: k.strut === null ? null : k.strut.font.size, children: k.children.map(shape) };
    if (k.kind === 'inline') return { inline: k.id, size: k.font.size, children: k.children.map(shape) };
    if (k.kind === 'br') return { br: k.id, size: k.font.size };
    if (k.kind === 'replaced') return { replaced: k.id };
    return { text: k.id, value: k.text, size: k.font.size };
  };
  return { strut: box.strut === null ? null : box.strut.font.size, children: box.children.map(shape) };
}

describe('inline boxes and <br>s in the engine input', () => {
  const para = (r: SourceRef) => [el(r, 'p', 'div', [], [text(r, 't0', 'a '), el(r, 's', 'span', ['f20'], [text(r, 't1', 'b')]), el(r, 'b', 'br'), text(r, 't2', 'c')])];
  it('text, an inline box with its own font and a <br> are children of the block container, which has the strut', () => {
    expect(shapeOf(para, 'p')).toEqual({
      strut: 10,
      children: [{ text: 'p:text0', value: 'a ', size: 10 }, { inline: 's', size: 20, children: [{ text: 's:text0', value: 'b', size: 20 }] }, { br: 'b', size: 10 }, { text: 'p:text1', value: 'c', size: 10 }],
    });
  });
  it('brAsSpace lowers the <br> as a one-space text leaf', () => {
    expect(shapeOf(para, 'p', { ...NO_FAULTS, brAsSpace: true })).toEqual({
      strut: 10,
      children: [{ text: 'p:text0', value: 'a ', size: 10 }, { inline: 's', size: 20, children: [{ text: 's:text0', value: 'b', size: 20 }] }, { text: 'b', value: ' ', size: 10 }, { text: 'p:text1', value: 'c', size: 10 }],
    });
  });
  const mixed = (r: SourceRef) => [el(r, 'p', 'div', [], [el(r, 'd', 'div', ['blk']), text(r, 't0', 'aa '), el(r, 's', 'span', ['f20'], [text(r, 't1', 'bb')])])];
  it('one anonymous box wraps the maximal inline-level run beside a block (CSS2 §9.2.1.1)', () => {
    expect(shapeOf(mixed, 'p')).toEqual({
      strut: null,
      children: [{ box: 'd', strut: null, children: [] }, { box: 'p:anon0', strut: 10, children: [{ text: 'p:text0', value: 'aa ', size: 10 }, { inline: 's', size: 20, children: [{ text: 's:text0', value: 'bb', size: 20 }] }] }],
    });
  });
  it('inlineWrapperPerElement gives each inline element its own anonymous box', () => {
    expect(shapeOf(mixed, 'p', { ...NO_FAULTS, inlineWrapperPerElement: true })).toEqual({
      strut: null,
      children: [
        { box: 'd', strut: null, children: [] },
        { box: 'p:anon0', strut: 10, children: [{ text: 'p:text0', value: 'aa ', size: 10 }] },
        { box: 'p:anon1', strut: 10, children: [{ inline: 's', size: 20, children: [{ text: 's:text0', value: 'bb', size: 20 }] }] },
      ],
    });
  });
  it('white space collapses across inline box boundaries and not across a <br>', () => {
    const tree = (r: SourceRef) => [el(r, 'p', 'div', [], [text(r, 't0', 'a '), el(r, 's', 'span', [], [text(r, 't1', ' b ')]), text(r, 't2', '  '), el(r, 'b', 'br'), text(r, 't3', '  c')])];
    expect(shapeOf(tree, 'p')).toEqual({
      strut: 10,
      children: [{ text: 'p:text0', value: 'a ', size: 10 }, { inline: 's', size: 10, children: [{ text: 's:text0', value: 'b ', size: 10 }] }, { br: 'b', size: 10 }, { text: 'p:text1', value: 'c', size: 10 }],
    });
  });
});

describe('refusals', () => {
  const refused = (tree: (r: SourceRef) => TreeNode[]) => compile(tree).diagnostics.map((d) => `${d.code} ${String(d.target)}`);
  it('an inline box whose white-space-collapse is not collapse is refused on every target', () => {
    const got = compile((r) => [el(r, 'p', 'div', [], [text(r, 't0', 'a '), el(r, 's', 'span', ['pre'], [text(r, 't1', 'b  c')])])]).diagnostics;
    const ws = got.filter((d) => d.message.startsWith('white-space-collapse: preserve on the inline box <span> s'));
    expect(ws.map((d) => `${d.code} ${String(d.target)}`).sort()).toEqual(['DRAGON_UNSUPPORTED_VALUE ios', 'DRAGON_UNSUPPORTED_VALUE web']);
  });
  it('block-in-inline and mixed text-wrap-mode in one formatting context are refused on every target', () => {
    expect(refused((r) => [el(r, 'p', 'div', [], [text(r, 't0', 'a '), el(r, 's', 'span', [], [el(r, 'd', 'div', [], [text(r, 't1', 'b')])])])]).sort()).toEqual(expect.arrayContaining(['DRAGON_UNSUPPORTED_VALUE ios', 'DRAGON_UNSUPPORTED_VALUE web']));
    const wrap = compile((r) => [el(r, 'p', 'div', [], [text(r, 't0', 'a '), el(r, 's', 'span', ['nw'], [text(r, 't1', 'b c')])])]).diagnostics.filter((d) => d.message.startsWith('text-wrap-mode'));
    expect(wrap.map((d) => String(d.target)).sort()).toEqual(['ios', 'web']);
  });
  it('the phrasing tags INL1a does not reproduce stay refused: b, strong, em, i (synthetic bold and italic), small, code, sub and sup', () => {
    for (const tag of ['b', 'strong', 'em', 'i', 'small', 'code', 'sub', 'sup']) {
      const got = compile((r) => [el(r, 'p', 'div', [], [text(r, 't0', 'a '), el(r, 's', tag, [], [text(r, 't1', 'b')])])]).diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_ELEMENT');
      expect(got.length, tag).toBeGreaterThan(0);
    }
  });
});
