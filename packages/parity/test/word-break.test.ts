// TXT2-d (fixture-groups/text-word-break.ts, notes/T149-txt2-spec.md R15): word-break break-all and keep-all over Ahem against Chrome
// 145. The fixtures pass both lanes (letters in both directions, digits and punctuation left to right), the engine plant
// breakAllIgnored makes the engine differ from Chrome's committed captures at DPR 1, 2, 3 and 2.625, and the compiler plant
// breakAllOutsideAsciiAccepted lets reject-text-break-all compile.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { committedDprCapture, DPRS, layoutCases, runDprCase } from '../src/dpr.ts';
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

const LAYOUT = [['text-word-break-ahem', ['ltr', 'rtl']], ['text-word-break-digits-ahem', ['ltr']]] as const;

describe('the text-word-break fixtures', () => {
  // DRAGON_LIVE_AUTHORED=1 captures Chrome live instead of reading the committed capture (before the first regen of a new fixture).
  const authored = () => (process.env['DRAGON_LIVE_AUTHORED'] === '1' ? liveAuthored(browser) : committedAuthored);
  for (const [id, directions] of LAYOUT) {
    it(`${id} passes chrome-dual and linux-dragon-layout in ${directions.join(' and ')}`, async () => {
      const out = await runFixture(specOf(id), browser, { authored: authored(), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(out.reason).toBeNull();
      expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual(directions.map((d) => [d, 'pass', 'pass']));
    }, 300_000);
  }
  for (const id of ['reject-text-word-break-auto-phrase', 'reject-text-break-all']) {
    it(`${id} is refused on every target`, async () => {
      const out = await runFixture(specOf(id), browser, { authored: authored(), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(out.reason).toBeNull();
      expect(out.status).toBe('pass');
    }, 300_000);
  }
  it('breakAllOutsideAsciiAccepted lets reject-text-break-all through', async () => {
    const out = await runFixture(specOf('reject-text-break-all'), browser, { authored: authored(), faults: { ...NO_FAULTS, breakAllOutsideAsciiAccepted: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    expect(out.status).toBe('fail');
  }, 300_000);
});

describe('breakAllIgnored is caught on the text-word-break fixtures at every DPR', () => {
  for (const [id] of LAYOUT) {
    const corpus = layoutCases().filter((f) => f.spec.id === id);
    // Each direction's case runs against the program compiled for that direction.
    const compiled = { ltr: compileFixture(specOf(id), NO_FAULTS, 'enforce', 'ltr').compiled, rtl: compileFixture(specOf(id), NO_FAULTS, 'enforce', 'rtl').compiled };
    const failing = (faults: EngineFaults, dpr: number): string[] =>
      corpus.flatMap((f) => f.cases.map((c) => runDprCase(c, compiled[c.environment.direction], dpr, committedDprCapture(c.id, dpr), faults))).filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}: ${o.reason}`);
    for (const dpr of [1, ...DPRS]) {
      it(`${id}: unfaulted passes and the plant fails at DPR ${dpr}`, () => {
        expect(corpus.flatMap((f) => f.cases).length).toBe(LAYOUT.find(([x]) => x === id)?.[1].length);
        expect(failing(NO_ENGINE_FAULTS, dpr)).toEqual([]);
        expect(failing({ ...NO_ENGINE_FAULTS, breakAllIgnored: true }, dpr).length).toBeGreaterThan(0);
      });
    }
  }
});
