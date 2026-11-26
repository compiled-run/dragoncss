// RF-INL: inline-block and inline-flex buttons on their lines (controls-button-inline) against a live Chrome 145 capture.
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { FIXTURES } from '../src/fixtures.ts';
import type { FixtureOutcome } from '../src/pipeline.ts';
import { compileFixture, liveAuthored, runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';

const ID = 'controls-button-inline';
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

describe('RF-INL: inline-block and inline-flex buttons on their lines, as in Chrome 145', () => {
  it('Dragon compiles the fixture with no error', () => {
    const { compiled } = compileFixture(spec(), NO_FAULTS, 'derive');
    expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
  });

  it(`${ID} passes chrome-dual and linux-dragon-layout in ltr and rtl`, async () => {
    const out = await runFixture(spec(), browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' });
    expect(out.reason).toBeNull();
    expect(lanes(out)).toEqual([['ltr', 'pass', 'pass'], ['rtl', 'pass', 'pass']]);
  }, 300_000);

  it('reject-controls-button-inline: an inline-grid button stays refused, naming RF-INL', async () => {
    const reject = FIXTURES.find((x) => x.id === 'reject-controls-button-inline');
    if (reject === undefined) throw new Error('no reject-controls-button-inline');
    const out = await runFixture(reject, browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    expect(out.reason).toBeNull();
  });

  it('in Chrome, a button with no author display computes inline-block, and the inline-flex ones inline-flex', async () => {
    const html = readFileSync(new URL(`../fixtures/${ID}.html`, import.meta.url), 'utf8');
    const page = await browser.newPage();
    try {
      await page.setContent(html);
      // A string expression: this test project has no DOM types.
      const displays = (await page.evaluate(`[...document.querySelectorAll('button')].map((e) => getComputedStyle(e).display)`)) as string[];
      expect(displays).toEqual([...Array(14).fill('inline-block'), ...Array(4).fill('inline-flex')]);
    } finally {
      await page.close();
    }
  }, 120_000);
});
