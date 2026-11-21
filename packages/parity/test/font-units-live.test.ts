// Font-metric units (fixture-groups/font-units.ts) against live Chrome 145: font-units-ahem passes chrome-dual and
// linux-dragon-layout in both directions and the engine equals Chrome at every DPR, the planted compiler fault fontMetricAsEm (ex,
// ch and cap read as em) fails it, the earlier font-metric rejects keep failing as rejects, and each new reject is refused. Chrome is
// captured live and the support profiles are derived from the run, as the regen does, since the fixture is new: the committed
// captures and profiles come with its first regen.
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

const specOf = (id: string) => {
  const f = FIXTURES.find((x) => x.id === id);
  if (f === undefined) throw new Error(`no fixture ${id}`);
  return f;
};

const LAYOUT = 'font-units-ahem';
const REJECTS = ['reject-font-units-letter-spacing', 'reject-font-units-inherit', 'reject-font-units-keyframes', 'reject-font-units-root', 'reject-unit-ex'];
const live = () => ({ authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' as const });

describe('the font-units fixtures against live Chrome', () => {
  it(`${LAYOUT} passes chrome-dual and linux-dragon-layout in ltr and rtl`, async () => {
    const out = await runFixture(specOf(LAYOUT), browser, live());
    expect(out.reason).toBeNull();
    expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual([['ltr', 'pass', 'pass'], ['rtl', 'pass', 'pass']]);
  }, 300_000);

  it(`the planted fontMetricAsEm fails ${LAYOUT} on linux-dragon-layout`, async () => {
    const out = await runFixture(specOf(LAYOUT), browser, { ...live(), faults: { ...NO_FAULTS, fontMetricAsEm: true } });
    expect(out.cases.map((c) => [c.direction, c.lanes['linux-dragon-layout']])).toEqual([['ltr', 'fail'], ['rtl', 'fail']]);
  }, 300_000);

  for (const id of REJECTS) {
    it(`${id} is refused on every target`, async () => {
      const out = await runFixture(specOf(id), browser, live());
      expect(out.reason).toBeNull();
      expect(out.status).toBe('pass');
    }, 300_000);
  }
});

describe(`${LAYOUT} equals live Chrome at every DPR`, () => {
  const cases = layoutCases().filter((f) => f.spec.id === LAYOUT).flatMap((f) => f.cases);
  const compiled = { ltr: compileFixture(specOf(LAYOUT), NO_FAULTS, 'derive', 'ltr').compiled, rtl: compileFixture(specOf(LAYOUT), NO_FAULTS, 'derive', 'rtl').compiled };
  for (const dpr of DPRS) {
    it(`at DPR ${dpr}`, async () => {
      expect(cases.length).toBe(2);
      const b = await launchChrome(dpr);
      try {
        await zoomGuard(b, dpr);
        const failed: string[] = [];
        for (const c of cases) {
          const capture = await captureFixture(b, c.id, c.authoredHtml, atDpr(c.environment, dpr), [], c.authoredPrepare ?? undefined);
          expect(capture.devicePixelRatio).toBe(dpr);
          const o = runDprCase(c, compiled[c.environment.direction], dpr, capture, NO_ENGINE_FAULTS);
          if (o.status === 'fail') failed.push(`${o.id}@${o.dpr}: ${o.reason}`);
        }
        expect(failed).toEqual([]);
      } finally {
        await b.close();
      }
    }, 300_000);
  }
});
