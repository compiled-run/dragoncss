// TXT2-c (notes/T149-txt2-spec.md R3): the white-space group against the pinned Chrome, captured live: every layout fixture passes
// both lanes (engine lines, fragments and breaks against Chrome's; Dragon's web CSS against the authored CSS), every reject is
// refused, and each planted engine and compiler fault fails the fixture that names it.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import type { CompilerFaults } from 'dragon';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { WHITE_SPACE } from '../src/fixture-groups/white-space.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { liveAuthored, runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';

let browser: Browser | undefined;

beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});

afterAll(async () => {
  await browser?.close();
});

const run = async (id: string, faults: CompilerFaults, engineFaults: EngineFaults) => {
  const spec = FIXTURES.find((f) => f.id === id);
  if (spec === undefined) throw new Error(`${id} is not registered`);
  if (browser === undefined) throw new Error('Chrome did not launch');
  // derive: the comparison does not lean on the profile rows these very cases prove (parity.test.ts runs them under enforce).
  return runFixture(spec, browser, { authored: liveAuthored(browser), faults, engineFaults, profiles: 'derive' });
};

describe.sequential('the white-space group against Chrome', () => {
  for (const spec of WHITE_SPACE) {
    it(`${spec.id} (${spec.kind}) passes`, async () => {
      const r = await run(spec.id, NO_FAULTS, NO_ENGINE_FAULTS);
      expect(r.reason).toBeNull();
      expect(r.status).toBe('pass');
      if (spec.kind === 'layout') expect(r.cases.length).toBeGreaterThan(0);
    }, 300_000);
  }
});

/** Each engine plant, the fixture that catches it, and the text nodes whose lines it moves off Chrome's. */
const ENGINE_PLANTS: readonly { readonly fault: keyof EngineFaults; readonly fixture: string; readonly nodes: readonly string[] }[] = [
  { fault: 'preservedSpaceCollapsed', fixture: 'white-space-preserve', nodes: ['a:text0', 'b:text0'] },
  { fault: 'trailingPreWrapNotHanging', fixture: 'white-space-wrap', nodes: ['o:text0'] },
  { fault: 'breakSpacesHanging', fixture: 'white-space-wrap', nodes: ['b:text0'] },
];

describe.sequential('TXT2-c planted engine faults', () => {
  for (const p of ENGINE_PLANTS) {
    it(`${p.fault}: ${p.fixture} fails the layout lane on ${p.nodes.join(', ')}`, async () => {
      const faulty = await run(p.fixture, NO_FAULTS, { ...NO_ENGINE_FAULTS, [p.fault]: true });
      expect(faulty.status).toBe('fail');
      expect(faulty.cases.length).toBeGreaterThan(0);
      for (const c of faulty.cases) {
        expect(c.lanes['linux-dragon-layout'], c.id).toBe('fail');
        const failed = (c.comparison?.nodes ?? []).filter((n) => !n.pass).map((n) => n.id);
        for (const n of p.nodes) expect(failed.some((f) => f === n || f.startsWith(`${n}:`)), `${c.id} ${n}: ${failed.join(', ')}`).toBe(true);
      }
    }, 300_000);
  }
});

describe.sequential('TXT2-c planted compiler fault', () => {
  it('preLineKeepsSpaceBeforeNewline: white-space-preserve fails on the rejected engine input', async () => {
    const faulty = await run('white-space-preserve', { ...NO_FAULTS, preLineKeepsSpaceBeforeNewline: true }, NO_ENGINE_FAULTS);
    expect(faulty.status).toBe('fail');
    for (const c of faulty.cases) {
      expect(c.status, c.id).toBe('fail');
      expect(c.reason, c.id).toMatch(/^layout input rejected: .*uncollapsed-text/);
    }
  }, 300_000);
});
