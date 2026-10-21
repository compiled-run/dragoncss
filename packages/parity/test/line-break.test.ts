// TXT2-lb (fixture-groups/text-line-break.ts): line-break auto, loose, normal and strict over Ahem against Chrome 145. The layout
// fixtures pass both lanes (letters in both directions, digits and punctuation left to right), the rejects are refused on every
// target, and the compiler plant lineBreakOutsideAsciiAccepted lets reject-text-line-break-char through.
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

const LAYOUT = [['text-line-break-ahem', ['ltr', 'rtl']], ['text-line-break-punct-ahem', ['ltr']]] as const;

describe('the text-line-break fixtures', () => {
  // DRAGON_LIVE_AUTHORED=1 captures Chrome live instead of reading the committed capture (before the first regen of a new fixture).
  const authored = () => (process.env['DRAGON_LIVE_AUTHORED'] === '1' ? liveAuthored(browser) : committedAuthored);
  for (const [id, directions] of LAYOUT) {
    it(`${id} passes chrome-dual and linux-dragon-layout in ${directions.join(' and ')}`, async () => {
      const out = await runFixture(specOf(id), browser, { authored: authored(), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(out.reason).toBeNull();
      expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual(directions.map((d) => [d, 'pass', 'pass']));
    }, 300_000);
  }
  for (const id of ['reject-text-line-break-anywhere', 'reject-text-line-break-char']) {
    it(`${id} is refused on every target`, async () => {
      const out = await runFixture(specOf(id), browser, { authored: authored(), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(out.reason).toBeNull();
      expect(out.status).toBe('pass');
    }, 300_000);
  }
  it('lineBreakOutsideAsciiAccepted lets reject-text-line-break-char through', async () => {
    const out = await runFixture(specOf('reject-text-line-break-char'), browser, { authored: authored(), faults: { ...NO_FAULTS, lineBreakOutsideAsciiAccepted: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    expect(out.status).toBe('fail');
  }, 300_000);
});

describe('the text-line-break fixtures pass at every DPR', () => {
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
