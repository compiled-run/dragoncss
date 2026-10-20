// MASK-CLIP: one linear-gradient() mask-image compiles on every target; the native targets lower it to one mask-image write that
// rasterises the gradient's alpha (lower/paint/mask.ts, emit/paint/mask.ts) and refuse what the native mask does not draw as Chrome
// does (analysis/paint-values/mask.ts). The Chrome case is mask-gradient (packages/parity/fixtures), measured by
// packages/parity/test/mask-gradient.test.ts; reject-mask-image holds a value no target draws.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, emitAndroidViewsCases, emitUikitCases, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import { gradientMaskOf, maskedContentRefusal } from '../src/analysis/paint-values/mask.ts';
import { applyPlant } from '../src/emit/native-support.ts';
import { MASK_EMITTER } from '../src/emit/paint/mask.ts';
import type { ElementNode, FrontEndResult, SourceRef, Targets, TreeNode } from '../src/types.ts';
import { div, expectCatalogued, inputFor, spanTextOf, text } from './helpers.ts';

const ALL: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 } };
const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; } .a { width: 40px; height: 20px; background-color: rgb(200, 100, 0); }';

const compileInput = (input: FrontEndResult, targets: Targets = ALL) => createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
const tree = (r: SourceRef): TreeNode[] => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 'b-t', 'XX')])])];
const compile = (css: string, targets: Targets = ALL, body: (r: SourceRef) => TreeNode[] = tree) => compileInput(inputFor(`${BASE} ${css}`, body), targets);

/** Each error as `<target> <code>`, sorted. */
const errors = (css: string, body?: (r: SourceRef) => TreeNode[]): string[] =>
  compile(css, ALL, body).diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];
const NATIVE_REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE'];
const NATIVE_UNPROVEN = ['android DRAGON_UNPROVEN_CONTEXT', 'ios DRAGON_UNPROVEN_CONTEXT'];

