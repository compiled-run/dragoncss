// FORM-b: single-line text fields (text, email, url, tel and an unknown type) compile as Chrome 145's UA shadow tree, an inner
// editor holding the value and a placeholder while the value is empty, laid out by the engine (controls.ts) and written for the
// web with ::placeholder. Refused: a themed field, a password field, an inline-level one, and on iOS and Android an editable one
// unless the host edits text fields (compileNativeStyles textEditing: 'host', as the Markless export compiles).
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic, NativeStylesConfig } from 'dragon';
import * as dragon from 'dragon';
import { ahemMeasurer, layout as engineLayout, NO_ENGINE_FAULTS } from '@dragon/layout';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { captureFixture } from '../src/capture.ts';
import { atDpr, DPRS, layoutCases, runDprCase, zoomGuard } from '../src/dpr.ts';
import { marklessFrontEnd, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { fixtureToInput, PROJECT_ID } from '../src/fixture-reader.ts';
import { withFontMapAssets } from '../src/fixture-groups/fonts.ts';
import { FONT_REFERENCE_MAP } from '../src/font-reference.ts';
import { ENVIRONMENT, FIXTURES } from '../src/fixtures.ts';
import { compileFixture, liveAuthored, runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';
import { referenceShapedMeasurer } from '../src/text-shaper-host.ts';

const page = (css: string, body: string, base: string): string => `<!DOCTYPE html>
<html data-dragon-id="html">
<head>
<style>
body { margin: 0; font-family: Ahem; font-size: 10px; }
${base}
${css}
</style>
</head>
<body data-dragon-id="body">
${body}
</body>
</html>
`;

/** Every field here devolves to CSS by its author border, except where a test passes its own base rule. */
const BASE = 'input { display: block; font: inherit; appearance: none; margin: 0; border: 2px solid #036; padding: 1px 2px; }';

function compile(id: string, css: string, body: string, base = BASE, fonts = false, hostTextEditing = false): Compiled<'ios' | 'android' | 'web'> {
  const project = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }, ...(fonts ? { fonts: FONT_REFERENCE_MAP } : {}) }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem', ...(hostTextEditing ? { hostTextEditing } : {}) });
  const input = fixtureToInput(id, page(css, body, base));
  return project.compile(fonts ? withFontMapAssets(input, FONT_REFERENCE_MAP) : input);
}

const errors = (c: Compiled<string>): string[] => c.diagnostics.filter((d: Diagnostic) => d.severity === 'error').map((d) => `${d.target ?? 'all'} ${d.code} ${d.message}`);

