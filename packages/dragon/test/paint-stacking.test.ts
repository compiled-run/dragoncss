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
import { layoutStackTree, stackingOf } from '../src/lower/paint/stacking.ts';
import { zIndexValue } from '../src/css/properties/effects.ts';
import type { LayoutBox, LayoutNode } from '@dragon/layout';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import type { Targets } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/z.css', revision: 'r1', hash: 'sha256:0' };

function declare(value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; css: string } {
  const css = `.a { z-index: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, css };
}

type Opts = { position?: StackNode['position']; z?: number; opacity?: number; clips?: boolean; atomic?: boolean; flexOrder?: number };
const n = (id: string, o: Opts, ...children: StackNode[]): StackNode => ({ id, position: o.position ?? 'static', z: o.z ?? null, opacity: o.opacity ?? 1, clips: o.clips ?? false, text: false, atomic: o.atomic ?? false, flexOrder: o.flexOrder ?? 0, blank: false, children });
const t = (id: string, blank = false): StackNode => ({ id, position: 'static', z: null, opacity: 1, clips: false, text: true, atomic: false, flexOrder: 0, blank, children: [] });

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
    expect(s.order).toEqual(['html', 'q', 'body', 'f1', 'f2', 'f1:text0', 'r', 's', 'p']);
    expect(s.native).toEqual(s.order);
    expect(s.writes.get('p')).toEqual({ host: 'html', bucket: 2, rank: 3, index: 4 });
    expect(s.writes.get('q')).toEqual({ host: 'html', bucket: -1, rank: 0, index: 0 });
    expect(s.facts.get('p')).toEqual({ paintOrder: 8, context: 'html', createsContext: true, layer: 'positive', atomic: false, host: 'html', clipChain: [], underClip: false, textPaintOrder: [], foregroundClip: false });
    expect(s.facts.get('f1')).toMatchObject({ textPaintOrder: [5], foregroundClip: false });
    expect(s.foreground.get('f1')).toEqual({ host: 'html', entries: [{ id: 'f1:text0', rank: 5, index: 2 }] });
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
  it('a flex item with a z-index is a stacking context (the tree gives it its z), and a static box ignores z', () => {
    const s = stackingOf(n('html', {}, n('flex', {}, n('i1', { z: 3 }), n('i2', {}))));
    expect(s.order).toEqual(['html', 'flex', 'i2', 'i1']);
  });
  it('a paint root paints its block backgrounds, then its foreground: text above every later background of the root', () => {
    const s = stackingOf(n('html', {}, n('body', {}, n('b', {}, t('b:t')), n('c', {}, n('c1', {}), n('c2', {}, t('c2:t'))))));
    expect(s.order).toEqual(['html', 'body', 'b', 'c', 'c1', 'c2', 'b:t', 'c2:t']);
    expect(s.native).toEqual(s.order);
    expect(s.foreground.get('b')).toEqual({ host: 'html', entries: [{ id: 'b:t', rank: 6, index: 1 }] });
    expect(s.foreground.get('c2')).toEqual({ host: 'html', entries: [{ id: 'c2:t', rank: 7, index: 1 }] });
    expect(s.facts.get('b')).toMatchObject({ textPaintOrder: [6], foregroundClip: false, atomic: false });
    // White space only paints no ink and may not be laid out at all, so it stays in its box.
    const blank = stackingOf(n('html', {}, n('b', {}, t('b:sp', true), t('b:t')), n('c', {})));
    expect(blank.foreground.get('b')?.entries.map((e) => e.id)).toEqual(['b:t']);
    // A box that is a paint root keeps its own text: a layer item's text paints in its own view, after its own flow.
    const item = stackingOf(n('html', {}, n('r', { position: 'relative' }, t('r:t')), n('after', {})));
    expect(item.foreground.size).toBe(0);
    expect(item.order).toEqual(['html', 'after', 'r', 'r:t']);
  });
  it('a flex item paints atomically in its root\'s foreground, in order-modified document order, above later block backgrounds', () => {
    const s = stackingOf(n('html', {}, n('flex', {}, n('i1', { atomic: true, flexOrder: 1 }, t('i1:t')), n('i2', { atomic: true })), n('after', {}, t('after:t'))));
    expect(s.order).toEqual(['html', 'flex', 'after', 'i2', 'i1', 'i1:t', 'after:t']);
    expect(s.native).toEqual(s.order);
    expect(s.foreground.get('i1')).toEqual({ host: 'html', entries: [{ id: 'i1', rank: 4, index: 3 }] });
    expect(s.foreground.get('i2')).toEqual({ host: 'html', entries: [{ id: 'i2', rank: 3, index: 2 }] });
    expect(s.foreground.get('after')).toEqual({ host: 'html', entries: [{ id: 'after:t', rank: 6, index: 4 }] });
    expect(s.facts.get('i1')).toMatchObject({ atomic: true, layer: 'flow', host: 'html' });
    // A flex item with a z-index is a layer item, not atomic.
    expect(stackingOf(n('html', {}, n('flex', {}, n('i', { atomic: true, z: 1 })))).facts.get('i')).toMatchObject({ atomic: false, layer: 'positive' });    // A relative flex item between two ordered items does not break the order (Claude review on #87): b (order 0) paints before a (order 1).
    const mixed = stackingOf(n('html', {}, n('flex', {}, n('a', { atomic: true, flexOrder: 1 }), n('rel', { position: 'relative', flexOrder: 0 }), n('b', { atomic: true }))));
    expect(mixed.order.indexOf('b')).toBeLessThan(mixed.order.indexOf('a'));
    expect(mixed.order).toEqual(['html', 'flex', 'b', 'a', 'rel']);
  });
  it('a clip that is not a paint root hosts its foreground in its own place, flagged foregroundClip (Chrome paints it after the root\'s later backgrounds)', () => {
    const s = stackingOf(n('html', {}, n('clip', { clips: true }, n('b', {}, t('b:t')), n('c', {})), n('d', {})));
    expect(s.order).toEqual(['html', 'clip', 'b', 'c', 'd', 'b:t']);
    expect(s.native).toEqual(['html', 'clip', 'b', 'c', 'b:t', 'd']);
    expect(s.foreground.get('b')).toEqual({ host: 'clip', entries: [{ id: 'b:t', rank: 5, index: 2 }] });
    expect(s.facts.get('b')?.foregroundClip).toBe(true);
    expect(s.facts.get('c')?.foregroundClip).toBe(false);
    // A clip's own text stays in it, flagged the same way.
    expect(stackingOf(n('html', {}, n('clip', { clips: true }, t('clip:t')), n('d', {}))).facts.get('clip')?.foregroundClip).toBe(true);
  });
  it('an absolute box escapes an overflow clip that is not its containing block, and stays under one that is', () => {
    const escaping = stackingOf(n('html', {}, n('row', { position: 'relative' }, n('clip', { clips: true }, n('d', { position: 'absolute', z: 3 })), n('l', {}))));
    expect(escaping.facts.get('d')).toMatchObject({ host: 'html', clipChain: [], underClip: false });
    expect(escaping.clipped).toEqual([]);
    const clipped = stackingOf(n('html', {}, n('clip', { clips: true }, n('d', { position: 'relative', z: 3 })), n('l', {})));
    expect(clipped.facts.get('d')).toMatchObject({ host: 'clip', clipChain: ['clip'], underClip: true });
    expect(clipped.clipped).toEqual([{ id: 'd', clip: 'clip' }]);
    const fixed = stackingOf(n('html', {}, n('clip', { clips: true }, n('d', { position: 'fixed', z: 3 })), n('l', {})));
    expect(fixed.facts.get('d')).toMatchObject({ host: 'html', clipChain: [], underClip: false, createsContext: true });
    expect(fixed.clipped).toEqual([]);
    expect(stackingOf(n('html', {}, n('s', { position: 'sticky' }))).facts.get('s')?.createsContext).toBe(true);
    const auto = stackingOf(n('html', {}, n('clip', { clips: true }, n('d', { position: 'relative' })), n('l', {})));
    expect(auto.facts.get('d')).toMatchObject({ host: 'clip', underClip: true });
    expect(auto.clipped).toEqual([]);
  });
});

describe('stacking: refusals on the native targets', () => {
  const compile = (css: string, body: Parameters<typeof inputFor>[1], targets: Targets = { ios: { minimum: '15.0' }, web: {} }) =>
    createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; } ${css}`, body));
  it('a z-index box whose layer is outside an overflow clip in its containing-block chain is refused on ios only, at the z-index', () => {
    const c = compile('.clip { overflow: hidden; height: 20px; } .d { position: relative; z-index: 2; height: 30px; }', (r) => [div(r, 'clip', ['clip'], [div(r, 'd', ['d'])])]);
    const errs = c.diagnostics.filter((d) => d.severity === 'error');
    expect(errs.map((d) => [d.code, d.target])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
    expect(errs[0]?.message).toMatch(/^d has z-index 2 and paints in a stacking context outside clip/);
    expectCatalogued(errs);
  });
  it('a box shadow in a re-hosted box above a painted ancestor it skips is refused on ios only', () => {
    const c = compile('.p { height: 30px; background-color: red; } .s { position: absolute; z-index: 1; width: 10px; height: 10px; box-shadow: 1px 1px blue; } .after { height: 10px; }', (r) => [div(r, 'p', ['p'], [div(r, 's', ['s'])]), div(r, 'after', ['after'])]);
    const errs = c.diagnostics.filter((d) => d.severity === 'error');
    expect(errs.map((d) => [d.code, d.target])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
    expect(errs[0]?.message).toMatch(/^s has a box-shadow and paints above p/);
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
    expect(STACKING_EMITTER.applied({} as never, 'uikit', w, 2, { border: [0, 0, 0, 0], box: {} as never, size: [0, 0], fontSize: null })).toEqual(['html', w.index]);
  });
  it('writes the foreground placements of a box\'s text and of a flex item, and emits dragonSetForeground on both backends', () => {
    const p = programs('.a { height: 10px; font-family: Ahem; font-size: 10px; } .f { display: flex; } .i { width: 10px; height: 10px; }', (r) => [div(r, 'w', [], [div(r, 'a', ['a'], [text(r, 'at', 'XX')])]), div(r, 'f', ['f'], [div(r, 'i', ['i'])])]);
    const a = p.uikit.nodes.find((x) => x.id === 'a');
    const fa = a?.writes.find((x) => x.kind === 'paint-foreground');
    if (fa === undefined || fa.kind !== 'paint-foreground') throw new Error('no paint-foreground write on a');
    expect(fa).toEqual(expect.objectContaining({ key: 'dragonStacking.foreground', technique: 'dragon-owned-paint', host: 'html', css: [] }));
    expect(fa.entries.map((e) => e.id)).toEqual(['a:text0']);
    const i = p.uikit.nodes.find((x) => x.id === 'i');
    const fi = i?.writes.find((x) => x.kind === 'paint-foreground');
    if (fi === undefined || fi.kind !== 'paint-foreground') throw new Error('no paint-foreground write on i');
    expect(fi.entries.map((e) => e.id)).toEqual(['i']);
    const [e] = fa.entries;
    if (e === undefined) throw new Error('no entry');
    expect(STACKING_EMITTER.lines.uikit('v2', a as never, fa)).toEqual([`  dragonSetForeground(t, v2, "html", ["a:text0"], [${e.rank}])`]);
    expect(STACKING_EMITTER.lines['android-views']('v2', a as never, fa)).toEqual([`  dragonSetForeground(t, v2, "html", listOf("a:text0"), intArrayOf(${e.rank}))`]);
    expect(STACKING_EMITTER.applied({} as never, 'uikit', fa, 2, { border: [0, 0, 0, 0], box: {} as never, size: [0, 0], fontSize: null })).toEqual(['html', e.index]);
    expect(() => STACKING_EMITTER.lines.uikit('v2', a as never, { ...fa, entries: [] })).toThrow(/no entries/);
  });
  it('escapes host ids exactly as native-support.ts stringLit does', () => {
    for (const s of ['a/b', 'x:anon0', 'q"\\$', 'é', '😀', '\n']) for (const lang of ['swift', 'kotlin'] as const) expect(nativeString(lang, s), `${lang} ${s}`).toBe(stringLit(lang, s));
  });
});

