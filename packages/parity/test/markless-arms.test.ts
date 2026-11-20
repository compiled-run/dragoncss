// Styled elements inside @if arms: each branch is a state whose value is the arm it shows, so every combination of arms is laid out.
// The input is the one @markless/mobile writes for its S20 rung; every frame of every assignment is compared with Chrome.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { armShown, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/arms.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const [details, late, step] = input.branches!.map((b) => b.id) as [string, string, string];
const edit = (f: (v: Record<string, any>) => void): string => {
  const v = JSON.parse(TEXT) as Record<string, any>;
  f(v);
  return JSON.stringify(v);
};
const byText = (text: string): string => {
  const t = input.nodes.find((n) => n.kind === 'text' && n.text === text)!;
  return t.parent as string;
};

describe('styled elements inside @if arms', () => {
  const { exported } = marklessStyleExport(TEXT, PATH);

  it('compiles each branch as a state over its arms, one assignment per combination', () => {
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t]!;
      expect(x.states.map((s) => [s.key, s.domain])).toEqual(input.branches!.map((b) => [b.id, b.domain]));
      expect(x.assignments.length).toBe(2 * 2 * 3);
      expect(x.assignments[x.initial]!.values).toEqual({ [details]: '1', [late]: '0', [step]: '0' });
    }
  });

  it('gives a box only to the nodes of the arms shown, an inner arm only inside its outer one', () => {
    const lateBox = byText('Running late');
    const hint = byText('Details are hidden');
    for (const t of ['ios', 'android'] as const) {
      for (const a of exported.targets[t]!.assignments) {
        const byId = new Map(a.nodes.map((n) => [n.id, n]));
        for (const n of input.nodes) if (n.kind === 'element') expect(byId.get(n.id)!.frame !== null, `${n.id} in ${JSON.stringify(a.values)}`).toBe(armShown(input, n.arm, a.values));
        expect(byId.get(lateBox)!.frame !== null).toBe(a.values[details] === '0' && a.values[late] === '0');
        expect(byId.get(hint)!.frame !== null).toBe(a.values[details] === '1');
      }
    }
  });

  it('places every box of every assignment where Chrome does, within 1 device px', async () => {
    const report = await compareMarklessExport(input, exported);
    expect(report.compared).toBeGreaterThan(300);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    expect(report.paint.filter((r) => !r.pass)).toEqual([]);
    expect(new Set(report.rows.map((r) => JSON.stringify([r.values[details], r.values[late], r.values[step]]))).size).toBe(12);
  });

  it('refuses an arm of no branch, an arm a branch does not have, a node outside its parent arm, a malformed domain and a row of no list', () => {
    const at = (text: string): number => input.nodes.findIndex((n) => n.kind === 'element' && n.id === byText(text));
    expect(() => parseMarklessStyleInput(edit((v) => { v['nodes'][at('Packed')]['arm'] = { branch: 'nowhere', index: 0 }; }))).toThrow('arm names nowhere, which is not an earlier branch');
    expect(() => parseMarklessStyleInput(edit((v) => { v['nodes'][at('Packed')]['arm'] = { branch: step, index: 7 }; }))).toThrow(`${step} has no arm 7`);
    expect(() => parseMarklessStyleInput(edit((v) => { v['nodes'][at('Running late')]['arm'] = { branch: step, index: 0 }; }))).toThrow(`is in arm 0 of ${details}, and it is not`);
    expect(() => parseMarklessStyleInput(edit((v) => { v['branches'][2]['domain'] = ['1', '0']; }))).toThrow('a domain is its arms "0", "1", … in order');
    expect(() => parseMarklessStyleInput(edit((v) => { v['branches'][2]['initial'] = 'none'; }))).toThrow('initial "none" is not in its domain');
    expect(() => parseMarklessStyleInput(edit((v) => { v['nodes'][at('Packed')]['row'] = 'list'; }))).toThrow('row "list" is not a repeat');
  });
});
