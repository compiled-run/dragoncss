// INL-BF's planted compiler faults through runFixture, with the committed Chrome captures as the authored side. blockifySkipped
// leaves flex items and absolutely positioned boxes inline, as inline boxes the compiler then refuses on s1; inlineFlexToBlock lays an inline-flex
// flex item out as a block, which both lanes measure. The unfaulted runs pass.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import type { CompilerFaults } from 'dragon';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';

let browser: Browser;

beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});

afterAll(async () => {
  await browser.close();
});

const run = async (id: string, faults: CompilerFaults) => {
  const spec = FIXTURES.find((f) => f.id === id);
  if (spec === undefined) throw new Error(`${id} is not registered`);
  return runFixture(spec, browser, { authored: committedAuthored, faults, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
};

describe.sequential('INL-BF planted compiler faults', () => {
  // INL1a: s1 left inline is an inline box, so the compiler refuses what an inline box does not take, on s1 in each direction.
  const refusedOnS1: Record<string, (dir: 'ltr' | 'rtl') => string> = {
    'phrasing-blockified-flex-row': (dir) => `DRAGON_UNPROVEN_CONTEXT margin-top:<length-px> (set by margin: 1px 3px) on s1 is used in the inline/${dir} context`,
    'phrasing-blockified-abspos': () => 'DRAGON_UNSUPPORTED_VALUE position: absolute on s1 beside text in r1',
  };
  for (const [id, want] of Object.entries(refusedOnS1)) {
    it(`blockifySkipped: ${id} is refused on s1 in both directions; unfaulted it passes`, async () => {
      expect((await run(id, NO_FAULTS)).reason).toBeNull();
      const faulty = await run(id, { ...NO_FAULTS, blockifySkipped: true });
      expect(faulty.status).toBe('fail');
      expect(faulty.cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
      for (const c of faulty.cases) {
        expect(c.status, c.id).toBe('fail');
        expect(c.reason, c.id).toContain(want(c.direction));
      }
    });
  }
  it('inlineFlexToBlock: phrasing-blockified-inline-flex-blocks fails both lanes on the inline-flex items; unfaulted it passes', async () => {
    const id = 'phrasing-blockified-inline-flex-blocks';
    expect((await run(id, NO_FAULTS)).reason).toBeNull();
    const faulty = await run(id, { ...NO_FAULTS, inlineFlexToBlock: true });
    expect(faulty.status).toBe('fail');
    expect(faulty.cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
    for (const c of faulty.cases) {
      expect(c.status, c.id).toBe('fail');
      expect(c.lanes['linux-dragon-layout'], c.id).toBe('fail');
      expect(c.lanes['chrome-dual'], c.id).toBe('fail');
      expect(c.comparison?.nodes.filter((n) => !n.pass).map((n) => n.id), c.id).toEqual(expect.arrayContaining(['s1b', 's2b']));
    }
  });
});
