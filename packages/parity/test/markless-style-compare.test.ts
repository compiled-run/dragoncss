// The Chrome comparison of a Markless style export (packages/parity/src/markless-style-compare.ts): a box only one side has fails,
// as in native-compare.ts, so a node Chrome or the export drops cannot pass by not being compared.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BAND_KEY } from 'dragon';
import { launchChrome, openPage } from '../src/chrome.ts';
import { describe, expect, it } from 'vitest';
import { authoredFontHtml } from '../src/cases.ts';
import type { DocumentNode } from '../src/markless-style-compare.ts';
import { captureMarklessAssignment, compareMarklessExport, documentMismatch, marklessDocumentHtml, readDocumentTree } from '../src/markless-style-compare.ts';
import type { MarklessStyleInput } from '../src/markless-style-input.ts';
import { MARKLESS_DOCUMENT_CSS, marklessNodeId, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import type { ExportTarget, NativeStyleExport } from '../src/native-style-export.ts';
import { EXPORT_DEVICES, parseNativeStyleExport } from '../src/native-style-export.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'examples/markless-styles/input/attributes.native-style-input.json';
const TEXT = readFileSync(repoPath(PATH), 'utf8');
const input = parseMarklessStyleInput(TEXT);
const full = marklessStyleExport(TEXT, PATH).exported;
const ios = full.targets.ios;
if (ios === undefined) throw new Error('no ios target');
const exported = full;

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
    const edit = (t: ExportTarget): ExportTarget => ({
      ...t,
      assignments: t.assignments.map((a) => ({
        ...a,
        nodes: [
          ...a.nodes.filter((n) => n.id !== 'h1:text0').map((n) => (n.id === 'h3:text0' ? { ...n, frame: null } : n)),
          { id: 'ghost', parent: 'h0', kind: 'element', native: 'view', text: null, frame: { x: 0, y: 0, width: 3, height: 3 }, borderWidths: null, writes: [] },
        ],
      })),
    });
    const edited: NativeStyleExport = { ...exported, targets: { ios: edit(ios), android: edit(exported.targets.android!) } };
    const r = await compareMarklessExport(hidden, edited);
    const problems = r.rows.flatMap((x) => (x.problem === undefined ? [] : [`${x.target} ${JSON.stringify(x.values)} ${x.id}: ${x.problem}`]));
    const want = (target: string, liked: boolean): string[] => [
      `h1:text0: Chrome has a box but the export has no node`,
      `h2: Chrome generates no box but the export has a frame`,
      `h2:text0: Chrome generates no box but the export has a frame`,
      `h3:text0: Chrome has a box but the export has no frame`,
      `ghost: the export has a framed node Chrome does not have`,
    ].map((p) => `${target} ${JSON.stringify({ 'state:liked': liked })} ${p}`);
    expect(problems.sort()).toEqual(['ios', 'android'].flatMap((t) => [...want(t, false), ...want(t, true)]).sort());
    expect(r.rows.every((x) => x.problem === undefined || (!x.pass && x.maxDeltaDevicePx === null))).toBe(true);
    // Hiding h2 also moves the boxes after it, which fail as measured rows.
    expect(r.failed).toBe(20 + r.rows.filter((x) => x.problem === undefined && !x.pass).length);
    expect(r.compared).toBe(r.rows.length - 20);
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
    const r = await compareMarklessExport(parseMarklessStyleInput(text), ws);
    expect(r.rows.filter((x) => !x.pass)).toEqual([]);
    expect(r.rows.map((x) => x.id)).toEqual(expect.arrayContaining(['bold', 'gap', 'more', 'tail', 'edge']));
  }, 60_000);
});

