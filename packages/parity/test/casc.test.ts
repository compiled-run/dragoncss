// CASC's planted compiler faults through runFixture, with the committed Chrome captures as the authored side.
// supportsConditionIgnored applies every @supports block, so the false conditions' rules move casc-supports' boxes; revertAsUnset
// drops the user-agent roll-back, so the reverted p, h1, h2 and blockquote margins of casc-css-wide fall to 0. Unfaulted, both pass.
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

describe.sequential('CASC planted compiler faults', () => {
  const planted = [
    { fault: 'supportsConditionIgnored', fixture: 'casc-supports', nodes: ['a', 'c', 'd', 'e', 'f', 'm', 'm2'] },
    { fault: 'revertAsUnset', fixture: 'casc-css-wide', nodes: ['p1', 'h1', 'h2', 'bq'] },
  ] as const;
  for (const p of planted) {
    it(`${p.fault}: ${p.fixture} fails chrome-dual in both directions on ${p.nodes.join(', ')}; unfaulted it passes`, async () => {
      const clean = await run(p.fixture, NO_FAULTS);
      expect(clean.reason).toBeNull();
      expect(clean.status).toBe('pass');
      const faulty = await run(p.fixture, { ...NO_FAULTS, [p.fault]: true });
      expect(faulty.status).toBe('fail');
      expect(faulty.cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
      for (const c of faulty.cases) {
        expect(c.status, c.id).toBe('fail');
        expect(c.lanes['chrome-dual'], c.id).toBe('fail');
        expect(c.comparison?.nodes.filter((n) => !n.pass).map((n) => n.id), c.id).toEqual(expect.arrayContaining([...p.nodes]));
      }
    });
  }
});