/** The engine's border boxes of a compile's first case, in CSS px relative to the parent box, by id. */
function boxes(c: Compiled<string>): Map<string, { x: number; y: number; width: number; height: number }> {
  const p = dragon.engineLayoutProjection(c, ENVIRONMENT, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const r = engineLayout(p.input, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return new Map(r.boxes.map((b) => [b.id, { x: b.x / 64, y: b.y / 64, width: b.width / 64, height: b.height / 64 }]));
}

describe('FORM-b text fields', () => {
  it('lays out a readonly field on every target: size x the advance of 0 wide, as tall as its editor', () => {
    const c = compile('tf-basic', '', '<input data-dragon-id="t" readonly="" size="3" value="XX">');
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    expect(b.get('t')).toMatchObject({ width: 38, height: 16 });
    expect(b.get('t::editor')).toMatchObject({ width: 30, height: 10 });
    expect([...b.keys()].filter((k) => k.startsWith('t::'))).toEqual(['t::editor', 't::editor:text0', 't::editor:text0:line0'].filter((k) => b.has(k)));
  });

  it('sizes a field by its average character width, which Chrome rounds up from a half (max(avg, roundf(avg)))', () => {
    // Ahem's average character width is 1em; at 10.5px Chrome takes 11px a character, so size 20 is 220px, not 210px.
    const c = compile('tf-avg-width', '.h { font-size: 10.5px; } .l { font-size: 10.25px; }', '<input data-dragon-id="h" readonly="" class="h" value="XX">\n<input data-dragon-id="l" readonly="" class="l" size="4" value="XX">');
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    expect(b.get('h::editor')?.width).toBe(220);
    expect(b.get('h')?.width).toBe(228);
    expect(b.get('l::editor')?.width).toBe(41);
  });

  it('refuses a float before a block field, which Chrome moves beside the float as a new formatting context', () => {
    // The engine moves no in-flow box around a float, so the compiler refuses what follows one on every target (FLT).
    const c = compile('tf-float-beside', '.fl { float: left; width: 100px; height: 40px; }', '<div data-dragon-id="w"><div data-dragon-id="fl" class="fl"></div><input data-dragon-id="t" readonly="" value="XX"></div>');
    expect(errors(c)).toEqual(['android', 'ios', 'web'].map((t) => expect.stringMatching(new RegExp(`^${t} DRAGON_UNSUPPORTED_VALUE float: left on fl is followed in its formatting context by t, which is in flow`))));
  });

  it('centres the editor unsafely in a fixed height and gives it line-height normal when the height exceeds the line height', () => {
    const b = boxes(compile('tf-centre', '.a { height: 41px; line-height: 30px; } .b { height: 4px; } .c { line-height: 30px; } .d { line-height: 4px; }', ['a', 'b', 'c', 'd'].map((k) => `<input data-dragon-id="${k}" readonly="" class="${k}" value="XX">`).join('\n')));
    expect(['a', 'b', 'c', 'd'].map((k) => b.get(`${k}::editor`)?.y)).toEqual([18.5, 0, 3, 3]);
    expect(['a', 'b', 'c', 'd'].map((k) => b.get(`${k}::editor`)?.height)).toEqual([10, 10, 30, 10]);
  });

  it('shows the placeholder only while the value is empty, its baseline on the editor', () => {
    const c = compile('tf-placeholder', '.p::placeholder { color: #c00; font-size: 4px; } .q { line-height: 30px; }', '<input data-dragon-id="p" readonly="" class="p" placeholder="PP">\n<input data-dragon-id="q" readonly="" class="q" placeholder="PP">\n<input data-dragon-id="v" readonly="" placeholder="PP" value="X">');
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    expect(b.get('p::placeholder')?.y).toBe(8);
    expect(b.get('q::placeholder')?.y).toBe(13);
    expect(b.has('v::placeholder')).toBe(false);
    // A value hides the placeholder, but the web output still styles it for when the user clears the field.
    const valued = compile('tf-placeholder-valued', '.p::placeholder { color: #c00; }', '<input data-dragon-id="p" class="p" value="QQ" placeholder="ZZ">');
    const css = valued.outputs.web.kind === 'ready' ? valued.outputs.web.files.map((f) => f.text).join('\n') : '';
    expect(css).toMatch(/::placeholder \{[^}]*color: rgb\(204, 0, 0\)/);
    const web = c.outputs.web.kind === 'ready' ? c.outputs.web.files.map((f) => f.text).join('\n') : '';
    expect(web).toMatch(/::placeholder \{[^}]*color: rgb\(204, 0, 0\)/);
  });

  it('refuses an editable field on iOS and Android only, and a themed, password or inline-flex field everywhere', () => {
    expect(errors(compile('tf-edit', '', '<input data-dragon-id="t" value="XX">'))).toEqual([
      expect.stringMatching(/^android DRAGON_UNSUPPORTED_VALUE <input> t is an editable text control: Dragon draws its value but has no caret/),
      expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE <input> t is an editable text control/),
    ]);
    expect(errors(compile('tf-theme', '', '<input data-dragon-id="t" readonly="">', 'input { display: block; font: inherit; margin: 0; }'))).toContainEqual(expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE <input> t with appearance: auto and no author background or border/));
    expect(errors(compile('tf-password', '', '<input data-dragon-id="t" readonly="" type="password" value="XX">'))).toEqual([expect.stringMatching(/^all DRAGON_UNSUPPORTED_ELEMENT <input type=password> t is not supported/)]);
    expect(errors(compile('tf-inline', 'input { display: inline-flex; }', '<div data-dragon-id="d"><input data-dragon-id="t" readonly=""></div>'))).toContainEqual(expect.stringMatching(/display: inline-flex on <input> t is not supported on a text field: an inline-level field is laid out only as inline-block/));
    expect(errors(compile('tf-float', 'input { float: left; }', '<input data-dragon-id="t" readonly="">'))).toContainEqual(expect.stringMatching(/float: left on <input> t is not supported on a text control/));
    // A textarea in a face Dragon does not measure takes #665's width guard, as an input does: its cols width is read only without one.
    expect(errors(compile('tf-textarea-font', 'textarea { font-family: Lato; }', '<textarea data-dragon-id="a" readonly=""></textarea>', BASE, true)).filter((e) => e.includes('average character width'))).toHaveLength(2);
    expect(errors(compile('tf-textarea-font-width', 'textarea { font-family: Lato; width: 40px; }', '<textarea data-dragon-id="a" readonly=""></textarea>', BASE, true)).filter((e) => e.includes('average character width'))).toEqual([]);
  });

  it("lifts the font refusal only where a field's width cannot read its face's average character width (FORM-text-font)", () => {
    // Chrome 145: a length width, or a percentage width in boxes whose widths do not depend on content, is the same size in Roboto,
    // Inter and Ahem; a percentage width in a float, an inline-block, a max-content box, an auto-width absolute box or a two-column
    // grid is 197, 217 and 350px.
    const font = (id: string, css: string, body: string): string[] => errors(compile(id, `input { font-family: Lato; } ${css}`, body, BASE, true)).filter((e) => e.includes('average character width'));
    const field = '<input data-dragon-id="t" readonly="" class="f">';
    expect(font('tf-font-length', '.f { width: 40px; }', field)).toEqual([]);
    // #665's guard accepts a grid item only with min-width set (its automatic minimum would read the intrinsic width).
    expect(font('tf-font-percent', '.f { width: 100%; min-width: 0; } .g { display: grid; }', `<div data-dragon-id="g" class="g">${field}</div>`)).toEqual([]);
    const cyclic: readonly [string, string, RegExp][] = [
      ['tf-font-float', '.w { float: left; }', /<div> d takes its width from its content \(float: left with an auto width\)/],
      ['tf-font-ib', '.w { display: inline-block; }', /<div> d takes its width from its content \(display: inline-block with an auto width\)/],
      ['tf-font-maxc', '.w { width: max-content; }', /<div> d takes its width from its content \(width: max-content\)/],
      ['tf-font-abs', '.w { position: absolute; }', /<div> d takes its width from its content \(position: absolute with an auto width\)/],
      ['tf-font-grid2', '.w { display: grid; grid-template-columns: auto auto; }', /<input> t is a grid item with min-width: auto, whose automatic minimum Chrome takes from the field's intrinsic width/],
      ['tf-font-flex', '.w { display: flex; }', /<input> t is a flex item with min-width: auto, whose automatic minimum Chrome takes from the field's intrinsic width/],
    ];
    for (const [id, css, why] of cyclic) expect(font(id, `.f { width: 100%; } ${css}`, `<div data-dragon-id="d" class="w">${field}</div>`), id).toContainEqual(expect.stringMatching(why));
    expect(font('tf-font-minc', '.f { width: 100%; min-width: min-content; }', field)).toContainEqual(expect.stringMatching(/min-width: min-content on <input> t is not supported here/));
  });

  it('lays out a search field with its cancel button at the end of the editor\'s line, as Chrome 145 does', () => {
    // The button's side is lroundf(clamp(9 x font size / 13, 5, 21)) between a 1px and a 3px margin; the field is border-box.
    const css = '.h41 { height: 41px; } .f4 { font-size: 4px; } .h20 { height: 20px; } .f16 { font-size: 16px; } .w50 { width: 50px; text-align: right; }';
    const c = compile('tf-search', css, [
      '<input data-dragon-id="a" readonly="" type="search" placeholder="PP">',
      '<input data-dragon-id="b" readonly="" type="search" class="h41" placeholder="PP">',
      '<input data-dragon-id="c" readonly="" type="search" class="f4" value="X">',
      '<input data-dragon-id="d" readonly="" type="search" class="f4 h20" placeholder="P">',
      '<input data-dragon-id="e" readonly="" type="search" size="3" value="X">',
      '<input data-dragon-id="f" readonly="" type="search" class="f16" value="X">',
      '<input data-dragon-id="g" readonly="" type="search" class="w50" value="XX XX">',
    ].join('\n'));
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    const at = (id: string): number[] => { const r = b.get(id); return r === undefined ? [] : [r.x, r.y, r.width, r.height]; };
    expect(at('a')).toEqual([0, 0, 208, 16]);
    expect([at('a::placeholder'), at('a::editor')]).toEqual([[4, 3, 189, 10], [4, 3, 189, 10]]);
    // border-box: a 41px field has a 35px content box, the editor centred in it.
    expect([at('b')[3], at('b::editor')[1], at('b::placeholder')[1]]).toEqual([41, 15.5, 15.5]);
    // A 5px button beside a 4px editor: the 5px container is centred in the 4px content box and the editor in the container.
    expect([at('c'), at('c::editor')]).toEqual([[0, 57, 88, 10], [4, 3, 71, 4]]);
    expect([at('d::editor'), at('d::placeholder')]).toEqual([[4, 8, 71, 4], [4, 8, 71, 4]]);
    expect([at('e')[2], at('e::editor')[2], at('f')[2], at('f::editor')[2], at('g::editor')[2]]).toEqual([38, 19, 328, 305, 31]);
  });

  it('refuses a right-to-left search field on iOS and Android, where the engine puts the cancel button only at the right', () => {
    expect(errors(compile('tf-search-rtl', 'input { direction: rtl; }', '<input data-dragon-id="t" readonly="" type="search" value="XX">')).filter((e) => e.includes('type=search'))).toEqual([
      expect.stringMatching(/^android DRAGON_UNSUPPORTED_VALUE direction: rtl on <input type=search> t is not supported/),
      expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE direction: rtl on <input type=search> t is not supported/),
    ]);
  });

  it('lays out an editable field when the host edits text fields, and a compile without that still refuses it', () => {
    const body = '<input data-dragon-id="t" type="search" placeholder="PP">\n<input data-dragon-id="v" value="XX">';
    expect(errors(compile('tf-host-edits', '', body, BASE, false, true))).toEqual([]);
    expect(errors(compile('tf-not-host', '', body)).filter((e) => e.includes('is an editable text control'))).toHaveLength(4);
    const b = boxes(compile('tf-host-edits', '', body, BASE, false, true));
    expect([b.get('t::placeholder')?.width, b.get('t::editor')?.width, b.get('v::editor')?.width]).toEqual([189, 189, 200]);
    // The cancel button box the host draws its clear control in: 7px at a 10px font, 1px after the editor, centred on its 10px line.
    expect([b.get('t::cancel'), b.get('v::cancel')]).toEqual([{ x: 4 + 189 + 1, y: 3 + 1.5, width: 7, height: 7 }, undefined]);
  });

  it('still refuses a textarea when the host edits single-line fields', () => {
    const refused = errors(compile('tf-host-textarea', '', '<textarea data-dragon-id="a">XX</textarea>', BASE, false, true)).filter((e) => e.includes('is an editable text control'));
    expect(refused).toEqual([expect.stringMatching(/^android DRAGON_UNSUPPORTED_VALUE <textarea> a is an editable text control/), expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE <textarea> a is an editable text control/)]);
  });

  it('accepts an editable search field in a Markless compile (textEditing: host) and refuses it in a plain native compile', () => {
    const text = JSON.stringify({
      version: 'markless.native-style-input/0',
      component: 'Search',
      nodes: [
        { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} },
        { kind: 'element', id: 'h1', element: 'input', parent: 'h0', attributes: { class: 'search', type: 'search', placeholder: 'Search notes' } },
      ],
      css: 'main { font-family: Ahem; font-size: 16px; } .search { display: block; font: inherit; width: 100%; padding: 12px 16px; border: 1px solid #ccc; border-radius: 999px; }',
      states: [],
    });
    const parsed = parseMarklessStyleInput(text);
    const input = withFontMapAssets(marklessFrontEnd(parsed, text, 'search.native-style-input.json'), FONT_REFERENCE_MAP);
    const config: NativeStylesConfig = { projectId: PROJECT_ID, name: 'Search', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } }, fonts: FONT_REFERENCE_MAP, viewport: { width: 402, height: 874 }, support: 'lanes', output: 'program' };
    const refusals = (c: NativeStylesConfig): string[] => dragon.compileNativeStyles(c, input).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.target ?? 'all'} ${d.message}`);
    expect(refusals({ ...config, textEditing: 'host' })).toEqual([]);
    expect(refusals(config)).toEqual([expect.stringMatching(/^android <input> h1 is an editable text control/), expect.stringMatching(/^ios <input> h1 is an editable text control/)]);
    expect(() => dragon.compileNativeStyles({ ...config, textEditing: 'device' as 'host' }, input)).toThrow("textEditing \"device\" is not 'host'");
  });
});

describe('FIELD-font-width FW1: a field outside Ahem is accepted natively only where its width never reads its intrinsic width', () => {
  const avg = (c: Compiled<string>): string[] => errors(c).filter((e) => e.includes('average character width'));
  const lato = (id: string, css: string, body: string, faults = dragon.NO_FAULTS, direction: 'ltr' | 'rtl' = 'ltr'): Compiled<'ios' | 'android' | 'web'> => {
    const project = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }, fonts: FONT_REFERENCE_MAP }, { faults, profiles: 'derive', direction, rootFont: 'ahem' });
    return project.compile(withFontMapAssets(fixtureToInput(id, page(`input { font-family: Lato; } ${css}`, body, BASE)), FONT_REFERENCE_MAP));
  };
  const field = '<input data-dragon-id="t" readonly="" value="Hello">';
  const inRow = (css: string): readonly [string, string] => [`.r { display: flex; width: 200px; } ${css}`, `<div data-dragon-id="r" class="r">${field}</div>`];
  const inBox = (box: string, css: string): readonly [string, string] => [`.wrap { ${box.startsWith('position') ? 'position: relative; height: 60px; ' : ''}width: 300px; } .w { ${box} } ${css}`, `<div data-dragon-id="wrap" class="wrap"><div data-dragon-id="w" class="w">${field}</div></div>`];

  const inColumn = `<div data-dragon-id="c" class="c"><div data-dragon-id="i" class="i">${field}</div></div>`;
  const ACCEPTED: readonly (readonly [string, string, string])[] = [
    ['fw-px', 'input { width: 40px; }', field],
    ['fw-pct', 'input { width: 100%; max-width: 50px; min-width: 10%; }', field],
    ['fw-calc', 'input { width: calc(50% + 10px); }', field],
    ['fw-float-cap', ...inBox('float: left;', 'input { width: 120px; max-width: 100%; }')],
    ['fw-ib-cap', ...inBox('display: inline-block;', 'input { width: 120px; max-width: 100%; }')],
    ['fw-float-least', ...inBox('float: left;', 'input { width: 120px; min-width: 50%; }')],
    ['fw-row-basis', ...inRow('input { flex: 1 1 0; min-width: 0; }')],
    ['fw-row-basis-px', ...inRow('input { flex: 0 0 80px; min-width: 10px; max-width: 50%; }')],
    ['fw-row-fill', ...inRow('input { width: 100%; min-width: 0; }')],
    ['fw-col', '.c { display: flex; flex-direction: column; } input { width: 100%; min-width: 0; }', `<div data-dragon-id="c" class="c">${field}</div>`],
    // FORM-text-font column flex (Chrome 145: 412px, or 372px for the notes shape, in Roboto, Inter and Ahem alike).
    ['fw-col-min-auto', '.c { display: flex; flex-direction: column; } input { width: 100%; }', `<div data-dragon-id="c" class="c">${field}</div>`],
    ['fw-col-center-pct', '.c { display: flex; flex-direction: column; align-items: center; } input { width: 100%; }', `<div data-dragon-id="c" class="c">${field}</div>`],
    ['fw-col-reverse-item', '.c { display: flex; flex-direction: column-reverse; } input { width: 100%; }', inColumn],
    ['fw-col-self-stretch', '.c { display: flex; flex-direction: column; align-items: center; } .i { align-self: stretch; } input { width: 100%; }', inColumn],
    ['fw-col-notes', '.c { min-height: 100vh; display: flex; flex-direction: column; } .i { width: 100%; max-width: 880px; margin: 0 auto; padding: 20px; } input { width: 100%; }', inColumn],
  ];
  for (const [id, css, body] of ACCEPTED) {
    it(`accepts ${id} on every target, and the engine lays out its iOS projection`, () => {
      const c = lato(id, css, body);
      expect(errors(c)).toEqual([]);
      const p = dragon.iosLayoutProjection(c, ENVIRONMENT, []);
      if (p.kind !== 'ready') throw new Error(p.reason);
      expect(engineLayout(p.input, referenceShapedMeasurer()).kind).toBe('ok');
    });
  }

  // Each refused shape, refused by name on iOS and Android only, would read the intrinsic width: with fieldWidthAnyContext the engine throws.
  const REFUSED: readonly (readonly [string, string, string, string, string?])[] = [
    ['fw-auto', '', field, 'width: auto on <input> t is not supported here'],
    ['fw-margin-auto', 'input { margin: 0 auto; }', field, 'width: auto on <input> t is not supported here'],
    ['fw-fit', 'input { width: fit-content; }', field, 'width: fit-content on <input> t is not supported here'],
    ['fw-max-content', 'input { width: max-content; }', field, 'width: max-content on <input> t is not supported here'],
    ['fw-min-intrinsic', 'input { width: 40px; min-width: min-content; }', field, 'min-width: min-content on <input> t is not supported here'],
    ['fw-max-intrinsic', 'input { width: 40px; max-width: max-content; }', field, 'max-width: max-content on <input> t is not supported here'],
    ['fw-flex-min', ...inRow('.r { width: 100px; } input { flex: 1; width: 100%; }'), '<input> t is a flex item with min-width: auto'],
    ['fw-row-auto', ...inRow('input { min-width: 0; }'), 'width: auto on <input> t is not supported here'],
    // The engine refuses flex-basis: content itself, before it reads the field.
    ['fw-basis-content', ...inRow('input { flex-basis: content; width: 10px; min-width: 0; }'), 'flex-basis: content on <input> t is not supported', 'flex-basis-content'],
    ['fw-col-auto', '.c { display: flex; flex-direction: column; align-items: start; } input { min-width: 0; }', `<div data-dragon-id="c" class="c">${field}</div>`, 'width: auto on <input> t is not supported here'],
    ['fw-ib-pct', ...inBox('display: inline-block;', 'input { width: 100%; }'), 'width: 100% on <input> t is not supported here: <div> w takes its width from its content (display: inline-block with an auto width)'],
    ['fw-float-pct', ...inBox('float: left;', 'input { width: 100%; }'), 'width: 100% on <input> t is not supported here: <div> w takes its width from its content (float: left with an auto width)'],
    ['fw-abspos-pct', ...inBox('position: absolute; top: 0; left: 0;', 'input { width: 100%; }'), 'width: 100% on <input> t is not supported here: <div> w takes its width from its content (position: absolute with an auto width)'],
    ['fw-col-item-row', '.c { display: flex; } input { width: 100%; }', inColumn, 'width: 100% on <input> t is not supported here: <div> i takes its width from its content (a row flex item with min-width: auto)'],
    ['fw-col-item-wrap', '.c { display: flex; flex-direction: column; flex-wrap: wrap; } input { width: 100%; }', inColumn, 'width: 100% on <input> t is not supported here: <div> i takes its width from its content (a stretched column flex item in a flex-wrap: wrap container)'],
    ['fw-col-item-center', '.c { display: flex; flex-direction: column; align-items: center; } input { width: 100%; }', inColumn, 'width: 100% on <input> t is not supported here: <div> i takes its width from its content (a column flex item with align-items: center and an auto width)'],
    ['fw-col-item-margin', '.c { display: flex; flex-direction: column; } .i { margin-left: auto; } input { width: 100%; }', inColumn, 'width: 100% on <input> t is not supported here: <div> i takes its width from its content (a column flex item with margin-left: auto and an auto width)'],
    ['fw-col-item-logical-margin', '.c { display: flex; flex-direction: column; } .i { align-self: stretch; margin-inline-end: auto; } input { width: 100%; }', inColumn, 'width: 100% on <input> t is not supported here: <div> i takes its width from its content (a column flex item with margin-right: auto and an auto width)'],
    ['fw-col-item-self-start', '.c { display: flex; flex-direction: column; } .i { align-self: self-start; } input { width: 100%; }', inColumn, 'width: 100% on <input> t is not supported here: <div> i takes its width from its content (a column flex item with align-self: self-start and an auto width)'],
    ['fw-col-item-inline-start', '.c { display: flex; flex-direction: column; } .i { margin-inline-start: auto; } input { width: 100%; }', inColumn, 'width: 100% on <input> t is not supported here: <div> i takes its width from its content (a column flex item with margin-left: auto and an auto width)'],
    ['fw-col-inline-flex', '.c { display: inline-flex; flex-direction: column; } input { width: 100%; }', inColumn, 'width: 100% on <input> t is not supported here: <div> c takes its width from its content (display: inline-flex with an auto width)'],
  ];
  for (const [id, css, body, prefix, thrown = 'text-field-avg-char'] of REFUSED) {
    it(`refuses ${id} on iOS and Android only, and with fieldWidthAnyContext the engine throws ${thrown}`, () => {
      const c = lato(id, css, body);
      expect(avg(c).map((e) => e.slice(0, e.indexOf(' ', e.indexOf(' ') + 1)))).toEqual(['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT']);
      expect(c.diagnostics.find((d) => d.message.includes('average character width'))?.message.startsWith(prefix)).toBe(true);
      expect(errors(c).filter((e) => e.startsWith('web ') || e.startsWith('all '))).toEqual([]);
      const faulted = lato(id, css, body, { ...dragon.NO_FAULTS, fieldWidthAnyContext: true });
      expect(errors(faulted)).toEqual([]);
      const p = dragon.iosLayoutProjection(faulted, ENVIRONMENT, []);
      if (p.kind !== 'ready') throw new Error(p.reason);
      const r = engineLayout(p.input, referenceShapedMeasurer());
      expect(r.kind === 'unsupported' ? `${r.unsupported.code} at ${r.unsupported.nodeId}` : r.kind).toBe(`${thrown} at t`);
    });
  }

  // Refused by ruling, not because the engine reads the intrinsic width there, so no fault can make them throw.
  const RULED: readonly (readonly [string, string, string, string])[] = [
    ['fw-stretch', 'input { width: stretch; }', field, 'width: stretch on <input> t'],
    ['fw-row-pct-basis', ...inRow('input { flex: 1 1 50%; min-width: 0; }'), 'width: auto on <input> t'],
    ['fw-basis-pct-shrink', ...inBox('display: inline-flex;', 'input { flex: 0 0 50%; width: 10px; min-width: 0; }'), 'flex-basis: 50% on <input> t is not supported here: <div> w takes its width from its content (display: inline-flex with an auto width)'],
  ];
  for (const [id, css, body, prefix] of RULED) {
    it(`refuses ${id} on iOS and Android only (out of FW1's scope by ruling)`, () => {
      const c = lato(id, css, body);
      expect(avg(c).map((e) => e.slice(0, e.indexOf(' ', e.indexOf(' ') + 1)))).toEqual(['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT']);
      expect(c.diagnostics.find((d) => d.message.includes('average character width'))?.message.startsWith(prefix)).toBe(true);
      expect(errors(c).filter((e) => e.startsWith('web ') || e.startsWith('all '))).toEqual([]);
    });
  }

  it('reads the first listed family with its case: only Ahem first is measured', () => {
    const auto = (id: string, family: string): number => avg(compile(id, `input { font-family: ${family}; }`, field, BASE, true)).length;
    expect([auto('fw-ahem', 'Ahem'), auto('fw-ahem-list', 'Ahem, Lato'), auto('fw-ahem-quoted', '"Ahem", sans-serif')]).toEqual([0, 0, 0]);
    expect([auto('fw-ahem-lower', 'ahem'), auto('fw-lato-ahem', 'Lato, Ahem'), auto('fw-generic', 'sans-serif')]).toEqual([2, 2, 2]);
  });

  it('an rtl field in Lato is refused by its editor white space (DRAGON_UNSUPPORTED_BIDI), so the fixture is ltr only', () => {
    expect(errors(lato('fw-rtl', 'input { width: 100%; }', field, dragon.NO_FAULTS, 'rtl'))).toContainEqual(expect.stringMatching(/^all DRAGON_UNSUPPORTED_BIDI t::editor:text0 keeps its white space/));
  });

  it('accepts a set-width search field in Lato under the field-width guard, as controls-text-font matches Chrome at its ::cancel box in Roboto and Inter', () => {
    const search = lato('fw-search', 'input { width: 120px; }', '<input data-dragon-id="t" readonly="" type="search" value="Hello">');
    expect(errors(search)).toEqual([]);
    const p = dragon.iosLayoutProjection(search, ENVIRONMENT, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    expect(engineLayout(p.input, referenceShapedMeasurer()).kind).toBe('ok');
    expect(avg(lato('fw-search-auto', '', '<input data-dragon-id="t" readonly="" type="search" value="Hello">'))).toEqual([
      expect.stringMatching(/^android DRAGON_UNSUPPORTED_FONT width: auto on <input> t is not supported here/),
      expect.stringMatching(/^ios DRAGON_UNSUPPORTED_FONT width: auto on <input> t is not supported here/),
    ]);
  });
});

