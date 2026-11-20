// Styled @for rows: Dragon lays one row out as a template; a phone copies it once per row (harness.ts runMarklessRowsLayout, which
// the hosts run translated) and shapes the rows' own text. Each row count below is compared with Chrome laying out the same rows.
// The input is the one @markless/mobile writes for its S21 rung: a list of notes whose class its item decides.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { launchChrome } from '../src/chrome.ts';
import { captureMarklessAssignment } from '../src/markless-style-compare.ts';
import type { MarklessStyleInput } from '../src/markless-style-input.ts';
import { marklessStyleExport, parseMarklessStyleInput, valueUnder } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';
import { systemFontReference } from '../src/system-fonts/reference.ts';
import { systemFontsFor } from '../src/system-fonts/provider.ts';
import { GATE_DEVICE_PX } from '../src/compare.ts';

const { runMarklessRowsLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessRowsLayout(line: string, shaper: { shape: (...a: never[]) => readonly number[] }): string };
const { hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { hexBits(s: string): number };
const decode = (v: unknown): unknown => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? hexBits(v) : Array.isArray(v) ? v.map(decode) : v);

const PATH = 'examples/markless-styles/input/rows.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const repeat = input.repeats![0]!;
const rowState = input.states.find((s) => s.row === repeat.id)!;
const branch = input.branches![0]!;
const titleText = input.nodes.find((n) => n.kind === 'text' && n.row === repeat.id)!.id;
const pinnedOption = (pinned: boolean): string => {
  const li = input.nodes.find((n) => n.kind === 'element' && n.row === repeat.id && n.classByState !== undefined)!;
  if (li.kind !== 'element') throw new Error('no row element');
  return li.classByState!.find((e) => (e.value ?? '').split(' ').includes('pinned') === pinned)!.when[rowState.cell] as string;
};

type Row = { readonly key: string; readonly title: string; readonly pinned: boolean };
const ROWS: readonly Row[] = [
  { key: 'a', title: 'Groceries', pinned: false },
  { key: 'b', title: 'Call the plumber about the kitchen tap before Friday', pinned: true },
  { key: 'c', title: 'Water   the\nplants', pinned: false },
];

/** The page as the web renders it with these rows: each row's nodes named "<id>@<key>", its class its item's, its text its own. */
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
      const values = { [rowState.cell]: pinnedOption(row.pinned) };
      for (const t of input.nodes.filter((x) => x.row === repeat.id)) {
        const top = t.parent === repeat.parent;
        const parent = top ? t.parent : `${t.parent}@${row.key}`;
        const arm = repeat.arm !== undefined ? { arm: repeat.arm } : {};
        if (t.kind === 'text') nodes.push({ kind: 'text', id: `${t.id}@${row.key}`, parent: parent as string, text: t.id === titleText ? row.title : t.text, ...arm });
        else {
          const cls = t.classByState === undefined ? t.attributes['class'] : valueUnder(t.classByState, values, t.id);
          const attributes = { ...t.attributes };
          delete attributes['class'];
          if (cls !== null && cls !== undefined) attributes['class'] = cls;
          nodes.push({ kind: 'element', id: `${t.id}@${row.key}`, element: t.element, parent, attributes, ...arm });
        }
      }
    }
  }
  const { repeats: _, ...rest } = input;
  return { ...rest, nodes, states: input.states.filter((s) => s.row === undefined) };
}

/** Each box of a variant tree (plan JSON) with its parent box, rows spliced in by the device's naming rule. */
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

