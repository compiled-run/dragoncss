// PNT1 outlines (css-ui-4 §3): the shorthand and the longhands with Chrome 145's parsing (hidden, auto and invert refused as Chrome
// does, hairline and percentages invalid), the computed values (keyword widths to px, 0 for style none, the webref initial auto
// colour as currentcolor, em offsets to px), the refusals, and the native refusal of an outline that paints (T115 part B).
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import { OUTLINE_EMITTER } from '../src/emit/paint/outline.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Targets } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, text } from './helpers.ts';

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
  it('a dotted, dashed, 3D or auto outline is refused on ios at the style declaration and compiles for web', () => {
    for (const css of ['outline: 2px dashed red', 'outline-style: dotted', 'outline: 3px groove', 'outline: auto 0']) {
      const c = compile(`.a { height: 10px; ${css}; }`, targets);
      const errs = c.diagnostics.filter((d) => d.severity === 'error');
      expect(errs.map((d) => [d.code, d.target]), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      expect(errs[0]?.message, css).toMatch(/; ios draws solid and double outlines only \(PNT1\)$/);
      expectCatalogued(errs);
    }
  });
  it('a negative offset on a box that clips its overflow is refused on ios; solid and double outlines otherwise compile everywhere', () => {
    const c = compile('.a { height: 10px; overflow: hidden; outline: 2px solid red; outline-offset: -1px; }', targets);
    expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([expect.stringMatching(/^a has a solid outline with a negative offset and clips its overflow/)]);
    for (const css of ['outline: none', 'outline: 0 solid red', 'outline-width: 5px; outline-offset: 3px', 'outline: 2px solid red', 'outline: 6px double blue; outline-offset: -2px', 'overflow: hidden; outline: 1px solid; outline-offset: 2px']) {
      const ok = compile(`.a { height: 10px; ${css}; }`, targets);
      expect(ok.diagnostics.filter((d) => d.severity === 'error'), css).toEqual([]);
    }
  });
});

describe('outline: lowering and emission', () => {
  const programs = (css: string, body: Parameters<typeof inputFor>[1] = (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'])])]) => {
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; color: rgb(10, 20, 30); font-size: 20px; } ${css}`, body));
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };
  it('a solid or double outline is one write with its px values, colour, radii and host; none, zero widths and transparent get none', () => {
    const p = programs('.a { height: 20px; outline: 0.2em double currentcolor; outline-offset: 1.5px; border-radius: 4px; } .b { height: 5px; outline: 3px solid transparent; }');
    const a = p.uikit.nodes.find((n) => n.id === 'a');
    const w = a?.writes.find((x) => x.kind === 'outline');
    expect(w).toEqual(expect.objectContaining({ kind: 'outline', key: 'dragonOutline.rings', technique: 'dragon-owned-paint', style: 'double', width: 4, offset: 1.5, color: { r: 10, g: 20, b: 30, alpha: 255 }, host: 'html', css: ['outline-color', 'outline-style', 'outline-width', 'outline-offset'] }));
    expect((w as { radii: unknown }).radii).toHaveLength(8);
    expect(a?.facts['outline']).toEqual({ style: 'double', width: 4, offset: 1.5, host: 'html', layer: 'html' });
    expect(p.uikit.nodes.find((n) => n.id === 'b')?.writes.some((x) => x.kind === 'outline')).toBe(false);
  });
  it('an outline paints in its own view when its box is a layer item, and under the nearest clip otherwise', () => {
    const p = programs('.a { height: 20px; overflow: hidden; } .b { height: 5px; outline: 2px solid red; } .c { position: relative; height: 5px; outline: 2px solid red; }', (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'])]), div(r, 'c', ['c'])]);
    const host = (id: string): unknown => (p.uikit.nodes.find((n) => n.id === id)?.writes.find((x) => x.kind === 'outline') as { host?: string } | undefined)?.host;
    expect([host('b'), host('c')]).toEqual(['a', 'c']);
  });
  it('a layer box holding text paints its outline in its own view (the sort on every added view puts it after the text)', () => {
    const p = programs('.c { position: relative; height: 20px; font-family: Ahem; font-size: 10px; outline: 2px solid red; }', (r) => [div(r, 'c', ['c'], [text(r, 'ct', 'XX')])]);
    const w = p.uikit.nodes.find((n) => n.id === 'c')?.writes.find((x) => x.kind === 'outline');
    expect(w).toEqual(expect.objectContaining({ host: 'c' }));
    expect(w).not.toHaveProperty('after');
  });
  it('a flex item paints its outline in its own atomic pass, and a box inside it in the flex item\'s view', () => {
    const p = programs('.f { display: flex; } .i { width: 30px; height: 20px; outline: 2px solid red; } .k { height: 5px; outline: 1px solid blue; }', (r) => [div(r, 'f', ['f'], [div(r, 'i', ['i'], [div(r, 'k', ['k'])])])]);
    const of = (id: string) => p.uikit.nodes.find((n) => n.id === id)?.facts['outline'];
    expect(of('i')).toMatchObject({ host: 'i', layer: 'i' });
    expect(of('k')).toMatchObject({ host: 'i', layer: 'i' });
  });
  it('emits the runtime writer on both backends', () => {
    const p = programs('.a { height: 20px; outline: 3px solid rgb(1, 2, 3); outline-offset: -2px; }');
    const a = p.uikit.nodes.find((n) => n.id === 'a');
    const w = a?.writes.find((x) => x.kind === 'outline');
    if (w === undefined || w.kind !== 'outline') throw new Error('no outline write');
    expect(OUTLINE_EMITTER.lines.uikit('v1', a as never, w)).toEqual([`  dragonSetOutline(t, v1, "html", ${w.rank}, false, 3.0, -2.0, DragonRGBA8(1, 2, 3, 255))`]);
    expect(OUTLINE_EMITTER.lines['android-views']('v1', a as never, w)).toEqual([`  dragonSetOutline(t, v1, "html", ${w.rank}, false, 3.0, -2.0, DragonRGBA8(1, 2, 3, 255))`]);
  });
});
