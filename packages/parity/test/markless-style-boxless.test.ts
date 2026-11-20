// A system sheet's content laid out with its markup ancestors present but boxless (display: contents, as a top-layer
// <dialog> keeps its ancestors for selectors and inheritance while its own box sits in the viewport), compared with Chrome.
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';

const input = (pageCss: string) => JSON.stringify({
  version: 'markless.native-style-input/0',
  component: 'Sheet',
  nodes: [
    { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: { class: 'page' }, boxless: true },
    { kind: 'element', id: 'h1', element: 'section', parent: 'h0', attributes: { class: 'shelf' }, boxless: true },
    { kind: 'element', id: 'h3', element: 'p', parent: 'h1', attributes: { class: 'city' } },
    { kind: 'text', id: 'h3:text0', parent: 'h3', text: 'Osaka' },
    { kind: 'element', id: 'h4', element: 'p', parent: 'h1', attributes: {} },
    { kind: 'text', id: 'h4:text0', parent: 'h4', text: 'Porto' },
  ],
  css: `.page { padding: 40px; display: flex; color: rgb(0, 0, 128); background: rgb(255, 0, 0); font-size: 22px; } .shelf { border: 5px solid black; } .page .city { margin: 8px 0; padding: 10px; background: rgb(255, 209, 102); } ${pageCss}`,
  states: [],
  viewports: { ios: { width: 402, height: 435 }, android: { width: 411, height: 371 } },
});
const PATH = 'boxless.native-style-input.json';

describe("a sheet's content beside boxless markup ancestors", () => {
  const text = input('');
  const { exported } = marklessStyleExport(text, PATH);

  it('inherits from the ancestors and matches selectors through them, which take no part in the layout', () => {
    for (const t of ['ios', 'android'] as const) {
      const nodes = exported.targets[t]!.assignments[0]!.nodes;
      const byId = new Map(nodes.map((n) => [n.id, n]));
      expect(byId.has('h0')).toBe(false);
      expect(byId.has('h1')).toBe(false);
      expect(byId.get('h3')!.parent).toBe('body');
      expect(byId.get('h3')!.frame!.x).toBe(0);
      expect(byId.get('h3')!.writes.find((w) => w['kind'] === 'background-color')!['color']).toEqual({ r: 255, g: 209, b: 102, alpha: 255 });
      expect(byId.get('h4:text0')!.writes.find((w) => w['kind'] === 'text-color')!['color']).toEqual({ r: 0, g: 0, b: 128, alpha: 255 });
    }
  });

  it("lays the content out as Chrome does, at the sheet's size", async () => {
    const report = await compareMarklessExport(parseMarklessStyleInput(text), exported);
    expect(report.compared).toBeGreaterThan(0);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
  }, 120_000);

  it('lays out what a boxless element holds when it also carries hidden, fixed or by state, as display: contents !important wins', async () => {
    for (const hidden of [{ attributes: { class: 'shelf', hidden: '' } }, { attributes: { class: 'shelf' }, attributesByState: { hidden: [{ when: { 'state:on': false }, value: null }, { when: { 'state:on': true }, value: '' }] } }]) {
      const v = JSON.parse(text) as { nodes: Record<string, unknown>[]; states: unknown[] };
      Object.assign(v.nodes[1]!, hidden);
      v.states = [{ cell: 'state:on', domain: [false, true], initial: false }];
      const hiddenText = JSON.stringify(v);
      const { exported: e } = marklessStyleExport(hiddenText, PATH);
      for (const t of ['ios', 'android'] as const) {
        for (const a of e.targets[t]!.assignments) {
          const byId = new Map(a.nodes.map((n) => [n.id, n]));
          expect(byId.has('h1')).toBe(false);
          expect(byId.get('h3')!.frame).not.toBeNull();
          expect(byId.get('h4:text0')!.frame).not.toBeNull();
        }
      }
      const report = await compareMarklessExport(parseMarklessStyleInput(hiddenText), e);
      expect(report.rows.map((r) => r.id)).toEqual(expect.arrayContaining(['h3', 'h4:text0']));
      expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    }
  }, 120_000);

  it('names what a boxless element inside a hidden one holds with no frame, and the boxless element with no node', async () => {
    const hiddenText = JSON.stringify({
      version: 'markless.native-style-input/0',
      component: 'Sheet',
      nodes: [
        { kind: 'element', id: 'h0', element: 'div', parent: null, attributes: { hidden: '' } },
        { kind: 'element', id: 'h1', element: 'section', parent: 'h0', attributes: {}, boxless: true },
        { kind: 'element', id: 'h2', element: 'p', parent: 'h1', attributes: {} },
        { kind: 'text', id: 'h2:text0', parent: 'h2', text: 'Gone' },
        { kind: 'element', id: 'h3', element: 'p', parent: null, attributes: {} },
        { kind: 'text', id: 'h3:text0', parent: 'h3', text: 'Shown' },
      ],
      css: 'p { margin: 0; }',
      states: [],
    });
    const { exported: e } = marklessStyleExport(hiddenText, PATH);
    for (const t of ['ios', 'android'] as const) {
      const nodes = e.targets[t]!.assignments[0]!.nodes;
      expect(nodes.filter((n) => n.frame === null).map((n) => [n.id, n.parent])).toEqual([['h0', 'body'], ['h2', 'h0'], ['h2:text0', 'h2']]);
      expect(nodes.some((n) => n.id === 'h1')).toBe(false);
    }
    const report = await compareMarklessExport(parseMarklessStyleInput(hiddenText), e);
    expect(report.rows.map((r) => r.id)).toEqual(expect.arrayContaining(['h3', 'h3:text0']));
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
  }, 120_000);

  it("refuses by name an ancestor whose own CSS gives it a box", () => {
    expect(() => marklessStyleExport(input('.shelf { display: block !important; }'), PATH)).toThrow('h1 must generate no box');
  });

  it('refuses a boxless flag that is not true, and the reserved attribute', () => {
    const bad = (patch: (n: Record<string, unknown>) => void): string => {
      const v = JSON.parse(text) as { nodes: Record<string, unknown>[] };
      patch(v.nodes[0]!);
      return JSON.stringify(v);
    };
    expect(() => marklessStyleExport(bad((n) => { n['boxless'] = false; }), PATH)).toThrow('h0: boxless is true or absent');
    expect(() => marklessStyleExport(bad((n) => { n['attributes'] = { 'data-markless-boxless': '' }; }), PATH)).toThrow("data-markless-boxless is Dragon's own attribute");
    expect(() => marklessStyleExport(bad((n) => { n['attributesByState'] = { 'data-markless-boxless': [] }; }), PATH)).toThrow("data-markless-boxless is Dragon's own attribute");
  });
});
