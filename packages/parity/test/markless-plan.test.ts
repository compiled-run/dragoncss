// The layout plan of a Markless export: the device's function (harness.ts runMarklessLayout, translated to Swift and Kotlin)
// gives exactly the geometry the export computes at build time, at the proof devices and at other sizes and ratios.
import { readFileSync } from 'node:fs';
import type { ControlBox, LayoutBox } from '@dragon/layout';
import { checkboxMarks, fromRaw, LU_PER_PX, menuListArrow, menuListArrowBox, snapRect } from '@dragon/layout';
import { describe, expect, it } from 'vitest';
import { checkMarklessExport, marklessStyleExport, marklessTextHeightProof } from '../src/markless-style-input.ts';
import { paintRows } from '../src/markless-style-compare.ts';
import type { MarklessPlan } from '../src/markless-plan.ts';
import { heightDependence, PLAN_DENSITIES, planWidths } from '../src/markless-plan.ts';
import type { ExportNode } from '../src/native-style-export.ts';
import { repoPath } from '../src/paths.ts';
import { checkboxColors } from '../../dragon/src/forms/checkbox.ts';

// The translate harness is loaded by path at run time, as text-latin-engine.test.ts does.
const { checkMarklessPlan, runMarklessLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { checkMarklessPlan(line: string): string; runMarklessLayout(line: string): string };
const { bitsHex, hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { bitsHex(x: number): string; hexBits(s: string): number };

const INPUTS = ['fluid', 'width-media', 'borders-dashed', 'scheme', 'tabs'].map((n) => `examples/markless-styles/input/${n}.native-style-input.json`);
const FLUID = 'examples/markless-styles/input/fluid.native-style-input.json';
/** Pages whose plan carries every position the engine lays out: fluid.json with a sticky bar, and with a fixed bar. */
const POSITIONED: readonly (readonly [string, string])[] = [
  ['sticky', '.bar { position: sticky; top: 0; }'],
  ['fixed', '.bar { position: fixed; top: 8px; left: 4px; }'],
];
const withCss = (css: string): string => {
  const input = JSON.parse(readFileSync(repoPath(FLUID), 'utf8')) as { css: string };
  return JSON.stringify({ ...input, css: `${input.css}\n${css}` });
};
/** CSS px width, height and ratio: the proof devices, a small and a large phone, tablets in both orientations. */
const SIZES: readonly (readonly [number, number, number])[] = [[402, 778, 3], [411, 818, 2.625], [375, 589, 2], [448, 921, 3], [820, 1123, 2], [1280, 744, 2], [863, 360, 2.625]];

const decode = (v: unknown): unknown => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? hexBits(v) : Array.isArray(v) ? v.map(decode) : v);

function deviceLayout(plan: MarklessPlan, assignment: number, width: number, height: number, dpr: number): unknown[] {
  return JSON.parse(runMarklessLayout(`{"assignment":${assignment},"dpr":${dpr},"viewport":{"width":${width},"height":${height}},"safeArea":{"top":0,"right":0,"bottom":0,"left":0},"plan":${JSON.stringify(plan)}}`)) as unknown[];
}

/** One export node's geometry in the device function's order: frame, border widths, lines, border operations, scroll range. */
function exportGeometry(n: ExportNode): unknown[] {
  const f = n.frame;
  const b = n.borderWidths;
  const ops = n.borderOps;
  const r = n.scrollRange;
  return [
    f === null ? null : [f.x, f.y, f.width, f.height],
    b === null ? null : [b['top'], b['right'], b['bottom'], b['left']],
    n.lines === undefined ? null : n.lines.map((l) => [l.top, l.baseline, l.runs.map((run) => [run.face, run.size, run.glyphs, run.xs])]),
    ops === undefined ? null : [[ops.origin.x, ops.origin.y], [ops.size.width, ops.size.height], ops.widths, ops.ops.map((o) => [o.op, o.side, o.alpha, o.antialias, o.points])],
    r === undefined ? null : [r.minX, r.maxX, r.minY, r.maxY],
  ];
}

describe('the layout plan of a Markless export', () => {
  const pages: (readonly [string, string, string])[] = INPUTS.map((path) => [path.split('/').pop() as string, path, readFileSync(repoPath(path), 'utf8')]);
  for (const [name, css] of POSITIONED) pages.push([`fluid with a ${name} bar`, FLUID, withCss(css)]);
  for (const [name, path, text] of pages) {
    for (const [width, height, dpr] of SIZES) {
      it(`${name} at ${width} x ${height} and ${dpr}x lays out on the device as the export does`, () => {
        const at = { viewport: { width, height }, dpr };
        const exported = marklessStyleExport(text, path, undefined, 'system', { ios: at, android: at }, true).exported;
        let compared = 0;
        for (const t of ['ios', 'android'] as const) {
          const x = exported.targets[t]!;
          if (!PLAN_DENSITIES[t].includes(dpr)) continue;
          x.assignments.forEach((a, k) => {
            const names = new Map(x.planNames?.[k] ?? []);
            const out = deviceLayout(x.plan!, k, width, height, dpr);
            expect(out[0]).toBe('ok');
            const page = decode(out[1]);
            expect(page).toEqual(a.pageScroll === null ? expect.arrayContaining(['undecided']) : [a.pageScroll.minX, a.pageScroll.maxX, a.pageScroll.minY, a.pageScroll.maxY]);
            const got = new Map((out[2] as unknown[][]).map((n) => [names.get(n[0] as string) ?? (n[0] as string), decode(n.slice(1))]));
            for (const n of a.nodes) {
              if (n.frame === null) continue;
              expect(got.get(n.id), `${t} assignment ${k} node ${n.id}`).toEqual(exportGeometry(n));
              compared++;
            }
          });
        }
        expect(compared).toBeGreaterThan(0);
      });
    }
  }

  it('gives a node a band hides no frame there, and its frame where the band shows it', () => {
    const path = 'examples/markless-styles/input/width-media.native-style-input.json';
    const t = marklessStyleExport(readFileSync(repoPath(path), 'utf8'), path, undefined, 'system').exported.targets.ios!;
    const conditions = t.bands!.conditions;
    const landscape = t.assignments.filter((_, k) => !(conditions[k] as string).endsWith('(not (orientation: landscape))'));
    const portrait = t.assignments.filter((_, k) => (conditions[k] as string).endsWith('(not (orientation: landscape))'));
    expect(landscape.length).toBe(5);
    expect(portrait.length).toBe(5);
    for (const a of portrait) expect(a.nodes.find((n) => n.id === 'h7')!.frame).toBeNull();
    for (const a of landscape) expect(a.nodes.find((n) => n.id === 'h7')!.frame).not.toBeNull();
  });

  it('refuses a ratio it holds no text for, and an assignment it does not have, by name', () => {
    const path = INPUTS[0] as string;
    const plan = marklessStyleExport(readFileSync(repoPath(path), 'utf8'), path, undefined, 'system', undefined, true).exported.targets.android!.plan!;
    expect(deviceLayout(plan, 0, 400, 800, 2.8125)).toEqual(['harness-error', 'the plan holds no text measured at ratio 2.8125']);
    expect(deviceLayout(plan, 9, 400, 800, 2)).toEqual(['harness-error', '$.assignment: 9 is not an assignment of the plan']);
  });

  it('refuses a page whose text depends on the viewport height, by name', () => {
    const path = 'examples/markless-styles/input/width-media.native-style-input.json';
    const input = JSON.parse(readFileSync(repoPath(path), 'utf8')) as { css: string };
    const tall = JSON.stringify({ ...input, css: `${input.css}\n.note { font-size: 4vh; }` });
    expect(() => marklessStyleExport(tall, path, undefined, 'system', undefined, true)).toThrow(/^ios: variant 0 at 320 x 320 css px and 2x (shapes|reads the metrics of) .*, which it does not at height 778; the plan records text at one viewport height/);
  });

  it("fails on the device where the plan holds no record of a face's metrics, instead of using the engine's", () => {
    const path = 'examples/markless-styles/input/width-media.native-style-input.json';
    const plan = marklessStyleExport(readFileSync(repoPath(path), 'utf8'), path, undefined, 'system', undefined, true).exported.targets.ios!.plan!;
    expect(deviceLayout(plan, 0, 402, 778, 3)[0]).toBe('ok');
    const without: MarklessPlan = { ...plan, densities: plan.densities.map((d) => ({ ...d, metrics: [] })) };
    expect(deviceLayout(without, 0, 402, 778, 3)).toEqual(['harness-error', expect.stringMatching(/^the plan holds no metrics of /)]);
  });

  it('reads every part of a plan the build writes, so a style value the device cannot read is refused at build time, by name', () => {
    for (const [name, css] of POSITIONED) {
      const plan = marklessStyleExport(withCss(css), FLUID, undefined, 'system', undefined, true).exported.targets.ios!.plan!;
      expect(JSON.stringify(plan.variants), name).toContain(`"position":"${name}"`);
      expect(checkMarklessPlan(JSON.stringify(plan)), name).toBe('["ok"]');
    }
    const plan = marklessStyleExport(readFileSync(repoPath(INPUTS[1] as string), 'utf8'), INPUTS[1] as string, undefined, 'system', undefined, true).exported.targets.ios!.plan!;
    expect(plan.variants.length).toBeGreaterThan(1);
    const last = plan.variants.length - 1;
    const unread = JSON.parse(JSON.stringify(plan)) as { variants: { root: { style: { position: string } } }[] };
    (unread.variants[last] as { root: { style: { position: string } } }).root.style.position = 'running';
    expect(JSON.parse(checkMarklessPlan(JSON.stringify(unread)))).toEqual(['harness-error', `$.plan.variants[${last}].root.style.position: unexpected running`]);
  });

  it('records the same plan in worker threads as in this thread, with and without the height check', () => {
    const text = readFileSync(repoPath(FLUID), 'utf8');
    const before = { workers: process.env['DRAGON_PLAN_WORKERS'], check: process.env['DRAGON_PLAN_HEIGHT_CHECK'] };
    try {
      // FLUID is proven, so without `always` both exports skip the height passes; with it both run them.
      for (const check of [undefined, 'always']) {
        if (check === undefined) delete process.env['DRAGON_PLAN_HEIGHT_CHECK'];
        else process.env['DRAGON_PLAN_HEIGHT_CHECK'] = check;
        process.env['DRAGON_PLAN_WORKERS'] = '1';
        const serial = marklessStyleExport(text, FLUID, undefined, 'system', undefined, true).exported;
        process.env['DRAGON_PLAN_WORKERS'] = '4';
        const workers = marklessStyleExport(text, FLUID, undefined, 'system', undefined, true).exported;
        expect(JSON.stringify(workers), `height check ${check ?? 'proven'}`).toBe(JSON.stringify(serial));
      }
    } finally {
      for (const [k, v] of [['DRAGON_PLAN_WORKERS', before.workers], ['DRAGON_PLAN_HEIGHT_CHECK', before.check]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('fails, naming the recording, when a plan worker exits before it answers, and waits on no timeout', () => {
    const before = { workers: process.env['DRAGON_PLAN_WORKERS'], fault: process.env['DRAGON_PLAN_WORKER_FAULT'] };
    try {
      process.env['DRAGON_PLAN_WORKERS'] = '2';
      process.env['DRAGON_PLAN_WORKER_FAULT'] = 'exit';
      expect(() => marklessStyleExport(readFileSync(repoPath(FLUID), 'utf8'), FLUID, undefined, 'system', undefined, true)).toThrow(/^a layout plan worker exited before recording (ios|android) at [0-9.]+x$/);
    } finally {
      for (const [k, v] of [['DRAGON_PLAN_WORKERS', before.workers], ['DRAGON_PLAN_WORKER_FAULT', before.fault]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('fails, naming the recording, when Node stops a plan worker that runs out of memory, which runs no handler', () => {
    const keys = ['DRAGON_PLAN_WORKERS', 'DRAGON_PLAN_WORKER_FAULT', 'DRAGON_PLAN_STALL_MS'] as const;
    const before = keys.map((k) => process.env[k]);
    try {
      process.env['DRAGON_PLAN_WORKERS'] = '2';
      process.env['DRAGON_PLAN_WORKER_FAULT'] = 'oom';
      process.env['DRAGON_PLAN_STALL_MS'] = '3000';
      expect(() => marklessStyleExport(readFileSync(repoPath(FLUID), 'utf8'), FLUID, undefined, 'system', undefined, true)).toThrow(/^a layout plan worker stopped recording (ios|android) at [0-9.]+x: it laid nothing out for 3 s/);
    } finally {
      keys.forEach((k, i) => {
        if (before[i] === undefined) delete process.env[k];
        else process.env[k] = before[i];
      });
    }
  });

  it('proves a page\'s text independent of the viewport height only from its own program, and names what it cannot prove', () => {
    const proof = (css: string) => marklessTextHeightProof(withCss(css), FLUID, undefined, 'system');
    expect(proof('')).toEqual({ ios: null, android: null });
    // A block size in vh reaches no inline size, so the text cannot change.
    expect(proof('.bar { min-height: 100vh; padding-top: 2vh; }')).toEqual({ ios: null, android: null });
    expect(proof('.page { font-size: 4vh; }').ios).toMatch(/has a font size or line height in vh, vmin or vmax$/);
    expect(proof('.page { width: 50vmin; }').ios).toMatch(/has an inline-axis length in vh, vmin or vmax$/);
    expect(proof('.bar { height: 40vh; aspect-ratio: 2; }').ios).toMatch(/has an aspect-ratio$/);
    expect(proof('.bar { display: flex; flex-direction: column; flex-wrap: wrap; height: 50vh; }').ios).toMatch(/is a multi-line column flex container$/);
    expect(proof('@media (orientation: landscape) { .bar { color: red; } }').ios).toBe('a media query on orientation');
    // A font size only a pressed state sets is in a variant the plan records, so the proof reads it too.
    expect(proof('.cell:active { font-size: 4vh; }').ios).toMatch(/has a font size or line height in vh, vmin or vmax$/);
  });

  it("names a select whose option text is spaced in vh, though the option is not among the select's children", () => {
    // Only what heightDependence reads: every length auto, no grid, multicol or anchor.
    const style = new Proxy({ display: 'block', multicol: null, anchor: null, grid: null } as Record<string, unknown>, { get: (o, k: string) => (k in o ? o[k] : { kind: 'auto' }) });
    const px = (value: number) => ({ kind: 'px', value }) as const;
    const font = { specifiedSize: px(10) };
    const tree = (letterSpacing: unknown) => {
      const option = { kind: 'text', id: 'h2:text0', text: 'Longest option', font, lineHeight: { kind: 'normal' }, letterSpacing, wordSpacing: px(0) };
      const inner = { kind: 'control', id: 'h1::inner', style, strut: null, control: { kind: 'select-inner' }, children: [] };
      const select = { kind: 'control', id: 'h1', style, strut: null, control: { kind: 'select-menulist', font, lineHeight: { kind: 'normal' }, arrowWidth: 0, options: [option] }, children: [inner] };
      return { variants: [{ root: { kind: 'box', id: 'h0', style, strut: null, marker: null, children: [select] } }] } as unknown as Parameters<typeof heightDependence>[0];
    };
    expect(heightDependence(tree(px(0)), [])).toBeNull();
    expect(heightDependence(tree({ kind: 'viewport', value: 2, axis: 'height', size: 'large' }), [])).toBe('h2:text0 has spacing in vh, vmin or vmax');
  });

  it('still checks the text at other heights on a page it cannot prove, and refuses one whose text follows the height', () => {
    const path = 'examples/markless-styles/input/width-media.native-style-input.json';
    const input = JSON.parse(readFileSync(repoPath(path), 'utf8')) as { css: string };
    const tall = JSON.stringify({ ...input, css: `${input.css}\n.note { font-size: 4vh; }` });
    expect(marklessTextHeightProof(tall, path).ios).not.toBeNull();
    expect(() => marklessStyleExport(tall, path, undefined, 'system', undefined, true)).toThrow(/^ios: variant 0 at 320 x 320 css px and 2x (shapes|reads the metrics of) .*, which it does not at height 778; the plan records text at one viewport height/);
  });

  it('exports a proven page byte for byte as it does with the height check', () => {
    const text = withCss('.bar { min-height: 100vh; }');
    expect(marklessTextHeightProof(text, FLUID)).toEqual({ ios: null, android: null });
    const before = process.env['DRAGON_PLAN_HEIGHT_CHECK'];
    try {
      process.env['DRAGON_PLAN_HEIGHT_CHECK'] = 'always';
      const checked = marklessStyleExport(text, FLUID, undefined, 'system', undefined, true).exported;
      delete process.env['DRAGON_PLAN_HEIGHT_CHECK'];
      const proven = marklessStyleExport(text, FLUID, undefined, 'system', undefined, true).exported;
      expect(JSON.stringify(proven, null, 1)).toBe(JSON.stringify(checked, null, 1));
    } finally {
      if (before === undefined) delete process.env['DRAGON_PLAN_HEIGHT_CHECK'];
      else process.env['DRAGON_PLAN_HEIGHT_CHECK'] = before;
    }
  });

  it('records every root width a phone from 320 to 1400 css px can have, in whole device and whole css px', () => {
    const w = planWidths(2.625);
    expect(w[0]).toBeCloseTo(320, 9);
    expect(w).toContain(411);
    expect(w).toContain(1080 / 2.625);
    expect(w[w.length - 1]).toBe(1400);
  });

  it("gives each menulist-button select's arrow last, tagged, from its snapped border box, and a page without one as it was", () => {
    const lato = new Uint8Array(readFileSync(repoPath('packages/dragon/test/fonts/woff/Lato-Regular.woff2')));
    const css = "@font-face { font-family: 'Harbour Lato'; src: url('./fonts/Lato-Regular.woff2') format('woff2'); }\nbody { margin: 0; font-family: 'Harbour Lato'; }\nselect { font: inherit; }\n.page { padding: 24px; }\n.field { display: block; width: 100%; padding: 12px 14px; border: 1px dashed #c9c2ad; background: #fffdf7; }\n";
    const nodes = [
      { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: { class: 'page' } },
      { kind: 'element', id: 'h3', element: 'select', parent: 'h0', attributes: { class: 'field', 'aria-label': 'Tag' } },
      { kind: 'element', id: 'h4', element: 'option', parent: 'h3', attributes: {} },
      { kind: 'text', id: 'h4:text0', parent: 'h4', text: 'Work' },
    ];
    const text = JSON.stringify({ version: 'markless.native-style-input/0', component: 'Tagging', nodes, css, states: [], fonts: [{ url: './fonts/Lato-Regular.woff2', file: 'Lato-Regular.woff2' }] });
    const { exported } = marklessStyleExport(text, 'select.json', () => lato, 'system', undefined, true);
    const selects = (b: LayoutBox | ControlBox): ControlBox[] => [...(b.kind === 'control' && b.control.kind === 'select-menulist' ? [b] : []), ...b.children.flatMap((k) => (k.kind === 'box' || k.kind === 'control' ? selects(k) : []))];
    let arrows = 0;
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t]!;
      const { width, height } = x.viewport;
      const names = new Map(x.planNames?.[0] ?? []);
      const out = deviceLayout(x.plan!, 0, width, height, x.dpr);
      expect(out[0], t).toBe('ok');
      // The device's borders (and every other part of a node) are the export's, whose border operations read the Lato-resolved device borders.
      const got = new Map((out[2] as unknown[][]).map((n) => [names.get(n[0] as string) ?? (n[0] as string), decode(n.slice(1))]));
      const select = x.assignments[0]!.nodes.find((n) => n.id === 'h3')!;
      expect(select.borderOps, t).toBeDefined();
      expect(got.get('h3'), t).toEqual(exportGeometry(select));
      // The host's arrow: the export's snapped border box and whole device px borders (its border operations), at the select's arrow width.
      const v = x.plan!.variants[(x.plan!.assignments[0] as unknown as { variant: number }).variant] as unknown as { root: LayoutBox };
      const expected = selects(v.root).map((c) => {
        const id = names.get(c.id) ?? c.id;
        const ops = x.assignments[0]!.nodes.find((n) => n.id === id)!.borderOps!;
        const arrowWidth = c.control.kind === 'select-menulist' ? c.control.arrowWidth : 0;
        const a = menuListArrow(0, 0, ops.size.width, ops.size.height, ops.widths[3] as number, ops.widths[1] as number, menuListArrowBox(arrowWidth, x.dpr, x.dpr), arrowWidth, false);
        return [id, a.strokeWidth, a.shape.segments.map((g) => (g.kind === 'move' || g.kind === 'line' ? [g.kind, g.x, g.y] : [g.kind]))];
      });
      expect(out.length, t).toBe(4);
      const suffix = decode(out[3]) as [string, unknown[][]];
      expect(suffix[0], t).toBe('menulist-arrows');
      expect(suffix[1].map((a) => [names.get(a[0] as string) ?? a[0], ...a.slice(1)]), t).toEqual(expected);
      expect(expected.map((a) => a[0]), t).toEqual(['h3']);
      arrows += expected.length;
    }
    expect(arrows).toBe(2);
    const plain = marklessStyleExport(readFileSync(repoPath(FLUID), 'utf8'), FLUID, undefined, 'system', undefined, true).exported.targets.ios!;
    expect(deviceLayout(plain.plan!, 0, plain.viewport.width, plain.viewport.height, plain.dpr).length).toBe(3);
  });

  it("gives the notes form's checkbox its theme marks last, tagged, from its snapped border box, beside a checkbox write with Chrome's colours", () => {
    // NoteForm.tsrx's pinned field: .check { display: flex; align-items: center; gap: 10px; min-height: 44px }, a 22px input with
    // accent-color #c2410c; form-checkbox.test.ts proves checkboxMarks and checkboxColors against Chrome's pixels at these sizes.
    const css = 'body { margin: 0; font-family: Ahem; font-size: 16px; }\n* { box-sizing: border-box; }\n.page { padding: 24px; }\n.check { display: flex; align-items: center; gap: 10px; min-height: 44px; }\n.check input { width: 22px; height: 22px; accent-color: #c2410c; }\n';
    const nodes = (checked: boolean) => [
      { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: { class: 'page' } },
      { kind: 'element', id: 'h1', element: 'label', parent: 'h0', attributes: { class: 'check' } },
      { kind: 'element', id: 'h2', element: 'input', parent: 'h1', attributes: checked ? { type: 'checkbox', name: 'pinned', checked: '' } : { type: 'checkbox', name: 'pinned' } },
      { kind: 'text', id: 'h1:text0', parent: 'h1', text: 'Pin' },
    ];
    for (const checked of [false, true]) {
      const text = JSON.stringify({ version: 'markless.native-style-input/0', component: 'Pinning', nodes: nodes(checked), css, states: [] });
      const { exported } = marklessStyleExport(text, 'checkbox.json', undefined, 'system', undefined, true);
      for (const t of ['ios', 'android'] as const) {
        const x = exported.targets[t]!;
        const names = new Map(x.planNames?.[0] ?? []);
        const box = x.assignments[0]!.nodes.find((n) => n.id === 'h2')!;
        const write = box.writes.find((w) => w.kind === 'checkbox') as { checked: boolean; colors: unknown } | undefined;
        expect(write, t).toBeDefined();
        expect(write!.checked, t).toBe(checked);
        expect(write!.colors, t).toEqual(checkboxColors({ r: 194, g: 65, b: 12, alpha: 255 }, { checkboxLightCheckOnLightAccent: false }));
        // Every ratio the plan measures text at, at the proof viewport and a small phone's.
        for (const [width, height, dpr] of PLAN_DENSITIES[t].flatMap((d) => [[x.viewport.width, x.viewport.height, d], [375, 589, d]] as const)) {
          const out = deviceLayout(x.plan!, 0, width, height, dpr);
          expect(out[0], `${t} ${dpr} ${JSON.stringify(out)}`).toBe('ok');
          expect(out.length, t).toBe(4);
          const suffix = decode(out[3]) as [string, unknown[][]];
          expect(suffix[0], t).toBe('checkbox-marks');
          const frames = new Map((out[2] as unknown[][]).map((n) => [names.get(n[0] as string) ?? (n[0] as string), decode(n[1]) as number[]]));
          // The marks are of the snapped border box: the frame made absolute through its parents, in LU, snapped to device px.
          const parents = new Map(x.assignments[0]!.nodes.map((n) => [n.id, n.parent]));
          let [ax, ay] = [0, 0];
          for (let id: string | null | undefined = 'h2'; id !== null && id !== undefined; id = parents.get(id)) {
            ax += frames.get(id)![0]!;
            ay += frames.get(id)![1]!;
          }
          const f = frames.get('h2')!;
          const snapped = snapRect({ id: 'h2', parent: null, x: fromRaw(ax * LU_PER_PX), y: fromRaw(ay * LU_PER_PX), width: fromRaw(f[2]! * LU_PER_PX), height: fromRaw(f[3]! * LU_PER_PX) });
          const m = checkboxMarks(snapped.width, snapped.height, dpr);
          expect(suffix[1].map((c) => [names.get(c[0] as string) ?? c[0], ...c.slice(1)]), `${t} ${dpr}`).toEqual([['h2', m.x, m.y, m.side, m.plain, m.radius, m.backgroundInset, m.borderInset, m.borderWidth, [...m.check], m.checkWidth]]);
        }
      }
    }
  });

  it('gives a slotted page with a menulist-button select its slot writes, then its arrows, tagged and last', () => {
    const path = 'examples/markless-styles/input/slots.native-style-input.json';
    const input = JSON.parse(readFileSync(repoPath(path), 'utf8')) as { css: string; nodes: unknown[]; slots: { initial: number }[] };
    const text = JSON.stringify({
      ...input,
      css: `${input.css}\n.pick { display: block; font: inherit; min-width: 0; width: 100%; padding: 0 6px; border: 1px solid rgb(90 90 90); background: rgb(250 250 245); }\n`,
      nodes: [...input.nodes, { kind: 'element', id: 'h20', element: 'select', parent: 'h0', attributes: { class: 'pick' } }, { kind: 'element', id: 'h21', element: 'option', parent: 'h20', attributes: {} }, { kind: 'text', id: 'h21:text0', parent: 'h21', text: 'One' }],
    });
    const { exported } = marklessStyleExport(text, path, undefined, 'system', undefined, true);
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t]!;
      const line = { assignment: 0, dpr: x.dpr, viewport: x.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan };
      const slotted = JSON.parse(runMarklessLayout(JSON.stringify({ ...line, slots: input.slots.map((s) => bitsHex(s.initial)) }))) as unknown[];
      expect(slotted[0], JSON.stringify(slotted)).toBe('ok');
      expect(slotted.length, t).toBe(5);
      const writes = slotted[3] as unknown[][];
      expect(writes.length, t).toBeGreaterThan(0);
      for (const w of writes) expect(typeof w[0] === 'string' && typeof w[1] === 'string' && Array.isArray(w[2]), t).toBe(true);
      const names = new Map(x.planNames?.[0] ?? []);
      const arrows = slotted[4] as [string, unknown[][]];
      expect(arrows[0], t).toBe('menulist-arrows');
      expect(arrows[1].map((a) => names.get(a[0] as string) ?? a[0]), t).toEqual(['h20']);
    }
  });

  it('keeps the font mode and each assignment\'s canvas, body background and colour scheme beside the plan, for the paint checks', () => {
    const path = 'examples/markless-styles/input/scheme.native-style-input.json';
    const at = { viewport: { width: 412, height: 870 }, dpr: 2.625 };
    for (const exported of [marklessStyleExport(readFileSync(repoPath(path), 'utf8'), path, undefined, 'system', undefined, true).exported, marklessStyleExport(readFileSync(repoPath(path), 'utf8'), path, undefined, 'system', { ios: at, android: at }, true).exported]) {
      const checked = checkMarklessExport(exported);
      expect(checked.fontMode).toBe('system');
      for (const t of ['ios', 'android'] as const) {
        const x = checked.targets[t]!;
        expect(x.plan).toBeDefined();
        expect(x.planNames?.length).toBe(x.assignments.length);
        for (const a of x.assignments) {
          const rows = paintRows(t, a, { canvas: a.canvas, body: a.bodyBackground, colorScheme: a.colorScheme });
          expect(rows.map((r) => [r.field, r.pass])).toEqual([['canvas', true], ['bodyBackground', true], ['colorScheme', true]]);
        }
      }
    }
  });
});
