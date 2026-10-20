// MASK-CLIP clip-path: the longhand (none or inset() with one to four length-or-percentage edges and no round, not inherited, initial
// none, lengths computed to px and percentages kept, serialized in Chrome's shortest form), the refusals (every other shape, a url(),
// another reference box, a round, a calculation or a viewport unit, on every target; natively, a clip beside a view outside the box
// view, on an inline box, and on html or body), the clip-text proof that clipped text stays accessible, the stacking context it makes, the lowering
// (one write per box with an inset, after the other clip writes) and the emitted native code (the writers, the rect, the readback and
// the plant).
import { describe, expect, it } from 'vitest';
import { emitNativeSupport } from 'dragon';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import { CLIP_PATH_LONGHANDS, insetEdgesOf } from '../src/css/properties/clip-path.ts';
import { MASK_LONGHANDS } from '../src/css/properties/mask.ts';
import { CLIP_RECT_LONGHANDS } from '../src/css/properties/clip-rect.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { applyPlant } from '../src/emit/native-support.ts';
import { CLIP_EMITTER, clipPathInsets, clipPathRect } from '../src/emit/paint/clip.ts';
import type { FrontEndResult, SourceRef, Targets, TreeNode } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, spanTextOf, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/clip-path.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 } };
const ALL: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; } .p { position: relative; width: 100px; height: 50px; } .a { width: 40px; height: 20px; } ';

