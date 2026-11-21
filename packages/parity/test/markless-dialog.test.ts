// A <dialog> in a Markless style input: the host shows it with showModal(), so the export lays it out shown, and Chrome's
// reference document shows it the same way, so the dialog and its contents are compared, open attribute or not.
import { describe, expect, it } from 'vitest';
import { launchChrome } from '../src/chrome.ts';
import type { DocumentNode } from '../src/markless-style-compare.ts';
import { captureMarklessAssignment, compareMarklessExport, marklessBodyTree, marklessDocumentHtml, marklessDocumentTree } from '../src/markless-style-compare.ts';
import type { ExportTarget } from '../src/native-style-export.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';

const input = (dialogAttributes: Record<string, string>, backdrop = '') => JSON.stringify({
  version: 'markless.native-style-input/0',
  component: 'Confirm',
  nodes: [
    { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: { class: 'page' } },
    { kind: 'element', id: 'h1', element: 'p', parent: 'h0', attributes: {} },
    { kind: 'text', id: 'h1:text0', parent: 'h1', text: 'Page' },
    { kind: 'element', id: 'h2', element: 'dialog', parent: 'h0', attributes: { class: 'box', ...dialogAttributes } },
    { kind: 'element', id: 'h3', element: 'h2', parent: 'h2', attributes: {} },
    { kind: 'text', id: 'h3:text0', parent: 'h3', text: 'Delete it?' },
    { kind: 'element', id: 'h4', element: 'p', parent: 'h2', attributes: { class: 'keep' } },
    { kind: 'text', id: 'h4:text0', parent: 'h4', text: 'Keep' },
  ],
  css: '.page { padding: 20px; } .box { padding: 12px; border: 4px solid rgb(51, 51, 51); border-radius: 0; } .keep { padding: 4px; background: rgb(221, 221, 221); }' + backdrop,
  states: [],
});
const PATH = 'dialog.native-style-input.json';

describe('a Markless <dialog>, which the host shows modal', () => {
  for (const [name, attributes] of [['without an open attribute', {}], ['with an open attribute', { open: '' }]] as const) {
    it(`${name}: the dialog and its contents are laid out where Chrome shows them`, async () => {
      const text = input(attributes);
      const { exported } = marklessStyleExport(text, PATH);
      const report = await compareMarklessExport(parseMarklessStyleInput(text), exported);
      for (const t of ['ios', 'android']) {
        const ids = report.rows.filter((r) => r.target === t).map((r) => r.id);
        expect(ids).toEqual(expect.arrayContaining(['h2::backdrop', 'h2', 'h3', 'h3:text0', 'h4', 'h4:text0']));
      }
      expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    }, 120_000);
  }

  it('measures the ::backdrop box where Chrome lays it out, margins, padding and borders included', async () => {
    const backdrop = ' dialog::backdrop { margin: 10px 5px 3px 7px; padding: 4px; border: 3px solid blue; background: red; }';
    const text = input({}, backdrop);
    const { exported } = marklessStyleExport(text, PATH);
    const parsed = parseMarklessStyleInput(text);
    const report = await compareMarklessExport(parsed, exported);
    const rows = report.rows.filter((r) => r.id === 'h2::backdrop');
    expect(rows.map((r) => r.target).sort()).toEqual(['android', 'ios']);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    // The same export against a page whose backdrop has no margins fails: the box moved by 7 px and shrank by 12 px.
    const plain = await compareMarklessExport(parseMarklessStyleInput(input({}, ' dialog::backdrop { padding: 4px; border: 3px solid blue; background: red; }')), exported);
    expect(plain.rows.filter((r) => !r.pass).map((r) => r.id)).toEqual(['h2::backdrop', 'h2::backdrop']);
  }, 120_000);

  it('reads every box input of a ::backdrop as Chrome lays it out, at 300 x 200 CSS px', async () => {
    // Each box is Chrome's own (DOM.getBoxModel), probed on Chrome 145; a transform is set aside, as for every captured frame.
    const cases: [string, readonly [number, number, number, number]][] = [
      ['margin: 10px', [10, 10, 280, 180]],
      ['margin: 10px 5px 3px 7px; padding: 4px; border: 3px solid blue', [7, 10, 288, 187]],
      ['box-sizing: border-box; width: 100px; height: 50px; padding: 4px; border: 3px solid blue', [0, 0, 100, 50]],
      ['position: absolute; margin: 10px', [10, 10, 280, 180]],
      ['min-width: 500px; margin: 10px', [10, 10, 500, 180]],
      ['zoom: 2; margin: 10px', [20, 20, 260, 160]],
      ['transform: translateX(20px); margin: 10px', [10, 10, 280, 180]],
      ['transform: translateX(20px) !important; rotate: 10deg !important; margin: 10px', [10, 10, 280, 180]],
      ['transition: transform 10s, scale 10s; transform: translateX(20px); scale: 2; margin: 10px', [10, 10, 280, 180]],
    ];
    const browser = await launchChrome(1);
    try {
      for (const [css, [x, y, width, height]] of cases) {
        const parsed = parseMarklessStyleInput(input({}, ` dialog::backdrop { ${css}; background: red; }`));
        const target = { viewport: { width: 300, height: 200 }, dpr: 1 } as ExportTarget;
        const capture = await captureMarklessAssignment(browser, parsed, target, {}, 'light');
        expect(capture.nodes.find((n) => n.id === 'h2::backdrop'), css).toMatchObject({ hasBox: true, x, y, width, height });
      }
      // Chrome draws no backdrop for a dialog that is not laid out.
      for (const css of [' dialog::backdrop { display: none; }', ' dialog { display: none; }']) {
        const capture = await captureMarklessAssignment(browser, parseMarklessStyleInput(input({}, css)), { viewport: { width: 300, height: 200 }, dpr: 1 } as ExportTarget, {}, 'light');
        expect(capture.nodes.find((n) => n.id === 'h2::backdrop'), css).toMatchObject({ hasBox: false });
      }
      const zoomed = parseMarklessStyleInput(input({}, ' dialog { zoom: 2; } dialog::backdrop { margin: 10px; }'));
      const capture = await captureMarklessAssignment(browser, zoomed, { viewport: { width: 300, height: 200 }, dpr: 1 } as ExportTarget, {}, 'light');
      expect(capture.nodes.find((n) => n.id === 'h2::backdrop')).toMatchObject({ x: 20, y: 20, width: 260, height: 160 });
    } finally {
      await browser.close();
    }
  }, 120_000);

  it('builds the reference dialog without its open attribute, and expects the open="" that showModal() adds', () => {
    const parsed = parseMarklessStyleInput(input({ open: '' }));
    const dialog = (nodes: readonly DocumentNode[]): DocumentNode | undefined => nodes.flatMap((n) => ('text' in n ? [] : n.attributes[0]?.[1] === 'h2' ? [n] : [dialog(n.children)].filter((d) => d !== undefined)))[0];
    expect(dialog(marklessBodyTree(parsed, {}))).toMatchObject({ element: 'dialog', attributes: [['data-dragon-id', 'h2'], ['class', 'box']] });
    expect(dialog([marklessDocumentTree(parsed, {})])).toMatchObject({ element: 'dialog', attributes: [['data-dragon-id', 'h2'], ['class', 'box'], ['open', '']] });
    expect(marklessDocumentHtml(parsed, {})).toContain('d.showModal()');
  });
});
