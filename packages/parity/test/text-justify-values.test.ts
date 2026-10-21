// TXT2-tj: text-justify (text-justify-values-ahem, fixture group text-justify) against a live Chrome 145 capture, so the proof needs
// no regen. auto and inter-word expand at spaces, none nowhere, inter-character (and distribute, which computes to it) after every
// character but the line's last, the truncated 16.16 share on each and the remainder on the last; the opportunity context carries
// across texts of different text-justify, inherits, and does nothing on an unjustified block; a flex row holds two of them. It passes
// chrome-dual and linux-dragon-layout in both directions with derived profiles (text-justify-mixed-ahem, whose line mixes
// inter-character with auto, in ltr only: rtl is refused), whose rows allow each value in text-in-block on web, iOS and Android;
// Chrome puts every glyph where the engine does (text-justify-glyphs.ts), and planted fault textJustifyAuto fails the engine lane.
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
import { BLOCKS, engineGlyphs, FIXTURE_BLOCKS, ID, MIXED_ID } from './text-justify-glyphs.ts';

let browser: Browser;

beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});

afterAll(async () => {
  await browser.close();
});

const spec = (id: string = ID) => {
  const f = FIXTURES.find((x) => x.id === id);
  if (f === undefined) throw new Error(`no fixture ${id}`);
  return f;
};
const lanes = (out: FixtureOutcome) => out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']]);

describe('TXT2-tj: text-justify equals live Chrome', () => {
  let out: FixtureOutcome;

  it(`${ID} passes chrome-dual and linux-dragon-layout in ltr and rtl`, async () => {
    out = await runFixture(spec(), browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' });
    expect(out.reason).toBeNull();
    expect(lanes(out)).toEqual([['ltr', 'pass', 'pass'], ['rtl', 'pass', 'pass']]);
  }, 300_000);

  it(`${MIXED_ID} passes chrome-dual and linux-dragon-layout in ltr`, async () => {
    const mixed = await runFixture(spec(MIXED_ID), browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' });
    expect(mixed.reason).toBeNull();
    expect(lanes(mixed)).toEqual([['ltr', 'pass', 'pass']]);
  }, 300_000);

  it('the derived profile rows allow each value in text-in-block on every target, proved by this fixture', () => {
    for (const target of ['web', 'ios', 'android'] as const) {
      for (const value of ['auto', 'none', 'inter-word', 'inter-character']) {
        const rows = deriveRows(target, out.cases).filter((r) => r.feature === `text-justify:${value}`);
        const contexts = rows.map((r) => r.context);
        expect(contexts.filter((c) => c.startsWith('text-in-block/')).sort(), `${target} ${value}`).toEqual(['text-in-block/ltr', 'text-in-block/rtl']);
        for (const r of rows) {
          expect(r.status, `${target} ${value} ${r.context}`).toBe('exact');
          for (const p of r.proofs) expect(p.cases.length, `${target} ${value} ${r.context} ${p.lane}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('in Chrome, every block computes its text-justify and puts each glyph where the engine does', async () => {
    const seen: Record<string, { justify: string; lines: number[][] }> = {};
    for (const [id, blocks] of Object.entries(FIXTURE_BLOCKS)) {
      const html = readFileSync(new URL(`../fixtures/${id}.html`, import.meta.url), 'utf8');
      // openPage injects the harness's Ahem face and waits for it to load, as the fixture's lanes do.
      const page = await openPage(browser, html, ENVIRONMENT);
      try {
        expect(await page.evaluate('document.fonts.check("10px Ahem")')).toBe(true);
        // A string expression: this test project has no DOM types. Each block's lines, in document order of its text nodes, are the
        // lefts of its non-space characters from the block's left that share a top.
        Object.assign(seen, await page.evaluate(`Object.fromEntries(${JSON.stringify(blocks)}.map((id) => {
          const e = document.querySelector('[data-dragon-id="' + id + '"]');
          const left = e.getBoundingClientRect().left + e.clientLeft;
          const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
          const lines = [];
          let top = null;
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            for (let i = 0; i < node.data.length; i++) {
              if (/\\s/.test(node.data[i])) continue;
              const r = document.createRange();
              r.setStart(node, i);
              r.setEnd(node, i + 1);
              const q = r.getClientRects()[0];
              if (top === null || q.top !== top) lines.push([]);
              lines[lines.length - 1].push(q.left - left);
              top = q.top;
            }
          }
          return [id, { justify: getComputedStyle(e).textJustify, lines }];
        }))`) as Record<string, { justify: string; lines: number[][] }>);
      } finally {
        await page.context().close();
      }
    }
    const engine = engineGlyphs();
    for (const id of BLOCKS) expect(seen[id]?.lines, id).toEqual(engine[id]?.map((l) => l.map((x) => Math.floor(x * 64) / 64)));
    expect(Object.fromEntries(BLOCKS.map((id) => [id, seen[id]?.justify]))).toEqual({
      auto: 'auto', word: 'inter-word', none: 'none', char: 'inter-character', rem: 'inter-character', dist: 'inter-character', mixn: 'auto',
      mixc: 'inter-character', inhc: 'inter-character', off: 'inter-character', rc: 'inter-character', rn: 'none',
    });
  }, 120_000);

  it('planted fault textJustifyAuto fails linux-dragon-layout in both directions', async () => {
    expect(engineGlyphs({ ...NO_ENGINE_FAULTS, textJustifyAuto: true })).not.toEqual(engineGlyphs());
    const planted = await runFixture(spec(), browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: { ...NO_ENGINE_FAULTS, textJustifyAuto: true }, profiles: 'derive' });
    expect(lanes(planted)).toEqual([['ltr', 'pass', 'fail'], ['rtl', 'pass', 'fail']]);
  }, 300_000);
});
