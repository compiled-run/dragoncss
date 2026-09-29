// TREE's planted compiler faults (notes/T025 §2 TREE item 7), through the same runFixture path as parity.test.ts's planted
// :is() specificity fault, with the committed Chrome captures as the authored side (parity.test.ts proves them equal to live
// Chrome). Each fault must fail its named attributes fixture in both directions; the unfaulted run passes.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import type { CompilerFaults } from 'dragon';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { runFixture } from '../src/pipeline.ts';
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

const PLANTED: readonly { readonly fault: keyof CompilerFaults; readonly fixture: string; readonly nodes: readonly string[] }[] = [
  { fault: 'idSpecificityAsClass', fixture: 'attr-id-specificity', nodes: ['x1', 'x5', 'y1', 'z1'] },
  { fault: 'attributeCaseAlwaysSensitive', fixture: 'attr-value-case', nodes: ['g1', 'r1'] },
  { fault: 'invalidSelectorListKept', fixture: 'attr-drop-invalid', nodes: ['a', 'b'] },
];

describe.sequential('TREE planted compiler faults', () => {
  for (const p of PLANTED) {
    it(`${p.fault} fails ${p.fixture} on ${p.nodes.join(', ')} in every case; unfaulted it passes`, async () => {
      const spec = FIXTURES.find((f) => f.id === p.fixture);
      if (spec === undefined) throw new Error(`${p.fixture} is not registered`);
      const clean = await runFixture(spec, browser, { authored: committedAuthored, faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(clean.reason).toBeNull();
      const faulty = await runFixture(spec, browser, { authored: committedAuthored, faults: { ...NO_FAULTS, [p.fault]: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(faulty.status).toBe('fail');
      expect(faulty.cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
      for (const c of faulty.cases) {
        expect(c.status, c.id).toBe('fail');
        expect(c.lanes['chrome-dual'], c.id).toBe('fail');
        // The named nodes take the faulty value; boxes after a changed height move too.
        expect(c.comparison?.nodes.filter((n) => !n.pass).map((n) => n.id), c.id).toEqual(expect.arrayContaining([...p.nodes]));
      }
    });
  }
});
