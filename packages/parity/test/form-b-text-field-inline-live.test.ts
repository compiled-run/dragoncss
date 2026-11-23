// An inline-block text field on its line (fixture-groups/controls.ts) against live Chrome 145: controls-text-field-inline passes
// chrome-dual and linux-dragon-layout, the engine equals Chrome at every DPR in its boxes and its line breaks, and the rejects are refused. Chrome is captured live
// and the support profiles are derived from the run, as the regen does, since the fixtures are new.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { engineLayoutProjection, NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome, openPage } from '../src/chrome.ts';
import { captureFixture } from '../src/capture.ts';
import { atDpr, DPRS, layoutCases, runDprCase, zoomGuard } from '../src/dpr.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { breakVector, captureBreakTexts, compareVectorWithChrome, engineTextLines, leafTexts } from '../src/line-breaks.ts';
import { referenceShapedMeasurer } from '../src/text-shaper-host.ts';
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

const LAYOUT = 'controls-text-field-inline';
const REJECTS = ['reject-controls-text-field-inline-dir', 'reject-controls-text-field-inline-valign', 'reject-controls-text-field-inline-flex'];
const live = () => ({ authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'derive' as const });

describe('the inline text field fixtures against live Chrome', () => {
  it(`${LAYOUT} passes chrome-dual and linux-dragon-layout`, async () => {
    const out = await runFixture(specOf(LAYOUT), browser, live());
    expect(out.reason).toBeNull();
    expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual([['ltr', 'pass', 'pass']]);
  }, 300_000);

  for (const id of REJECTS) {
    it(`${id} is refused on every target`, async () => {
      const out = await runFixture(specOf(id), browser, live());
      expect(out.reason).toBeNull();
      expect(out.status).toBe('pass');
    }, 300_000);
  }
});

describe(`${LAYOUT} equals live Chrome at 1x and every DPR`, () => {
  const cases = layoutCases().filter((f) => f.spec.id === LAYOUT).flatMap((f) => f.cases);
  const compiled = compileFixture(specOf(LAYOUT), NO_FAULTS, 'derive', 'ltr').compiled;
  for (const dpr of [1, ...DPRS]) {
    it(`at DPR ${dpr}`, async () => {
      expect(cases.length).toBe(1);
      const b = await launchChrome(dpr);
      try {
        if (dpr !== 1) await zoomGuard(b, dpr);
        const failed: string[] = [];
        let nodes = 0;
        let texts = 0;
        for (const c of cases) {
          const capture = await captureFixture(b, c.id, c.authoredHtml, atDpr(c.environment, dpr), [], c.authoredPrepare ?? undefined);
          expect(capture.devicePixelRatio).toBe(dpr);
          const o = runDprCase(c, compiled, dpr, capture, NO_ENGINE_FAULTS);
          nodes += o.nodes;
          if (o.status === 'fail') failed.push(`${o.id}@${o.dpr}: ${o.reason}`);
          const p = engineLayoutProjection(compiled, atDpr(c.environment, dpr), c.assignment);
          if (p.kind !== 'ready') throw new Error(p.reason);
          const page = await openPage(b, c.authoredHtml, atDpr(c.environment, dpr));
          const chrome = { case: c.id, chrome: CHROME_VERSION, dpr, texts: await captureBreakTexts(page) };
          await page.context().close();
          const r = compareVectorWithChrome(breakVector(c.id, dpr, engineTextLines(p.input, referenceShapedMeasurer())), chrome, leafTexts(p.input.root));
          texts += r.compared;
          for (const x of r.problems) failed.push(`${c.id}@${dpr}: ${x.kind}: ${x.detail}`);
        }
        expect(failed).toEqual([]);
        // 115: #666 adds each search field's ::cancel box (n1, s1, s2), which matches Chrome's rect exactly.
        expect([nodes, texts]).toEqual([115, 32]);
      } finally {
        await b.close();
      }
    }, 300_000);
  }
});
