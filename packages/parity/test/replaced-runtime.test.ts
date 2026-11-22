// REPL-r1: an img whose src the app sets at run time, laid out once by Dragon and rendered by Chrome once per sample image
// (runtime-samples.ts, committed by parity:runtime-capture). Every sample's boxes equal Dragon's one layout at DPR 1, 2, 2.625 and
// 3 in both directions, and the planted fault runtimeNaturalUnchecked fails.
import { describe, expect, it } from 'vitest';
// targets.ts first: it and dpr.ts import each other, and dpr.ts must finish before targets.ts runs.
import { deviceDprs } from '../src/targets.ts';
import type { LayoutBox, LayoutInput, LayoutNode } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import type { Compiled, LayoutProjection } from 'dragon';
import { engineLayoutProjection, NO_FAULTS } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import type { ParityCase } from '../src/cases.ts';
import { runDprCase } from '../src/dpr.ts';
import { ENVIRONMENT, FIXTURES } from '../src/fixtures.ts';
import { compileFixture, enforcedCompile } from '../src/pipeline.ts';
import type { Projection } from '../src/pipeline.ts';
import type { RuntimeSample } from '../src/runtime-samples.ts';
import { committedRuntimeCapture, fixtureRuntimeLayout, RUNTIME_DPRS, runtimeImgs, samplesOf } from '../src/runtime-samples.ts';

const RUNTIME = FIXTURES.filter((s) => s.format === 'html' && runtimeImgs(fixtureInput(s)).length > 0);
const LAYOUT = RUNTIME.filter((s) => s.kind === 'layout');
const DEVICE_DPRS = [...new Set([...deviceDprs('ios'), ...deviceDprs('android')])].sort((a, b) => a - b);
const casesOfSpec = (id: string): ParityCase[] => {
  const spec = RUNTIME.find((s) => s.id === id);
  if (spec === undefined) throw new Error(`no runtime fixture ${id}`);
  return casesOf(spec, fixtureInput(spec));
};
const samples = (id: string): readonly RuntimeSample[] => samplesOf(id, runtimeImgs(fixtureInput(RUNTIME.find((s) => s.id === id) as (typeof RUNTIME)[number])).some((i) => i.absent));

// The plant runtimeNaturalUnchecked: the run-time natural size reads as 300x150 instead of refusing the layout.
const unchecked = (n: LayoutNode): LayoutNode => {
  if (n.kind === 'replaced') return n.natural.kind === 'runtime' ? { ...n, natural: { kind: 'image', width: 300, height: 150 } } : n;
  if (n.kind === 'box' || n.kind === 'control') return { ...n, children: n.children.map((c) => (c.kind === 'box' || c.kind === 'control' || c.kind === 'replaced' ? unchecked(c) : c)) } as LayoutNode;
  return n;
};
const uncheckedInput = (input: LayoutInput): LayoutInput => ({ ...input, root: unchecked(input.root) as LayoutBox });
const uncheckedProjection: Projection = (compiled, env, assignment) => {
  const p: LayoutProjection = engineLayoutProjection(compiled, env, assignment);
  return p.kind === 'ready' ? { ...p, input: uncheckedInput(p.input) } : p;
};

describe('REPL-r1: every sample image Chrome loads lays out as Dragon\'s one layout', () => {
  it('covers the runtime fixtures, at DPR 1 and every device DPR', () => {
    expect(RUNTIME_DPRS).toEqual([1, ...DEVICE_DPRS]);
    expect(LAYOUT.map((s) => s.id)).toEqual(['replaced-runtime-sized', 'replaced-runtime-ratio', 'replaced-runtime-fit', 'replaced-runtime-flex', 'replaced-runtime-grid', 'replaced-runtime-absent', 'replaced-runtime-src-change']);
    expect(RUNTIME.length - LAYOUT.length).toBe(6);
  });

  it('at DPR 1, 2, 2.625 and 3, in both directions, every sample (loaded, pending, no src and changed) is exact in LU', () => {
    const off: string[] = [];
    let compared = 0;
    for (const spec of LAYOUT) {
      for (const c of casesOfSpec(spec.id)) {
        const compiled = enforcedCompile(spec, c.environment.direction);
        for (const sample of samples(spec.id)) {
          for (const dpr of RUNTIME_DPRS) {
            const o = runDprCase(c, compiled, dpr, committedRuntimeCapture(c.id, sample.id, dpr));
            compared++;
            if (o.status !== 'pass') off.push(`${c.id}~${sample.id}@${dpr}: ${o.reason}`);
          }
        }
      }
    }
    expect(off).toEqual([]);
    expect(compared).toBe(14 * 4 * 9 + 2 * 4 * 2);
  });
});

describe('REPL-r1 plant runtimeNaturalUnchecked: the run-time natural size read as 300x150', () => {
  const READS = ['reject-runtime-src-auto-height', 'reject-runtime-src-auto-ratio', 'reject-runtime-src-flex-auto-min', 'reject-runtime-src-shrink-to-fit'];
  const planted = (id: string): Compiled<'ios' | 'web'> => compileFixture(RUNTIME.find((s) => s.id === id) as (typeof RUNTIME)[number], NO_FAULTS, 'enforce', 'ltr', (i) => i, fixtureRuntimeLayout(ENVIRONMENT.viewport, uncheckedInput)).compiled;

  it('lets every reject fixture whose layout reads the natural size compile', () => {
    for (const id of READS) {
      const c = planted(id);
      expect(c.diagnostics.filter((d) => d.code === 'DRAGON_RUNTIME_IMAGE_SIZE').map((d) => d.message), id).toEqual([]);
      expect(c.ok, id).toBe(true);
    }
  });

  it('then lays the flex and shrink-to-fit fixtures out differently from Chrome for some sample', () => {
    for (const id of ['reject-runtime-src-flex-auto-min', 'reject-runtime-src-shrink-to-fit', 'reject-runtime-src-auto-height']) {
      const [c] = casesOfSpec(id) as [ParityCase];
      const compiled = planted(id);
      const failing = samples(id).flatMap((s) => RUNTIME_DPRS.filter((dpr) => runDprCase(c, compiled, dpr, committedRuntimeCapture(c.id, s.id, dpr), NO_ENGINE_FAULTS, uncheckedProjection).status === 'fail').map((dpr) => `${s.id}@${dpr}`));
      expect(failing.length, id).toBeGreaterThan(0);
    }
  });
});
