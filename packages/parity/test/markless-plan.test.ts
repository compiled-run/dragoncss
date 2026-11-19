// The layout plan of a Markless export: the device's function (harness.ts runMarklessLayout, translated to Swift and Kotlin)
// gives exactly the geometry the export computes at build time, at the proof devices and at other sizes and ratios.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import type { MarklessPlan } from '../src/markless-plan.ts';
import { PLAN_DENSITIES, planWidths } from '../src/markless-plan.ts';
import type { ExportNode } from '../src/native-style-export.ts';
import { repoPath } from '../src/paths.ts';

// The translate harness is loaded by path at run time, as text-latin-engine.test.ts does.
const { runMarklessLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessLayout(line: string): string };
const { hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { hexBits(s: string): number };

const INPUTS = ['fluid', 'width-media', 'borders-dashed', 'scheme', 'tabs'].map((n) => `examples/markless-styles/input/${n}.native-style-input.json`);
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
  for (const path of INPUTS) {
    const text = readFileSync(repoPath(path), 'utf8');
    for (const [width, height, dpr] of SIZES) {
      it(`${path.split('/').pop()} at ${width} x ${height} and ${dpr}x lays out on the device as the export does`, () => {
        const at = { viewport: { width, height }, dpr };
        const exported = marklessStyleExport(text, path, undefined, 'system', { ios: at, android: at }, true).exported;
        let compared = 0;
        for (const t of ['ios', 'android'] as const) {
          const x = exported.targets[t]!;
          if (!PLAN_DENSITIES[t].includes(dpr)) continue;
          const names = new Map(x.planNames ?? []);
          x.assignments.forEach((a, k) => {
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

  it('records every root width a phone from 320 to 1400 css px can have, in whole device and whole css px', () => {
    const w = planWidths(2.625);
    expect(w[0]).toBeCloseTo(320, 9);
    expect(w).toContain(411);
    expect(w).toContain(1080 / 2.625);
    expect(w[w.length - 1]).toBe(1400);
  });
});
