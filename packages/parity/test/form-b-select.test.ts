// FORM-b select S1: a single select with appearance: none compiles as Chrome 145's menulist, a flex row container of its inner
// element holding the shown option's label; a list box, optgroup, any other appearance, an inline-level, shrink-to-fit or
// flex-item-minimum select, option styles and focus rules are refused by name.
import { describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic } from 'dragon';
import * as dragon from 'dragon';
import { ahemMeasurer, layout as engineLayout } from '@dragon/layout';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';

const page = (css: string, body: string): string => `<!DOCTYPE html>
<html data-dragon-id="html">
<head>
<style>
body { margin: 0; font-family: Ahem; font-size: 10px; }
select { display: block; width: 100px; appearance: none; font: inherit; margin: 0; color: #000; border: 1px solid #036; }
${css}
</style>
</head>
<body data-dragon-id="body">
${body}
</body>
</html>
`;

function compile(id: string, css: string, body: string): Compiled<'ios' | 'android' | 'web'> {
  const project = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem' });
  return project.compile(fixtureToInput(id, page(css, body)));
}

const errors = (c: Compiled<string>): string[] => c.diagnostics.filter((d: Diagnostic) => d.severity === 'error').map((d) => `${d.target ?? 'all'} ${d.code} ${d.message}`);

