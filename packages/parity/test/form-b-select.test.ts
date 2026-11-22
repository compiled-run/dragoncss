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

  // Blink LayoutBox::HasControlClip and OverflowClipRect: a menulist clips its inner element to its content box whatever its overflow.
  it('clips the inner element to the select natively, and refuses a vertical padding where the select can be shorter than its line', () => {
    const c = compile('sel-clip', '.short { height: 4px; }', sel('s', '<option>AA</option>', ' class="short"'));
    expect(errors(c)).toEqual([]);
    const r = dragon.nativePrograms(c, []);
    if (r.kind !== 'ready') throw new Error(r.reason);
    for (const p of [r.programs.uikit, r.programs['android-views']]) {
      expect(p.nodes.find((n) => n.id === 's')?.clips).toBe(true);
      expect(p.nodes.find((n) => n.id === 's::inner')?.facts['stacking']).toMatchObject({ clipChain: expect.arrayContaining(['s']) });
    }
    expect(errors(compile('sel-pad-h', 'select { height: 4px; padding: 1px 0; }', sel('s', '<option>AA</option>')))).toContainEqual(expect.stringMatching(/padding-top: 1px on <select> s is not supported where its height can be less than its label's line/));
    expect(errors(compile('sel-pad-grid', '.g { display: grid; } select { padding-bottom: 2px; }', `<div data-dragon-id="g" class="g">${sel('s', '<option>AA</option>')}</div>`))).toContainEqual(expect.stringMatching(/padding-bottom: 2px on <select> s is not supported/));
    expect(errors(compile('sel-pad-row', '.r { display: flex; height: 24px; } select { padding-bottom: 4px; }', `<div data-dragon-id="r" class="r">${sel('s', '<option>AA</option>')}</div>`))).toContainEqual(expect.stringMatching(/padding-bottom: 4px on <select> s is not supported/));
    expect(errors(compile('sel-pad-auto', 'select { padding: 2px 3px; }', sel('s', '<option>AA</option>')))).toEqual([]);
  });

  it('names the change that clears a width refusal on a row flex item with min-width: auto: min-width: 0 and a px flex basis', () => {
    const c = compile('sel-manual', '.w { display: flex; width: 300px; } select { width: 100%; }', `<div data-dragon-id="w" class="w"><div data-dragon-id="c">${sel('s', '<option>A</option>')}</div></div>`);
    const d = c.diagnostics.find((x: Diagnostic) => x.message.includes('width: 100% on <select> s'));
    expect(d?.fix !== null && d?.fix !== undefined && 'manual' in d.fix ? d.fix.manual : null).toBe('Set min-width: 0 and a flex-basis in px on <div> c (flex: 1 1 0px; min-width: 0). Or give <select> s a width in px.');
    const fixed = compile('sel-manual-fixed', '.w { display: flex; width: 300px; } .c { flex: 1 1 0px; min-width: 0; } select { width: 100%; }', `<div data-dragon-id="w" class="w"><div data-dragon-id="c" class="c">${sel('s', '<option>A</option>')}</div></div>`);
    expect(errors(fixed)).toEqual([]);
  });

  // Blink LayoutBox::DefaultIntrinsicContentInlineSize: a select's min-content and max-content widths are its widest option's.
  it('refuses a percentage width or flex basis that a content-sized box reads, and an intrinsic min-width, max-width or flex basis', () => {
    const wide = sel('s', '<option>A</option><option>AAAAAAAAAAAAAAAAAAAA</option>');
    const inside = (css: string, wrap = '', item = ''): string[] => errors(compile('sel-pct', `select { width: 100%; ${item} } ${css}`, wrap === '' ? wide : `<div data-dragon-id="w" class="w">${wrap === 'two' ? `<div data-dragon-id="c" class="c">${wide}</div>` : wide}</div>`));
    const content = (at: string, why: string): RegExp => new RegExp(`DRAGON_UNSUPPORTED_VALUE width: 100% on <select> s is not supported here: <div> ${at} takes its width from its content \\(${why.replace(/[()]/g, '\\$&')}\\)`);
    expect(inside('.w { float: left; }', 'one')).toContainEqual(expect.stringMatching(content('w', 'float: left with an auto width')));
    expect(inside('.w { display: inline-block; }', 'one')).toContainEqual(expect.stringMatching(content('w', 'display: inline-block with an auto width')));
    expect(inside('.w { width: max-content; }', 'one')).toContainEqual(expect.stringMatching(content('w', 'width: max-content')));
    expect(inside('.w { position: absolute; left: 0; }', 'one')).toContainEqual(expect.stringMatching(content('w', 'position: absolute with an auto width')));
    expect(inside('.w { display: flex; width: 300px; } .c { flex: none; min-width: 0; }', 'two')).toContainEqual(expect.stringMatching(content('c', 'a flex item with an auto flex basis and width')));
    expect(inside('.w { display: flex; width: 300px; }', 'two')).toContainEqual(expect.stringMatching(content('c', 'a row flex item with min-width: auto')));
    expect(inside('.w { display: flex; flex-direction: column; align-items: start; width: 300px; }', 'two')).toContainEqual(expect.stringMatching(content('c', 'a column flex item with align-self: start and an auto width')));
    expect(inside('.w { display: grid; grid-template-columns: auto; width: 300px; }', 'two')).toContainEqual(expect.stringMatching(content('c', 'a grid item')));
    // A block with an auto width fills its containing block, so the walk goes on to the shrink-to-fit box around it.
    expect(inside('.w { float: left; }', 'two')).toContainEqual(expect.stringMatching(content('w', 'float: left with an auto width')));
    expect(errors(compile('sel-calc', 'select { width: calc(100% - 10px); } .w { display: inline-block; }', `<div data-dragon-id="w" class="w">${wide}</div>`))).toContainEqual(expect.stringMatching(/DRAGON_UNSUPPORTED_VALUE width: calc\(100% - 10px\) on <select> s is not supported here: <div> w takes its width from its content/));
    expect(errors(compile('sel-grid', '.g { display: grid; width: 300px; } select { width: 50%; }', `<div data-dragon-id="g" class="g">${wide}</div>`))).toContainEqual(expect.stringMatching(/DRAGON_UNSUPPORTED_VALUE width: 50% on <select> s is not supported on a grid item/));
    expect(errors(compile('sel-basis-pct', '.r { display: inline-flex; } select { flex-basis: 50%; min-width: 0; }', `<div data-dragon-id="r" class="r">${wide}</div>`))).toContainEqual(expect.stringMatching(/DRAGON_UNSUPPORTED_VALUE flex-basis: 50% on <select> s is not supported here: <div> r takes its width from its content \(display: inline-flex with an auto width\)/));
    expect(errors(compile('sel-basis', '.r { display: flex; } select { flex-basis: content; min-width: 0; }', `<div data-dragon-id="r" class="r">${wide}</div>`))).toContainEqual(expect.stringMatching(/DRAGON_UNSUPPORTED_VALUE flex-basis: content on <select> s is not supported: Chrome takes it from the select's widest option/));
    expect(errors(compile('sel-min', 'select { min-width: max-content; }', wide))).toContainEqual(expect.stringMatching(/DRAGON_UNSUPPORTED_VALUE min-width: max-content on <select> s is not supported: Chrome sizes a select's content to its widest option/));
    expect(errors(compile('sel-max', 'select { max-width: fit-content; }', wide))).toContainEqual(expect.stringMatching(/DRAGON_UNSUPPORTED_VALUE max-width: fit-content on <select> s is not supported/));
    // Blink ComputeMinMaxSizeOfRowContainer: a flexible row item's contribution reads its percentage width as indefinite, whatever its basis.
    for (const flex of ['1 1 150px', '1 1 0px', '0 1 150px']) {
      expect(errors(compile('sel-basis-len', `.w { display: inline-flex; } select { width: 100%; flex: ${flex}; min-width: 0; }`, `<div data-dragon-id="w" class="w">${wide}</div>`)), flex).toContainEqual(expect.stringMatching(content('w', 'display: inline-flex with an auto width')));
    }
    expect(errors(compile('sel-basis-rigid', '.w { display: inline-flex; } select { width: 100%; flex: 0 0 150px; min-width: 0; }', `<div data-dragon-id="w" class="w">${wide}</div>`)).filter((e) => e.includes('<select>'))).toEqual([]);
    expect(inside('.w { float: left; display: flex; } select { flex: 1 1 0px; min-width: 0; }', 'one')).toContainEqual(expect.stringMatching(content('w', 'float: left with an auto width')));
    // css-flexbox-1 §9.4: a multi-line column container's line is as wide as its items' contributions.
    expect(inside('.w { display: flex; flex-direction: column; flex-wrap: wrap; width: 300px; height: 100px; }', 'two')).toContainEqual(expect.stringMatching(content('c', 'a stretched column flex item in a flex-wrap: wrap container')));
    // A percentage of a box whose width its content cannot change is laid out.
    expect(inside('.w { width: 300px; }', 'two')).toEqual([]);
    expect(inside('', 'two')).toEqual([]);
    expect(inside('.w { float: left; width: 200px; }', 'two')).toEqual([]);
    expect(inside('.w { display: flex; width: 300px; } .c { flex: 1; min-width: 0; }', 'two')).toEqual([]);
    expect(inside('.w { display: flex; flex-direction: column; width: 300px; }', 'two')).toEqual([]);
    expect(inside('.w { display: inline-block; width: 200px; }', 'two')).toEqual([]);
    expect(inside('.p { position: relative; width: 300px; height: 50px; } .w { position: absolute; left: 0; right: 0; }', 'one').filter((e) => e.includes('<select>'))).toEqual([]);
  });
});
