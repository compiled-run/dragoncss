// TXT-FONTFEAT: an explicit font-synthesis-small-caps: auto (text-synthesis-small-caps-ahem, fixture-groups/text-font-variant.ts)
// against a live Chrome 145 capture, so the proof needs no regen. auto is the initial value, which Dragon already lays out and draws
// (analysis/computed.ts synthesizesSmallCaps), but no committed case set it explicitly, so no profile row allowed it and every target
// refused it. Here the fixture passes chrome-dual and linux-dragon-layout in both directions with derived profiles, and the rows
// pnpm run profile:rows derives from that run allow auto in text-in-block on web, iOS and Android. The smallCapsUnsynthesized plant
// (small capitals laid out at the full size) must fail the same run.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { FIXTURES } from '../src/fixtures.ts';
import type { FixtureOutcome } from '../src/pipeline.ts';
import { liveAuthored, runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';
import { deriveRows } from '../src/profile-rows.ts';

const ID = 'text-synthesis-small-caps-ahem';
let browser: Browser;

beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});

afterAll(async () => {
  await browser.close();
});

const spec = () => {
  const f = FIXTURES.find((x) => x.id === ID);
  if (f === undefined) throw new Error(`no fixture ${ID}`);
  return f;
};
const lanes = (out: FixtureOutcome) => out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']]);

describe('TXT-FONTFEAT: an explicit font-synthesis-small-caps: auto equals live Chrome', () => {
  let out: FixtureOutcome;

  it(`${ID} passes chrome-dual and linux-dragon-layout in ltr and rtl`, async () => {
    out = await runFixture(spec(), browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' });
    expect(out.reason).toBeNull();
    expect(lanes(out)).toEqual([['ltr', 'pass', 'pass'], ['rtl', 'pass', 'pass']]);
  }, 300_000);

  it('the derived profile rows allow auto in text-in-block on every target, proved by this fixture', () => {
    for (const target of ['web', 'ios', 'android'] as const) {
      const rows = deriveRows(target, out.cases).filter((r) => r.feature === 'font-synthesis-small-caps:auto');
      expect(rows.map((r) => r.context).filter((c) => c.startsWith('text-in-block/')).sort(), target).toEqual(['text-in-block/ltr', 'text-in-block/rtl']);
      for (const r of rows) {
        expect(r.status, `${target} ${r.context}`).toBe('exact');
        for (const p of r.proofs) expect(p.cases.length, `${target} ${r.context} ${p.lane}`).toBeGreaterThan(0);
      }
    }
  });

  it('the smallCapsUnsynthesized plant fails it', async () => {
    const planted = await runFixture(spec(), browser, { authored: liveAuthored(browser), faults: { ...NO_FAULTS, smallCapsUnsynthesized: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' });
    expect(planted.cases.every((c) => c.lanes['linux-dragon-layout'] === 'fail')).toBe(true);
  }, 300_000);
});
