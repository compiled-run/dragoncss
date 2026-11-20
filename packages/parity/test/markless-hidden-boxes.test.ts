// A node the export gives no box: only an element its hidden attribute or a style state hides in that assignment (and what it holds)
// is named with no frame; any other missing node fails the export, and the web column fails a node one side draws and the other does not,
// whether the other side is the export or a phone.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authoredFontHtml } from '../src/cases.ts';
import { captureFixture } from '../src/capture.ts';
import { launchChrome } from '../src/chrome.ts';
import { FONT_REFERENCE_MAP, fontReferencePrepare } from '../src/font-reference.ts';
import { compareMarklessExport, marklessDocumentHtml } from '../src/markless-style-compare.ts';
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

  it('names an element its fixed hidden attribute hides, and what it holds, with no frame, as Chrome gives them no box', async () => {
    const text = JSON.stringify({
      version: 'markless.native-style-input/0',
      component: 'Fixed',
      nodes: [
        { kind: 'element', id: 'h0', element: 'div', parent: null, attributes: {} },
        { kind: 'element', id: 'h1', element: 'p', parent: 'h0', attributes: { hidden: '' } },
        { kind: 'text', id: 'h1:text0', parent: 'h1', text: 'Gone' },
        { kind: 'element', id: 'h2', element: 'p', parent: 'h0', attributes: {} },
        { kind: 'text', id: 'h2:text0', parent: 'h2', text: 'Shown' },
      ],
      css: 'p { margin: 0; }',
      states: [],
    });
    const { exported } = marklessStyleExport(text, 'fixed-hidden.json');
    for (const t of ['ios', 'android'] as const) {
      const nodes = exported.targets[t]!.assignments[0]!.nodes;
      expect(nodes.filter((n) => n.frame === null).map((n) => [n.id, n.parent])).toEqual([['h1', 'h0'], ['h1:text0', 'h1']]);
    }
    const r = await compareMarklessExport(parseMarklessStyleInput(text), exported);
    expect(r.rows.filter((x) => !x.pass)).toEqual([]);
    expect(r.rows.map((x) => x.id)).toEqual(expect.arrayContaining(['h2', 'h2:text0']));
  }, 60_000);

  it('fails the web column on a node the browser draws and the export does not, and the other way', () => {
    const { exported } = marklessStyleExport(TEXT, PATH);
    const a = exported.targets.ios!.assignments[0]!;
    const shown = a.nodes.find((n) => panels.includes(n.id) && n.frame !== null)!;
    const hidden = a.nodes.find((n) => panels.includes(n.id) && n.frame === null)!;
    const box = (id: string, hasBox: boolean) => ({ id, kind: 'element' as const, hasBox, x: 0, y: 0, width: 10, height: 10, computed: null });
    expect(() => webColumnRows(input, 'ios', 3, a, [box(hidden.id, true)], 0)).toThrow(`ios assignment 0: ${hidden.id} has a box in the browser and no frame in the export`);
    expect(() => webColumnRows(input, 'ios', 3, a, [box(shown.id, false)], 0)).toThrow(`ios assignment 0: ${shown.id} has a frame in the export and no box in the browser`);
  });

  it('fails the phone check on a box the phone draws for a node the browser does not lay out, and takes an empty one', () => {
    const path = 'examples/markless-styles/input/width-media.native-style-input.json';
    const media = parseMarklessStyleInput(readFileSync(repoPath(path), 'utf8'));
    const t = marklessStyleExport(readFileSync(repoPath(path), 'utf8'), path, undefined, 'system').exported.targets.ios!;
    const k = t.bands!.conditions.findIndex((c) => c.endsWith('(not (orientation: landscape))'));
    const a = t.assignments[k]!;
    expect(a.nodes.find((n) => n.id === 'h7')!.frame).toBeNull();
    const ids = new Set(media.nodes.map((n) => n.id));
    const page = ['html', 'body'].map((id) => ({ id, kind: 'element' as const, hasBox: true, x: 0, y: 0, width: 10, height: 10, computed: null }));
    const measured = [...page, ...media.nodes.map((n) => ({ id: n.id, kind: n.kind, hasBox: n.id !== 'h7' && n.id !== 'h7:text0', x: 0, y: 0, width: 10, height: 10, computed: null }))];
    const drawn = (h7: number) => new Map([...ids].map((id) => [id, { x: 0, y: 0, width: id.startsWith('h7') ? h7 : 10, height: id.startsWith('h7') ? h7 : 10 }]));
    const view = (h7: number) => ({ browserDpr: 3, anySize: true, phone: { boxes: drawn(h7), ids } });
    expect(() => webColumnRows(media, 'ios', 3, a, measured, k, view(20))).toThrow(`ios assignment ${k}: the phone drew a box for h7, which the browser does not lay out`);
    expect(webColumnRows(media, 'ios', 3, a, measured, k, view(0)).filter((r) => !r.pass)).toEqual([]);
    const shownH7 = measured.map((c) => (c.id === 'h7' ? { ...c, hasBox: true } : c));
    expect(() => webColumnRows(media, 'ios', 3, a, shownH7, k, view(10))).toThrow(`ios assignment ${k}: h7 has a box in the browser and no frame in the export`);
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
