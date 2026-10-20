// TXT-FONTFEAT (fixture-groups/text-font-tuning.ts): font-kerning, font-optical-sizing and font-language-override over Ahem against
// Chrome 145. The layout fixture passes both lanes in both directions and at every DPR.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { DPRS, layoutCases, runDprCase, committedDprCapture } from '../src/dpr.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { compileFixture, liveAuthored, runFixture } from '../src/pipeline.ts';
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

const specOf = (id: string) => {
  const f = FIXTURES.find((x) => x.id === id);
  if (f === undefined) throw new Error(`no fixture ${id}`);
  return f;
};

describe('the text-font-tuning fixtures', () => {
  // DRAGON_LIVE_AUTHORED=1 captures Chrome live instead of reading the committed capture (before the first regen of a new fixture).
  const authored = () => (process.env['DRAGON_LIVE_AUTHORED'] === '1' ? liveAuthored(browser) : committedAuthored);
  it('text-font-tuning-ahem passes chrome-dual and linux-dragon-layout in ltr and rtl', async () => {
    const out = await runFixture(specOf('text-font-tuning-ahem'), browser, { authored: authored(), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    expect(out.reason).toBeNull();
    expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual([['ltr', 'pass', 'pass'], ['rtl', 'pass', 'pass']]);
  }, 300_000);
});

describe('text-font-tuning-ahem passes at every DPR', () => {
  const corpus = layoutCases().filter((f) => f.spec.id === 'text-font-tuning-ahem');
  const compiled = { ltr: compileFixture(specOf('text-font-tuning-ahem'), NO_FAULTS, 'enforce', 'ltr').compiled, rtl: compileFixture(specOf('text-font-tuning-ahem'), NO_FAULTS, 'enforce', 'rtl').compiled };
  for (const dpr of [1, ...DPRS]) {
    it(`at DPR ${dpr}`, () => {
      const cases = corpus.flatMap((f) => f.cases);
      expect(cases.length).toBe(2);
      expect(cases.map((c) => runDprCase(c, compiled[c.environment.direction], dpr, committedDprCapture(c.id, dpr), NO_ENGINE_FAULTS)).filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}: ${o.reason}`)).toEqual([]);
    });
  }
});
