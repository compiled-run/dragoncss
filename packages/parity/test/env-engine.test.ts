// ENV-SAFE host proof of the native mapping: the compiler's native lowering of each env() fixture, laid out by the shared engine
// with the fixture's safe-area insets injected into the layout input, matches Chrome's committed capture under the same insets
// (1 device px). Native targets still refuse env(): no runtime reads the root view's insets yet, so this proves only the engine
// path a host would feed. Planted faults show the check sees a missing, ignored or swapped inset.
import { describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutInput } from '@dragon/layout';
import { absoluteRects, environmentDependencies, layoutWithFaults, measurerFor, NO_ENGINE_FAULTS, REFERENCE_PLATFORM, validateLayoutInput } from '@dragon/layout';
import type { CompilerFaults } from 'dragon';
import { iosLayoutProjection, NO_FAULTS } from 'dragon';
import type { ParityCase } from '../src/cases.ts';
import { compareLayout } from '../src/compare.ts';
import { committedEnvAuthored, envCases } from '../src/env-run.ts';
import type { EnvFixture, SafeAreaInsets } from '../src/fixture-groups/env.ts';
import { ENV_FIXTURES } from '../src/fixture-groups/env.ts';
import { compileFixture } from '../src/pipeline.ts';

const ZERO: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function measurer() {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  return m.measurer;
}

/** The case's engine input with the insets a host would inject. */
function injected(f: EnvFixture, c: ParityCase, insets: SafeAreaInsets, faults: CompilerFaults = NO_FAULTS): LayoutInput {
  const { compiled } = compileFixture(f.spec, faults, 'derive', c.environment.direction);
  const p = iosLayoutProjection(compiled, c.environment, c.assignment);
  if (p.kind !== 'ready') throw new Error(`${c.id}: ${p.reason}`);
  const v = validateLayoutInput(JSON.parse(JSON.stringify({ ...p.input, safeArea: insets })));
  if (!v.ok) throw new Error(`${c.id}: ${v.errors.map((e) => `${e.path} ${e.code}`).join('; ')}`);
  return v.input;
}

/** The engine's layout of the input against the committed Chrome capture: the comparison's problems, none when it passes. */
async function problems(f: EnvFixture, c: ParityCase, input: LayoutInput, engineFaults: EngineFaults = NO_ENGINE_FAULTS): Promise<string[]> {
  const r = layoutWithFaults(input, measurer(), engineFaults);
  if (r.kind !== 'ok') return [`LayoutUnsupported ${r.unsupported.code}: ${r.unsupported.detail}`];
  const cmp = compareLayout(await committedEnvAuthored(f)(c), absoluteRects(r.boxes), input, c.environment);
  return cmp.pass ? [] : [...cmp.problems];
}

const nonzero = ENV_FIXTURES.filter((f) => Object.values(f.safeArea).some((v) => v !== 0));

describe('env(safe-area-inset-*): the engine with injected insets against Chrome under the same insets', () => {
  for (const f of ENV_FIXTURES) {
    it(`${f.spec.id} at ${JSON.stringify(f.safeArea)}`, async () => {
      const cases = envCases(f);
      expect(cases.length).toBe(2);
      for (const c of cases) {
        const input = injected(f, c, f.safeArea);
        // The host re-lays out when the insets change (rotation): the input says it reads them.
        expect(environmentDependencies(input).safeArea, c.id).toBe(true);
        expect(await problems(f, c, input), c.id).toEqual([]);
      }
    });
  }

  it('the insets of one orientation do not lay out the other: the result follows the injected insets', async () => {
    const portrait = ENV_FIXTURES.find((f) => f.spec.id === 'env-safe-area-portrait') as EnvFixture;
    const landscape = ENV_FIXTURES.find((f) => f.spec.id === 'env-safe-area-landscape') as EnvFixture;
    for (const [f, other] of [[portrait, landscape], [landscape, portrait]] as const) {
      for (const c of envCases(f)) expect((await problems(f, c, injected(f, c, other.safeArea))).length, c.id).toBeGreaterThan(0);
    }
  });

  it('planted: a host that injects no insets (zero) fails every nonzero fixture', async () => {
    expect(nonzero.length).toBe(3);
    for (const f of nonzero) for (const c of envCases(f)) expect((await problems(f, c, injected(f, c, ZERO))).length, c.id).toBeGreaterThan(0);
  });

  it('planted engine fault safeAreaIgnored fails every nonzero fixture', async () => {
    for (const f of nonzero) for (const c of envCases(f)) expect((await problems(f, c, injected(f, c, f.safeArea), { ...NO_ENGINE_FAULTS, safeAreaIgnored: true })).length, c.id).toBeGreaterThan(0);
  });

  it('planted compiler fault envSideSwapped fails the fixture with four different insets', async () => {
    const f = ENV_FIXTURES.find((x) => x.spec.id === 'env-safe-area-math') as EnvFixture;
    for (const c of envCases(f)) expect((await problems(f, c, injected(f, c, f.safeArea, { ...NO_FAULTS, envSideSwapped: true }))).length, c.id).toBeGreaterThan(0);
  });
});
