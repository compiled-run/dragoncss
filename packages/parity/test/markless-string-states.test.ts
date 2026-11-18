// A state that is not true/false: the selected value of @markless/ui tabs ('a', 'b' or 'c'), read by [ui-selected] and [hidden].
// The input is the one @markless/mobile writes for the u15 tabs rung; every frame of every assignment is compared with Chrome.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/tabs.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const cell = input.states[0]!.cell;
const edit = (f: (v: Record<string, any>) => void): string => {
  const v = JSON.parse(TEXT) as Record<string, any>;
  f(v);
  return JSON.stringify(v);
};
const elements = (role: string): string[] => input.nodes.flatMap((n) => (n.kind === 'element' && n.attributes['role'] === role ? [n.id] : []));

describe('a Markless state whose values are strings', () => {
  const { exported } = marklessStyleExport(TEXT, PATH);

  it('compiles one assignment per value, with the transition table over the value list', () => {
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t]!;
      expect(x.states).toEqual([{ key: cell, domain: ['a', 'b', 'c'] }]);
      expect(x.assignments.map((a) => a.values[cell])).toEqual(['a', 'b', 'c']);
      expect(x.initial).toBe(0);
      expect(x.next).toEqual([[[0, 1, 2]], [[0, 1, 2]], [[0, 1, 2]]]);
    }
  });

  it('shows only the selected panel and paints only the selected tab', () => {
    const tabs = elements('tab');
    const panels = elements('tabpanel');
    for (const t of ['ios', 'android'] as const) {
      for (const [k, a] of exported.targets[t]!.assignments.entries()) {
        const byId = new Map(a.nodes.map((n) => [n.id, n]));
        expect(panels.map((id) => byId.get(id)!.frame !== null)).toEqual(panels.map((_, i) => i === k));
        const bg = tabs.map((id) => byId.get(id)!.writes.find((w) => w['kind'] === 'background-color')?.['color']);
        expect(bg).toEqual(tabs.map((_, i) => (i === k ? { r: 255, g: 209, b: 102, alpha: 255 } : { r: 233, g: 236, b: 239, alpha: 255 })));
      }
    }
  });

  it('places every box of every assignment where Chrome does, within 1 device px', async () => {
    const report = await compareMarklessExport(input, exported);
    expect(report.compared).toBeGreaterThan(90);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    expect(new Set(report.rows.map((r) => r.values[cell]))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('refuses a domain that is not [false, true] or distinct strings, an initial outside it and a value outside it', () => {
    expect(() => parseMarklessStyleInput(edit((v) => { v['states'][0]['domain'] = [0, 1, 2]; }))).toThrow('a list of distinct strings');
    expect(() => parseMarklessStyleInput(edit((v) => { v['states'][0]['domain'] = ['a', 'a', 'b']; }))).toThrow('a list of distinct strings');
    expect(() => parseMarklessStyleInput(edit((v) => { v['states'][0]['domain'] = []; }))).toThrow('a list of distinct strings');
    expect(() => parseMarklessStyleInput(edit((v) => { v['states'][0]['initial'] = 'z'; }))).toThrow('initial "z" is not in its domain');
    const tab = input.nodes.findIndex((n) => n.kind === 'element' && n.attributes['role'] === 'tab');
    expect(() => parseMarklessStyleInput(edit((v) => { v['nodes'][tab]['attributesByState']['ui-selected'][0]['when'][cell] = 'z'; }))).toThrow(`names ${cell}="z"`);
  });
});
