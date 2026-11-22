// FORM-b select: a single select with appearance: none (S1), or auto devolved to menulist-button by an author background, border
// or box-shadow (S2), compiles as Chrome 145's menulist, a flex row container of its inner element holding the shown option's
// label; S2 adds the theme's internal paddings and the drop-down arrow, proven here against Chrome's committed pixels. A list box,
// optgroup, themed menulist, an inline-level, shrink-to-fit or flex-item-minimum select and option styles are refused.
import { describe, expect, it } from 'vitest';
import type { Compiled, Diagnostic } from 'dragon';
import * as dragon from 'dragon';
import type { ControlBox, LayoutBox } from '@dragon/layout';
import { ahemMeasurer, layout as engineLayout, menuListArrow, menuListArrows, snapEdges } from '@dragon/layout';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { ENVIRONMENT, FIXTURES } from '../src/fixtures.ts';
import { pixelAt } from '../src/native-compare.ts';
import { nativeCompile } from '../src/native-compile.ts';
import { arrowSegments, selectArrows } from '../src/paint-samples/control.ts';
import { SVG_CLEAR_DEVICE_PX } from '../src/samples.ts';
import { arrowPixelProblems } from '../../dragon/src/forms/index.ts';
import { caseBoxes, committedPixels } from '../src/pixel-reference.ts';
import { expectedEngine } from '../src/native-host.ts';

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

