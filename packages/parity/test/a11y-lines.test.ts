// P6b (notes/T046-paint-spec.md §5.6, T076): per-line accessibility for Dragon-drawn text. For each document the lines native
// exposes (packages/parity/src/ax-lines.ts axLinesOf, from the engine's layout of the document compiled for native) must be Chrome's
// InlineTextBoxes: the same text nodes in tree order, the same names, and frames on the same px.
import { describe, expect, it } from 'vitest';
import type { NativeProgram } from 'dragon';
import { createProjectWith, nativePrograms, NO_FAULTS } from 'dragon';
import type { AxLine } from '../src/ax-lines.ts';
import { axLinesOfProgram, checkAccessibleLines, chromeAxLines, exposedAsModelled } from '../src/ax-lines.ts';
import type { NativeDump } from '../src/native-dump.ts';
import { launchChrome, openPage } from '../src/chrome.ts';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { referenceMeasurer } from '../src/native-host.ts';

type AxDoc = { readonly id: string; readonly css: string; readonly body: string };

const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; line-height: 20px; } div, p { width: 60px; margin: 0; }';
const axHtml = (d: AxDoc): string => `<!DOCTYPE html><html data-dragon-id="html"><head><style>${BASE} ${d.css}</style></head><body data-dragon-id="body">${d.body}</body></html>`;

