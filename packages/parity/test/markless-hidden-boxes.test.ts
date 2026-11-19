// A node the export gives no box: only an element its hidden attribute hides in that assignment (and what it holds) is named with
// no frame; any other missing node fails the export, and the web column fails a node one side draws and the other does not.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authoredFontHtml } from '../src/cases.ts';
import { captureFixture } from '../src/capture.ts';
import { launchChrome } from '../src/chrome.ts';
import { FONT_REFERENCE_MAP, fontReferencePrepare } from '../src/font-reference.ts';
import { marklessDocumentHtml } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { webColumnRows } from '../src/markless-web-column.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/tabs.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const panels = input.nodes.flatMap((n) => (n.kind === 'element' && n.attributes['role'] === 'tabpanel' ? [n.id] : []));

describe('a node with no box in an assignment', () => {
  it('fails the export when the node is missing where its hidden attribute is absent', () => {
    const css = (v: Record<string, unknown>): string => JSON.stringify({ ...v, css: `${String(v['css'])}\n[role="tabpanel"] { display: none; }` });
    expect(() => marklessStyleExport(css(JSON.parse(TEXT) as Record<string, unknown>), PATH)).toThrow(`the export has no node ${panels[0]}`);
  });

  it('fails the web column on a node the browser draws and the export does not, and the other way', () => {
    const { exported } = marklessStyleExport(TEXT, PATH);
    const a = exported.targets.ios!.assignments[0]!;
    const shown = a.nodes.find((n) => panels.includes(n.id) && n.frame !== null)!;
    const hidden = a.nodes.find((n) => panels.includes(n.id) && n.frame === null)!;
    const box = (id: string, hasBox: boolean) => ({ id, kind: 'element' as const, hasBox, x: 0, y: 0, width: 10, height: 10, computed: null });
    expect(() => webColumnRows(input, 'ios', 3, a, [box(hidden.id, true)], 0)).toThrow(`ios assignment 0: ${hidden.id} has a box in the browser and no frame in the export`);
    expect(() => webColumnRows(input, 'ios', 3, a, [box(shown.id, false)], 0)).toThrow(`ios assignment 0: ${shown.id} has a frame in the export and no box in the browser`);
  });

  it("agrees with Chrome on which nodes have a box in every assignment of the tabs input", async () => {
    const { exported } = marklessStyleExport(TEXT, PATH);
    const t = exported.targets.android!;
    const browser = await launchChrome(t.dpr);
    try {
      for (const [index, a] of t.assignments.entries()) {
        const capture = await captureFixture(browser, `markless-${input.component}`, authoredFontHtml(marklessDocumentHtml(input, a.values), new Map()), { viewport: t.viewport, devicePixelRatio: t.dpr, direction: 'ltr', rootFont: 'ua-default' }, [], fontReferencePrepare(FONT_REFERENCE_MAP));
        const rows = webColumnRows(input, 'android', t.dpr, a, capture.nodes, index);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.filter((r) => !r.pass)).toEqual([]);
      }
    } finally {
      await browser.close();
    }
  }, 120_000);
});