function compile(id: string, css: string, body: string, base = true, lanes = false): Compiled<'ios' | 'android' | 'web'> {
  const project = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem', interactionLanes: lanes });
  return project.compile(fixtureToInput(id, base ? page(css, body) : page(css, body).replace(/^select \{[^\n]*\n/m, '')));
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
// A select whose options are a host list's rows (the Markless export marks it): Dragon cannot read its other labels.
const LISTED = ' data-dragon-listed-options=""';

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

  it('refuses a list box, an optgroup, another appearance and option styles by name, and compiles a focus rule', () => {
    expect(errors(compile('sel-multiple', '', sel('s', '<option>A</option>', ' multiple=""')))).toEqual([expect.stringMatching(/^all DRAGON_UNSUPPORTED_ELEMENT <select multiple> s is a list box, which waits for the FORM-b listbox package/)]);
    expect(errors(compile('sel-size', '', sel('s', '<option>A</option>', ' size="3"')))).toEqual([expect.stringMatching(/^all DRAGON_UNSUPPORTED_ELEMENT <select size=3> s is a list box/)]);
    expect(errors(compile('sel-size-1', '', sel('s', '<option>A</option>', ' size="1"')))).toEqual([]);
    expect(errors(compile('sel-optgroup', '', sel('s', '<optgroup data-dragon-id="g" label="G"><option>A</option></optgroup>')))).toContainEqual(expect.stringMatching(/^all DRAGON_UNSUPPORTED_ELEMENT <optgroup> g is not supported: an option group waits for FORM-b select/));
    expect(errors(compile('sel-menulist', 'select { appearance: menulist; }', sel('s', '<option>A</option>')))).toContainEqual(expect.stringMatching(/<select> s with appearance: menulist is not supported; only appearance: none or auto is laid out/));
    expect(errors(compile('sel-option-style', 'option { direction: rtl; }', sel('s', '<option data-dragon-id="o">A</option>')))).toContainEqual(expect.stringMatching(/direction on <option> o is not supported/));
    // No select-specific refusal is left; the device proofs and the hit model gate it as any focus rule (form-b-select-focus.test.ts).
    expect(errors(compile('sel-focus', 'select:focus-visible { outline: 2px solid red; }', sel('s', '<option>A</option>')))).not.toContainEqual(expect.stringMatching(/rule on <select> s/));
  });

  it('refuses an inline-level, floated, positioned, shrink-to-fit or flex-minimum select, a UA font and an author flex layout', () => {
    expect(errors(compile('sel-inline', 'select { display: inline-block; }', `<div data-dragon-id="d">${sel('s', '<option>A</option>')}</div>`))).toContainEqual(expect.stringMatching(/display: inline-block on <select> s makes it an inline-level control/));
    expect(errors(compile('sel-float', 'select { float: left; }', sel('s', '<option>A</option>')))).toContainEqual(expect.stringMatching(/float: left on <select> s is not supported/));
    expect(errors(compile('sel-abs', 'select { position: absolute; }', sel('s', '<option>A</option>')))).toContainEqual(expect.stringMatching(/position: absolute on <select> s is not supported/));
    expect(errors(compile('sel-width', 'select { width: auto; }', sel('s', '<option>A</option>', LISTED)))).toContainEqual(expect.stringMatching(/width: auto on <select> s is not supported: Chrome sizes a select to its widest option/));
    expect(errors(compile('sel-flex-min', '.row { display: flex; }', `<div data-dragon-id="r" class="row">${sel('s', '<option>A</option>', LISTED)}</div>`))).toContainEqual(expect.stringMatching(/<select> s is a flex item with min-width: auto/));
    // FORM-b S4: with every option listed, the engine measures the widest one, so neither width is refused.
    expect(errors(compile('sel-width-s4', 'select { width: auto; }', sel('s', '<option>A</option>')))).toEqual([]);
    expect(errors(compile('sel-flex-min-s4', '.row { display: flex; }', `<div data-dragon-id="r" class="row">${sel('s', '<option>A</option>')}</div>`))).toEqual([]);
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
    // A grid item in implicit auto rows is at least its content's height, so its padding is laid out.
    expect(errors(compile('sel-pad-grid-auto', '.g { display: grid; } select { padding-bottom: 2px; }', `<div data-dragon-id="g" class="g">${sel('s', '<option>AA</option>')}</div>`))).toEqual([]);
    expect(errors(compile('sel-pad-grid', '.g { display: grid; grid-template-rows: 6px; } select { padding-bottom: 2px; }', `<div data-dragon-id="g" class="g">${sel('s', '<option>AA</option>')}</div>`))).toContainEqual(expect.stringMatching(/padding-bottom: 2px on <select> s is not supported/));
    expect(errors(compile('sel-pad-row', '.r { display: flex; height: 24px; } select { padding-bottom: 4px; }', `<div data-dragon-id="r" class="r">${sel('s', '<option>AA</option>')}</div>`))).toContainEqual(expect.stringMatching(/padding-bottom: 4px on <select> s is not supported/));
    expect(errors(compile('sel-pad-auto', 'select { padding: 2px 3px; }', sel('s', '<option>AA</option>')))).toEqual([]);
  });

  it('names the change that clears a width refusal on a row flex item with min-width: auto: min-width: 0 and a px flex basis', () => {
    const c = compile('sel-manual', '.w { display: flex; width: 300px; } select { width: 100%; }', `<div data-dragon-id="w" class="w"><div data-dragon-id="c">${sel('s', '<option>A</option>', LISTED)}</div></div>`);
    const d = c.diagnostics.find((x: Diagnostic) => x.message.includes('width: 100% on <select> s'));
    expect(d?.fix !== null && d?.fix !== undefined && 'manual' in d.fix ? d.fix.manual : null).toBe('Set min-width: 0 and a flex-basis in px on <div> c (flex: 1 1 0px; min-width: 0). Or give <select> s a width in px.');
    const fixed = compile('sel-manual-fixed', '.w { display: flex; width: 300px; } .c { flex: 1 1 0px; min-width: 0; } select { width: 100%; }', `<div data-dragon-id="w" class="w"><div data-dragon-id="c" class="c">${sel('s', '<option>A</option>', LISTED)}</div></div>`);
    expect(errors(fixed)).toEqual([]);
  });

  // Blink LayoutBox::DefaultIntrinsicContentInlineSize: a select's min-content and max-content widths are its widest option's.
  it('refuses a percentage width or flex basis that a content-sized box reads, and an intrinsic min-width, max-width or flex basis', () => {
    const wide = sel('s', '<option>A</option><option>AAAAAAAAAAAAAAAAAAAA</option>', LISTED);
    // FORM-b S4: every refusal below holds for a select whose options are a list's rows; with every option listed it compiles.
    expect(errors(compile('sel-pct-s4', 'select { width: 100%; } .w { float: left; }', `<div data-dragon-id="w" class="w">${sel('s', '<option>A</option><option>AAAAAAAAAAAAAAAAAAAA</option>')}</div>`)).filter((e) => e.includes('<select>'))).toEqual([]);
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

const button = (css: string): string => `select { display: block; width: 100px; font: inherit; margin: 0; color: #000; ${css} }`;

describe('FORM-b select S2: menulist-button', () => {
  it('devolves auto to menulist-button for an author background, border or box-shadow, and refuses the themed menulist', () => {
    for (const css of ['background-color: #fff;', 'border: 1px solid #036;', 'box-shadow: 0 0 0 1px #036;', 'border-top-left-radius: 2px;']) {
      expect(errors(compile('sel-devolve', button(css), sel('s', '<option>A</option>'), false)), css).toEqual([]);
      expect(errors(compile('sel-devolve-lanes', button(css), sel('s', '<option>A</option>'), false, true)), css).toEqual([]);
    }
    for (const css of ['', 'box-shadow: none;']) {
      expect(errors(compile('sel-theme', button(css), sel('s', '<option>A</option>'), false)), css).toContainEqual(expect.stringMatching(/^web DRAGON_UNSUPPORTED_VALUE <select> s with appearance: auto and no author background, border or box-shadow is Chrome's themed menulist/));
    }
  });

  it('gives the inner element the internal margins 4 and 1 + 15 and paddings 1, mirrored in rtl, and resets the line height', () => {
    const b = boxes(compile('sel-button', `${button('border: 1px solid #036; line-height: 30px;')} .r { direction: rtl; }`, `${sel('s', '<option>AA</option>')}\n${sel('r', '<option>AA</option>', ' class="r"')}`, false, true));
    expect(b.get('s')).toMatchObject({ x: 0, y: 0, width: 100, height: 14 });
    expect(b.get('s::inner')).toMatchObject({ x: 5, y: 1, width: 78, height: 12 });
    expect(b.get('r::inner')).toMatchObject({ x: 17, width: 78 });
  });

  const spec = FIXTURES.find((f) => f.id === 'controls-select-button');
  if (spec === undefined) throw new Error('no controls-select-button fixture');
  const arrowCases = [{ spec, cases: casesOf(spec, fixtureInput(spec)) }];

  /** Each select's arrow pixels at a DPR: fully covered by the stroke (Chrome shows the select's colour) and clear of it (its background). */
  function arrowPixels(caseId: string, dpr: number, flip: boolean): { covered: number; clear: number; wrong: string[] } {
    const f = arrowCases.flatMap((x) => x.cases.map((c) => ({ spec: x.spec, case: c }))).find((x) => x.case.id === caseId);
    if (f === undefined) throw new Error(`no case ${caseId}`);
    const compiled = nativeCompile(f.spec, f.case.environment.direction);
    const p = dragon.nativePrograms(compiled, f.case.assignment);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const program = p.programs.uikit;
    const colors = dragon.resolvedColors(compiled, f.case.assignment);
    const img = committedPixels(caseId, dpr);
    if (colors === null || img === null) throw new Error(`${caseId}@${dpr}: no colours or committed pixels`);
    const sampled = caseBoxes(program, f.case.environment.viewport, dpr);
    const byId = new Map(sampled.map((b) => [b.id, b]));
    const flipped = flip ? { ...program, root: flipDirections(program.root) } : program;
    let covered = 0;
    let clear = 0;
    const wrong: string[] = [];
    const hex = (c: { r: number; g: number; b: number }): string => `#${((c.r << 16) | (c.g << 8) | c.b).toString(16).padStart(6, '0')}`;
    const at = (x: number, y: number): string => {
      const [r, g, b] = pixelAt(img, x, y);
      return hex({ r, g, b });
    };
    for (const { id, arrow } of selectArrows(flipped, sampled, dpr)) {
      const s = byId.get(id);
      const inner = byId.get(`${id}::inner`);
      const c = colors.get(id);
      if (s === undefined || inner === undefined || c === undefined) throw new Error(`${caseId}: ${id} has no box, inner box or colours`);
      if (c['background-color'].alpha !== 255) throw new Error(`${caseId}: ${id} has no opaque background to judge its arrow on`);
      const segs = arrowSegments(arrow);
      const xs = segs.flatMap(([a, z]) => [a.x, z.x]);
      const ys = segs.flatMap(([a, z]) => [a.y, z.y]);
      const left = Math.max(Math.min(...xs) - 5, s.left + s.border.left);
      const top = Math.max(Math.min(...ys) - 5, s.top + s.border.top);
      const right = Math.min(Math.max(...xs) + 5, s.right - s.border.right);
      const bottom = Math.min(Math.max(...ys) + 5, s.bottom - s.border.bottom);
      const r = arrowPixelProblems(arrow.shape.segments, arrow.strokeWidth, SVG_CLEAR_DEVICE_PX, at, [left, top, right - left, bottom - top], [inner.left, inner.top, inner.right, inner.bottom], hex(c.color), hex(c['background-color']));
      covered += r.covered;
      clear += r.clear;
      wrong.push(...r.wrong.map((w) => `${id} ${w}`));
    }
    return { covered, clear, wrong };
  }

  it("draws Chrome's arrow at every DPR in both directions: every pixel the stroke covers is the select's colour, every clear one its background", () => {
    expect(arrowCases.flatMap((f) => f.cases).length).toBe(2);
    for (const c of arrowCases.flatMap((f) => f.cases)) {
      for (const dpr of DPRS) {
        const r = arrowPixels(c.id, dpr, false);
        expect(r.wrong, `${c.id}@${dpr}`).toEqual([]);
        expect(r.covered, `${c.id}@${dpr}`).toBeGreaterThan(100);
        expect(r.clear, `${c.id}@${dpr}`).toBeGreaterThan(1000);
      }
    }
  });

  it('an arrow left unmirrored in rtl misses Chrome', () => {
    for (const dpr of DPRS) expect(arrowPixels('controls-select-button-rtl', dpr, true).wrong.length, `@${dpr}`).toBeGreaterThan(0);
  });

  it('fits the arrow to a border box too short or narrow for it, and keeps the 2 device px stroke at every zoom', () => {
    const shape = (h: number, w: number): number[] => menuListArrow(0, 0, w, h, 1, 1, 30, 15, false).shape.segments.flatMap((s) => (s.kind === 'move' || s.kind === 'line' ? [s.x, s.y] : []));
    expect(shape(28, 200)).toEqual([176, 10, 184, 18, 192, 10]);
    expect(shape(6, 200)).toEqual([178, 0, 184, 6, 190, 0]);
    expect(shape(28, 20)).toEqual([-2, 11, 4, 17, 10, 11]);
    expect(menuListArrow(0, 0, 200, 28, 1, 1, 60, 15, false).strokeWidth).toBe(2);
  });
});

describe('FORM-b select S3: the native hosts', () => {
  const spec = FIXTURES.find((f) => f.id === 'controls-select-button');
  if (spec === undefined) throw new Error('no controls-select-button fixture');
  const cases = casesOf(spec, fixtureInput(spec));
  const programsOf = (c: (typeof cases)[number]): ReturnType<typeof dragon.nativePrograms> & { kind: 'ready' } => {
    const p = dragon.nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
    if (p.kind !== 'ready') throw new Error(`${c.id}: ${p.reason}`);
    return p;
  };

  it("emits the arrow in the engine's own paint output, the arrow proven against Chrome's pixels, at every DPR", () => {
    let n = 0;
    for (const c of cases) {
      const program = programsOf(c).programs.uikit;
      for (const dpr of [1, ...DPRS]) {
        const input = dragon.programInput(program, c.environment.viewport, dpr);
        const r = engineLayout(input, ahemMeasurer);
        if (r.kind !== 'ok') throw new Error(`${c.id}@${dpr}: ${r.unsupported.code}`);
        const ours = menuListArrows(input, r.boxes, ahemMeasurer);
        expect(ours, `${c.id}@${dpr}`).toEqual(selectArrows(program, caseBoxes(program, c.environment.viewport, dpr), dpr));
        n += ours.length;
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it('compiles for iOS and Android with no lane-only native refusal, one arrow write per select in its colour', () => {
    for (const c of cases) {
      const compiled = nativeCompile(spec, c.environment.direction);
      expect(errors(compiled), c.id).toEqual([]);
      expect(dragon.laneOnlyNative(compiled, 'ios'), c.id).toBe(false);
      expect(dragon.laneOnlyNative(compiled, 'android'), c.id).toBe(false);
      const colors = dragon.resolvedColors(compiled, c.assignment);
      if (colors === null) throw new Error(`${c.id}: no resolved colours`);
      const p = programsOf(c);
      for (const program of [p.programs.uikit, p.programs['android-views']]) {
        const arrows = program.nodes.flatMap((node) => node.writes.flatMap((w) => (w.kind === 'select-arrow' ? [{ id: node.id, w }] : [])));
        const selects: string[] = [];
        const walk = (b: LayoutBox | ControlBox): void => {
          if (b.kind === 'control' && b.control.kind === 'select-menulist' && b.control.arrowWidth > 0) selects.push(b.id);
          for (const k of b.children) if (k.kind === 'box' || k.kind === 'control') walk(k);
        };
        walk(program.root);
        expect(arrows.map((a) => a.id), `${c.id} ${program.backend}`).toEqual(selects);
        expect(arrows.length, `${c.id} ${program.backend}`).toBeGreaterThan(5);
        for (const { id, w } of arrows) {
          if (w.kind !== 'select-arrow') throw new Error('not an arrow write');
          const want = colors.get(id)?.color;
          expect({ r: w.color.r, g: w.color.g, b: w.color.b, alpha: w.color.alpha }, `${c.id} ${id}`).toEqual(want === undefined ? null : { r: want.r, g: want.g, b: want.b, alpha: want.alpha });
          expect(w.key).toBe('dragonSelectArrow');
        }
      }
    }
  });

  it("projects each arrow's path, 2 device px stroke and colour into the expected dump, relative to the select's snapped box", () => {
    const engine = expectedEngine();
    for (const c of cases) {
      const p = programsOf(c);
      for (const program of [p.programs.uikit, p.programs['android-views']]) {
        for (const dpr of DPRS) {
          const dump = dragon.expectedDump(program, c.id, c.environment.viewport, dpr, engine);
          const input = dragon.programInput(program, c.environment.viewport, dpr);
          const r = engine.layout(input, engine.measurer);
          if (r.kind !== 'ok') throw new Error(`${c.id}@${dpr}: refused`);
          const boxes = new Map(snapEdges(r.boxes).map((b) => [b.id, b]));
          const arrows = menuListArrows(input, r.boxes, engine.measurer);
          const byId = new Map(dump.nodes.map((node) => [node.id, node]));
          for (const a of arrows) {
            const box = boxes.get(a.id);
            const node = byId.get(a.id);
            if (box === undefined || node === undefined) throw new Error(`${c.id}@${dpr}: ${a.id} has no box or dump node`);
            const path = a.arrow.shape.segments.flatMap((g) => (g.kind === 'move' || g.kind === 'line' ? [g.kind === 'move' ? 0 : 1, g.x - box.left, g.y - box.top] : [Number.NaN]));
            const applied = node.applied['dragonSelectArrow'] as { path: number[]; stroke: number; color: number[] } | undefined;
            expect(applied?.path, `${c.id} ${program.backend}@${dpr} ${a.id}`).toEqual(path);
            expect(applied?.stroke).toBe(2);
          }
          expect(dump.nodes.filter((node) => node.applied['dragonSelectArrow'] !== undefined).length, `${c.id} ${program.backend}@${dpr}`).toBe(arrows.length);
        }
      }
    }
  });
});

/** The program's tree with every box's direction flipped, so an rtl select places its arrow as ltr does (the arrow-unmirrored plant). */
function flipDirections<T extends LayoutBox | ControlBox>(b: T): T {
  return { ...b, style: { ...b.style, direction: b.style.direction === 'rtl' ? 'ltr' : 'rtl' }, children: b.children.map((c) => (c.kind === 'box' || c.kind === 'control' ? flipDirections(c) : c)) };
}
