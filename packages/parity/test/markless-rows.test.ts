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

const EDGE_ROWS: readonly Row[] = [
  { key: 'a', title: 'Buy milk ', pinned: false },
  { key: 'b', title: '\n  Call the plumber about the kitchen tap before Friday\t', pinned: true },
  { key: 'c', title: '', pinned: false },
  { key: 'd', title: '   ', pinned: true },
  { key: 'e', title: 'Water the plants', pinned: false },
];

/** The page as the web renders it with these rows: each row's nodes named "<id>@<key>", its class its item's, its text its own. */
function writtenOut(rows: readonly Row[], css = '', page: ReadonlyMap<string, string> = new Map()): MarklessStyleInput {
  const nodes: MarklessStyleInput['nodes'][number][] = [];
  let placed = false;
  for (const n of input.nodes) {
    if (n.row !== repeat.id) {
      nodes.push(n.kind === 'text' && page.has(n.id) ? { ...n, text: page.get(n.id)! } : n);
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
  return { ...rest, css: `${input.css}${css}`, nodes, states: input.states.filter((s) => s.row === undefined) };
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
  function deviceBoxes(t: 'ios' | 'android', rows: readonly Row[], x = exported.targets[t]!, pageTexts: ReadonlyMap<string, string> = new Map()): { readonly abs: (id: string) => number[]; readonly ids: readonly string[]; readonly names: ReadonlyMap<string, string> } {
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
      ...(pageTexts.size > 0 ? { texts: [...pageTexts].map(([id, text]) => [names.get(id) ?? id, text]) } : {}),
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
    it(`lays 3 rows out on the ${t} device exactly as the build lays out the page with those rows written out`, () => expectAsBuilt(t, ROWS));
    // A title alone in its box: the build drops the white space at its edges, and drops an empty one.
    it(`lays rows whose titles have edge white space, or none, out on the ${t} device exactly as the build does`, () => expectAsBuilt(t, EDGE_ROWS));
    // A pinned row taller than the others: the list, and the boxes after and around it, move as the build places them.
    it(`lays a taller pinned row out on the ${t} device exactly as the build does`, () => expectAsBuilt(t, ROWS, '.note.pinned { padding: 18px; }'));
  }

  function expectAsBuilt(t: 'ios' | 'android', rows: readonly Row[], css = '', page: ReadonlyMap<string, string> = new Map()): void {
    {
      const device = deviceBoxes(t, rows, css === '' ? exported.targets[t]! : marklessStyleExport(withCss(css), PATH, undefined, 'system', undefined, true).exported.targets[t]!, page);
      const written = writtenOut(rows, css === '' ? '' : `\n${css}`, page);
      const built = marklessStyleExport(JSON.stringify(written), PATH, undefined, 'system').exported.targets[t]!;
      const a = built.assignments.find((x) => x.values[branch.id] === '1')!;
      const byId = new Map(a.nodes.map((n) => [n.id, n]));
      const absBuilt = (id: string): number[] => {
        const n = byId.get(id)!;
        const f = n.frame!;
        if (n.parent === null || !byId.has(n.parent) || byId.get(n.parent)!.frame === null) return [f.x, f.y, f.width, f.height];
        const p = absBuilt(n.parent);
        return [p[0]! + f.x, p[1]! + f.y, f.width, f.height];
      };
      const elements = written.nodes.filter((n) => n.kind === 'element').map((n) => n.id);
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
    }
  }

  const pageText = (text: string): string => input.nodes.find((n) => n.kind === 'text' && n.row === undefined && n.text === text)!.id;
  for (const t of ['ios', 'android'] as const) {
    // A page text that follows state with no finite domain: the host gives its current string, and the page is laid out around it.
    it(`lays the page out on the ${t} device around page texts given at run time, as the build lays out the page written with them`, () =>
      expectAsBuilt(t, ROWS, '', new Map([
        [pageText('Notes'), 'Notes about the kitchen, the garden and everything else that needs doing this week'],
        [pageText('Add note'), 'Add another   note'],
      ])));
  }

  it('refuses a page text for a leaf it does not have, or for a leaf inside a list\'s rows', () => {
    const x = exported.targets.ios!;
    const page = x.assignments.findIndex((a) => a.values[branch.id] === '1' && a.values[rowState.cell] === rowState.initial);
    const names = new Map((x.planNames?.[page] ?? []).map(([d, m]) => [m, d]));
    const run = (texts: unknown): unknown[] =>
      JSON.parse(runMarklessRowsLayout(JSON.stringify({ assignment: page, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan, rows: x.planRepeats!.map((r) => ({ parent: r.parent, template: r.template, rows: [{ key: 'a', assignment: page, texts: [] }] })), texts }), systemFontsFor('ios', x.dpr).shaper as never)) as unknown[];
    expect(run([['nope', 'x']])).toEqual(['harness-error', '$.texts: nope is no text leaf of the page outside its lists\' rows']);
    expect(run([[names.get(titleText) ?? titleText, 'x']])[0]).toBe('harness-error');
    expect(run([[names.get(pageText('Notes')) ?? pageText('Notes'), 'x'], [names.get(pageText('Notes')) ?? pageText('Notes'), 'y']])[1]).toContain('is given twice');
  });

  const withCss = (css: string): string => JSON.stringify({ ...JSON.parse(TEXT), css: `${input.css}\n${css}` });

  it('refuses a page text for a leaf the build lays out with a text-transform, in any band, and keeps the others', () => {
    expect(exported.targets.ios!.plan!.transformed).toBeUndefined();
    for (const css of ['.heading.mk-1gmxfth { text-transform: uppercase; }', '@media (min-width: 600px) { .heading.mk-1gmxfth { text-transform: uppercase; } }']) {
      const x = marklessStyleExport(withCss(css), PATH, undefined, 'system', undefined, true).exported.targets.ios!;
      const page = x.assignments.findIndex((a) => a.values[branch.id] === '1' && a.values[rowState.cell] === rowState.initial);
      const names = new Map((x.planNames?.[page] ?? []).map(([d, m]) => [m, d]));
      const run = (id: string): unknown[] =>
        JSON.parse(runMarklessRowsLayout(JSON.stringify({ assignment: page, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan, rows: x.planRepeats!.map((r) => ({ parent: r.parent, template: r.template, rows: [] })), texts: [[names.get(id) ?? id, 'Notes about the kitchen']] }), systemFontsFor('ios', x.dpr).shaper as never)) as unknown[];
      const heading = names.get(pageText('Notes')) ?? pageText('Notes');
      expect(run(pageText('Notes')), css).toEqual(['harness-error', `$.texts: ${heading} is laid out with a text-transform, which a phone does not apply to the text it is given`]);
      expect(run(pageText('Add note'))[0], css).toBe('ok');
    }
  });

  it('refuses a style that depends on a row\'s position, and a style outside the rows that follows a row\'s own state', () => {
    expect(() => marklessStyleExport(withCss('.note:first-child { padding: 30px; }'), PATH, undefined, 'system', undefined, true)).toThrow("a style that depends on a row's position");
    expect(() => marklessStyleExport(withCss('.note + .note { margin-top: 30px; }'), PATH, undefined, 'system', undefined, true)).toThrow("a style that depends on a row's position");
    expect(() => marklessStyleExport(withCss('.page:has(.pinned) { padding: 40px; }'), PATH, undefined, 'system', undefined, true)).toThrow("its style follows a row's own state");
  });

  it('keeps a row state that changes the row\'s size: the boxes after and around the list move, and the rows layout places them', () => {
    expect(() => marklessStyleExport(withCss('.note.pinned { padding: 18px; }'), PATH, undefined, 'system', undefined, true)).not.toThrow();
  });

  it('refuses a position a third row or later first reaches, and a position under a row state other than the initial one', () => {
    for (const css of ['.note:nth-child(3) { margin-top: 40px; }', '.note:nth-child(n+3) { margin-top: 40px; }', '.note ~ .note ~ .note { margin-top: 40px; }', '.note:not(.pinned):first-child { background: #ff0000; }', '.notes > :is(:nth-last-child(4)) { padding: 30px; }', '.note:has(~ .note:not(.pinned)) { background: #ff0000; }', '@media (min-width: 600px) { .note:nth-child(3) { margin-top: 40px; } }']) {
      expect(() => marklessStyleExport(withCss(css), PATH, undefined, 'system', undefined, true), css).toThrow("a style that depends on a row's position");
    }
  });

  it('refuses a row styled by another row\'s own state', () => {
    expect(() => marklessStyleExport(withCss('.notes:has(> .pinned) > .note { background: #ff0000; }'), PATH, undefined, 'system', undefined, true)).toThrow("a style that depends on a row's position or on another row");
  });

  it('keeps a position test that reaches no child of a list\'s parent', () => {
    expect(() => marklessStyleExport(withCss('.heading:first-child { margin-top: 0; } .action + .action { margin-top: 4px; }'), PATH, undefined, 'system', undefined, true)).not.toThrow();
  });

  it('refuses edge white space and an empty text beside other inline content, where the build\'s result depends on it', () => {
    const o = JSON.parse(TEXT) as { nodes: Record<string, unknown>[] };
    const at = o.nodes.findIndex((n) => n['id'] === titleText);
    o.nodes.splice(at + 1, 0, { kind: 'element', id: 'h6b', element: 'b', parent: 'h6', attributes: {}, row: repeat.id }, { kind: 'text', id: 'h6b:text0', parent: 'h6b', text: '!', row: repeat.id });
    const x = marklessStyleExport(JSON.stringify(o), PATH, undefined, 'system', undefined, true).exported.targets.android!;
    const page = x.assignments.findIndex((a) => a.values[branch.id] === '1' && a.values[rowState.cell] === rowState.initial);
    const leaf = new Map((x.planNames?.[page] ?? []).map(([d, m]) => [m, d])).get(titleText) ?? titleText;
    for (const [title, detail] of [[' Groceries', 'begins with white space beside other inline content'], ['Groceries ', 'ends with white space beside other inline content'], ['', 'is empty']] as const) {
      const out = JSON.parse(rowsLine(x, rowState.initial as string, [{ key: 'a', option: pinnedOption(false), texts: [[leaf, title]] }])) as unknown[];
      expect(out[0], JSON.stringify(out)).toBe('harness-error');
      expect(out[1], JSON.stringify(title)).toContain(detail);
    }
    expect((JSON.parse(rowsLine(x, rowState.initial as string, [{ key: 'a', option: pinnedOption(false), texts: [[leaf, 'Buy  milk']] }])) as unknown[])[0]).toBe('ok');
  });

  it('refuses a transition or animation inside a row, which the animator runs only for the page, and keeps one outside the rows', () => {
    const appear = '@keyframes appear { from { background-color: #000000; } to { background-color: #ffffff; } } ';
    expect(() => marklessStyleExport(withCss(`${appear}.note.mk-1gmxfth { animation: appear 1s; }`), PATH, undefined, 'system', undefined, true)).toThrow('inside a @for row');
    expect(() => marklessStyleExport(withCss('.note.mk-1gmxfth { transition: background-color 1s; }'), PATH, undefined, 'system', undefined, true)).toThrow('inside a @for row');
    expect(() => marklessStyleExport(withCss(`${appear}.heading.mk-1gmxfth { animation: appear 1s; }`), PATH, undefined, 'system', undefined, true)).not.toThrow();
  });

  it('refuses a row\'s text the build transforms, from the computed text-transform', () => {
    expect(() => marklessStyleExport(withCss('.title.mk-1gmxfth { text-transform: uppercase; }'), PATH, undefined, 'system', undefined, true)).toThrow('text-transform: uppercase is not supported yet');
    expect(() => marklessStyleExport(withCss('.notes.mk-1gmxfth { text-transform: lowercase; }'), PATH, undefined, 'system', undefined, true)).toThrow('text-transform: lowercase is not supported yet');
    expect(() => marklessStyleExport(withCss('.heading.mk-1gmxfth { text-transform: uppercase; }'), PATH, undefined, 'system', undefined, true)).not.toThrow();
    // Only in an @media band the phone switches to at run time, not the one the build lays out in.
    for (const css of ['@media (prefers-color-scheme: dark) { .title.mk-1gmxfth { text-transform: uppercase; } }', '@media (min-width: 600px) { .title.mk-1gmxfth { text-transform: uppercase; } }']) {
      expect(() => marklessStyleExport(withCss(css), PATH, undefined, 'system', undefined, true), css).toThrow('text-transform: uppercase');
    }
  });

  it('refuses a style that depends on how many rows a list holds, and keeps a :has() inside a row', () => {
    for (const css of ['.notes.mk-1gmxfth:has(> .note) { padding: 12px; }', '.notes:empty { display: none; }', '.page:not(:has(.note)) { padding: 0; }', 'main:has(.title) { padding: 30px; }', 'body:has(.note) { margin: 4px; }', '.heading.mk-1gmxfth:has(~ .notes .note) { margin-bottom: 20px; }', '.empty:has(+ .notes > .note) { display: none; }', ':is(.heading:has(~ .notes li)) { margin-bottom: 20px; }', '.notes:empty + .action { margin-top: 0; }', '.title:empty { display: none; }', '@media (prefers-color-scheme: dark) { .notes:has(> .note) { padding: 12px; } }']) {
      expect(() => marklessStyleExport(withCss(css), PATH, undefined, 'system', undefined, true), css).toThrow('a style that depends on how many rows a list has');
    }
    expect(() => marklessStyleExport(withCss('.note:has(.title) { gap: 4px; } .page:has(.heading) { padding: 20px; } .notes ~ .action { margin-top: 14px; } .heading:has(~ .action) { margin-bottom: 6px; }'), PATH, undefined, 'system', undefined, true)).not.toThrow();
  });

  it('refuses two lists in one parent by name', () => {
    const o = JSON.parse(TEXT) as { repeats: { id: string; parent: string | null }[] };
    o.repeats.push({ id: 'repeat:1', parent: repeat.parent });
    expect(() => parseMarklessStyleInput(JSON.stringify(o))).toThrow('two lists in one parent are not supported yet');
  });

  /** A rows layout line on Android at the page assignment whose row state is `pageOption`, with `extra` replacing parts of it. */
  function rowsLine(x: NonNullable<typeof exported.targets.android>, pageOption: string, rows: readonly { key: string; option: string; texts: readonly (readonly [string, string])[] }[], extra: (line: Record<string, unknown>) => void = () => {}): string {
    const at = (option: string): number => x.assignments.findIndex((a) => a.values[branch.id] === '1' && a.values[rowState.cell] === option);
    const line: Record<string, unknown> = {
      assignment: at(pageOption),
      dpr: x.dpr,
      viewport: x.viewport,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      plan: x.plan,
      rows: x.planRepeats!.map((r) => ({ parent: r.parent, template: r.template, rows: rows.map((row) => ({ key: row.key, assignment: at(row.option), texts: row.texts })) })),
    };
    extra(line);
    return runMarklessRowsLayout(JSON.stringify(line), systemFontsFor('android', x.dpr).shaper as never);
  }

  it('paints each row copy\'s dashed borders from the row\'s own assignment, not the page\'s', () => {
    const x = marklessStyleExport(withCss('.note.pinned.mk-1gmxfth { border-style: dashed; border-radius: 0; }'), PATH, undefined, 'system', undefined, true).exported.targets.android!;
    const li = x.planRepeats![0]!.template[0]!;
    for (const page of [pinnedOption(true), pinnedOption(false)]) {
      const out = JSON.parse(rowsLine(x, page, [{ key: 'a', option: pinnedOption(false), texts: [] }, { key: 'b', option: pinnedOption(true), texts: [] }])) as unknown[];
      expect(out[0], JSON.stringify(out)).toBe('ok');
      const ops = new Map((out[2] as unknown[][]).map((n) => [n[0] as string, n[4]]));
      expect(ops.get(`${li}@a`), `page ${page}, unpinned row`).toBeNull();
      expect(ops.get(`${li}@b`), `page ${page}, pinned row`).not.toBeNull();
    }
  });

  it('refuses by name what the phone cannot lay out as the build does', () => {
    const x = exported.targets.android!;
    const page = x.assignments.findIndex((a) => a.values[branch.id] === '1' && a.values[rowState.cell] === rowState.initial);
    const leaf = new Map((x.planNames?.[page] ?? []).map(([d, m]) => [m, d])).get(titleText) ?? titleText;
    const some = [{ key: 'a', option: pinnedOption(false), texts: [] }];
    const one = (texts: readonly (readonly [string, string])[]): { key: string; option: string; texts: readonly (readonly [string, string])[] } => ({ key: 'a', option: pinnedOption(false), texts });
    const err = (out: string): string => {
      const v = JSON.parse(out) as unknown[];
      expect(v[0], out).toBe('harness-error');
      return v[1] as string;
    };
    expect(err(rowsLine(x, rowState.initial as string, [one([[leaf, 'A']]), { ...one([[leaf, 'B']]), key: 'a' }]))).toContain('row key a is listed twice');
    expect(err(rowsLine(x, rowState.initial as string, [one([['h6:text0-not-a-leaf', 'A']])]))).toContain('is no text leaf of the row\'s template');
    expect(err(rowsLine(x, rowState.initial as string, [one([[leaf, 'A'], [leaf, 'B']])]))).toContain('is given twice');
    expect(err(rowsLine(x, rowState.initial as string, [one([[leaf, 'a\u200b\nb']])]))).toContain('U+200B');
    expect(err(rowsLine(x, rowState.initial as string, [one([])], (line) => {
      const rows = line['rows'] as Record<string, unknown>[];
      line['rows'] = [rows[0], rows[0]];
    }))).toContain('holds two lists');
    expect(err(rowsLine(x, rowState.initial as string, some, (line) => {
      (line['rows'] as Record<string, unknown>[])[0]!['parent'] = 'no-such-box';
    }))).toContain('the page has no box no-such-box');
    const preLine = marklessStyleExport(withCss('.title.mk-1gmxfth { white-space: pre-line; }'), PATH, undefined, 'system', undefined, true).exported.targets.android!;
    expect(err(rowsLine(preLine, rowState.initial as string, [one([[leaf, 'Water\tthe\r\nplants']])]))).toContain('preserve-breaks');
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
