// <output>, as @markless/ui pad's value label renders it: an inline box whose only UA rule is unicode-bidi: isolate, laid out on both
// phone targets as Chrome lays it out (its rtl refusal is in packages/dragon/test/unicode-bidi.test.ts).
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';

const PATH = 'markless-output.native-style-input.json';
const input = (text: string) => ({
  version: 'markless.native-style-input/0',
  component: 'App',
  nodes: [
    { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} },
    { kind: 'element', id: 'h1', element: 'p', parent: 'h0', attributes: { class: 'w' } },
    { kind: 'text', id: 't0', parent: 'h1', text: 'Value ' },
    { kind: 'element', id: 'h2', element: 'output', parent: 'h1', attributes: { class: 'v' } },
    { kind: 'text', id: 't1', parent: 'h2', text },
    { kind: 'text', id: 't2', parent: 'h1', text: ' units' },
    { kind: 'element', id: 'h3', element: 'output', parent: 'h0', attributes: { class: 'b' } },
    { kind: 'text', id: 't3', parent: 'h3', text: 'Block output' },
  ],
  css: '.w { width: 120px; font-size: 16px; } .v { color: rgb(30 90 200); font-size: 20px; } .b { display: block; width: 90px; background: rgb(237 242 244); }',
  states: [],
});

describe('<output> in a Markless style input', () => {
  it('lays out as Chrome does on both targets, inline and as a block', async () => {
    const text = JSON.stringify(input('0.25, 0.75'));
    const r = await compareMarklessExport(parseMarklessStyleInput(text), marklessStyleExport(text, PATH).exported);
    expect(r.rows.filter((row) => !row.pass)).toEqual([]);
    expect(r.compared).toBeGreaterThan(8);
  }, 180_000);
});
