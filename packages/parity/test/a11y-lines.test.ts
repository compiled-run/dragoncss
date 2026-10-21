// P6b (notes/T046-paint-spec.md §5.6, T076): per-line accessibility for Dragon-drawn text. For each document the lines native
// exposes (packages/parity/src/ax-lines.ts axLinesOf, from the engine's layout of the document compiled for native) must be Chrome's
// InlineTextBoxes: the same text nodes in tree order, the same names, and frames on the same px.
import { describe, expect, it } from 'vitest';
import { createProjectWith, nativePrograms, NO_FAULTS, programInput } from 'dragon';
import type { LayoutInput } from '../../layout/src/input.ts';
import type { AxLine } from '../src/ax-lines.ts';
import { axLinesOf, chromeAxLines } from '../src/ax-lines.ts';
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

function nativeInput(d: AxDoc): { readonly input: LayoutInput; readonly hidden: readonly string[] } {
  const project = createProjectWith(
    { projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } },
    { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: 'darwin-arm64', rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport },
  );
  const compiled = project.compile(fixtureToInput(`a11y-${d.id}`, axHtml(d)));
  const errors = compiled.diagnostics.filter((x) => x.severity === 'error');
  if (errors.length > 0) throw new Error(`${d.id} does not compile: ${errors.map((x) => x.message).join('; ')}`);
  const p = nativePrograms(compiled, []);
  if (p.kind !== 'ready') throw new Error(`${d.id}: no native programs: ${p.reason}`);
  const hidden = p.programs.uikit.nodes.filter((n) => n.writes.some((w) => w.kind === 'visibility')).map((n) => n.id);
  return { input: programInput(p.programs.uikit, ENVIRONMENT.viewport, 1), hidden };
}

// A whole line (a truncated leaf, exposed as one element) compares by name: Chrome's StaticText has no fragment of its own.
const show = (l: AxLine): string => `${l.leaf} ${JSON.stringify(l.name)} ${l.whole === true ? 'whole' : l.rect.join(',')}`;

describe('per-line accessibility (P6b): native lines against Chrome InlineTextBoxes', () => {
  it('names and frames every line as Chrome does', async () => {
    const browser = await launchChrome();
    const problems: string[] = [];
    let lines = 0;
    try {
      for (const d of AX_DOCS) {
        const n = nativeInput(d);
        const modelLines = axLinesOf(n.input, referenceMeasurer(), n.hidden);
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