// Soft wraps and hanging spaces, an anonymous box around text before a block, padding, borders and margins, paragraphs and an
// empty block, line metrics and alignment, user-select none (still exposed), text split by inline boxes, and hidden text (in a
// visible block too), which neither exposes; lines a <br> ends (no hanging space) and preserved line feeds; and text-overflow:
// ellipsis, whose truncated leaf is exposed whole.
const AX_DOCS: readonly AxDoc[] = [
  { id: 'nested', css: '', body: '<div data-dragon-id="a">AAAA AAAA AAAA<div data-dragon-id="b">BB BBBB</div></div><div data-dragon-id="d">DDDD</div>' },
  {
    id: 'gaps',
    css: '.a { margin-bottom: 30px; padding-bottom: 10px; } .b { padding-top: 25px; border-top: 5px solid; } .d { margin-top: 10px; }',
    body: '<div data-dragon-id="a" class="a">AAAA AAAA</div><div data-dragon-id="b" class="b">BBBB BB</div><div data-dragon-id="d" class="d"> DDDD DD </div>',
  },
  {
    id: 'paragraphs',
    css: '.e { height: 20px; }',
    body: '<p data-dragon-id="a">AAAA</p><div data-dragon-id="b">BBBB</div><div data-dragon-id="e" class="e"></div><p data-dragon-id="c">CC CC</p><div data-dragon-id="d">DDDD</div>',
  },
  {
    id: 'metrics',
    css: '.a { font-size: 20px; line-height: normal; width: 100px; } .b { text-align: center; } .c { text-align: right; text-indent: 15px; } .d { letter-spacing: 3px; }',
    body: '<div data-dragon-id="a" class="a">AAA AA</div><div data-dragon-id="b" class="b">BB B</div><div data-dragon-id="c" class="c">CCCC CC</div><div data-dragon-id="d" class="d">DDD DD</div>',
  },
  {
    id: 'none',
    css: '.n { user-select: none; }',
    body: '<div data-dragon-id="a">AAAA AAAA</div><div data-dragon-id="b" class="n">BBBB BBBB<div data-dragon-id="c">CC</div></div><div data-dragon-id="d">DD DD</div><div data-dragon-id="e" class="n">EEEE</div>',
  },
  { id: 'inline', css: '', body: '<div data-dragon-id="a">AA <span data-dragon-id="s">BB BB</span> CC CC</div><div data-dragon-id="b">D<b data-dragon-id="e">EE</b>DD DDDD</div>' },
  // Headings of every level, text in an inline box and in a block under one, and text after one.
  {
    id: 'headings',
    css: 'h1, h2, h3, h4, h5, h6 { font-size: 10px; margin: 0; font-weight: normal; }',
    body: '<h1 data-dragon-id="a">AA <b data-dragon-id="b">BB</b></h1><h2 data-dragon-id="c">CC</h2><h3 data-dragon-id="d">DD<div data-dragon-id="e">EE EE</div></h3><h4 data-dragon-id="f">FF</h4><h5 data-dragon-id="g">GG</h5><h6 data-dragon-id="h">HH</h6><div data-dragon-id="i">II</div>',
  },
  // Boxes placed against DOM order (a reversed flex column, a box moved up over the one before it): Chrome reads in DOM order,
  // as native does (DragonRootView's accessibilityElements, Android's traversal-after chain), not by position.
  {
    id: 'order',
    css: '.f { display: flex; flex-direction: column-reverse; } .m { position: relative; top: -40px; }',
    body: '<div data-dragon-id="a" class="f"><div data-dragon-id="b">BB</div><div data-dragon-id="c">CC</div></div><div data-dragon-id="d">DD</div><div data-dragon-id="e" class="m">EE</div>',
  },
  // role and aria-level over the tag (lower/paint/role.ts headingOf): an h1 to h6 in each role it may take instead of heading (read as
  // plain text) and in role heading, aria-level on an h2, role heading on a div with and without aria-level (2 by default), and a
  // role list whose first token is not heading.
  {
    id: 'roles',
    css: 'h1, h2, h3, h4, h5, h6 { font-size: 10px; margin: 0; font-weight: normal; }',
    body: '<h1 data-dragon-id="a" role="note">AA</h1><h2 data-dragon-id="b" aria-level="4">BB</h2><div data-dragon-id="c" role="heading">CC</div><div data-dragon-id="d" role="heading" aria-level="5">DD</div><h3 data-dragon-id="e" role="group">EE</h3><h4 data-dragon-id="f" role="heading">FF</h4><h5 data-dragon-id="g" role="generic">GG</h5><h6 data-dragon-id="h" role="paragraph">HH</h6><h1 data-dragon-id="i" role="article">II</h1><div data-dragon-id="j" role="note heading">JJ</div>',
  },
  {
    id: 'hidden',
    css: '.h { visibility: hidden; } .v { visibility: visible; }',
    body: '<div data-dragon-id="a">AAAA</div><div data-dragon-id="b" class="h">BBBB<div data-dragon-id="c" class="v">CCCC</div></div><div data-dragon-id="d">DDDD</div>',
  },
  {
    id: 'breaks',
    css: '.l { white-space: pre-line; } .w { white-space: pre-wrap; }',
    body: '<div data-dragon-id="a">AA <br data-dragon-id="r1">BB  <br data-dragon-id="r2">CC</div><div data-dragon-id="b">DD DD <span data-dragon-id="s">EE </span><br data-dragon-id="r3">FF</div><div data-dragon-id="c" class="l">GG \nHH</div><div data-dragon-id="d" class="w">II  \nJJ</div>',
  },
  {
    id: 'ellipsis',
    css: '.t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    body: '<div data-dragon-id="a" class="t">AAAA AAAA AAAA</div><div data-dragon-id="b">BB BB</div><div data-dragon-id="c" class="t">CC</div>',
  },
];

function nativeProgram(d: AxDoc): NativeProgram {
  const project = createProjectWith(
    { projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } },
    { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: 'darwin-arm64', rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport },
  );
  const compiled = project.compile(fixtureToInput(`a11y-${d.id}`, axHtml(d)));
  const errors = compiled.diagnostics.filter((x) => x.severity === 'error');
  if (errors.length > 0) throw new Error(`${d.id} does not compile: ${errors.map((x) => x.message).join('; ')}`);
  const p = nativePrograms(compiled, []);
  if (p.kind !== 'ready') throw new Error(`${d.id}: no native programs: ${p.reason}`);
  return p.programs.uikit;
}

