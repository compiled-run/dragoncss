// Editable search fields in a Markless export: the host draws and edits each field natively over the editor box Dragon lays out
// (textEditing: 'host'), so Dragon lays out the field, its editor and its placeholder while the value is empty. One field starts
// empty, one has a fixed value and one takes its value from a state. Frames are Chrome's at each target's device ratio.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/text-field.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const cell = input.states[0]!.cell;

describe('editable search fields in a Markless export', () => {
  const { exported } = marklessStyleExport(TEXT, PATH);

  it('shows the placeholder while the value is empty and the value in the editor, following the state', () => {
    for (const t of ['ios', 'android'] as const) {
      for (const a of exported.targets[t]!.assignments) {
        const ids = new Set(a.nodes.filter((n) => n.frame !== null).map((n) => n.id));
        const text = (id: string): string | null => a.nodes.find((n) => n.id === id)?.text ?? null;
        expect([ids.has('h1::placeholder'), text('h1::placeholder:text0'), ids.has('h1::editor:text0')], `${t} empty field`).toEqual([true, 'Search notes', false]);
        expect([ids.has('h2::placeholder'), text('h2::editor:text0')], `${t} fixed value`).toEqual([false, 'Groceries']);
        expect(['h1', 'h2', 'h3'].map((h) => ids.has(`${h}::cancel`)), `${t} cancel boxes`).toEqual([true, true, true]);
        const query = a.values[cell] as string;
        expect([ids.has('h3::placeholder'), text('h3::editor:text0')], `${t} ${query}`).toEqual(query === '' ? [true, null] : [false, query]);
      }
    }
  });

  it('writes on each editor box the font and colour of the text the host draws in it, as the editor\'s own text has them', () => {
    const style = (n: { writes: readonly Record<string, unknown>[] } | undefined): unknown[] => (n?.writes ?? []).filter((w) => w['kind'] === 'font' || w['kind'] === 'text-color').map((w) => w['kind'] === 'font' ? w['font'] : w['color']);
    for (const t of ['ios', 'android'] as const) {
      for (const a of exported.targets[t]!.assignments) {
        const node = (id: string) => a.nodes.find((n) => n.id === id) as { writes: readonly Record<string, unknown>[] } | undefined;
        expect(style(node('h2::editor')), `${t} fixed value`).toEqual(style(node('h2::editor:text0')));
        expect(style(node('h1::editor')), `${t} empty field`).toEqual(style(node('h2::editor:text0')));
        expect(style(node('h1::editor')).length, t).toBe(2);
      }
    }
  });

  it('places every box of both assignments where Chrome does, within 1 device px', async () => {
    const report = await compareMarklessExport(input, exported);
    expect(report.compared).toBeGreaterThan(40);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    expect(report.paint.filter((r) => !r.pass)).toEqual([]);
  });
});
