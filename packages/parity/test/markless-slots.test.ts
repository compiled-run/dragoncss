// Typed slots of a Markless style input (markless-slots.ts): at values no build sampled, the device's function (harness.ts
// runMarklessLayout with `slots`) gives exactly the frames and writes of an export of the same input with those values written in,
// and that export matches Chrome: every box within the comparison's gate, every colour the slots move equal to Chrome's computed one.
import { readFileSync } from 'node:fs';
import { textDecoration } from '@dragon/layout';
import { describe, expect, it } from 'vitest';
import { launchChrome, openPage } from '../src/chrome.ts';
import { compareMarklessExport, marklessDocumentHtml } from '../src/markless-style-compare.ts';
import type { MarklessStyleInput } from '../src/markless-style-input.ts';
import { filledAtInitial, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import type { ExportNode } from '../src/native-style-export.ts';
import { checkPlan } from '../src/markless-plan.ts';
import { repoPath } from '../src/paths.ts';
import { decodePng } from '../src/pixel-reference.ts';

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

  it('compares the phones\' export with Chrome at the slots\' initial values, from the input with slots', async () => {
    // With system fonts iOS measures Safari's faces, so Chrome is compared on Android only, as the comparison requires.
    const r = await compareMarklessExport(input, exported, undefined, 'light', [], null, ['android']);
    expect(r.rows.filter((row) => !row.pass)).toEqual([]);
    expect(r.compared).toBe(13);
  }, 180_000);

  it('stops by name on a value no rule covers', () => {
    const below = device('ios', 0, [25, 1, -5, 2, 200, 40]);
    expect(below[0]).toBe('harness-error');
    expect(String(below[1])).toContain('slot:width at -1');
    const nan = device('android', 0, [Number.NaN, 1, 120, 2, 200, 40]);
    expect(nan).toEqual(['harness-error', `$.slots: slot:x is not a finite number (the web gets NaN or Infinity, which makes the declaration that holds it invalid)`]);
  }, 120_000);

  it('carries each slot\'s type to the phone, which refuses a value outside it by name', () => {
    expect(exported.targets.android!.plan!.slots).toEqual(slots.map((s) => [s.id, s.integer === true ? 'integer' : 'number']));
    // The build sampled slot:index at whole numbers only, so the line fitted there does not cover 2.5.
    expect(device('ios', 0, [25, 1, 120, 2.5, 200, 40])).toEqual(['harness-error', '$.slots: slot:index at 2.5 is not a whole number, and it is declared integer (the build sampled it at whole numbers only)']);
    expect(device('android', 0, [25, 1, 120, 2, 200])).toEqual(['harness-error', '$.slots: the line gives 5 values and the plan has 6 slots']);
    expect(device('android', 0, [25, 1, 120, 2, 200, 40, 7])).toEqual(['harness-error', '$.slots: the line gives 7 values and the plan has 6 slots']);
    const x = exported.targets.ios!;
    const bare = { assignment: 0, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan };
    expect(JSON.parse(runMarklessLayout(JSON.stringify(bare)))).toEqual(['harness-error', '$: the plan has slots and the line gives no values for them']);
    const { slots: _, ...untyped } = x.plan!;
    expect(JSON.parse(checkPlan(JSON.stringify(untyped)))).toEqual(['harness-error', '$.plan.assignments[0]: the assignment binds slots the plan does not have']);
    expect(JSON.parse(checkPlan(JSON.stringify({ ...x.plan!, slots: x.plan!.slots!.slice(0, 3) })))).toEqual(['harness-error', '$.plan.assignments[0].slotFields[4][0]: 3 is not a slot of the plan']);
  }, 120_000);

  it('refuses slots that move a value together other than each moves it alone, at any sample position', () => {
    // slot:b scales slot:a's width by clamp(0, b - 1.5, 1): 1 at b's initial 5 and at 2.5, so only other positions show it.
    const both = { version: input.version, component: 'App', css: '.t { height: 10px; width: calc(var(--a) * clamp(0, var(--b) - 1.5, 1) * 1px); }', states: [], slots: [{ id: 'slot:a', initial: 0 }, { id: 'slot:b', initial: 5 }], nodes: [{ kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} }, { kind: 'element', id: 'h1', element: 'div', parent: 'h0', attributes: { class: 't' }, styleTemplate: ['--a: ', { slot: 'slot:a' }, '; --b: ', { slot: 'slot:b' }] }] };
    expect(() => marklessStyleExport(JSON.stringify(both), PATH, undefined, 'system', undefined, true)).toThrow('ios assignment 0: the slots moved together at [-1,-1] do not give what each gives alone');
  }, 120_000);

  it('binds a slot inside an @if arm in each combination of arms, and lays it out as an export at that value', () => {
    const armed = (initial: number): string => JSON.stringify({ version: input.version, component: 'App', css: '.bar { height: 10px; background-color: rgb(90 90 90); }', states: [], branches: [{ id: 'branch:0', domain: ['0', 'none'], initial: '0' }], slots: [{ id: 'slot:w', initial }], nodes: [{ kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} }, { kind: 'element', id: 'h1', element: 'div', parent: 'h0', attributes: { class: 'bar' }, arm: { branch: 'branch:0', index: 0 }, styleTemplate: ['width: ', { slot: 'slot:w' }, 'px'] }] });
    const slotted = marklessStyleExport(armed(120), PATH, undefined, 'system', undefined, true).exported;
    const concrete = marklessStyleExport(JSON.stringify(filledAtInitial(parseMarklessStyleInput(armed(37.5)))), PATH, undefined, 'system', undefined, true).exported;
    for (const t of ['ios', 'android'] as const) {
      const x = slotted.targets[t]!;
      expect(x.plan!.assignments.map((a) => (a.slotFields ?? []).map(([, node, key]) => `${node} ${key}`))).toEqual(x.assignments.map((a) => (a.nodes.some((n) => n.id === 'h1' && n.frame !== null) ? ['h1 width'] : [])));
      x.assignments.forEach((a, k) => {
        const line = { assignment: k, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan, slots: [bitsHex(37.5)] };
        const out = JSON.parse(runMarklessLayout(JSON.stringify(line))) as unknown[];
        expect(out[0], JSON.stringify(out)).toBe('ok');
        const names = new Map(x.planNames?.[k] ?? []);
        const got = new Map((out[2] as unknown[][]).map((n) => [names.get(n[0] as string) ?? (n[0] as string), decode(n[1])]));
        for (const n of concrete.targets[t]!.assignments[k]!.nodes) if (n.frame !== null) expect(got.get(n.id), `${t} ${k} ${n.id}`).toEqual(geometry(n)[0]);
      });
    }
  }, 120_000);

  describe('an rgb() alpha a slot moves', () => {
    const ALPHA_PATH = 'examples/markless-styles/input/slots-alpha.native-style-input.json';
    const alphaInput = { ...input, css: `${input.css}\n.panel { background-color: rgb(10 20 30 / var(--size, 1)); }` };
    const alphaText = JSON.stringify(alphaInput);
    const size = slots.findIndex((s) => s.id === 'slot:size');
    const slotted = marklessStyleExport(alphaText, ALPHA_PATH, undefined, 'system', undefined, true).exported;
    /** Alphas no build samples; 0.7 separates k = 255 from a fitted k = 128 (calc(a * 0.5)), and 0.002, 0.501, 0.999 round at Chrome's byte edges. */
    const ALPHAS = [0.3, 0.7, 0.002, 0.501, 0.999];

    it('binds through the channel rule with k = 255 from zero up, and to 0 below zero', () => {
      for (const t of ['ios', 'android'] as const) {
        const w = (slotted.targets[t]!.plan!.assignments[0]!.slotWrites ?? []).filter(([slot, node, kind]) => slot === size && node === 'h4' && kind === 'background-color');
        expect(JSON.parse(JSON.stringify(w.map(([, , , path, pieces]) => [path, pieces]))), t).toEqual([[['color', 'alpha'], [['line', 0, 0], ['channel', 0, 255], null]]]);
      }
    }, 120_000);

    for (const a of ALPHAS) {
      it(`at ${a}, the phone gives the export with that alpha written in, which matches Chrome`, async () => {
        const values = slots.map((s, k) => (k === size ? a : s.initial));
        const web = filledAtInitial(parseMarklessStyleInput(JSON.stringify({ ...alphaInput, slots: slots.map((s, k) => ({ ...s, initial: values[k] })) })));
        const concrete = marklessStyleExport(JSON.stringify(web), ALPHA_PATH, undefined, 'system', undefined, true).exported;
        for (const t of ['ios', 'android'] as const) {
          const x = slotted.targets[t]!;
          const line = { assignment: 0, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan, slots: values.map(bitsHex) };
          const out = JSON.parse(runMarklessLayout(JSON.stringify(line))) as unknown[];
          expect(out[0], JSON.stringify(out)).toBe('ok');
          const want = concrete.targets[t]!;
          const bare = { assignment: 0, dpr: want.dpr, viewport: want.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: want.plan };
          expect(out.slice(0, 3)).toEqual(JSON.parse(runMarklessLayout(JSON.stringify(bare))));
          const writes = new Map(x.assignments[0]!.nodes.map((n) => [n.id, n.writes as unknown]));
          for (const [node, kind, path, value] of out[3] as [string, string, (string | number)[], string][]) {
            const was = writes.get(node) as readonly Record<string, unknown>[];
            writes.set(node, withPath(was, [was.findIndex((w) => w['kind'] === kind), ...path], hexBits(value)));
          }
          for (const n of want.assignments[0]!.nodes) expect(writes.get(n.id), `${t} ${n.id} writes`).toEqual(n.writes);
        }
        const r = await compareMarklessExport(web, marklessStyleExport(JSON.stringify(web), ALPHA_PATH).exported);
        expect(r.rows.filter((row) => !row.pass)).toEqual([]);
        expect(r.compared).toBeGreaterThan(20);
        const browser = await launchChrome();
        try {
          for (const t of ['ios', 'android'] as const) {
            const x = concrete.targets[t]!;
            const page = await openPage(browser, marklessDocumentHtml(web, {}), { viewport: x.viewport, devicePixelRatio: x.dpr, direction: 'ltr', rootFont: 'ua-default' });
            const chrome = (await page.evaluate(() => getComputedStyle(document.querySelector('[data-dragon-id="h4"]') as Element).backgroundColor)) as string;
            await page.context().close();
            const m = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(chrome);
            expect(m, `${t} Chrome's ${chrome}`).not.toBeNull();
            const c = x.assignments[0]!.nodes.find((n) => n.id === 'h4')?.writes.find((w) => w['kind'] === 'background-color')?.['color'];
            expect(c, t).toEqual({ r: 10, g: 20, b: 30, alpha: Math.round(255 * a) });
            // Chrome serializes the alpha byte with the fewest decimals that read back to it.
            expect([Number(m![1]), Number(m![2]), Number(m![3]), Math.round(255 * Number(m![4] ?? 1))], `${t} Chrome's ${chrome}`).toEqual([10, 20, 30, Math.round(255 * a)]);
          }
        } finally {
          await browser.close();
        }
        const want = textDecoration.blendOver({ r: 255, g: 255, b: 255, a: 255 }, { r: 10, g: 20, b: 30, a: Math.round(255 * a) }, 256);
        for (const dpr of [2, 3]) {
          const chrome = await launchChrome(dpr);
          try {
            const page = await openPage(chrome, marklessDocumentHtml(web, {}), { viewport: concrete.targets.android!.viewport, devicePixelRatio: dpr, direction: 'ltr', rootFont: 'ua-default' });
            const box = (await page.evaluate(() => (document.querySelector('[data-dragon-id="h4"]') as Element).getBoundingClientRect().toJSON())) as DOMRect;
            const image = decodePng(await page.screenshot());
            await page.context().close();
            const i = (Math.floor((box.y + box.height / 2) * dpr) * image.width + Math.floor((box.x + box.width / 2) * dpr)) * 4;
            expect([...image.data.subarray(i, i + 3)], `the pixel at DPR ${dpr} over white`).toEqual([want.r, want.g, want.b]);
          } finally {
            await chrome.close();
          }
        }
      }, 180_000);
    }

    it('refuses an alpha a slot reaches inside calc(), by name', () => {
      // A fitted channel k = 128 would match every sample of this alpha and be wrong at 0.7; the compile refuses calc() there first.
      const half = { ...input, css: `${input.css}\n.panel { background-color: rgb(10 20 30 / calc(var(--size, 1) * 0.5)); }` };
      expect(() => marklessStyleExport(JSON.stringify(half), PATH, undefined, 'system', undefined, true)).toThrow(/DRAGON_UNSUPPORTED_VALUE \[all\] background-color: rgb\(10 20 30 \/ calc\(var\(--size, 1\) \* 0\.5\)\) substitutes to "rgb\(10 20 30 \/ calc\(1 \* 0\.5\)\)", and .* is unsupported: unsupported token Function in a colour function/);
      expect(() => marklessStyleExport(TEXT, PATH, undefined, 'system')).toThrow(/only with the layout plan/);
    }, 120_000);
  });
});
