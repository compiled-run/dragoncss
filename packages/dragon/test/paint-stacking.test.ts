// PNT1 z-index and stacking (CSS2 §9.9.1, Appendix E): z-index parsing with Chrome 145's rules (auto or an integer, clamped to 32
// bits), the paint order of stacking trees (layers, contexts, flow atomicity), the placements that make the native order equal it,
// the clip rule, the refusals on the native targets, the lowering to writes with facts, and the emitted writer lines.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { nativeString, STACKING_EMITTER } from '../src/emit/paint/stacking.ts';
import { stringLit } from '../src/emit/native-support.ts';
import type { StackNode } from '../src/lower/paint/stacking.ts';
import { layoutStackTree, STACKING_LOWERING, stackingOf } from '../src/lower/paint/stacking.ts';
import { zIndexValue } from '../src/css/properties/effects.ts';
import type { LayoutBox, LayoutNode } from '@dragon/layout';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import type { Targets } from '../src/types.ts';
import { DOC, div, expectCatalogued, explainOne, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/z.css', revision: 'r1', hash: 'sha256:0' };

function declare(value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; css: string } {
  const css = `.a { z-index: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, css };
}

type Opts = { position?: StackNode['position']; z?: number; opacity?: number; transformed?: boolean; clips?: boolean };
const n = (id: string, o: Opts, ...children: StackNode[]): StackNode => ({ id, position: o.position ?? 'static', z: o.z ?? null, opacity: o.opacity ?? 1, transformed: o.transformed ?? false, clips: o.clips ?? false, text: false, children });
const t = (id: string): StackNode => ({ id, position: 'static', z: null, opacity: 1, transformed: false, clips: false, text: true, children: [] });

describe('z-index: parse and computed values (Chrome 145 getComputedStyle)', () => {
  const cases: [string, string][] = [
    ['auto', 'auto'], ['0', '0'], ['5', '5'], ['-3', '-3'], ['+4', '4'], ['2147483647', '2147483647'], ['2147483648', '2147483647'],
    ['99999999999', '2147483647'], ['-2147483649', '-2147483648'], ['calc(2)', '2'], ['calc(3 - 5)', '-2'],
  ];
  for (const [value, want] of cases) {
    it(`z-index: ${value} computes to ${want}`, () => {
      const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; } .a { position: relative; height: 5px; z-index: ${value}; }`, (r) => [div(r, 'a', ['a'])]));
      expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(explainOne(c, 'ios', 'a', 'z-index').value).toBe(want);
    });
  }
  it('a fraction, an exponent, a length and two values are invalid, as in Chrome', () => {
    for (const v of ['1.5', '1e3', '2px', '1 2', 'none']) {
      const { declaration, diagnostics } = declare(v);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expectCatalogued(diagnostics);
    }
  });
  it('a calculation that is not a whole number is refused on the token (Chrome rounds it)', () => {
    const { declaration, diagnostics, css } = declare('calc(3 / 2)');
    expect(declaration).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    expect(css.slice((diagnostics[0]?.origin as { span: { start: number; end: number } }).span.start, (diagnostics[0]?.origin as { span: { end: number } }).span.end)).toBe('calc(3 / 2)');
  });
});

