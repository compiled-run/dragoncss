// FORM-b S4 in a Markless page: a select laid out at its widest option's width (the notes form's tag field, a width: 100% grid item
// with min-width: auto, as Chrome sizes it) compiles when the export lists every option, and stays refused, naming the list, when
// its options are a list's rows, whose other labels Dragon does not see. Chrome's widths are the fixture
// controls-select-natural-width; this pins the Markless side of the rule.
import { describe, expect, it } from 'vitest';
import { marklessStyleExport } from '../src/markless-style-input.ts';

type Node =
  | { kind: 'element'; id: string; element: string; parent: string | null; attributes: Record<string, string>; row?: string }
  | { kind: 'text'; id: string; parent: string; text: string; row?: string };

const CSS = 'body { margin: 0; font-family: Ahem; font-size: 10px; }\n.field { display: grid; width: 200px; }\n.field select { width: 100%; padding: 4px; border: 1px solid #333; background: #fff; font: inherit; }\n';
const head: Node[] = [
  { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} },
  { kind: 'element', id: 'h1', element: 'label', parent: 'h0', attributes: { class: 'field' } },
  { kind: 'element', id: 'h2', element: 'select', parent: 'h1', attributes: { 'aria-label': 'Tag' } },
];
const plain: Node[] = [...head, ...['Work', 'Home', 'Ideas'].flatMap((t, k): Node[] => [{ kind: 'element', id: `h3@${k}`, element: 'option', parent: 'h2', attributes: {} }, { kind: 'text', id: `h3:text0@${k}`, parent: `h3@${k}`, text: t }])];
const rows: Node[] = [...head, { kind: 'element', id: 'h3', element: 'option', parent: 'h2', attributes: {}, row: 'repeat:0' }, { kind: 'text', id: 'h3:text0', parent: 'h3', text: 'Work', row: 'repeat:0' }];
const input = (nodes: readonly Node[], repeats: boolean): string =>
  JSON.stringify({ version: 'markless.native-style-input/0', component: 'Tagging', nodes, css: CSS, states: [], ...(repeats ? { repeats: [{ id: 'repeat:0', parent: 'h2' }] } : {}) });
const refusals = (nodes: readonly Node[], repeats: boolean): string[] => {
  try {
    marklessStyleExport(input(nodes, repeats), 'select-natural-width.json');
    return [];
  } catch (e) {
    return [(e as Error).message];
  }
};

describe('a Markless select at its widest option (FORM-b S4)', () => {
  it('compiles the notes field shape when every option is listed', () => {
    expect(refusals(plain, false)).toEqual([]);
  });
  it("refuses it, naming the list, when its options are a list's rows", () => {
    const got = refusals(rows, true);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(/whose labels Dragon cannot read, as its options are rows of a list/);
  });
  it('does not let an author set the listed-options attribute', () => {
    const forged: Node[] = plain.map((n) => (n.kind === 'element' && n.element === 'select' ? { ...n, attributes: { ...n.attributes, 'data-dragon-listed-options': '' } } : n));
    expect(refusals(forged, false)[0]).toMatch(/data-dragon-listed-options is Dragon's own attribute/);
  });
});
