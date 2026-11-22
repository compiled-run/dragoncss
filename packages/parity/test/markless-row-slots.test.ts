// A style number inside a styled @for row: each row's copy takes its own value. The device (harness.ts runMarklessRowsLayout, with
// each row's `slots`) lays the rows out exactly as the build lays out the page with those rows written out, each with its own number,
// and that written-out page matches Chrome.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import type { MarklessStyleInput } from '../src/markless-style-input.ts';
import { marklessStyleExport, parseMarklessStyleInput, valueUnder } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';
import { systemFontsFor } from '../src/system-fonts/provider.ts';

const { runMarklessRowsLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessRowsLayout(line: string, shaper: { shape: (...a: never[]) => readonly number[] }): string };
const { bitsHex, hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { bitsHex(x: number): string; hexBits(s: string): number };
const decode = (v: unknown): unknown => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? hexBits(v) : Array.isArray(v) ? v.map(decode) : v);

const PATH = 'examples/markless-styles/input/rows.native-style-input.json';
const base = JSON.parse(readFileSync(repoPath(PATH), 'utf8')) as MarklessStyleInput;
const SLOT = 'slot:h5#0';
// Each row's li is indented by its own number of px, as `style={`padding-left: ${row.indent}px`}` writes it.
const slotted = { ...base, slots: [{ id: SLOT, initial: 4 }], nodes: base.nodes.map((n) => (n.id === 'h5' ? { ...n, styleTemplate: ['padding-left: ', { slot: SLOT }, 'px'] } : n)) };
const TEXT = JSON.stringify(slotted);
const input = parseMarklessStyleInput(TEXT);
const repeat = input.repeats![0]!;
const rowState = input.states.find((s) => s.row === repeat.id)!;
const branch = input.branches![0]!;
const titleText = input.nodes.find((n) => n.kind === 'text' && n.row === repeat.id)!.id;

type Row = { readonly key: string; readonly title: string; readonly pinned: boolean; readonly indent: number };
const ROWS: readonly Row[] = [
  { key: 'a', title: 'Groceries', pinned: false, indent: 4 },
  { key: 'b', title: 'Call the plumber', pinned: true, indent: 18.5 },
  { key: 'c', title: 'Water the plants', pinned: false, indent: 40.25 },
];
const option = (pinned: boolean): string => {
  const li = input.nodes.find((n) => n.kind === 'element' && n.id === 'h5')!;
  if (li.kind !== 'element') throw new Error('no row element');
  return li.classByState!.find((e) => (e.value ?? '').split(' ').includes('pinned') === pinned)!.when[rowState.cell] as string;
};

/** The page as the web renders these rows: each row's nodes named "<id>@<key>", with its own class, text and padding. */
function writtenOut(rows: readonly Row[]): MarklessStyleInput {
  const nodes: MarklessStyleInput['nodes'][number][] = [];
  let placed = false;
  for (const n of input.nodes) {
    if (n.row !== repeat.id) {
      nodes.push(n);
      continue;
    }
    if (placed) continue;
    placed = true;
    for (const row of rows) {
      for (const t of input.nodes.filter((x) => x.row === repeat.id)) {
        const parent = t.parent === repeat.parent ? t.parent : `${t.parent}@${row.key}`;
        const arm = repeat.arm !== undefined ? { arm: repeat.arm } : {};
        if (t.kind === 'text') nodes.push({ kind: 'text', id: `${t.id}@${row.key}`, parent: parent as string, text: t.id === titleText ? row.title : t.text, ...arm });
        else {
          const cls = t.classByState === undefined ? t.attributes['class'] : valueUnder(t.classByState, { [rowState.cell]: option(row.pinned) }, t.id);
          const attributes: Record<string, string> = { ...t.attributes };
          delete attributes['class'];
          if (cls !== null && cls !== undefined) attributes['class'] = cls;
          if (t.styleTemplate !== undefined) attributes['style'] = `padding-left: ${String(row.indent)}px`;
          nodes.push({ kind: 'element', id: `${t.id}@${row.key}`, element: t.element, parent, attributes, ...arm });
        }
      }
    }
  }
  const { repeats: _, slots: __, ...rest } = input;
  return { ...rest, nodes, states: input.states.filter((s) => s.row === undefined) };
}

describe('a style number inside a styled @for row', () => {
  const { exported } = marklessStyleExport(TEXT, PATH, undefined, 'system', undefined, true);

  for (const t of ['ios', 'android'] as const) {
    it(`lays each row out on the ${t} device with its own value, as the build lays the rows out written out`, () => {
      const x = exported.targets[t]!;
      const at = (pinned: boolean): number => x.assignments.findIndex((a) => a.values[branch.id] === '1' && a.values[rowState.cell] === option(pinned));
      const page = at(false);
      const names = new Map((x.planNames?.[page] ?? []).map(([d, m]) => [m, d]));
      const dragon = (id: string): string => names.get(id) ?? id;
      const line = JSON.stringify({
        assignment: page,
        dpr: x.dpr,
        viewport: x.viewport,
        safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
        plan: x.plan,
        slots: [bitsHex(4)],
        rows: x.planRepeats!.map((r) => ({ parent: r.parent, template: r.template, rows: ROWS.map((row) => ({ key: row.key, assignment: at(row.pinned), texts: [[dragon(titleText), row.title]], slots: [bitsHex(row.indent)] })) })),
      });
      const out = JSON.parse(runMarklessRowsLayout(line, systemFontsFor(t, x.dpr).shaper as never)) as unknown[];
      expect(out[0], JSON.stringify(out)).toBe('ok');
      expect(out).toHaveLength(5);
      expect((out[4] as unknown[][]).map((r) => r[0])).toEqual(ROWS.map((r) => r.key));
      const boxes = new Map((out[2] as unknown[][]).map((n) => [n[0] as string, decode(n[1]) as number[]]));
      const built = marklessStyleExport(JSON.stringify(writtenOut(ROWS)), PATH, undefined, 'system').exported.targets[t]!;
      const a = built.assignments.find((y) => y.values[branch.id] === '1')!;
      let compared = 0;
      for (const row of ROWS)
        for (const id of ['h5', 'h6']) {
          const n = a.nodes.find((y) => y.id === `${id}@${row.key}`)!;
          // Frames are relative to the parent; a row's li and its title keep the build's own.
          expect(boxes.get(`${dragon(id)}@${row.key}`), `${t} ${id}@${row.key}`).toEqual([n.frame!.x, n.frame!.y, n.frame!.width, n.frame!.height]);
          compared++;
        }
      expect(compared).toBe(6);
    }, 180_000);
  }

  it('the rows written out with their own numbers match Chrome', async () => {
    const web = writtenOut(ROWS);
    const r = await compareMarklessExport(web, marklessStyleExport(JSON.stringify(web), PATH).exported);
    expect(r.rows.filter((row) => !row.pass)).toEqual([]);
    expect(r.compared).toBeGreaterThan(12);
  }, 180_000);
});
