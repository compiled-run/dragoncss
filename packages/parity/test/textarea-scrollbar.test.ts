// controls-textarea-scrollbar (fixture-groups/controls.ts) against live Chrome 145: the scrollbar thickness Chrome adds to a
// textarea's default size (16 DIP at scrollbar-width auto, 14 at thin; to the inline size unless overflow-y is hidden or clip, to
// the height at overflow-x: scroll) lays out as Chrome's. The fixture passes chrome-dual and linux-dragon-layout, the engine equals
// Chrome at every DPR (thin is trunc(14 x 2.625) = 36 device px at 2.625), and a textarea with no scrollbar added in lowering
// fails. Chrome is captured live and the profiles derived from the run, as the regen does.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { captureFixture } from '../src/capture.ts';
import { atDpr, DPRS, layoutCases, runDprCase, zoomGuard } from '../src/dpr.ts';
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

const ID = 'controls-textarea-scrollbar';
const spec = FIXTURES.find((x) => x.id === ID);
if (spec === undefined) throw new Error(`no fixture ${ID}`);
const live = () => ({ authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' as const });

describe(`${ID} against live Chrome`, () => {
  it('passes chrome-dual and linux-dragon-layout', async () => {
    const out = await runFixture(spec, browser, live());
    expect(out.reason).toBeNull();
    expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual([['ltr', 'pass', 'pass']]);
  }, 300_000);
});

describe(`${ID} equals live Chrome at every DPR`, () => {
  const cases = layoutCases().filter((f) => f.spec.id === ID).flatMap((f) => f.cases);
  const compiled = compileFixture(spec, NO_FAULTS, 'derive', 'ltr').compiled;
  for (const dpr of DPRS) {
    it(`at DPR ${dpr}`, async () => {
      expect(cases.length).toBe(1);
      const b = await launchChrome(dpr);
      try {
        await zoomGuard(b, dpr);
        const failed: string[] = [];
        for (const c of cases) {
          const capture = await captureFixture(b, c.id, c.authoredHtml, atDpr(c.environment, dpr), [], c.authoredPrepare ?? undefined);
          expect(capture.devicePixelRatio).toBe(dpr);
          const o = runDprCase(c, compiled, dpr, capture, NO_ENGINE_FAULTS);
          if (o.status === 'fail') failed.push(`${o.id}@${o.dpr}: ${o.reason}`);
        }
        expect(failed).toEqual([]);
      } finally {
        await b.close();
      }
    }, 300_000);
  }
});
