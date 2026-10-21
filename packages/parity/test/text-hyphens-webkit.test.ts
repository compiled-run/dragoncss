// TXT2-i: -webkit-hyphens compiles as a no-op (css/chrome-dropped.ts), matching Chrome 145, which drops the property. The fixture
// text-hyphens-webkit-ahem (fixture-groups/text-hyphens.ts) sets it alone (none, auto, manual, an invalid value, inherit), in
// Tailwind's hyphens-* pairs, after a contrary hyphens and on a flex row, each beside a twin without the declaration. Against a live
// Chrome 145 capture, so the proof needs no regen: the fixture passes chrome-dual and linux-dragon-layout in both directions, and in
// Chrome each box lays out and computes as its twin, and CSS.supports('-webkit-hyphens', ...) is false.
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { FIXTURES } from '../src/fixtures.ts';
import type { FixtureOutcome } from '../src/pipeline.ts';
import { compileFixture, liveAuthored, runFixture, webCssOf } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';

const ID = 'text-hyphens-webkit-ahem';
const PAIRS = ['kn', 'ka', 'km', 'kx', 'ki', 'tn', 'ta', 'ov', 'row', 'ra', 'rb'];
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

describe('TXT2-i: -webkit-hyphens is dropped, as in Chrome 145', () => {
  it('Dragon compiles the fixture with one DRAGON_PROPERTY_DROPPED warning per declaration, and the web output leaves it out', () => {
    const { compiled } = compileFixture(spec());
    expect(compiled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(compiled.diagnostics.filter((d) => d.code === 'DRAGON_PROPERTY_DROPPED').map((d) => d.severity)).toEqual(Array(9).fill('warning'));
    const css = webCssOf(compiled);
    expect(css).not.toBeNull();
    expect(css).not.toContain('-webkit-hyphens');
  });

  it(`${ID} passes chrome-dual and linux-dragon-layout in ltr and rtl`, async () => {
    const out = await runFixture(spec(), browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' });
    expect(out.reason).toBeNull();
    expect(lanes(out)).toEqual([['ltr', 'pass', 'pass'], ['rtl', 'pass', 'pass']]);
  }, 300_000);

  it('in Chrome, each box with the declaration lays out and computes as its twin without it, and CSS.supports is false', async () => {
    const html = readFileSync(new URL(`../fixtures/${ID}.html`, import.meta.url), 'utf8');
    const page = await browser.newPage();
    try {
      await page.setContent(html);
      // A string expression: this test project has no DOM types.
      const boxes = (await page.evaluate(`Object.fromEntries([...document.querySelectorAll('[data-dragon-id]')].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.dragonId, { w: r.width, h: r.height, hyphens: getComputedStyle(e).hyphens }]; }))`)) as Record<string, { w: number; h: number; hyphens: string }>;
      for (const id of PAIRS) {
        expect(boxes[id], id).toBeDefined();
        expect(boxes[id], id).toEqual(boxes[`${id}-twin`]);
      }
      // The dropped declaration sets nothing: hyphens keeps its initial manual, or the hyphens beside it.
      expect(['kn', 'ka', 'kx', 'ki', 'ov', 'tn', 'ta'].map((id) => boxes[id]?.hyphens)).toEqual(['manual', 'manual', 'manual', 'manual', 'none', 'none', 'auto']);
      // Some boxes wrap, so the twins compare more than one line.
      expect(boxes.kn?.h ?? 0).toBeGreaterThan(10);
      const supports = await page.evaluate(`['none', 'manual', 'auto'].map((v) => CSS.supports('-webkit-hyphens', v))`);
      expect(supports).toEqual([false, false, false]);
    } finally {
      await page.close();
    }
  }, 120_000);
});
