// INL2a compiler (notes/T059J-inl2.md): atomic inlines (inline-block and inline-flex) stay in their block container's inline
// formatting context as U+FFFC, so white space around them collapses as Chrome collapses it; they are lowered as boxes among the
// inline content and keyed in their own contexts; and an atomic inline inside an inline box or beside real-font text is refused.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { ElementNode, FontMap, FrontEndResult, Origin, SourceRef, TreeNode } from '../src/index.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { compiledFeatures, createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import { collapseInlineContext } from '../src/analysis/resolve.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const CSS = 'body { font-family: Ahem; font-size: 10px; } .ib { display: inline-block; width: 10px; } .if { display: inline-flex; min-width: 30px; justify-content: center; } .f { display: flex; } .blk { display: block; } .rtl { direction: rtl; }';

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const project = (faults: CompilerFaults = NO_FAULTS) => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function boxOf(tree: (r: SourceRef) => TreeNode[], id: string, faults: CompilerFaults = NO_FAULTS): LayoutBox {
  const p = iosLayoutProjection(project(faults).compile(inputFor(CSS, tree)), ENV, []);
  if (p.kind !== 'ready') throw new Error(`projection blocked: ${p.reason}`);
  const find = (b: LayoutBox): LayoutBox | null => (b.id === id ? b : b.children.flatMap((k) => (k.kind === 'box' ? [find(k)] : [])).find((x) => x !== null) ?? null);
  const box = find(p.input.root);
  if (box === null) throw new Error(`no box ${id}`);
  return box;
}

const shape = (b: LayoutBox): unknown[] => b.children.map((k) => (k.kind === 'box' ? `box ${k.id} ${k.style.display}` : k.kind === 'text' ? `text ${JSON.stringify(k.text)}` : `${k.kind} ${k.id}`));

describe('white space around an atomic inline (resolve.ts, INL-P f5-break-space-atomic)', () => {
  const tree = (r: SourceRef) => [el(r, 'd', 'div', [], [text(r, 't0', 'aa '), el(r, 'a', 'span', ['ib']), text(r, 't1', ' bb')])];
  it("keeps 'aa ' and ' bb' as Chrome does, and the atomic is a box among the inline content of its block container", () => {
    const d = boxOf(tree, 'd');
    expect(shape(d)).toEqual(['text "aa "', 'box a inline-block', 'text " bb"']);
    expect(d.strut).not.toBeNull();
  });
  it('atomicCollapsesAsLineEnd collapses both spaces as at a line end', () => {
    expect(shape(boxOf(tree, 'd', { ...NO_FAULTS, atomicCollapsesAsLineEnd: true }))).toEqual(['text "aa"', 'box a inline-block', 'text "bb"']);
  });
  it('a space-only run between two atomics is kept once, and spaces at the context edges go', () => {
    const t = (r: SourceRef) => [el(r, 'd', 'div', [], [text(r, 't0', '  '), el(r, 'a', 'span', ['ib']), text(r, 't1', '   '), el(r, 'b', 'span', ['ib']), text(r, 't2', '  ')])];
    expect(shape(boxOf(t, 'd'))).toEqual(['box a inline-block', 'text " "', 'box b inline-block']);
  });
  it('collapseInlineContext is unchanged: U+FFFC is not white space, and without atomics no run sees one', () => {
    expect(collapseInlineContext(['aa ', '￼', ' bb'])).toEqual(['aa ', '￼', ' bb']);
    expect(collapseInlineContext([' ', '￼', '  '])).toEqual(['', '￼', '']);
    expect(collapseInlineContext(['a  ', null, '￼'])).toEqual(['a ', null, '￼']);
  });
  it('the planted fault changes nothing in a context without atomic inlines', () => {
    const plain = (r: SourceRef) => [el(r, 'd', 'div', [], [text(r, 't0', ' aa '), el(r, 's', 'span', [], [text(r, 't1', ' bb ')]), el(r, 'b', 'br'), text(r, 't2', ' cc ')])];
    expect(shape(boxOf(plain, 'd', { ...NO_FAULTS, atomicCollapsesAsLineEnd: true }))).toEqual(shape(boxOf(plain, 'd')));
  });
});

describe('atomic inlines in the engine input (ios-layout.ts)', () => {
  it('an atomic beside a block is wrapped with the rest of its run in one anonymous box (CSS2 §9.2.1.1)', () => {
    const t = (r: SourceRef) => [el(r, 'd', 'div', [], [el(r, 'k', 'span', ['blk'], [text(r, 't0', 'x')]), el(r, 'a', 'span', ['ib']), el(r, 'b', 'span', ['ib'])])];
    const d = boxOf(t, 'd');
    expect(shape(d)).toEqual(['box k block', 'box d:anon0 block']);
    expect(shape(d.children[1] as LayoutBox)).toEqual(['box a inline-block', 'box b inline-block']);
    expect((d.children[1] as LayoutBox).strut).not.toBeNull();
  });
  it('an inline-flex lowers as a flex container whose inline content is an anonymous flex item', () => {
    const t = (r: SourceRef) => [el(r, 'd', 'div', [], [el(r, 'a', 'span', ['if'], [text(r, 't0', 'X')])])];
    const a = boxOf(t, 'a');
    expect(a.style.display).toBe('inline-flex');
    expect(shape(a)).toEqual(['box a:anon0 block']);
  });
});

