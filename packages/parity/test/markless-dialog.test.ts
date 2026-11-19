// A <dialog> in a Markless style input: the host shows it with showModal(), so the export lays it out shown, and Chrome's
// reference document shows it the same way, so the dialog and its contents are compared, open attribute or not.
import { describe, expect, it } from 'vitest';
import { compareMarklessExport, marklessDocumentHtml } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';

const input = (dialogAttributes: Record<string, string>) => JSON.stringify({
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
  css: '.page { padding: 20px; } .box { padding: 12px; border: 4px solid rgb(51, 51, 51); border-radius: 0; } .keep { padding: 4px; background: rgb(221, 221, 221); }',
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
        expect(ids).toEqual(expect.arrayContaining(['h2', 'h3', 'h3:text0', 'h4', 'h4:text0']));
      }
      expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    }, 120_000);
  }

  it('leaves the open attribute off the reference dialog, which showModal() opens', () => {
    const html = marklessDocumentHtml(parseMarklessStyleInput(input({ open: '' })), {});
    expect(html).toContain('<dialog data-dragon-id="h2" class="box">');
    expect(html).toContain('e.showModal()');
  });
});