const ACCEPT = 'controls-text-field-font-definite';
const specOf = (id: string) => {
  const f = FIXTURES.find((x) => x.id === id);
  if (f === undefined) throw new Error(`no fixture ${id}`);
  return f;
};

describe('the FW1 fixtures against live Chrome', () => {
  let browser: Browser;
  beforeAll(async () => {
    requireReferencePlatform(hostPlatform());
    browser = await launchChrome();
    expect(browser.version()).toBe(CHROME_VERSION);
  });
  afterAll(async () => {
    await browser.close();
  });
  const live = () => ({ authored: liveAuthored(browser), faults: dragon.NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' as const });

  it(`${ACCEPT} passes chrome-dual and linux-dragon-layout`, async () => {
    const out = await runFixture(specOf(ACCEPT), browser, live());
    expect(out.reason).toBeNull();
    expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual([['ltr', 'pass', 'pass']]);
  }, 300_000);
});

describe(`${ACCEPT} equals live Chrome at every DPR`, () => {
  const cases = layoutCases().filter((f) => f.spec.id === ACCEPT).flatMap((f) => f.cases);
  const compiled = { ltr: compileFixture(specOf(ACCEPT), dragon.NO_FAULTS, 'derive', 'ltr').compiled };
  for (const dpr of DPRS) {
    it(`at DPR ${dpr}`, async () => {
      expect(cases.length).toBe(1);
      const b = await launchChrome(dpr);
      try {
        await zoomGuard(b, dpr);
        const failed: string[] = [];
        for (const c of cases) {
          const capture = await captureFixture(b, c.id, c.authoredHtml, atDpr(c.environment, dpr), [], c.authoredPrepare ?? undefined);
          expect(capture.devicePixelRatio).toBe(dpr);
          const o = runDprCase(c, compiled.ltr, dpr, capture, NO_ENGINE_FAULTS);
          if (o.status === 'fail') failed.push(`${o.id}@${o.dpr}: ${o.reason}`);
        }
        expect(failed).toEqual([]);
      } finally {
        await b.close();
      }
    }, 300_000);
  }
});

/** BASE without its display: the field keeps Chrome's UA display, inline-block. */
const INLINE = 'input { font: inherit; appearance: none; margin: 0; border: 2px solid #036; padding: 1px 2px; }';

describe('FORM-b inline-block text fields', () => {
  it('lays a field out on its line beside text, its editor line on the baseline', () => {
    const c = compile('tf-inline-line', '', '<div data-dragon-id="d">XX <input data-dragon-id="t" readonly="" size="3" value="X"> XX</div>', INLINE);
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    // The field's baseline is 2 + 1 + 8px down, 3px below the strut's 8px ascent, so the line is 16px tall and the text 3px down.
    expect([b.get('t'), b.get('d:text0')?.y, b.get('d')?.height]).toEqual([{ x: 30, y: 0, width: 38, height: 16 }, 3, 16]);
  });

  it('accepts the notes search field, which sets no display, in a Markless compile', () => {
    const text = JSON.stringify({
      version: 'markless.native-style-input/0',
      component: 'Search',
      nodes: [
        { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} },
        { kind: 'element', id: 'h1', element: 'h1', parent: 'h0', attributes: {} },
        { kind: 'text', id: 'h1:text0', parent: 'h1', text: 'All notes' },
        { kind: 'element', id: 'h2', element: 'input', parent: 'h0', attributes: { class: 'search', type: 'search', placeholder: 'Search notes' } },
        { kind: 'element', id: 'h3', element: 'ul', parent: 'h0', attributes: {} },
      ],
      css: '* { box-sizing: border-box; } main { font-family: Ahem; font-size: 16px; line-height: 1.45; padding: 20px; } h1 { margin: 0 0 16px; font-size: 28px; } input { font: inherit; } ul { margin: 0; padding: 0; } .search { width: 100%; margin-bottom: 18px; padding: 12px 16px; border: 1px solid #e4ddcf; border-radius: 999px; background: #fff; }',
      states: [],
    });
    const parsed = parseMarklessStyleInput(text);
    const input = withFontMapAssets(marklessFrontEnd(parsed, text, 'search.native-style-input.json'), FONT_REFERENCE_MAP);
    const config: NativeStylesConfig = { projectId: PROJECT_ID, name: 'Search', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } }, fonts: FONT_REFERENCE_MAP, viewport: { width: 402, height: 874 }, support: 'lanes', output: 'program', textEditing: 'host' };
    expect(dragon.compileNativeStyles(config, input).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.target ?? 'all'} ${d.message}`)).toEqual([]);
  });

  it('refuses a field off the baseline, in a right-to-left line or right to left itself, and display: inline', () => {
    const refusal = (id: string, css: string, body: string): string[] => errors(compile(id, css, body, INLINE)).filter((e) => e.includes('<input> t'));
    const field = '<input data-dragon-id="t" readonly="" value="X">';
    expect(refusal('tf-inline-va', 'input { vertical-align: middle; }', `<div data-dragon-id="d">X ${field}</div>`)).toEqual(['android', 'ios', 'web'].map((t) => expect.stringMatching(new RegExp(`^${t} DRAGON_UNSUPPORTED_VALUE vertical-align: middle on the inline-block <input> t is not supported`))));
    expect(refusal('tf-inline-rtl-line', '.r { direction: rtl; }', `<div data-dragon-id="d" class="r">X ${field}</div>`)).toEqual(['android', 'ios', 'web'].map((t) => expect.stringMatching(new RegExp(`^${t} DRAGON_UNSUPPORTED_VALUE the inline-block <input> t is on a right-to-left line of d`))));
    expect(refusal('tf-inline-rtl', 'input { direction: rtl; }', `<div data-dragon-id="d">X ${field}</div>`)).toEqual(['android', 'ios', 'web'].map((t) => expect.stringMatching(new RegExp(`^${t} DRAGON_UNSUPPORTED_VALUE direction: rtl on the inline-block <input> t is not supported`))));
    expect(refusal('tf-inline-inline', 'input { display: inline; }', `<div data-dragon-id="d">X ${field}</div>`)).toEqual(expect.arrayContaining(['android', 'ios', 'web'].map((t) => expect.stringMatching(new RegExp(`^${t} DRAGON_UNSUPPORTED_VALUE display: inline on <input> t is not supported on a text field`)))));
    expect(refusal('tf-inline-baseline', 'input { vertical-align: baseline; }', `<div data-dragon-id="d">X ${field}</div>`)).toEqual([]);
  });

  it('refuses a field inside an inline box, or beside text in a real face, as any atomic inline (INL2c)', () => {
    const field = '<input data-dragon-id="t" readonly="" value="X">';
    expect(errors(compile('tf-inline-box', '', `<div data-dragon-id="d">X <span data-dragon-id="s">${field}</span></div>`, INLINE))).toContainEqual(expect.stringMatching(/^ios DRAGON_UNPROVEN_CONTEXT inline-block <input> t is an atomic inline inside the inline box <span> s/));
    expect(errors(compile('tf-inline-face', '.d { font-family: Lato; } input { font-family: Ahem; }', `<div data-dragon-id="d" class="d">X ${field}</div>`, INLINE, true))).toContainEqual(expect.stringMatching(/^ios DRAGON_UNPROVEN_CONTEXT inline-block <input> t shares an inline formatting context of d with text d:text0 in a real face/));
  });
});
