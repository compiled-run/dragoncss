// PNT1 outlines (css-ui-4 §3): the shorthand and the longhands with Chrome 145's parsing (hidden, auto and invert refused as Chrome
// does, hairline and percentages invalid), the computed values (keyword widths to px, 0 for style none, the webref initial auto
// colour as currentcolor, em offsets to px), the refusals, the native refusals (auto, a rounded outline in a style other than solid
// or double, inline boxes, and what the root-view outline would paint out of Chrome's order), the 3D tones (Color::Dark and Light,
// CalculateInsetOutsetColor), and the native write and its emission.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { androidProfile, createProjectWith, HIT_MODELLED, iosProfile, NO_FAULTS, nativeOutlinePending, nativePrograms } from '../src/internal.ts';
import { OUTLINE_EMITTER } from '../src/emit/paint/outline.ts';
import { contrastRatio, darkColor, insetOutsetTones, lightColor } from '../src/css/color.ts';
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

describe('outline: the native targets draw every style but auto, the side painter styles on square corners', () => {
  const targets: Targets = { ios: { minimum: '15.0' }, web: {} };
  const tree = (css: string, body: Parameters<typeof inputFor>[1], t: Targets = targets) =>
    createProjectWith({ projectId: 'test', targets: t }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; color: rgb(10, 20, 30); font-size: 20px; } ${css}`, body));
  const errors = (c: { diagnostics: readonly Diagnostic[] }) => c.diagnostics.filter((d) => d.severity === 'error');
  const SUFFIX = '; ios draws solid and double outlines, and dotted, dashed, groove, ridge, inset and outset ones on square corners (PNT1)';
  it('an auto outline is refused on ios at any width, by name, at the style declaration, and compiles for web', () => {
    for (const css of ['outline: auto', 'outline: auto 0', 'outline: auto 4px red', 'outline-style: auto; border-radius: 3px']) {
      const errs = errors(compile(`.a { height: 10px; ${css}; }`, targets));
      expect(errs.map((d) => [d.code, d.target, d.message]), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios', `a has outline-style auto, Chrome's focus ring, whose ring follows the descendants' outline rects${SUFFIX}`]]);
      expect(errs[0]?.origin.kind, css).toBe('authored');
      expectCatalogued(errs);
      expect(errors(compile(`.a { height: 10px; ${css}; }`)), css).toEqual([]);
    }
  });
  it('a rounded dotted, dashed, groove, ridge, inset or outset outline is refused on ios, by name; web compiles', () => {
    for (const style of ['dotted', 'dashed', 'groove', 'ridge', 'inset', 'outset']) {
      for (const radius of ['border-radius: 4px', 'border-top-right-radius: 3px 5px', 'border-radius: 10%']) {
        const css = `outline: 3px ${style} red; ${radius}`;
        const errs = errors(compile(`.a { height: 10px; ${css}; }`, targets));
        expect(errs.map((d) => [d.code, d.target, d.message]), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios', `a has a ${style} outline on rounded corners, which Blink strokes along the rounded centre line (PNT1b)${SUFFIX}`]]);
        expectCatalogued(errs);
        expect(errors(compile(`.a { height: 10px; ${css}; }`)), css).toEqual([]);
      }
    }
  });
  it('a dotted, dashed, groove, ridge, inset or outset outline on square corners compiles on ios, a radius with a zero component included', () => {
    for (const style of ['dotted', 'dashed', 'groove', 'ridge', 'inset', 'outset']) {
      for (const extra of ['', 'outline-offset: -3px', 'border-radius: 0', 'border-top-left-radius: 6px 0']) {
        const css = `outline: 3px ${style} red; ${extra}`;
        expect(errors(compile(`.a { height: 10px; ${css}; }`, targets)), css).toEqual([]);
      }
    }
  });
  it('an outline on an inline box is refused on ios (Blink outlines each line fragment)', () => {
    const c = compile('.a { display: inline; outline: 2px solid red; }', targets);
    expect(errors(c).map((d) => [d.target, d.message])).toEqual([['ios', expect.stringMatching(/^a has an outline on an inline box, which Blink draws around each line fragment; ios draws/)]]);
    // A dashed one too: the inline refusal still applies once the style is drawn.
    expect(errors(compile('.a { display: inline; outline: 2px dashed red; }', targets)).map((d) => d.target)).toEqual(['ios']);
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
      expect(outline.map((d) => [d.target, d.message]), overflow).toEqual([['ios', `b has an outline inside the overflow clip of p, and Dragon draws native outlines in the root view, outside that clip, until it hosts them in their stacking context${SUFFIX}`]]);
      expect(outline[0]?.origin.kind, overflow).toBe('authored');
      expectCatalogued(outline);
    }
    // body's overflow goes to the viewport while html's is visible (css-overflow-3 §3.3), so body does not clip.
    const propagated = tree('body { overflow: hidden; } .b { height: 5px; outline: 2px solid red; }', (r) => [div(r, 'b', ['b'])]);
    expect(errors(propagated)).toEqual([]);
  });
  it('an outline in a case with a layer item of the stacking tree is refused on ios (Chrome paints its layer above the outlines); web compiles', () => {
    const layers = [
      ['.q { position: relative; top: 2px; height: 5px; }', 'q has position: relative'],
      ['.q { position: absolute; width: 5px; height: 5px; }', 'q has position: absolute'],
      ['.q { height: 5px; transform: translateX(2px); }', 'q has a transform'],
      // Master's stacking tree (lower/paint/stacking.ts) also makes these layer items: opacity below 1, will-change: opacity, and
      // a z-index on a flex item.
      ['.q { height: 5px; opacity: 0.5; }', 'q has opacity: 0.5'],
      ['.q { height: 5px; will-change: opacity; }', 'q has will-change: opacity'],
      ['body { display: flex; } .q { height: 5px; z-index: 2; }', 'q has z-index: 2 on a flex item'],
    ] as const;
    for (const [css, what] of layers) {
      const c = tree(`.b { height: 5px; outline: 2px solid red; } ${css}`, (r) => [div(r, 'b', ['b']), div(r, 'q', ['q'])]);
      const outline = errors(c).filter((d) => d.message.includes('outline'));
      expect(outline.map((d) => [d.target, d.message]), css).toEqual([['ios', `b has an outline, and ${what}, which Chrome paints in a layer of its own, above the outlines of its stacking context (CSS2 Appendix E); Dragon draws native outlines after all the content until it hosts them in their stacking context${SUFFIX}`]]);
      expectCatalogued(outline);
    }
    // A z-index on a static box outside a flex container makes no layer (CSS2 §9.9.1), so the outline stays in the root's flow.
    const flat = tree('.b { height: 5px; outline: 2px solid red; } .q { height: 5px; z-index: 2; }', (r) => [div(r, 'b', ['b']), div(r, 'q', ['q'])]);
    expect(errors(flat).filter((d) => d.message.includes('outline'))).toEqual([]);
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
  it('native claims no row for auto, which it refuses wherever it paints, and a zero-width one still compiles there', () => {
    expect(nativeOutlinePending('outline-style:auto')).toBe(true);
    for (const style of ['solid', 'double', 'dotted', 'dashed', 'groove', 'ridge', 'inset', 'outset', 'none', 'inherit']) expect(nativeOutlinePending(`outline-style:${style}`), style).toBe(false);
    expect(nativeOutlinePending('border-top-style:dashed')).toBe(false);
    expect(nativeOutlinePending('outline-style:autox')).toBe(false);
    // An auto outline that paints nothing (display: contents) compiles but proves no paint, so no native row may claim the style.
    for (const r of [...iosProfile.rows, ...androidProfile.rows]) expect(nativeOutlinePending(r.feature), `${r.feature}@${r.context}`).toBe(false);
    expect(errors(compile('.a { display: contents; outline: auto; }', targets)).filter((d) => d.message.includes('outline'))).toEqual([]);
    // A zero-width outline in another style paints nothing either, and compiles, rounded or not.
    for (const css of ['outline: #abc 0 dotted', 'outline-width: 0; outline-style: groove; border-radius: 4px']) expect(errors(compile(`.a { height: 10px; ${css}; }`, targets)), css).toEqual([]);
  });
});

describe("outline: the web output keeps Chrome's UA focus ring", () => {
  const webText = (css: string): string => {
    const c = compile(css);
    const out = c.outputs.web;
    if (out.kind !== 'ready') throw new Error(out.kind);
    return (out.files[0] as { text: string }).text;
  };
  const written = (text: string): string[] => LONGHANDS.filter((p) => text.includes(`  ${p}: `));
  it("writes no outline longhand no author declaration sets, so Chrome's :focus-visible rule (outline: auto 1px) still applies", () => {
    expect(written(webText('.a { height: 10px; }'))).toEqual([]);
    // revert rolls back to the UA origin, whose :focus-visible rule the output must keep.
    expect(written(webText('.a { outline: revert; }'))).toEqual([]);
  });
  it('writes every outline longhand once an author declaration sets one, in the base rule or an interaction state', () => {
    expect(written(webText('.a { outline: 2px solid red; }'))).toEqual(LONGHANDS);
    expect(written(webText('.a { outline-style: initial; }'))).toEqual(LONGHANDS);
    // outline: none under :focus-visible hides the ring: the base rule writes none, which the state then keeps.
    const text = webText('.a:focus-visible { outline: none; }');
    expect(written(text)).toEqual(LONGHANDS);
    expect(text).toContain('  outline-style: none;');
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
  it('a hidden or collapsed box writes no outline, and its visible child keeps its own; a child that inherits hidden writes none', () => {
    for (const v of ['hidden', 'collapse']) {
      const p = programs(`.a { height: 20px; outline: 2px solid red; visibility: ${v}; } .b { height: 5px; outline: 1px solid blue; visibility: visible; }`);
      for (const b of ['uikit', 'android-views'] as const) {
        expect(p[b].nodes.find((n) => n.id === 'a')?.writes.some((x) => x.kind === 'outline'), `${v} ${b}`).toBe(false);
        expect(p[b].nodes.find((n) => n.id === 'b')?.writes.some((x) => x.kind === 'outline'), `${v} ${b}`).toBe(true);
      }
    }
    const inherited = programs('.a { height: 20px; visibility: hidden; } .b { height: 5px; outline: 1px solid blue; }');
    for (const b of ['uikit', 'android-views'] as const) expect(inherited[b].nodes.find((n) => n.id === 'b')?.writes.some((x) => x.kind === 'outline'), b).toBe(false);
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
      expect(line(b, 'a'), b).toEqual(['  dragonSetOutline(t, v1, "solid", 3.0, -2.0, DragonRGBA8(1, 2, 3, 255), DragonRGBA8(1, 2, 3, 255), DragonRGBA8(1, 2, 3, 255))']);
      expect(line(b, 'b'), b).toEqual(['  dragonSetOutline(t, v1, "double", 1.5, 0.0, DragonRGBA8(255, 0, 0, 255), DragonRGBA8(255, 0, 0, 255), DragonRGBA8(255, 0, 0, 255))']);
    }
    const q = programs('.a { height: 20px; outline: 4px groove rgb(20, 40, 60); } .b { outline: 2px dashed rgba(255, 0, 0, 0.5); outline-offset: 1px; }');
    const at = (b: 'uikit' | 'android-views', id: string): string[] => {
      const n = q[b].nodes.find((x) => x.id === id);
      const w = n?.writes.find((x) => x.kind === 'outline');
      if (n === undefined || w === undefined || w.kind !== 'outline') throw new Error(`${id}: no outline write`);
      return OUTLINE_EMITTER.lines[b]('v1', n, w);
    };
    for (const b of ['uikit', 'android-views'] as const) {
      // rgb(20, 40, 60) is dark: its darker tone is black, and it contrasts with black by less than 1.75, so its lighter one is Color::Light.
      expect(at(b, 'a'), b).toEqual(['  dragonSetOutline(t, v1, "groove", 4.0, 0.0, DragonRGBA8(20, 40, 60, 255), DragonRGBA8(48, 96, 144, 255), DragonRGBA8(0, 0, 0, 255))']);
      expect(at(b, 'b'), b).toEqual(['  dragonSetOutline(t, v1, "dashed", 2.0, 1.0, DragonRGBA8(255, 0, 0, 128), DragonRGBA8(255, 0, 0, 128), DragonRGBA8(255, 0, 0, 128))']);
    }
  });
  it('a 3D style writes its tones, the other styles none', () => {
    const p = programs('.a { height: 20px; outline: 4px inset rgb(200, 60, 60); } .b { height: 5px; outline: 2px dotted rgb(200, 60, 60); }');
    for (const b of ['uikit', 'android-views'] as const) {
      const w = (id: string) => p[b].nodes.find((n) => n.id === id)?.writes.find((x) => x.kind === 'outline');
      expect(w('a'), b).toEqual(expect.objectContaining({ style: 'inset', tones: [{ r: 200, g: 60, b: 60, alpha: 255 }, darkColor({ r: 200, g: 60, b: 60, alpha: 255 })], radii: null }));
      expect(w('b'), b).toEqual(expect.objectContaining({ style: 'dotted', tones: null }));
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

describe("outline: the 3D tones (Blink 145's Color::Dark, Color::Light and CalculateInsetOutsetColor)", () => {
  const c = (r: number, g: number, b: number, alpha = 255) => ({ r, g, b, alpha });
  it("Color::Dark and Color::Light: white's darker is 171, black's lighter is 84, others scale by their largest channel", () => {
    expect(darkColor(c(255, 255, 255))).toEqual(c(171, 171, 171));
    expect(lightColor(c(0, 0, 0))).toEqual(c(84, 84, 84));
    expect(darkColor(c(0, 0, 0))).toEqual(c(0, 0, 0));
    expect(lightColor(c(255, 255, 255))).toEqual(c(255, 255, 255));
    // v = 200/255: each channel times (v - 0.33) / v, then QuantizeTo8Bit (times the float below 256, truncated): red is v - 0.33 = 0.4543, 116; the alpha is kept.
    expect(darkColor(c(200, 60, 60, 128))).toEqual(c(116, 34, 34, 128));
    // v = 60/255, under 0.33: the darker tone is black.
    expect(darkColor(c(20, 40, 60))).toEqual(c(0, 0, 0));
    expect(lightColor(c(20, 40, 60))).toEqual(c(48, 96, 144));
  });
  it('CalculateInsetOutsetColor keeps a bright colour (red from 150 or green from 92) and lightens a dark one that barely contrasts with its darker tone', () => {
    expect(insetOutsetTones(c(200, 60, 60))).toEqual([c(200, 60, 60), darkColor(c(200, 60, 60))]);
    expect(insetOutsetTones(c(30, 150, 60))).toEqual([c(30, 150, 60), darkColor(c(30, 150, 60))]);
    expect(insetOutsetTones(c(0, 0, 0))).toEqual([c(84, 84, 84), c(0, 0, 0)]);
    expect(insetOutsetTones(c(255, 255, 255))).toEqual([c(255, 255, 255), c(171, 171, 171)]);
    expect(insetOutsetTones(c(20, 40, 60))).toEqual([c(48, 96, 144), c(0, 0, 0)]);
    // Dark but contrasting with its darker tone by at least 1.75: kept.
    const blue = c(100, 80, 250);
    expect(contrastRatio(blue, darkColor(blue))).toBeGreaterThanOrEqual(Math.fround(1.75));
    expect(insetOutsetTones(blue)[0]).toEqual(blue);
    expect(contrastRatio(c(0, 0, 0), c(255, 255, 255))).toBeCloseTo(21, 4);
    expect(contrastRatio(c(255, 255, 255), c(0, 0, 0))).toBe(contrastRatio(c(0, 0, 0), c(255, 255, 255)));
  });
});

describe('outline: the hit model (R13)', () => {
  it('models the outline longhands at their computed initial values only, so an outline that paints stays an unmodelled fact', () => {
    const m = (p: 'outline-color' | 'outline-style' | 'outline-width' | 'outline-offset', v: unknown): boolean | undefined => HIT_MODELLED.get(p)?.(v as never);
    expect([m('outline-color', { kind: 'keyword', value: 'currentcolor' }), m('outline-style', { kind: 'keyword', value: 'none' }), m('outline-width', { kind: 'length', value: 0, unit: 'px' }), m('outline-offset', { kind: 'length', value: 0, unit: 'px' })]).toEqual([true, true, true, true]);
    expect([m('outline-color', { kind: 'keyword', value: 'red' }), m('outline-style', { kind: 'keyword', value: 'solid' }), m('outline-width', { kind: 'length', value: 2, unit: 'px' }), m('outline-offset', { kind: 'length', value: -1, unit: 'px' })]).toEqual([false, false, false, false]);
  });
});
