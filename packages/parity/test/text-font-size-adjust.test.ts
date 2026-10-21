// TXT-FSA: font-size-adjust: none (text-font-size-adjust-ahem, fixture-groups/text-font-size.ts) against a live Chrome 145 capture,
// so the proof needs no regen. The fixture sets none in any case, inherited, through initial and unset, before the font shorthand and
// on a flex row, each box beside a twin without it. It passes chrome-dual and linux-dragon-layout in both directions with derived
// profiles, the rows pnpm run profile:rows derives from that run allow none in text-in-block on web, iOS and Android, and in Chrome
// every box computes font-size-adjust to none and lays out as its twin.
import { readFileSync } from 'node:fs';
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

const ID = 'text-font-size-adjust-ahem';
const PAIRS = ['n', 'u', 'p', 'pi', 'pn', 'pu', 'pk', 'f', 'row', 'ra', 'rb'];
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

describe('TXT-FSA: font-size-adjust: none equals live Chrome', () => {
  let out: FixtureOutcome;

  it(`${ID} passes chrome-dual and linux-dragon-layout in ltr and rtl`, async () => {
    out = await runFixture(spec(), browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' });
    expect(out.reason).toBeNull();
    expect(lanes(out)).toEqual([['ltr', 'pass', 'pass'], ['rtl', 'pass', 'pass']]);
  }, 300_000);

  it('the derived profile rows allow none in text-in-block on every target, proved by this fixture', () => {
    for (const target of ['web', 'ios', 'android'] as const) {
      const rows = deriveRows(target, out.cases).filter((r) => r.feature === 'font-size-adjust:none');
      expect(rows.map((r) => r.context).filter((c) => c.startsWith('text-in-block/')).sort(), target).toEqual(['text-in-block/ltr', 'text-in-block/rtl']);
      for (const r of rows) {
        expect(r.status, `${target} ${r.context}`).toBe('exact');
        for (const p of r.proofs) expect(p.cases.length, `${target} ${r.context} ${p.lane}`).toBeGreaterThan(0);
      }
    }
  });

  it('in Chrome, every box computes none and lays out as its twin without the declaration', async () => {
    const html = readFileSync(new URL(`../fixtures/${ID}.html`, import.meta.url), 'utf8');
    const page = await browser.newPage();
    try {
      await page.setContent(html);
      // A string expression: this test project has no DOM types.
      const boxes = (await page.evaluate(`Object.fromEntries([...document.querySelectorAll('[data-dragon-id]')].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.dragonId, { w: r.width, h: r.height, adjust: getComputedStyle(e).fontSizeAdjust, size: getComputedStyle(e).fontSize }]; }))`)) as Record<string, { w: number; h: number; adjust: string; size: string }>;
      for (const id of PAIRS) {
        expect(boxes[id], id).toBeDefined();
        expect(boxes[id], id).toEqual(boxes[`${id}-twin`]);
      }
      expect(Object.values(boxes).every((b) => b.adjust === 'none')).toBe(true);
      // The boxes wrap, so the twins compare more than one line.
      expect(boxes.n?.h ?? 0).toBeGreaterThan(10);
    } finally {
      await page.close();
    }
  }, 120_000);
});