describe('Appendix E paint order', () => {
  it('paints z < 0, then flow, then z auto and 0 in tree order, then z > 0 by z, in the root context', () => {
    const root = n('html', {}, n('body', {}, n('f1', {}, t('f1:text0')), n('p', { position: 'absolute', z: 2 }), n('q', { position: 'absolute', z: -1 }), n('r', { position: 'relative' }), n('s', { position: 'absolute', z: 1 }), n('f2', {})));
    const s = stackingOf(root);
    expect(s.order).toEqual(['html', 'q', 'body', 'f1', 'f1:text0', 'f2', 'r', 's', 'p']);
    expect(s.native).toEqual(s.order);
    expect(s.writes.get('p')).toEqual({ host: 'html', bucket: 2, rank: 3, index: 4 });
    expect(s.writes.get('q')).toEqual({ host: 'html', bucket: -1, rank: 0, index: 0 });
    expect(s.facts.get('p')).toEqual({ paintOrder: 8, context: 'html', createsContext: true, layer: 'positive', host: 'html', clipChain: [], underClip: false });
    expect(s.facts.get('f1')?.layer).toBe('flow');
  });
  it('places every layer item even where tree order paints right, since the device adds out-of-flow views after the flow', () => {
    const s = stackingOf(n('html', {}, n('body', {}, n('a', {}), n('b', { position: 'relative' }, n('c', { position: 'absolute' })))));
    expect([...s.writes.keys()]).toEqual(['b', 'c']);
    expect(s.writes.get('b')).toEqual({ host: 'html', bucket: 1, rank: 0, index: 1 });
    expect(s.writes.get('c')).toEqual({ host: 'b', bucket: 1, rank: 1, index: 0 });
    expect(s.native).toEqual(s.order);
    expect(s.facts.get('a')?.host).toBe('body');
  });
  it('a stacking context is atomic: its z-index children paint inside it, below a sibling context above it', () => {
    const root = n('html', {}, n('g', { opacity: 0.5 }, n('z', { position: 'absolute', z: 10 })), n('w', { position: 'absolute', z: 1 }));
    const s = stackingOf(root);
    expect(s.order).toEqual(['html', 'g', 'z', 'w']);
    expect(s.facts.get('z')?.context).toBe('g');
    expect(s.facts.get('g')?.layer).toBe('positioned');
  });
  it('a positioned z-index auto box hosts its positioned descendants after its flow children; a z < 0 child of a context sorts before its flow', () => {
    const root = n('html', {}, n('q', { position: 'relative' }, n('k', {}, n('m', { position: 'relative' })), n('after', {})), n('p0', { position: 'relative', z: 0 }, n('fl', {}), n('neg', { position: 'absolute', z: -1 })));
    const s = stackingOf(root);
    expect(s.order).toEqual(['html', 'q', 'k', 'after', 'm', 'p0', 'neg', 'fl']);
    expect(s.writes.get('m')?.host).toBe('q');
    expect(s.writes.get('neg')).toMatchObject({ host: 'p0', bucket: -1 });
    expect(s.native).toEqual(s.order);
  });
  it('a transformed box is a stacking context in the z-index 0 layer: after the flow, in tree order with positioned boxes', () => {
    const s = stackingOf(n('html', {}, n('t1', { transformed: true }, n('k', { position: 'absolute', z: 5 })), n('after', {}), n('r', { position: 'relative' }), n('t2', { transformed: true }), n('r2', { position: 'relative', z: 1 })));
    expect(s.order).toEqual(['html', 'after', 't1', 'k', 'r', 't2', 'r2']);
    expect(s.facts.get('t1')).toMatchObject({ createsContext: true, layer: 'positioned' });
    expect(s.facts.get('k')?.context).toBe('t1');
    expect(s.writes.get('k')?.host).toBe('t1');
    expect(s.native).toEqual(s.order);
  });
  it('a flex item with a z-index is a stacking context (the tree gives it its z), and a static box ignores z', () => {
    const s = stackingOf(n('html', {}, n('flex', {}, n('i1', { z: 3 }), n('i2', {}))));
    expect(s.order).toEqual(['html', 'flex', 'i2', 'i1']);
  });
  it('an absolute box escapes an overflow clip that is not its containing block, and stays under one that is', () => {
    const escaping = stackingOf(n('html', {}, n('row', { position: 'relative' }, n('clip', { clips: true }, n('d', { position: 'absolute', z: 3 })), n('l', {}))));
    expect(escaping.facts.get('d')).toMatchObject({ host: 'html', clipChain: [], underClip: false });
    expect(escaping.clipped).toEqual([]);
    const clipped = stackingOf(n('html', {}, n('clip', { clips: true }, n('d', { position: 'relative', z: 3 })), n('l', {})));
    expect(clipped.facts.get('d')).toMatchObject({ host: 'clip', clipChain: ['clip'], underClip: true });
    expect(clipped.clipped).toEqual([{ id: 'd', clip: 'clip', kind: 'order' }]);
    const fixed = stackingOf(n('html', {}, n('clip', { clips: true }, n('d', { position: 'fixed', z: 3 })), n('l', {})));
    expect(fixed.facts.get('d')).toMatchObject({ host: 'html', clipChain: [], underClip: false, createsContext: true });
    expect(fixed.clipped).toEqual([]);
    expect(stackingOf(n('html', {}, n('s', { position: 'sticky' }))).facts.get('s')?.createsContext).toBe(true);
    const last = stackingOf(n('html', {}, n('l', {}), n('clip', { clips: true }, n('d', { position: 'relative', z: 3 }))));
    expect(last.facts.get('d')).toMatchObject({ host: 'clip', underClip: true });
    expect(last.clipped).toEqual([]);
    const auto = stackingOf(n('html', {}, n('clip', { clips: true }, n('d', { position: 'relative' })), n('l', {})));
    expect(auto.facts.get('d')).toMatchObject({ host: 'clip', underClip: true });
    // A z-index auto box too: under the clip it paints before l, which Appendix E paints below it (finding 1).
    expect(auto.clipped).toEqual([{ id: 'd', clip: 'clip', kind: 'order' }]);
  });
  it('reports a layer item of any z-index kept under a clip whose native order differs (review of #196, finding 1)', () => {
    // body > [C (overflow: hidden) > P (opacity 0.5, or relative, or transformed), S]: Appendix E paints C S P; under C, P paints before S.
    for (const p of [{ opacity: 0.5 }, { position: 'relative' as const }, { transformed: true }]) {
      const s = stackingOf(n('html', {}, n('body', {}, n('C', { clips: true }, n('P', p)), n('S', {}))));
      expect(s.order, JSON.stringify(p)).toEqual(['html', 'body', 'C', 'S', 'P']);
      expect(s.native, JSON.stringify(p)).toEqual(['html', 'body', 'C', 'P', 'S']);
      expect(s.clipped, JSON.stringify(p)).toEqual([{ id: 'P', clip: 'C', kind: 'order' }]);
    }
  });
  it('reports a box a stacking context inside a clip would take into that clip, which its containing-block chain is not in (finding 2)', () => {
    // body > C (overflow: hidden) > O (opacity 0.5, will-change: opacity or a flex item with a z-index) > I (absolute): Chrome does
    // not clip I (its containing block is the root); natively I is hosted under O, inside C's clip view.
    for (const o of [{ opacity: 0.5 }, { transformed: true }]) {
      const s = stackingOf(n('html', {}, n('body', {}, n('C', { clips: true }, n('O', o, n('I', { position: 'absolute' }))))));
      expect(s.facts.get('I'), JSON.stringify(o)).toMatchObject({ host: 'O', clipChain: [] });
      expect(s.clipped, JSON.stringify(o)).toEqual([{ id: 'I', clip: 'C', kind: 'clip' }]);
    }
    const flex = stackingOf(n('html', {}, n('body', {}, n('C', { clips: true }, n('F', {}, n('O', { z: 2 }, n('I', { position: 'absolute' })))))));
    expect(flex.clipped).toEqual([{ id: 'I', clip: 'C', kind: 'clip' }]);
    // The root's clip is the viewport's, which clips every box: a fixed box hosted under it is right, one taken into C is not.
    const root = stackingOf(n('html', { clips: true }, n('body', {}, n('F', { position: 'fixed', z: 3 }), n('C', { clips: true }, n('O', { opacity: 0.5 }, n('G', { position: 'fixed' }))))));
    expect(root.facts.get('F')).toMatchObject({ host: 'html', clipChain: ['html'] });
    expect(root.clipped).toEqual([{ id: 'G', clip: 'C', kind: 'clip' }]);
    // A positioned O is I's containing block, so C clips I in Chrome too: nothing to report.
    const positioned = stackingOf(n('html', {}, n('body', {}, n('C', { clips: true }, n('O', { opacity: 0.5, position: 'relative' }, n('I', { position: 'absolute' }))))));
    expect(positioned.facts.get('I')?.clipChain).toEqual(['C']);
    expect(positioned.clipped.filter((c) => c.kind === 'clip')).toEqual([]);
  });
});

