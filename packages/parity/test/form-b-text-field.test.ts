// FORM-b: single-line text fields (text, email, url, tel and an unknown type) compile as Chrome 145's UA shadow tree, an inner
// editor holding the value and a placeholder while the value is empty, laid out by the engine (controls.ts) and written for the
// web with ::placeholder. Refused: a themed field, a password field, an inline-level one, and on iOS and Android an editable one.
import { describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic } from 'dragon';
import * as dragon from 'dragon';
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

function compile(id: string, css: string, body: string, base = BASE, fonts = false): Compiled<'ios' | 'android' | 'web'> {
  const project = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }, ...(fonts ? { fonts: FONT_REFERENCE_MAP } : {}) }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem' });
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
      expect.stringMatching(/^android DRAGON_UNSUPPORTED_VALUE <input> t is an editable text field: Dragon draws its value but has no caret/),
      expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE <input> t is an editable text field/),
    ]);
    expect(errors(compile('tf-theme', '', '<input data-dragon-id="t" readonly="">', 'input { display: block; font: inherit; margin: 0; }'))).toContainEqual(expect.stringMatching(/^ios DRAGON_UNSUPPORTED_VALUE <input> t with appearance: auto and no author background or border/));
    expect(errors(compile('tf-password', '', '<input data-dragon-id="t" readonly="" type="password" value="XX">'))).toEqual([expect.stringMatching(/^all DRAGON_UNSUPPORTED_ELEMENT <input type=password> t is not supported/)]);
    expect(errors(compile('tf-inline', 'input { display: inline-block; }', '<div data-dragon-id="d"><input data-dragon-id="t" readonly=""></div>'))).toContainEqual(expect.stringMatching(/display: inline-block on <input> t makes it an inline-level control/));
    expect(errors(compile('tf-float', 'input { float: left; }', '<input data-dragon-id="t" readonly="">'))).toContainEqual(expect.stringMatching(/float: left on <input> t is not supported on a text field/));
    expect(errors(compile('tf-font', 'input { font-family: Lato; }', '<input data-dragon-id="t" readonly="">', BASE, true))).toContainEqual(expect.stringMatching(/^ios DRAGON_UNSUPPORTED_FONT <input> t is in font-family: Lato: Chrome sizes a text field by the face's average character width/));
    expect(errors(compile('tf-font-width', 'input { font-family: Lato; width: 40px; }', '<input data-dragon-id="t" readonly="">', BASE, true)).filter((e) => e.includes('average character width'))).toHaveLength(2);
  });
});