// A whole line (a truncated leaf, exposed as one element) compares by name: Chrome's StaticText has no fragment of its own.
const show = (l: AxLine): string => `${l.leaf} ${JSON.stringify(l.name)} ${l.whole === true ? 'whole' : l.rect.join(',')}${l.heading > 0 ? ` h${l.heading}` : ''}`;

describe('per-line accessibility (P6b): native lines against Chrome InlineTextBoxes', () => {
  it('names and frames every line as Chrome does', async () => {
    const browser = await launchChrome();
    const problems: string[] = [];
    let lines = 0;
    try {
      for (const d of AX_DOCS) {
        const modelLines = axLinesOfProgram(nativeProgram(d), ENVIRONMENT.viewport, 1, referenceMeasurer);
        const whole = new Set(modelLines.filter((l) => l.whole === true).map((l) => l.leaf));
        const model = modelLines.map(show);
        const chrome = (await chromeAxLines(await openPage(browser, axHtml(d), ENVIRONMENT), whole)).map(show);
        lines += chrome.length;
        if (model.join('\n') !== chrome.join('\n')) problems.push(`${d.id}:\n  Chrome ${chrome.join('\n         ')}\n  model  ${model.join('\n         ')}`);
      }
    } finally {
      await browser.close();
    }
    expect(problems).toEqual([]);
    expect(lines).toBeGreaterThan(30);
  }, 120_000);
});

describe('headings Dragon cannot prove (P6b)', () => {
  it('refuses another role on h1 to h6, a role list with heading after a role it does not know, and aria-level outside 1 to 6', () => {
    const refused = (body: string): string[] => {
      const project = createProjectWith(
        { projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } },
        { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: 'darwin-arm64', rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport },
      );
      return project.compile(fixtureToInput('a11y-refused', axHtml({ id: 'refused', css: '', body }))).diagnostics.filter((x) => x.code === 'DRAGON_UNSUPPORTED_ATTRIBUTE').map((x) => x.message);
    };
    expect(refused('<h1 data-dragon-id="a" role="button">AA</h1>')).toEqual(['a: role "button" on <h1> is not proven against Chrome\'s accessibility tree (a heading takes heading or one of note, group, generic, paragraph, article)']);
    expect(refused('<h2 data-dragon-id="a" role="none">AA</h2>')).toHaveLength(1);
    // An unnamed region on an h4 stays a heading in Chrome.
    expect(refused('<h4 data-dragon-id="a" role="region">AA</h4>')).toHaveLength(1);
    expect(refused('<div data-dragon-id="a" role="foo heading">AA</div>')).toHaveLength(1);
    expect(refused('<h3 data-dragon-id="a" aria-level="7">AA</h3>')).toEqual(['a: aria-level "7" on the heading <h3> is not a level 1 to 6']);
    expect(refused('<div data-dragon-id="a" role="heading" aria-level="x">AA</div>')).toHaveLength(1);
    // Not headings, or proven: no refusal.
    expect(refused('<div data-dragon-id="a" role="button" aria-level="9">AA</div><h4 data-dragon-id="b" role="note" aria-level="9">BB</h4>')).toEqual([]);
  });
});