function programs(css: string, body: (r: SourceRef) => TreeNode[] = tree) {
  const p = nativePrograms(compile(css, NATIVE, body), []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

/** The mask-image errors, as `<target> <code>`, sorted: other refusals of the same input are not this module's. */
const maskErrors = (css: string, body?: (r: SourceRef) => TreeNode[]): string[] =>
  compile(css, ALL, body).diagnostics.filter((d) => d.severity === 'error' && d.message.startsWith('mask-image')).map((d) => `${String(d.target)} ${d.code}`).sort();
const emitCase = (program: never) => ({ id: 'case-1', fixture: 'fixture-1', direction: 'ltr', compilerDigest: 'digest', viewport: { width: 400, height: 300 }, program, expectedDigests: [{ dpr: 2, sha256: 'x'.repeat(64) }] }) as never;

describe('mask: the gradient mask Dragon draws', () => {
  it('compiles one linear-gradient() on every target, through mask-image, the mask shorthand and both -webkit- aliases, in any ASCII case', () => {
    for (const css of [
      '.a { mask-image: linear-gradient(black, transparent); }',
      '.a { -webkit-mask-image: linear-gradient(to right, black 50%, transparent 50%); }',
      '.a { mask: linear-gradient(0deg, transparent 35%, black 65%); }',
      '.a { -webkit-mask: linear-gradient(to bottom, rgb(0, 0, 0) 50%, rgba(0, 0, 0, 0) 50%); }',
      '.a { MASK-IMAGE: Linear-Gradient(to left, transparent 30px, black 30px); }',
      '.a { mask-image: linear-gradient(180deg, black, black 12px, transparent 30px); mask-size: auto; mask-repeat: repeat; mask-position: 0% 0%; mask-origin: border-box; mask-clip: border-box; mask-composite: add; mask-mode: match-source; }',
      // A mask that hides everything still leaves the text in the accessibility tree on every target, as Chrome does.
      '.a { mask-image: linear-gradient(transparent, transparent); }',
    ]) expect(errors(css), css).toEqual([]);
  });

  it('refuses on every target what Dragon does not draw: other images, more layers, the other longhands off their initial values', () => {
    for (const css of [
      '.a { mask-image: radial-gradient(black, transparent); }',
      '.a { mask-image: repeating-linear-gradient(black 0 5px, transparent 5px 10px); }',
      '.a { mask-image: conic-gradient(black, transparent); }',
      '.a { mask-image: url(m.svg); }',
      '.a { mask-image: linear-gradient(black, transparent), linear-gradient(black, transparent); }',
      '.a { mask-image: linear-gradient(black, transparent); mask-size: 10px; }',
      '.a { mask-image: linear-gradient(black, transparent); mask-repeat: no-repeat; }',
      '.a { mask-image: linear-gradient(black, transparent); mask-position: 10px 0%; }',
      '.a { mask-image: linear-gradient(black, transparent); mask-origin: padding-box; }',
      '.a { mask-image: linear-gradient(black, transparent); mask-clip: content-box; }',
      '.a { mask-image: linear-gradient(black, transparent); mask-composite: subtract; }',
      '.a { mask-image: linear-gradient(black, transparent); mask-mode: luminance; }',
      '.a { mask: linear-gradient(black, transparent) no-repeat; }',
      '.a { mask-image: linear-gradient(in oklab, black, transparent); }',
      '.a { mask-image: linear-gradient(black, 30%, transparent); }',
    ]) expect(errors(css), css).toEqual(REFUSED);
    const c = compile('.a { mask-image: radial-gradient(black, transparent); }');
    const errs = c.diagnostics.filter((d) => d.severity === 'error');
    expect(errs[0]?.message).toMatch(/^mask-image: radial-gradient\(black,transparent\) on <div> a is unsupported: Dragon draws a mask only as one linear-gradient\(\) mask-image/);
    expectCatalogued(errs);
  });

  it('reads the gradient the background parser reads, and nothing for none or a refused mask', () => {
    const el = (props: Record<string, unknown>) => ({ props: new Map(Object.entries(props).map(([k, value]) => [k, { value }])) }) as never;
    const initial = { '-webkit-mask-position-x': { kind: 'percentage', value: 0 }, '-webkit-mask-position-y': { kind: 'percentage', value: 0 }, 'mask-size': { kind: 'keyword', value: 'auto' }, 'mask-repeat': { kind: 'keyword', value: 'repeat' }, 'mask-origin': { kind: 'keyword', value: 'border-box' }, 'mask-clip': { kind: 'keyword', value: 'border-box' }, 'mask-composite': { kind: 'keyword', value: 'add' }, 'mask-mode': { kind: 'keyword', value: 'match-source' } };
    const other = (text: string) => ({ kind: 'other', type: 'mask-layer-value', text });
    expect(gradientMaskOf(el({ ...initial, 'mask-image': { kind: 'keyword', value: 'none' } }))).toBeNull();
    const g = gradientMaskOf(el({ ...initial, 'mask-image': other('linear-gradient(to right,black 50%,transparent 50%)') }));
    expect(g?.direction).toBe('side');
    expect(g?.sideX).toBe('right');
    expect(g?.stops.map((s) => [s.unit, s.value])).toEqual([['percent', 50], ['percent', 50]]);
    expect(gradientMaskOf(el({ ...initial, 'mask-image': other('linear-gradient(') }))).toBeNull();
    expect(gradientMaskOf(el({ ...initial, 'mask-image': other('radial-gradient(black,transparent)') }))).toBeNull();
    expect(gradientMaskOf(el({ ...initial, 'mask-repeat': { kind: 'other', type: 'mask-layer-value', text: 'no-repeat' }, 'mask-image': other('linear-gradient(black,transparent)') }))).toBeNull();
  });
});

describe('mask: native refusals', () => {
  it('refuses on ios and android a gradient the native raster does not draw as Chrome: a corner, an angle off the grid, currentcolor, an em stop', () => {
    for (const css of [
      '.a { mask-image: linear-gradient(to bottom right, black, transparent); }',
      '.a { mask-image: linear-gradient(33.333deg, black, transparent); }',
      '.a { mask-image: linear-gradient(currentcolor, transparent); }',
      '.a { mask-image: linear-gradient(black 1em, transparent); }',
    ]) expect(errors(css), css).toEqual(NATIVE_REFUSED);
  });

  it('refuses a mask on html, body or an inline box on the native targets', () => {
    expect(errors('body { mask-image: linear-gradient(black, transparent); }')).toEqual(NATIVE_REFUSED);
    const inline = (r: SourceRef): TreeNode[] => [div(r, 'p', [], [{ ...div(r, 'a', ['a', 'i'], [text(r, 'a-t', 'XX')]), tag: 'span' } as ElementNode])];
    expect(maskErrors('.i { display: inline; mask-image: linear-gradient(black, transparent); }', inline)).toEqual(NATIVE_REFUSED);
  });

  it('refuses, as an unproven context, a mask under a transform or in a composited layer, and beside a clip-path', () => {
    const nested = (r: SourceRef): TreeNode[] => [div(r, 'o', ['o'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX')])])];
    for (const css of ['.o { transform: translateX(1px); }', '.o { will-change: transform; }', '.o { will-change: opacity; }', '.o { overflow: auto; height: 30px; }']) {
      expect(errors(`${css} .a { mask-image: linear-gradient(black, transparent); }`, nested), css).toEqual(NATIVE_UNPROVEN);
    }
    expect(errors('.a { transform: scale(2); mask-image: linear-gradient(black, transparent); }')).toEqual(NATIVE_UNPROVEN);
    expect(maskErrors('.a { clip-path: inset(1px); mask-image: linear-gradient(black, transparent); }')).toEqual(NATIVE_UNPROVEN);
  });

  it('refuses, as an unproven context, every translucent or separately drawn paint inside the mask, the masked box included', () => {
    for (const css of [
      '.a { opacity: 0.5; }', '.b { opacity: 0.9; }', '.b { background-color: rgba(0, 0, 0, 0.5); }', '.a { background-color: rgba(200, 100, 0, 0.5); }',
      '.b { color: rgba(0, 0, 0, 0.5); }', '.b { border: 1px solid rgba(0, 0, 0, 0.5); }', '.b { box-shadow: 0 0 0 1px black; }', '.b { outline: 1px solid black; }',
      '.b { text-shadow: 1px 1px black; }', '.b { background-image: linear-gradient(red, blue); }', '.b { overflow: scroll; height: 10px; }',
      '.b { text-decoration: underline rgba(0, 0, 0, 0.5); }',
    ]) {
      const errs = compile(`${css} .a { mask-image: linear-gradient(black, transparent); }`).diagnostics.filter((d) => d.severity === 'error' && d.message.startsWith('mask-image'));
      expect(errs.map((d) => `${String(d.target)} ${d.code}`).sort(), css).toEqual(NATIVE_UNPROVEN);
      expect(errs[0]?.message, css).toMatch(/^mask-image on a: inside the mask, [ab]: /);
      expectCatalogued(errs);
    }
    // Opaque paint, transparent paint, an opaque underline and visibility inside the mask compile.
    for (const css of ['.b { background-color: rgb(1, 2, 3); color: black; border: 2px solid transparent; }', '.b { text-decoration: underline; }', '.b { visibility: hidden; }']) {
      expect(errors(`${css} .a { mask-image: linear-gradient(black, transparent); }`), css).toEqual([]);
    }
  });

  it('names the reason for each separately drawn element inside a mask', () => {
    const el = (tag: string) => ({ element: { tag, address: tag }, props: new Map() }) as never;
    expect(maskedContentRefusal(el('img'))).toMatch(/^<img> is drawn by a view of its own/);
    expect(maskedContentRefusal(el('iframe'))).toMatch(/^<iframe> is drawn by a view of its own/);
    expect(maskedContentRefusal(el('input'))).toMatch(/^<input> is drawn by a view of its own/);
  });

  it('reports a native refusal at the mask-image declaration', () => {
    const css = `${BASE} .a { mask-image: linear-gradient(to top left, black, transparent); }`;
    const input = inputFor(css, tree);
    const d = compileInput(input).diagnostics.find((x) => x.severity === 'error' && x.target === 'ios') as Diagnostic;
    expect(spanTextOf(input, d)).toBe('linear-gradient(to top left, black, transparent)');
  });
});

describe('mask: the native write', () => {
  it('lowers one mask-image write with the folded slope and the stop colours, and makes the masked box a stacking context', () => {
    const p = programs('.a { mask-image: linear-gradient(30deg, rgb(0, 0, 0) 40%, rgba(0, 0, 0, 0) 60%); } .b { position: relative; z-index: 1; }');
    const node = p.uikit.nodes.find((n) => n.id === 'a');
    const w = node?.writes.find((x) => x.kind === 'mask-image');
    expect(w).toBeDefined();
    if (w === undefined || w.kind !== 'mask-image') return;
    expect(w.gradient.direction).toBe('angle');
    expect(w.gradient.slope).not.toBe(0);
    expect(w.gradient.stops.map((s) => [s.color.alpha, s.unit, s.value])).toEqual([[255, 'percent', 40], [0, 'percent', 60]]);
    expect(w.layerOrigin).toEqual([0, 0]);
    // The z-index child paints inside the mask: its layer stays under the masked box, which is its stacking context.
    const stacking = (p.uikit.nodes.find((n) => n.id === 'b')?.facts['stacking'] ?? null) as { context: string | null } | null;
    expect(stacking?.context).toBe('a');
  });

  it('writes the mask through dragonSetMaskImage on both backends and reads it back under dragonMaskImage', () => {
    const p = programs('.a { mask-image: linear-gradient(to right, black 50%, transparent 50%); }');
    const swift = emitUikitCases([emitCase(p.uikit as never)]).map((f) => f.text).join('\n');
    const kotlin = emitAndroidViewsCases([emitCase(p['android-views'] as never)]).map((f) => f.text).join('\n');
    expect(swift).toMatch(/dragonSetMaskImage\(v\d*, DragonMaskImage\(image: GradientImage\(false, false, JsString\("side"\)/);
    expect(kotlin).toMatch(/dragonSetMaskImage\(v\d*, DragonMaskImage\(GradientImage\(false, false, "side"/);
    expect(MASK_EMITTER.applied(undefined as never, 'uikit', { kind: 'mask-image', gradient: { slope: 0 }, layerOrigin: [0, 0] } as never, 2, undefined as never)).toEqual({ kind: 'linear', slope: '00000000', origin: [0, 0], modelled: true, masked: true });
  });

  it('masks without touching visibility, alpha or clip bounds, so the text inside stays in the accessibility tree', () => {
    const swift = MASK_EMITTER.native.uikit.file ?? '';
    const kotlin = MASK_EMITTER.native['android-views'].file ?? '';
    expect(swift).toContain('v.layer.mask = mask');
    expect(kotlin).toContain('PorterDuff.Mode.DST_IN');
    for (const banned of ['isHidden', '.alpha', 'accessibility', 'isAccessibilityElement']) expect(swift.includes(banned), banned).toBe(false);
    for (const banned of ['visibility', 'INVISIBLE', 'v.setAlpha', 'v.alpha', '.alpha =', 'clipBounds', 'importantForAccessibility']) expect(kotlin.includes(banned), banned).toBe(false);
  });

  it('declares the mask-gradient-flip plant, which applies to each backend support file once', () => {
    const plant = MASK_EMITTER.plants.find((x) => x.name === 'mask-gradient-flip');
    expect(plant).toBeDefined();
    for (const b of ['uikit', 'android-views'] as const) {
      const [from, to] = plant?.replace[b] ?? ['', ''];
      const file = MASK_EMITTER.native[b].file ?? '';
      expect(file.split(from).length - 1, b).toBe(1);
      expect(file.replace(from, to)).not.toBe(file);
    }
    expect(typeof applyPlant).toBe('function');
  });
});