describe('node ids', () => {
  const el = (id: string, parent: string | null, element: string, attributes: Record<string, string> = {}) => ({ kind: 'element', id, element, parent, attributes });
  const tx = (id: string, parent: string, text: string) => ({ kind: 'text', id, parent, text });
  const inputOf = (nodes: unknown[], css: string): string => JSON.stringify({ version: 'markless.native-style-input/0', component: 'App', nodes, css, states: [] });

  it('names every exported node kind as Chrome\'s capture does, so a correct layout compares clean', async () => {
    const text = inputOf([
      el('component-edge:0', null, 'div', { class: 'c' }),
      tx('lead', 'component-edge:0', 'hi'),
      el('p0', null, 'p'),
      tx('collapsed', 'p0', ' '),
      el('b0', 'p0', 'b'),
      tx('a', 'b0', 'a'),
      tx('nbsp', 'p0', '\u00a0'),
      el('b1', 'p0', 'b'),
      tx('b', 'b1', 'b'),
      tx('gap', 'p0', ' '),
      el('b2', 'p0', 'b'),
      tx('c', 'b2', 'c'),
      tx('tail', 'p0', 'tail end'),
    ], '.c::before { content: ""; display: block; width: 10px; height: 10px; } .c::after { content: "x"; display: block; }');
    const parsed = parseMarklessStyleInput(text);
    const all = marklessStyleExport(text, PATH).exported;
    const t = all.targets.ios!;
    const exported = t.assignments[0]!.nodes;
    const kinds = ['component-edge:0', 'component-edge:0::before', 'component-edge:0::after', 'component-edge:0::after:text0', 'component-edge:0:anon0', 'lead', 'nbsp', 'gap', 'tail'];
    expect(exported.map((n) => n.id)).toEqual(expect.arrayContaining(kinds));
    expect(exported.map((n) => n.id)).not.toContain('collapsed');
    const browser = await launchChrome(t.dpr);
    try {
      const capture = await captureMarklessAssignment(browser, parsed, t, t.assignments[0]!.values, 'light');
      const idOf = marklessNodeId(parsed, (id) => id);
      const chrome = capture.nodes.filter((n) => n.kind !== 'line' && n.hasBox).map((n) => idOf(n.id));
      // Dragon's anonymous boxes are its own; every other exported node is one Chrome captured, under the same id.
      expect(exported.filter((n) => n.kind !== 'anonymous').map((n) => n.id).sort()).toEqual([...chrome].sort());
      // The export has no line boxes; Chrome's are named under the node they split.
      const named = new Set(capture.nodes.filter((n) => n.kind !== 'line').map((n) => n.id));
      const lines = capture.nodes.filter((n) => n.kind === 'line');
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(named.has(l.id.replace(/:line\d+$/, '')), l.id).toBe(true);
    } finally {
      await browser.close();
    }
    const r = await compareMarklessExport(parsed, all);
    expect(r.rows.filter((x) => !x.pass)).toEqual([]);
    expect(r.rows.map((x) => x.id)).toEqual(expect.arrayContaining(kinds.filter((k) => !k.includes(':anon'))));
  }, 60_000);

  it('refuses the node kinds the export does not carry: a ::marker in a state program and a <dialog> (its ::backdrop)', () => {
    expect(() => marklessStyleExport(inputOf([el('u', null, 'ul'), el('li:0', 'u', 'li'), tx('t', 'li:0', 'a')], ''), PATH)).toThrow('::marker');
    expect(() => marklessStyleExport(inputOf([el('d:0', null, 'dialog', { open: '' })], ''), PATH)).toThrow('<dialog>');
  });

  it('refuses an input whose ids collide with another node\'s address in Chrome\'s capture', async () => {
    const text = inputOf([el('a', null, 'div'), tx('t', 'a', 'x'), el('a:text0', null, 'div')], '');
    const all = marklessStyleExport(text, PATH).exported;
    await expect(compareMarklessExport(parseMarklessStyleInput(text), all)).rejects.toThrow('Chrome\'s capture names more than one node a:text0');
  }, 60_000);
});

