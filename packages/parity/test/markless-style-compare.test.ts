// The Chrome comparison of a Markless style export (packages/parity/src/markless-style-compare.ts): a box only one side has fails,
// as in native-compare.ts, so a node Chrome or the export drops cannot pass by not being compared.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BAND_KEY } from 'dragon';
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import type { MarklessStyleInput } from '../src/markless-style-input.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import type { ExportTarget, NativeStyleExport } from '../src/native-style-export.ts';
import { parseNativeStyleExport } from '../src/native-style-export.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/attributes.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const full = marklessStyleExport(TEXT, PATH).exported;
const ios = full.targets.ios;
if (ios === undefined) throw new Error('no ios target');
const exported: NativeStyleExport = { ...full, targets: { ios } };

describe('compareMarklessExport', () => {
  it('compares every box of the attributes rung within the gate', async () => {
    const r = await compareMarklessExport(input, exported);
    expect(r.rows.filter((x) => !x.pass)).toEqual([]);
    expect(r.failed).toBe(0);
    expect(r.compared).toBe(r.rows.length);
    expect(r.compared).toBeGreaterThan(0);
  }, 60_000);

  it('fails a box only Chrome or only the export has', async () => {
    // Chrome lays out no box for h2 or its text; the export drops h1:text0, gives h3:text0 no frame and adds a node Chrome lacks.
    // Only Chrome's document carries data-dragon-id, so the input still compiles to the export's states and bands.
    const hidden: MarklessStyleInput = { ...input, css: `${input.css}\nbutton[data-dragon-id="h2"] { display: none; }` };
    const edited: NativeStyleExport = {
      ...exported,
      targets: {
        ios: {
          ...ios,
          assignments: ios.assignments.map((a) => ({
            ...a,
            nodes: [
              ...a.nodes.filter((n) => n.id !== 'h1:text0').map((n) => (n.id === 'h3:text0' ? { ...n, frame: null } : n)),
              { id: 'ghost', parent: 'h0', kind: 'element', native: 'view', text: null, frame: { x: 0, y: 0, width: 3, height: 3 }, borderWidths: null, writes: [] },
            ],
          })),
        },
      },
    };
    const r = await compareMarklessExport(hidden, edited);
    const problems = r.rows.flatMap((x) => (x.problem === undefined ? [] : [`${JSON.stringify(x.values)} ${x.id}: ${x.problem}`]));
    const want = (liked: boolean): string[] => [
      `h1:text0: Chrome has a box but the export has no node`,
      `h2: Chrome generates no box but the export has a frame`,
      `h2:text0: Chrome generates no box but the export has a frame`,
      `h3:text0: Chrome has a box but the export has no frame`,
      `ghost: the export has a framed node Chrome does not have`,
    ].map((p) => `${JSON.stringify({ 'state:liked': liked })} ${p}`);
    expect(problems.sort()).toEqual([...want(false), ...want(true)].sort());
    expect(r.rows.every((x) => x.problem === undefined || (!x.pass && x.maxDeltaDevicePx === null))).toBe(true);
    // Hiding h2 also moves the boxes after it, which fail as measured rows.
    expect(r.failed).toBe(10 + r.rows.filter((x) => x.problem === undefined && !x.pass).length);
    expect(r.compared).toBe(r.rows.length - 10);
  }, 60_000);
});

describe('text nodes', () => {
  it('pairs Chrome\'s text boxes with the export\'s by Dragon\'s numbering, whatever the input calls them', async () => {
    const v = JSON.parse(TEXT) as Record<string, any>;
    v['nodes'] = [
      { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: {} },
      { kind: 'element', id: 'p0', element: 'p', parent: 'h0', attributes: {} },
      { kind: 'text', id: 'lead', parent: 'p0', text: ' ' },
      { kind: 'element', id: 'b0', element: 'b', parent: 'p0', attributes: {} },
      { kind: 'text', id: 'bold', parent: 'b0', text: 'bold' },
      { kind: 'text', id: 'gap', parent: 'p0', text: ' ' },
      { kind: 'element', id: 'b1', element: 'b', parent: 'p0', attributes: {} },
      { kind: 'text', id: 'more', parent: 'b1', text: 'more' },
      { kind: 'text', id: 'tail', parent: 'p0', text: 'tail' },
      { kind: 'element', id: 'component-edge:0', element: 'div', parent: 'h0', attributes: {} },
      { kind: 'text', id: 'edge', parent: 'component-edge:0', text: 'edge' },
    ];
    v['css'] = '';
    v['states'] = [];
    const text = JSON.stringify(v);
    const ws = marklessStyleExport(text, PATH).exported;
    const r = await compareMarklessExport(parseMarklessStyleInput(text), { ...ws, targets: { ios: ws.targets.ios! } });
    expect(r.rows.filter((x) => !x.pass)).toEqual([]);
    expect(r.rows.map((x) => x.id)).toEqual(expect.arrayContaining(['bold', 'gap', 'more', 'tail', 'edge']));
  }, 60_000);
});