describe('the device-lines accessibility check (P6b)', () => {
  const frame = { x: 10, y: 20, width: 40, height: 10 };
  const edges = { left: 20, top: 40, right: 100, bottom: 60 };
  type Accessible = { name: string; heading: number; frame: typeof frame } | null;
  const el = (name: string, heading = 0, f = frame): Accessible => ({ name, heading, frame: f });
  const line = (start: number, end: number, accessible: Accessible) => ({ frame, deviceEdges: edges, baseline: 8, start, end, accessible });
  const node = (id: string, lines: ReturnType<typeof line>[], accessible: Accessible = null) => ({ id, parent: 'a', kind: 'text', native: 'DragonTextView', frame, deviceEdges: edges, applied: {}, lines, accessible });
  const dump = (order: readonly string[], ...texts: ReturnType<typeof node>[]): NativeDump =>
    ({ case: { id: 'ax', dpr: 2 }, nodes: [...texts, { id: 'a', parent: null, kind: 'element', native: 'DragonBoxView', frame, deviceEdges: edges, applied: {}, lines: [line(0, 0, null)], accessible: null }], accessibleOrder: order }) as unknown as NativeDump;
  const rect = [0, 0, 0, 0] as const;
  // a:text0 wraps with a hanging space; b:text0, under an h2, ends its first line at a <br> (no space in the name); c:text0 is
  // truncated (whole); h:text0 is hidden (no lines in the model).
  const model: AxLine[] = [
    { leaf: 'a:text0', name: 'AAAA ', rect, heading: 0 },
    { leaf: 'a:text0', name: 'BB', rect, heading: 0 },
    { leaf: 'b:text0', name: 'CC', rect, heading: 2 },
    { leaf: 'b:text0', name: 'DD', rect, heading: 2 },
    { leaf: 'c:text0', name: 'EEEE EEEE', rect, heading: 0, whole: true },
  ];
  const ORDER = ['a:text0', 'b:text0', 'c:text0'];
  // A device frame may be off the line's by up to a device px (x by a quarter of a css px at DPR 2, here). The reading order may
  // hold other views (a control, a web view), which the check passes over.
  const good = (off = 0.25, order: readonly string[] = ['a', ...ORDER, 'f::foreign']): NativeDump =>
    dump(
      order,
      node('a:text0', [line(0, 5, el('AAAA ')), line(5, 7, el('BB', 0, { ...frame, x: 10 + off }))]),
      node('b:text0', [line(0, 3, el('CC', 1)), line(3, 5, el('DD', 1))]),
      node('c:text0', [line(0, 9, null), line(0, 4, null)], el('EEEE EEEE')),
      node('h:text0', [line(0, 2, null)]),
    );
  it("passes lines named and marked as the model's (a hanging space kept, none before a <br>), a whole leaf's view, hidden text with no element, DOM order", () => {
    expect(checkAccessibleLines(good(), model)).toEqual({ compared: 6, problems: [] });
  });
  it('writes what it passes for a made-up device dump (exposedAsModelled)', () => {
    const bare = dump([], ...good().nodes.filter((n) => n.kind === 'text').map((n) => node(n.id, n.lines.map((l) => line(l.start ?? 0, l.end ?? 0, null)))));
    expect(exposedAsModelled(bare, model)).toEqual(good(0, ORDER));
  });
  it("catches a dropped line, a wrong name or heading mark, a frame off by more than a device px, a whole leaf's line element or missing view element, exposed hidden text, and another reading order", () => {
    const r = checkAccessibleLines(
      dump(
        ['b:text0', 'a:text0', 'c:text0'],
        node('a:text0', [line(0, 5, null), line(5, 7, el('BB', 1, { ...frame, width: 41 }))]),
        node('b:text0', [line(0, 3, el('CC ', 1)), line(3, 5, el('DD'))], el('CC DD')),
        node('c:text0', [line(0, 9, null), line(0, 4, el('EEEE'))]),
        node('h:text0', [line(0, 2, el('HH'))]),
      ),
      model,
    );
    expect(r.problems.map((p) => p.detail)).toEqual([
      'a:text0:line0: no accessibility element exposes the line',
      'a:text0:line1: read as a heading, but the model has it under none',
      'a:text0:line1: accessibility frame edge delta [0,0,1,0] css px exceeds 1 device px',
      'b:text0: the view is an accessibility element itself, named "CC DD"',
      'b:text0:line0: named "CC ", expected "CC"',
      'b:text0:line1: not read as a heading, but the model has it under an h2',
      'c:text0:line1: the leaf is exposed whole, but an element exposes the line',
      'c:text0: the leaf is exposed whole, but the view is not an accessibility element',
      "h:text0:line0: the model exposes none of this text (hidden, or a marker's), but an element exposes the line",
      'reading order: the screen reader reads ["b:text0","a:text0","c:text0"], the model (DOM order) ["a:text0","b:text0","c:text0"]',
    ]);
  });
});