describe('stacking: refusals on the native targets', () => {
  const compile = (css: string, body: Parameters<typeof inputFor>[1], targets: Targets = { ios: { minimum: '15.0' }, web: {} }) =>
    createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; } ${css}`, body));
  it('a z-index box whose layer is outside an overflow clip in its containing-block chain, and that would paint below a later box, is refused on ios only, at the z-index', () => {
    const c = compile('.clip { overflow: hidden; height: 20px; } .d { position: relative; z-index: 2; height: 30px; } .after { position: relative; height: 5px; }', (r) => [div(r, 'clip', ['clip'], [div(r, 'd', ['d'])]), div(r, 'after', ['after'])]);
    const errs = c.diagnostics.filter((d) => d.severity === 'error');
    expect(errs.map((d) => [d.code, d.target])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
    expect(errs[0]?.message).toMatch(/^d paints in a stacking context outside clip, whose overflow clip applies to it/);
    expectCatalogued(errs);
  });
  it('refuses both review repros on ios only, at the declaration that makes the box a layer item', () => {
    const order = compile('.c { overflow: hidden; height: 20px; } .p { position: relative; height: 30px; } .s { height: 20px; margin-top: -20px; background-color: red; }', (r) => [div(r, 'c', ['c'], [div(r, 'p', ['p'])]), div(r, 's', ['s'])]);
    const oe = order.diagnostics.filter((d) => d.severity === 'error');
    expect(oe.map((d) => [d.code, d.target])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
    expect(oe[0]?.message).toMatch(/^p paints in a stacking context outside c, whose overflow clip applies to it/);
    const escape = compile('.c { overflow: hidden; height: 20px; } .o { will-change: opacity; height: 10px; } .i { position: absolute; top: 60px; width: 10px; height: 10px; }', (r) => [div(r, 'c', ['c'], [div(r, 'o', ['o'], [div(r, 'i', ['i'])])])]);
    const ee = escape.diagnostics.filter((d) => d.severity === 'error');
    expect(ee.map((d) => [d.code, d.target])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
    expect(ee[0]?.message).toMatch(/^i is not clipped by c in Chrome \(its containing block is outside it\)/);
    expectCatalogued([...oe, ...ee]);
  });
  it('a z-index auto box under such a clip, a z-index box whose clip is not its containing block, and one that nothing paints after compile', () => {
    for (const css of ['.clip { overflow: hidden; height: 20px; } .d { position: relative; height: 30px; }', '.row { position: relative; } .clip { overflow: hidden; height: 20px; } .d { position: absolute; z-index: 2; height: 30px; }', '.clip { overflow: hidden; height: 20px; } .d { position: relative; z-index: 2; height: 30px; }']) {
      const c = compile(css, (r) => [div(r, 'row', ['row'], [div(r, 'clip', ['clip'], [div(r, 'd', ['d'])])])]);
      expect(c.diagnostics.filter((d) => d.severity === 'error'), css).toEqual([]);
    }
  });
});

describe('stacking: lowering and emission', () => {
  const programs = (css: string, body: Parameters<typeof inputFor>[1]) => {
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; } ${css}`, body));
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };
  it('writes the placement of every layer item and publishes stacking facts on every box', () => {
    const p = programs('.a { height: 10px; } .z { position: relative; top: 5px; height: 10px; z-index: 1; }', (r) => [div(r, 'a', ['a'], [div(r, 'z', ['z'])]), div(r, 'b', ['a'])]);
    const z = p.uikit.nodes.find((x) => x.id === 'z');
    expect(z?.writes.filter((w) => w.kind === 'paint-order')).toEqual([expect.objectContaining({ kind: 'paint-order', key: 'dragonStacking.order', technique: 'dragon-owned-paint', host: 'html', bucket: 2, rank: 0, css: ['z-index'] })]);
    expect(z?.host).toBe('a');
    expect(z?.facts['stacking']).toMatchObject({ context: 'html', createsContext: true, layer: 'positive', host: 'html', clipChain: [] });
    for (const x of p['android-views'].nodes) if (x.kind !== 'text') expect(x.facts['stacking'], x.id).toBeDefined();
    const w = z?.writes.find((x) => x.kind === 'paint-order');
    if (w === undefined || w.kind !== 'paint-order') throw new Error('no paint-order write');
    expect(STACKING_EMITTER.lines.uikit('v3', z as never, w)).toEqual(['  dragonSetPaintOrder(t, v3, "html", 2, 0)']);
    expect(STACKING_EMITTER.lines['android-views']('v3', z as never, w)).toEqual(['  dragonSetPaintOrder(t, v3, "html", 2, 0)']);
    expect(STACKING_EMITTER.applied({} as never, 'uikit', w, 2, { border: [0, 0, 0, 0], box: {} as never, fontSize: null, replaced: null })).toEqual(['html', w.index]);
  });
  it('refuses a box of another tree than the case it computed, even when its id matches', () => {
    const p = programs('.a { height: 10px; }', (r) => [div(r, 'a', ['a'])]);
    expect(p.uikit.nodes.some((x) => x.id === 'a')).toBe(true);
    const stranger = { kind: 'box', id: 'a', boxType: 'element', style: {}, children: [] } as unknown as LayoutNode;
    expect(() => STACKING_LOWERING.lower({ box: stranger, el: null, facts: {} } as never)).toThrow("a: the stacking lowering did not see this box's root first");
  });
  it('escapes host ids exactly as native-support.ts stringLit does', () => {
    for (const s of ['a/b', 'x:anon0', 'q"\\$', 'é', '😀', '\n']) for (const lang of ['swift', 'kotlin'] as const) expect(nativeString(lang, s), `${lang} ${s}`).toBe(stringLit(lang, s));
  });
});

