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
import type { Targets } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor } from './helpers.ts';

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
    expect(s.writes.get('p')).toEqual({ host: 'html', bucket: 2, rank: 3, index: 4, clips: [] });
    expect(s.writes.get('q')).toEqual({ host: 'html', bucket: -1, rank: 0, index: 0, clips: [] });
    expect(s.facts.get('p')).toEqual({ paintOrder: 8, context: 'html', createsContext: true, layer: 'positive', host: 'html', clipChain: [], hostClips: [] });
    expect(s.facts.get('f1')?.layer).toBe('flow');
  });
  it('places every layer item even where tree order paints right, since the device adds out-of-flow views after the flow', () => {
    const s = stackingOf(n('html', {}, n('body', {}, n('a', {}), n('b', { position: 'relative' }, n('c', { position: 'absolute' })))));
    expect([...s.writes.keys()]).toEqual(['b', 'c']);
    expect(s.writes.get('b')).toEqual({ host: 'html', bucket: 1, rank: 0, index: 1, clips: [] });
    expect(s.writes.get('c')).toEqual({ host: 'b', bucket: 1, rank: 1, index: 0, clips: [] });
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
  it('an absolute box escapes an overflow clip that is not its containing block; one that is stays in force through a clip-chain view', () => {
    const escaping = stackingOf(n('html', {}, n('row', { position: 'relative' }, n('clip', { clips: true }, n('d', { position: 'absolute', z: 3 })), n('l', {}))));
    expect(escaping.facts.get('d')).toMatchObject({ host: 'html', clipChain: [], hostClips: [] });
    expect(escaping.writes.get('d')?.clips).toEqual([]);
    const clipped = stackingOf(n('html', {}, n('clip', { clips: true }, n('d', { position: 'relative', z: 3 })), n('l', { position: 'relative' })));
    expect(clipped.facts.get('d')).toMatchObject({ host: 'html', clipChain: ['clip'], hostClips: ['clip'] });
    expect(clipped.writes.get('d')).toMatchObject({ host: 'html', bucket: 2, clips: ['clip'] });
    expect(clipped.order).toEqual(['html', 'clip', 'l', 'd']);
    expect(clipped.native).toEqual(clipped.order);
    expect(clipped.clipped).toEqual([]);
    // Every clip of the containing-block chain between the box and its host, nearest first; a clip that is not in it is left out.
    const nested = stackingOf(n('html', {}, n('outer', { clips: true, position: 'relative' }, n('mid', {}, n('inner', { clips: true }, n('d', { position: 'absolute', z: 1 }))), n('skip', { clips: true }, n('e', { position: 'absolute', z: 1 })))));
    expect(nested.writes.get('d')?.clips).toEqual(['outer']);
    expect(nested.writes.get('e')?.clips).toEqual(['outer']);
    const chain = stackingOf(n('html', {}, n('a', { clips: true }, n('b', { clips: true }, n('d', { position: 'relative', z: 1 })))));
    expect(chain.writes.get('d')?.clips).toEqual(['b', 'a']);
    expect(chain.clipped).toEqual([]);
    const fixed = stackingOf(n('html', {}, n('clip', { clips: true }, n('d', { position: 'fixed', z: 3 })), n('l', {})));
    expect(fixed.facts.get('d')).toMatchObject({ host: 'html', clipChain: [], hostClips: [], createsContext: true });
    expect(fixed.clipped).toEqual([]);
    expect(stackingOf(n('html', {}, n('s', { position: 'sticky' }))).facts.get('s')?.createsContext).toBe(true);
  });
  it('orders every layer item of any z-index taken out of a clip as Appendix E does, through its clip-chain view (review of #196, finding 1)', () => {
    // body > [C (overflow: hidden) > P (opacity 0.5, or relative, or transformed), S]: Appendix E paints C S P, and so does the native tree.
    for (const p of [{ opacity: 0.5 }, { position: 'relative' as const }, { transformed: true }]) {
      const s = stackingOf(n('html', {}, n('body', {}, n('C', { clips: true }, n('P', p)), n('S', {}))));
      expect(s.order, JSON.stringify(p)).toEqual(['html', 'body', 'C', 'S', 'P']);
      expect(s.native, JSON.stringify(p)).toEqual(s.order);
      expect(s.writes.get('P'), JSON.stringify(p)).toMatchObject({ host: 'html', clips: ['C'] });
      expect(s.clipped, JSON.stringify(p)).toEqual([]);
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
    expect(positioned.clipped).toEqual([]);
  });
});

describe('stacking: the clip refusal on the native targets', () => {
  const compile = (css: string, body: Parameters<typeof inputFor>[1], targets: Targets = { ios: { minimum: '15.0' }, web: {} }) =>
    createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; } ${css}`, body));
  it('compiles a box of any z-index taken out of a clip of its containing-block chain, with the clip on its write', () => {
    for (const css of ['.clip { overflow: hidden; height: 20px; } .d { position: relative; z-index: 2; height: 30px; } .after { position: relative; height: 5px; }', '.clip { overflow: hidden; height: 20px; } .d { will-change: opacity; height: 30px; } .after { height: 5px; margin-top: -10px; background-color: red; }']) {
      const c = compile(css, (r) => [div(r, 'clip', ['clip'], [div(r, 'd', ['d'])]), div(r, 'after', ['after'])]);
      expect(c.diagnostics.filter((d) => d.severity === 'error'), css).toEqual([]);
    }
  });
  it('refuses a box a stacking context would take into a clip outside its containing-block chain, on ios only, at its position', () => {
    const escape = compile('.c { overflow: hidden; height: 20px; } .o { will-change: opacity; height: 10px; } .i { position: absolute; top: 60px; width: 10px; height: 10px; }', (r) => [div(r, 'c', ['c'], [div(r, 'o', ['o'], [div(r, 'i', ['i'])])])]);
    const ee = escape.diagnostics.filter((d) => d.severity === 'error');
    expect(ee.map((d) => [d.code, d.target])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
    expect(ee[0]?.message).toMatch(/^i is not clipped by c in Chrome \(its containing block is outside it\)/);
    expectCatalogued(ee);
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
    expect(STACKING_EMITTER.lines.uikit('v3', z as never, w)).toEqual(['  dragonSetPaintOrder(t, v3, "html", 2, 0, [])']);
    expect(STACKING_EMITTER.lines['android-views']('v3', z as never, w)).toEqual(['  dragonSetPaintOrder(t, v3, "html", 2, 0, listOf())']);
    const clipped = { ...w, clips: ['a"b', 'c'] };
    expect(STACKING_EMITTER.lines.uikit('v3', z as never, clipped)).toEqual(['  dragonSetPaintOrder(t, v3, "html", 2, 0, ["a\\"b", "c"])']);
    expect(STACKING_EMITTER.lines['android-views']('v3', z as never, clipped)).toEqual(['  dragonSetPaintOrder(t, v3, "html", 2, 0, listOf("a\\"b", "c"))']);
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
    const root: LayoutBox = { kind: 'box', id: 'root', boxType: 'element', style: style('static'), children: [img] };
    const tree = layoutStackTree(root, new Map([['root', el(null)], ['img', el(3, 0.5)]]));
    expect(tree.children).toEqual([{ id: 'img', position: 'relative', z: 3, opacity: 0.5, transformed: false, clips: false, text: false, children: [] }]);
    expect(() => layoutStackTree(root, new Map([['root', el(null)]]))).toThrow('img: no resolved element for the layout box');
  });
});
