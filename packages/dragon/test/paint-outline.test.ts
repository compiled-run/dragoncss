// PNT1 outlines (css-ui-4 §3): the shorthand and the longhands with Chrome 145's parsing (hidden, auto and invert refused as Chrome
// does, hairline and percentages invalid), the computed values (keyword widths to px, 0 for style none, the webref initial auto
// colour as currentcolor, em offsets to px), the refusals, the native refusals (other styles, inline boxes, and what the root-view
// outline would paint out of Chrome's order), and the native write and its emission.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { androidProfile, createProjectWith, HIT_MODELLED, iosProfile, NO_FAULTS, nativeOutlinePending, nativePrograms } from '../src/internal.ts';
import { OUTLINE_EMITTER } from '../src/emit/paint/outline.ts';
import { outlineOffsetPx, outlineRings, outlineWidthPx, roundedShape } from '@dragon/layout';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Targets } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/outline.css', revision: 'r1', hash: 'sha256:0' };
const LONGHANDS = ['outline-color', 'outline-style', 'outline-width', 'outline-offset'];

function declare(property: string, value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; css: string } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, css };
}

const compile = (css: string, targets: Targets = { web: {} }) =>
  createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; color: rgb(10, 20, 30); font-size: 20px; } ${css}`, (r) => [div(r, 'a', ['a'])]));

describe('outline: parse and computed values (Chrome 145 getComputedStyle)', () => {
  // [declaration, the computed colour, style, width and offset] (probed with the pinned Chrome; Dragon keeps currentcolor as a keyword)
  const cases: [string, [string, string, string, string]][] = [
    ['outline: none', ['currentcolor', 'none', '0px', '0px']],
    ['outline: 2px solid red', ['rgb(255, 0, 0)', 'solid', '2px', '0px']],
    ['outline: auto', ['currentcolor', 'auto', '3px', '0px']],
    ['outline: 3px dashed', ['currentcolor', 'dashed', '3px', '0px']],
    ['outline: dotted blue', ['rgb(0, 0, 255)', 'dotted', '3px', '0px']],
    ['outline: double 5px green', ['rgb(0, 128, 0)', 'double', '5px', '0px']],
    ['outline: thin solid', ['currentcolor', 'solid', '1px', '0px']],
    ['outline: medium', ['currentcolor', 'none', '0px', '0px']],
    ['outline: thick groove', ['currentcolor', 'groove', '5px', '0px']],
    ['outline: 1px solid currentcolor', ['currentcolor', 'solid', '1px', '0px']],
    ['outline: 0 solid red', ['rgb(255, 0, 0)', 'solid', '0px', '0px']],
    ['outline: auto 1px blue', ['rgb(0, 0, 255)', 'auto', '1px', '0px']],
    ['outline: inset 4px', ['currentcolor', 'inset', '4px', '0px']],
    ['outline: 2em solid', ['currentcolor', 'solid', '40px', '0px']],
    ['outline: red', ['rgb(255, 0, 0)', 'none', '0px', '0px']],
    ['outline-style: solid; outline-width: 1em', ['currentcolor', 'solid', '20px', '0px']],
    ['outline-style: solid; outline-offset: 1.3em', ['currentcolor', 'solid', '3px', '26px']],
    ['outline-style: solid; outline-offset: -2px', ['currentcolor', 'solid', '3px', '-2px']],
    ['outline-width: 4px', ['currentcolor', 'none', '0px', '0px']],
    ['outline-color: transparent', ['transparent', 'none', '0px', '0px']],
    ['outline-style: solid; outline-color: rgba(1,2,3,0.5)', ['rgba(1, 2, 3, 0.5)', 'solid', '3px', '0px']],
  ];
  for (const [decl, want] of cases) {
    it(`${decl} computes to ${want.join(' | ')}`, () => {
      const c = compile(`.a { height: 10px; ${decl}; }`);
      expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(LONGHANDS.map((p) => explainOne(c, 'web', 'a', p).value)).toEqual(want);
    });
  }
  it('the initial values are Chrome\'s: currentcolor, none, 0px (medium under none) and 0px', () => {
    const c = compile('.a { height: 10px; }');
    expect(LONGHANDS.map((p) => explainOne(c, 'web', 'a', p).value)).toEqual(['currentcolor', 'none', '0px', '0px']);
  });
  it('invert, a hidden style, two styles, two widths, hairline, a negative width, percentages and an auto offset are invalid, as in Chrome', () => {
    for (const [p, v] of [['outline', 'invert'], ['outline', 'hidden 3px'], ['outline', 'solid dashed'], ['outline', '2px 3px'], ['outline-color', 'auto'], ['outline-color', 'invert'], ['outline-style', 'hidden'], ['outline-width', 'hairline'], ['outline-width', '-1px'], ['outline-width', '10%'], ['outline-offset', '10%'], ['outline-offset', 'auto']] as const) {
      const { declaration, diagnostics } = declare(p, v);
      expect(declaration, `${p}: ${v}`).toBeNull();
      expect(diagnostics.map((d) => d.code), `${p}: ${v}`).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expectCatalogued(diagnostics);
    }
  });
  it('a system colour, a calculation and a viewport unit are DRAGON_UNSUPPORTED_VALUE on the token', () => {
    for (const [p, v, span] of [['outline', '1px solid Highlight', 'Highlight'], ['outline-width', 'calc(1px + 1px)', 'calc(1px + 1px)'], ['outline-offset', '2vw', '2vw'], ['outline', '1vh solid', '1vh']] as const) {
      const { declaration, diagnostics, css } = declare(p, v);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      const o = diagnostics[0]?.origin;
      expect(o !== undefined && o.kind === 'authored' ? css.slice(o.span.start, o.span.end) : null, v).toBe(span);
      expectCatalogued(diagnostics);
    }
  });
});

describe('outline: the native targets draw solid and double outlines', () => {
  const targets: Targets = { ios: { minimum: '15.0' }, web: {} };
  const tree = (css: string, body: Parameters<typeof inputFor>[1], t: Targets = targets) =>
    createProjectWith({ projectId: 'test', targets: t }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; color: rgb(10, 20, 30); font-size: 20px; } ${css}`, body));
  const errors = (c: { diagnostics: readonly Diagnostic[] }) => c.diagnostics.filter((d) => d.severity === 'error');
  it('a dotted, dashed, 3D or auto outline is refused on ios at the style declaration and compiles for web', () => {
    for (const css of ['outline: 2px dashed red', 'outline-style: dotted', 'outline: 3px groove', 'outline: auto 0']) {
      const c = compile(`.a { height: 10px; ${css}; }`, targets);
      const errs = errors(c);
      expect(errs.map((d) => [d.code, d.target]), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      expect(errs[0]?.message, css).toMatch(/; ios draws solid and double outlines only \(PNT1\)$/);
      expectCatalogued(errs);
    }
  });
  it('an outline on an inline box is refused on ios (Blink outlines each line fragment)', () => {
    const c = compile('.a { display: inline; outline: 2px solid red; }', targets);
    expect(errors(c).map((d) => [d.target, d.message])).toEqual([['ios', expect.stringMatching(/^a has an outline on an inline box, which Blink draws around each line fragment; ios draws/)]]);
    expectCatalogued(errors(c));
  });
  it('solid and double outlines compile everywhere, a negative offset on a box that clips its own overflow included', () => {
    for (const css of ['outline: none', 'outline: 0 solid red', 'outline-width: 5px; outline-offset: 3px', 'outline: 2px solid red', 'outline: 6px double blue; outline-offset: -2px', 'overflow: hidden; outline: 1px solid; outline-offset: -2px', 'border-radius: 4px; outline: 2px solid']) {
      const ok = compile(`.a { height: 10px; ${css}; }`, targets);
      expect(errors(ok), css).toEqual([]);
    }
    // display: contents generates no box, so even a dashed outline on it paints nothing: no outline refusal (the native layout
    // lowering refuses display: contents on its own).
    const contents = errors(compile('.a { display: contents; outline: 2px dashed red; }', targets));
    expect(contents.filter((d) => d.message.includes('outline'))).toEqual([]);
    expect(contents.map((d) => d.code)).toEqual(['DRAGON_LOWERING_FAILED']);
  });
  it("an outline inside an overflow clip or scroller is refused on ios, at the outline, naming the clip; the viewport's propagated overflow does not count", () => {
    for (const overflow of ['hidden', 'clip', 'auto']) {
      const c = tree(`.p { height: 20px; overflow: ${overflow}; } .b { height: 5px; outline: 2px solid red; }`, (r) => [div(r, 'p', ['p'], [div(r, 'b', ['b'])])]);
      const outline = errors(c).filter((d) => d.message.includes('outline'));
      expect(outline.map((d) => [d.target, d.message]), overflow).toEqual([['ios', 'b has an outline inside the overflow clip of p, and Dragon draws native outlines in the root view, outside that clip, until it models stacking order; ios draws solid and double outlines only (PNT1)']]);
      expect(outline[0]?.origin.kind, overflow).toBe('authored');
      expectCatalogued(outline);
    }
    // body's overflow goes to the viewport while html's is visible (css-overflow-3 §3.3), so body does not clip.
    const propagated = tree('body { overflow: hidden; } .b { height: 5px; outline: 2px solid red; }', (r) => [div(r, 'b', ['b'])]);
    expect(errors(propagated)).toEqual([]);
  });
  it('an outline in a case with a positioned or transformed box is refused on ios (Chrome paints those above every outline); web compiles', () => {
    for (const [css, what] of [['.q { position: relative; top: 2px; height: 5px; }', 'q has position: relative'], ['.q { position: absolute; width: 5px; height: 5px; }', 'q has position: absolute'], ['.q { height: 5px; transform: translateX(2px); }', 'q has a transform']] as const) {
      const c = tree(`.b { height: 5px; outline: 2px solid red; } ${css}`, (r) => [div(r, 'b', ['b']), div(r, 'q', ['q'])]);
      const outline = errors(c).filter((d) => d.message.includes('outline'));
      expect(outline.map((d) => [d.target, d.message]), css).toEqual([['ios', `b has an outline, and ${what}, which Chrome paints above every outline of its stacking context (CSS2 Appendix E); Dragon draws native outlines after all the content until it models stacking order; ios draws solid and double outlines only (PNT1)`]]);
      expectCatalogued(outline);
    }
    // A positioned box leaves a case alone when no outline paints: none, a zero width, or a style of none.
    for (const b of ['.b { height: 5px; }', '.b { height: 5px; outline: 0 solid red; }', '.b { height: 5px; outline: 2px none red; }']) {
      const c = tree(`${b} .q { position: relative; top: 2px; height: 5px; }`, (r) => [div(r, 'b', ['b']), div(r, 'q', ['q'])]);
      expect(errors(c), b).toEqual([]);
    }
  });
  it('each refusal is reported once per element and target, on both native targets', () => {
    const c = tree('.b { height: 5px; outline: 2px solid red; } .q { position: relative; } .r { position: relative; }', (r) => [div(r, 'b', ['b']), div(r, 'q', ['q']), div(r, 'r', ['r'])], { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} });
    expect(errors(c).filter((d) => d.message.includes('outline')).map((d) => d.target).sort()).toEqual(['android', 'ios']);
  });
  it('native claims no row for an outline style it refuses wherever it paints, and a zero-width one still compiles there', () => {
    for (const style of ['dotted', 'dashed', 'groove', 'ridge', 'inset', 'outset', 'auto']) expect(nativeOutlinePending(`outline-style:${style}`), style).toBe(true);
    for (const style of ['solid', 'double', 'none', 'inherit']) expect(nativeOutlinePending(`outline-style:${style}`), style).toBe(false);
    expect(nativeOutlinePending('border-top-style:dashed')).toBe(false);
    // A zero-width dotted outline (outline-values proves its computed value) proves no paint, so no native row may claim the style.
    for (const r of [...iosProfile.rows, ...androidProfile.rows]) expect(nativeOutlinePending(r.feature), `${r.feature}@${r.context}`).toBe(false);
    for (const css of ['outline: 0 dashed', 'outline: #abc 0 dotted', 'outline-width: 0; outline-style: groove']) expect(errors(compile(`.a { height: 10px; ${css}; }`, targets)), css).toEqual([]);
  });
});