describe('the stack tree of a layout tree with a replaced leaf (REPL-a)', () => {
  it('takes a replaced leaf as an element box with no children: its position, z-index and opacity count, and it hosts nothing', () => {
    const style = (position: string): LayoutBox['style'] => ({ position, display: 'block', overflowX: 'visible' }) as unknown as LayoutBox['style'];
    const el = (z: number | null, opacity = 1): ResolvedElement => ({ props: new Map<string, unknown>([['z-index', { value: z === null ? { kind: 'keyword', value: 'auto' } : zIndexValue(z) }], ['opacity', { value: { kind: 'number', value: opacity } }], ['transform', { value: { kind: 'keyword', value: 'none' } }], ['will-change', { value: { kind: 'keyword', value: 'auto' } }]]) }) as unknown as ResolvedElement;
    const img: LayoutNode = { kind: 'replaced', id: 'img', style: style('relative') } as unknown as LayoutNode;
    const root: LayoutBox = { kind: 'box', id: 'root', boxType: 'element', style: style('static'), strut: null, children: [img] };
    const tree = layoutStackTree(root, new Map([['root', el(null)], ['img', el(3, 0.5)]]));
    expect(tree.children).toEqual([{ id: 'img', position: 'relative', z: 3, opacity: 0.5, transformed: false, clips: false, text: false, children: [] }]);
    expect(() => layoutStackTree(root, new Map([['root', el(null)]]))).toThrow('img: no resolved element for the layout box');
  });
});

