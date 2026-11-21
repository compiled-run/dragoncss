// Styled @if arms inside @for rows: a branch of each row is a state of that row, so the template is laid out at each arm and a
// phone copies each row at the arm its own item shows (harness.ts runMarklessRowsLayout). Compared with Chrome laying out the
// same rows. The input is the one @markless/mobile writes for its S22 rung: tasks whose row shows a Done badge or a Finish button.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { launchChrome } from '../src/chrome.ts';
import { captureMarklessAssignment } from '../src/markless-style-compare.ts';
import type { MarklessRow, MarklessStyleInput } from '../src/markless-style-input.ts';
import { marklessStyleExport, marklessWithRows, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';
import { systemFontReference } from '../src/system-fonts/reference.ts';
import { systemFontsFor } from '../src/system-fonts/provider.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';

const { runMarklessRowsLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessRowsLayout(line: string, shaper: { shape: (...a: never[]) => readonly number[] }): string };
const { hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { hexBits(s: string): number };
const decode = (v: unknown): unknown => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? hexBits(v) : Array.isArray(v) ? v.map(decode) : v);

const PATH = 'examples/markless-styles/input/row-arms.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const repeat = input.repeats![0]!;
const branch = input.branches!.find((b) => b.row === repeat.id)!;
const texts = input.nodes.filter((n) => n.kind === 'text' && n.row === repeat.id).map((n) => n.id);
const [nameText, doneText, finishText] = texts as [string, string, string];

type Task = { readonly key: string; readonly name: string; readonly done: boolean };
const TASKS: readonly Task[] = [
  { key: 'a', name: 'Apples', done: false },
  { key: 'b', name: 'Bread', done: true },
  { key: 'c', name: 'Cheese and a loaf of the seeded rye from the corner bakery', done: false },
];
// The @if's first arm is the Done badge, its second the Finish button.
const armOf = (task: Task): string => (task.done ? '0' : '1');
const rowTexts = (task: Task): ReadonlyMap<string, string> => new Map([[nameText, task.name], [doneText, 'Done'], [finishText, `Finish ${task.name}`]]);

/** The same page with the @if's arms right inside the row as <li>s of their own: a row's top boxes then include its arms' own. */
function armsOnTop(source: MarklessStyleInput): MarklessStyleInput {
  const li = source.nodes.find((n) => n.row === repeat.id && n.parent === repeat.parent)!;
  return { ...source, nodes: source.nodes.map((n) => (n.kind === 'element' && n.arm?.branch === branch.id && n.parent === li.id ? { ...n, element: 'li', parent: repeat.parent } : n)) };
}

/** The page as the web renders it with these tasks. */
const writtenOut = (source: MarklessStyleInput, tasks: readonly Task[]): MarklessStyleInput =>
  marklessWithRows(source, new Map([[repeat.id, tasks.map((task): MarklessRow => ({ key: task.key, states: { [branch.id]: armOf(task) }, texts: rowTexts(task) }))]]));

/** Each box of a variant tree (plan JSON) with its parent box. */
function parents(v: unknown, parent: string | null, out: Map<string, string | null>): void {
  if (Array.isArray(v)) {
    for (const item of v) parents(item, parent, out);
    return;
  }
  if (v === null || typeof v !== 'object') return;
  const o = v as Record<string, unknown>;
  const id = typeof o['id'] === 'string' ? (o['id'] as string) : null;
  if (id !== null) out.set(id, parent);
  for (const [k, value] of Object.entries(o)) if (k !== 'style') parents(value, id ?? parent, out);
}

/** The device's layout of these tasks on a target: each box in device px, absolute, by Dragon id, and the export's names. */
function deviceLayout(source: MarklessStyleInput, t: 'ios' | 'android', tasks: readonly Task[]) {
  const { exported } = marklessStyleExport(JSON.stringify(source), PATH, undefined, 'system', undefined, true);
  const x = exported.targets[t]!;
  const at = (arm: string): number => x.assignments.findIndex((a) => a.values[branch.id] === arm);
  const page = at(branch.initial);
  const names = new Map((x.planNames?.[page] ?? []).map(([d, m]) => [m, d]));
  const dragon = (id: string): string => names.get(id) ?? id;
  const line = JSON.stringify({
    assignment: page,
    dpr: x.dpr,
    viewport: x.viewport,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    plan: x.plan,
    rows: x.planRepeats!.map((r) => ({
      parent: r.parent,
      template: r.template,
      armed: r.armed ?? [],
      rows: tasks.map((task) => ({ key: task.key, assignment: at(armOf(task)), texts: [...rowTexts(task)].map(([id, text]) => [dragon(id), text]) })),
    })),
  });
  const out = JSON.parse(runMarklessRowsLayout(line, systemFontsFor(t, x.dpr).shaper as never)) as unknown[];
  if (out[0] !== 'ok') throw new Error(JSON.stringify(out));
  const boxes = new Map((out[2] as unknown[][]).map((n) => [n[0] as string, decode(n[1]) as number[]]));
  const tree = new Map<string, string | null>();
  for (const v of x.plan!.variants) parents((v as { root: unknown }).root, null, tree);
  const parentOf = (id: string): string | null => {
    const cut = id.indexOf('@');
    if (cut < 0) return tree.get(id) ?? null;
    const base = tree.get(id.slice(0, cut)) ?? null;
    return base === dragon(repeat.parent!) ? base : `${base}${id.slice(cut)}`;
  };
  const abs = (id: string): number[] => {
    const own = boxes.get(id)!;
    const p = parentOf(id);
    if (p === null || !boxes.has(p)) return own;
    const pa = abs(p);
    return [pa[0]! + own[0]!, pa[1]! + own[1]!, own[2]!, own[3]!];
  };
  return { x, exported, boxes, abs, dragon };
}

describe('styled @if arms inside @for rows', () => {
  it('exports the row\'s branch as a state of each row, and names the top boxes a row\'s own arm may hide', () => {
    expect(branch.row).toBe(repeat.id);
    const nested = marklessStyleExport(TEXT, PATH, undefined, 'system', undefined, true).exported.targets.android!;
    expect(nested.planRepeats![0]!.armed).toBeUndefined();
    const top = marklessStyleExport(JSON.stringify(armsOnTop(input)), PATH, undefined, 'system', undefined, true).exported.targets.android!;
    expect(top.planRepeats![0]!.template.length).toBe(3);
    expect(top.planRepeats![0]!.armed!.length).toBe(2);
  });

  it('writes each row out with only the arm its own item shows', () => {
    const written = writtenOut(input, TASKS);
    const ids = new Set(written.nodes.map((n) => n.id));
    const badge = input.nodes.find((n) => n.kind === 'element' && n.arm?.branch === branch.id && n.arm.index === 0)!.id;
    const finish = input.nodes.find((n) => n.kind === 'element' && n.arm?.branch === branch.id && n.arm.index === 1)!.id;
    expect([...['a', 'b', 'c'].map((k) => ids.has(`${badge}@${k}`))]).toEqual([false, true, false]);
    expect([...['a', 'b', 'c'].map((k) => ids.has(`${finish}@${k}`))]).toEqual([true, false, true]);
    expect(written.branches).toBeUndefined();
    expect(written.nodes.every((n) => n.arm === undefined)).toBe(true);
  });

  for (const [what, source] of [['inside the row\'s <li>', input], ['right inside the row', armsOnTop(input)]] as const)
    for (const t of ['ios', 'android'] as const)
      it(`lays the rows out on the ${t} device exactly as the build lays out the page with them written out, arms ${what}`, () => {
        const device = deviceLayout(source, t, TASKS);
        const written = writtenOut(source, TASKS);
        const built = marklessStyleExport(JSON.stringify(written), PATH, undefined, 'system').exported.targets[t]!;
        const a = built.assignments[0]!;
        const byId = new Map(a.nodes.map((n) => [n.id, n]));
        const absBuilt = (id: string): number[] => {
          const n = byId.get(id)!;
          const f = n.frame!;
          if (n.parent === null || !byId.has(n.parent) || byId.get(n.parent)!.frame === null) return [f.x, f.y, f.width, f.height];
          const p = absBuilt(n.parent);
          return [p[0]! + f.x, p[1]! + f.y, f.width, f.height];
        };
        let compared = 0;
        for (const n of written.nodes) {
          if (n.kind !== 'element' || byId.get(n.id)?.frame == null) continue;
          expect(device.abs(device.dragon(n.id)), `${t} ${n.id}`).toEqual(absBuilt(n.id));
          compared++;
        }
        expect(compared).toBe(written.nodes.filter((n) => n.kind === 'element').length);
        // A hidden arm has no copy: only the arm each row shows is laid out.
        expect([...device.boxes.keys()].filter((id) => id.includes('@')).length).toBeGreaterThan(0);
      });

  it('refuses a style that depends on a row\'s position in either arm, and a style outside the rows that follows a row\'s arm', () => {
    const withCss = (css: string): string => JSON.stringify({ ...JSON.parse(TEXT), css: `${input.css}\n${css}` });
    expect(() => marklessStyleExport(withCss('.task:first-child .finish { padding: 30px; }'), PATH, undefined, 'system', undefined, true)).toThrow("a style that depends on a row's position");
    expect(() => marklessStyleExport(withCss('.page:has(.done) { padding: 40px; }'), PATH, undefined, 'system', undefined, true)).toThrow("its style follows a row's own state");
  });

  it('refuses a row whose every top box is in its own arm, and a device line naming an armed box outside the template', () => {
    const top = armsOnTop(input);
    const li = top.nodes.find((n) => n.row === repeat.id && n.parent === repeat.parent && n.arm === undefined)!;
    const inLi = new Set([li.id, ...top.nodes.filter((n) => n.parent === li.id).map((n) => n.id)]);
    for (const n of top.nodes) if (n.parent !== null && inLi.has(n.parent)) inLi.add(n.id);
    const onlyArms = { ...top, nodes: top.nodes.filter((n) => !inLi.has(n.id)) };
    expect(() => marklessStyleExport(JSON.stringify(onlyArms), PATH, undefined, 'system', undefined, true)).toThrow('every box right inside its rows is in an arm');
    const { exported } = marklessStyleExport(TEXT, PATH, undefined, 'system', undefined, true);
    const x = exported.targets.android!;
    const r = x.planRepeats![0]!;
    const line = JSON.stringify({ assignment: 0, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan, rows: [{ parent: r.parent, template: r.template, armed: ['nope'], rows: [] }] });
    expect(runMarklessRowsLayout(line, systemFontsFor('android', x.dpr).shaper as never)).toContain('nope is not a box of the template');
  });

  for (const [what, source] of [['inside the row\'s <li>', input], ['right inside the row', armsOnTop(input)]] as const)
    for (const count of [1, 3])
      it(`lays ${count} row(s) out on the device where Chrome does, within 1 device px (Android), arms ${what}`, async () => {
        const tasks = TASKS.slice(0, count);
        const device = deviceLayout(source, 'android', tasks);
        const written = writtenOut(source, tasks);
        const browser: Browser = await launchChrome(device.x.dpr);
        try {
          const capture = await captureMarklessAssignment(browser, written, device.x, {}, 'light', { mode: 'system', files: new Map(), prepare: systemFontReference('android', device.exported.systemFonts ?? []) });
          const elements = new Set(written.nodes.filter((n) => n.kind === 'element').map((n) => n.id));
          const off: string[] = [];
          let seen = 0;
          for (const c of capture.nodes) {
            if (c.kind !== 'element' || !c.hasBox || !elements.has(c.id)) continue;
            seen++;
            const own = device.dragon(c.id);
            if (!device.boxes.has(own)) {
              off.push(`${c.id}: Chrome has a box, the device none`);
              continue;
            }
            const d = device.abs(own);
            const chrome = [c.x, c.y, c.width, c.height].map((v) => v * device.x.dpr);
            const delta = Math.max(...chrome.map((v, i) => Math.abs(v - d[i]!)));
            if (delta > GATE_DEVICE_PX) off.push(`${c.id}: Chrome ${JSON.stringify(chrome.map((v) => Math.round(v * 100) / 100))}, device ${JSON.stringify(d)}`);
          }
          expect(off).toEqual([]);
          expect(seen).toBe(elements.size);
        } finally {
          await browser.close();
        }
      });
});
