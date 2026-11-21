// A style chosen by state between texts with slots (styleByState): each assignment binds only the slots its text holds, the
// device given values no build sampled lays out as an export with those values written in, and that export matches Chrome.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import type { MarklessStyleInput } from '../src/markless-style-input.ts';
import { filledAtInitial, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';

const { runMarklessLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessLayout(line: string): string };
const { bitsHex } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { bitsHex(x: number): string };

const PATH = 'examples/markless-styles/input/style-choice.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const slots = input.slots ?? [];
const exported = marklessStyleExport(TEXT, PATH, undefined, 'system', undefined, true).exported;
const filled = (values: readonly number[]): MarklessStyleInput => filledAtInitial(parseMarklessStyleInput(JSON.stringify({ ...input, slots: slots.map((s, k) => ({ ...s, initial: values[k] })) })));
const surface = (t: 'ios' | 'android', k: number, line: Record<string, unknown>): unknown => {
  const out = JSON.parse(runMarklessLayout(JSON.stringify(line))) as unknown[];
  expect(out[0], JSON.stringify(out)).toBe('ok');
  const names = new Map(exported.targets[t]!.planNames?.[k] ?? []);
  return (out[2] as unknown[][]).find((n) => (names.get(n[0] as string) ?? n[0]) === 'h2')?.[1];
};

describe('a style chosen by state between texts with slots', () => {
  it('binds the slots only where the state shows the text that holds them', () => {
    const bound = exported.targets.android!.plan!.assignments.map((a) => (a.slotFields ?? []).map(([slot, node, key]) => `${slots[slot]!.id} ${node} ${key}`));
    expect(bound).toEqual([[], ['slot:x h2 left', 'slot:y h2 top']]);
  }, 120_000);

  for (const values of [[12.34, 56.7], [140.25, 3.5]]) {
    it(`lays out on the device at ${JSON.stringify(values)} as the export with those values does, and that export matches Chrome`, async () => {
      const web = filled(values);
      const concrete = marklessStyleExport(JSON.stringify(web), PATH, undefined, 'system', undefined, true).exported;
      for (const t of ['ios', 'android'] as const) {
        const x = exported.targets[t]!;
        const want = concrete.targets[t]!;
        for (const k of [0, 1]) {
          const base = { assignment: k, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } };
          expect(surface(t, k, { ...base, plan: x.plan, slots: values.map(bitsHex) }), `${t} ${k}`).toEqual(surface(t, k, { ...base, plan: want.plan }));
        }
      }
      const r = await compareMarklessExport(web, marklessStyleExport(JSON.stringify(web), PATH).exported, undefined, 'light', [], null);
      expect(r.rows.filter((row) => !row.pass)).toEqual([]);
      expect(r.compared).toBeGreaterThan(8);
    }, 180_000);
  }

  it('refuses a style that is both chosen by state and a template, by name', () => {
    const both = { ...input, nodes: input.nodes.map((n) => (n.id === 'h2' ? { ...n, styleTemplate: ['--x: ', { slot: 'slot:x' }, 'px'] } : n)) };
    expect(() => parseMarklessStyleInput(JSON.stringify(both))).toThrow(/h2: style is both a styleTemplate and a styleByState/);
  });
});