describe('the stack tree of inline content (INL1a, as the native tree places it)', () => {
  const el = (ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode => {
    const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
    return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
  };
  const CSS = 'body { margin: 0; font-family: Ahem; font-size: 10px; } .f20 { font-size: 20px; } .z { position: relative; z-index: 1; height: 10px; }';
  const para = (r: SourceRef) => [el(r, 'p', 'div', [], [text(r, 't0', 'a '), el(r, 'o', 'span', ['f20'], [text(r, 't1', 'b '), el(r, 'i', 'span', [], [text(r, 't2', 'c')])]), el(r, 'b', 'br'), text(r, 't3', 'd')]), el(r, 'z', 'div', ['z'])];
  const compile = (css: string, body: (r: SourceRef) => TreeNode[]) =>
    createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`${CSS} ${css}`, body));
  it('publishes stacking facts on every inline box and <br>, hosted by the block container their views are flat children of', () => {
    const p = nativePrograms(compile('', para), []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const program of [p.programs.uikit, p.programs['android-views']]) {
      for (const id of ['o', 'i', 'b']) {
        const x = program.nodes.find((n) => n.id === id);
        expect(x?.parent, id).toBe('p');
        expect(x?.facts['stacking'], id).toMatchObject({ context: 'html', createsContext: false, layer: 'flow', host: 'p', clipChain: [], underClip: false });
      }
      const order = (id: string): number => (program.nodes.find((n) => n.id === id)?.facts['stacking'] as { paintOrder: number }).paintOrder;
      // Tree order inside the paragraph, and the z-index sibling after all of it.
      expect(['p', 'o', 'i', 'b', 'z'].map(order)).toEqual([...['p', 'o', 'i', 'b', 'z'].map(order)].sort((a, b) => a - b));
    }
  });
  it('refuses on the native targets only an inline box that would be a stacking context: opacity below 1 or will-change: opacity', () => {
    for (const css of ['.f20 { opacity: 0; }', '.f20 { will-change: opacity; }']) {
      const errs = compile(css, para).diagnostics.filter((d) => d.severity === 'error');
      expect(errs.map((d) => [d.code, d.target]).sort(), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android'], ['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      expect(errs[0]?.message, css).toMatch(/on the inline box <span> o makes it a stacking context: the native runtime places an inline box's content beside its view/);
      expectCatalogued(errs);
    }
    expect(compile('.f20 { opacity: 1; }', para).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
  it('an inline box is a childless node followed by its content, and never clips (css-overflow-3 §3)', () => {
    const style = (o: Record<string, string>): LayoutBox['style'] => ({ position: 'static', display: 'block', overflowX: 'visible', ...o }) as unknown as LayoutBox['style'];
    const el1 = (): ResolvedElement => ({ props: new Map<string, unknown>([['z-index', { value: { kind: 'keyword', value: 'auto' } }], ['opacity', { value: { kind: 'number', value: 1 } }], ['transform', { value: { kind: 'keyword', value: 'none' } }], ['will-change', { value: { kind: 'keyword', value: 'auto' } }]]) }) as unknown as ResolvedElement;
    const inner = { kind: 'inline', id: 'i', style: style({ display: 'inline', overflowX: 'hidden' }), children: [{ kind: 'text', id: 'i:t' }] };
    const outer = { kind: 'inline', id: 'o', style: style({ display: 'inline' }), children: [inner, { kind: 'br', id: 'b' }] };
    const root = { kind: 'box', id: 'root', boxType: 'element', style: style({}), strut: null, children: [outer] } as unknown as LayoutBox;
    const tree = layoutStackTree(root, new Map([['root', el1()], ['o', el1()], ['i', el1()]]));
    expect(tree.children.map((c) => [c.id, c.text, c.clips, c.children.length])).toEqual([['o', false, false, 0], ['i', false, false, 0], ['i:t', true, false, 0], ['b', true, false, 0]]);
  });
});