/** The engine's border boxes of a compile's first case, in CSS px, by id. */
function boxes(c: Compiled<string>): Map<string, { x: number; y: number; width: number; height: number }> {
  const p = dragon.engineLayoutProjection(c, ENVIRONMENT, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const r = engineLayout(p.input, ahemMeasurer);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return new Map(r.boxes.map((b) => [b.id, { x: b.x / 64, y: b.y / 64, width: b.width / 64, height: b.height / 64 }]));
}

/** A select with its options given as '<option ...>' markup; each option is given the id "<select id>-o<k>". */
const sel = (id: string, options: string, attrs = ''): string => {
  let k = 0;
  return `<select data-dragon-id="${id}"${attrs}>${options.replace(/<option(?![^>]*data-dragon-id)/g, () => `<option data-dragon-id="${id}-o${k++}"`)}</select>`;
};

describe('FORM-b select S1', () => {
  it('lays out a select as a flex row of its inner element, one line of the font metrics height tall', () => {
    const c = compile('sel-basic', '', sel('s', '<option>AA</option><option>BB</option>'));
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    expect(b.get('s')).toMatchObject({ x: 0, y: 0, width: 100, height: 12 });
    expect(b.get('s::inner')).toMatchObject({ x: 1, y: 1, width: 98, height: 10 });
    expect(b.get('s::inner:text0')).toMatchObject({ x: 0, y: 0, width: 20, height: 10 });
  });

  it('shows the last selected option, else the first that is not disabled, else none (an empty line)', () => {
    const c = compile('sel-selected', '', [
      sel('a', '<option>A</option><option selected="">BB</option>'),
      sel('b', '<option selected="">A</option><option selected="">BBB</option><option>CC</option>'),
      sel('c', '<option disabled="">A</option><option>BBBB</option>'),
      sel('d', '<option disabled="">A</option><option disabled="">B</option>'),
      sel('e', '<option selected="" disabled="">AAAAA</option><option>B</option>'),
      sel('f', '<option label="  L   L  ">X</option>'),
      sel('g', '<option>  X \n  Y  </option>'),
      sel('h', ''),
    ].join('\n'));
    expect(errors(c)).toEqual([]);
    const b = boxes(c);
    expect(['a', 'b', 'c', 'e', 'f', 'g'].map((k) => b.get(`${k}::inner:text0`)?.width)).toEqual([20, 30, 40, 50, 50, 30]);
    expect(b.has('d::inner:text0')).toBe(false);
    expect(b.get('d::inner')?.height).toBe(10);
    expect(b.get('h::inner')?.height).toBe(10);
  });

  it('keeps an author line height on the inner element, centred safely by its auto margins', () => {
    const b = boxes(compile('sel-lh', '.a { line-height: 30px; } .b { height: 40px; line-height: 4px; } .c { height: 4px; }', ['a', 'b', 'c'].map((k) => sel(k, '<option>AA</option>', ` class="${k}"`)).join('\n')));
    expect(['a', 'b', 'c'].map((k) => b.get(k)?.height)).toEqual([32, 40, 4]);
    expect(['a', 'b', 'c'].map((k) => b.get(`${k}::inner`)?.height)).toEqual([30, 4, 10]);
    expect(b.get('b::inner')?.y).toBe(18);
    expect(b.get('c::inner')?.y).toBe(1);
  });

  it('refuses a list box, an optgroup, another appearance, option styles and focus rules by name', () => {
    expect(errors(compile('sel-multiple', '', sel('s', '<option>A</option>', ' multiple=""')))).toEqual([expect.stringMatching(/^all DRAGON_UNSUPPORTED_ELEMENT <select multiple> s is a list box, which waits for the FORM-b listbox package/)]);
    expect(errors(compile('sel-size', '', sel('s', '<option>A</option>', ' size="3"')))).toEqual([expect.stringMatching(/^all DRAGON_UNSUPPORTED_ELEMENT <select size=3> s is a list box/)]);
    expect(errors(compile('sel-size-1', '', sel('s', '<option>A</option>', ' size="1"')))).toEqual([]);
    expect(errors(compile('sel-optgroup', '', sel('s', '<optgroup data-dragon-id="g" label="G"><option>A</option></optgroup>')))).toContainEqual(expect.stringMatching(/^all DRAGON_UNSUPPORTED_ELEMENT <optgroup> g is not supported: an option group waits for FORM-b select/));
    expect(errors(compile('sel-auto', 'select { appearance: auto; }', sel('s', '<option>A</option>')))).toContainEqual(expect.stringMatching(/<select> s with appearance: auto draws Chrome's drop-down arrow and internal paddings, which wait for FORM-b select S2/));
    expect(errors(compile('sel-option-style', 'option { direction: rtl; }', sel('s', '<option data-dragon-id="o">A</option>')))).toContainEqual(expect.stringMatching(/direction on <option> o is not supported/));
    expect(errors(compile('sel-focus', 'select:focus-visible { outline: 2px solid red; }', sel('s', '<option>A</option>')))).toContainEqual(expect.stringMatching(/a :focus or :focus-visible rule on <select> s is not supported/));
  });

  it('refuses an inline-level, floated, positioned, shrink-to-fit or flex-minimum select, a UA font and an author flex layout', () => {
    expect(errors(compile('sel-inline', 'select { display: inline-block; }', `<div data-dragon-id="d">${sel('s', '<option>A</option>')}</div>`))).toContainEqual(expect.stringMatching(/display: inline-block on <select> s makes it an inline-level control/));
    expect(errors(compile('sel-float', 'select { float: left; }', sel('s', '<option>A</option>')))).toContainEqual(expect.stringMatching(/float: left on <select> s is not supported/));
    expect(errors(compile('sel-abs', 'select { position: absolute; }', sel('s', '<option>A</option>')))).toContainEqual(expect.stringMatching(/position: absolute on <select> s is not supported/));
    expect(errors(compile('sel-width', 'select { width: auto; }', sel('s', '<option>A</option>')))).toContainEqual(expect.stringMatching(/width: auto on <select> s is not supported: Chrome sizes a select to its widest option/));
    expect(errors(compile('sel-flex-min', '.row { display: flex; }', `<div data-dragon-id="r" class="row">${sel('s', '<option>A</option>')}</div>`))).toContainEqual(expect.stringMatching(/<select> s is a flex item with min-width: auto/));
    expect(errors(compile('sel-flex-min0', '.row { display: flex; } select { min-width: 0; }', `<div data-dragon-id="r" class="row">${sel('s', '<option>A</option>')}</div>`))).toEqual([]);
    expect(errors(compile('sel-font', 'select { font-family: revert; }', sel('s', '<option>A</option>')))).toContainEqual(expect.stringMatching(/<select> s uses Chrome's user-agent control font/));
    expect(errors(compile('sel-dir', 'select { flex-direction: column; }', sel('s', '<option>A</option>')))).toContainEqual(expect.stringMatching(/flex-direction: column on <select> s is not supported/));
    expect(errors(compile('sel-align', 'select { align-items: start; }', sel('s', '<option>A</option>')))).toContainEqual(expect.stringMatching(/align-items: start on <select> s is not supported/));
  });
});
