// Typed slots of a Markless style input (markless-slots.ts): at values no build sampled, the device's function (harness.ts
// runMarklessLayout with `slots`) gives exactly the frames and writes of an export of the same input with those values written in,
// and that export matches Chrome: every box within the comparison's gate, every colour the slots move equal to Chrome's computed one.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { launchChrome, openPage } from '../src/chrome.ts';
import { compareMarklessExport, marklessDocumentHtml } from '../src/markless-style-compare.ts';
import type { MarklessStyleInput } from '../src/markless-style-input.ts';
import { filledAtInitial, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import type { ExportNode } from '../src/native-style-export.ts';
import { repoPath } from '../src/paths.ts';

const { runMarklessLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessLayout(line: string): string };
const { bitsHex, hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { bitsHex(x: number): string; hexBits(s: string): number };

const PATH = 'examples/markless-styles/input/slots.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const slots = input.slots ?? [];
/** Values no build samples: a percentage, a flex number, a length, an integer and two rgb() channels (one rounds up, one clamps). */
const RUNTIME: readonly (readonly number[])[] = [
  [12.34, 0.37, 33.3, 3, 17.6, 99.5],
  [66.6, 2.2, 150.75, 5, 250.4, 0.2],
  [0, 0, 0, 0, 255.6, -3],
];
const at = (values: readonly number[]): string => JSON.stringify({ ...input, slots: slots.map((s, k) => ({ ...s, initial: values[k] })) });
/** The input with the values written into its style attributes and no slots: what the web renders at those values. */
const filled = (values: readonly number[]): MarklessStyleInput => filledAtInitial(parseMarklessStyleInput(at(values)));
const decode = (v: unknown): unknown => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? hexBits(v) : Array.isArray(v) ? v.map(decode) : v);

const exported = marklessStyleExport(TEXT, PATH, undefined, 'system', undefined, true).exported;

function device(t: 'ios' | 'android', k: number, values: readonly number[]): unknown[] {
  const x = exported.targets[t]!;
  const line = { assignment: k, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan, slots: values.map(bitsHex) };
  return JSON.parse(runMarklessLayout(JSON.stringify(line))) as unknown[];
}

function geometry(n: ExportNode): unknown[] {
  const f = n.frame;
  const b = n.borderWidths;
  return [f === null ? null : [f.x, f.y, f.width, f.height], b === null ? null : [b['top'], b['right'], b['bottom'], b['left']], n.lines === undefined ? null : n.lines.map((l) => [l.top, l.baseline, l.runs.map((r) => [r.face, r.size, r.glyphs, r.xs])])];
}

const withPath = (v: unknown, path: readonly (string | number)[], value: number): unknown => {
  if (path.length === 0) return value;
  const [p, ...rest] = path;
  if (Array.isArray(v)) return v.map((x, i) => (i === p ? withPath(x, rest, value) : x));
  return { ...(v as Record<string, unknown>), [p as string]: withPath((v as Record<string, unknown>)[p as string], rest, value) };
};

describe('typed slots of a Markless style input', () => {
  it('binds each slot to what it moves, and names the pieces a phone cannot be given', () => {
    const plan = exported.targets.ios!.plan!;
    const a = plan.assignments[0]!;
    const fields = (a.slotFields ?? []).map(([slot, node, key]) => `${slots[slot]!.id} ${node} ${key}`);
    expect(fields).toEqual(['slot:x h2 left', 'slot:size h4 flexBasis', 'slot:size h4 flexGrow', 'slot:width h6 width', 'slot:index h7 marginTop']);
    const writes = new Set((a.slotWrites ?? []).map(([slot, node]) => `${slots[slot]!.id} ${node}`));
    // The tone reaches the swatch's background, its currentcolor borders, and the label's text and borders by inheritance.
    expect([...writes].sort()).toEqual(['slot:blue h8', 'slot:blue h9', 'slot:blue h9:text0', 'slot:red h8', 'slot:red h9', 'slot:red h9:text0']);
    const refused = (a.slotRefusals ?? []).map(([slot, piece]) => `${slots[slot]!.id} ${piece}`);
    expect(refused.sort()).toEqual([...slots.map((s) => `${s.id} 2`), 'slot:width 0'].sort());
    expect(exported.slots).toEqual(slots);
  }, 120_000);

  for (const values of RUNTIME) {
    it(`lays out on the device at ${JSON.stringify(values)} as the export with those values does`, () => {
      const concrete = marklessStyleExport(JSON.stringify(filled(values)), PATH, undefined, 'system', undefined, true).exported;
      let compared = 0;
      for (const t of ['ios', 'android'] as const) {
        const x = exported.targets[t]!;
        const want = concrete.targets[t]!;
        x.assignments.forEach((base, k) => {
          const out = device(t, k, values);
          expect(out[0], JSON.stringify(out)).toBe('ok');
          const names = new Map(x.planNames?.[k] ?? []);
          const got = new Map((out[2] as unknown[][]).map((n) => [names.get(n[0] as string) ?? (n[0] as string), decode(n.slice(1, 4))]));
          // The phone given this export at these values lays out exactly as the phone given an export built at them.
          const line = { assignment: k, dpr: want.dpr, viewport: want.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: want.plan };
          expect(out.slice(0, 3)).toEqual(JSON.parse(runMarklessLayout(JSON.stringify(line))));
          const writes = new Map(base.nodes.map((n) => [n.id, n.writes as unknown]));
          for (const [node, kind, path, value] of out[3] as [string, string, (string | number)[], string][]) {
            const was = writes.get(node) as readonly Record<string, unknown>[];
            writes.set(node, withPath(was, [was.findIndex((w) => w['kind'] === kind), ...path], hexBits(value)));
          }
          for (const n of want.assignments[k]!.nodes) {
            expect(writes.get(n.id), `${t} ${k} ${n.id} writes`).toEqual(n.writes);
            if (n.frame === null) continue;
            expect((got.get(n.id) as unknown[])[0], `${t} ${k} ${n.id}`).toEqual(geometry(n)[0]);
            compared++;
          }
        });
      }
      expect(compared).toBeGreaterThan(20);
    }, 120_000);

    it(`matches Chrome at ${JSON.stringify(values)}: boxes and the colours the slots move`, async () => {
      const web = filled(values);
      const concrete = marklessStyleExport(JSON.stringify(web), PATH).exported;
      const r = await compareMarklessExport(web, concrete);
      expect(r.rows.filter((row) => !row.pass)).toEqual([]);
      expect(r.compared).toBeGreaterThan(20);
      const browser = await launchChrome();
      try {
        for (const t of ['ios', 'android'] as const) {
          const x = concrete.targets[t]!;
          const page = await openPage(browser, marklessDocumentHtml(web, {}), { viewport: x.viewport, devicePixelRatio: x.dpr, direction: 'ltr', rootFont: 'ua-default' });
          const chrome = (await page.evaluate(() => {
            const of = (id: string): CSSStyleDeclaration => getComputedStyle(document.querySelector(`[data-dragon-id="${id}"]`) as Element);
            return { background: of('h8').backgroundColor, text: of('h9').color };
          })) as { background: string; text: string };
          await page.context().close();
          const nodes = x.assignments[0]!.nodes;
          const color = (id: string, kind: string): string => {
            const c = nodes.find((n) => n.id === id)?.writes.find((w) => w['kind'] === kind)?.['color'] as { r: number; g: number; b: number; alpha: number };
            return c.alpha === 255 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${c.alpha / 255})`;
          };
          expect(color('h8', 'background-color'), `${t} background`).toBe(chrome.background);
          expect(color('h9:text0', 'text-color'), `${t} text`).toBe(chrome.text);
        }
      } finally {
        await browser.close();
      }
    }, 180_000);
  }

  it('stops by name on a value no rule covers', () => {
    const below = device('ios', 0, [25, 1, -5, 2, 200, 40]);
    expect(below[0]).toBe('harness-error');
    expect(String(below[1])).toContain('slot:width at -1');
    const nan = device('android', 0, [Number.NaN, 1, 120, 2, 200, 40]);
    expect(nan).toEqual(['harness-error', `$.slots: slot:x is not a finite number (the web gets NaN or Infinity, which makes the declaration that holds it invalid)`]);
  }, 120_000);

  it('refuses a slot whose value is not a straight line of it, by name', () => {
    // Chrome keeps an rgb() alpha as round(a × 255) clamped, which is neither rule.
    const alpha = { ...input, css: `${input.css}\n.panel { background-color: rgb(10 20 30 / var(--size, 1)); }` };
    expect(() => marklessStyleExport(JSON.stringify(alpha), PATH, undefined, 'system', undefined, true)).toThrow(/the background-color write of h4 is not a straight line or an rgb\(\) channel of slot:size from zero up \(at \["color","alpha"\]\)/);
    expect(() => marklessStyleExport(TEXT, PATH, undefined, 'system')).toThrow(/only with the layout plan/);
  }, 120_000);
});