describe('styled @for rows', () => {
  const { exported } = marklessStyleExport(TEXT, PATH, undefined, 'system', undefined, true);

  it('exports each list with its parent box and the ids of one row, and a state per row for the class its item decides', () => {
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t]!;
      expect(x.planRepeats).toEqual([{ id: repeat.id, parent: repeat.parent, template: input.nodes.filter((n) => n.row === repeat.id && n.parent === repeat.parent).map((n) => n.id) }]);
      expect(x.states.map((s) => s.key)).toContain(rowState.cell);
    }
  });

  /** The device's layout of these rows on a target: its boxes in device px, absolute, by id. */
  function deviceBoxes(t: 'ios' | 'android', rows: readonly Row[]): { readonly abs: (id: string) => number[]; readonly ids: readonly string[]; readonly names: ReadonlyMap<string, string> } {
    const x = exported.targets[t]!;
    const shown = rows.length === 0 ? '0' : '1';
    const at = (option: string): number => x.assignments.findIndex((a) => a.values[branch.id] === shown && a.values[rowState.cell] === option);
    const page = at(rowState.initial as string);
    const names = new Map((x.planNames?.[page] ?? []).map(([d, m]) => [m, d]));
    const line = JSON.stringify({
      assignment: page,
      dpr: x.dpr,
      viewport: x.viewport,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      plan: x.plan,
      rows: x.planRepeats!.map((r) => ({ parent: r.parent, template: r.template, rows: rows.map((row) => ({ key: row.key, assignment: at(pinnedOption(row.pinned)), texts: [[names.get(titleText) ?? titleText, row.title]] })) })),
    });
    const out = JSON.parse(runMarklessRowsLayout(line, systemFontsFor(t, x.dpr).shaper as never)) as unknown[];
    if (out[0] !== 'ok') throw new Error(JSON.stringify(out));
    const boxes = new Map((out[2] as unknown[][]).map((n) => [n[0] as string, decode(n[1]) as number[]]));
    const tree = new Map<string, string | null>();
    parents((x.plan!.variants[x.plan!.assignments[page]!.variant] as { root: unknown }).root, null, tree);
    const parentOf = (id: string): string | null => {
      const cut = id.indexOf('@');
      if (cut < 0) return tree.get(id) ?? null;
      const base = tree.get(id.slice(0, cut)) ?? null;
      return base === repeat.parent ? base : `${base}${id.slice(cut)}`;
    };
    const abs = (id: string): number[] => {
      const own = boxes.get(id)!;
      const p = parentOf(id);
      if (p === null || !boxes.has(p)) return own;
      const pa = abs(p);
      return [pa[0]! + own[0]!, pa[1]! + own[1]!, own[2]!, own[3]!];
    };
    return { abs, ids: [...boxes.keys()], names };
  }

  for (const t of ['ios', 'android'] as const) {
    it(`lays 3 rows out on the ${t} device exactly as the build lays out the page with those rows written out`, () => {
      const rows = ROWS;
      const device = deviceBoxes(t, rows);
      const built = marklessStyleExport(JSON.stringify(writtenOut(rows)), PATH, undefined, 'system').exported.targets[t]!;
      const a = built.assignments.find((x) => x.values[branch.id] === '1')!;
      const byId = new Map(a.nodes.map((n) => [n.id, n]));
      const absBuilt = (id: string): number[] => {
        const n = byId.get(id)!;
        const f = n.frame!;
        if (n.parent === null || !byId.has(n.parent) || byId.get(n.parent)!.frame === null) return [f.x, f.y, f.width, f.height];
        const p = absBuilt(n.parent);
        return [p[0]! + f.x, p[1]! + f.y, f.width, f.height];
      };
      const elements = writtenOut(rows).nodes.filter((n) => n.kind === 'element').map((n) => n.id);
      let compared = 0;
      for (const id of elements) {
        const n = byId.get(id);
        if (n === undefined || n.frame === null) continue;
        expect(device.abs(device.names.get(id) ?? id), `${t} ${id}`).toEqual(absBuilt(id));
        compared++;
      }
      // Every element the page shows: the empty list's message sits in the arm 3 rows hide.
      expect(compared).toBe(elements.filter((id) => (byId.get(id)?.frame ?? null) !== null).length);
      expect(compared).toBeGreaterThanOrEqual(10);
    });
  }

  it('refuses a style that depends on a row\'s position, and a style outside the rows that follows a row\'s own state', () => {
    const withCss = (css: string): string => JSON.stringify({ ...JSON.parse(TEXT), css: `${input.css}\n${css}` });
    expect(() => marklessStyleExport(withCss('.note:first-child { padding: 30px; }'), PATH, undefined, 'system', undefined, true)).toThrow("a style that depends on a row's position");
    expect(() => marklessStyleExport(withCss('.note + .note { margin-top: 30px; }'), PATH, undefined, 'system', undefined, true)).toThrow("a style that depends on a row's position");
    expect(() => marklessStyleExport(withCss('.page:has(.pinned) { padding: 40px; }'), PATH, undefined, 'system', undefined, true)).toThrow("its style follows a row's own state");
  });

  for (const count of [0, 1, 3]) {
    it(`lays ${count} row(s) out on the device where Chrome does, within 1 device px (Android)`, async () => {
      const x = exported.targets.android!;
      const rows = ROWS.slice(0, count);
      const shown = count === 0 ? '0' : '1';
      const at = (option: string): number => x.assignments.findIndex((a) => a.values[branch.id] === shown && a.values[rowState.cell] === option);
      const page = at(rowState.initial as string);
      const names = new Map((x.planNames?.[page] ?? []).map(([d, m]) => [m, d]));
      const line = JSON.stringify({
        assignment: page,
        dpr: x.dpr,
        viewport: x.viewport,
        safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
        plan: x.plan,
        rows: x.planRepeats!.map((r) => ({ parent: r.parent, template: r.template, rows: rows.map((row) => ({ key: row.key, assignment: at(pinnedOption(row.pinned)), texts: [[names.get(titleText) ?? titleText, row.title]] })) })),
      });
      const system = systemFontsFor('android', x.dpr);
      // The device's shaper for text the build did not record: the platform's own, as the build shapes system faces.
      const out = JSON.parse(runMarklessRowsLayout(line, system.shaper as never)) as unknown[];
      expect(out[0], JSON.stringify(out)).toBe('ok');
      const boxes = new Map((out[2] as unknown[][]).map((n) => [n[0] as string, decode(n[1]) as number[]]));
      // The spliced tree's parents: the page variant's own, each row's copy under its own copies or the list's parent.
      const tree = new Map<string, string | null>();
      parents((x.plan!.variants[x.plan!.assignments[page]!.variant] as { root: unknown }).root, null, tree);
      const parentOf = (id: string): string | null => {
        const at = id.indexOf('@');
        if (at < 0) return tree.get(id) ?? null;
        const base = tree.get(id.slice(0, at)) ?? null;
        return base === repeat.parent ? base : `${base}${id.slice(at)}`;
      };
      const absolute = (id: string): number[] => {
        const own = boxes.get(id)!;
        const p = parentOf(id);
        if (p === null || !boxes.has(p)) return own;
        const pa = absolute(p);
        return [pa[0]! + own[0]!, pa[1]! + own[1]!, own[2]!, own[3]!];
      };
      const written = writtenOut(rows);
      const browser: Browser = await launchChrome(x.dpr);
      try {
        const capture = await captureMarklessAssignment(browser, written, x, { [branch.id]: shown }, 'light', { mode: 'system', files: new Map(), prepare: systemFontReference('android', exported.systemFonts ?? []) });
        const elements = written.nodes.filter((n) => n.kind === 'element').map((n) => n.id);
        const off: string[] = [];
        const seen: string[] = [];
        for (const c of capture.nodes) {
          if (c.kind !== 'element' || !c.hasBox || !elements.includes(c.id)) continue;
          seen.push(c.id);
          const own = names.get(c.id) ?? c.id;
          if (!boxes.has(own)) {
            off.push(`${c.id}: Chrome has a box, the device none`);
            continue;
          }
          const d = absolute(own);
          const chrome = [c.x, c.y, c.width, c.height].map((v) => v * x.dpr);
          const delta = Math.max(...chrome.map((v, i) => Math.abs(v - d[i]!)));
          if (delta > GATE_DEVICE_PX) off.push(`${c.id}: Chrome ${JSON.stringify(chrome.map((v) => Math.round(v * 100) / 100))}, device ${JSON.stringify(d)}`);
        }
        expect(off).toEqual([]);
        expect(seen.length).toBeGreaterThan(4);
        for (const row of rows) expect(boxes.has(`${input.nodes.find((n) => n.row === repeat.id && n.parent === repeat.parent)!.id}@${row.key}`)).toBe(true);
      } finally {
        await browser.close();
      }
    });
  }
});
