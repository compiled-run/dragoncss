// TXT2-a (fixture-groups/text-break.ts, notes/T149-txt2-spec.md §0): overflow-wrap anywhere and break-word, word-break: break-word and
// the word-wrap alias against Chrome 145. The fixtures pass both lanes (Ahem in both directions, Lato left to right), and each engine
// plant makes the engine differ from Chrome's committed captures: on text-break-ahem at DPR 1, 2, 3 and 2.625, and on the shaped
// text-break-lato at every DPR for the plants its cases reach.
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
import { committedDprCapture, DPRS, layoutCases, runDprCase } from '../src/dpr.ts';
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

const specOf = (id: string) => {
  const f = FIXTURES.find((x) => x.id === id);
  if (f === undefined) throw new Error(`no fixture ${id}`);
  return f;
};

const PLANTS = ['anywhereMinContentIgnored', 'breakWordShrinksMinContent', 'breakAnywhereAlways', 'emergencyBreakBeforeOpportunity', 'wordBreakBreakWordIgnored'] as const;

describe('the text-break fixtures', () => {
  // DRAGON_LIVE_AUTHORED=1 captures Chrome live instead of reading the committed capture (before the first regen of a new fixture).
  const authored = () => (process.env['DRAGON_LIVE_AUTHORED'] === '1' ? liveAuthored(browser) : committedAuthored);
  for (const [id, directions] of [['text-break-ahem', ['ltr', 'rtl']], ['text-break-lato', ['ltr']]] as const) {
    it(`${id} passes chrome-dual and linux-dragon-layout in ${directions.join(' and ')}`, async () => {
      const out = await runFixture(specOf(id), browser, { authored: authored(), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(out.reason).toBeNull();
      expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual(directions.map((d) => [d, 'pass', 'pass']));
    }, 300_000);
  }
});

describe('every engine plant is caught on text-break-ahem at every DPR', () => {
  const corpus = layoutCases().filter((f) => f.spec.id === 'text-break-ahem');
  // Each direction's case runs against the program compiled for that direction.
  const compiled = { ltr: compileFixture(specOf('text-break-ahem'), NO_FAULTS, 'enforce', 'ltr').compiled, rtl: compileFixture(specOf('text-break-ahem'), NO_FAULTS, 'enforce', 'rtl').compiled };
  const failing = (faults: EngineFaults, dpr: number): string[] =>
    corpus.flatMap((f) => f.cases.map((c) => runDprCase(c, compiled[c.environment.direction], dpr, committedDprCapture(c.id, dpr), faults))).filter((o) => o.status === 'fail').map((o) => `${o.id}@${o.dpr}: ${o.reason}`);
  for (const dpr of [1, ...DPRS]) {
    it(`unfaulted passes and each plant fails at DPR ${dpr}`, () => {
      expect(corpus.flatMap((f) => f.cases).length).toBe(2);
      expect(failing(NO_ENGINE_FAULTS, dpr)).toEqual([]);
      for (const plant of PLANTS) expect(failing({ ...NO_ENGINE_FAULTS, [plant]: true }, dpr).length, plant).toBeGreaterThan(0);
    });
  }
});

describe('the shaped checks catch the plants text-break-lato reaches at every DPR', () => {
  const fixture = 'text-break-lato';
  const caseOf = (): ParityCase => {
    const spec = specOf(fixture);
    const c = casesOf(spec, compileFixture(spec).input).find((x) => x.environment.direction === 'ltr');
    if (c === undefined) throw new Error(`no ltr case of ${fixture}`);
    return c;
  };
  const derived = () => compileFixture(specOf(fixture), NO_FAULTS, 'derive', 'ltr').compiled;
  // As text-spacing.test.ts: at DPR 1 the engine lane (hyphen-joined, exact) or the live breaks; at a DPR set the DPR lane or the committed breaks.
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
  for (const dpr of [1, ...DPRS]) {
    it(`unfaulted passes, and the anywhere and min-content plants are caught, at DPR ${dpr}`, async () => {
      expect(await differs(dpr, NO_ENGINE_FAULTS), 'unfaulted').toBe(false);
      for (const fault of ['breakAnywhereAlways', 'anywhereMinContentIgnored', 'breakWordShrinksMinContent', 'wordBreakBreakWordIgnored'] as const) expect(await differs(dpr, { ...NO_ENGINE_FAULTS, [fault]: true }), fault).toBe(true);
    }, 600_000);
  }
});