describe('atomic inline contexts (context.ts)', () => {
  it('an atomic keys its properties in atomic-inline, an inline-flex its container properties as a flex container, and text beside it in text-beside-atomic', () => {
    const c = project().compile(inputFor(`${CSS} .t { line-height: 12px; }`, (r) => [el(r, 'd', 'div', ['t'], [text(r, 't0', 'aa '), el(r, 'a', 'span', ['if'], [text(r, 't1', 'X')])])]));
    const keys = compiledFeatures(c, 'ios', []);
    expect(keys).toContain('display:inline-flex@atomic-inline/ltr');
    expect(keys).toContain('min-width:<length-px>@atomic-inline/ltr');
    expect(keys).toContain('justify-content:center@flex-row-single-line/ltr');
    expect(keys).toContain('line-height:<length-px>@text-beside-atomic/ltr');
    // The text inside the inline-flex is its anonymous flex item's.
    expect(keys).toContain('line-height:<length-px>@text-as-anonymous-flex-item/row/ltr');
  });
});

describe('INL2c refusals (computed-checks.ts)', () => {
  const codesOf = (tree: (r: SourceRef) => TreeNode[]): string[] => project().compile(inputFor(CSS, tree)).diagnostics.map((d) => `${d.code} ${String(d.target)} ${d.message.split(';')[0]}`);
  it('an atomic inline inside an inline box is DRAGON_UNPROVEN_CONTEXT on every target', () => {
    const t = (r: SourceRef) => [el(r, 'd', 'div', [], [el(r, 's', 'span', [], [text(r, 't0', 'aa '), el(r, 'a', 'span', ['ib'])])])];
    expect(codesOf(t)).toEqual([
      'DRAGON_UNPROVEN_CONTEXT ios inline-block <span> a is an atomic inline inside the inline box <span> s',
      'DRAGON_UNPROVEN_CONTEXT web inline-block <span> a is an atomic inline inside the inline box <span> s',
    ]);
  });
  it('in rtl, an atomic inline without a letter on both sides in its paragraph is DRAGON_UNSUPPORTED_BIDI; one alone is accepted', () => {
    const two = (r: SourceRef) => [el(r, 'd', 'div', ['rtl'], [el(r, 'a', 'span', ['ib']), el(r, 'b', 'span', ['ib'])])];
    expect(codesOf(two).map((c) => c.split(' ')[0])).toEqual(['DRAGON_UNSUPPORTED_BIDI', 'DRAGON_UNSUPPORTED_BIDI']);
    const end = (r: SourceRef) => [el(r, 'd', 'div', ['rtl'], [text(r, 't0', 'aa '), el(r, 'a', 'span', ['ib'])])];
    expect(codesOf(end).map((c) => c.split(' ')[0])).toEqual(['DRAGON_UNSUPPORTED_BIDI']);
    const sandwich = (r: SourceRef) => [el(r, 'd', 'div', ['rtl'], [text(r, 't0', 'aa '), el(r, 'a', 'span', ['ib']), text(r, 't1', ' bb')])];
    expect(codesOf(sandwich)).toEqual([]);
    const alone = (r: SourceRef) => [el(r, 'd', 'div', ['rtl'], [el(r, 'a', 'span', ['ib'])])];
    expect(codesOf(alone)).toEqual([]);
  });
});

describe('an atomic inline beside real-font text (INL2c)', () => {
  const vendor = (file: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../vendor/fonts/${file}`, import.meta.url)));
  const LATO = vendor('Lato/Lato-Regular.ttf');
  const MAP: FontMap = { generics: {}, families: { Lato: { mode: 'pinned', family: 'Lato', faces: [{ src: 'fonts/Lato-Regular.ttf', weight: '400' }] } } } as unknown as FontMap;
  const withLato = (base: FrontEndResult): FrontEndResult => ({
    ...base,
    snapshot: { ...base.snapshot, assets: [{ id: 'fonts/Lato-Regular.ttf', hash: `sha256:${createHash('sha256').update(LATO).digest('hex')}`, bytes: LATO }] },
  });
  const compile = (css: string, tree: (r: SourceRef) => TreeNode[]) =>
    createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} }, fonts: MAP }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(withLato(inputFor(css, tree)));
  const tree = (r: SourceRef) => [el(r, 'd', 'div', [], [text(r, 't0', 'Ab '), el(r, 'a', 'span', ['ib'])])];
  it('is DRAGON_UNPROVEN_CONTEXT on every target at the atomic; the same with Ahem text is accepted', () => {
    const lato = compile('body { font-family: Lato; font-size: 10px; } .ib { display: inline-block; width: 10px; }', tree);
    expect(lato.diagnostics.filter((d) => d.message.includes('INL2c')).map((d) => `${d.code} ${String(d.target)} ${d.message.split(' shares ')[0]}`)).toEqual([
      'DRAGON_UNPROVEN_CONTEXT ios inline-block <span> a',
      'DRAGON_UNPROVEN_CONTEXT web inline-block <span> a',
    ]);
    const ahem = compile('body { font-family: Ahem; font-size: 10px; } .ib { display: inline-block; width: 10px; }', tree);
    expect(ahem.diagnostics.filter((d) => d.message.includes('INL2c'))).toEqual([]);
  });
});

