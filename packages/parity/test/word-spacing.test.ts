// TXT2-b (fixture-groups/text-spacing.ts, notes/T149-txt2-spec.md R4): word-spacing against Chrome 145.
// The fixtures pass both lanes; the computed value matches getComputedStyle (normal and 0 compute to 0px; wordNormalNotZero is
// caught); and each word-spacing shaping plant makes the engine differ from Chrome at every DPR: wordSpacingAtItemStart on the span
// whose text starts with a space, wordSpacingSkipsNbsp on the no-break spaces.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { absoluteRects, layoutWithFaults, NO_ENGINE_FAULTS } from '@dragon/layout';
import * as dragon from 'dragon';
import { NO_FAULTS } from 'dragon';
import type { Longhand } from '../../dragon/src/css/properties.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import type { CssValue } from '../../dragon/src/css/values.ts';
import type { ResolvedValue } from '../../dragon/src/analysis/computed.ts';
import { computeWordSpacing } from '../../dragon/src/analysis/computed.ts';
import type { Diagnostic } from '../../dragon/src/index.ts';
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

const specOf = (id: string) => {
  const f = FIXTURES.find((x) => x.id === id);
  if (f === undefined) throw new Error(`no fixture ${id}`);
  return f;
};

describe('the word-spacing fixtures', () => {
  // DRAGON_LIVE_AUTHORED=1 captures Chrome live instead of reading the committed capture (before the first regen of a new fixture).
  const authored = () => (process.env['DRAGON_LIVE_AUTHORED'] === '1' ? liveAuthored(browser) : committedAuthored);
  for (const [id, directions] of [['text-word-spacing-ahem', ['ltr', 'rtl']], ['text-word-spacing-lato', ['ltr', 'rtl']], ['text-word-spacing-nbsp', ['ltr']]] as const) {
    it(`${id} passes chrome-dual and linux-dragon-layout in ${directions.join(' and ')}`, async () => {
      const out = await runFixture(specOf(id), browser, { authored: authored(), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(out.reason).toBeNull();
      expect(out.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual(directions.map((d) => [d, 'pass', 'pass']));
    }, 300_000);
  }
});

describe('word-spacing computes as Chrome 145 computes it', () => {
  const SOURCE = { uri: 'dragon-source://test/word-spacing.css', revision: 'r1', hash: 'sha256:0' };
  const VALUES = ['normal', '0', '0px', '-0px', '0em', '2px', '-15px', '0.5px', '.5em', '-0.1em', 'calc(0px)'];
  /** Dragon's computed word-spacing at font-size 10px, serialized as getComputedStyle does. */
  const mine = (value: string, wordNormalNotZero: boolean): string => {
    const css = `.a { word-spacing: ${value}; }`;
    const diagnostics: Diagnostic[] = [];
    const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
    let v = rules[0]?.declarations[0]?.longhands[0]?.value as CssValue;
    if (v.kind === 'length' && v.unit === 'em') v = { kind: 'length', value: v.value * 10, unit: 'px' };
    if (v.kind === 'other' && /^calc\(0px\)$/.test(v.text)) v = { kind: 'length', value: 0, unit: 'px' };
    const props = new Map<Longhand, ResolvedValue>([['word-spacing', { value: v } as ResolvedValue]]);
    computeWordSpacing(props, wordNormalNotZero);
    const out = (props.get('word-spacing') as ResolvedValue).value;
    if (out.kind === 'keyword') return out.value;
    if (out.kind === 'length') return `${Object.is(out.value, -0) ? 0 : Number(out.value.toFixed(4))}px`;
    return JSON.stringify(out);
  };
  it('matches getComputedStyle on every value; wordNormalNotZero is caught', async () => {
    const page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><body style="font-size:10px"></body>');
    const seen = (await page.evaluate(`(${JSON.stringify(VALUES)}).map((v) => { const e = document.createElement('div'); e.style.setProperty('word-spacing', v); document.body.appendChild(e); const s = getComputedStyle(e).wordSpacing; e.remove(); return s; })`)) as string[];
    await page.close();
    expect(VALUES.map((v) => mine(v, false))).toEqual(seen);
    expect(VALUES.map((v) => mine(v, true))).not.toEqual(seen);
  }, 120_000);
});

describe('the shaped checks catch the word-spacing plants at every DPR', () => {
  const caseOf = (fixture: string): ParityCase => {
    const spec = specOf(fixture);
    const c = casesOf(spec, compileFixture(spec).input).find((x) => x.environment.direction === 'ltr');
    if (c === undefined) throw new Error(`no ltr case of ${fixture}`);
    return c;
  };
  // As text-spacing.test.ts: at DPR 1 the engine lane (hyphen-joined, exact) or the live breaks; at a DPR set the DPR lane or the committed breaks.
  const differs = async (fixture: string, dpr: number, ef: EngineFaults): Promise<boolean> => {
    const c = caseOf(fixture);
    const compiled = compileFixture(specOf(fixture), NO_FAULTS, 'derive', 'ltr').compiled;
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
    it(`unfaulted passes, wordSpacingAtItemStart is caught on text-word-spacing-lato and wordSpacingSkipsNbsp on text-word-spacing-nbsp, at DPR ${dpr}`, async () => {
      for (const fixture of ['text-word-spacing-lato', 'text-word-spacing-nbsp']) expect(await differs(fixture, dpr, NO_ENGINE_FAULTS), `${fixture} unfaulted`).toBe(false);
      expect(await differs('text-word-spacing-lato', dpr, { ...NO_ENGINE_FAULTS, wordSpacingAtItemStart: true }), 'wordSpacingAtItemStart').toBe(true);
      expect(await differs('text-word-spacing-nbsp', dpr, { ...NO_ENGINE_FAULTS, wordSpacingSkipsNbsp: true }), 'wordSpacingSkipsNbsp').toBe(true);
    }, 600_000);
  }
});
