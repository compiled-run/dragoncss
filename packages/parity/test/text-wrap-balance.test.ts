// TXT-TW: text-wrap-style balance and pretty (text-wrap-balance-ahem, fixture group text-wrap) against a live Chrome 145 capture, so
// the proof needs no regen. The fixture balances by Blink's score pass and by its bisection, keeps the greedy lines where Blink
// does (one line, more than six, an overflowing word), and lets pretty score the last four lines; a flex row holds one of each.
// It passes chrome-dual and linux-dragon-layout in both directions with derived profiles, whose rows allow balance and pretty in
// text-in-block and text-in-flex-item on web, iOS and Android; Chrome breaks every block's lines where the engine does (EXPECTED),
// and planted fault wrapStyleGreedy fails the engine lane.
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome, openPage } from '../src/chrome.ts';
import { ENVIRONMENT, FIXTURES } from '../src/fixtures.ts';
import type { FixtureOutcome } from '../src/pipeline.ts';
import { liveAuthored, runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';
import { deriveRows } from '../src/profile-rows.ts';
import { CHANGED, engineLines, EXPECTED, ID } from './text-wrap-lines.ts';

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

describe('TXT-TW: text-wrap-style balance and pretty equal live Chrome', () => {
  let out: FixtureOutcome;

  it(`${ID} passes chrome-dual and linux-dragon-layout in ltr and rtl`, async () => {
    out = await runFixture(spec(), browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' });
    expect(out.reason).toBeNull();
    expect(lanes(out)).toEqual([['ltr', 'pass', 'pass'], ['rtl', 'pass', 'pass']]);
  }, 300_000);

  it('the derived profile rows allow balance and pretty in text-in-block and text-in-flex-item on every target, proved by this fixture', () => {
    for (const target of ['web', 'ios', 'android'] as const) {
      for (const feature of ['text-wrap-style:balance', 'text-wrap-style:pretty']) {
        const rows = deriveRows(target, out.cases).filter((r) => r.feature === feature);
        const contexts = rows.map((r) => r.context).sort();
        expect(contexts.filter((c) => c.startsWith('text-in-block/')), `${target} ${feature}`).toEqual(['text-in-block/ltr', 'text-in-block/rtl']);
        expect(contexts.filter((c) => c.startsWith('text-in-flex-item/row/')), `${target} ${feature}`).toEqual(['text-in-flex-item/row/ltr', 'text-in-flex-item/row/rtl']);
        for (const r of rows) {
          expect(r.status, `${target} ${feature} ${r.context}`).toBe('exact');
          for (const p of r.proofs) expect(p.cases.length, `${target} ${feature} ${r.context} ${p.lane}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('in Chrome, every block computes its text-wrap-style and breaks its lines where the engine does', async () => {
    const html = readFileSync(new URL(`../fixtures/${ID}.html`, import.meta.url), 'utf8');
    // openPage injects the harness's Ahem face and waits for it to load, as the fixture's lanes do.
    const page = await openPage(browser, html, ENVIRONMENT);
    try {
      expect(await page.evaluate('document.fonts.check("10px Ahem")')).toBe(true);
      // A string expression: this test project has no DOM types. Each block's lines are its runs of non-space characters that share
      // a top, from the first to the last of each run.
      const seen = (await page.evaluate(`Object.fromEntries(${JSON.stringify(Object.keys(EXPECTED))}.map((id) => {
        const e = document.querySelector('[data-dragon-id="' + id + '"]');
        const node = e.firstChild;
        const text = node.data;
        const lines = [];
        let top = null;
        for (let i = 0; i < text.length; i++) {
          if (text[i] === ' ') continue;
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 1);
          const t = r.getClientRects()[0].top;
          if (top === null || t !== top) lines.push({ start: i, end: i + 1 });
          else lines[lines.length - 1].end = i + 1;
          top = t;
        }
        return [id, { style: getComputedStyle(e).textWrapStyle, lines: lines.map((l) => text.slice(l.start, l.end)) }];
      }))`)) as Record<string, { style: string; lines: string[] }>;
      for (const [id, lines] of Object.entries(EXPECTED)) {
        expect(seen[id]?.style, id).toBe(id.startsWith('p') || id === 'rp' ? 'pretty' : 'balance');
        expect(seen[id]?.lines, id).toEqual(lines);
      }
    } finally {
      await page.context().close();
    }
    expect(engineLines('ltr', 1)).toEqual(EXPECTED);
  }, 120_000);

  it('planted fault wrapStyleGreedy fails linux-dragon-layout in both directions', async () => {
    expect(CHANGED.length).toBeGreaterThan(0);
    const planted = await runFixture(spec(), browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: { ...NO_ENGINE_FAULTS, wrapStyleGreedy: true }, profiles: 'derive' });
    expect(lanes(planted)).toEqual([['ltr', 'pass', 'fail'], ['rtl', 'pass', 'fail']]);
    const problems = planted.cases[0]?.comparison?.problems ?? [];
    for (const id of ['b1', 'b3', 'p1', 'p2']) expect(problems.some((p) => p.startsWith(`${id}:text0:line`)), id).toBe(true);
  }, 300_000);
});
