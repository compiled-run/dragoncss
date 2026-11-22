// Interaction states in the Markless style export: each assignment's level carries Dragon's interaction runtime tables and every
// state laid out as the assignments are, and with a plan each state is a plan assignment the device lays out as the export does.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ExportAssignment, ExportNode } from '../src/native-style-export.ts';
import { marklessStyleExport } from '../src/markless-style-input.ts';
import type { MarklessPlan } from '../src/markless-plan.ts';
import { repoPath } from '../src/paths.ts';

const { runMarklessLayout } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runMarklessLayout(line: string): string };
const { hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { hexBits(s: string): number };

const FLUID = 'examples/markless-styles/input/fluid.native-style-input.json';
const withCss = (css: string): string => {
  const input = JSON.parse(readFileSync(repoPath(FLUID), 'utf8')) as { css: string };
  return JSON.stringify({ ...input, css: `${input.css}\n${css}` });
};
const PRESSED = { r: 42, g: 157, b: 143, alpha: 255 };
const background = (n: ExportNode | undefined): unknown => (n?.writes as readonly { kind: string; color?: unknown }[] | undefined)?.find((w) => w.kind === 'background-color')?.color;
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
const decode = (v: unknown): unknown => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? hexBits(v) : Array.isArray(v) ? v.map(decode) : v);

describe('interaction states in the Markless style export', () => {
  it('gives each assignment a level with the runtime tables and each pressed state, whose only change is the pressed box', () => {
    const { exported } = marklessStyleExport(withCss('.cell:active { background: #2a9d8f; }'), FLUID, undefined, 'system');
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t]!;
      const levels = x.interaction?.levels ?? [];
      expect(levels.length, t).toBe(x.assignments.length);
      const base = x.assignments[0] as ExportAssignment;
      const cells = base.nodes.filter((n) => background(n) !== undefined && JSON.stringify(background(n)) === JSON.stringify({ r: 241, g: 250, b: 238, alpha: 255 })).map((n) => n.id);
      expect(cells.length, t).toBe(2);
      const level = levels[0]!;
      expect(level.addresses, t).toEqual(expect.arrayContaining(cells));
      expect(Object.keys(level.tables), t).toEqual(expect.arrayContaining(['parent', 'chainOf', 'activeChainOf', 'activeValues', 'combos']));
      // Each cell pressed is one state: that cell takes the pressed background and every other node keeps the base's writes.
      const pressed = level.states.map((st) => st.nodes.filter((n) => JSON.stringify(background(n)) === JSON.stringify(PRESSED)).map((n) => n.id));
      expect(pressed.flat().sort(), t).toEqual([...cells].sort());
      for (const st of level.states) {
        for (const n of st.nodes) {
          if (cells.includes(n.id)) continue;
          expect(n.writes, `${t} ${n.id}`).toEqual(base.nodes.find((m) => m.id === n.id)?.writes);
        }
      }
    }
  });

  it('gives a level per assignment of every @media band', () => {
    const { exported } = marklessStyleExport(withCss('.cell:active { background: #e63946; } @media (min-width: 700px) { .cell { padding: 20px; } }'), FLUID, undefined, 'system');
    const x = exported.targets.ios!;
    expect(x.bands).toBeDefined();
    expect(x.assignments.length).toBeGreaterThan(1);
    expect(x.interaction?.levels.length).toBe(x.assignments.length);
    for (const l of x.interaction!.levels) expect(l.states.length).toBeGreaterThan(0);
  });

  it('makes each state a plan assignment that the device lays out as the export does, a state that changes the layout included', () => {
    const at = { viewport: { width: 402, height: 778 }, dpr: 2 };
    const { exported } = marklessStyleExport(withCss('.cell:active { background: #e63946; padding: 14px; }'), FLUID, undefined, 'system', { ios: at, android: at }, true);
    let compared = 0;
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t]!;
      const plan = x.plan as MarklessPlan;
      const levels = x.interaction!.levels;
      const indices = levels.flatMap((l) => l.planAssignments ?? []);
      expect(indices, t).toEqual(levels.flatMap((l) => l.states).map((_, i) => x.assignments.length + i));
      expect(plan.assignments.length, t).toBe(x.assignments.length + indices.length);
      expect(new Set(indices.map((k) => plan.assignments[k]!.variant)).size, t).toBe(indices.length);
      expect(x.planNames?.length, t).toBe(plan.assignments.length);
      for (const [k, st] of levels[0]!.states.entries()) {
        const index = (levels[0]!.planAssignments as readonly number[])[k] as number;
        const out = JSON.parse(runMarklessLayout(JSON.stringify({ assignment: index, dpr: at.dpr, viewport: at.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan }))) as unknown[];
        expect(out[0], `${t} state ${k}`).toBe('ok');
        const names = new Map(x.planNames![index]);
        const got = new Map((out[2] as unknown[][]).map((n) => [names.get(n[0] as string) ?? (n[0] as string), decode(n.slice(1))]));
        for (const n of st.nodes) {
          if (n.frame === null) continue;
          expect(got.get(n.id), `${t} state ${k} node ${n.id}`).toEqual(exportGeometry(n));
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});