describe('the export a comparison reads', () => {
  const withIos = (f: (t: ExportTarget) => ExportTarget): NativeStyleExport => ({ ...exported, targets: { ios: f(ios) } });

  it('refuses a target whose assignments are not one per combination of the input\'s states', async () => {
    await expect(compareMarklessExport(input, withIos((t) => ({ ...t, assignments: [] })))).rejects.toThrow('ios: the assignments are not one per combination of the input\'s states: missing [{"state:liked":false},{"state:liked":true}], extra or repeated []');
    await expect(compareMarklessExport(input, withIos((t) => ({ ...t, assignments: t.assignments.filter((a) => a.values['state:liked'] !== true) })))).rejects.toThrow('missing [{"state:liked":true}]');
    await expect(compareMarklessExport(input, withIos((t) => ({ ...t, assignments: [...t.assignments, t.assignments[0]!] })))).rejects.toThrow('missing [], extra or repeated [{"state:liked":false}]');
    await expect(compareMarklessExport(input, withIos((t) => ({ ...t, assignments: t.assignments.map((a) => ({ ...a, values: { ...a.values, 'state:other': false } })) })))).rejects.toThrow('does not set exactly state:liked');
    await expect(compareMarklessExport(input, withIos((t) => ({ ...t, states: [] })))).rejects.toThrow('ios: states [] are not the input\'s states');
  });

  it('refuses a target that leaves out a band', async () => {
    const appPath = 'examples/markless-styles/input/app-settings.native-style-input.json';
    const appText = readFileSync(repoPath(appPath), 'utf8');
    const app = marklessStyleExport(appText, appPath).exported;
    const t = app.targets.ios!;
    const dropped: NativeStyleExport = { ...app, targets: { ios: { ...t, assignments: t.assignments.filter((a) => a.values[BAND_KEY] !== 1) } } };
    await expect(compareMarklessExport(parseMarklessStyleInput(appText), dropped)).rejects.toThrow(`and bands: missing [{"state:on":false,"${BAND_KEY}":1},{"state:on":true,"${BAND_KEY}":1}]`);
  });

  it('refuses an export without the bands the input\'s @media compiles to, so the dark band is never left uncompared', async () => {
    const appPath = 'examples/markless-styles/input/app-settings.native-style-input.json';
    const appText = readFileSync(repoPath(appPath), 'utf8');
    const app = marklessStyleExport(appText, appPath).exported;
    const { bands: _bands, ...t } = app.targets.ios!;
    const lightOnly: ExportTarget = {
      ...t,
      states: t.states.filter((s) => s.key !== BAND_KEY),
      assignments: t.assignments.filter((a) => a.values[BAND_KEY] === 0).map((a) => ({ ...a, values: Object.fromEntries(Object.entries(a.values).filter(([k]) => k !== BAND_KEY)) })),
    };
    const parsed = parseNativeStyleExport(JSON.stringify({ ...app, targets: { ios: lightOnly } }));
    await expect(compareMarklessExport(parseMarklessStyleInput(appText), parsed)).rejects.toThrow('ios: states');
    const ios0 = app.targets.ios!;
    const relabelled: NativeStyleExport = { ...app, targets: { ios: { ...ios0, bands: { ...ios0.bands!, conditions: ios0.bands!.conditions.map(() => 'all') } } } };
    await expect(compareMarklessExport(parseMarklessStyleInput(appText), relabelled)).rejects.toThrow('ios: bands');
  });

  it('reads an export file only when every field the comparison reads is well formed', () => {
    const text = JSON.stringify(full);
    expect(parseNativeStyleExport(text)).toEqual(full);
    const edit = (f: (v: Record<string, any>) => void): string => {
      const v = JSON.parse(text) as Record<string, any>;
      f(v);
      return JSON.stringify(v);
    };
    expect(() => parseNativeStyleExport(edit((v) => { v['schema'] = 'dragon.native-style-export/0'; }))).toThrow('not dragon.native-style-export/1');
    expect(() => parseNativeStyleExport(edit((v) => { v['targets']['web'] = v['targets']['ios']; }))).toThrow('target web is neither ios nor android');
    expect(() => parseNativeStyleExport(edit((v) => { delete v['targets']['ios']['assignments']; }))).toThrow('ios: assignments is not a list');
    expect(() => parseNativeStyleExport(edit((v) => { v['targets']['ios']['assignments'][0]['nodes'][2]['frame'] = { x: 0 }; }))).toThrow('ios: assignment 0 node h0 has a frame that is not null or x, y, width and height');
    expect(() => parseNativeStyleExport(edit((v) => { v['targets']['ios']['assignments'][1]['nodes'].push(v['targets']['ios']['assignments'][1]['nodes'][3]); }))).toThrow('ios: assignment 1 lists node h1 twice');
    expect(() => parseNativeStyleExport(edit((v) => { v['targets']['ios']['assignments'][0]['nodes'][3]['parent'] = 'h9'; }))).toThrow('ios: assignment 0 node h1 has parent h9');
    expect(() => parseNativeStyleExport(edit((v) => { v['targets']['android']['dpr'] = '3'; }))).toThrow('android: dpr is not a positive number');
  });

  it('the CLI exits 1 naming the problem for an export that leaves out a state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'markless-style-compare-'));
    try {
      const exportPath = join(dir, 'export.json');
      writeFileSync(exportPath, JSON.stringify(withIos((t) => ({ ...t, assignments: [] }))));
      const r = spawnSync(process.execPath, ['--conditions=dragon-internal', repoPath('packages/parity/src/cli/markless-style-compare.ts'), repoPath(PATH), exportPath, join(dir, 'report.json')], { encoding: 'utf8' });
      expect(r.stderr).toContain('ios: the assignments are not one per combination');
      expect(r.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
