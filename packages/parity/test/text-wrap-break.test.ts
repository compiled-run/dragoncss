// TXT2-a (notes/T149J-txt2.md): the text-wrap-break group's planted faults against the committed Chrome captures. Each engine plant
// fails its named case at DPR 1, 2, 3 and 2.625 in each direction, the compiler plant fails its case in both directions, and the
// unfaulted runs pass. graphemeClusterSplit has no case here: every grapheme cluster of renderable Ahem and Latin text is one code
// point (the shaping core refuses combining marks), so test/grapheme.test.ts catches it against Chrome's Intl.Segmenter.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { featureOf } from '../../dragon/src/css/values.ts';
import { COMMITTED_PROFILES } from '../../dragon/src/project.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { committedDprCapture, DPRS, runDprCase } from '../src/dpr.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { compileFixture, runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';

const specOf = (id: string) => {
  const spec = FIXTURES.find((x) => x.id === id);
  if (spec === undefined) throw new Error(`${id} is not registered`);
  return spec;
};

describe('TXT2-a engine plants fail a named text-wrap-break case at every DPR (committed captures)', () => {
  const PLANTS: readonly { readonly fault: keyof EngineFaults; readonly fixture: string }[] = [
    { fault: 'anywhereMinContentIgnored', fixture: 'text-wrap-break-flex' },
    { fault: 'breakWordShrinksMinContent', fixture: 'text-wrap-break-flex' },
    { fault: 'wordBreakBreakWordIgnored', fixture: 'text-wrap-break-ahem' },
    { fault: 'breakAnywhereAlways', fixture: 'text-wrap-break-ahem' },
    { fault: 'breakAnywhereAlways', fixture: 'text-wrap-break-lato' },
    { fault: 'emergencyBreakBeforeOpportunity', fixture: 'text-wrap-break-ahem' },
  ];
  it.each(PLANTS)('$fault fails $fixture at DPR 1, 2, 3 and 2.625 in each direction; unfaulted it passes', (p) => {
    const spec = specOf(p.fixture);
    const cases = casesOf(spec, fixtureInput(spec));
    expect(cases.map((c) => c.environment.direction)).toEqual(['ltr', 'rtl']);
    for (const c of cases) {
      const { compiled } = compileFixture(spec, NO_FAULTS, 'enforce', c.environment.direction);
      for (const dpr of [1, ...DPRS]) {
        const capture = committedDprCapture(c.id, dpr);
        expect(runDprCase(c, compiled, dpr, capture).reason, `${c.id} ${dpr}`).toBeNull();
        expect(runDprCase(c, compiled, dpr, capture, { ...NO_ENGINE_FAULTS, [p.fault]: true }).status, `${c.id} ${dpr}`).toBe('fail');
      }
    }
  }, 600_000);
});

let browser: Browser;
beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});
afterAll(async () => {
  await browser.close();
});

describe.sequential('TXT2-a compiler plant', () => {
  it('overflowWrapNotInherited: text-wrap-break-ahem fails in both directions; unfaulted it passes', async () => {
    const spec = specOf('text-wrap-break-ahem');
    const run = (faults: typeof NO_FAULTS) => runFixture(spec, browser, { authored: committedAuthored, faults, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    expect((await run(NO_FAULTS)).reason).toBeNull();
    const faulty = await run({ ...NO_FAULTS, overflowWrapNotInherited: true });
    expect(faulty.cases.map((c) => [c.direction, c.status])).toEqual([['ltr', 'fail'], ['rtl', 'fail']]);
  }, 600_000);
});

describe('TXT2-a letter-spacing rows (PM ruling 2026-10-03: proven only at 0)', () => {
  it('keys a zero letter-spacing as its own value subset and any other length by its type', () => {
    expect(featureOf('letter-spacing', { kind: 'length', value: 0, unit: 'px' })).toBe('letter-spacing:0');
    expect(featureOf('letter-spacing', { kind: 'number', value: 0 })).toBe('letter-spacing:0');
    expect(featureOf('letter-spacing', { kind: 'length', value: 2, unit: 'px' })).toBe('letter-spacing:<length-px>');
    expect(featureOf('letter-spacing', { kind: 'keyword', value: 'normal' })).toBe('letter-spacing:normal');
    expect(featureOf('width', { kind: 'length', value: 0, unit: 'px' })).toBe('width:<length-px>');
  });
  it('gives every target only the 0 and normal letter-spacing rows, so no nonzero length is proven', () => {
    for (const p of [COMMITTED_PROFILES.ios, COMMITTED_PROFILES.android, COMMITTED_PROFILES.web]) {
      const rows = p.rows.filter((r) => r.feature.startsWith('letter-spacing:'));
      expect(rows.length, p.target).toBeGreaterThan(0);
      for (const r of rows) {
        expect(['letter-spacing:0', 'letter-spacing:normal'], `${p.target} ${r.feature} ${r.context}`).toContain(r.feature);
        for (const proof of r.proofs) expect(proof.valueSubset, `${p.target} ${r.feature} ${r.context}`).toBe(r.feature.slice('letter-spacing:'.length));
      }
    }
  });
});
