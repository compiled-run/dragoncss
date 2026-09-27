// The DPR Chrome deviation registry (chrome-deviations-dpr.ts, notes/T010-p2-triage.md ruling 1). The DPR vectors are written only
// when every node matches Chrome exactly in zoomed LU, so a vector output stands for Chrome here: every registered node must
// match it with the fault off and move under the spec-reading fault; every control must hold its place in its frame.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { absoluteRects, chromeDeviations, dprChromeDeviations, layoutWithFaults, measurerFor, NO_ENGINE_FAULTS, validateLayoutInput } from '../src/index.ts';
import type { EngineFaults, LayoutRect } from '../src/index.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');
const vectorPath = (fixture: string, dpr: number): string => (dpr === 1 ? join(dir, `${fixture}.json`) : join(dir, `dpr-${dpr}`, `${fixture}.json`));

function rects(fixture: string, dpr: number, faults: EngineFaults): { readonly engine: Map<string, LayoutRect>; readonly chrome: Map<string, LayoutRect> } {
  const v = JSON.parse(readFileSync(vectorPath(fixture, dpr), 'utf8')) as { input: unknown; output: LayoutRect[] };
  const valid = validateLayoutInput(v.input);
  if (!valid.ok) throw new Error(JSON.stringify(valid.errors));
  const m = measurerFor('darwin-arm64');
  if (m.kind !== 'ok') throw new Error(m.code);
  const r = layoutWithFaults(valid.input, m.measurer, faults);
  if (r.kind !== 'ok') throw new Error(r.unsupported.code);
  return { engine: absoluteRects(r.boxes), chrome: absoluteRects(v.output) };
}

const at = (m: Map<string, LayoutRect>, id: string): LayoutRect => {
  const r = m.get(id);
  if (r === undefined) throw new Error(`no ${id}`);
  return r;
};

describe('DPR Chrome deviation registry', () => {
  it('holds initial-line-width-unzoomed with the MF5 shape plus a DPR per node; the DPR-1 registry is unchanged', () => {
    expect(dprChromeDeviations.map((d) => [d.id, d.fault, d.branches.map((b) => b.id)])).toEqual([['initial-line-width-unzoomed', 'initialLineWidthZoomed', ['no-width-declared', 'shorthand-omitted']]]);
    expect(chromeDeviations.map((d) => d.id)).toEqual(['half-leading-floor', 'min-max-end-margin', 'wrap-reverse-baseline-line']);
    for (const d of dprChromeDeviations) {
      expect(Object.keys(NO_ENGINE_FAULTS)).toContain(d.fault);
      expect(d.blink).toMatch(/145\.0\.7632\.6/);
      for (const b of d.branches) expect(d.nodes.some((n) => n.branch === b.id), b.id).toBe(true);
      for (const n of d.nodes) expect([2, 3, 2.625]).toContain(n.dpr);
      // Every node is registered at all three ratios.
      for (const n of d.nodes) for (const dpr of [2, 3, 2.625]) expect(d.nodes.some((x) => x.fixture === n.fixture && x.node === n.node && x.dpr === dpr)).toBe(true);
    }
  });

  for (const d of dprChromeDeviations) {
    it(`${d.id}: every node matches Chrome exactly and is non-exact under ${d.fault}; every control is exact and keeps its place under it`, () => {
      const spec = { ...NO_ENGINE_FAULTS, [d.fault]: true };
      for (const n of d.nodes) {
        const main = rects(n.fixture, n.dpr, NO_ENGINE_FAULTS);
        expect(at(main.engine, n.node), `${n.node} @${n.dpr}`).toEqual(at(main.chrome, n.node));
        const faulty = rects(n.fixture, n.dpr, spec);
        expect(at(faulty.engine, n.node), `${d.fault} moves ${n.node} @${n.dpr}`).not.toEqual(at(main.chrome, n.node));
      }
      for (const c of d.controls) {
        const main = rects(c.fixture, c.dpr, NO_ENGINE_FAULTS);
        expect(at(main.engine, c.node)).toEqual(at(main.chrome, c.node));
        const faulty = rects(c.fixture, c.dpr, spec);
        const rel = (m: Map<string, LayoutRect>): number[] => {
          const a = at(m, c.node);
          const f = at(m, c.relativeTo);
          return [a.x - f.x, a.y - f.y, a.width, a.height];
        };
        expect(rel(faulty.engine), `control ${c.node} @${c.dpr}`).toEqual(rel(main.engine));
      }
    });
  }

  it('initialLineWidthZoomed is inert at DPR 1: every top-level vector lays out the same with it, so the DPR-1 registry could not hold this deviation', () => {
    expect(readFileSync(join(dir, 'color-border-sides.json'), 'utf8')).toContain('device-px');
    const all = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    expect(all.length).toBe(261);
    for (const f of all) {
      const a = rects(f, 1, NO_ENGINE_FAULTS);
      const b = rects(f, 1, { ...NO_ENGINE_FAULTS, initialLineWidthZoomed: true });
      expect([...b.engine.values()], f).toEqual([...a.engine.values()]);
    }
  });
});
