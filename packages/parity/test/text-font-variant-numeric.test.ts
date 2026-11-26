// TXT-FONTFEAT (fixture-groups/text-font-variant.ts): font-variant-numeric in real faces against Chrome 145. The fixture passes both
// lanes (ltr only: an rtl block refuses digits, DRAGON_UNSUPPORTED_BIDI), and numericFeaturesDropped (the engine shaping without the OpenType features) makes the engine differ
// from Chrome at every DPR.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { absoluteRects, layoutWithFaults, NO_ENGINE_FAULTS } from '@dragon/layout';
import * as dragon from 'dragon';
import { NO_FAULTS } from 'dragon';
import type { ParityCase } from '../src/cases.ts';
import { casesOf } from '../src/cases.ts';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { compareLayout } from '../src/compare.ts';
import { committedDprCapture, runDprCase } from '../src/dpr.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { readChromeBreaks } from '../src/line-breaks.ts';
import { compileFixture, liveAuthored, runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';
import * as tl from '../src/text-latin-run.ts';
import { referenceShapedMeasurer } from '../src/text-shaper-host.ts';

let browser: Browser;

beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});

afterAll(async () => {
  await browser.close();
});

const fixture = 'text-font-variant-numeric';
const spec = FIXTURES.find((x) => x.id === fixture);
if (spec === undefined) throw new Error(`no fixture ${fixture}`);

describe('the text-font-variant-numeric fixture', () => {
  // DRAGON_LIVE_AUTHORED=1 captures Chrome live instead of reading the committed capture (before the first regen of a new fixture).
  const authored = () => (process.env['DRAGON_LIVE_AUTHORED'] === '1' ? liveAuthored(browser) : committedAuthored);
  it('passes chrome-dual and linux-dragon-layout', async () => {
    const out = await runFixture(spec, browser, { authored: authored(), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    expect(out.reason).toBeNull();
    expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual([['ltr', 'pass', 'pass']]);
  }, 300_000);
});

describe('the shaped checks catch numericFeaturesDropped on text-font-variant-numeric at every DPR', () => {
  const caseOf = (): ParityCase => {
    const c = casesOf(spec, compileFixture(spec).input).find((x) => x.environment.direction === 'ltr');
    if (c === undefined) throw new Error(`no ltr case of ${fixture}`);
    return c;
  };
  const derived = () => compileFixture(spec, NO_FAULTS, 'derive', 'ltr').compiled;
  // As text-latin.test.ts: at DPR 1 the engine lane (hyphen-joined, exact) or the live breaks; at a DPR set the DPR lane or the committed breaks.
  const differs = async (dpr: number, ef: EngineFaults): Promise<boolean> => {
    const c = caseOf();
    const compiled = derived();
    if (dpr !== 1) {
      const r = runDprCase(c, compiled, dpr, committedDprCapture(c.id, dpr), ef);
      if (r.status !== 'pass' || r.vector === null) return true;
      const b = readChromeBreaks(c.id, dpr);
      if (b === null) throw new Error(`no committed breaks of ${c.id} at DPR ${dpr}`);
      return tl.breakProblems(c.id, dpr, r.vector.input, b, ef).problems.length > 0;
    }
    const p = dragon.engineLayoutProjection(compiled, c.environment, c.assignment);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const out = layoutWithFaults(p.input, referenceShapedMeasurer(ef), ef);
    if (out.kind !== 'ok') return true;
    const cmp = compareLayout(tl.joinHyphenRects(committedDprCapture(c.id, 1)), absoluteRects(out.boxes), p.input, c.environment);
    if (!cmp.pass || cmp.nodes.some((n) => n.dragon !== null && !n.exactLu)) return true;
    return tl.breakProblems(c.id, 1, p.input, await tl.liveChromeBreaks(browser, c, 1), ef).problems.length > 0;
  };
  for (const dpr of [1, 2, 3, 2.625]) {
    it(`unfaulted passes, and numericFeaturesDropped is caught, at DPR ${dpr}`, async () => {
      expect(await differs(dpr, NO_ENGINE_FAULTS), 'unfaulted').toBe(false);
      expect(await differs(dpr, { ...NO_ENGINE_FAULTS, numericFeaturesDropped: true }), 'numericFeaturesDropped').toBe(true);
    }, 600_000);
  }
});