describe('the export a comparison reads', () => {
  const withIos = (f: (t: ExportTarget) => ExportTarget): NativeStyleExport => ({ ...exported, targets: { ...exported.targets, ios: f(ios) } });

  it('refuses an export whose targets are not exactly the targets the input compiles to', async () => {
    const { android: _android, ...iosOnly } = full.targets;
    const parsed = parseNativeStyleExport(JSON.stringify({ ...full, targets: iosOnly }));
    await expect(compareMarklessExport(input, parsed)).rejects.toThrow('the export\'s targets ios are not the targets the input compiles to, android, ios');
    await expect(compareMarklessExport(input, { ...full, targets: {} })).rejects.toThrow('the export\'s targets none are not');
  });

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
    const dropped: NativeStyleExport = { ...app, targets: { ...app.targets, ios: { ...t, assignments: t.assignments.filter((a) => a.values[BAND_KEY] !== 1) } } };
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
    const parsed = parseNativeStyleExport(JSON.stringify({ ...app, targets: { ...app.targets, ios: lightOnly } }));
    await expect(compareMarklessExport(parseMarklessStyleInput(appText), parsed)).rejects.toThrow('ios: states');
    const ios0 = app.targets.ios!;
    const relabelled: NativeStyleExport = { ...app, targets: { ...app.targets, ios: { ...ios0, bands: { ...ios0.bands!, conditions: ios0.bands!.conditions.map(() => 'all') } } } };
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

describe('the document Chrome lays out', () => {
  const el = (id: string, parent: string | null, element: string, attributes: Record<string, string> = {}) => ({ kind: 'element', id, element, parent, attributes });
  const tx = (id: string, parent: string, text: string) => ({ kind: 'text', id, parent, text });
  const inputOf = (nodes: unknown[], css = ''): string => JSON.stringify({ version: 'markless.native-style-input/0', component: 'App', nodes, css, states: [] });
  const device = EXPORT_DEVICES.ios;
  const HTML = 'http://www.w3.org/1999/xhtml';
  const SVG = 'http://www.w3.org/2000/svg';

  // The HTML parser turns `<br></br>` into two <br>s and `<p><div></div></p>` into a <p>, a <div> and an empty <p>.
  const cases: [string, unknown[], readonly string[]][] = [
    ['a <br> element', [el('p0', null, 'p'), tx('a', 'p0', 'a'), el('br0', 'p0', 'br'), tx('b', 'p0', 'b')], ['p0', 'a', 'br0', 'b']],
    ['a <div> inside a <p>', [el('p0', null, 'p'), el('d0', 'p0', 'div'), tx('x', 'd0', 'x'), el('p1', null, 'p'), tx('y', 'p1', 'y')], ['p0', 'd0', 'x', 'p1', 'y']],
  ];
  for (const [what, nodes, ids] of cases) {
    it(`compares ${what} as the input builds it, with nothing failed`, async () => {
      const text = inputOf(nodes);
      const r = await compareMarklessExport(parseMarklessStyleInput(text), marklessStyleExport(text, PATH).exported);
      expect(r.rows.filter((x) => !x.pass)).toEqual([]);
      expect(r.failed).toBe(0);
      expect(r.rows.map((x) => x.id)).toEqual(expect.arrayContaining([...ids]));
    }, 60_000);
  }

  it('keeps two adjacent text nodes apart, as Dragon numbers them', async () => {
    // Dragon's engine refuses to lay out adjacent text (one shaping run in Chrome), so only the capture is checked here.
    const parsed = parseMarklessStyleInput(inputOf([el('h0', null, 'div'), tx('a', 'h0', 'a'), tx('b', 'h0', 'b')]));
    expect(() => marklessStyleExport(inputOf([el('h0', null, 'div'), tx('a', 'h0', 'a'), tx('b', 'h0', 'b')]), PATH)).toThrow('the engine refused');
    const browser = await launchChrome(device.dpr);
    try {
      const capture = await captureMarklessAssignment(browser, parsed, { ...ios, ...device }, {}, 'light');
      const idOf = marklessNodeId(parsed, (id) => id);
      const texts = capture.nodes.filter((n) => n.kind === 'text').map((n) => [n.id, idOf(n.id), n.width > 0] as const);
      expect(texts).toEqual([['h0:text0', 'a', true], ['h0:text1', 'b', true]]);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('holds exactly the input\'s tree, node for node, in every case the HTML parser would rebuild', async () => {
    const parsed = parseMarklessStyleInput(inputOf([
      el('p0', null, 'p', { title: 'a"b<c>&' }),
      tx('a', 'p0', 'a < b & c'),
      el('br0', 'p0', 'br'),
      el('d0', 'p0', 'div'),
      tx('t1', 'd0', 'x'),
      tx('t2', 'd0', 'y'),
      tx('t3', 'd0', ''),
      el('t0', null, 'table'),
      tx('t4', 't0', 'loose'),
      el('s0', null, 'svg', { viewBox: '0 0 10 10' }),
      el('r0', 's0', 'rect', { width: '10', height: '10' }),
    ], '.x { color: red; }'));
    const at = (id: string, more: [string, string][] = []): [string, string][] => [['data-dragon-id', id], ...more];
    const want = {
      element: 'html', namespace: HTML, attributes: at('html'), children: [
        { element: 'head', namespace: HTML, attributes: [], children: [] },
        { element: 'body', namespace: HTML, attributes: at('body'), children: [
          { element: 'p', namespace: HTML, attributes: at('p0', [['title', 'a"b<c>&']]), children: [
            { text: 'a < b & c' },
            { element: 'br', namespace: HTML, attributes: at('br0'), children: [] },
            { element: 'div', namespace: HTML, attributes: at('d0'), children: [{ text: 'x' }, { text: 'y' }, { text: '' }] },
          ] },
          { element: 'table', namespace: HTML, attributes: at('t0'), children: [{ text: 'loose' }] },
          { element: 'svg', namespace: SVG, attributes: at('s0', [['viewBox', '0 0 10 10']]), children: [
            { element: 'rect', namespace: SVG, attributes: at('r0', [['width', '10'], ['height', '10']]), children: [] },
          ] },
        ] },
      ],
    };
    const browser = await launchChrome(device.dpr);
    try {
      const page = await openPage(browser, authoredFontHtml(marklessDocumentHtml(parsed, {})), { viewport: device.viewport, devicePixelRatio: device.dpr, direction: 'ltr', rootFont: 'ua-default' });
      try {
        expect(await page.evaluate(readDocumentTree)).toEqual(want);
        // The document sheet comes first, then the component's own, as Dragon reads them.
        const sheets = await page.evaluate(() => [...document.querySelectorAll('head style:not([data-dragon-harness])')].map((s) => s.textContent));
        expect(sheets).toEqual([MARKLESS_DOCUMENT_CSS, '.x { color: red; }']);
      } finally {
        await page.context().close();
      }
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('names the first place Chrome\'s document differs from the input\'s tree', () => {
    const tree = (children: DocumentNode[]): DocumentNode => ({ element: 'html', namespace: HTML, attributes: [], children });
    expect(documentMismatch(tree([{ text: 'ab' }]), tree([{ text: 'ab' }]))).toBeNull();
    expect(documentMismatch(tree([{ text: 'a' }, { text: 'b' }]), tree([{ text: 'ab' }]))).toBe('html: 1 child nodes where the input has 2');
    expect(documentMismatch(tree([{ text: 'a' }]), tree([{ element: 'br', namespace: HTML, attributes: [], children: [] }]))).toContain('html/0:');
  });

  it('refuses css that would end the document\'s <style>, and an input that sets data-dragon-id', () => {
    const parsed = (nodes: unknown[], css = ''): MarklessStyleInput => parseMarklessStyleInput(inputOf(nodes, css));
    expect(() => marklessDocumentHtml(parsed([el('h0', null, 'div')], '.a { content: "</STYLE>"; }'), {})).toThrow('the css holds "</style"');
    expect(marklessDocumentHtml(parsed([el('h0', null, 'div')], '.a { content: "</styles"; }'), {})).toContain('</styles');
    expect(() => marklessDocumentHtml(parsed([el('h0', null, 'div', { 'data-dragon-id': 'x' })]), {})).toThrow('h0: data-dragon-id is the comparison\'s own attribute');
  });
});