describe('the stack tree of a layout tree with a replaced leaf (REPL-a)', () => {
  it('takes a replaced leaf as an element box with no children: its position, z-index and opacity count, and it hosts nothing', () => {
    const style = (position: string): LayoutBox['style'] => ({ position, display: 'block', overflowX: 'visible' }) as unknown as LayoutBox['style'];
    const el = (z: number | null, opacity = 1): ResolvedElement => ({ props: new Map<string, unknown>([['z-index', { value: z === null ? { kind: 'keyword', value: 'auto' } : zIndexValue(z) }], ['opacity', { value: { kind: 'number', value: opacity } }]]) }) as unknown as ResolvedElement;
    const img: LayoutNode = { kind: 'replaced', id: 'img', style: style('relative') } as unknown as LayoutNode;
    const root: LayoutBox = { kind: 'box', id: 'root', boxType: 'element', style: style('static'), children: [img] };
    const tree = layoutStackTree(root, new Map([['root', el(null)], ['img', el(3, 0.5)]]));
    expect(tree.children).toEqual([{ id: 'img', position: 'relative', z: 3, opacity: 0.5, clips: false, text: false, atomic: false, flexOrder: 0, blank: false, children: [] }]);
    expect(() => layoutStackTree(root, new Map([['root', el(null)]]))).toThrow('img: no resolved element for the layout box');
  });
});
