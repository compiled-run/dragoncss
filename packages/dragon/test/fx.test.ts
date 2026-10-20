// FX-0: backdrop-filter and mix-blend-mode. Both parse as Chrome 145 does (packages/parity/test/fx-parse.test.ts pins it), web
// emits them as computed, and native admits only what Chrome draws unchanged (analysis/fx.ts): blur() over a backdrop of one
// opaque colour, and multiply or darken over opaque white, with only opaque pixels inside the box and nothing else painting. The
// Chrome cases are fx-backdrop-canvas, fx-backdrop-white, fx-blend-white and fx-initial (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms, WEB_CSS_PATH } from '../src/internal.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE, UNADMITTED } from '../src/css/animation-kinds/kinds.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import { computedFilterText, filterFunctionNames } from '../src/css/properties/fx.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { div, expectCatalogued, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/fx.css', revision: 'r1', hash: 'sha256:0' };

function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.some((d) => d.code === 'DRAGON_CSS_INVALID_VALUE')) return ['dropped'];
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

const project = (targets: object) => createProjectWith({ projectId: 'test', targets } as never, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });
const ALL = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
const compile = (css: string, body: (r: SourceRef) => TreeNode[] = probe) => project(ALL).compile(inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, body));
const errors = (c: ReturnType<typeof compile>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');
const refusedOn = (c: ReturnType<typeof compile>): string[] => [...new Set(errors(c).map((d) => `${d.target} ${d.code}`))].sort();
const NATIVE = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE'];

/** The coverage probe: p holding u holding two c boxes of text. */
const probe = (r: SourceRef): TreeNode[] => [div(r, 'p', ['p'], [div(r, 'u', ['u'], [div(r, 'c1', ['c', 'c1'], [text(r, 't1', 'Hi')]), div(r, 'c2', ['c'], [text(r, 't2', 'Hi')])])])];
/** The probe's boxes with no text. */
const boxes = (r: SourceRef): TreeNode[] => [div(r, 'p', ['p'], [div(r, 'u', ['u'], [div(r, 'c1', ['c', 'c1']), div(r, 'c2', ['c'])])])];
const BOXES = '.c { height: 10px; }';
/** A card: an opaque box with a bordered child, alone on the page. */
const card = (r: SourceRef): TreeNode[] => [div(r, 'x', ['x'], [div(r, 'k', ['k'])])];
/** The card with text in it. */
const textCard = (r: SourceRef): TreeNode[] => [div(r, 'x', ['x'], [text(r, 'tx', 'XX'), div(r, 'k', ['k'])])];
const CARD = '.x { width: 80px; padding: 4px; background-color: #fff; color: #123; } .k { height: 6px; background-color: rgb(250, 200, 40); border: 2px solid rgb(10, 20, 30); }';

describe('FX-0: backdrop-filter and mix-blend-mode', () => {
  it('follow color-scheme, last in the registry; a backdrop-filter list is not admitted to animate and mix-blend-mode is discrete', () => {
    expect(LONGHANDS.slice(LONGHANDS.indexOf('color-scheme') + 1)).toEqual(['break-before', 'break-after', 'break-inside', 'orphans', 'widows', 'backdrop-filter', 'mix-blend-mode']);
    expect(ANIMATION_KINDS['backdrop-filter']).toBe(UNADMITTED);
    expect(ANIMATION_KINDS['mix-blend-mode']).toBe(DISCRETE);
  });

  it('parses none or a filter function list and every Chrome 145 blend keyword, and drops what Chrome drops', () => {
    expect(parsed('backdrop-filter: NONE')).toEqual(['backdrop-filter: none']);
    expect(parsed('backdrop-filter: blur(10px)')).toEqual(['backdrop-filter: blur(10px)']);
    expect(parsed('backdrop-filter: blur(2px) sepia(50%)')).toEqual(['backdrop-filter: blur(2px) sepia(50%)']);
    for (const d of ['backdrop-filter: blur(-1px)', 'backdrop-filter: none blur(1px)', 'backdrop-filter: blur(1px), blur(2px)', 'backdrop-filter: drop-shadow(1px 1px 1px 1px)', 'mix-blend-mode: plus-darker', 'mix-blend-mode: none']) expect(parsed(d), d).toEqual(['dropped']);
    for (const k of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter']) {
      expect(parsed(`mix-blend-mode: ${k.toUpperCase()}`)).toEqual([`mix-blend-mode: ${k}`]);
    }
    expect(filterFunctionNames('BLUR(1px) url(#a) sepia()')).toEqual(['blur', 'url', 'sepia']);
    expect(computedFilterText('blur(2em) drop-shadow(1rem 0 calc(1em + 1px))', 10, 16)).toBe('blur(20px) drop-shadow(16px 0 calc(10px + 1px))');
    expect(computedFilterText('blur(2em)', null, 16)).toBe('blur(2em)');
  });

  it('is emitted on web as computed, with em lengths in px (an inherited list keeps its parent\'s px), and only where set', () => {
    const c = project({ web: {} }).compile(inputFor('body { margin: 0; font-size: 10px; } .p { backdrop-filter: blur(2em) sepia(1); } .u { backdrop-filter: inherit; font-size: 20px; } .c1 { mix-blend-mode: screen; }', probe));
    expect(errors(c)).toEqual([]);
    const out = c.outputs.web;
    if (out.kind !== 'ready') throw new Error('web output blocked');
    const css = (out.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text;
    expect(css.match(/ {2}backdrop-filter: blur\(20px\) sepia\(1\);\n {2}mix-blend-mode: normal;\n/g)?.length).toBe(2);
    expect(css.match(/ {2}backdrop-filter: none;\n {2}mix-blend-mode: screen;\n/g)?.length).toBe(1);
    // Elements at both initial values write neither (html, body and c2).
    expect(css.match(/backdrop-filter/g)?.length).toBe(3);
  });

  it('admits blur() over the white canvas or a uniform body colour on a card whose pixels are all opaque, and the initial values anywhere', () => {
    for (const bf of ['blur(10px)', 'blur()', 'blur(0) blur(30px)', 'BLUR(1em)', 'var(--b)']) {
      expect(errors(compile(`:root { --b: blur(4px); } ${CARD} .x { backdrop-filter: ${bf}; }`, card)).map((d) => d.message), bf).toEqual([]);
      expect(errors(compile(`body { background-color: rgb(30, 90, 200); } ${CARD} .x { backdrop-filter: ${bf}; }`, card)).map((d) => d.message), bf).toEqual([]);
    }
    // An ancestor background of the canvas colour, and a relative box.
    expect(errors(compile(`${BOXES} body { background-color: #3366cc; } .p { background-color: #3366cc; } .c { background-color: #fff; } .u { backdrop-filter: blur(10px); position: relative; }`, boxes))).toEqual([]);
    // The probe's boxes with opaque fills and no text, the declaration on p or u.
    for (const on of ['p', 'u']) expect(errors(compile(`${BOXES} .c { background-color: #fff; } .${on} { backdrop-filter: blur(10px); }`, boxes)).map((d) => d.message), on).toEqual([]);
    for (const d of ['backdrop-filter: none', 'mix-blend-mode: normal', 'backdrop-filter: initial', 'mix-blend-mode: NORMAL']) expect(errors(compile(`.c { ${d}; } .p { border: 1px solid red; }`)), d).toEqual([]);
  });

  it('admits multiply and darken over opaque white on a card whose pixels are all opaque', () => {
    for (const m of ['multiply', 'darken', 'DARKEN']) {
      expect(errors(compile(`${CARD} .x { mix-blend-mode: ${m}; }`, card)).map((d) => d.message), m).toEqual([]);
      expect(errors(compile(`html { background-color: white; } ${CARD} .x { mix-blend-mode: ${m}; }`, card)).map((d) => d.message), m).toEqual([]);
    }
  });

  // Review of #514 at a1f0e402: glyph edges round one off where a line leaves its opaque fill, which this pass cannot see, so no text
  // is admitted inside the box, over a fill or not.
  it('refuses text inside the box on native: Chrome composites its glyph edges one off wherever a line is not over an opaque fill', () => {
    for (const on of ['p', 'u', 'c1']) {
      for (const d of ['backdrop-filter: blur(10px)', 'mix-blend-mode: multiply']) {
        const c = compile(`.c { background-color: #fff; } .${on} { ${d}; }`);
        expect(refusedOn(c), `${on} ${d}`).toEqual(NATIVE);
        expect(errors(c)[0]?.message).toMatch(/\(package FX\).*holds text/);
        expectCatalogued(errors(c));
      }
    }
  });

  it('refuses on native every value and case where Chrome would change a pixel, naming the reason', () => {
    const cases: readonly [string, RegExp, ((r: SourceRef) => TreeNode[])?][] = [
      [`${CARD} .x { backdrop-filter: blur(4px) sepia(1); }`, /holds sepia/, card],
      [`${CARD} .x { backdrop-filter: url(#f); }`, /holds url/, card],
      [`${CARD} .x { backdrop-filter: brightness(1); }`, /holds brightness/, card],
      [`${CARD} .x { mix-blend-mode: screen; }`, /screen changes the colour/, card],
      [`${CARD} .x { mix-blend-mode: plus-lighter; }`, /plus-lighter changes/, card],
      [`body { background-color: #ff0; } ${CARD} .x { mix-blend-mode: multiply; }`, /not opaque white/, card],
      [`body { background-color: rgba(0, 0, 0, 0.5); } ${CARD} .x { backdrop-filter: blur(4px); }`, /canvas colour is translucent/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); mix-blend-mode: multiply; }`, /both a backdrop-filter and a mix-blend-mode/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); background-color: rgba(255, 255, 255, 0.5); }`, /translucent background/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); border-radius: 4px; }`, /border radius/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); } .k { border-style: dashed; }`, /dashed border/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); } .k { border-left-color: red; }`, /more than one colour/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); }`, /<div> x holds text/, textCard],
      [`${CARD} .x { mix-blend-mode: darken; white-space: nowrap; }`, /<div> x holds text/, textCard],
      // Review of #514 at a1f0e402: an animation or transition anywhere repaints the box or its backdrop while it runs.
      [`@keyframes k { to { background-color: rgb(200, 0, 0); } } body { animation: k 1s infinite; } ${CARD} .x { mix-blend-mode: multiply; }`, /has an animation or transition/, card],
      [`@keyframes k { to { background-color: rgba(200, 0, 0, 0.5); } } ${CARD} .x { backdrop-filter: blur(6px); animation: k 1s; }`, /x has an animation or transition/, card],
      [`${CARD} .x { backdrop-filter: blur(6px); } .k { transition: background-color 0.2s; }`, /k has an animation or transition/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); box-shadow: 0 0 2px red; }`, /box-shadow/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); } .k { opacity: 0; }`, /opacity 0/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); } .k { position: relative; }`, /position relative/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); } .k { mix-blend-mode: darken; }`, /of its own/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); overflow: hidden; }`, /overflow-x: hidden/, card],
      // Review of #514 at 6bc79528: the individual transforms move the box or a member as transform does.
      [`${CARD} .x { mix-blend-mode: multiply; rotate: 30deg; }`, /x has rotate/, card],
      [`${CARD} .x { backdrop-filter: blur(4px); } .k { translate: 0.5px 0.3px; }`, /k has translate/, card],
      [`${CARD} .x { mix-blend-mode: multiply; scale: 2; }`, /x has scale/, card],
      // The backdrop: an earlier or later box painting, an ancestor's own colour or layer.
      ['.c { background-color: #fff; } .c1 { backdrop-filter: blur(4px); }', /<div> c2 paints text outside it/, (r: SourceRef) => [div(r, 'p', ['p'], [div(r, 'u', ['u'], [div(r, 'c1', ['c', 'c1']), div(r, 'c2', ['c'], [text(r, 't2', 'Hi')])])])]],
      [`${BOXES} .c { background-color: #fff; } .u { backdrop-filter: blur(4px); } .p { border-top: 1px solid red; }`, /<div> p paints a border outside it/, boxes],
      [`${BOXES} .c { background-color: #fff; } .u { backdrop-filter: blur(4px); } .p { background-color: #eee; }`, /<div> p paints a background other than the canvas colour/, boxes],
      [`${BOXES} .c { background-color: #fff; } .u { mix-blend-mode: multiply; } .p { opacity: 0.5; }`, /inside <div> p, which has opacity 0.5/, boxes],
      [`${BOXES} .c { background-color: #fff; } .u { mix-blend-mode: multiply; } .p { position: relative; }`, /inside <div> p, which is positioned/, boxes],
      [`${BOXES} .c { background-color: #fff; } .u { mix-blend-mode: multiply; } .p { isolation: isolate; }`, /inside <div> p, a stacking context/, boxes],
      [`${BOXES} .c { background-color: #fff; } .u { mix-blend-mode: multiply; } .p { overflow: hidden; }`, /clips or scrolls/, boxes],
      [`${BOXES} .c { background-color: #fff; } .u { mix-blend-mode: multiply; } .p { text-decoration: underline; }`, /text decoration reaches its text/, boxes],
      [`${BOXES} .c { background-color: #fff; display: inline; } .u { mix-blend-mode: multiply; }`, /display inline/, boxes],
    ];
    for (const [css, why, body] of cases) {
      const c = compile(css, body);
      expect(refusedOn(c), css).toEqual(NATIVE);
      expect(errors(c).filter((d) => d.message.includes('(package FX)')).map((d) => d.message)[0], css).toMatch(why);
      expectCatalogued(errors(c));
    }
  });

  it('makes a stacking context in the z-index 0 layer; a backdrop-filter is also a containing block, a mix-blend-mode is not', () => {
    const body = (r: SourceRef): TreeNode[] => [div(r, 'a', ['s'], [div(r, 'b', ['c'])]), div(r, 'z', ['z'])];
    for (const d of ['backdrop-filter: blur(1px)', 'mix-blend-mode: darken']) {
      const c = compile(`.s { ${d}; height: 20px; } .c { height: 5px; } .z { height: 10px; margin-top: -15px; }`, body);
      expect(errors(c)).toEqual([]);
      const p = nativePrograms(c, []);
      if (p.kind !== 'ready') throw new Error(p.reason);
      for (const program of [p.programs.uikit, p.programs['android-views']]) {
        const facts = (id: string) => program.nodes.find((n) => n.id === id)?.facts['stacking'] as { createsContext: boolean; layer: string; context: string | null; paintOrder: number };
        expect(facts('a'), d).toMatchObject({ createsContext: true, layer: 'positioned' });
        expect(facts('b'), d).toMatchObject({ context: 'a', layer: 'flow' });
        expect(facts('a').paintOrder, d).toBeGreaterThan(facts('z').paintOrder);
      }
    }
    // A static backdrop-filter box would be the containing block of an absolute child, which Dragon's layout does not model: refused everywhere.
    const cb = compile('.s { backdrop-filter: blur(1px); } .c { position: absolute; top: 0; }', body);
    expect(refusedOn(cb)).toEqual(['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE']);
    expect(errors(cb).filter((d) => d.target === 'web').map((d) => d.message)).toEqual([expect.stringMatching(/^a backdrop-filter on a makes it the containing block of the absolutely positioned b/)]);
    expect(refusedOn(compile('.s { position: relative; backdrop-filter: blur(1px); } .c { position: absolute; top: 0; }', body))).toEqual(NATIVE);
    // mix-blend-mode makes no containing block: on web the absolute child stays on the initial one.
    expect(errors(project({ web: {} }).compile(inputFor('.s { mix-blend-mode: multiply; } .c { position: absolute; top: 0; }', body)))).toEqual([]);
  });
});
