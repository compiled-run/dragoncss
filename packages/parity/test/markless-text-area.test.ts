// Editable textareas in a Markless export: the host edits each one natively over its editor box (textEditing: 'host'), so Dragon
// lays out the textarea, its editor (one line tall while empty, as Chrome lays out an editable one) and its text, and reports each
// textarea's line pitch and first baseline for the host's own lines. Frames and lines are Chrome's at each target's device ratio.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { launchChrome } from '../src/chrome.ts';
import { captureMarklessAssignment, compareMarklessExport } from '../src/markless-style-compare.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';
import { systemFontsFor } from '../src/system-fonts/provider.ts';

const { runMarklessLayout, runMarklessRowsLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessLayout(line: string): string; runMarklessRowsLayout(line: string, shaper: unknown): string };
const { hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { hexBits(s: string): number };

const PATH = 'examples/markless-styles/input/text-area.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const cell = input.states[0]!.cell;
const TARGETS = ['ios', 'android'] as const;

describe('editable textareas in a Markless export', () => {
  const { exported } = marklessStyleExport(TEXT, PATH, undefined, 'system', undefined, true);

  it('lays out each textarea\'s text in its editor leaf, following the state; an empty text child stays an empty leaf a run-time text can fill', () => {
    for (const t of TARGETS) {
      for (const a of exported.targets[t]!.assignments) {
        const text = (id: string): string | null => a.nodes.find((n) => n.id === id)?.text ?? null;
        const body = a.values[cell] as string;
        expect([text('h1::placeholder:text0'), text('h1::editor:text0')], `${t} empty`).toEqual(['Write', null]);
        expect(text('h2::editor:text0'), `${t} fixed`).toContain('\nCall Sam\n');
        expect(text('h3::editor:text0'), `${t} ${JSON.stringify(body)}`).toBe(body);
      }
    }
  });

  it('writes on each editor box, the empty ones too, the font and colour of the text the host draws in it', () => {
    const style = (n: { writes: readonly Record<string, unknown>[] } | undefined): unknown[] => (n?.writes ?? []).filter((w) => w['kind'] === 'font' || w['kind'] === 'text-color').map((w) => (w['kind'] === 'font' ? w['font'] : w['color']));
    for (const t of TARGETS) {
      for (const a of exported.targets[t]!.assignments) {
        const node = (id: string) => a.nodes.find((n) => n.id === id) as { writes: readonly Record<string, unknown>[] } | undefined;
        expect(style(node('h2::editor')), `${t} fixed`).toEqual(style(node('h2::editor:text0')));
        expect(style(node('h1::editor')), `${t} empty`).toEqual(style(node('h2::editor:text0')));
        expect(style(node('h1::editor')).length, t).toBe(2);
      }
    }
  });

  it('places every box of every assignment where Chrome does, within 1 device px', async () => {
    const report = await compareMarklessExport(input, exported);
    expect(report.compared).toBeGreaterThan(60);
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    expect(report.paint.filter((r) => !r.pass)).toEqual([]);
  });

  it('reports, when the host asks, each textarea\'s line pitch and first baseline as Chrome spaces and places its lines', async () => {
    for (const t of TARGETS) {
      const x = exported.targets[t]!;
      const line = { assignment: 0, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan };
      const before = JSON.parse(runMarklessLayout(JSON.stringify(line))) as unknown[];
      const asked = JSON.parse(runMarklessLayout(JSON.stringify({ ...line, textAreas: true }))) as unknown[];
      expect(before[0], t).toBe('ok');
      expect(asked.slice(0, -1), `${t}: an older host is answered as before`).toEqual(before);
      const tag = asked[asked.length - 1] as [string, [string, string, string][]];
      expect(tag[0], t).toBe('text-areas');
      const rows = new Map(tag[1].map(([id, pitch, above]) => [id, { pitch: hexBits(pitch), above: hexBits(above) }]));
      expect([...rows.keys()], t).toEqual(['h1', 'h2', 'h3', 'h4', 'h6', 'h7']);
      const browser = await launchChrome(x.dpr);
      try {
        const cap = await captureMarklessAssignment(browser, input, x, x.assignments[0]!.values, 'light');
        for (const id of ['h2', 'h4']) {
          const at = (n: string) => cap.nodes.find((c) => c.id === n);
          const editor = at(`${id}::editor`)!;
          const tops = [...new Set(cap.nodes.filter((c) => c.id.startsWith(`${id}::editor:text0:line`)).map((c) => c.y * x.dpr))].sort((p, q) => p - q);
          const glyph = at(`${id}::editor:text0:line0`)!.height * x.dpr;
          const row = rows.get(id)!;
          expect(tops.length, `${t} ${id} lines`).toBeGreaterThan(2);
          tops.forEach((y, j) => expect(Math.abs(y - tops[0]! - j * row.pitch), `${t} ${id} line ${j}`).toBeLessThan(1 / 64));
          // Ahem's ascent is 0.8em, rounded to a whole device px as Blink rounds font metrics: the baseline is the glyph top plus it.
          const ascent = Math.round(0.8 * 16 * x.dpr);
          expect(Math.abs(tops[0]! - editor.y * x.dpr + ascent - row.above), `${t} ${id} baseline`).toBeLessThan(1 / 128);
          expect(Math.round(glyph - ascent), `${t} ${id} descent`).toBe(Math.round(0.2 * 16 * x.dpr));
        }
        // The pitch is the engine's line height on the LU grid: 1.45 x 16px is not 23.2 css px exactly, so an unsnapped pitch misses.
        expect(rows.get('h2')!.pitch, t).not.toBe(16 * 1.45 * x.dpr);
      } finally {
        await browser.close();
      }
    }
  });

  it('lays out a body known only at run time (the line\'s texts) as the export lays out that body from its state, which Chrome checks', () => {
    for (const t of TARGETS) {
      const x = exported.targets[t]!;
      const at = (i: number): string => x.assignments[i]!.values[cell] as string;
      const exportedFrame = (i: number, id: string): readonly number[] | null => {
        const f = x.assignments[i]!.nodes.find((n) => n.id === id)?.frame ?? null;
        return f === null ? null : [f.x, f.y, f.width, f.height];
      };
      for (const [from, to] of [[0, 1], [1, 0]] as const) {
        const line = { assignment: from, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan, rows: [], texts: [['h3::editor:text0', at(to)]] };
        const out = JSON.parse(runMarklessRowsLayout(JSON.stringify(line), systemFontsFor(t, x.dpr).shaper)) as unknown[];
        expect(out[0], `${t} ${JSON.stringify(at(from))} -> ${JSON.stringify(at(to))}: ${JSON.stringify(out).slice(0, 200)}`).toBe('ok');
        const node = (out[2] as [string, string[]][]).find((n) => n[0] === 'h3::editor')!;
        const want = exportedFrame(to, 'h3::editor')!;
        node[1].map(hexBits).forEach((v, k) => expect(Math.abs(v - want[k]!), `${t} ${JSON.stringify(at(to))} h3::editor[${k}]`).toBeLessThan(1 / 128));
      }
      // Tab stops are not laid out (TXT2-c3): a run-time tab is refused by name, as a compile-time one is, never laid out wrong.
      const tab = { assignment: 1, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan, rows: [], texts: [['h3::editor:text0', 'a\n\tb']] };
      const refused = JSON.parse(runMarklessRowsLayout(JSON.stringify(tab), systemFontsFor(t, x.dpr).shaper)) as unknown[];
      expect([refused[0], String(refused[1]).includes('tab')], t).toEqual(['harness-error', true]);
    }
  });
});

