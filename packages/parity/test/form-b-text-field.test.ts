// FORM-b: single-line text fields (text, email, url, tel and an unknown type) compile as Chrome 145's UA shadow tree, an inner
// editor holding the value and a placeholder while the value is empty, laid out by the engine (controls.ts) and written for the
// web with ::placeholder. Refused: a themed field, a password field, an inline-level one, and on iOS and Android an editable one
// unless the host edits text fields (compileNativeStyles textEditing: 'host', as the Markless export compiles).
import { describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic, NativeStylesConfig } from 'dragon';
import * as dragon from 'dragon';
import { marklessFrontEnd, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { PROJECT_ID } from '../src/fixture-reader.ts';
import { ahemMeasurer, layout as engineLayout } from '@dragon/layout';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { withFontMapAssets } from '../src/fixture-groups/fonts.ts';
import { FONT_REFERENCE_MAP } from '../src/font-reference.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';

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

  it('refuses an editable field on iOS and Android only, and a themed, password or inline-level field everywhere', () => {
    expect(errors(compile('tf-edit', '', '<input data-dragon-id="t" value="XX">'))).toEqual([
      expect.stringMatching(/^android DRAGON_UNSUPPORTED_VALUE <input> t is an editable text control: Dragon draws its value but has no caret/),
      expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE <input> t is an editable text control/),
    ]);
    expect(errors(compile('tf-theme', '', '<input data-dragon-id="t" readonly="">', 'input { display: block; font: inherit; margin: 0; }'))).toContainEqual(expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE <input> t with appearance: auto and no author background or border/));
    expect(errors(compile('tf-password', '', '<input data-dragon-id="t" readonly="" type="password" value="XX">'))).toEqual([expect.stringMatching(/^all DRAGON_UNSUPPORTED_ELEMENT <input type=password> t is not supported/)]);
    expect(errors(compile('tf-inline', 'input { display: inline-block; }', '<div data-dragon-id="d"><input data-dragon-id="t" readonly=""></div>'))).toContainEqual(expect.stringMatching(/display: inline-block on <input> t makes it an inline-level control/));
    expect(errors(compile('tf-float', 'input { float: left; }', '<input data-dragon-id="t" readonly="">'))).toContainEqual(expect.stringMatching(/float: left on <input> t is not supported on a text control/));
    expect(errors(compile('tf-font', 'input { font-family: Lato; }', '<input data-dragon-id="t" readonly="">', BASE, true))).toContainEqual(expect.stringMatching(/^ios DRAGON_UNSUPPORTED_FONT <input> t is in font-family: Lato: Chrome sizes a text control by the face's average character width/));
    expect(errors(compile('tf-font-width', 'input { font-family: Lato; width: 40px; }', '<input data-dragon-id="t" readonly="">', BASE, true)).filter((e) => e.includes('average character width'))).toHaveLength(2);
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

  it('lays out an editable textarea when the host edits text, its empty editor one line tall, and a compile without that still refuses it', () => {
    const css = 'textarea { display: block; font: inherit; margin: 0; border: 2px solid #036; padding: 1px 2px; resize: none; scrollbar-width: none; line-height: 1.5; }';
    const body = '<textarea data-dragon-id="a" rows="3">XX</textarea>\n<textarea data-dragon-id="e" rows="3"></textarea>\n<textarea data-dragon-id="r" rows="3" readonly=""></textarea>';
    expect(errors(compile('ta-host-edits', css, body, BASE, false, true))).toEqual([]);
    const refused = errors(compile('ta-not-host', css, body)).filter((e) => e.includes('is an editable text control'));
    expect(refused).toEqual(['a', 'a', 'e', 'e'].map((id, i) => expect.stringMatching(new RegExp(`^${i % 2 === 0 ? 'android' : 'ios'} DRAGON_UNSUPPORTED_VALUE <textarea> ${id} is an editable text control`))));
    const b = boxes(compile('ta-host-edits', css, body, BASE, false, true));
    // Chrome 145: an editable empty editor holds one line (15px for a 10px Ahem line at line-height 1.5); a readonly one is 0 tall.
    expect([b.get('a::editor')?.height, b.get('e::editor')?.height, b.get('r::editor')?.height, b.get('a')?.height]).toEqual([15, 15, 0, 3 * 15 + 2 + 4]);
  });

  it('keeps :read-write and :read-only refused on an edited textarea, whose state is the host\'s', () => {
    const css = 'textarea { display: block; font: inherit; resize: none; scrollbar-width: none; } textarea:read-write { color: #036; }';
    expect(errors(compile('ta-read-write', css, '<textarea data-dragon-id="a">XX</textarea>', BASE, false, true)).filter((e) => e.includes(':read-write'))).not.toEqual([]);
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
