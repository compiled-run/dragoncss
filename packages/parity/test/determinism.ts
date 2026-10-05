// determinism (S5 (c)), split across parity-determinism-<k>.test.ts so its Chrome work runs on several workers and shards: every
// fixture in both environments gives the same digest, diagnostics, web CSS, layout projection, vectors and report when compiled
// twice and with every order-free list shuffled. Chunk k of n holds the fixtures at FIXTURES indices congruent to k - 1 mod n;
// parity.test.ts proves the chunk files together check every fixture exactly once.
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import type { FrontEndResult } from 'dragon';
import { NO_FAULTS } from 'dragon';
import type { WebCapture } from '../src/capture.ts';
import type { ParityCase } from '../src/cases.ts';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { expectedPath } from '../src/committed.ts';
import { environmentsOf, FIXTURE_GROUPS, FIXTURES } from '../src/fixtures.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';
import type { FixtureOutcome } from '../src/pipeline.ts';
import { compileFixture, runFixture } from '../src/pipeline.ts';
import { buildReport } from '../src/report.ts';

/** The number of parity-determinism-<k>.test.ts files. */
export const DETERMINISM_CHUNKS = 4;

/** The fixtures chunk k (1-based) of n checks. */
export function determinismChunk(k: number, n: number = DETERMINISM_CHUNKS): FixtureSpec[] {
  if (!Number.isInteger(k) || k < 1 || k > n) throw new Error(`determinism chunk ${k} is not in 1..${n}`);
  return FIXTURES.filter((_, i) => i % n === k - 1);
}

// Order-free lists: snapshot sources, assets and resolutions, tree modules, components and style use definitions. The document's
// style order (document.styles) is ordered: the cascade reads it.
const shuffle = <T>(xs: readonly T[]): T[] => (xs.length < 2 ? [...xs] : [...xs.slice(1), xs[0] as T].reverse());
export const shuffled = (input: FrontEndResult): FrontEndResult => ({
  ...input,
  snapshot: { ...input.snapshot, sources: shuffle(input.snapshot.sources), assets: shuffle(input.snapshot.assets), resolutions: shuffle(input.snapshot.resolutions) },
  tree: input.tree === null ? null : { ...input.tree, modules: shuffle(input.tree.modules), components: shuffle(input.tree.components), styles: shuffle(input.tree.styles) },
});
const canonicalDiagnostics = (o: FixtureOutcome): string[] => o.diagnostics.map((d) => JSON.stringify(d)).sort();
const stable = (o: FixtureOutcome): string => JSON.stringify({ ...o, diagnostics: canonicalDiagnostics(o) });
// The committed capture, which the per-fixture tests of parity.test.ts assert equals the live one byte for byte.
const committed = async (c: ParityCase): Promise<WebCapture> => JSON.parse(readFileSync(expectedPath(c.id), 'utf8')) as WebCapture;
// Budget per environment of one shard: the slowest fixture (tree-switch-two-instances, 32 cases) measured 3.4 s per environment
// standalone (the main outcome recomputed) at load average 47; 30 s leaves about 9x headroom for load.
const PER_ENVIRONMENT_MS = 30_000;

/** Declares chunk k's determinism tests, under the same describe titles they had in parity.test.ts. */
export function determinismSuite(k: number): void {
  const chunk = determinismChunk(k);
  const ids = new Set(chunk.map((f) => f.id));
  let browser: Browser;
  beforeAll(async () => {
    requireReferencePlatform(hostPlatform());
    browser = await launchChrome();
    expect(browser.version()).toBe(CHROME_VERSION);
  });
  afterAll(async () => {
    await browser?.close();
  });
  const checked = { fixtures: new Set<string>(), compilePairs: 0, laneComparisons: 0 };

  describe.sequential('S5 parity: Chrome 145 vs Dragon, every case of every fixture in every environment (layout lane at 1 device px, dual lane exact)', () => {
    describe('determinism (S5 (c))', () => {
      for (const group of FIXTURE_GROUPS) {
        const fixtures = group.fixtures.filter((f) => ids.has(f.id));
        if (fixtures.length === 0) continue;
        describe(group.id, () => {
          for (const spec of fixtures) {
            const environments = environmentsOf(spec);
            it(`${spec.id}: compiled twice and shuffled, in ${environments.map((e) => e.direction).join(' and ')}`, { timeout: PER_ENVIRONMENT_MS * environments.length }, async () => {
              for (const e of environments) {
                const a = compileFixture(spec, NO_FAULTS, 'enforce', e.direction).compiled;
                const b = compileFixture(spec, NO_FAULTS, 'enforce', e.direction).compiled;
                const c = compileFixture(spec, NO_FAULTS, 'enforce', e.direction, shuffled).compiled;
                for (const x of [b, c]) {
                  expect(x.digest, `${spec.id} ${e.direction}`).toBe(a.digest);
                  expect(JSON.stringify(x.outputs), `${spec.id} ${e.direction}`).toBe(JSON.stringify(a.outputs));
                  expect(x.diagnostics.map((d) => JSON.stringify(d)).sort(), spec.id).toEqual(a.diagnostics.map((d) => JSON.stringify(d)).sort());
                  expect(JSON.stringify(x.dependencies), spec.id).toBe(JSON.stringify(a.dependencies));
                  checked.compilePairs++;
                }
              }
              // Both lanes again on the shuffled input: every case outcome (projection, vector, comparisons, CSS) and the report equal.
              const run = { authored: committed, faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' } as const;
              const again = await runFixture(spec, browser, { ...run, transformInput: shuffled });
              const main = await runFixture(spec, browser, run);
              expect(stable(again), spec.id).toBe(stable(main));
              expect(JSON.stringify(buildReport([again]).fixtures), spec.id).toBe(JSON.stringify(buildReport([main]).fixtures));
              checked.laneComparisons++;
              checked.fixtures.add(spec.id);
            });
          }
        });
      }

      it(`coverage (chunk ${k} of ${DETERMINISM_CHUNKS}): every fixture of the chunk was checked, with two compile comparisons per environment and one lane comparison`, () => {
        expect(chunk.length).toBeGreaterThan(0);
        expect([...checked.fixtures].sort()).toEqual(chunk.map((f) => f.id).sort());
        expect(checked.compilePairs).toBe(2 * chunk.reduce((n, f) => n + environmentsOf(f).length, 0));
        expect(checked.laneComparisons).toBe(chunk.length);
      });
    });
  });
}