function declare(value: string): { declaration: Declaration | null; diagnostics: Diagnostic[] } {
  const css = `.a { clip-path: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics };
}

function compileInput(input: FrontEndResult, targets: Targets = { ios: { minimum: '15.0' }, web: {} }) {
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

// Text sits beside the clipped box, in its own block.
const tree = (r: SourceRef): TreeNode[] => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'])]), div(r, 't', ['t'], [text(r, 't-t', 'XX')])])];
// Text in the clipped box (a-t), and in a box inside it (b-t).
const textTree = (r: SourceRef): TreeNode[] => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX'), div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])];
const input = (css: string) => inputFor(BASE + css, tree);
const compile = (css: string, targets?: Targets) => compileInput(input(css), targets);
const errors = (c: { diagnostics: readonly Diagnostic[] }): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');
const clipErrors = (c: { diagnostics: readonly Diagnostic[] }): Diagnostic[] => errors(c).filter((d) => d.message.startsWith('a has clip-path: '));

function programs(css: string, body: (r: SourceRef) => TreeNode[] = tree) {
  const p = nativePrograms(compileInput(inputFor(BASE + css, body), NATIVE), []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

describe('clip-path: parse and computed values (Chrome 145 ClipPath::ParseSingleValue and getComputedStyle)', () => {
  it('follows clip, before the mask family', () => {
    expect([...CLIP_PATH_LONGHANDS]).toEqual(['clip-path']);
    expect(LONGHANDS[LONGHANDS.indexOf('clip-path') - 1]).toBe(CLIP_RECT_LONGHANDS[CLIP_RECT_LONGHANDS.length - 1]);
    expect(LONGHANDS[LONGHANDS.indexOf('clip-path') + 1]).toBe(MASK_LONGHANDS[0]);
  });
  it('computes none, and inset() with lengths in px and percentages kept, in the shortest of the four edges', () => {
    const at = (css: string) => explainOne(compile(`.a { ${css} }`), 'web', 'a', 'clip-path').value;
    expect(at('')).toBe('none');
    expect(at('clip-path: none;')).toBe('none');
    expect(at('clip-path: inset(0);')).toBe('inset(0px)');
    expect(at('clip-path: inset(0 0 0 0);')).toBe('inset(0px)');
    expect(at('clip-path: inset(1px 2px);')).toBe('inset(1px 2px)');
    expect(at('clip-path: inset(1px 2px 1px);')).toBe('inset(1px 2px)');
    expect(at('clip-path: inset(1px 2px 3px);')).toBe('inset(1px 2px 3px)');
    expect(at('clip-path: inset(1px 2px 3px 2px);')).toBe('inset(1px 2px 3px)');
    expect(at('clip-path: inset(1px 2px 1px 4px);')).toBe('inset(1px 2px 1px 4px)');
    expect(at('clip-path: inset(1px 1px 1px 4px);')).toBe('inset(1px 1px 1px 4px)');
    expect(at('clip-path: inset(10% -2px 0% 1em);')).toBe('inset(10% -2px 0% 10px)');
    expect(at('clip-path: INSET(1IN 2rem) border-box;')).toBe('inset(96px 32px)');
    expect(at('clip-path: border-box inset(2.5px);')).toBe('inset(2.5px)');
  });
  it('is not inherited; inherit, initial and var() resolve as Chrome does', () => {
    expect(explainOne(compile('.a { clip-path: inset(1px); }'), 'web', 'b', 'clip-path').value).toBe('none');
    expect(explainOne(compile('.a { clip-path: inset(1px); } .b { clip-path: inherit; }'), 'web', 'b', 'clip-path').value).toBe('inset(1px)');
    expect(explainOne(compile('.a { clip-path: inset(1px); clip-path: initial; }'), 'web', 'a', 'clip-path').value).toBe('none');
    expect(explainOne(compile('.a { --c: inset(1px 2px); clip-path: var(--c); }'), 'web', 'a', 'clip-path').value).toBe('inset(1px 2px)');
  });
  it('drops what Chrome drops: no edge, five edges, a unitless non-zero edge, two shapes, two boxes, half-border-box, a negative circle radius', () => {
    for (const v of ['inset()', 'inset(1px 2px 3px 4px 5px)', 'inset(1)', 'inset(1px) inset(2px)', 'inset(1px) border-box border-box', 'inset(1px) half-border-box', 'circle(-1px)', 'auto', '0']) {
      const { declaration, diagnostics } = declare(v);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expectCatalogued(diagnostics);
    }
  });
  it('refuses, on every target, every other shape, a url(), another reference box, a round, a calculation and a viewport unit', () => {
    const cases: readonly [string, string, RegExp][] = [
      ['rect(0 0 0 0)', 'rect(0 0 0 0)', /polygon\(\) only/],
      ['xywh(0 0 1px 1px)', 'xywh(0 0 1px 1px)', /polygon\(\) only/],
      ['path("M0 0 L10 0 L5 10 Z")', 'path("M0 0 L10 0 L5 10 Z")', /polygon\(\) only/],
      ['circle(1px) padding-box', 'padding-box', /border box only/],
      ['circle(calc(1px + 1%))', 'calc(1px + 1%)', /calculation/],
      ['polygon(0 0, 1vw 0, 0 1px)', '1vw', /viewport unit/],
      ['url(#c)', 'url(#c)', /not a url\(\) reference/],
      ['padding-box', 'padding-box', /border box only/],
      ['inset(1px) content-box', 'content-box', /border box only/],
      ['inset(1px round 4px)', 'inset(1px round 4px)', /without round/],
      ['inset(calc(1px + 1px))', 'calc(1px + 1px)', /calculation/],
      ['inset(0 1vw)', '1vw', /viewport unit/],
    ];
    for (const [v, span, why] of cases) {
      const css = `.a { clip-path: ${v}; }`;
      const errs = errors(compile(css, ALL)).filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(errs.length, v).toBeGreaterThan(0);
      expect(errs[0]?.message, v).toMatch(why);
      expect(spanTextOf(input(css), errs[0] as Diagnostic), v).toBe(span);
      expectCatalogued(errs);
    }
  });
  it('reads back the four edges of a computed inset() in top, right, bottom, left order', () => {
    expect(insetEdgesOf({ kind: 'other', type: 'clip-path-inset', text: 'inset(1px 2%)' })).toEqual([{ value: 1, unit: 'px' }, { value: 2, unit: '%' }, { value: 1, unit: 'px' }, { value: 2, unit: '%' }]);
    expect(insetEdgesOf({ kind: 'keyword', value: 'none' })).toBeNull();
    expect(() => insetEdgesOf({ kind: 'other', type: 'clip-path-inset', text: 'inset(1px 2px 3px 4px 5px)' })).toThrow(/one to four edges/);
    expect(() => insetEdgesOf({ kind: 'keyword', value: 'auto' })).toThrow(/not none or inset/);
  });
});

describe('clip-path: native refusals', () => {
  it('compiles an inset everywhere on a box without text, positioned or not', () => {
    for (const css of ['.a { clip-path: inset(4px); }', '.a { position: absolute; clip-path: inset(10% 2px 0 50%); }', '.a { position: relative; clip-path: inset(50%); }', '.a { clip-path: inset(-4px); }']) expect(errors(compile(css, ALL)), css).toEqual([]);
  });
  it('refuses an em edge whose font size has no build-time value, saying so', () => {
    const errs = clipErrors(compile('.a { font-size: 1vw; clip-path: inset(1em); }', NATIVE));
    expect(errs.map((d) => d.target).sort()).toEqual(['android', 'ios']);
    expect(errs.find((d) => d.target === 'ios')?.message).toBe('a has clip-path: inset(1em), whose em length has no build-time font size to compute it against; ios needs every shape length in px or % at build time');
    expectCatalogued(errs);
  });
  it('refuses a clip beside a view outside the box view, on an inline box and on html or body, natively only, and names it', () => {
    const cases: readonly [string, RegExp][] = [
      ['.a { box-shadow: 0 0 0 2px red; }', /it has a box-shadow, drawn by a companion view beside the box view, outside the clip/],
      ['.a { outline: 1px solid red; }', /it has an outline, which Dragon draws in the root view, outside the clip/],
      ['.b { outline: 1px solid red; }', /b has an outline, which Dragon draws in the root view/],
    ];
    for (const [css, why] of cases) {
      const errs = clipErrors(compile(`.a { clip-path: inset(2px); } ${css}`, ALL));
      expect(errs.map((d) => [d.code, d.target]).sort(), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android'], ['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      expect(errs[0]?.message, css).toMatch(why);
      expectCatalogued(errs);
    }
    // An outline that paints nothing, or one under display: none, is no view.
    for (const css of ['.b { outline: 0px solid red; }', '.b { outline-style: none; }', '.b { display: none; outline: 1px solid red; }']) expect(clipErrors(compile(`.a { clip-path: inset(2px); } ${css}`, NATIVE)), css).toEqual([]);
    const inline = errors(compileInput(inputFor(`${BASE} .i { clip-path: inset(1px); }`, (r) => [div(r, 'p', ['p'], [{ ...div(r, 'i', ['i'], [text(r, 'i-t', 'XX')]), tag: 'span' } as TreeNode])]), NATIVE)).filter((d) => d.message.startsWith('i has clip-path'));
    expect(inline.map((d) => d.message)).toEqual(expect.arrayContaining([expect.stringMatching(/it is an inline box/)]));
    const body = errors(compile('body { clip-path: inset(1px); }', NATIVE)).filter((d) => d.message.includes('has clip-path'));
    expect(body.map((d) => d.message)).toEqual(expect.arrayContaining([expect.stringMatching(/it is <body>, whose background is the canvas's/)]));
  });
  it('clips text natively, and writes the visible text the device proves accessible, as Chrome keeps it in the accessibility tree', () => {
    const run = (css: string) => clipErrors(compileInput(inputFor(BASE + css, textTree), ALL));
    for (const v of ['inset(1px)', 'inset(0 0 0 10%)', 'inset(-2px 0 1px)', 'inset(50%)', 'inset(0)', 'inset(-4px)', 'inset(0 -1% 0 -2px)', 'circle(50%)', 'polygon(0 0, 100% 0, 50% 100%)']) {
      expect(run(`.a { clip-path: ${v}; }`), v).toEqual([]);
      expect(run(`.a { -webkit-clip-path: ${v}; }`), v).toEqual([]);
    }
    const clipText = (css: string, body: (r: SourceRef) => TreeNode[] = textTree) => {
      const p = programs(css, body);
      return [p.uikit, p['android-views']].map((prog) => prog.nodes.flatMap((n) => n.writes.filter((w) => w.kind === 'clip-text').map((w) => [n.id, w])));
    };
    // The box's own text and its descendants', in tree order, with the key the readback reports under.
    for (const css of ['.a { clip-path: inset(1px); }', '.a { clip-path: circle(50%); }', '.a { -webkit-mask-image: linear-gradient(black, transparent); }']) {
      for (const writes of clipText(css)) expect(writes, css).toEqual([['a', expect.objectContaining({ kind: 'clip-text', texts: ['XX', 'YY'], key: 'dragonClipText.exposed' })]]);
    }
    // Text under visibility: hidden or display: none is in no accessibility tree; a box with no visible text gets no write.
    for (const writes of clipText('.a { clip-path: inset(1px); } .b { visibility: hidden; }')) expect(writes).toEqual([['a', expect.objectContaining({ texts: ['XX'] })]]);
    for (const writes of clipText('.a { clip-path: inset(1px); } .b { display: none; }')) expect(writes).toEqual([['a', expect.objectContaining({ texts: ['XX'] })]]);
    for (const writes of clipText('.a { clip-path: inset(1px); }', tree)) expect(writes).toEqual([]);
    for (const writes of clipText('.p { clip-path: inset(1px); } .a { visibility: hidden; }', tree)) expect(writes).toEqual([['p', expect.objectContaining({ texts: ['XX'] })]]);
  });
});

describe('clip-path: stacking and hit testing', () => {
  it('makes a stacking context in the z-index 0 layer, so a clipped flow box paints after its later in-flow sibling', () => {
    const p = programs('.a { clip-path: inset(1px); } .t { margin-top: -10px; }');
    for (const prog of [p.uikit, p['android-views']]) {
      const facts = (id: string) => prog.nodes.find((n) => n.id === id)?.facts['stacking'] as { createsContext: boolean; layer: string; paintOrder: number };
      expect(facts('a').createsContext).toBe(true);
      expect(facts('a').layer).toBe('positioned');
      expect(facts('a').paintOrder).toBeGreaterThan(facts('t').paintOrder);
    }
  });
  it('refuses an interaction rule on native beside a clipped box (R13), not on web', () => {
    const lanes = createProjectWith({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', interactionLanes: true });
    const found = errors(lanes.compile(input('.a { clip-path: inset(1px); } .p:hover { background-color: #0c0; }'))).map((d) => `${d.code} [${d.target}] ${d.message}`);
    expect(found).toEqual(['DRAGON_UNSUPPORTED_SELECTOR [ios] :hover needs Dragon hit testing through clip-path on a, which is not built yet (package SELD-R2b)']);
  });
});

describe('clip-path: lowering', () => {
  it('writes the computed edges of a box with an inset, after its overflow clip; its descendants and other boxes get none', () => {
    const p = programs('.a { overflow: hidden; clip-path: inset(1em 10% 0 -2px); }');
    for (const prog of [p.uikit, p['android-views']]) {
      const kinds = (id: string) => prog.nodes.find((n) => n.id === id)?.writes.map((w) => w.kind).filter((k) => k === 'padding-box-clip' || k === 'clip-path-inset');
      expect(kinds('a')).toEqual(['padding-box-clip', 'clip-path-inset']);
      expect(kinds('b')).toEqual([]);
      expect(kinds('p')).toEqual([]);
      expect(prog.nodes.find((n) => n.id === 'a')?.writes.find((w) => w.kind === 'clip-path-inset')).toEqual(expect.objectContaining({ edges: [{ value: 10, unit: 'px' }, { value: 10, unit: '%' }, { value: 0, unit: 'px' }, { value: -2, unit: 'px' }], css: ['clip-path'] }));
    }
    expect(p.uikit.nodes.find((n) => n.id === 'a')?.writes.find((w) => w.kind === 'clip-path-inset')).toEqual(expect.objectContaining({ key: 'dragonClipPath.frame' }));
    expect(p['android-views'].nodes.find((n) => n.id === 'a')?.writes.find((w) => w.kind === 'clip-path-inset')).toEqual(expect.objectContaining({ key: 'dragonClipPath.rect' }));
  });
  it('never moves layout', () => {
    const css = '.a { position: absolute; left: 3px; top: 4px; } ';
    expect(programs(`${css}.a { clip-path: inset(2px); }`).uikit.root).toEqual(programs(css).uikit.root);
  });
});

describe('clip-path: the clip rect and emission', () => {
  it('is the snapped border box inset by each edge: px times the scale plus its percentage of the layout size, in device px', () => {
    const box = { left: 10, top: 20, right: 110, bottom: 70 };
    expect(clipPathInsets([{ value: 1, unit: 'px' }, { value: 10, unit: '%' }, { value: 0, unit: 'px' }, { value: -2, unit: 'px' }])).toEqual([1, 0, 0, 10, 0, 0, -2, 0]);
    expect(clipPathRect([1, 0, 0, 10, 0, 0, -2, 0], box, [100, 50], 2)).toEqual([-4, 2, 90, 50]);
    // Percentages take the layout size before snapping: 25% of the layout width 100.5 is 25.125.
    expect(clipPathRect([1.25, 0, 0, 25, 0, 0, 0, 0], box, [100.5, 50], 2.625)).toEqual([0, 3.28125, 74.875, 50]);
    expect(clipPathRect([0, 50, 0, 50, 0, 50, 0, 50], box, [100, 50], 2)).toEqual([0, 0, 0, 0]);
    expect(clipPathRect([30, 0, 0, 0, 0, 0, 0, 0], box, [100, 50], 2)).toEqual([0, 0, 0, 0]);
    expect(() => clipPathInsets([{ value: 1, unit: 'em' }, { value: 0, unit: 'px' }, { value: 0, unit: 'px' }, { value: 0, unit: 'px' }])).toThrow(/not a finite px or % value/);
    expect(() => clipPathInsets([{ value: 1, unit: 'px' }])).toThrow(/not 4/);
  });
  const w = { kind: 'clip-path-inset', edges: [{ value: 1.5, unit: 'px' }, { value: 10, unit: '%' }, { value: 0, unit: 'px' }, { value: -2, unit: 'px' }] } as never;
  it('emits the one runtime writer on both backends and expects the rect in points on UIKit and device px on Android', () => {
    expect(CLIP_EMITTER.lines.uikit('v0', {} as never, w)).toEqual(['  dragonSetClipPath(v0, [1.5, 0.0, 0.0, 10.0, 0.0, 0.0, -2.0, 0.0])']);
    expect(CLIP_EMITTER.lines['android-views']('v1', {} as never, w)).toEqual(['  dragonSetClipPath(v1, doubleArrayOf(1.5, 0.0, 0.0, 10.0, 0.0, 0.0, -2.0, 0.0))']);
    const g = { box: { left: 0, top: 0, right: 200, bottom: 100 }, size: [200, 100] } as never;
    expect(CLIP_EMITTER.applied({} as never, 'android-views', w, 2, g)).toEqual([-4, 3, 180, 100]);
    expect(CLIP_EMITTER.applied({} as never, 'uikit', w, 2, g)).toEqual([-2, 1.5, 92, 48.5]);
  });
  for (const backend of ['uikit', 'android-views'] as const) {
    const files = emitNativeSupport(backend);
    const ios = backend === 'uikit';
    const clip = files.find((f) => f.path.endsWith(ios ? 'DragonPaintClip.swift' : 'DragonPaintClip.kt'))?.text ?? '';
    const all = files.map((f) => f.text).join('\n');
    it(`${backend}: clips without touching visibility, and reads back the rect`, () => {
      if (ios) {
        expect(clip).toContain('    v.layer.mask = m\n');
        expect(clip).toContain('out.append(("dragonClipPath.frame", v.layer.mask == nil || r.count != 4 ? .null');
      } else {
        expect(all).toContain('    if (r != null) canvas.clipRect(r[0].toFloat(), r[1].toFloat(), r[2].toFloat(), r[3].toFloat())\n');
        expect(clip).toContain('out.add(Pair("dragonClipPath.rect", if (r == null) DumpJson.Null else DumpJson.Arr(r.map { DumpJson.Num(it) })))');
      }
      expect(clip).toContain(ios ? 'insets[2 * k] * scale + insets[2 * k + 1] / 100 * size }' : 'insets[2 * k] * scale + insets[2 * k + 1] / 100.0 * size\n');
      expect(clip).not.toMatch(ios ? /dragonClipPath[^\n]*isHidden/ : /dragonClipPath[^\n]*visibility/);
    });
    it(`${backend}: the clip-path-ignored plant turns the writer into a no-op`, () => {
      const plant = CLIP_EMITTER.plants.find((p) => p.name === 'clip-path-ignored');
      if (plant === undefined) throw new Error('no clip-path-ignored plant');
      const [from, to] = plant.replace[backend];
      const planted = applyPlant(files, from, to, plant.name).map((f) => f.text).join('\n');
      expect(planted).toContain(ios ? 'public let dragonClipPathPlantIgnored = true' : 'const val DRAGON_CLIP_PATH_PLANT_IGNORED = true');
      expect(clip).toContain(ios ? 'if dragonClipPathPlantIgnored { return }' : 'if (DRAGON_CLIP_PATH_PLANT_IGNORED) return');
    });
  }
});