describe('outline: lowering and emission', () => {
  const programs = (css: string, body: Parameters<typeof inputFor>[1] = (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'])])]) => {
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; color: rgb(10, 20, 30); font-size: 20px; } ${css}`, body));
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };
  it('a solid or double outline is one write with its px values, colour and radii; none, zero widths and transparent get none', () => {
    const p = programs('.a { height: 20px; outline: 0.2em double currentcolor; outline-offset: 1.5px; border-radius: 4px; } .b { height: 5px; outline: 3px solid transparent; }');
    for (const b of ['uikit', 'android-views'] as const) {
      const a = p[b].nodes.find((n) => n.id === 'a');
      const w = a?.writes.find((x) => x.kind === 'outline');
      expect(w, b).toEqual(expect.objectContaining({ kind: 'outline', key: 'dragonOutline.rings', technique: 'dragon-owned-paint', style: 'double', width: 4, offset: 1.5, color: { r: 10, g: 20, b: 30, alpha: 255 }, css: ['outline-color', 'outline-style', 'outline-width', 'outline-offset'] }));
      expect((w as { radii: unknown }).radii, b).toEqual([4, 4, 4, 4, 4, 4, 4, 4].map((value) => ({ percent: false, value })));
      expect(p[b].nodes.find((n) => n.id === 'b')?.writes.some((x) => x.kind === 'outline'), b).toBe(false);
    }
    const square = programs('.a { height: 20px; outline: 1px solid red; }');
    expect(square.uikit.nodes.find((n) => n.id === 'a')?.writes.find((x) => x.kind === 'outline')).toEqual(expect.objectContaining({ style: 'solid', width: 1, offset: 0, color: { r: 255, g: 0, b: 0, alpha: 255 }, radii: null }));
  });
  it('emits the runtime writer on both backends', () => {
    const p = programs('.a { height: 20px; outline: 3px solid rgb(1, 2, 3); outline-offset: -2px; } .b { outline: 1.5px double red; }');
    const line = (b: 'uikit' | 'android-views', id: string): string[] => {
      const n = p[b].nodes.find((x) => x.id === id);
      const w = n?.writes.find((x) => x.kind === 'outline');
      if (n === undefined || w === undefined || w.kind !== 'outline') throw new Error(`${id}: no outline write`);
      return OUTLINE_EMITTER.lines[b]('v1', n, w);
    };
    for (const b of ['uikit', 'android-views'] as const) {
      expect(line(b, 'a'), b).toEqual(['  dragonSetOutline(t, v1, false, 3.0, -2.0, DragonRGBA8(1, 2, 3, 255))']);
      expect(line(b, 'b'), b).toEqual(['  dragonSetOutline(t, v1, true, 1.5, 0.0, DragonRGBA8(255, 0, 0, 255))']);
    }
  });
  it('the expected applied value is the TS outlineRings rects at the device scale, the radii those of the rounded box', () => {
    const p = programs('.a { height: 20px; border-radius: 6px; outline: 5px double red; outline-offset: 1.4px; }');
    const w = p.uikit.nodes.find((n) => n.id === 'a')?.writes.find((x) => x.kind === 'outline');
    if (w === undefined || w.kind !== 'outline') throw new Error('no outline write');
    const box = { left: 0, top: 0, right: 300, bottom: 40 };
    const g = { border: [0, 0, 0, 0] as [number, number, number, number], box, size: [300, 40] as [number, number], fontSize: null, replaced: null };
    const got = OUTLINE_EMITTER.applied({ paint: { roundedShape, outlineRings, outlineWidthPx, outlineOffsetPx } } as never, 'uikit', w, 2, g as never);
    const radii = roundedShape(0, 0, 300, 40, 300, 40, [0, 0, 0, 0], (w.radii ?? []) as never, 2, { radiusUnclamped: false, innerRadiusNotReduced: false }).slice(0, 8);
    const rings = outlineRings(0, 0, 300, 40, radii, 10, 2, true);
    expect(rings).toHaveLength(48);
    expect(got).toEqual([...rings.slice(0, 8), ...rings.slice(24, 32)]);
    // Two bands of round(10 / 3) = 3 device px at either edge of the 10 device px ring, 2 device px out.
    expect(got).toEqual([-12, -12, 312, 52, -9, -9, 309, 49, -5, -5, 305, 45, -2, -2, 302, 42]);
  });
});

describe('outline: the hit model (R13)', () => {
  it('models the outline longhands at their computed initial values only, so an outline that paints stays an unmodelled fact', () => {
    const m = (p: 'outline-color' | 'outline-style' | 'outline-width' | 'outline-offset', v: unknown): boolean | undefined => HIT_MODELLED.get(p)?.(v as never);
    expect([m('outline-color', { kind: 'keyword', value: 'currentcolor' }), m('outline-style', { kind: 'keyword', value: 'none' }), m('outline-width', { kind: 'length', value: 0, unit: 'px' }), m('outline-offset', { kind: 'length', value: 0, unit: 'px' })]).toEqual([true, true, true, true]);
    expect([m('outline-color', { kind: 'keyword', value: 'red' }), m('outline-style', { kind: 'keyword', value: 'solid' }), m('outline-width', { kind: 'length', value: 2, unit: 'px' }), m('outline-offset', { kind: 'length', value: -1, unit: 'px' })]).toEqual([false, false, false, false]);
  });
});
