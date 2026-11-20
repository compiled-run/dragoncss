// :link and :visited on a Markless page: a phone has no visited history, so every link is unvisited, as in a fresh Chrome profile.
// Dragon refuses them for its own web output only, which the Markless export does not carry.
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';

const input = JSON.stringify({
  version: 'markless.native-style-input/0',
  component: 'Links',
  nodes: [
    { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: { class: 'page' } },
    { kind: 'element', id: 'h1', element: 'a', parent: 'h0', attributes: { href: '/next' } },
    { kind: 'text', id: 't1', parent: 'h1', text: 'Next page' },
    { kind: 'element', id: 'h2', element: 'p', parent: 'h0', attributes: { class: 'foot' } },
    { kind: 'element', id: 'h3', element: 'a', parent: 'h2', attributes: { href: '/faq' } },
    { kind: 'text', id: 't3', parent: 'h3', text: 'FAQ' },
  ],
  css: '.page { padding: 16px; } a:link { color: rgb(0, 0, 200); text-decoration: none; } a:visited { color: rgb(120, 0, 120); } .foot a:link, .foot a:visited { color: rgb(200, 0, 0); text-decoration: none; }',
  states: [],
});

describe(':link and :visited on a Markless page', () => {
  it('exports with every link unvisited, every box and colour as Chrome draws them, on both targets', async () => {
    const { exported } = marklessStyleExport(input, 'links.json');
    for (const t of ['ios', 'android'] as const) {
      const nodes = new Map(exported.targets[t]!.assignments[0]!.nodes.map((n) => [n.id, n]));
      const color = (id: string) => (nodes.get(id)!.writes.find((w) => w['kind'] === 'text-color') as { color: unknown } | undefined)?.color;
      expect(color('t1'), t).toEqual({ r: 0, g: 0, b: 200, alpha: 255 });
      expect(color('t3'), t).toEqual({ r: 200, g: 0, b: 0, alpha: 255 });
    }
    const report = await compareMarklessExport(parseMarklessStyleInput(input), exported, undefined, 'light', [], null, null, []);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    expect(report.compared).toBeGreaterThan(0);
  });
});
