// CASC's planted compiler faults through runFixture, with the committed Chrome captures as the authored side.
// supportsConditionIgnored applies every @supports block, so the false conditions' rules move casc-supports' boxes; revertAsUnset
// drops the user-agent roll-back, so casc-css-wide's display: revert falls to inline on r1, p1 and h1. Since INL1a lowers inline boxes,
// that output is no longer refused at lowering: under enforced profiles it is refused as an unproven inline context, and with profiles
// derived (no profile gate) it reaches Chrome, where chrome-dual fails on those boxes' display and geometry. Unfaulted, both pass.
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

const run = async (id: string, faults: CompilerFaults, profiles: 'enforce' | 'derive' = 'enforce') => {
  const spec = FIXTURES.find((f) => f.id === id);
  if (spec === undefined) throw new Error(`${id} is not registered`);
  return runFixture(spec, browser, { authored: committedAuthored, faults, engineFaults: NO_ENGINE_FAULTS, profiles });
};

describe.sequential('CASC planted compiler faults', () => {
  it('supportsConditionIgnored: casc-supports fails chrome-dual in both directions on the boxes a false condition moves; unfaulted it passes', async () => {
    const clean = await run('casc-supports', NO_FAULTS);
    expect(clean.reason).toBeNull();
    expect(clean.status).toBe('pass');
    const faulty = await run('casc-supports', { ...NO_FAULTS, supportsConditionIgnored: true });
    expect(faulty.status).toBe('fail');
    expect(faulty.cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
    for (const c of faulty.cases) {
      expect(c.status, c.id).toBe('fail');
      expect(c.lanes['chrome-dual'], c.id).toBe('fail');
      expect(c.comparison?.nodes.filter((n) => !n.pass).map((n) => n.id), c.id).toEqual(expect.arrayContaining(['a', 'c', 'd', 'e', 'f', 'm', 'm2']));
    }
  });
  it('revertAsUnset: casc-css-wide fails chrome-dual in both directions where display: revert falls to inline (r1, p1, h1), and enforced profiles refuse it; unfaulted it passes', async () => {
    const clean = await run('casc-css-wide', NO_FAULTS);
    expect(clean.reason).toBeNull();
    expect(clean.status).toBe('pass');
    const refused = await run('casc-css-wide', { ...NO_FAULTS, revertAsUnset: true });
    expect(refused.status).toBe('fail');
    expect(refused.cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
    for (const c of refused.cases) {
      expect(c.status, c.id).toBe('fail');
      expect(c.reason, c.id).toContain(`DRAGON_UNPROVEN_CONTEXT display:revert on r1 is used in the inline/${c.direction} context`);
    }
    const faulty = await run('casc-css-wide', { ...NO_FAULTS, revertAsUnset: true }, 'derive');
    expect(faulty.status).toBe('fail');
    expect(faulty.cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
    for (const c of faulty.cases) {
      expect(c.status, c.id).toBe('fail');
      expect(c.lanes['chrome-dual'], c.id).toBe('fail');
      for (const id of ['r1', 'p1', 'h1']) expect(c.reason, c.id).toContain(`${id}: display authored "block" compiled "inline"`);
    }
  });
});
