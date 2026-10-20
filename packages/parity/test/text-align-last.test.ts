// TXT2-tal (fixture-groups/text-align-last.ts): text-align-last values that align the last line as auto does, over Ahem against Chrome
// 145. The layout fixture passes both lanes in both directions and at every DPR, each reject is refused on every target, and the
// compiler plant alignLastAccepted lets each reject through.
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

const LAYOUT = [['text-align-last-ahem', ['ltr', 'rtl']]] as const;

describe('the text-align-last fixtures', () => {
  // DRAGON_LIVE_AUTHORED=1 captures Chrome live instead of reading the committed capture (before the first regen of a new fixture).
  const authored = () => (process.env['DRAGON_LIVE_AUTHORED'] === '1' ? liveAuthored(browser) : committedAuthored);
  for (const [id, directions] of LAYOUT) {
    it(`${id} passes chrome-dual and linux-dragon-layout in ${directions.join(' and ')}`, async () => {
      const out = await runFixture(specOf(id), browser, { authored: authored(), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(out.reason).toBeNull();
      expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual(directions.map((d) => [d, 'pass', 'pass']));
    }, 300_000);
  }
  for (const id of ['reject-text-align-last-justify', 'reject-text-align-last-atomic', 'reject-text-align-last-inline']) {
    it(`${id} is refused on every target`, async () => {
      const out = await runFixture(specOf(id), browser, { authored: authored(), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(out.reason).toBeNull();
      expect(out.status).toBe('pass');
    }, 300_000);
  }
  for (const id of ['reject-text-align-last-justify', 'reject-text-align-last-atomic', 'reject-text-align-last-inline']) {
    it(`alignLastAccepted lets ${id} through`, async () => {
      const out = await runFixture(specOf(id), browser, { authored: authored(), faults: { ...NO_FAULTS, alignLastAccepted: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(out.status).toBe('fail');
    }, 300_000);
  }
});

describe('the text-align-last fixtures pass at every DPR', () => {
  for (const [id, directions] of LAYOUT) {
    const corpus = layoutCases().filter((f) => f.spec.id === id);
    const compiled = { ltr: compileFixture(specOf(id), NO_FAULTS, 'enforce', 'ltr').compiled, rtl: compileFixture(specOf(id), NO_FAULTS, 'enforce', 'rtl').compiled };
    for (const dpr of [1, ...DPRS]) {
      it(`${id} at DPR ${dpr}`, () => {
        const cases = corpus.flatMap((f) => f.cases);
        expect(cases.length).toBe(directions.length);
        expect(cases.map((c) => runDprCase(c, compiled[c.environment.direction], dpr, committedDprCapture(c.id, dpr), NO_ENGINE_FAULTS)).filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}: ${o.reason}`)).toEqual([]);
      });
    }
  }
});
